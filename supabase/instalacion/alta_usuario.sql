-- AMURA · Alta de un usuario mientras la pantalla Configuración se conecta a Supabase.
-- 1. En Supabase: Authentication → Users → Add user con el correo de la persona (la contraseña se define allí).
-- 2. Completa los tres valores y ejecuta. Rol: administrador, gerencia, supervisor, asesor, corredor, finanzas, legal o jarval.

do $$
declare
  v_email  text := 'REEMPLAZAR@correo.com';   -- ← correo de la cuenta creada en el paso 1
  v_nombre text := 'REEMPLAZAR Nombre';       -- ← nombre visible
  v_rol    text := 'asesor';                  -- ← rol
  v_id uuid;
begin
  if v_email like 'REEMPLAZAR%' or v_nombre like 'REEMPLAZAR%' then raise exception 'Completa v_email y v_nombre'; end if;
  if not exists (select 1 from public.roles where id = v_rol) then raise exception 'Rol inexistente: %', v_rol; end if;
  select id into v_id from auth.users where lower(email) = lower(trim(v_email));
  if v_id is null then raise exception 'No existe una cuenta con ese correo en Authentication'; end if;
  if exists (select 1 from public.profiles where id = v_id) then raise exception 'La cuenta ya tiene perfil; los cambios se hacen con config_actualizar_usuario'; end if;
  insert into public.profiles (id, nombre, email, estado, rol_id) values (v_id, trim(v_nombre), lower(trim(v_email)), 'activo', v_rol);
  insert into public.user_projects values (v_id, 'AMURA') on conflict do nothing;
  insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
  values (null, 'Alta de usuario', 'usuario', v_id::text, 'Alta desde el SQL Editor', jsonb_build_object('email', lower(trim(v_email)), 'rol', v_rol));
end $$;
