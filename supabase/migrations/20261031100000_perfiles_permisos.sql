-- AMURA · Perfiles y permisos: ocho perfiles, roles y equipos configurables desde la app, y alta de cuentas con contraseña.
-- Reutiliza permissions, roles, role_permissions, teams, profiles y audit_log. No modifica clientes, ventas ni pagos.
-- Quien tiene hoy el rol JARVAL lo conserva; solo deja de ofrecerse para cuentas nuevas. Se puede repetir.
-- Ejecutar después de 20261031090000_inventario_disponible.sql.

begin;

do $$ begin
  if to_regprocedure('public.config_habilitar_cuenta(uuid, text, text, text)') is null or to_regclass('public.corredores') is null then
    raise exception 'Faltan cuentas o Corredores: aplica antes 20261029030000_cuentas.sql y 20261031070000_corredores.sql';
  end if;
end $$;

/* --------------------------------------------------------------------- perfiles */

alter table public.roles add column if not exists disponible boolean not null default true;
update public.roles set disponible = false where id = 'jarval';
update public.roles set nombre = 'Corredor' where id = 'corredor';
update public.roles set nombre = 'Legal' where id = 'legal';

insert into public.permissions (clave, modulo, descripcion) values
  ('inventario.tecnico', 'Inventario', 'Ver información técnica, sin precios')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles (id, nombre, descripcion, alcance, sistema) values
  ('constructor', 'Constructor', 'Información técnica del proyecto y avance de obra, sin datos comerciales', 'empresa', true)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permiso)
select x.rol, x.permiso from (values
  ('constructor', 'inventario.tecnico'), ('administrador', 'inventario.tecnico'),
  ('asesor', 'ventas.ver'), ('corredor', 'ventas.ver'),
  ('asesor', 'cobranzas.ver'), ('corredor', 'cobranzas.ver'), ('supervisor', 'cobranzas.ver'),
  ('supervisor', 'corredores.ver')
) as x(rol, permiso) where exists (select 1 from public.roles r where r.id = x.rol)
on conflict do nothing;

/* ------------------------------------------------------------------ inventario técnico */

-- Lo que puede ver quien no tiene acceso comercial. Sin precios, estado comercial, reservas ni notas.
create or replace function public.inventario_tecnico()
returns table (codigo text, dpt text, edificio smallint, piso text, posicion smallint, ubicacion text, tipologia text,
               area_m2 numeric, bodega_codigo text, bodega_m2 numeric, patio_m2 numeric, parqueo text, plano_path text, imagenes text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.tiene_permiso('inventario.tecnico') or public.tiene_permiso('inventario.ver')) then
    raise exception 'Sin permiso para consultar el inventario' using errcode = '42501';
  end if;
  return query
  select u.codigo, u.dpt, u.edificio::smallint, u.piso::text, u.posicion::smallint, u.ubicacion, u.tipologia::text,
         u.area_m2, u.bodega_codigo, u.bodega_m2, u.patio_m2, u.parqueo, u.plano_path, u.imagenes
  from inventory_units u order by u.edificio, case when u.piso::text = 'PB' then 0 else u.piso::text::int end, u.posicion;
end $$;

/* ------------------------------------------------------------------ alta de cuentas */

-- Comprueba todo antes de crear la cuenta de acceso, para no dejar cuentas sin perfil.
create or replace function public.config_validar_alta(p_rol text, p_alcance text, p_equipo uuid, p_supervisor uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso para administrar usuarios' using errcode = '42501'; end if;
  if not exists (select 1 from roles where id = p_rol and disponible) then raise exception 'Ese rol no está disponible para cuentas nuevas'; end if;
  if not public.puede_conceder_rol(p_rol) then raise exception 'No puedes conceder permisos que no tienes' using errcode = '42501'; end if;
  if p_alcance is not null and p_alcance not in ('propio', 'equipo', 'empresa') then raise exception 'Alcance no válido'; end if;
  if p_equipo is not null and not exists (select 1 from teams where id = p_equipo) then raise exception 'El equipo no existe'; end if;
  if p_supervisor is not null and not exists (select 1 from profiles where id = p_supervisor and estado = 'activo') then raise exception 'El supervisor debe ser un usuario activo'; end if;
end $$;

-- Perfil de una cuenta recién creada por la función crear-usuario. Queda activo: no hay invitación ni confirmación.
create or replace function public.config_crear_perfil(p_user uuid, p_nombre text, p_rol text, p_alcance text, p_equipo uuid, p_supervisor uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); v_email text;
begin
  perform public.config_validar_alta(p_rol, p_alcance, p_equipo, p_supervisor);
  if char_length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Nombre obligatorio'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'La cuenta no existe en Authentication'; end if;
  if exists (select 1 from profiles where id = p_user) then raise exception 'La cuenta ya tiene perfil'; end if;
  insert into profiles (id, nombre, email, estado, rol_id, alcance, equipo_id, supervisor_id)
  values (p_user, trim(p_nombre), lower(v_email), 'activo', p_rol, p_alcance, p_equipo, p_supervisor);
  insert into user_projects values (p_user, 'AMURA') on conflict do nothing;
  perform public.auditar('Crear usuario', 'usuario', p_user::text, v_m, null,
    jsonb_build_object('nombre', trim(p_nombre), 'email', lower(v_email), 'rol', p_rol, 'alcance', p_alcance, 'equipo_id', p_equipo, 'supervisor_id', p_supervisor));
end $$;

-- Autoriza y registra el cambio de contraseña. No guarda ni recibe la contraseña.
create or replace function public.config_autorizar_clave(p_user uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); v_rol text;
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso para administrar usuarios' using errcode = '42501'; end if;
  select rol_id into v_rol from profiles where id = p_user;
  if not found then raise exception 'Usuario inexistente'; end if;
  if p_user = auth.uid() then raise exception 'Cambia tu propia contraseña desde tu sesión'; end if;
  -- Cambiar la clave de alguien con más permisos equivaldría a tomar su cuenta.
  if not public.puede_conceder_rol(v_rol) then raise exception 'No puedes cambiar la contraseña de quien tiene más permisos que tú' using errcode = '42501'; end if;
  perform public.auditar('Cambiar contraseña', 'usuario', p_user::text, v_m, null, null);
end $$;

-- Una cuenta creada en el panel de Supabase tampoco puede recibir un rol retirado.
create or replace function public.config_habilitar_cuenta(p_user uuid, p_nombre text, p_rol text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso para administrar usuarios' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Nombre obligatorio'; end if;
  if p_user = auth.uid() then raise exception 'No puedes habilitar tu propia cuenta'; end if;
  if not exists (select 1 from roles where id = p_rol and disponible) then raise exception 'Ese rol no está disponible para cuentas nuevas'; end if;
  if not public.puede_conceder_rol(p_rol) then raise exception 'No puedes conceder permisos que no tienes' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'La cuenta no existe en Authentication'; end if;
  if exists (select 1 from profiles where id = p_user) then raise exception 'La cuenta ya tiene perfil'; end if;
  insert into profiles (id, nombre, email, estado, rol_id) values (p_user, trim(p_nombre), lower(v_email), 'activo', p_rol);
  insert into user_projects values (p_user, 'AMURA') on conflict do nothing;
  insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
  values (auth.uid(), 'Habilitar cuenta', 'usuario', p_user::text, trim(p_motivo), null,
          jsonb_build_object('nombre', trim(p_nombre), 'email', lower(v_email), 'rol', p_rol, 'estado', 'activo'));
end $$;

/* ------------------------------------------------------------------ roles y permisos */

-- Crea o edita un rol. Nadie concede lo que no tiene, y Administrador conserva lo que permite recuperar el sistema.
create or replace function public.config_guardar_rol(p_id text, p_nombre text, p_descripcion text, p_alcance text, p_permisos text[], p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.clientes_motivo(p_motivo); r roles; v_id text := p_id; v_permisos text[] := array(select distinct unnest(coalesce(p_permisos, '{}')));
  v_antes text[] := '{}'; v_nuevo text;
begin
  if not public.tiene_permiso('config.roles') then raise exception 'Sin permiso para administrar roles' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Nombre obligatorio'; end if;
  if p_alcance is null or p_alcance not in ('propio', 'equipo', 'empresa') then raise exception 'Alcance no válido'; end if;
  if exists (select 1 from unnest(v_permisos) x where not exists (select 1 from permissions k where k.clave = x)) then raise exception 'Hay permisos que no existen'; end if;
  if exists (select 1 from roles x where lower(x.nombre) = lower(trim(p_nombre)) and x.id is distinct from p_id) then raise exception 'Ya existe un rol con ese nombre'; end if;

  if p_id is not null then
    select * into r from roles where id = p_id for update;
    if not found then raise exception 'Rol inexistente'; end if;
    v_antes := array(select permiso from role_permissions where role_id = p_id order by permiso);
  end if;
  select x into v_nuevo from unnest(v_permisos) x where not x = any (v_antes) and not public.tiene_permiso(x) limit 1;
  if v_nuevo is not null then raise exception 'No puedes conceder permisos que no tienes: %', v_nuevo using errcode = '42501'; end if;
  if p_id = 'administrador' and not (v_permisos @> array['config.usuarios', 'config.roles']) then
    raise exception 'Administrador debe conservar la administración de usuarios y de roles';
  end if;

  if p_id is null then
    insert into roles (nombre, descripcion, alcance) values (trim(p_nombre), trim(coalesce(p_descripcion, '')), p_alcance) returning id into v_id;
  else
    update roles set nombre = trim(p_nombre), descripcion = trim(coalesce(p_descripcion, '')), alcance = p_alcance where id = p_id;
  end if;
  delete from role_permissions where role_id = v_id and not permiso = any (v_permisos);
  insert into role_permissions (role_id, permiso) select v_id, x from unnest(v_permisos) x on conflict do nothing;

  if not exists (
    select 1 from profiles p join role_permissions rp on rp.role_id = p.rol_id and rp.permiso = 'config.usuarios'
    where p.estado = 'activo' and not exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = 'config.usuarios' and o.valor = 'denegar')
  ) then raise exception 'No se puede dejar la empresa sin un administrador activo'; end if;

  perform public.auditar(case when p_id is null then 'Crear rol' else 'Editar rol' end, 'rol', v_id, v_m,
    case when p_id is null then null else jsonb_build_object('nombre', r.nombre, 'alcance', r.alcance, 'permisos', to_jsonb(v_antes)) end,
    jsonb_build_object('nombre', trim(p_nombre), 'alcance', p_alcance, 'permisos', to_jsonb(array(select permiso from role_permissions where role_id = v_id order by permiso))));
  return v_id;
end $$;

create or replace function public.config_eliminar_rol(p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); r roles;
begin
  if not public.tiene_permiso('config.roles') then raise exception 'Sin permiso para administrar roles' using errcode = '42501'; end if;
  select * into r from roles where id = p_id for update;
  if not found then raise exception 'Rol inexistente'; end if;
  if r.sistema then raise exception 'Los perfiles iniciales no se eliminan'; end if;
  if exists (select 1 from profiles where rol_id = p_id) then raise exception 'Hay usuarios con este rol: reasígnalos primero'; end if;
  perform public.auditar('Eliminar rol', 'rol', p_id, v_m, jsonb_build_object('nombre', r.nombre, 'permisos', to_jsonb(array(select permiso from role_permissions where role_id = p_id))), null);
  delete from roles where id = p_id;
end $$;

/* ------------------------------------------------------------------------- equipos */

create or replace function public.config_guardar_equipo(p_id uuid, p_nombre text, p_supervisor uuid, p_gerentes uuid[], p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t teams; v_id uuid := p_id; v_ger uuid[] := array(select distinct unnest(coalesce(p_gerentes, '{}'::uuid[])));
begin
  if not public.tiene_permiso('config.equipos') then raise exception 'Sin permiso para administrar equipos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Nombre obligatorio'; end if;
  if exists (select 1 from teams x where lower(x.nombre) = lower(trim(p_nombre)) and x.id is distinct from p_id) then raise exception 'Ya existe un equipo con ese nombre'; end if;
  if p_supervisor is not null and not exists (select 1 from profiles where id = p_supervisor and estado = 'activo') then raise exception 'El supervisor debe ser un usuario activo'; end if;
  if exists (select 1 from unnest(v_ger) g where not exists (select 1 from profiles p where p.id = g and p.estado = 'activo')) then raise exception 'La gerencia del equipo debe estar activa'; end if;
  if p_id is not null then
    select * into t from teams where id = p_id for update;
    if not found then raise exception 'Equipo inexistente'; end if;
    update teams set nombre = trim(p_nombre), supervisor_id = p_supervisor where id = p_id;
  else
    insert into teams (nombre, supervisor_id) values (trim(p_nombre), p_supervisor) returning id into v_id;
  end if;
  delete from team_managers where team_id = v_id and not user_id = any (v_ger);
  insert into team_managers (team_id, user_id) select v_id, g from unnest(v_ger) g on conflict do nothing;
  perform public.auditar(case when p_id is null then 'Crear equipo' else 'Editar equipo' end, 'equipo', v_id::text, v_m,
    case when p_id is null then null else jsonb_build_object('nombre', t.nombre, 'supervisor_id', t.supervisor_id) end,
    jsonb_build_object('nombre', trim(p_nombre), 'supervisor_id', p_supervisor, 'gerencia', to_jsonb(v_ger)));
  return v_id;
end $$;

/* ------------------------------------------- propuestas de precio: por permiso, no por rol fijo */

drop policy if exists "leer propuestas" on public.price_proposals;
create policy "leer propuestas" on public.price_proposals for select to authenticated
  using (public.tiene_permiso('precios.proponer') or public.tiene_permiso('precios.aprobar'));
drop policy if exists "gerencia propone" on public.price_proposals;
create policy "gerencia propone" on public.price_proposals for insert to authenticated
  with check (public.tiene_permiso('precios.proponer') and user_id = auth.uid() and estado = 'pendiente');

/* ----------------------------------------------------------------- permisos de funciones */

do $$
declare fn text;
begin
  foreach fn in array array['public.inventario_tecnico()', 'public.config_validar_alta(text, text, uuid, uuid)',
    'public.config_crear_perfil(uuid, text, text, text, uuid, uuid, text)', 'public.config_autorizar_clave(uuid, text)',
    'public.config_guardar_rol(text, text, text, text, text[], text)', 'public.config_eliminar_rol(text, text)',
    'public.config_guardar_equipo(uuid, text, uuid, uuid[], text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

commit;
