-- AMURA · Corredores: perfiles comerciales que se administran desde la app, sin invitación por correo.
-- El acceso a la aplicación es opcional y separado: un corredor puede existir sin login y vincularse después a una cuenta
-- con rol Corredor. Desvincular el acceso no borra el perfil ni su historial de clientes y ventas.
-- Ejecutar después de 20261031000000_clientes_crm.sql (o su correctivo) y de 20261031020000_ventas_contratos.sql.

do $$ begin
  if to_regclass('public.clients') is null or to_regclass('public.contracts') is null or to_regprocedure('public.clientes_corredor_valido(uuid, text)') is null then
    raise exception 'Falta Clientes o Ventas y contratos: aplica antes el correctivo de Clientes y 20261031020000_ventas_contratos.sql';
  end if;
end $$;

/* ------------------------------------------------------------------- tabla */

create table if not exists public.corredores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) >= 3),
  documento text not null default '',
  licencia text not null default '',
  telefono text not null default '',
  email text not null default '',
  responsable_id uuid references public.profiles (id),
  usuario_id uuid unique references public.profiles (id),
  estado text not null default 'activo' check (estado in ('activo', 'inactivo')),
  creado_por uuid references auth.users (id) default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.corredores enable row level security;

-- Lectura: quien gestiona corredores, su responsable o el propio corredor con acceso. Sin políticas de escritura.
drop policy if exists "ver corredores" on public.corredores;
create policy "ver corredores" on public.corredores for select to authenticated
  using (public.tiene_permiso('corredores.ver') and (responsable_id is null or public.en_alcance(responsable_id) or usuario_id = auth.uid()));

-- Clientes y contratos apuntan a este perfil, no a una cuenta de acceso. Antes apuntaban a auth.users.
-- Se conservan los valores existentes creando el perfil con el mismo identificador, así no se pierde ninguna referencia.
insert into public.corredores (id, nombre, usuario_id, estado)
select p.id, p.nombre, p.id, case when p.estado = 'activo' then 'activo' else 'inactivo' end
from public.profiles p
where p.id in (select corredor_origen_id from public.clients where corredor_origen_id is not null
               union select corredor_origen_id from public.contracts where corredor_origen_id is not null)
on conflict (id) do nothing;

alter table public.clients drop constraint if exists clients_corredor_origen_id_fkey;
alter table public.clients add constraint clients_corredor_origen_id_fkey foreign key (corredor_origen_id) references public.corredores (id);
alter table public.contracts drop constraint if exists contracts_corredor_origen_id_fkey;
alter table public.contracts add constraint contracts_corredor_origen_id_fkey foreign key (corredor_origen_id) references public.corredores (id);

-- Gerencia administra corredores; el permiso se agrega también a instalaciones que ya tienen los roles.
insert into public.role_permissions (role_id, permiso)
select 'gerencia', 'corredores.gestionar' where exists (select 1 from public.roles where id = 'gerencia')
on conflict do nothing;

/* ------------------------------------------------------------- validaciones */

create or replace function public.corredores_datos(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_nombre text := trim(coalesce(p ->> 'nombre', ''));
  v_doc text := trim(coalesce(p ->> 'documento', ''));
  v_lic text := trim(coalesce(p ->> 'licencia', ''));
  v_tel text := trim(coalesce(p ->> 'telefono', ''));
  v_email text := lower(trim(coalesce(p ->> 'email', '')));
  v_resp uuid := nullif(p ->> 'responsable_id', '')::uuid;
begin
  if char_length(v_nombre) < 3 then raise exception 'Ingresa el nombre del corredor'; end if;
  if v_doc <> '' and v_doc !~ '^[0-9]{10}(001)?$' then raise exception 'La cédula o el RUC no son válidos'; end if;
  if v_tel <> '' and v_tel !~ '^[+0-9][0-9 -]{6,19}$' then raise exception 'El teléfono no es válido'; end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'El correo no es válido'; end if;
  if v_resp is not null and not exists (select 1 from profiles where id = v_resp and estado = 'activo') then
    raise exception 'El responsable debe ser un usuario activo de AMURA';
  end if;
  if v_resp is not null and not public.en_alcance(v_resp) then raise exception 'Sin alcance sobre el responsable indicado' using errcode = '42501'; end if;
  return jsonb_build_object('nombre', v_nombre, 'documento', v_doc, 'licencia', v_lic, 'telefono', v_tel, 'email', v_email, 'responsable_id', v_resp);
end $$;

-- Regla de origen: solo un corredor activo; el corredor con acceso puede registrar sus propios clientes; otros, con permiso de asignación.
create or replace function public.clientes_corredor_valido(p_corredor uuid, p_origen text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_corredor is null then return; end if;
  if p_origen <> 'corredor' then raise exception 'El corredor de origen solo aplica cuando el origen es Corredor'; end if;
  if not exists (select 1 from corredores where id = p_corredor and estado = 'activo') then raise exception 'El corredor de origen debe ser un corredor activo'; end if;
  if not (public.tiene_permiso('clientes.asignar') or exists (select 1 from corredores where id = p_corredor and usuario_id = auth.uid())) then
    raise exception 'Sin permiso para indicar a otro corredor' using errcode = '42501';
  end if;
end $$;

-- Un corredor con acceso que registra su propio cliente queda como origen, aunque no lo indique.
create or replace function public.clientes_crear(p_id uuid, p_datos jsonb, p_asesor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid := coalesce(p_id, gen_random_uuid()); v_corredor uuid := nullif(p_datos ->> 'corredor_origen_id', '')::uuid;
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para registrar clientes' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_asesor);
  d := public.clientes_datos(p_datos);
  if v_corredor is null and d ->> 'origen' = 'corredor' then
    select id into v_corredor from corredores where usuario_id = auth.uid() and estado = 'activo';
  end if;
  perform public.clientes_corredor_valido(v_corredor, d ->> 'origen');
  insert into clients (id, nombre, documento, telefono, email, origen, origen_detalle, corredor_origen_id, unidades_interes, presupuesto, proposito, forma_pago, asesor_id, created_by)
  values (v_id, d ->> 'nombre', d ->> 'documento', d ->> 'telefono', d ->> 'email', d ->> 'origen', d ->> 'origen_detalle', v_corredor,
          array(select jsonb_array_elements_text(d -> 'unidades_interes')), (d ->> 'presupuesto')::numeric, d ->> 'proposito', d ->> 'forma_pago', p_asesor, auth.uid());
  perform public.clientes_nota(v_id, 'nota', 'Cliente registrado · origen ' || (d ->> 'origen'));
  return v_id;
end $$;

-- Para el selector del formulario de Clientes: solo corredores activos.
create or replace function public.clientes_corredores() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select c.id, c.nombre from corredores c
  where public.tiene_permiso('clientes.editar') and c.estado = 'activo' order by c.nombre
$$;

/* ------------------------------------------------------------------- funciones */

create or replace function public.corredores_crear(p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid; v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('corredores.gestionar') then raise exception 'Sin permiso para gestionar corredores' using errcode = '42501'; end if;
  d := public.corredores_datos(p_datos);
  insert into corredores (nombre, documento, licencia, telefono, email, responsable_id)
  values (d ->> 'nombre', d ->> 'documento', d ->> 'licencia', d ->> 'telefono', d ->> 'email', nullif(d ->> 'responsable_id', '')::uuid)
  returning id into v_id;
  perform public.auditar('Crear corredor', 'corredor', v_id::text, v_m, null, d);
  return v_id;
end $$;

create or replace function public.corredores_editar(p_id uuid, p_datos jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_m text := public.clientes_motivo(p_motivo); c corredores;
begin
  if not public.tiene_permiso('corredores.gestionar') then raise exception 'Sin permiso para gestionar corredores' using errcode = '42501'; end if;
  select * into c from corredores where id = p_id for update;
  if not found or not (c.responsable_id is null or public.en_alcance(c.responsable_id)) then raise exception 'Corredor inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  d := public.corredores_datos(p_datos);
  update corredores set nombre = d ->> 'nombre', documento = d ->> 'documento', licencia = d ->> 'licencia', telefono = d ->> 'telefono', email = d ->> 'email',
    responsable_id = nullif(d ->> 'responsable_id', '')::uuid, actualizado_en = now() where id = p_id;
  perform public.auditar('Editar corredor', 'corredor', p_id::text, v_m,
    jsonb_build_object('nombre', c.nombre, 'documento', c.documento, 'licencia', c.licencia, 'telefono', c.telefono, 'email', c.email, 'responsable_id', c.responsable_id),
    d);
end $$;

-- Desactivar no borra nada: deja de poder asignarse a clientes nuevos, pero conserva su historial.
create or replace function public.corredores_cambiar_estado(p_id uuid, p_estado text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c corredores; v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('corredores.gestionar') then raise exception 'Sin permiso para gestionar corredores' using errcode = '42501'; end if;
  if p_estado not in ('activo', 'inactivo') then raise exception 'Estado no válido'; end if;
  select * into c from corredores where id = p_id for update;
  if not found or not (c.responsable_id is null or public.en_alcance(c.responsable_id)) then raise exception 'Corredor inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if c.estado = p_estado then raise exception 'El corredor ya está %', p_estado; end if;
  update corredores set estado = p_estado, actualizado_en = now() where id = p_id;
  perform public.auditar('Cambiar estado de corredor', 'corredor', p_id::text, v_m, jsonb_build_object('estado', c.estado), jsonb_build_object('estado', p_estado));
end $$;

-- Vincula una cuenta de acceso existente, que debe tener el rol Corredor. Un usuario solo puede estar vinculado a un perfil.
create or replace function public.corredores_vincular_acceso(p_id uuid, p_usuario uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c corredores; v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('corredores.gestionar') or not public.tiene_permiso('config.usuarios') then
    raise exception 'Solo administración vincula accesos a corredores' using errcode = '42501';
  end if;
  select * into c from corredores where id = p_id for update;
  if not found then raise exception 'Corredor inexistente'; end if;
  if not exists (select 1 from profiles where id = p_usuario and estado = 'activo' and rol_id = 'corredor') then
    raise exception 'La cuenta debe estar activa y tener el rol Corredor';
  end if;
  if exists (select 1 from corredores where usuario_id = p_usuario and id <> p_id) then raise exception 'Esa cuenta ya está vinculada a otro corredor'; end if;
  update corredores set usuario_id = p_usuario, actualizado_en = now() where id = p_id;
  perform public.auditar('Vincular acceso de corredor', 'corredor', p_id::text, v_m, jsonb_build_object('usuario_id', c.usuario_id), jsonb_build_object('usuario_id', p_usuario));
end $$;

create or replace function public.corredores_desvincular_acceso(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c corredores; v_m text := public.clientes_motivo(p_motivo);
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Solo administración desvincula accesos' using errcode = '42501'; end if;
  select * into c from corredores where id = p_id for update;
  if not found or c.usuario_id is null then raise exception 'Este corredor no tiene acceso vinculado'; end if;
  update corredores set usuario_id = null, actualizado_en = now() where id = p_id;
  perform public.auditar('Desvincular acceso de corredor', 'corredor', p_id::text, v_m, jsonb_build_object('usuario_id', c.usuario_id), jsonb_build_object('usuario_id', null));
end $$;

-- Lo que muestra la pantalla: perfil, acceso, responsable y su alcance en clientes y ventas firmadas.
create or replace function public.corredores_listar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'nombre', c.nombre, 'documento', c.documento, 'licencia', c.licencia, 'telefono', c.telefono, 'email', c.email, 'estado', c.estado,
    'responsable_id', c.responsable_id, 'responsable', (select p.nombre from profiles p where p.id = c.responsable_id),
    'usuario_id', c.usuario_id, 'acceso', (select p.nombre from profiles p where p.id = c.usuario_id),
    'clientes', (select count(*)::int from clients k where k.corredor_origen_id = c.id and public.cliente_en_alcance(k.id)),
    'ventas', (select count(*)::int from contracts k where k.corredor_origen_id = c.id and k.estado = 'firmado' and public.cliente_en_alcance(k.client_id))
  ) order by c.nombre), '[]'::jsonb)
  from corredores c
  where public.tiene_permiso('corredores.ver') and (c.responsable_id is null or public.en_alcance(c.responsable_id) or c.usuario_id = auth.uid())
$$;

do $$
declare fn text;
begin
  foreach fn in array array['public.corredores_crear(jsonb, text)', 'public.corredores_editar(uuid, jsonb, text)', 'public.corredores_cambiar_estado(uuid, text, text)',
    'public.corredores_vincular_acceso(uuid, uuid, text)', 'public.corredores_desvincular_acceso(uuid, text)', 'public.corredores_listar()', 'public.clientes_corredores()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array['public.corredores_datos(jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
