-- AMURA · Usuarios y permisos (2/5): funciones de autorización. Ejecutar después de supabase/seed_roles.sql.
-- Lo no definido se deniega: sin perfil activo no hay ningún permiso ni alcance.

-- ¿El usuario actual tiene el permiso? Perfil activo + rol + excepciones; denegar prevalece.
create or replace function public.tiene_permiso(p_permiso text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.estado = 'activo'
      and not exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = p_permiso and o.valor = 'denegar')
      and (
        exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = p_permiso and o.valor = 'permitir')
        or exists (select 1 from role_permissions rp where rp.role_id = p.rol_id and rp.permiso = p_permiso)
      )
  )
$$;

-- Usuarios cuyos registros puede ver el usuario actual (propio, equipo o empresa).
create or replace function public.usuarios_en_alcance() returns setof uuid
language sql stable security definer set search_path = public as $$
  with yo as (
    select p.id, coalesce(p.alcance, r.alcance) as alcance
    from profiles p join roles r on r.id = p.rol_id
    where p.id = auth.uid() and p.estado = 'activo'
  )
  select x.id from profiles x, yo where yo.alcance = 'empresa'
  union select yo.id from yo
  union select m.id from profiles m, yo
    where yo.alcance = 'equipo' and (
      m.supervisor_id = yo.id
      or m.equipo_id in (select t.id from teams t where t.supervisor_id = yo.id)
      or m.equipo_id in (select tm.team_id from team_managers tm where tm.user_id = yo.id)
    )
$$;

create or replace function public.en_alcance(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_owner in (select public.usuarios_en_alcance())
$$;

-- Anti escalada: un rol solo puede concederlo quien ya tiene todos sus permisos.
create or replace function public.puede_conceder_rol(p_rol text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from role_permissions rp where rp.role_id = p_rol and not public.tiene_permiso(rp.permiso))
$$;

revoke all on function public.tiene_permiso(text) from public, anon;
revoke all on function public.usuarios_en_alcance() from public, anon;
revoke all on function public.en_alcance(uuid) from public, anon;
revoke all on function public.puede_conceder_rol(text) from public, anon;
grant execute on function public.tiene_permiso(text) to authenticated;
grant execute on function public.usuarios_en_alcance() to authenticated;
grant execute on function public.en_alcance(uuid) to authenticated;
grant execute on function public.puede_conceder_rol(text) to authenticated;
