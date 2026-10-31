-- AMURA · Correctivo mínimo para habilitar Clientes en un proyecto que tiene instalada la versión ANTERIOR de 20261031000000_clientes_crm.sql.
-- NO EJECUTAR sin autorización. No incluye Ventas y contratos ni el Gantt. No borra filas ni tablas.
-- Todo o nada: si algo falla, no queda ningún cambio. Se puede repetir. Procedimiento: supabase/instalacion/DESPLIEGUE_PRODUCCION.md
-- Archivo generado desde la migración actual; supabase/tests/correctivo-clientes.test.ts comprueba que el resultado coincide con ella.

begin;

-- Se detiene si la base no está en el estado revisado, o si alguien perdería acceso a un cliente o negociación existente.
-- Hasta ahora también veía un cliente quien lo creó; con esta regla lo ve su asesor, quien lleva una negociación abierta o quien tenga acceso autorizado.
-- Solo se comprueba la primera vez: si client_access ya existe, el correctivo ya se aplicó.
do $$
declare v_clientes int; v_negociaciones int;
begin
  if to_regprocedure('public.clientes_crear(uuid, jsonb, uuid)') is null or to_regclass('public.client_imports') is null or to_regprocedure('public.cliente_en_alcance(uuid)') is null then
    raise exception 'La base no está en el estado esperado: falta la versión anterior de Clientes. No se aplicó nada.';
  end if;
  if to_regclass('public.client_access') is null then
    select count(*) into v_clientes from public.clients c
    where c.created_by is not null and c.created_by <> c.asesor_id
      and not exists (select 1 from public.opportunities o where o.client_id = c.id and o.etapa <> 'perdida' and o.responsable_id = c.created_by);
    select count(*) into v_negociaciones from public.opportunities o join public.clients c on c.id = o.client_id
    where o.etapa = 'perdida' and o.responsable_id is distinct from c.asesor_id and o.responsable_id is distinct from c.created_by
      and not exists (select 1 from public.opportunities x where x.client_id = c.id and x.etapa <> 'perdida' and x.responsable_id = o.responsable_id);
    if v_clientes + v_negociaciones > 0 then
      raise exception 'Perderían acceso % cliente(s) y % negociación(es) cerrada(s): revísalos con impacto_acceso_clientes.sql. No se aplicó nada.', v_clientes, v_negociaciones;
    end if;
  end if;
end $$;

/* -------------------------------------------------- estructura que falta */

alter table public.clients add column if not exists documento text not null default '';
-- Corredor externo que trajo al cliente, si es usuario de la app. Con atribucion_usuario_id (quien lo registró) sostiene las comisiones; ninguno cambia al reasignar.
alter table public.clients add column if not exists corredor_origen_id uuid references auth.users (id);

-- Autorización expresa para que una persona conserve acceso a un cliente que ya no tiene asignado.
create table if not exists public.client_access (
  client_id uuid not null references public.clients (id),
  usuario_id uuid not null references auth.users (id),
  motivo text not null,
  otorgado_por uuid not null default auth.uid() references auth.users (id),
  otorgado_en timestamptz not null default now(),
  revocado_por uuid references auth.users (id),
  revocado_en timestamptz,
  primary key (client_id, usuario_id)
);
alter table public.client_access enable row level security;

-- La importación ordinaria se cierra al terminar la migración; administración conserva la recuperación.
create table if not exists public.client_import_settings (
  id smallint primary key default 1 check (id = 1),
  habilitada boolean not null default true,
  definida_por uuid references auth.users (id),
  definida_en timestamptz
);
insert into public.client_import_settings (id) values (1) on conflict (id) do nothing;
alter table public.client_import_settings enable row level security;
drop policy if exists "ver importacion" on public.client_import_settings;
create policy "ver importacion" on public.client_import_settings for select to authenticated using (true);

/* --------------------------------------------- quién accede a un cliente */

create or replace function public.cliente_en_alcance(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c where c.id = p_client and (
      public.en_alcance(c.asesor_id)
      or exists (select 1 from opportunities o where o.client_id = c.id and o.etapa <> 'perdida' and public.en_alcance(o.responsable_id))
      or exists (select 1 from client_access a where a.client_id = c.id and a.revocado_en is null and public.en_alcance(a.usuario_id))
    ))
$$;

drop policy if exists "ver accesos" on public.client_access;
create policy "ver accesos" on public.client_access for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id));

/* ---------------------------------------------------- reglas del cliente */

create or replace function public.clients_proteger_asesor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asesor_id is distinct from old.asesor_id then
    if not (public.tiene_permiso('clientes.asignar') and public.en_alcance(new.asesor_id)) then
      raise exception 'Sin permiso para reasignar a esa persona' using errcode = '42501';
    end if;
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'Reasignar cliente', 'cliente', new.id::text,
            coalesce(nullif(current_setting('app.motivo', true), ''), 'Reasignación de asesor'),
            jsonb_build_object('asesor_id', old.asesor_id), jsonb_build_object('asesor_id', new.asesor_id));
  end if;
  -- El origen define la comisión y no se cambia después (política comercial, sección 3): solo por corrección autorizada.
  if (new.origen, new.origen_detalle, new.corredor_origen_id) is distinct from (old.origen, old.origen_detalle, old.corredor_origen_id)
     and coalesce(current_setting('app.corregir_origen', true), '') <> 'on' then
    raise exception 'El origen del cliente define la comisión y no se cambia; pide la corrección a administración' using errcode = '42501';
  end if;
  new.atribucion_usuario_id := old.atribucion_usuario_id;
  new.created_by := old.created_by;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.clientes_tomar(p_id uuid, p_version int) returns public.clients
language plpgsql security definer set search_path = public as $$
declare c clients;
begin
  select * into c from clients where id = p_id for update;
  if not found or not public.tiene_permiso('clientes.editar') or not public.cliente_en_alcance(p_id) then
    raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  if p_version is not null and c.version <> p_version then
    raise exception 'Otra persona modificó este cliente. Revisa los datos actualizados y vuelve a intentarlo.';
  end if;
  return c;
end $$;

create or replace function public.clientes_datos(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_nombre text := trim(coalesce(p ->> 'nombre', ''));
  v_tel text := trim(coalesce(p ->> 'telefono', ''));
  v_email text := lower(trim(coalesce(p ->> 'email', '')));
  v_origen text := p ->> 'origen';
  v_detalle text := trim(coalesce(p ->> 'origen_detalle', ''));
  v_pres numeric := nullif(p ->> 'presupuesto', '')::numeric;
  v_unidades text[] := array(select distinct jsonb_array_elements_text(coalesce(p -> 'unidades_interes', '[]'::jsonb)));
begin
  if char_length(v_nombre) < 3 then raise exception 'Ingresa el nombre del cliente'; end if;
  if v_tel = '' and v_email = '' then raise exception 'Ingresa al menos un teléfono o un correo'; end if;
  if v_tel <> '' and v_tel !~ '^[+0-9][0-9 -]{6,19}$' then raise exception 'El teléfono no es válido'; end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'El correo no es válido'; end if;
  if v_origen is null or v_origen not in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita') then raise exception 'Origen no válido'; end if;
  if v_origen in ('referido', 'corredor') and v_detalle = '' then raise exception 'Indica quién refirió al cliente o qué corredor lo trajo'; end if;
  if v_pres is not null and v_pres <= 0 then raise exception 'El presupuesto debe ser un valor positivo'; end if;
  if exists (select 1 from unnest(v_unidades) x where not exists (select 1 from inventory_units u where u.codigo = x)) then
    raise exception 'Hay departamentos de interés que no existen en el inventario';
  end if;
  return jsonb_build_object('nombre', v_nombre, 'documento', trim(coalesce(p ->> 'documento', '')), 'telefono', v_tel, 'email', v_email, 'origen', v_origen, 'origen_detalle', v_detalle,
    'unidades_interes', to_jsonb(v_unidades), 'presupuesto', v_pres, 'proposito', nullif(p ->> 'proposito', ''), 'forma_pago', nullif(p ->> 'forma_pago', ''));
end $$;

create or replace function public.clientes_corredor_valido(p_corredor uuid, p_origen text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_corredor is null then return; end if;
  if p_origen <> 'corredor' then raise exception 'El corredor de origen solo aplica cuando el origen es Corredor'; end if;
  if not exists (select 1 from profiles where id = p_corredor and estado = 'activo' and rol_id = 'corredor') then raise exception 'El corredor de origen debe ser un corredor activo'; end if;
  if p_corredor <> auth.uid() and not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para indicar a otro corredor' using errcode = '42501'; end if;
end $$;

create or replace function public.clientes_crear(p_id uuid, p_datos jsonb, p_asesor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid := coalesce(p_id, gen_random_uuid()); v_corredor uuid := nullif(p_datos ->> 'corredor_origen_id', '')::uuid;
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para registrar clientes' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_asesor);
  d := public.clientes_datos(p_datos);
  -- El corredor que registra a su propio cliente queda como corredor de origen.
  if v_corredor is null and d ->> 'origen' = 'corredor' and exists (select 1 from profiles where id = auth.uid() and rol_id = 'corredor') then v_corredor := auth.uid(); end if;
  perform public.clientes_corredor_valido(v_corredor, d ->> 'origen');
  insert into clients (id, nombre, documento, telefono, email, origen, origen_detalle, corredor_origen_id, unidades_interes, presupuesto, proposito, forma_pago, asesor_id, created_by)
  values (v_id, d ->> 'nombre', d ->> 'documento', d ->> 'telefono', d ->> 'email', d ->> 'origen', d ->> 'origen_detalle', v_corredor,
          array(select jsonb_array_elements_text(d -> 'unidades_interes')), (d ->> 'presupuesto')::numeric, d ->> 'proposito', d ->> 'forma_pago', p_asesor, auth.uid());
  perform public.clientes_nota(v_id, 'nota', 'Cliente registrado · origen ' || (d ->> 'origen'));
  return v_id;
end $$;

create or replace function public.clientes_editar(p_id uuid, p_version int, p_datos jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c clients; d jsonb; v_unidades text[]; v_nuevas text; v_version int;
begin
  c := public.clientes_tomar(p_id, p_version);
  d := public.clientes_datos(p_datos);
  v_unidades := array(select jsonb_array_elements_text(d -> 'unidades_interes'));
  select string_agg(x, ', ') into v_nuevas from unnest(v_unidades) x where not x = any (c.unidades_interes);
  update clients set nombre = d ->> 'nombre', documento = d ->> 'documento', telefono = d ->> 'telefono', email = d ->> 'email', origen = d ->> 'origen', origen_detalle = d ->> 'origen_detalle',
    unidades_interes = v_unidades, presupuesto = (d ->> 'presupuesto')::numeric, proposito = d ->> 'proposito', forma_pago = d ->> 'forma_pago'
  where id = p_id returning version into v_version;
  if v_nuevas is not null then perform public.clientes_nota(p_id, 'nota', 'Interés en ' || v_nuevas); end if;
  return v_version;
end $$;

-- La reasignación ahora admite conservar el acceso del asesor anterior: cambia su firma.
drop function if exists public.clientes_asignar(uuid, int, uuid, text);
create or replace function public.clientes_asignar(p_id uuid, p_version int, p_asesor uuid, p_motivo text, p_mantener_acceso boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c clients; v_m text := public.clientes_motivo(p_motivo); v_version int; v_antes text; v_nuevo text;
begin
  c := public.clientes_tomar(p_id, p_version);
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para reasignar clientes' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_asesor);
  if c.asesor_id = p_asesor then return c.version; end if;
  select nombre into v_antes from profiles where id = c.asesor_id;
  select nombre into v_nuevo from profiles where id = p_asesor;
  perform set_config('app.motivo', v_m, true);
  update clients set asesor_id = p_asesor where id = p_id returning version into v_version;
  update opportunities set responsable_id = p_asesor where client_id = p_id and responsable_id = c.asesor_id and etapa <> 'perdida';
  perform set_config('app.motivo', '', true);
  if p_mantener_acceso then
    insert into client_access (client_id, usuario_id, motivo) values (p_id, c.asesor_id, v_m)
    on conflict (client_id, usuario_id) do update set motivo = excluded.motivo, otorgado_por = auth.uid(), otorgado_en = now(), revocado_por = null, revocado_en = null;
  end if;
  perform public.clientes_nota(p_id, 'nota', 'Asesor reasignado: ' || coalesce(v_antes, 'sin nombre') || ' → ' || coalesce(v_nuevo, 'sin nombre') || ' · motivo: ' || v_m);
  return v_version;
end $$;

create or replace function public.clientes_autorizar_acceso(p_client uuid, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo);
begin
  perform public.clientes_tomar(p_client, null);
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para autorizar accesos' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_usuario and estado = 'activo') then raise exception 'La persona debe ser un usuario activo'; end if;
  insert into client_access (client_id, usuario_id, motivo) values (p_client, p_usuario, v_m)
  on conflict (client_id, usuario_id) do update set motivo = excluded.motivo, otorgado_por = auth.uid(), otorgado_en = now(), revocado_por = null, revocado_en = null;
  perform public.auditar('Autorizar acceso a cliente', 'cliente', p_client::text, v_m, null, jsonb_build_object('usuario_id', p_usuario));
end $$;

create or replace function public.clientes_revocar_acceso(p_client uuid, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo);
begin
  perform public.clientes_tomar(p_client, null);
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para revocar accesos' using errcode = '42501'; end if;
  update client_access set revocado_por = auth.uid(), revocado_en = now() where client_id = p_client and usuario_id = p_usuario and revocado_en is null;
  perform public.auditar('Revocar acceso a cliente', 'cliente', p_client::text, v_m, jsonb_build_object('usuario_id', p_usuario), null);
end $$;

create or replace function public.clientes_corregir_origen(p_id uuid, p_version int, p_origen text, p_detalle text, p_corredor uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare c clients; v_m text := public.clientes_motivo(p_motivo); v_version int;
begin
  if not public.tiene_permiso('corredores.gestionar') then raise exception 'Sin permiso para corregir el origen' using errcode = '42501'; end if;
  c := public.clientes_tomar(p_id, p_version);
  if p_origen not in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita') then raise exception 'Origen no válido'; end if;
  perform public.clientes_corredor_valido(p_corredor, p_origen);
  perform set_config('app.corregir_origen', 'on', true);
  update clients set origen = p_origen, origen_detalle = trim(coalesce(p_detalle, '')), corredor_origen_id = p_corredor where id = p_id returning version into v_version;
  perform set_config('app.corregir_origen', '', true);
  perform public.auditar('Corregir origen de cliente', 'cliente', p_id::text, v_m,
    jsonb_build_object('origen', c.origen, 'origen_detalle', c.origen_detalle, 'corredor_origen_id', c.corredor_origen_id),
    jsonb_build_object('origen', p_origen, 'origen_detalle', trim(coalesce(p_detalle, '')), 'corredor_origen_id', p_corredor));
  perform public.clientes_nota(p_id, 'nota', 'Origen corregido · motivo: ' || v_m);
  return v_version;
end $$;

create or replace function public.clientes_personas() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  with visibles as (
    select c.id, c.asesor_id, c.created_by, c.atribucion_usuario_id, c.corredor_origen_id from clients c
    where public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(c.id)
  ), ids as (
    select asesor_id as u from visibles
    union select created_by from visibles
    union select atribucion_usuario_id from visibles
    union select corredor_origen_id from visibles
    union select a.usuario_id from client_access a join visibles v on v.id = a.client_id
    union select a.user_id from client_activities a join visibles v on v.id = a.client_id
    union select o.responsable_id from opportunities o join visibles v on v.id = o.client_id
  )
  select p.id, p.nombre from profiles p join ids on ids.u = p.id
$$;

create or replace function public.clientes_corredores() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre from profiles p
  where public.tiene_permiso('clientes.editar') and p.estado = 'activo' and p.rol_id = 'corredor' order by p.nombre
$$;

create or replace function public.clientes_importacion_habilitada() returns boolean
language sql stable security definer set search_path = public as $$
  select habilitada or public.tiene_permiso('config.usuarios') from client_import_settings where id = 1
$$;

create or replace function public.clientes_importacion_definir(p_habilitada boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Solo administración define la importación' using errcode = '42501'; end if;
  update client_import_settings set habilitada = p_habilitada, definida_por = auth.uid(), definida_en = now() where id = 1;
  perform public.auditar('Definir importación de clientes', 'cliente', 'importacion', v_m, null, jsonb_build_object('habilitada', p_habilitada));
end $$;

create or replace function public.clientes_importar_revisar(p_filas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb; v_res jsonb := '[]'::jsonb; v_id uuid; v_dup clients; v_tel text; v_email text; v_estado text; v_detalle text; v_actividades int;
  v_tels text[] := '{}'; v_emails text[] := '{}';
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para importar clientes' using errcode = '42501'; end if;
  if not public.clientes_importacion_habilitada() then raise exception 'La importación está cerrada; pide a administración que la recupere' using errcode = '42501'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_tel := right(regexp_replace(coalesce(f ->> 'telefono', ''), '\D', '', 'g'), 9);
    v_email := lower(trim(coalesce(f ->> 'email', '')));
    v_estado := 'nuevo'; v_detalle := ''; v_actividades := 0; v_dup := null;
    select client_id into v_id from client_imports where origen_id = f ->> 'origen_id';
    if found then
      v_estado := 'ya_importado';
      select count(*)::int into v_actividades from client_activities where client_id = v_id;
    else
      select * into v_dup from clients c where (v_tel <> '' and c.telefono <> '' and right(regexp_replace(c.telefono, '\D', '', 'g'), 9) = v_tel)
        or (v_email <> '' and lower(c.email) = v_email) limit 1;
      if v_dup.id is not null then
        if public.cliente_en_alcance(v_dup.id) then
          v_estado := 'duplicado'; v_detalle := 'Ya existe: ' || v_dup.nombre;
        else
          v_estado := 'duplicado'; v_detalle := 'Ya está registrado por otro equipo';
        end if;
      elsif (v_tel <> '' and v_tel = any (v_tels)) or (v_email <> '' and v_email = any (v_emails)) then
        v_estado := 'duplicado'; v_detalle := 'Repetido en los datos de este navegador';
      end if;
    end if;
    if v_tel <> '' then v_tels := v_tels || v_tel; end if;
    if v_email <> '' then v_emails := v_emails || v_email; end if;
    v_res := v_res || jsonb_build_object('origen_id', f ->> 'origen_id', 'estado', v_estado, 'detalle', v_detalle, 'client_id', v_id, 'actividades', v_actividades);
    v_id := null;
  end loop;
  return v_res;
end $$;

create or replace function public.clientes_importar(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb; a jsonb; d jsonb; v_res jsonb := '[]'::jsonb; v_id uuid; v_asesor uuid; v_etapa etapa_cliente; v_nota text; v_creado timestamptz;
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para importar clientes' using errcode = '42501'; end if;
  if not public.clientes_importacion_habilitada() then raise exception 'La importación está cerrada; pide a administración que la recupere' using errcode = '42501'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    select client_id into v_id from client_imports where origen_id = f ->> 'origen_id';
    if found then
      v_res := v_res || jsonb_build_object('origen_id', f ->> 'origen_id', 'estado', 'ya_importado', 'client_id', v_id, 'detalle', '');
      continue;
    end if;
    begin
      -- Solo se admiten departamentos que existan: uno ya retirado del inventario no bloquea la importación del cliente.
      d := public.clientes_datos(jsonb_set(f, '{unidades_interes}', to_jsonb(array(
        select x from jsonb_array_elements_text(coalesce(f -> 'unidades_interes', '[]'::jsonb)) x where exists (select 1 from inventory_units u where u.codigo = x)))));
      v_asesor := case when coalesce(f ->> 'asesor_id', '') ~ '^[0-9a-fA-F-]{36}$' then (f ->> 'asesor_id')::uuid end;
      if v_asesor is null or not exists (select 1 from profiles where id = v_asesor and estado = 'activo')
         or (v_asesor <> auth.uid() and not (public.tiene_permiso('clientes.asignar') and public.en_alcance(v_asesor))) then
        v_asesor := auth.uid();
      end if;
      -- La reserva no se importa: solo la confirma el flujo de Reservas.
      v_etapa := (f ->> 'etapa')::etapa_cliente;
      v_nota := 'Importado desde el navegador';
      if v_etapa = 'reserva' then
        v_etapa := 'negociacion';
        v_nota := v_nota || ' · estaba en Reserva local: confírmala en el módulo Reservas';
      end if;
      v_creado := coalesce(nullif(f ->> 'creado_en', '')::timestamptz, now());
      insert into clients (nombre, documento, telefono, email, origen, origen_detalle, unidades_interes, presupuesto, proposito, forma_pago, asesor_id, etapa, motivo_perdida,
                           fecha_retomar, proxima_tipo, proxima_descripcion, proxima_fecha, created_by, created_at)
      values (d ->> 'nombre', d ->> 'documento', d ->> 'telefono', d ->> 'email', d ->> 'origen', d ->> 'origen_detalle', array(select jsonb_array_elements_text(d -> 'unidades_interes')),
              (d ->> 'presupuesto')::numeric, d ->> 'proposito', d ->> 'forma_pago', v_asesor, v_etapa, coalesce(f ->> 'motivo_perdida', ''),
              nullif(f ->> 'fecha_retomar', '')::date, nullif(f ->> 'proxima_tipo', ''), nullif(f ->> 'proxima_descripcion', ''), nullif(f ->> 'proxima_fecha', '')::date,
              auth.uid(), v_creado)
      returning id into v_id;
      for a in select * from jsonb_array_elements(coalesce(f -> 'actividades', '[]'::jsonb)) loop
        insert into client_activities (client_id, tipo, fecha, descripcion, user_id, referencia)
        values (v_id, a ->> 'tipo', (a ->> 'fecha')::date,
                (a ->> 'descripcion') || case when coalesce(a ->> 'usuario', '') <> '' then ' (registró: ' || (a ->> 'usuario') || ')' else '' end,
                auth.uid(), nullif(a ->> 'referencia', ''));
      end loop;
      perform public.clientes_nota(v_id, 'nota', v_nota);
      insert into client_imports (origen_id, client_id, datos) values (f ->> 'origen_id', v_id, f);
      perform public.auditar('Importar cliente', 'cliente', v_id::text, 'Importación desde el navegador', null, jsonb_build_object('origen_id', f ->> 'origen_id', 'etapa', v_etapa));
      v_res := v_res || jsonb_build_object('origen_id', f ->> 'origen_id', 'estado', 'importado', 'client_id', v_id, 'detalle', '');
    exception
      when unique_violation then
        v_res := v_res || jsonb_build_object('origen_id', f ->> 'origen_id', 'estado', 'duplicado', 'client_id', null, 'detalle', 'Ya existe un cliente con ese teléfono o correo');
      when others then
        v_res := v_res || jsonb_build_object('origen_id', f ->> 'origen_id', 'estado', 'error', 'client_id', null, 'detalle', sqlerrm);
    end;
  end loop;
  return v_res;
end $$;


/* ------------------------------------------ origen comercial en la venta */

-- El contrato conserva también el detalle del origen. Solo afecta a contratos nuevos: los existentes no se tocan.
create or replace function public.contrato_datos_venta() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients; v_responsable uuid;
begin
  select * into c from clients where id = new.client_id;
  select responsable_id into v_responsable from opportunities where id = new.opportunity_id;
  new.asesor_id := c.asesor_id;
  new.responsable_id := coalesce(v_responsable, c.asesor_id);
  new.atribucion_usuario_id := c.atribucion_usuario_id;
  new.corredor_origen_id := c.corredor_origen_id;
  new.origen := c.origen;
  new.origen_detalle := c.origen_detalle;
  return new;
end $$;


/* ------------------------------------------------------------- políticas */

drop policy if exists "ver clientes" on public.clients;
create policy "ver clientes" on public.clients for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(id));
drop policy if exists "editar clientes" on public.clients;
create policy "editar clientes" on public.clients for update to authenticated
  using (public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(id))
  with check (false);
drop policy if exists "ver oportunidades" on public.opportunities;
create policy "ver oportunidades" on public.opportunities for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id));
drop policy if exists "editar oportunidades" on public.opportunities;
create policy "editar oportunidades" on public.opportunities for update to authenticated
  using (public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(client_id))
  with check (false);

/* -------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.clientes_asignar(uuid, int, uuid, text, boolean)', 'public.clientes_autorizar_acceso(uuid, uuid, text)', 'public.clientes_revocar_acceso(uuid, uuid, text)',
    'public.clientes_corregir_origen(uuid, int, text, text, uuid, text)', 'public.clientes_corredores()', 'public.clientes_importacion_habilitada()', 'public.clientes_importacion_definir(boolean, text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  execute 'revoke all on function public.clientes_corredor_valido(uuid, text) from public, anon, authenticated';
end $$;

commit;
