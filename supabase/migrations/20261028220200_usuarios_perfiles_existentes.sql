-- AMURA · Usuarios y permisos (3/5): perfiles para las cuentas que ya tienen rol en user_roles.
-- Solo copia datos reales (auth.users + user_roles); no crea personas. Después, el rol se toma del perfil.

insert into public.profiles (id, nombre, email, estado, rol_id)
select ur.user_id,
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''), nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), u.email),
       u.email, 'activo', ur.role::text
from public.user_roles ur
join auth.users u on u.id = ur.user_id
where u.email is not null
on conflict (id) do nothing;

insert into public.user_projects (user_id, project_id)
select ur.user_id, 'AMURA' from public.user_roles ur join public.profiles p on p.id = ur.user_id
on conflict do nothing;

insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, despues)
select null, 'Perfil migrado desde user_roles', 'usuario', p.id::text, 'Instalación de usuarios y permisos', jsonb_build_object('rol', p.rol_id)
from public.profiles p
where exists (select 1 from public.user_roles ur where ur.user_id = p.id)
  and not exists (select 1 from public.audit_log a where a.entidad = 'usuario' and a.entidad_id = p.id::text and a.accion = 'Perfil migrado desde user_roles');

-- Compatibilidad con las funciones anteriores: el rol se toma del perfil activo.
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select case when p.rol_id in ('administrador', 'gerencia', 'asesor', 'corredor') then p.rol_id::public.app_role end
  from profiles p where p.id = auth.uid() and p.estado = 'activo'
$$;
