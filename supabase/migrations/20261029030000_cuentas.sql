-- AMURA · Administración de cuentas desde Configuración.
-- Ejecutar después de 20261029020000_plan_implementacion.sql. No modifica datos existentes.
-- Las altas las hace un administrador: la cuenta se crea en Supabase Authentication (o con la función invitar-usuario)
-- y el perfil se habilita aquí. Nadie puede crearse un perfil ni asignarse un rol a sí mismo.

do $$ begin
  if to_regprocedure('public.config_actualizar_usuario(uuid, text, text, uuid, uuid, text[], text, text)') is null then
    raise exception 'Faltan dependencias: instala antes 20261028220000 a 20261028220400';
  end if;
end $$;

-- Cuentas de Authentication con su perfil (si lo tienen). Solo para quien administra usuarios.
create or replace function public.config_listar_cuentas()
returns table (id uuid, email text, nombre text, estado text, rol_id text, rol_nombre text, alcance text, supervisor_id uuid,
               equipo_id uuid, proyectos text[], tiene_perfil boolean, confirmado boolean, ultimo_acceso timestamptz, creado timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso para administrar usuarios' using errcode = '42501'; end if;
  return query
  select u.id, coalesce(p.email, u.email::text), coalesce(p.nombre, u.email::text), coalesce(p.estado, 'sin_perfil'), p.rol_id, r.nombre,
         p.alcance, p.supervisor_id, p.equipo_id,
         coalesce((select array_agg(up.project_id order by up.project_id) from user_projects up where up.user_id = u.id), '{}'::text[]),
         p.id is not null,
         (to_jsonb(u) ->> 'email_confirmed_at') is not null,
         nullif(to_jsonb(u) ->> 'last_sign_in_at', '')::timestamptz,
         nullif(to_jsonb(u) ->> 'created_at', '')::timestamptz
  from auth.users u
  left join profiles p on p.id = u.id
  left join roles r on r.id = p.rol_id
  order by coalesce(p.nombre, u.email::text);
end $$;

-- Habilita una cuenta de Authentication que aún no tiene perfil (por ejemplo, creada desde el panel de Supabase).
create or replace function public.config_habilitar_cuenta(p_user uuid, p_nombre text, p_rol text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso para administrar usuarios' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Nombre obligatorio'; end if;
  if p_user = auth.uid() then raise exception 'No puedes habilitar tu propia cuenta'; end if;
  if not exists (select 1 from roles where id = p_rol) then raise exception 'Rol inexistente'; end if;
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

revoke all on function public.config_listar_cuentas() from public, anon;
revoke all on function public.config_habilitar_cuenta(uuid, text, text, text) from public, anon;
grant execute on function public.config_listar_cuentas() to authenticated;
grant execute on function public.config_habilitar_cuenta(uuid, text, text, text) to authenticated;
