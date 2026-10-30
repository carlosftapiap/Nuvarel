-- AMURA · Plan de implementación: planes, frentes, fases, actividades, dependencias, evidencias, historial e importaciones.
-- Ejecutar después de 20261029010000_conexion_app.sql y luego volver a ejecutar supabase/seed_roles.sql (permisos plan.*).
-- No modifica tablas comerciales. Reutiliza perfiles, equipos, proyectos, permisos y auditoría existentes.
-- Convenciones: avance en porcentaje 0–100 (null = sin dato, distinto de 0); fechas sin hora (date); duración en días calendario inclusivos.

do $$ begin
  if to_regprocedure('public.tiene_permiso(text)') is null or to_regclass('public.projects') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Faltan dependencias: instala antes usuarios y permisos y el flujo comercial';
  end if;
end $$;

/* ------------------------------------------------------------------ tablas */

create table if not exists public.plan_plans (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects (id),
  codigo text not null check (codigo ~ '^[A-Z0-9][A-Z0-9_-]{1,30}$'),
  nombre text not null check (char_length(trim(nombre)) >= 3),
  fecha_corte date not null,
  alerta_dias int not null default 7 check (alerta_dias between 0 and 90),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (project_id, codigo)
);

-- Frentes del consolidado. El peso es null hasta que se defina; no se asignan pesos iguales automáticamente.
create table if not exists public.plan_frentes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plan_plans (id) on delete cascade,
  codigo text not null,
  nombre text not null,
  orden int not null default 0,
  peso numeric(9,4) check (peso is null or peso > 0),
  peso_validado boolean not null default false,
  incluido boolean not null default true,
  unique (plan_id, codigo),
  check (not peso_validado or peso is not null)
);

create table if not exists public.plan_fases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plan_plans (id) on delete cascade,
  frente_id uuid references public.plan_frentes (id),
  codigo text not null,
  nombre text not null,
  orden int not null default 0,
  unique (plan_id, codigo)
);

-- Gerencia por frente: acceso a las actividades de los frentes asignados.
create table if not exists public.plan_frente_gestores (
  frente_id uuid not null references public.plan_frentes (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  primary key (frente_id, user_id)
);

create table if not exists public.plan_activities (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plan_plans (id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$'),
  nombre text not null check (char_length(trim(nombre)) >= 3),
  descripcion text not null default '',
  resultado_esperado text not null default '',
  tipo text not null default 'actividad' check (tipo in ('actividad', 'hito')),
  frente_id uuid references public.plan_frentes (id),
  fase_id uuid references public.plan_fases (id),
  parent_id uuid references public.plan_activities (id),
  responsable_id uuid references public.profiles (id),
  equipo_id uuid references public.teams (id),
  -- Texto original del archivo (p. ej. "Área Comercial") mientras no se vincule a un usuario real.
  responsable_texto text,
  aprobador_texto text,
  base_inicio date, base_fin date,
  plan_inicio date, plan_fin date,
  real_inicio date, real_fin date,
  prioridad text check (prioridad in ('alta', 'media', 'baja')),
  peso numeric(9,4) check (peso is null or peso > 0),
  avance numeric(5,2) check (avance is null or avance between 0 and 100),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_ejecucion', 'completada', 'cancelada')),
  bloqueada boolean not null default false,
  motivo_bloqueo text,
  -- Una cancelada sigue en el historial; solo sale del cálculo con una modificación autorizada del alcance.
  excluida_alcance boolean not null default false,
  requiere_evidencia boolean not null default false,
  bloquea_lanzamiento boolean,
  observaciones text not null default '',
  fuente text not null default '',
  version int not null default 1,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (plan_id, codigo),
  check (parent_id is distinct from id),
  check (base_fin is null or base_inicio is null or base_fin >= base_inicio),
  check (plan_fin is null or plan_inicio is null or plan_fin >= plan_inicio),
  check (real_fin is null or real_inicio is null or real_fin >= real_inicio),
  check (estado <> 'completada' or (avance = 100 and real_fin is not null)),
  check (not bloqueada or char_length(coalesce(motivo_bloqueo, '')) >= 5),
  check (not excluida_alcance or estado = 'cancelada')
);
create index if not exists plan_activities_plan on public.plan_activities (plan_id);
create index if not exists plan_activities_responsable on public.plan_activities (responsable_id);
create index if not exists plan_activities_parent on public.plan_activities (parent_id);

create table if not exists public.plan_activity_collaborators (
  activity_id uuid not null references public.plan_activities (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  primary key (activity_id, user_id)
);

-- Dependencias fin a inicio: la sucesora no debería empezar antes de que termine la predecesora.
create table if not exists public.plan_dependencies (
  plan_id uuid not null references public.plan_plans (id) on delete cascade,
  predecesora_id uuid not null references public.plan_activities (id) on delete cascade,
  sucesora_id uuid not null references public.plan_activities (id) on delete cascade,
  tipo text not null default 'FS' check (tipo = 'FS'),
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (predecesora_id, sucesora_id),
  check (predecesora_id <> sucesora_id)
);

create table if not exists public.plan_history (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.plan_activities (id) on delete cascade,
  fecha timestamptz not null default now(),
  user_id uuid references auth.users (id),
  accion text not null,
  motivo text not null,
  antes jsonb,
  despues jsonb,
  import_id uuid
);
create index if not exists plan_history_activity on public.plan_history (activity_id, fecha desc);

create table if not exists public.plan_evidences (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.plan_activities (id) on delete cascade,
  tipo text not null check (tipo in ('enlace', 'archivo')),
  referencia text not null check (char_length(trim(referencia)) >= 3),
  descripcion text not null default '',
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (activity_id, referencia)
);

create table if not exists public.plan_imports (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plan_plans (id) on delete cascade,
  archivo text not null,
  hoja text not null,
  user_id uuid not null default auth.uid() references auth.users (id),
  fecha timestamptz not null default now(),
  resumen jsonb not null,
  cambios jsonb not null
);

/* ------------------------------------------------------------ alcance */

create or replace function public.mi_alcance_tipo() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(p.alcance, r.alcance) from profiles p join roles r on r.id = p.rol_id where p.id = auth.uid() and p.estado = 'activo'
$$;

-- Puede ver: responsable en su alcance (propio, equipo o empresa), colaborador, gestor del frente,
-- o actividad sin responsable para quien tiene alcance de empresa.
create or replace function public.plan_en_alcance(p_activity uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from plan_activities a
    where a.id = p_activity and (
      (a.responsable_id is not null and public.en_alcance(a.responsable_id))
      or exists (select 1 from plan_activity_collaborators c where c.activity_id = a.id and c.user_id = auth.uid())
      or exists (select 1 from plan_frente_gestores g where g.frente_id = a.frente_id and g.user_id = auth.uid())
      or (a.responsable_id is null and public.mi_alcance_tipo() = 'empresa')
    )
  )
$$;

-- Puede modificar: como ver, excepto colaboradores (solo consultan).
create or replace function public.plan_puede_modificar(p_activity uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tiene_permiso(p_permiso) and exists (
    select 1 from plan_activities a
    where a.id = p_activity and (
      (a.responsable_id is not null and public.en_alcance(a.responsable_id))
      or exists (select 1 from plan_frente_gestores g where g.frente_id = a.frente_id and g.user_id = auth.uid())
      or (a.responsable_id is null and public.mi_alcance_tipo() = 'empresa')
    )
  )
$$;

/* ---------------------------------------------------------------- RLS */

alter table public.plan_plans enable row level security;
alter table public.plan_frentes enable row level security;
alter table public.plan_fases enable row level security;
alter table public.plan_frente_gestores enable row level security;
alter table public.plan_activities enable row level security;
alter table public.plan_activity_collaborators enable row level security;
alter table public.plan_dependencies enable row level security;
alter table public.plan_history enable row level security;
alter table public.plan_evidences enable row level security;
alter table public.plan_imports enable row level security;

drop policy if exists "ver planes" on public.plan_plans;
drop policy if exists "ver frentes" on public.plan_frentes;
drop policy if exists "ver fases" on public.plan_fases;
drop policy if exists "ver gestores" on public.plan_frente_gestores;
drop policy if exists "ver actividades plan" on public.plan_activities;
drop policy if exists "ver colaboradores" on public.plan_activity_collaborators;
drop policy if exists "ver dependencias" on public.plan_dependencies;
drop policy if exists "ver historial plan" on public.plan_history;
drop policy if exists "ver evidencias" on public.plan_evidences;
drop policy if exists "ver importaciones" on public.plan_imports;
create policy "ver planes" on public.plan_plans for select to authenticated using (public.tiene_permiso('plan.ver'));
create policy "ver frentes" on public.plan_frentes for select to authenticated using (public.tiene_permiso('plan.ver'));
create policy "ver fases" on public.plan_fases for select to authenticated using (public.tiene_permiso('plan.ver'));
create policy "ver gestores" on public.plan_frente_gestores for select to authenticated using (public.tiene_permiso('plan.ver'));
create policy "ver actividades plan" on public.plan_activities for select to authenticated
  using (public.tiene_permiso('plan.ver') and public.plan_en_alcance(id));
create policy "ver colaboradores" on public.plan_activity_collaborators for select to authenticated
  using (public.tiene_permiso('plan.ver') and public.plan_en_alcance(activity_id));
-- Una dependencia es visible si se ve al menos una de sus actividades.
create policy "ver dependencias" on public.plan_dependencies for select to authenticated
  using (public.tiene_permiso('plan.ver') and (public.plan_en_alcance(predecesora_id) or public.plan_en_alcance(sucesora_id)));
create policy "ver historial plan" on public.plan_history for select to authenticated
  using (public.tiene_permiso('plan.ver') and public.plan_en_alcance(activity_id));
create policy "ver evidencias" on public.plan_evidences for select to authenticated
  using (public.tiene_permiso('plan.ver') and public.plan_en_alcance(activity_id));
create policy "ver importaciones" on public.plan_imports for select to authenticated using (public.tiene_permiso('plan.importar'));
-- Sin políticas de escritura: todo cambio pasa por las funciones siguientes (permiso, alcance, versión, motivo e historial).

/* ------------------------------------------------------------ utilidades */

create or replace function public.plan_registrar(p_activity uuid, p_accion text, p_motivo text, p_antes jsonb, p_despues jsonb, p_import uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into plan_history (activity_id, user_id, accion, motivo, antes, despues, import_id)
  values (p_activity, auth.uid(), p_accion, p_motivo, p_antes, p_despues, p_import)
$$;

-- Bloquea la fila y comprueba permiso, alcance y versión (detecta ediciones concurrentes).
create or replace function public.plan_tomar(p_id uuid, p_version int, p_permiso text) returns public.plan_activities
language plpgsql security definer set search_path = public as $$
declare a plan_activities;
begin
  select * into a from plan_activities where id = p_id for update;
  if not found or not public.plan_puede_modificar(p_id, p_permiso) then
    raise exception 'Actividad inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  if p_version is distinct from a.version then
    raise exception 'Otra persona modificó esta actividad (versión % → %). Recarga y vuelve a intentar.', p_version, a.version using errcode = '40001';
  end if;
  return a;
end $$;

create or replace function public.plan_motivo(p_motivo text) returns text language plpgsql immutable as $$
begin
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo (mínimo 5 caracteres)'; end if;
  return trim(p_motivo);
end $$;

-- Una actividad con hijas es un resumen: su avance se calcula, no se edita.
create or replace function public.plan_es_padre(p_id uuid) returns boolean language sql stable as $$
  select exists (select 1 from plan_activities h where h.parent_id = p_id)
$$;

-- Rechaza ciclos en la jerarquía y en las dependencias.
create or replace function public.plan_crea_ciclo_dep(p_pred uuid, p_suc uuid) returns boolean language sql stable as $$
  with recursive cadena(id) as (
    select p_suc
    union
    select d.sucesora_id from plan_dependencies d join cadena c on d.predecesora_id = c.id
  )
  select exists (select 1 from cadena where id = p_pred)
$$;

create or replace function public.plan_crea_ciclo_padre(p_id uuid, p_parent uuid) returns boolean language sql stable as $$
  with recursive arriba(id) as (
    select p_parent
    union
    select a.parent_id from plan_activities a join arriba x on a.id = x.id where a.parent_id is not null
  )
  select p_parent is not null and exists (select 1 from arriba where id = p_id)
$$;

/* ------------------------------------------------------------- planes */

-- Crea el plan con los seis frentes del consolidado, sin pesos (pendientes de definir).
create or replace function public.plan_crear(p_project text, p_codigo text, p_nombre text, p_fecha_corte date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.tiene_permiso('plan.alcance') then raise exception 'Sin permiso para crear planes' using errcode = '42501'; end if;
  insert into plan_plans (project_id, codigo, nombre, fecha_corte) values (p_project, upper(trim(p_codigo)), trim(p_nombre), p_fecha_corte) returning id into v_id;
  insert into plan_frentes (plan_id, codigo, nombre, orden) values
    (v_id, 'COM', 'Comercial', 1), (v_id, 'MKT', 'Marketing', 2), (v_id, 'LEG', 'Legal', 3),
    (v_id, 'TEC', 'Tecnología', 4), (v_id, 'FIN', 'Finanzas', 5), (v_id, 'CON', 'Construcción', 6);
  perform public.auditar('Crear plan', 'plan', v_id::text, 'Plan ' || trim(p_nombre), null, jsonb_build_object('codigo', upper(trim(p_codigo)), 'proyecto', p_project));
  return v_id;
end $$;

create or replace function public.plan_configurar(p_plan uuid, p_fecha_corte date, p_alerta_dias int, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p plan_plans; v_m text := public.plan_motivo(p_motivo);
begin
  if not public.tiene_permiso('plan.alcance') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into p from plan_plans where id = p_plan for update;
  if not found then raise exception 'Plan inexistente'; end if;
  update plan_plans set fecha_corte = p_fecha_corte, alerta_dias = p_alerta_dias where id = p_plan;
  perform public.auditar('Configurar plan', 'plan', p_plan::text, v_m, jsonb_build_object('fecha_corte', p.fecha_corte, 'alerta_dias', p.alerta_dias),
    jsonb_build_object('fecha_corte', p_fecha_corte, 'alerta_dias', p_alerta_dias));
end $$;

create or replace function public.plan_frente_peso(p_frente uuid, p_peso numeric, p_validado boolean, p_incluido boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare f plan_frentes; v_m text := public.plan_motivo(p_motivo);
begin
  if not public.tiene_permiso('plan.alcance') then raise exception 'Sin permiso para modificar pesos y alcance' using errcode = '42501'; end if;
  if p_peso is not null and p_peso <= 0 then raise exception 'El peso debe ser positivo'; end if;
  if p_validado and p_peso is null then raise exception 'No se puede validar un frente sin peso'; end if;
  select * into f from plan_frentes where id = p_frente for update;
  if not found then raise exception 'Frente inexistente'; end if;
  update plan_frentes set peso = p_peso, peso_validado = p_validado, incluido = p_incluido where id = p_frente;
  perform public.auditar('Peso de frente', 'plan_frente', p_frente::text, v_m,
    jsonb_build_object('peso', f.peso, 'validado', f.peso_validado, 'incluido', f.incluido),
    jsonb_build_object('peso', p_peso, 'validado', p_validado, 'incluido', p_incluido));
end $$;

create or replace function public.plan_frente_gestor(p_frente uuid, p_user uuid, p_asignar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.plan_motivo(p_motivo);
begin
  if not public.tiene_permiso('plan.alcance') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_asignar then insert into plan_frente_gestores values (p_frente, p_user) on conflict do nothing;
  else delete from plan_frente_gestores where frente_id = p_frente and user_id = p_user; end if;
  perform public.auditar(case when p_asignar then 'Asignar gestor de frente' else 'Quitar gestor de frente' end, 'plan_frente', p_frente::text, v_m, null, jsonb_build_object('usuario', p_user));
end $$;

create or replace function public.plan_fase_guardar(p_plan uuid, p_codigo text, p_nombre text, p_frente uuid, p_orden int) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.tiene_permiso('plan.alcance') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_frente is not null and not exists (select 1 from plan_frentes where id = p_frente and plan_id = p_plan) then raise exception 'El frente no pertenece al plan'; end if;
  insert into plan_fases (plan_id, codigo, nombre, frente_id, orden) values (p_plan, trim(p_codigo), trim(p_nombre), p_frente, coalesce(p_orden, 0))
  on conflict (plan_id, codigo) do update set nombre = excluded.nombre, frente_id = excluded.frente_id, orden = excluded.orden
  returning id into v_id;
  -- Las actividades de la fase heredan su frente.
  update plan_activities set frente_id = p_frente, version = version + 1, updated_at = now(), updated_by = auth.uid()
  where fase_id = v_id and frente_id is distinct from p_frente;
  return v_id;
end $$;

/* ---------------------------------------------------------- actividades */

-- Alta o edición de datos descriptivos. Fechas, responsable, peso y avance tienen sus propias funciones.
create or replace function public.plan_actividad_guardar(p_plan uuid, p_id uuid, p_version int, p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_id uuid; v_parent uuid := nullif(p_datos ->> 'parent_id', '')::uuid; v_fase uuid := nullif(p_datos ->> 'fase_id', '')::uuid;
  v_frente uuid := nullif(p_datos ->> 'frente_id', '')::uuid; v_ini date := nullif(p_datos ->> 'plan_inicio', '')::date; v_fin date := nullif(p_datos ->> 'plan_fin', '')::date;
begin
  if v_parent is not null and not exists (select 1 from plan_activities where id = v_parent and plan_id = p_plan) then raise exception 'La actividad superior no existe en este plan'; end if;
  if v_fase is not null then
    select coalesce(f.frente_id, v_frente) into v_frente from plan_fases f where f.id = v_fase and f.plan_id = p_plan;
    if not found then raise exception 'La fase no pertenece al plan'; end if;
  end if;
  if v_frente is not null and not exists (select 1 from plan_frentes where id = v_frente and plan_id = p_plan) then raise exception 'El frente no pertenece al plan'; end if;
  if v_ini is not null and v_fin is not null and v_fin < v_ini then raise exception 'La fecha de fin debe ser igual o posterior al inicio'; end if;

  if p_id is null then
    if not public.tiene_permiso('plan.editar') then raise exception 'Sin permiso para crear actividades' using errcode = '42501'; end if;
    insert into plan_activities (plan_id, codigo, nombre, descripcion, resultado_esperado, tipo, frente_id, fase_id, parent_id, prioridad,
                                 requiere_evidencia, observaciones, base_inicio, base_fin, plan_inicio, plan_fin, updated_by)
    values (p_plan, trim(p_datos ->> 'codigo'), trim(p_datos ->> 'nombre'), coalesce(p_datos ->> 'descripcion', ''), coalesce(p_datos ->> 'resultado_esperado', ''),
            coalesce(p_datos ->> 'tipo', 'actividad'), v_frente, v_fase, v_parent, nullif(p_datos ->> 'prioridad', ''),
            coalesce((p_datos ->> 'requiere_evidencia')::boolean, false), coalesce(p_datos ->> 'observaciones', ''), v_ini, v_fin, v_ini, v_fin, auth.uid())
    returning id into v_id;
    perform public.plan_registrar(v_id, 'Crear actividad', coalesce(nullif(trim(p_motivo), ''), 'Alta de actividad'), null, to_jsonb((select x from plan_activities x where x.id = v_id)));
    return v_id;
  end if;

  a := public.plan_tomar(p_id, p_version, 'plan.editar');
  if v_parent is not null and public.plan_crea_ciclo_padre(p_id, v_parent) then raise exception 'La actividad superior generaría un ciclo en la jerarquía'; end if;
  update plan_activities set
    nombre = coalesce(trim(p_datos ->> 'nombre'), nombre), descripcion = coalesce(p_datos ->> 'descripcion', descripcion),
    resultado_esperado = coalesce(p_datos ->> 'resultado_esperado', resultado_esperado), tipo = coalesce(p_datos ->> 'tipo', tipo),
    frente_id = case when p_datos ? 'frente_id' or p_datos ? 'fase_id' then v_frente else frente_id end,
    fase_id = case when p_datos ? 'fase_id' then v_fase else fase_id end,
    parent_id = case when p_datos ? 'parent_id' then v_parent else parent_id end,
    prioridad = case when p_datos ? 'prioridad' then nullif(p_datos ->> 'prioridad', '') else prioridad end,
    requiere_evidencia = coalesce((p_datos ->> 'requiere_evidencia')::boolean, requiere_evidencia),
    observaciones = coalesce(p_datos ->> 'observaciones', observaciones),
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  -- Una actividad que pasa a tener hijas deja de tener avance propio (se calcula).
  if v_parent is not null then update plan_activities set avance = null where id = v_parent and avance is not null; end if;
  perform public.plan_registrar(p_id, 'Editar actividad', public.plan_motivo(p_motivo), to_jsonb(a), to_jsonb((select x from plan_activities x where x.id = p_id)));
  return p_id;
end $$;

create or replace function public.plan_actividad_asignar(p_id uuid, p_version int, p_responsable uuid, p_equipo uuid, p_colaboradores uuid[], p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_m text := public.plan_motivo(p_motivo); v_antes uuid[];
begin
  a := public.plan_tomar(p_id, p_version, 'plan.asignar');
  if p_responsable is not null and not exists (select 1 from profiles where id = p_responsable and estado = 'activo') then raise exception 'El responsable debe ser un usuario activo'; end if;
  -- Asignar a alguien fuera del propio alcance no está permitido (salvo alcance de empresa).
  if p_responsable is not null and not public.en_alcance(p_responsable) then raise exception 'No puedes asignar a una persona fuera de tu alcance' using errcode = '42501'; end if;
  select array_agg(user_id order by user_id) into v_antes from plan_activity_collaborators where activity_id = p_id;
  update plan_activities set responsable_id = p_responsable, equipo_id = p_equipo, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_id;
  delete from plan_activity_collaborators where activity_id = p_id;
  insert into plan_activity_collaborators select p_id, unnest(coalesce(p_colaboradores, '{}')) on conflict do nothing;
  perform public.plan_registrar(p_id, 'Asignar responsable', v_m,
    jsonb_build_object('responsable_id', a.responsable_id, 'equipo_id', a.equipo_id, 'colaboradores', v_antes),
    jsonb_build_object('responsable_id', p_responsable, 'equipo_id', p_equipo, 'colaboradores', p_colaboradores));
end $$;

-- Avance de una actividad de último nivel. Bajar el avance es una corrección y exige motivo.
create or replace function public.plan_actividad_avance(p_id uuid, p_version int, p_avance numeric, p_real_inicio date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_estado text;
begin
  a := public.plan_tomar(p_id, p_version, 'plan.avance');
  if public.plan_es_padre(p_id) then raise exception 'El avance de una actividad superior se calcula desde sus subactividades'; end if;
  if a.estado in ('completada', 'cancelada') then raise exception 'La actividad está %; reábrela para actualizar el avance', a.estado; end if;
  if p_avance is not null and (p_avance < 0 or p_avance > 100) then raise exception 'El avance debe estar entre 0 y 100'; end if;
  if a.avance is not null and (p_avance is null or p_avance < a.avance) then perform public.plan_motivo(p_motivo); end if;
  v_estado := case when a.estado = 'pendiente' and coalesce(p_avance, 0) > 0 then 'en_ejecucion' else a.estado end;
  update plan_activities set avance = p_avance, real_inicio = coalesce(p_real_inicio, real_inicio, case when coalesce(p_avance, 0) > 0 then (now() at time zone 'America/Guayaquil')::date end),
    estado = v_estado, version = version + 1, updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  perform public.plan_registrar(p_id, case when a.avance is not null and (p_avance is null or p_avance < a.avance) then 'Corrección de avance' else 'Actualizar avance' end,
    coalesce(nullif(trim(p_motivo), ''), 'Actualización de avance'),
    jsonb_build_object('avance', a.avance, 'estado', a.estado, 'real_inicio', a.real_inicio),
    jsonb_build_object('avance', p_avance, 'estado', v_estado, 'real_inicio', (select real_inicio from plan_activities where id = p_id)));
end $$;

-- Sucesoras cuyo inicio quedaría antes del nuevo fin (dependencia fin a inicio). No se mueven automáticamente.
create or replace function public.plan_impacto(p_id uuid, p_fin date) returns table (codigo text, nombre text, plan_inicio date, conflicto boolean)
language sql stable security definer set search_path = public as $$
  select s.codigo, s.nombre, s.plan_inicio, (s.plan_inicio is not null and p_fin is not null and s.plan_inicio <= p_fin)
  from plan_dependencies d join plan_activities s on s.id = d.sucesora_id
  where d.predecesora_id = p_id and public.plan_en_alcance(s.id)
  order by s.codigo
$$;

-- Reprogramar: cambia las fechas vigentes y conserva la línea base. La primera programación fija la línea base.
create or replace function public.plan_actividad_reprogramar(p_id uuid, p_version int, p_inicio date, p_fin date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_m text := public.plan_motivo(p_motivo);
begin
  a := public.plan_tomar(p_id, p_version, 'plan.reprogramar');
  if p_inicio is null or p_fin is null then raise exception 'Indica inicio y fin'; end if;
  if p_fin < p_inicio then raise exception 'La fecha de fin debe ser igual o posterior al inicio'; end if;
  update plan_activities set plan_inicio = p_inicio, plan_fin = p_fin,
    base_inicio = coalesce(base_inicio, p_inicio), base_fin = coalesce(base_fin, p_fin),
    version = version + 1, updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  perform public.plan_registrar(p_id, 'Reprogramar', v_m,
    jsonb_build_object('plan_inicio', a.plan_inicio, 'plan_fin', a.plan_fin, 'base_inicio', a.base_inicio, 'base_fin', a.base_fin),
    jsonb_build_object('plan_inicio', p_inicio, 'plan_fin', p_fin, 'base_inicio', coalesce(a.base_inicio, p_inicio), 'base_fin', coalesce(a.base_fin, p_fin)));
end $$;

create or replace function public.plan_actividad_peso(p_id uuid, p_version int, p_peso numeric, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_m text := public.plan_motivo(p_motivo);
begin
  a := public.plan_tomar(p_id, p_version, 'plan.alcance');
  if p_peso is not null and p_peso <= 0 then raise exception 'El peso debe ser positivo'; end if;
  update plan_activities set peso = p_peso, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_id;
  perform public.plan_registrar(p_id, 'Modificar peso', v_m, jsonb_build_object('peso', a.peso), jsonb_build_object('peso', p_peso));
end $$;

-- Cerrar, reabrir, cancelar, excluir del alcance, bloquear y desbloquear.
create or replace function public.plan_actividad_estado(p_id uuid, p_version int, p_accion text, p_fecha date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_m text := public.plan_motivo(p_motivo); v_permiso text;
begin
  v_permiso := case p_accion when 'cerrar' then 'plan.cerrar' when 'reabrir' then 'plan.cerrar' when 'cancelar' then 'plan.cerrar'
    when 'excluir' then 'plan.alcance' when 'incluir' then 'plan.alcance' when 'bloquear' then 'plan.avance' when 'desbloquear' then 'plan.avance' end;
  if v_permiso is null then raise exception 'Acción no válida'; end if;
  a := public.plan_tomar(p_id, p_version, v_permiso);
  if p_accion = 'cerrar' then
    if public.plan_es_padre(p_id) then
      if exists (select 1 from plan_activities h where h.parent_id = p_id and h.estado not in ('completada', 'cancelada')) then
        raise exception 'Cierra primero las subactividades';
      end if;
    elsif coalesce(a.avance, 0) < 100 then raise exception 'Para cerrar, el avance debe ser 100%%';
    end if;
    if p_fecha is null then raise exception 'Indica la fecha real de fin'; end if;
    if a.real_inicio is not null and p_fecha < a.real_inicio then raise exception 'La fecha real de fin no puede ser anterior al inicio real'; end if;
    if a.requiere_evidencia and not exists (select 1 from plan_evidences e where e.activity_id = p_id) then raise exception 'Falta la evidencia obligatoria'; end if;
    update plan_activities set estado = 'completada', avance = 100, real_fin = p_fecha, real_inicio = coalesce(real_inicio, p_fecha), bloqueada = false, motivo_bloqueo = null where id = p_id;
  elsif p_accion = 'reabrir' then
    if a.estado not in ('completada', 'cancelada') then raise exception 'Solo se reabren actividades completadas o canceladas'; end if;
    update plan_activities set estado = case when a.avance > 0 then 'en_ejecucion' else 'pendiente' end, real_fin = null, excluida_alcance = false where id = p_id;
  elsif p_accion = 'cancelar' then
    if a.estado = 'cancelada' then raise exception 'La actividad ya está cancelada'; end if;
    update plan_activities set estado = 'cancelada', bloqueada = false, motivo_bloqueo = null where id = p_id;
  elsif p_accion in ('excluir', 'incluir') then
    if p_accion = 'excluir' and a.estado <> 'cancelada' then raise exception 'Solo una actividad cancelada puede excluirse del cálculo'; end if;
    update plan_activities set excluida_alcance = (p_accion = 'excluir') where id = p_id;
  elsif p_accion = 'bloquear' then
    update plan_activities set bloqueada = true, motivo_bloqueo = v_m where id = p_id;
  else
    update plan_activities set bloqueada = false, motivo_bloqueo = null where id = p_id;
  end if;
  update plan_activities set version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_id;
  perform public.plan_registrar(p_id, initcap(p_accion), v_m,
    jsonb_build_object('estado', a.estado, 'avance', a.avance, 'real_fin', a.real_fin, 'bloqueada', a.bloqueada, 'excluida_alcance', a.excluida_alcance),
    (select jsonb_build_object('estado', x.estado, 'avance', x.avance, 'real_fin', x.real_fin, 'bloqueada', x.bloqueada, 'excluida_alcance', x.excluida_alcance) from plan_activities x where x.id = p_id));
end $$;

create or replace function public.plan_dependencia(p_pred uuid, p_suc uuid, p_agregar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.plan_motivo(p_motivo); v_plan uuid;
begin
  if not (public.plan_puede_modificar(p_suc, 'plan.dependencias')) then raise exception 'Sin permiso sobre la actividad sucesora' using errcode = '42501'; end if;
  if p_pred = p_suc then raise exception 'Una actividad no puede depender de sí misma'; end if;
  select plan_id into v_plan from plan_activities where id = p_suc;
  if not exists (select 1 from plan_activities where id = p_pred and plan_id = v_plan) then raise exception 'La predecesora no existe en este plan'; end if;
  if p_agregar then
    if public.plan_crea_ciclo_dep(p_pred, p_suc) then raise exception 'La dependencia generaría un ciclo'; end if;
    insert into plan_dependencies (plan_id, predecesora_id, sucesora_id) values (v_plan, p_pred, p_suc) on conflict do nothing;
  else
    delete from plan_dependencies where predecesora_id = p_pred and sucesora_id = p_suc;
  end if;
  update plan_activities set version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_suc;
  perform public.plan_registrar(p_suc, case when p_agregar then 'Agregar dependencia' else 'Quitar dependencia' end, v_m, null,
    jsonb_build_object('predecesora', (select codigo from plan_activities where id = p_pred)));
end $$;

create or replace function public.plan_evidencia(p_id uuid, p_tipo text, p_referencia text, p_descripcion text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.plan_puede_modificar(p_id, 'plan.avance') then raise exception 'Actividad inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  insert into plan_evidences (activity_id, tipo, referencia, descripcion) values (p_id, p_tipo, trim(p_referencia), coalesce(trim(p_descripcion), ''))
  on conflict (activity_id, referencia) do nothing returning id into v_id;
  if v_id is not null then
    perform public.plan_registrar(p_id, 'Agregar evidencia', 'Evidencia ' || p_tipo, null, jsonb_build_object('referencia', trim(p_referencia)));
  end if;
  return v_id;
end $$;

/* ------------------------------------------------------------ importación */

-- Aplica un lote confirmado en una sola transacción. Cada fila trae solo los campos que el usuario eligió actualizar
-- (un campo ausente no se toca; una celda vacía solo borra si viene explícitamente como null).
-- Clave: plan + código. No elimina actividades ausentes del archivo. Reimportar el mismo contenido no cambia nada.
create or replace function public.plan_importar(p_plan uuid, p_archivo text, p_hoja text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_import uuid := gen_random_uuid();
  f jsonb; a plan_activities; v_id uuid; v_nuevas int := 0; v_act int := 0; v_igual int := 0; v_cambios jsonb := '[]'::jsonb;
  v_antes jsonb; v_despues jsonb; v_fase uuid; v_frente uuid; v_pred uuid; k text;
begin
  if not public.tiene_permiso('plan.importar') then raise exception 'Sin permiso para importar' using errcode = '42501'; end if;
  if not exists (select 1 from plan_plans where id = p_plan) then raise exception 'Plan inexistente'; end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_fase := null; v_frente := null;
    if f ? 'fase_codigo' and nullif(f ->> 'fase_codigo', '') is not null then
      select id, frente_id into v_fase, v_frente from plan_fases where plan_id = p_plan and codigo = f ->> 'fase_codigo';
      if v_fase is null then raise exception 'Fila %: la fase % no existe en el plan', f ->> 'fila', f ->> 'fase_codigo'; end if;
    end if;
    select * into a from plan_activities where plan_id = p_plan and codigo = f ->> 'codigo' for update;

    if not found then
      if not public.tiene_permiso('plan.editar') then raise exception 'Fila %: sin permiso para crear actividades', f ->> 'fila' using errcode = '42501'; end if;
      if f ? 'responsable_id' and nullif(f ->> 'responsable_id', '') is not null and not public.tiene_permiso('plan.asignar') then
        raise exception 'Fila %: sin permiso para asignar responsables', f ->> 'fila' using errcode = '42501';
      end if;
      insert into plan_activities (plan_id, codigo, nombre, descripcion, resultado_esperado, tipo, fase_id, frente_id, responsable_id, responsable_texto, aprobador_texto,
        base_inicio, base_fin, plan_inicio, plan_fin, avance, estado, bloquea_lanzamiento, observaciones, fuente, peso, updated_by)
      values (p_plan, f ->> 'codigo', f ->> 'nombre', coalesce(f ->> 'descripcion', ''), coalesce(f ->> 'resultado_esperado', ''), coalesce(f ->> 'tipo', 'actividad'),
        v_fase, v_frente, nullif(f ->> 'responsable_id', '')::uuid, f ->> 'responsable_texto', f ->> 'aprobador_texto',
        nullif(f ->> 'plan_inicio', '')::date, nullif(f ->> 'plan_fin', '')::date, nullif(f ->> 'plan_inicio', '')::date, nullif(f ->> 'plan_fin', '')::date,
        nullif(f ->> 'avance', '')::numeric, coalesce(f ->> 'estado', 'pendiente'), (f ->> 'bloquea_lanzamiento')::boolean,
        coalesce(f ->> 'observaciones', ''), coalesce(f ->> 'fuente', ''), nullif(f ->> 'peso', '')::numeric, auth.uid())
      returning id into v_id;
      v_nuevas := v_nuevas + 1;
      v_cambios := v_cambios || jsonb_build_object('codigo', f ->> 'codigo', 'tipo', 'nueva');
      perform public.plan_registrar(v_id, 'Importar (nueva)', 'Importación ' || p_archivo, null, f - 'fila', v_import);
    else
      v_id := a.id;
      if not public.plan_en_alcance(a.id) and not (a.responsable_id is null and public.mi_alcance_tipo() = 'empresa') then
        raise exception 'Fila %: la actividad % está fuera de tu alcance', f ->> 'fila', a.codigo using errcode = '42501';
      end if;
      v_antes := '{}'::jsonb; v_despues := '{}'::jsonb;
      for k in select jsonb_object_keys(f) loop
        continue when k in ('fila', 'codigo', 'fase_codigo', 'predecesora', 'evidencia');
        if (to_jsonb(a) -> k) is distinct from (f -> k)
           and not (k in ('plan_inicio', 'plan_fin') and (to_jsonb(a) ->> k) is not distinct from (f ->> k))
           and not (k in ('avance', 'peso') and (to_jsonb(a) ->> k)::numeric is not distinct from nullif(f ->> k, '')::numeric) then
          v_antes := v_antes || jsonb_build_object(k, to_jsonb(a) -> k);
          v_despues := v_despues || jsonb_build_object(k, f -> k);
        end if;
      end loop;
      if f ? 'fase_codigo' and v_fase is distinct from a.fase_id then
        v_antes := v_antes || jsonb_build_object('fase_id', a.fase_id); v_despues := v_despues || jsonb_build_object('fase_id', v_fase);
      end if;
      if v_despues = '{}'::jsonb then
        v_igual := v_igual + 1;
      else
        -- Cada tipo de cambio exige su permiso, igual que en la edición manual.
        if (v_despues ?| array['nombre', 'descripcion', 'resultado_esperado', 'tipo', 'fase_id', 'observaciones', 'bloquea_lanzamiento', 'fuente', 'aprobador_texto', 'responsable_texto']) and not public.plan_puede_modificar(a.id, 'plan.editar') then
          raise exception 'Fila %: sin permiso para editar %', f ->> 'fila', a.codigo using errcode = '42501'; end if;
        if (v_despues ? 'responsable_id') and not public.plan_puede_modificar(a.id, 'plan.asignar') then
          raise exception 'Fila %: sin permiso para reasignar %', f ->> 'fila', a.codigo using errcode = '42501'; end if;
        if (v_despues ?| array['plan_inicio', 'plan_fin']) and not public.plan_puede_modificar(a.id, 'plan.reprogramar') then
          raise exception 'Fila %: sin permiso para reprogramar %', f ->> 'fila', a.codigo using errcode = '42501'; end if;
        if (v_despues ?| array['avance', 'estado']) and not public.plan_puede_modificar(a.id, 'plan.avance') then
          raise exception 'Fila %: sin permiso para actualizar avance de %', f ->> 'fila', a.codigo using errcode = '42501'; end if;
        if (v_despues ? 'peso') and not public.plan_puede_modificar(a.id, 'plan.alcance') then
          raise exception 'Fila %: sin permiso para modificar el peso de %', f ->> 'fila', a.codigo using errcode = '42501'; end if;
        if (v_despues ? 'estado') and (f ->> 'estado') = 'completada' and a.estado <> 'completada' then
          raise exception 'Fila %: una actividad se cierra desde la aplicación con fecha real y evidencias, no por importación', f ->> 'fila';
        end if;
        update plan_activities set
          nombre = case when f ? 'nombre' then f ->> 'nombre' else nombre end,
          descripcion = case when f ? 'descripcion' then coalesce(f ->> 'descripcion', '') else descripcion end,
          resultado_esperado = case when f ? 'resultado_esperado' then coalesce(f ->> 'resultado_esperado', '') else resultado_esperado end,
          tipo = case when f ? 'tipo' then f ->> 'tipo' else tipo end,
          fase_id = case when f ? 'fase_codigo' then v_fase else fase_id end,
          frente_id = case when f ? 'fase_codigo' then v_frente else frente_id end,
          responsable_id = case when f ? 'responsable_id' then nullif(f ->> 'responsable_id', '')::uuid else responsable_id end,
          responsable_texto = case when f ? 'responsable_texto' then f ->> 'responsable_texto' else responsable_texto end,
          aprobador_texto = case when f ? 'aprobador_texto' then f ->> 'aprobador_texto' else aprobador_texto end,
          plan_inicio = case when f ? 'plan_inicio' then nullif(f ->> 'plan_inicio', '')::date else plan_inicio end,
          plan_fin = case when f ? 'plan_fin' then nullif(f ->> 'plan_fin', '')::date else plan_fin end,
          base_inicio = coalesce(base_inicio, case when f ? 'plan_inicio' then nullif(f ->> 'plan_inicio', '')::date end),
          base_fin = coalesce(base_fin, case when f ? 'plan_fin' then nullif(f ->> 'plan_fin', '')::date end),
          avance = case when f ? 'avance' then nullif(f ->> 'avance', '')::numeric else avance end,
          estado = case when f ? 'estado' then f ->> 'estado' else estado end,
          bloquea_lanzamiento = case when f ? 'bloquea_lanzamiento' then (f ->> 'bloquea_lanzamiento')::boolean else bloquea_lanzamiento end,
          observaciones = case when f ? 'observaciones' then coalesce(f ->> 'observaciones', '') else observaciones end,
          fuente = case when f ? 'fuente' then coalesce(f ->> 'fuente', '') else fuente end,
          peso = case when f ? 'peso' then nullif(f ->> 'peso', '')::numeric else peso end,
          version = version + 1, updated_at = now(), updated_by = auth.uid()
        where id = a.id;
        v_act := v_act + 1;
        v_cambios := v_cambios || jsonb_build_object('codigo', a.codigo, 'tipo', 'actualizada', 'antes', v_antes, 'despues', v_despues);
        perform public.plan_registrar(a.id, 'Importar (actualización)', 'Importación ' || p_archivo, v_antes, v_despues, v_import);
      end if;
    end if;
    -- Evidencia (enlace) del archivo: no se duplica al reimportar.
    if nullif(trim(coalesce(f ->> 'evidencia', '')), '') is not null then
      insert into plan_evidences (activity_id, tipo, referencia, descripcion)
      values (v_id, 'enlace', trim(f ->> 'evidencia'), 'Importada de ' || p_archivo)
      on conflict (activity_id, referencia) do nothing;
    end if;
  end loop;

  -- Dependencias después de crear todas las filas (la predecesora puede venir más abajo en el archivo).
  for f in select * from jsonb_array_elements(p_filas) where value ? 'predecesora' and nullif(value ->> 'predecesora', '') is not null loop
    select id into v_id from plan_activities where plan_id = p_plan and codigo = f ->> 'codigo';
    select id into v_pred from plan_activities where plan_id = p_plan and codigo = f ->> 'predecesora';
    if v_pred is null then raise exception 'Fila %: la predecesora % no existe', f ->> 'fila', f ->> 'predecesora'; end if;
    if v_pred = v_id then raise exception 'Fila %: una actividad no puede depender de sí misma', f ->> 'fila'; end if;
    if not exists (select 1 from plan_dependencies where predecesora_id = v_pred and sucesora_id = v_id) then
      if not public.plan_puede_modificar(v_id, 'plan.dependencias') and not public.tiene_permiso('plan.dependencias') then
        raise exception 'Fila %: sin permiso para gestionar dependencias', f ->> 'fila' using errcode = '42501';
      end if;
      if public.plan_crea_ciclo_dep(v_pred, v_id) then raise exception 'Fila %: la dependencia con % generaría un ciclo', f ->> 'fila', f ->> 'predecesora'; end if;
      insert into plan_dependencies (plan_id, predecesora_id, sucesora_id) values (p_plan, v_pred, v_id);
      v_cambios := v_cambios || jsonb_build_object('codigo', f ->> 'codigo', 'tipo', 'dependencia', 'predecesora', f ->> 'predecesora');
    end if;
  end loop;

  insert into plan_imports (id, plan_id, archivo, hoja, resumen, cambios)
  values (v_import, p_plan, p_archivo, p_hoja, jsonb_build_object('nuevas', v_nuevas, 'actualizadas', v_act, 'sin_cambios', v_igual), v_cambios);
  perform public.auditar('Importar plan', 'plan', p_plan::text, 'Importación de ' || p_archivo || ' (' || p_hoja || ')', null,
    jsonb_build_object('nuevas', v_nuevas, 'actualizadas', v_act, 'sin_cambios', v_igual));
  return jsonb_build_object('import_id', v_import, 'nuevas', v_nuevas, 'actualizadas', v_act, 'sin_cambios', v_igual);
end $$;

/* ------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.plan_crear(text, text, text, date)', 'public.plan_configurar(uuid, date, int, text)',
    'public.plan_frente_peso(uuid, numeric, boolean, boolean, text)', 'public.plan_frente_gestor(uuid, uuid, boolean, text)',
    'public.plan_fase_guardar(uuid, text, text, uuid, int)', 'public.plan_actividad_guardar(uuid, uuid, int, jsonb, text)',
    'public.plan_actividad_asignar(uuid, int, uuid, uuid, uuid[], text)', 'public.plan_actividad_avance(uuid, int, numeric, date, text)',
    'public.plan_impacto(uuid, date)', 'public.plan_actividad_reprogramar(uuid, int, date, date, text)',
    'public.plan_actividad_peso(uuid, int, numeric, text)', 'public.plan_actividad_estado(uuid, int, text, date, text)',
    'public.plan_dependencia(uuid, uuid, boolean, text)', 'public.plan_evidencia(uuid, text, text, text)',
    'public.plan_importar(uuid, text, text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array['public.plan_registrar(uuid, text, text, jsonb, jsonb, uuid)', 'public.plan_tomar(uuid, int, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
