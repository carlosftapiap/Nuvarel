-- AMURA · Usuarios, roles configurables, excepciones, equipos, proyectos y auditoría.
-- Ejecutar después de 20261028200000_reservas.sql y luego supabase/seed_roles.sql.
-- La autorización efectiva se resuelve aquí: rol + excepciones (denegar prevalece) + alcance de datos.

create table public.permissions (
  clave text primary key,
  modulo text not null,
  descripcion text not null
);

create table public.roles (
  id text primary key default 'rol-' || replace(gen_random_uuid()::text, '-', ''),
  nombre text not null unique,
  descripcion text not null default '',
  alcance text not null check (alcance in ('propio', 'equipo', 'empresa')),
  sistema boolean not null default false
);

create table public.role_permissions (
  role_id text not null references public.roles (id) on delete cascade,
  permiso text not null references public.permissions (clave),
  primary key (role_id, permiso)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  supervisor_id uuid references auth.users (id)
);

create table public.team_managers (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  primary key (team_id, user_id)
);

-- Perfil de cada persona: identificador estable = auth.users.id. No guarda contraseñas.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  nombre text not null,
  email text not null unique,
  estado text not null default 'invitado' check (estado in ('invitado', 'activo', 'inactivo')),
  rol_id text not null references public.roles (id),
  alcance text check (alcance in ('propio', 'equipo', 'empresa')),
  supervisor_id uuid references public.profiles (id),
  equipo_id uuid references public.teams (id),
  created_at timestamptz not null default now(),
  check (supervisor_id is distinct from id)
);

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permiso text not null references public.permissions (clave),
  valor text not null check (valor in ('permitir', 'denegar')),
  primary key (user_id, permiso)
);

create table public.projects (id text primary key, nombre text not null);
insert into public.projects values ('AMURA', 'AMURA Apartments') on conflict do nothing;

create table public.user_projects (
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id text not null references public.projects (id),
  primary key (user_id, project_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  actor_id uuid references auth.users (id),
  accion text not null,
  entidad text not null,
  entidad_id text not null,
  motivo text not null check (char_length(motivo) >= 5),
  antes jsonb,
  despues jsonb
);

/* ------------------------------------------------------------------ funciones */

-- ¿El usuario actual tiene el permiso? Perfil activo + rol + excepciones; denegar prevalece; lo no definido se deniega.
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

-- Compatibilidad con las funciones anteriores: el rol se toma del perfil activo.
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select case when p.rol_id in ('administrador', 'gerencia', 'asesor', 'corredor') then p.rol_id::public.app_role end
  from profiles p where p.id = auth.uid() and p.estado = 'activo'
$$;

-- Anti escalada: un rol solo puede concederlo quien ya tiene todos sus permisos.
create or replace function public.puede_conceder_rol(p_rol text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from role_permissions rp where rp.role_id = p_rol and not public.tiene_permiso(rp.permiso))
$$;

/* -------------------------------------------------------------------- RLS */

alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.teams enable row level security;
alter table public.team_managers enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.projects enable row level security;
alter table public.user_projects enable row level security;
alter table public.audit_log enable row level security;

create policy "catalogo legible" on public.permissions for select to authenticated using (true);
create policy "roles legibles" on public.roles for select to authenticated using (true);
create policy "permisos de rol legibles" on public.role_permissions for select to authenticated using (true);
create policy "proyectos legibles" on public.projects for select to authenticated using (true);
create policy "equipos legibles" on public.teams for select to authenticated using (true);
create policy "gerencias de equipo legibles" on public.team_managers for select to authenticated using (true);
create policy "perfiles en alcance" on public.profiles for select to authenticated
  using (id = auth.uid() or public.en_alcance(id) or public.tiene_permiso('config.usuarios'));
create policy "excepciones visibles" on public.user_permission_overrides for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.roles'));
create policy "proyectos de usuario visibles" on public.user_projects for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.usuarios'));
create policy "auditoria" on public.audit_log for select to authenticated using (public.tiene_permiso('config.auditoria'));
-- Sin políticas de escritura: los cambios de acceso se hacen con las funciones siguientes o con la función del servidor.

/* ------------------------------------------------------- administración */

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

/* --------------------------------- clientes, cotizaciones y reservas por alcance */

drop policy if exists "ver clientes" on public.clients;
drop policy if exists "crear clientes" on public.clients;
drop policy if exists "editar clientes" on public.clients;
create policy "ver clientes" on public.clients for select to authenticated
  using (public.tiene_permiso('clientes.ver') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)));
create policy "crear clientes" on public.clients for insert to authenticated
  with check (public.tiene_permiso('clientes.editar') and created_by = auth.uid()
              and (asesor_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and public.en_alcance(asesor_id))));
create policy "editar clientes" on public.clients for update to authenticated
  using (public.tiene_permiso('clientes.editar') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)))
  with check (public.en_alcance(asesor_id) or public.en_alcance(created_by));

-- Atribución de origen: se fija al crear y no cambia al reasignar.
alter table public.clients add column if not exists atribucion_usuario_id uuid references auth.users (id);
update public.clients set atribucion_usuario_id = created_by where atribucion_usuario_id is null;

create or replace function public.clients_proteger_asesor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asesor_id is distinct from old.asesor_id then
    if not (public.tiene_permiso('clientes.asignar') and public.en_alcance(new.asesor_id)) then
      raise exception 'Sin permiso para reasignar a esa persona' using errcode = '42501';
    end if;
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'Reasignar cliente', 'cliente', new.id::text, 'Reasignación de asesor',
            jsonb_build_object('asesor_id', old.asesor_id), jsonb_build_object('asesor_id', new.asesor_id));
  end if;
  new.atribucion_usuario_id := old.atribucion_usuario_id;
  new.updated_at := now();
  return new;
end $$;

drop policy if exists "leer cotizaciones" on public.quotes;
create policy "leer cotizaciones" on public.quotes for select to authenticated
  using (public.tiene_permiso('cotizaciones.ver') and public.en_alcance(created_by));

drop policy if exists "ver reservas" on public.reservations;
create policy "ver reservas" on public.reservations for select to authenticated
  using (public.tiene_permiso('reservas.ver') and (public.en_alcance(created_by)
         or exists (select 1 from clients c where c.id = client_id and public.en_alcance(c.asesor_id))));

-- Verificar pago y confirmar son permisos separados; ambos se exigen para confirmar.
do $$
declare
  v_def text := pg_get_functiondef('public.reservas_confirmar(uuid, text, numeric)'::regprocedure);
  v_new text := replace(v_def, 'if v_rol not in (''administrador'', ''gerencia'') then raise exception ''Solo gerencia o administración confirma reservas''',
    'if not (public.tiene_permiso(''reservas.verificar_pago'') and public.tiene_permiso(''reservas.confirmar'')) then raise exception ''Sin permiso para verificar el pago y confirmar''');
begin
  if v_new = v_def then raise exception 'No se encontró la verificación esperada en reservas_confirmar'; end if;
  execute v_new;
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.reservas_anular(uuid, text)'::regprocedure);
  v_new text := replace(v_def, 'if v_rol not in (''administrador'', ''gerencia'') then', 'if not public.tiene_permiso(''reservas.anular'') then');
begin
  if v_new = v_def then raise exception 'No se encontró la verificación esperada en reservas_anular'; end if;
  execute v_new;
end $$;

do $$
declare
  v_def text := pg_get_functiondef('public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text)'::regprocedure);
  v_new text := replace(v_def, 'if v_rol is null or v_rol <> ''administrador'' then', 'if not public.tiene_permiso(''precios.aprobar'') then');
begin
  if v_new = v_def then raise exception 'No se encontró la verificación esperada en inventario_ajustar_precio'; end if;
  execute v_new;
end $$;
