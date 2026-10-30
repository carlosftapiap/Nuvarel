-- AMURA · Clientes conectado a la base de datos.
-- clients.etapa es el seguimiento comercial general. opportunities son negociaciones concretas por cliente y unidad o tipología.
-- Toda escritura pasa por funciones con permiso, alcance, versión y motivo. Aditiva: no borra ni modifica datos existentes.

do $$ begin
  if to_regclass('public.opportunities') is null or to_regprocedure('public.cliente_en_alcance(uuid)') is null
     or to_regprocedure('public.reservas_anular(uuid, text)') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Falta el flujo comercial: ejecuta antes 20261029000000_flujo_comercial.sql y 20261029010000_conexion_app.sql';
  end if;
end $$;

-- Reemplaza un fragmento exacto de una función existente; si ya se aplicó no hace nada y si no lo encuentra se detiene.
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

/* --------------------------------------------------------- columnas nuevas */

alter table public.clients add column if not exists version int not null default 1;
alter table public.client_activities add column if not exists referencia text;
alter table public.opportunities add column if not exists tipologia text;
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

-- Importación desde el navegador: una fila por registro local, para que repetirla no duplique.
create table if not exists public.client_imports (
  origen_id text primary key,
  client_id uuid not null references public.clients (id),
  importado_por uuid not null default auth.uid() references auth.users (id),
  importado_en timestamptz not null default now(),
  datos jsonb not null
);
alter table public.client_imports enable row level security;

/* --------------------------------------------------- alcance sobre un cliente */

-- Acceso operativo: el asesor actual, una negociación abierta a su cargo o una autorización expresa, según el alcance de cada usuario.
-- Registrar a un cliente no da acceso permanente: al reasignarlo, quien lo tenía deja de verlo; su atribución se conserva.
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
drop policy if exists "ver mis importaciones" on public.client_imports;
create policy "ver mis importaciones" on public.client_imports for select to authenticated using (importado_por = auth.uid());

/* ----------------------------------------------------------- disparadores */

-- La reasignación registra el motivo que indicó la función; la atribución y el creador no cambian.
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

create or replace function public.oportunidad_proteger_etapa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa then
    if not public.en_flujo() and (new.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')
                                   or old.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')) then
      raise exception 'Esta etapa la determina el flujo de reservas, contratos y cobranzas' using errcode = '42501';
    end if;
    insert into opportunity_events (opportunity_id, etapa, descripcion, user_id)
    values (new.id, new.etapa, old.etapa || ' → ' || new.etapa, coalesce(auth.uid(), new.responsable_id));
  end if;
  if new.responsable_id is distinct from old.responsable_id then
    if not (public.tiene_permiso('clientes.asignar') and public.en_alcance(new.responsable_id)) then
      raise exception 'Sin permiso para reasignar la oportunidad' using errcode = '42501';
    end if;
    perform public.auditar('Reasignar oportunidad', 'oportunidad', new.id::text,
      coalesce(nullif(current_setting('app.motivo', true), ''), 'Reasignación de responsable'),
      jsonb_build_object('responsable_id', old.responsable_id), jsonb_build_object('responsable_id', new.responsable_id));
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Al llegar una negociación a Cotización, el cliente avanza solo si estaba antes. Nunca retrocede ni pisa Negociación, Reserva o Perdido.
create or replace function public.oportunidad_avanza_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients;
begin
  if new.etapa <> 'cotizacion' or (tg_op = 'UPDATE' and old.etapa = new.etapa) then return new; end if;
  select * into c from clients where id = new.client_id for update;
  if c.etapa not in ('nuevo', 'contactado', 'calificado', 'visita', 'seguimiento') then return new; end if;
  update clients set etapa = 'cotizacion', fecha_retomar = null where id = c.id;
  insert into client_activities (client_id, tipo, fecha, descripcion, user_id)
  values (c.id, 'etapa', (now() at time zone 'America/Guayaquil')::date,
          public.clientes_etiqueta(c.etapa) || ' → Cotización · cotización emitida', coalesce(auth.uid(), new.responsable_id));
  return new;
end $$;

create or replace function public.clientes_etiqueta(p_etapa public.etapa_cliente) returns text
language sql immutable as $$
  select case p_etapa when 'nuevo' then 'Nuevo' when 'contactado' then 'Contactado' when 'calificado' then 'Calificado' when 'visita' then 'Visita'
    when 'cotizacion' then 'Cotización' when 'negociacion' then 'Negociación' when 'reserva' then 'Reserva' when 'perdido' then 'Perdido'
    when 'seguimiento' then 'Seguimiento futuro' end
$$;

drop trigger if exists oportunidad_avanza_cliente on public.opportunities;
create trigger oportunidad_avanza_cliente after insert or update of etapa on public.opportunities for each row execute function public.oportunidad_avanza_cliente();

-- Anular una reserva no retrocede al cliente si todavía tiene otra reserva confirmada.
select pg_temp.parchar('public.reservas_anular(uuid, text)',
  'update clients set etapa = ''negociacion'' where id = r.client_id and etapa = ''reserva'';',
  'update clients set etapa = ''negociacion'' where id = r.client_id and etapa = ''reserva''
      and not exists (select 1 from reservations x where x.client_id = r.client_id and x.id <> r.id and x.estado = ''confirmada'');');

/* ---------------------------------------------------- funciones auxiliares */

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

create or replace function public.clientes_motivo(p_motivo text) returns text
language plpgsql immutable as $$
begin
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo (mínimo 5 caracteres)'; end if;
  return trim(p_motivo);
end $$;

create or replace function public.clientes_nota(p_client uuid, p_tipo text, p_descripcion text) returns void
language sql security definer set search_path = public as $$
  insert into client_activities (client_id, tipo, fecha, descripcion, user_id)
  values (p_client, p_tipo, (now() at time zone 'America/Guayaquil')::date, p_descripcion, auth.uid())
$$;

-- Lee y valida los datos de la ficha. Lo que se escribe es lo que devuelve esta función.
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

create or replace function public.clientes_responsable_valido(p_usuario uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_usuario and estado = 'activo') then raise exception 'El responsable debe ser un usuario activo'; end if;
  if p_usuario <> auth.uid() and not (public.tiene_permiso('clientes.asignar') and public.en_alcance(p_usuario)) then
    raise exception 'Sin permiso para asignar a esa persona' using errcode = '42501';
  end if;
end $$;

-- Un corredor de origen debe ser un usuario corredor activo; un corredor solo puede indicarse a sí mismo.
create or replace function public.clientes_corredor_valido(p_corredor uuid, p_origen text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_corredor is null then return; end if;
  if p_origen <> 'corredor' then raise exception 'El corredor de origen solo aplica cuando el origen es Corredor'; end if;
  if not exists (select 1 from profiles where id = p_corredor and estado = 'activo' and rol_id = 'corredor') then raise exception 'El corredor de origen debe ser un corredor activo'; end if;
  if p_corredor <> auth.uid() and not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para indicar a otro corredor' using errcode = '42501'; end if;
end $$;

/* ------------------------------------------------------------------ clientes */

-- p_id lo genera la app: permite abrir la ficha recién creada sin esperar una segunda lectura.
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

-- Reasignar cambia el asesor actual y le pasa las negociaciones abiertas que tenía el anterior, que pierde el acceso salvo autorización expresa.
-- Las negociaciones transferidas a otra persona no se mueven. La atribución y el corredor de origen no cambian.
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

-- La etapa Reserva solo la mueve el flujo de Reservas. Con una negociación en flujo no se puede retroceder ni dar por perdido al cliente.
create or replace function public.clientes_mover_etapa(p_id uuid, p_version int, p_etapa text, p_motivo text, p_fecha_retomar date) returns int
language plpgsql security definer set search_path = public as $$
declare
  c clients; v_etapa etapa_cliente; v_version int; v_detalle text := '';
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_en_flujo boolean;
begin
  c := public.clientes_tomar(p_id, p_version);
  begin
    v_etapa := p_etapa::etapa_cliente;
  exception when invalid_text_representation then
    raise exception 'Etapa no válida';
  end;
  if c.etapa = v_etapa then return c.version; end if;
  if v_etapa = 'reserva' or c.etapa = 'reserva' then
    raise exception 'La etapa Reserva solo cambia al aprobar o anular una reserva en el módulo Reservas' using errcode = '42501';
  end if;
  v_en_flujo := exists (select 1 from opportunities o where o.client_id = p_id and o.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega', 'posventa'))
             or exists (select 1 from reservations r where r.client_id = p_id and r.estado in ('solicitada', 'pago_verificado', 'confirmada'));
  if v_en_flujo and v_etapa not in ('cotizacion', 'negociacion') then
    raise exception 'El cliente tiene una reserva o contrato en curso; resuélvelo antes de cambiar a %', public.clientes_etiqueta(v_etapa);
  end if;
  if v_etapa in ('cotizacion', 'negociacion') and cardinality(c.unidades_interes) = 0
     and not exists (select 1 from opportunities o where o.client_id = p_id and o.etapa <> 'perdida') then
    raise exception 'Para pasar a % registra primero el departamento de interés', public.clientes_etiqueta(v_etapa);
  end if;
  if v_etapa = 'perdido' then
    if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo por el que se perdió el cliente'; end if;
    v_detalle := ' · motivo: ' || trim(p_motivo);
    -- Sus negociaciones sin reserva también se cierran, para no dejar estados contradictorios.
    update opportunities set etapa = 'perdida', motivo_perdida = trim(p_motivo) where client_id = p_id and etapa in ('captacion', 'calificacion', 'visita', 'cotizacion');
  end if;
  if v_etapa = 'seguimiento' then
    if p_fecha_retomar is null or p_fecha_retomar <= v_hoy then raise exception 'Indica una fecha futura para retomar el contacto'; end if;
    v_detalle := ' · retomar el ' || to_char(p_fecha_retomar, 'DD/MM/YYYY');
  end if;
  update clients set etapa = v_etapa,
    motivo_perdida = case when v_etapa = 'perdido' then trim(p_motivo) else '' end,
    fecha_retomar = case when v_etapa = 'seguimiento' then p_fecha_retomar end,
    proxima_tipo = case v_etapa when 'perdido' then null when 'seguimiento' then 'llamada' else proxima_tipo end,
    proxima_descripcion = case v_etapa when 'perdido' then null when 'seguimiento' then 'Retomar contacto' else proxima_descripcion end,
    proxima_fecha = case v_etapa when 'perdido' then null when 'seguimiento' then p_fecha_retomar else proxima_fecha end
  where id = p_id returning version into v_version;
  perform public.clientes_nota(p_id, 'etapa', public.clientes_etiqueta(c.etapa) || ' → ' || public.clientes_etiqueta(v_etapa) || v_detalle);
  return v_version;
end $$;

-- p_id lo genera la app: repetir la llamada no duplica la actividad.
create or replace function public.clientes_registrar_actividad(p_id uuid, p_client uuid, p_tipo text, p_fecha date, p_descripcion text, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.clientes_tomar(p_client, null);
  if p_tipo not in ('llamada', 'mensaje', 'visita', 'nota', 'cotizacion') then raise exception 'Tipo de actividad no válido'; end if;
  if char_length(trim(coalesce(p_descripcion, ''))) < 3 then raise exception 'Describe la actividad'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de una actividad realizada no puede ser futura'; end if;
  insert into client_activities (id, client_id, tipo, fecha, descripcion, user_id, referencia)
  values (coalesce(p_id, gen_random_uuid()), p_client, p_tipo, p_fecha, trim(p_descripcion), auth.uid(), nullif(trim(coalesce(p_referencia, '')), ''))
  on conflict (id) do nothing;
end $$;

create or replace function public.clientes_programar_proxima(p_id uuid, p_version int, p_tipo text, p_descripcion text, p_fecha date) returns int
language plpgsql security definer set search_path = public as $$
declare c clients; v_version int;
begin
  c := public.clientes_tomar(p_id, p_version);
  if p_tipo is not null then
    if c.etapa = 'perdido' then raise exception 'Un cliente perdido no tiene próximas actividades; muévelo de etapa primero'; end if;
    if p_tipo not in ('llamada', 'mensaje', 'visita', 'nota') then raise exception 'Tipo de actividad no válido'; end if;
    if char_length(trim(coalesce(p_descripcion, ''))) < 3 then raise exception 'Describe la próxima actividad'; end if;
    if p_fecha is null then raise exception 'Indica la fecha de la próxima actividad'; end if;
  end if;
  update clients set proxima_tipo = p_tipo, proxima_descripcion = case when p_tipo is null then null else trim(p_descripcion) end,
    proxima_fecha = case when p_tipo is null then null else p_fecha end
  where id = p_id returning version into v_version;
  return v_version;
end $$;

-- Autorización expresa de acceso a un cliente para quien no lo tiene asignado.
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

-- Corrección autorizada del origen (disputas de atribución): queda auditada con el valor anterior y el nuevo.
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

/* --------------------------------------------------------------- negociaciones */

-- Una negociación por cliente y unidad (o tipología). Si ya está abierta devuelve la misma, sin duplicar.
create or replace function public.oportunidades_crear(p_client uuid, p_unidad text, p_tipologia text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c clients; v_id uuid; v_unidad text := nullif(trim(coalesce(p_unidad, '')), ''); v_tipologia text := nullif(trim(coalesce(p_tipologia, '')), '');
begin
  c := public.clientes_tomar(p_client, null);
  if (v_unidad is null) = (v_tipologia is null) then raise exception 'Indica una unidad o una tipología'; end if;
  if c.etapa = 'perdido' then raise exception 'El cliente está marcado como perdido; muévelo de etapa antes de abrir una negociación'; end if;
  if v_unidad is not null and not exists (select 1 from inventory_units u where u.codigo = v_unidad) then raise exception 'La unidad no existe'; end if;
  if v_tipologia is not null and not exists (select 1 from inventory_units u where u.tipologia::text = v_tipologia) then raise exception 'La tipología no existe'; end if;
  select id into v_id from opportunities o where o.client_id = p_client and o.etapa <> 'perdida'
    and ((v_unidad is not null and o.codigo_unidad = v_unidad) or (v_tipologia is not null and o.codigo_unidad is null and o.tipologia = v_tipologia));
  if found then return v_id; end if;
  insert into opportunities (client_id, codigo_unidad, tipologia, responsable_id, created_by)
  values (p_client, v_unidad, v_tipologia, c.asesor_id, auth.uid()) returning id into v_id;
  if v_unidad is not null and not v_unidad = any (c.unidades_interes) then
    update clients set unidades_interes = unidades_interes || v_unidad where id = p_client;
  end if;
  perform public.clientes_nota(p_client, 'nota', 'Negociación abierta: ' || coalesce(v_unidad, 'tipología ' || v_tipologia));
  return v_id;
end $$;

create or replace function public.oportunidades_tomar(p_id uuid) returns public.opportunities
language plpgsql security definer set search_path = public as $$
declare o opportunities;
begin
  select * into o from opportunities where id = p_id for update;
  if not found or not public.tiene_permiso('clientes.editar') or not (public.en_alcance(o.responsable_id) or public.cliente_en_alcance(o.client_id)) then
    raise exception 'Negociación inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  return o;
end $$;

-- Define la unidad de una negociación abierta por tipología.
create or replace function public.oportunidades_vincular_unidad(p_id uuid, p_unidad text) returns void
language plpgsql security definer set search_path = public as $$
declare o opportunities := public.oportunidades_tomar(p_id);
begin
  if o.codigo_unidad is not null then raise exception 'La negociación ya tiene una unidad'; end if;
  if not exists (select 1 from inventory_units u where u.codigo = p_unidad) then raise exception 'La unidad no existe'; end if;
  if exists (select 1 from opportunities x where x.client_id = o.client_id and x.id <> p_id and x.etapa <> 'perdida' and x.codigo_unidad = p_unidad) then
    raise exception 'El cliente ya tiene una negociación abierta por esa unidad';
  end if;
  update opportunities set codigo_unidad = p_unidad where id = p_id;
  update clients set unidades_interes = unidades_interes || p_unidad where id = o.client_id and not p_unidad = any (unidades_interes);
  perform public.clientes_nota(o.client_id, 'nota', 'Negociación vinculada a ' || p_unidad);
end $$;

-- Transferencia autorizada: el responsable de una negociación puede ser distinto del asesor principal.
create or replace function public.oportunidades_transferir(p_id uuid, p_responsable uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare o opportunities := public.oportunidades_tomar(p_id); v_m text := public.clientes_motivo(p_motivo); v_antes text; v_nuevo text;
begin
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para transferir negociaciones' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_responsable);
  if o.responsable_id = p_responsable then return; end if;
  select nombre into v_antes from profiles where id = o.responsable_id;
  select nombre into v_nuevo from profiles where id = p_responsable;
  perform set_config('app.motivo', v_m, true);
  update opportunities set responsable_id = p_responsable where id = p_id;
  perform set_config('app.motivo', '', true);
  perform public.clientes_nota(o.client_id, 'nota', 'Negociación ' || coalesce(o.codigo_unidad, o.tipologia, '') || ' transferida: ' || coalesce(v_antes, 'sin nombre') || ' → ' || coalesce(v_nuevo, 'sin nombre') || ' · motivo: ' || v_m);
end $$;

-- Cierra una negociación sin reserva. El cliente conserva su etapa y sus demás negociaciones.
create or replace function public.oportunidades_cerrar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare o opportunities := public.oportunidades_tomar(p_id); v_m text := public.clientes_motivo(p_motivo);
begin
  if o.etapa = 'perdida' then return; end if;
  if o.etapa not in ('captacion', 'calificacion', 'visita', 'cotizacion') then raise exception 'La negociación tiene una reserva o contrato en curso; no se puede cerrar aquí'; end if;
  update opportunities set etapa = 'perdida', motivo_perdida = v_m where id = p_id;
  perform public.clientes_nota(o.client_id, 'nota', 'Negociación ' || coalesce(o.codigo_unidad, o.tipologia, '') || ' cerrada · motivo: ' || v_m);
end $$;

/* ------------------------------------------------------------------ lectura */

-- Nombres de las personas relacionadas con los clientes visibles: un corredor no puede leer los perfiles de otros usuarios.
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

-- Corredores registrados, para indicar el origen de un cliente sin escribir el nombre.
create or replace function public.clientes_corredores() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre from profiles p
  where public.tiene_permiso('clientes.editar') and p.estado = 'activo' and p.rol_id = 'corredor' order by p.nombre
$$;

/* -------------------------------------------- importación desde el navegador */

create or replace function public.clientes_importacion_habilitada() returns boolean
language sql stable security definer set search_path = public as $$
  select habilitada or public.tiene_permiso('config.usuarios') from client_import_settings where id = 1
$$;

-- Al terminar la migración, administración cierra la importación ordinaria y conserva la recuperación.
create or replace function public.clientes_importacion_definir(p_habilitada boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Solo administración define la importación' using errcode = '42501'; end if;
  update client_import_settings set habilitada = p_habilitada, definida_por = auth.uid(), definida_en = now() where id = 1;
  perform public.auditar('Definir importación de clientes', 'cliente', 'importacion', v_m, null, jsonb_build_object('habilitada', p_habilitada));
end $$;

-- Solo informa. No revela datos de clientes fuera del alcance de quien consulta.
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

-- Cada fila va en su propia subtransacción: una con problemas no impide las demás. Repetir la importación no duplica.
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

/* --------------------------------------------- escritura solo por funciones */

-- Quien tiene alcance puede leer, pero nadie escribe directo en estas tablas: las funciones anteriores son el único camino.
-- La política de actualización se conserva con with check (false) para que el intento falle con un error en lugar de ignorarse.
drop policy if exists "ver clientes" on public.clients;
create policy "ver clientes" on public.clients for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(id));
drop policy if exists "crear clientes" on public.clients;
drop policy if exists "editar clientes" on public.clients;
create policy "editar clientes" on public.clients for update to authenticated
  using (public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(id))
  with check (false);
drop policy if exists "registrar actividades" on public.client_activities;
drop policy if exists "crear oportunidades" on public.opportunities;
drop policy if exists "ver oportunidades" on public.opportunities;
create policy "ver oportunidades" on public.opportunities for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id));
drop policy if exists "editar oportunidades" on public.opportunities;
create policy "editar oportunidades" on public.opportunities for update to authenticated
  using (public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(client_id))
  with check (false);
drop policy if exists "registrar eventos" on public.opportunity_events;

/* ------------------------------------------------------------------ permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.clientes_crear(uuid, jsonb, uuid)', 'public.clientes_editar(uuid, int, jsonb)', 'public.clientes_asignar(uuid, int, uuid, text, boolean)',
    'public.clientes_autorizar_acceso(uuid, uuid, text)', 'public.clientes_revocar_acceso(uuid, uuid, text)', 'public.clientes_corregir_origen(uuid, int, text, text, uuid, text)',
    'public.clientes_corredores()', 'public.clientes_importacion_habilitada()', 'public.clientes_importacion_definir(boolean, text)',
    'public.clientes_mover_etapa(uuid, int, text, text, date)', 'public.clientes_registrar_actividad(uuid, uuid, text, date, text, text)',
    'public.clientes_programar_proxima(uuid, int, text, text, date)', 'public.oportunidades_crear(uuid, text, text)',
    'public.oportunidades_vincular_unidad(uuid, text)', 'public.oportunidades_transferir(uuid, uuid, text)', 'public.oportunidades_cerrar(uuid, text)',
    'public.clientes_personas()', 'public.clientes_importar_revisar(jsonb)', 'public.clientes_importar(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'public.clientes_tomar(uuid, int)', 'public.oportunidades_tomar(uuid)', 'public.clientes_nota(uuid, text, text)', 'public.clientes_datos(jsonb)',
    'public.clientes_responsable_valido(uuid)', 'public.clientes_corredor_valido(uuid, text)', 'public.oportunidad_avanza_cliente()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
