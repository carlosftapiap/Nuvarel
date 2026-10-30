-- AMURA · Usuarios y permisos (4/5): funciones que usa Configuración en la app para administrar accesos.
-- Cada una verifica el permiso, exige motivo, impide la autoescalada y deja auditoría.

create or replace function public.config_actualizar_usuario(
  p_id uuid, p_rol text, p_alcance text, p_supervisor uuid, p_equipo uuid, p_proyectos text[], p_estado text, p_motivo text
) returns void language plpgsql security definer set search_path = public as $$
declare antes profiles; v_admins int;
begin
  if not public.tiene_permiso('config.usuarios') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into antes from profiles where id = p_id for update;
  if not found then raise exception 'Usuario inexistente'; end if;
  if p_id = auth.uid() and (p_rol <> antes.rol_id or p_alcance is distinct from antes.alcance or p_estado <> antes.estado) then
    raise exception 'No puedes modificar tu propio rol, alcance ni estado';
  end if;
  if p_rol <> antes.rol_id and not public.puede_conceder_rol(p_rol) then raise exception 'No puedes conceder permisos que no tienes'; end if;
  update profiles set rol_id = p_rol, alcance = p_alcance, supervisor_id = p_supervisor, equipo_id = p_equipo, estado = p_estado where id = p_id;
  delete from user_projects where user_id = p_id;
  insert into user_projects select p_id, unnest(coalesce(p_proyectos, '{}'));
  select count(*) into v_admins from profiles p
    where p.estado = 'activo'
      and not exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = 'config.usuarios' and o.valor = 'denegar')
      and (exists (select 1 from role_permissions rp where rp.role_id = p.rol_id and rp.permiso = 'config.usuarios')
           or exists (select 1 from user_permission_overrides o where o.user_id = p.id and o.permiso = 'config.usuarios' and o.valor = 'permitir'));
  if v_admins = 0 then raise exception 'No se puede dejar la empresa sin un administrador activo'; end if;
  insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
  values (auth.uid(), 'Editar usuario', 'usuario', p_id::text, trim(p_motivo), to_jsonb(antes), (select to_jsonb(p) from profiles p where p.id = p_id));
end $$;

create or replace function public.config_fijar_excepcion(p_user uuid, p_permiso text, p_valor text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not public.tiene_permiso('config.roles') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_user = auth.uid() then raise exception 'No puedes modificar tus propios permisos'; end if;
  if p_valor = 'permitir' and not public.tiene_permiso(p_permiso) then raise exception 'No puedes conceder permisos que no tienes'; end if;
  select valor into v_antes from user_permission_overrides where user_id = p_user and permiso = p_permiso;
  delete from user_permission_overrides where user_id = p_user and permiso = p_permiso;
  if p_valor in ('permitir', 'denegar') then insert into user_permission_overrides values (p_user, p_permiso, p_valor); end if;
  insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
  values (auth.uid(), 'Excepción de permiso', 'permiso', p_user::text, trim(p_motivo),
          jsonb_build_object(p_permiso, coalesce(v_antes, 'heredar')), jsonb_build_object(p_permiso, p_valor));
end $$;

revoke all on function public.config_actualizar_usuario(uuid, text, text, uuid, uuid, text[], text, text) from public, anon;
revoke all on function public.config_fijar_excepcion(uuid, text, text, text) from public, anon;
grant execute on function public.config_actualizar_usuario(uuid, text, text, uuid, uuid, text[], text, text) to authenticated;
grant execute on function public.config_fijar_excepcion(uuid, text, text, text) to authenticated;

-- Lectura según permiso o alcance.
drop policy if exists "perfiles en alcance" on public.profiles;
drop policy if exists "excepciones visibles" on public.user_permission_overrides;
drop policy if exists "proyectos de usuario visibles" on public.user_projects;
drop policy if exists "auditoria" on public.audit_log;
create policy "perfiles en alcance" on public.profiles for select to authenticated
  using (id = auth.uid() or public.en_alcance(id) or public.tiene_permiso('config.usuarios'));
create policy "excepciones visibles" on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.roles'));
create policy "proyectos de usuario visibles" on public.user_projects for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.usuarios'));
create policy "auditoria" on public.audit_log for select to authenticated using (public.tiene_permiso('config.auditoria'));
