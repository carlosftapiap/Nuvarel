-- AMURA · Primer administrador. Ejecutar solo si la verificación indica que no hay un administrador activo.
-- 1. En Supabase: Authentication → Users → Add user, con tu correo. La contraseña se define allí, nunca en este archivo.
-- 2. Escribe ese correo en v_email y el nombre visible en v_nombre, y ejecuta. Los demás usuarios se administran desde Configuración en la app.

do $$
declare
  v_email text := 'REEMPLAZAR@correo.com';  -- ← correo de la cuenta creada en el paso 1
  v_nombre text := 'REEMPLAZAR Nombre';     -- ← nombre visible (si no lo cambias, se usa el correo)
  v_id uuid;
begin
  if v_email like 'REEMPLAZAR%' then raise exception 'Escribe en v_email el correo de la cuenta creada en Authentication'; end if;
  if exists (select 1 from public.profiles p join public.role_permissions rp on rp.role_id = p.rol_id and rp.permiso = 'config.usuarios'
             where p.estado = 'activo') then
    raise exception 'Ya existe un administrador activo; los cambios de acceso se hacen desde Configuración';
  end if;
  select id into v_id from auth.users where lower(email) = lower(trim(v_email));
  if v_id is null then raise exception 'No existe una cuenta con ese correo en Authentication'; end if;
  insert into public.profiles (id, nombre, email, estado, rol_id)
  values (v_id, case when v_nombre like 'REEMPLAZAR%' or char_length(trim(v_nombre)) < 3 then trim(v_email) else trim(v_nombre) end, lower(trim(v_email)), 'activo', 'administrador')
  on conflict (id) do update set rol_id = 'administrador', estado = 'activo', nombre = excluded.nombre;
  insert into public.user_projects values (v_id, 'AMURA') on conflict do nothing;
  insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
  values (null, 'Alta del primer administrador', 'usuario', v_id::text, 'Instalación inicial desde el SQL Editor',
          jsonb_build_object('email', lower(trim(v_email)), 'rol', 'administrador'));
end $$;
