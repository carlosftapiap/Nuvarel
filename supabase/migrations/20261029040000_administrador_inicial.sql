-- AMURA · Activación del administrador inicial desde la propia app (sin SQL manual).
-- Ejecutar después de 20261029030000_cuentas.sql. No modifica datos existentes.
-- Procedimiento de inicialización: solo funciona mientras no exista ningún administrador activo.
-- Quien lo usa debe haber iniciado sesión con el correo autorizado (guardado en la base, no en el código).

create table if not exists public.bootstrap_admin (
  id smallint primary key default 1 check (id = 1),
  email text not null check (email = lower(email)),
  usado_en timestamptz
);
alter table public.bootstrap_admin enable row level security;
-- Sin políticas: ni siquiera los usuarios autenticados pueden leer o cambiar el correo autorizado.
insert into public.bootstrap_admin (id, email) values (1, 'carlosftapiap@gmail.com') on conflict (id) do nothing;

create or replace function public.hay_administrador_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.estado = 'activo'
      and not exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = 'config.usuarios' and o.valor = 'denegar')
      and (exists (select 1 from role_permissions rp where rp.role_id = p.rol_id and rp.permiso = 'config.usuarios')
           or exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = 'config.usuarios' and o.valor = 'permitir'))
  )
$$;

-- ¿Puede la sesión actual activarse como administrador inicial? (para mostrar u ocultar el botón)
create or replace function public.puede_activar_administrador_inicial() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (select 1 from profiles where id = auth.uid())
     and not public.hay_administrador_activo()
     and exists (select 1 from bootstrap_admin b join auth.users u on lower(u.email::text) = b.email
                 where b.usado_en is null and u.id = auth.uid())
$$;

create or replace function public.activar_administrador_inicial() returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_nombre text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero' using errcode = '42501'; end if;
  if public.hay_administrador_activo() then
    raise exception 'Ya existe un administrador activo; las altas se hacen desde Configuración' using errcode = '42501';
  end if;
  select lower(u.email::text), coalesce(nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''), split_part(u.email::text, '@', 1))
    into v_email, v_nombre
  from auth.users u join bootstrap_admin b on lower(u.email::text) = b.email
  where u.id = auth.uid() and b.usado_en is null;
  if v_email is null then raise exception 'Esta cuenta no está autorizada para activarse como administrador inicial' using errcode = '42501'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then raise exception 'La cuenta ya tiene perfil'; end if;

  insert into profiles (id, nombre, email, estado, rol_id) values (auth.uid(), 'Carlos Tapia', v_email, 'activo', 'administrador');
  insert into user_projects values (auth.uid(), 'AMURA') on conflict do nothing;
  update bootstrap_admin set usado_en = now() where id = 1;
  insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
  values (auth.uid(), 'Alta del administrador inicial', 'usuario', auth.uid()::text, 'Activación inicial desde la aplicación',
          jsonb_build_object('email', v_email, 'rol', 'administrador'));
end $$;

revoke all on function public.hay_administrador_activo() from public, anon, authenticated;
revoke all on function public.puede_activar_administrador_inicial() from public, anon;
revoke all on function public.activar_administrador_inicial() from public, anon;
grant execute on function public.puede_activar_administrador_inicial() to authenticated;
grant execute on function public.activar_administrador_inicial() to authenticated;
