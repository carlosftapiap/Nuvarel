-- AMURA · Usuarios y permisos (1/5): tablas, RLS y lectura de catálogos.
-- Orden: este archivo → supabase/seed_roles.sql → 20261028220100 → 220200 → 220300 → 220400.
-- Idempotente: no borra ni recrea tablas existentes; se puede volver a ejecutar.

create table if not exists public.permissions (
  clave text primary key,
  modulo text not null,
  descripcion text not null
);

create table if not exists public.roles (
  id text primary key default 'rol-' || replace(gen_random_uuid()::text, '-', ''),
  nombre text not null unique,
  descripcion text not null default '',
  alcance text not null check (alcance in ('propio', 'equipo', 'empresa')),
  sistema boolean not null default false
);

create table if not exists public.role_permissions (
  role_id text not null references public.roles (id) on delete cascade,
  permiso text not null references public.permissions (clave),
  primary key (role_id, permiso)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  supervisor_id uuid references auth.users (id)
);

create table if not exists public.team_managers (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  primary key (team_id, user_id)
);

-- Perfil de cada persona: identificador estable = auth.users.id. No guarda contraseñas.
create table if not exists public.profiles (
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

create table if not exists public.user_permission_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permiso text not null references public.permissions (clave),
  valor text not null check (valor in ('permitir', 'denegar')),
  primary key (user_id, permiso)
);

create table if not exists public.projects (id text primary key, nombre text not null);
insert into public.projects values ('AMURA', 'AMURA Apartments') on conflict do nothing;

create table if not exists public.user_projects (
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id text not null references public.projects (id),
  primary key (user_id, project_id)
);

create table if not exists public.audit_log (
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

-- Solo lectura de catálogos (sin datos personales) para usuarios autenticados. Ninguna política de escritura:
-- los cambios de acceso se hacen con las funciones de 20261028220300 o con la función del servidor invitar-usuario.
drop policy if exists "catalogo legible" on public.permissions;
drop policy if exists "roles legibles" on public.roles;
drop policy if exists "permisos de rol legibles" on public.role_permissions;
drop policy if exists "proyectos legibles" on public.projects;
drop policy if exists "equipos legibles" on public.teams;
drop policy if exists "gerencias de equipo legibles" on public.team_managers;
create policy "catalogo legible" on public.permissions for select to authenticated using (true);
create policy "roles legibles" on public.roles for select to authenticated using (true);
create policy "permisos de rol legibles" on public.role_permissions for select to authenticated using (true);
create policy "proyectos legibles" on public.projects for select to authenticated using (true);
create policy "equipos legibles" on public.teams for select to authenticated using (true);
create policy "gerencias de equipo legibles" on public.team_managers for select to authenticated using (true);
