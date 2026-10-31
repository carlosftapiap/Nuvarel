-- AMURA · Avance de obra (etapa 2). Módulo independiente del Plan de implementación comercial.
-- Cuatro frentes: Terreno y precarga, Urbanismo y áreas comunes, Edificio 1 y Edificio 2, cada uno con su cronograma.
-- Nada se inventa: fechas, pesos y porcentajes nacen vacíos. El avance validado es el oficial; solo lo valida quien no lo registró.
-- Nada se borra: una actividad se cancela, un avance se rechaza, una evidencia se retira con motivo.
-- Ejecutar después de 20261031110000_datos_en_base.sql. NO APLICAR en producción sin respaldo verificado y autorización.

begin;

do $$ begin
  if to_regclass('public.profiles') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null
     or to_regprocedure('public.tiene_permiso(text)') is null then
    raise exception 'Falta la base de AMURA: aplica antes las migraciones anteriores';
  end if;
end $$;

/* ------------------------------------------------------------------ permisos */

insert into public.permissions (clave, modulo, descripcion) values
  ('obra.resumen', 'Avance de obra', 'Consultar el resumen de avances oficiales (validados)'),
  ('obra.ver', 'Avance de obra', 'Consultar cronograma, actividades, avances y evidencias'),
  ('obra.editar', 'Avance de obra', 'Crear, editar y reorganizar actividades, fechas, responsables y dependencias'),
  ('obra.avance', 'Avance de obra', 'Registrar avances, controles técnicos y cargar evidencias'),
  ('obra.validar', 'Avance de obra', 'Validar avances, ponderaciones y cronogramas'),
  ('obra.documentos', 'Avance de obra', 'Consultar informes, actas, planos y reportes técnicos'),
  ('obra.importar', 'Avance de obra', 'Importar el cronograma desde Excel'),
  ('obra.exportar', 'Avance de obra', 'Exportar el cronograma y los reportes')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.role_permissions (role_id, permiso)
select x.rol, x.permiso from (values
  ('administrador', 'obra.resumen'), ('administrador', 'obra.ver'), ('administrador', 'obra.editar'), ('administrador', 'obra.avance'),
  ('administrador', 'obra.validar'), ('administrador', 'obra.documentos'), ('administrador', 'obra.importar'), ('administrador', 'obra.exportar'),
  ('gerencia', 'obra.resumen'), ('gerencia', 'obra.ver'), ('gerencia', 'obra.validar'), ('gerencia', 'obra.documentos'), ('gerencia', 'obra.exportar'),
  ('constructor', 'obra.resumen'), ('constructor', 'obra.ver'), ('constructor', 'obra.editar'), ('constructor', 'obra.avance'),
  ('constructor', 'obra.documentos'), ('constructor', 'obra.importar'), ('constructor', 'obra.exportar'),
  ('supervisor', 'obra.resumen'), ('asesor', 'obra.resumen'), ('corredor', 'obra.resumen'),
  ('finanzas', 'obra.resumen'), ('finanzas', 'obra.ver'), ('finanzas', 'obra.exportar'),
  ('legal', 'obra.resumen'), ('legal', 'obra.documentos'),
  ('jarval', 'obra.resumen'), ('jarval', 'obra.exportar')
) as x(rol, permiso) where exists (select 1 from public.roles r where r.id = x.rol)
on conflict do nothing;

/* -------------------------------------------------------------------- tablas */

create table if not exists public.obra_frentes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo in ('terreno', 'urbanismo', 'edificio1', 'edificio2')),
  nombre text not null,
  descripcion text not null default '',
  contexto text not null default '',
  orden smallint not null,
  pesos_aprobados_en timestamptz,
  pesos_aprobados_por uuid references auth.users (id),
  pesos_aprobados_nombre text,
  creado_en timestamptz not null default now()
);

create table if not exists public.obra_actividades (
  id uuid primary key default gen_random_uuid(),
  frente_id uuid not null references public.obra_frentes (id),
  parent_id uuid references public.obra_actividades (id),
  codigo text not null check (char_length(btrim(codigo)) between 1 and 40),
  nombre text not null check (char_length(btrim(nombre)) >= 3),
  descripcion text not null default '',
  orden int not null default 0,
  peso numeric(7,4) check (peso is null or (peso > 0 and peso <= 100)),
  plan_inicio date, plan_fin date, real_inicio date, real_fin date,
  duracion_dias int check (duracion_dias is null or duracion_dias > 0),
  responsable_id uuid references public.profiles (id),
  responsable_texto text not null default '',
  estado text not null default 'por_programar' check (estado in ('por_programar', 'programada', 'en_ejecucion', 'completada', 'pausada', 'cancelada')),
  observaciones text not null default '',
  avance_registrado numeric(5,2) check (avance_registrado between 0 and 100),
  avance_validado numeric(5,2) check (avance_validado between 0 and 100),
  ultimo_corte_validado date,
  version int not null default 1,
  creada_por uuid default auth.uid() references auth.users (id),
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  unique (frente_id, codigo),
  check (plan_inicio is null or plan_fin is null or plan_fin >= plan_inicio),
  check (real_inicio is null or real_fin is null or real_fin >= real_inicio),
  check (responsable_id is null or responsable_texto = '')
);
create index if not exists obra_actividades_frente_idx on public.obra_actividades (frente_id, parent_id, orden);

create table if not exists public.obra_dependencias (
  predecesora_id uuid not null references public.obra_actividades (id),
  sucesora_id uuid not null references public.obra_actividades (id),
  creada_por uuid default auth.uid() references auth.users (id),
  creada_en timestamptz not null default now(),
  primary key (predecesora_id, sucesora_id),
  check (predecesora_id <> sucesora_id)
);

create table if not exists public.obra_avances (
  id uuid primary key default gen_random_uuid(),
  actividad_id uuid not null references public.obra_actividades (id),
  fecha_corte date not null,
  avance numeric(5,2) not null check (avance between 0 and 100),
  avance_anterior numeric(5,2),
  observaciones text not null default '',
  dificultades text not null default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'validado', 'rechazado')),
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_nombre text not null,
  registrado_en timestamptz not null default now(),
  validado_por uuid references auth.users (id),
  validado_nombre text,
  validado_en timestamptz,
  validacion_nota text
);
create index if not exists obra_avances_actividad_idx on public.obra_avances (actividad_id, fecha_corte desc);
create unique index if not exists obra_avances_pendiente_unico on public.obra_avances (actividad_id, fecha_corte) where estado = 'pendiente';

create table if not exists public.obra_controles (
  id uuid primary key default gen_random_uuid(),
  frente_id uuid not null references public.obra_frentes (id),
  actividad_id uuid references public.obra_actividades (id),
  fecha date not null,
  tipo text not null check (char_length(btrim(tipo)) >= 3),
  valor numeric,
  unidad text not null default '',
  observaciones text not null default '',
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_nombre text not null,
  registrado_en timestamptz not null default now()
);

create table if not exists public.obra_evidencias (
  id uuid primary key default gen_random_uuid(),
  frente_id uuid not null references public.obra_frentes (id),
  actividad_id uuid references public.obra_actividades (id),
  avance_id uuid references public.obra_avances (id),
  tipo text not null check (tipo in ('foto', 'informe', 'acta', 'plano', 'reporte', 'otro')),
  nombre text not null check (char_length(btrim(nombre)) >= 1),
  descripcion text not null default '',
  ruta text not null unique,
  mime text,
  tamano bigint check (tamano is null or (tamano >= 0 and tamano <= 26214400)),
  fecha date not null default current_date,
  cargado_por uuid not null default auth.uid() references auth.users (id),
  cargado_nombre text not null,
  cargado_en timestamptz not null default now(),
  retirado_en timestamptz,
  retirado_por uuid references auth.users (id),
  retirado_motivo text
);

create table if not exists public.obra_cronogramas (
  id uuid primary key default gen_random_uuid(),
  frente_id uuid not null references public.obra_frentes (id),
  version int not null,
  estado text not null default 'aprobado' check (estado in ('aprobado', 'reemplazado')),
  nota text not null default '',
  actividades jsonb not null,
  aprobado_por uuid not null default auth.uid() references auth.users (id),
  aprobado_nombre text not null,
  aprobado_en timestamptz not null default now(),
  unique (frente_id, version)
);

create table if not exists public.obra_historial (
  id uuid primary key default gen_random_uuid(),
  frente_id uuid not null references public.obra_frentes (id),
  actividad_id uuid references public.obra_actividades (id),
  user_id uuid default auth.uid() references auth.users (id),
  usuario text not null,
  accion text not null,
  motivo text not null,
  antes jsonb,
  despues jsonb,
  fecha timestamptz not null default now()
);
create index if not exists obra_historial_frente_idx on public.obra_historial (frente_id, fecha desc);

create table if not exists public.obra_plantillas (
  tipo text not null check (tipo in ('terreno', 'urbanismo', 'edificio')),
  codigo text not null,
  parent_codigo text,
  orden int not null,
  nombre text not null,
  descripcion text not null default '',
  primary key (tipo, codigo)
);

/* ------------------------------------------------------------ lectura (RLS) */

alter table public.obra_frentes enable row level security;
alter table public.obra_actividades enable row level security;
alter table public.obra_dependencias enable row level security;
alter table public.obra_avances enable row level security;
alter table public.obra_controles enable row level security;
alter table public.obra_evidencias enable row level security;
alter table public.obra_cronogramas enable row level security;
alter table public.obra_historial enable row level security;
alter table public.obra_plantillas enable row level security;

-- Sin políticas de escritura: todo cambio pasa por las funciones de abajo, que validan permiso, reglas e historial.
drop policy if exists "obra frentes" on public.obra_frentes;
create policy "obra frentes" on public.obra_frentes for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra actividades" on public.obra_actividades;
create policy "obra actividades" on public.obra_actividades for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra dependencias" on public.obra_dependencias;
create policy "obra dependencias" on public.obra_dependencias for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra avances" on public.obra_avances;
create policy "obra avances" on public.obra_avances for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra controles" on public.obra_controles;
create policy "obra controles" on public.obra_controles for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra cronogramas" on public.obra_cronogramas;
create policy "obra cronogramas" on public.obra_cronogramas for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra historial" on public.obra_historial;
create policy "obra historial" on public.obra_historial for select to authenticated using (public.tiene_permiso('obra.ver'));
drop policy if exists "obra plantillas" on public.obra_plantillas;
create policy "obra plantillas" on public.obra_plantillas for select to authenticated using (public.tiene_permiso('obra.ver') or public.tiene_permiso('obra.editar'));
-- Las fotografías las ve quien ve el detalle técnico; informes, actas y planos también quien tiene documentos.
drop policy if exists "obra evidencias" on public.obra_evidencias;
create policy "obra evidencias" on public.obra_evidencias for select to authenticated using (
  public.tiene_permiso('obra.ver') or (tipo <> 'foto' and public.tiene_permiso('obra.documentos'))
);

/* ------------------------------------------------------------------ frentes */

insert into public.obra_frentes (codigo, nombre, descripcion, contexto, orden) values
  ('terreno', 'Terreno y precarga', 'Precarga de unos 3 m de altura y controles técnicos',
   'La precarga se colocó en octubre de 2026: capa de tierra compactada de unos 3 m, con permanencia prevista de 12 meses. Busca consolidar el terreno para evaluar una cimentación mediante losa en lugar de pilotes; la solución definitiva requiere validación técnica. La fecha exacta de inicio y el avance físico se registran con respaldo técnico, no por tiempo transcurrido.', 1),
  ('urbanismo', 'Urbanismo y áreas comunes', 'Vías, aceras, parques, garita, club y espacios exteriores',
   'Frente independiente que se ejecuta en paralelo a la comercialización del Edificio 1. Fechas por programar.', 2),
  ('edificio1', 'Edificio 1', 'Primera fase constructiva, con cronograma y avance independientes',
   'Primera fase constructiva. Fechas por programar según la planificación aprobada.', 3),
  ('edificio2', 'Edificio 2', 'Segunda fase constructiva, con actividades y avance propios',
   'Segunda fase, posterior al Edificio 1 según las condiciones comerciales y financieras. Fechas por programar.', 4)
on conflict (codigo) do nothing;

/* ------------------------------------------------------------------ ayudas */

create or replace function public.obra_motivo(p_motivo text) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo (mínimo 5 caracteres)'; end if;
  return btrim(p_motivo);
end $$;

create or replace function public.obra_requiere(p_permiso text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso(p_permiso) then raise exception 'No tienes permiso para esta acción' using errcode = '42501'; end if;
end $$;

create or replace function public.obra_nombre_actual() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from public.profiles where id = auth.uid()), 'Usuario')
$$;

create or replace function public.obra_historial_registrar(p_frente uuid, p_actividad uuid, p_accion text, p_motivo text, p_antes jsonb, p_despues jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into obra_historial (frente_id, actividad_id, user_id, usuario, accion, motivo, antes, despues)
  values (p_frente, p_actividad, auth.uid(), public.obra_nombre_actual(), p_accion, p_motivo, p_antes, p_despues);
  perform public.auditar('obra: ' || p_accion, 'obra_frentes', coalesce(p_actividad, p_frente)::text, p_motivo, p_antes, p_despues, null);
end $$;

-- ¿p_nodo cuelga de p_ancestro (a cualquier nivel)?
create or replace function public.obra_es_descendiente(p_ancestro uuid, p_nodo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive arriba as (
    select id, parent_id from obra_actividades where id = p_nodo
    union all
    select a.id, a.parent_id from obra_actividades a join arriba on a.id = arriba.parent_id
  )
  select exists (select 1 from arriba where id = p_ancestro)
$$;

-- ¿agregar predecesora → sucesora crearía un ciclo de dependencias?
create or replace function public.obra_crea_ciclo_dep(p_pred uuid, p_suc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive sigue as (
    select sucesora_id from obra_dependencias where predecesora_id = p_suc
    union
    select d.sucesora_id from obra_dependencias d join sigue s on d.predecesora_id = s.sucesora_id
  )
  select p_pred = p_suc or exists (select 1 from sigue where sucesora_id = p_pred)
$$;

-- Deshace la aprobación de ponderaciones cuando cambia algo que la afecta.
create or replace function public.obra_invalidar_pesos(p_frente uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from obra_frentes where id = p_frente and pesos_aprobados_en is not null) then
    update obra_frentes set pesos_aprobados_en = null, pesos_aprobados_por = null, pesos_aprobados_nombre = null where id = p_frente;
    perform public.obra_historial_registrar(p_frente, null, 'Ponderaciones sin aprobar', 'Cambió una ponderación o la estructura: ' || p_motivo, null, null);
  end if;
end $$;

/* --------------------------------------------------------------- actividades */

create or replace function public.obra_datos_actividad(p_frente uuid, p_id uuid, p_datos jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_codigo text := btrim(coalesce(p_datos ->> 'codigo', ''));
  v_nombre text := btrim(coalesce(p_datos ->> 'nombre', ''));
  v_parent uuid := nullif(p_datos ->> 'parent_id', '')::uuid;
  v_peso numeric := nullif(p_datos ->> 'peso', '')::numeric;
  v_pi date := nullif(p_datos ->> 'plan_inicio', '')::date;
  v_pf date := nullif(p_datos ->> 'plan_fin', '')::date;
  v_ri date := nullif(p_datos ->> 'real_inicio', '')::date;
  v_rf date := nullif(p_datos ->> 'real_fin', '')::date;
  v_dur int := nullif(p_datos ->> 'duracion_dias', '')::int;
  v_resp uuid := nullif(p_datos ->> 'responsable_id', '')::uuid;
  v_texto text := btrim(coalesce(p_datos ->> 'responsable_texto', ''));
  v_estado text := coalesce(nullif(p_datos ->> 'estado', ''), 'por_programar');
begin
  if v_codigo = '' or char_length(v_codigo) > 40 then raise exception 'El código es obligatorio (máximo 40 caracteres)'; end if;
  if char_length(v_nombre) < 3 then raise exception 'El nombre de la actividad debe tener al menos 3 caracteres'; end if;
  if v_estado not in ('por_programar', 'programada', 'en_ejecucion', 'completada', 'pausada', 'cancelada') then raise exception 'Estado no válido'; end if;
  if v_peso is not null and (v_peso <= 0 or v_peso > 100) then raise exception 'La ponderación debe estar entre 0 y 100 %%'; end if;
  if v_pi is not null and v_pf is not null and v_pf < v_pi then raise exception 'La fecha de fin prevista no puede ser anterior al inicio'; end if;
  if v_ri is not null and v_rf is not null and v_rf < v_ri then raise exception 'La fecha de fin real no puede ser anterior al inicio'; end if;
  if v_pi is not null and v_pf is not null then v_dur := v_pf - v_pi + 1; end if;
  if v_dur is not null and v_dur <= 0 then raise exception 'La duración debe ser mayor que cero'; end if;
  if v_resp is not null and v_texto <> '' then raise exception 'Elige un usuario o escribe un responsable externo, no ambos'; end if;
  if v_texto <> '' and char_length(v_texto) < 3 then raise exception 'El responsable externo debe tener al menos 3 caracteres'; end if;
  if v_resp is not null and not exists (select 1 from profiles where id = v_resp and estado = 'activo') then raise exception 'El responsable debe ser un usuario activo'; end if;
  if v_parent is not null then
    if not exists (select 1 from obra_actividades where id = v_parent and frente_id = p_frente) then raise exception 'La actividad superior debe ser del mismo frente'; end if;
    if p_id is not null and (v_parent = p_id or public.obra_es_descendiente(p_id, v_parent)) then raise exception 'Una actividad no puede quedar dentro de sí misma ni de sus subactividades'; end if;
  end if;
  return jsonb_build_object('codigo', v_codigo, 'nombre', v_nombre, 'descripcion', btrim(coalesce(p_datos ->> 'descripcion', '')),
    'parent_id', v_parent, 'peso', v_peso, 'plan_inicio', v_pi, 'plan_fin', v_pf, 'real_inicio', v_ri, 'real_fin', v_rf, 'duracion_dias', v_dur,
    'responsable_id', v_resp, 'responsable_texto', v_texto, 'estado', v_estado, 'observaciones', btrim(coalesce(p_datos ->> 'observaciones', '')),
    'orden', nullif(p_datos ->> 'orden', '')::int);
end $$;

create or replace function public.obra_actividad_guardar(p_frente uuid, p_id uuid, p_version int, p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.obra_motivo(p_motivo);
  a public.obra_actividades;
  d jsonb;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_orden int;
  v_reset boolean := false;
begin
  perform public.obra_requiere('obra.editar');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  d := public.obra_datos_actividad(p_frente, p_id, p_datos);
  v_orden := coalesce((d ->> 'orden')::int, (select coalesce(max(orden), 0) + 10 from obra_actividades where frente_id = p_frente and parent_id is not distinct from (d ->> 'parent_id')::uuid));
  if p_id is null then
    if exists (select 1 from obra_actividades where frente_id = p_frente and codigo = d ->> 'codigo') then raise exception 'Ya existe una actividad con ese código en este frente'; end if;
    insert into obra_actividades (id, frente_id, parent_id, codigo, nombre, descripcion, orden, peso, plan_inicio, plan_fin, real_inicio, real_fin, duracion_dias,
      responsable_id, responsable_texto, estado, observaciones)
    values (v_id, p_frente, (d ->> 'parent_id')::uuid, d ->> 'codigo', d ->> 'nombre', d ->> 'descripcion', v_orden, (d ->> 'peso')::numeric,
      (d ->> 'plan_inicio')::date, (d ->> 'plan_fin')::date, (d ->> 'real_inicio')::date, (d ->> 'real_fin')::date, (d ->> 'duracion_dias')::int,
      (d ->> 'responsable_id')::uuid, d ->> 'responsable_texto', d ->> 'estado', d ->> 'observaciones');
    v_reset := true;
    perform public.obra_historial_registrar(p_frente, v_id, 'Crear actividad', v_m, null, d);
  else
    select * into a from obra_actividades where id = p_id and frente_id = p_frente for update;
    if not found then raise exception 'La actividad no existe en este frente'; end if;
    if p_version is distinct from a.version then
      raise exception 'Otra persona modificó esta actividad (versión % → %). Recarga y vuelve a intentar.', p_version, a.version using errcode = '40001';
    end if;
    if exists (select 1 from obra_actividades where frente_id = p_frente and codigo = d ->> 'codigo' and id <> p_id) then raise exception 'Ya existe una actividad con ese código en este frente'; end if;
    v_reset := a.peso is distinct from (d ->> 'peso')::numeric or a.parent_id is distinct from (d ->> 'parent_id')::uuid
      or (a.estado = 'cancelada') is distinct from ((d ->> 'estado') = 'cancelada');
    update obra_actividades set codigo = d ->> 'codigo', nombre = d ->> 'nombre', descripcion = d ->> 'descripcion', parent_id = (d ->> 'parent_id')::uuid,
      orden = coalesce((d ->> 'orden')::int, a.orden), peso = (d ->> 'peso')::numeric, plan_inicio = (d ->> 'plan_inicio')::date, plan_fin = (d ->> 'plan_fin')::date,
      real_inicio = (d ->> 'real_inicio')::date, real_fin = (d ->> 'real_fin')::date, duracion_dias = (d ->> 'duracion_dias')::int,
      responsable_id = (d ->> 'responsable_id')::uuid, responsable_texto = d ->> 'responsable_texto', estado = d ->> 'estado', observaciones = d ->> 'observaciones',
      version = version + 1, actualizada_en = now()
    where id = p_id;
    perform public.obra_historial_registrar(p_frente, p_id, 'Editar actividad', v_m, to_jsonb(a), d);
  end if;
  if v_reset then perform public.obra_invalidar_pesos(p_frente, v_m); end if;
  return v_id;
end $$;

-- Reorganiza: cambia de nivel y de posición varias actividades a la vez. [{id, parent_id, orden}]
create or replace function public.obra_reordenar(p_frente uuid, p_orden jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.obra_motivo(p_motivo);
  x jsonb; v_id uuid; v_parent uuid; v_cambio boolean := false; a public.obra_actividades;
begin
  perform public.obra_requiere('obra.editar');
  if jsonb_typeof(p_orden) <> 'array' or jsonb_array_length(p_orden) = 0 then raise exception 'No hay cambios que guardar'; end if;
  for x in select * from jsonb_array_elements(p_orden) loop
    v_id := (x ->> 'id')::uuid; v_parent := nullif(x ->> 'parent_id', '')::uuid;
    select * into a from obra_actividades where id = v_id and frente_id = p_frente for update;
    if not found then raise exception 'Una actividad no pertenece a este frente'; end if;
    if v_parent is not null then
      if not exists (select 1 from obra_actividades where id = v_parent and frente_id = p_frente) then raise exception 'La actividad superior debe ser del mismo frente'; end if;
      if v_parent = v_id or public.obra_es_descendiente(v_id, v_parent) then raise exception 'Una actividad no puede quedar dentro de sí misma ni de sus subactividades'; end if;
    end if;
    if a.parent_id is distinct from v_parent then v_cambio := true; end if;
    update obra_actividades set parent_id = v_parent, orden = coalesce((x ->> 'orden')::int, orden), version = version + 1, actualizada_en = now() where id = v_id;
  end loop;
  perform public.obra_historial_registrar(p_frente, null, 'Reorganizar actividades', v_m, null, p_orden);
  if v_cambio then perform public.obra_invalidar_pesos(p_frente, v_m); end if;
end $$;

create or replace function public.obra_dependencia(p_pred uuid, p_suc uuid, p_agregar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); v_frente uuid;
begin
  perform public.obra_requiere('obra.editar');
  select frente_id into v_frente from obra_actividades where id = p_suc;
  if v_frente is null or not exists (select 1 from obra_actividades where id = p_pred) then raise exception 'Las actividades no existen'; end if;
  if p_agregar then
    if p_pred = p_suc then raise exception 'Una actividad no puede depender de sí misma'; end if;
    if public.obra_crea_ciclo_dep(p_pred, p_suc) then raise exception 'Esa dependencia crearía un ciclo'; end if;
    insert into obra_dependencias (predecesora_id, sucesora_id) values (p_pred, p_suc) on conflict do nothing;
  else
    delete from obra_dependencias where predecesora_id = p_pred and sucesora_id = p_suc;
  end if;
  perform public.obra_historial_registrar(v_frente, p_suc, case when p_agregar then 'Agregar dependencia' else 'Quitar dependencia' end, v_m,
    null, jsonb_build_object('predecesora', p_pred, 'sucesora', p_suc));
end $$;

-- Ponderaciones de varias actividades a la vez. [{id, peso}] — peso nulo la deja pendiente.
create or replace function public.obra_pesos(p_frente uuid, p_pesos jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); x jsonb; v_peso numeric; v_cambio boolean := false; a public.obra_actividades;
begin
  perform public.obra_requiere('obra.editar');
  if jsonb_typeof(p_pesos) <> 'array' or jsonb_array_length(p_pesos) = 0 then raise exception 'No hay ponderaciones que guardar'; end if;
  for x in select * from jsonb_array_elements(p_pesos) loop
    v_peso := nullif(x ->> 'peso', '')::numeric;
    if v_peso is not null and (v_peso <= 0 or v_peso > 100) then raise exception 'La ponderación debe estar entre 0 y 100 %%'; end if;
    select * into a from obra_actividades where id = (x ->> 'id')::uuid and frente_id = p_frente for update;
    if not found then raise exception 'Una actividad no pertenece a este frente'; end if;
    if a.peso is distinct from v_peso then v_cambio := true; end if;
    update obra_actividades set peso = v_peso, version = version + 1, actualizada_en = now() where id = a.id;
  end loop;
  perform public.obra_historial_registrar(p_frente, null, 'Editar ponderaciones', v_m, null, p_pesos);
  if v_cambio then perform public.obra_invalidar_pesos(p_frente, v_m); end if;
end $$;

create or replace function public.obra_pesos_aprobar(p_frente uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); g record;
begin
  perform public.obra_requiere('obra.validar');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  if not exists (select 1 from obra_actividades where frente_id = p_frente and estado <> 'cancelada') then raise exception 'El frente no tiene actividades'; end if;
  for g in
    select a.parent_id, count(*) n, count(a.peso) con_peso, coalesce(sum(a.peso), 0) suma
    from obra_actividades a
    where a.frente_id = p_frente and a.estado <> 'cancelada'
      and (a.parent_id is null or exists (select 1 from obra_actividades p where p.id = a.parent_id and p.estado <> 'cancelada'))
    group by a.parent_id
  loop
    if g.con_peso < g.n then raise exception 'Faltan ponderaciones en % actividad(es) de un mismo nivel', g.n - g.con_peso; end if;
    if abs(g.suma - 100) > 0.0001 then raise exception 'Las ponderaciones de un mismo nivel deben sumar 100 %% (suman %)', round(g.suma, 4); end if;
  end loop;
  update obra_frentes set pesos_aprobados_en = now(), pesos_aprobados_por = auth.uid(), pesos_aprobados_nombre = public.obra_nombre_actual() where id = p_frente;
  perform public.obra_historial_registrar(p_frente, null, 'Aprobar ponderaciones', v_m, null, null);
end $$;

-- Guarda una versión del cronograma: fechas y ponderaciones vigentes. La anterior pasa a «reemplazado».
create or replace function public.obra_cronograma_aprobar(p_frente uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); v_version int; v_datos jsonb;
begin
  perform public.obra_requiere('obra.validar');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'plan_inicio', plan_inicio, 'plan_fin', plan_fin, 'peso', peso) order by orden), '[]'::jsonb)
    into v_datos from obra_actividades where frente_id = p_frente and estado <> 'cancelada';
  if not exists (select 1 from obra_actividades where frente_id = p_frente and estado <> 'cancelada' and plan_inicio is not null and plan_fin is not null) then
    raise exception 'No hay actividades con fechas previstas para aprobar';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from obra_cronogramas where frente_id = p_frente;
  update obra_cronogramas set estado = 'reemplazado' where frente_id = p_frente and estado = 'aprobado';
  insert into obra_cronogramas (frente_id, version, nota, actividades, aprobado_nombre) values (p_frente, v_version, v_m, v_datos, public.obra_nombre_actual());
  perform public.obra_historial_registrar(p_frente, null, 'Aprobar cronograma', v_m, null, jsonb_build_object('version', v_version));
  return v_version;
end $$;

/* ------------------------------------------------------------------ avances */

-- Recalcula lo registrado y lo validado de una actividad a partir de su historial.
create or replace function public.obra_recalcular(p_actividad uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_reg numeric; v_val numeric; v_corte date;
begin
  select avance into v_reg from obra_avances where actividad_id = p_actividad and estado <> 'rechazado' order by fecha_corte desc, registrado_en desc limit 1;
  select avance, fecha_corte into v_val, v_corte from obra_avances where actividad_id = p_actividad and estado = 'validado' order by fecha_corte desc, registrado_en desc limit 1;
  update obra_actividades set avance_registrado = v_reg, avance_validado = v_val, ultimo_corte_validado = v_corte, actualizada_en = now() where id = p_actividad;
end $$;

create or replace function public.obra_avance_registrar(p_actividad uuid, p_fecha date, p_avance numeric, p_observaciones text, p_dificultades text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.obra_actividades; v_id uuid := gen_random_uuid(); v_obs text := btrim(coalesce(p_observaciones, ''));
begin
  perform public.obra_requiere('obra.avance');
  select * into a from obra_actividades where id = p_actividad for update;
  if not found then raise exception 'La actividad no existe'; end if;
  if a.estado = 'cancelada' then raise exception 'La actividad está cancelada'; end if;
  if exists (select 1 from obra_actividades where parent_id = p_actividad and estado <> 'cancelada') then
    raise exception 'Esta actividad se calcula con sus subactividades: registra el avance en ellas';
  end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha de corte no puede ser futura'; end if;
  if p_avance is null or p_avance < 0 or p_avance > 100 then raise exception 'El avance debe estar entre 0 y 100 %%'; end if;
  if a.avance_validado is not null and p_avance < a.avance_validado and char_length(v_obs) < 5 then
    raise exception 'El avance es menor al último validado (% %%): explica la corrección en las observaciones', a.avance_validado;
  end if;
  if exists (select 1 from obra_avances where actividad_id = p_actividad and fecha_corte = p_fecha and estado = 'pendiente') then
    raise exception 'Ya hay un avance pendiente de validar para esa fecha de corte';
  end if;
  insert into obra_avances (id, actividad_id, fecha_corte, avance, avance_anterior, observaciones, dificultades, registrado_nombre)
  values (v_id, p_actividad, p_fecha, round(p_avance, 2), a.avance_validado, v_obs, btrim(coalesce(p_dificultades, '')), public.obra_nombre_actual());
  perform public.obra_recalcular(p_actividad);
  perform public.obra_historial_registrar(a.frente_id, p_actividad, 'Registrar avance', 'Corte ' || p_fecha::text || ': ' || round(p_avance, 2)::text || ' %',
    jsonb_build_object('avance_validado', a.avance_validado), jsonb_build_object('avance', round(p_avance, 2), 'fecha_corte', p_fecha));
  return v_id;
end $$;

-- El constructor no valida lo que él mismo registró.
create or replace function public.obra_avance_validar(p_avance uuid, p_aprobar boolean, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.obra_avances; a public.obra_actividades; v_nota text := btrim(coalesce(p_nota, ''));
begin
  perform public.obra_requiere('obra.validar');
  select * into r from obra_avances where id = p_avance for update;
  if not found then raise exception 'El avance no existe'; end if;
  if r.estado <> 'pendiente' then raise exception 'Este avance ya fue resuelto'; end if;
  if r.registrado_por = auth.uid() then raise exception 'No puedes validar un avance que registraste tú' using errcode = '42501'; end if;
  if not p_aprobar and char_length(v_nota) < 5 then raise exception 'Indica el motivo del rechazo (mínimo 5 caracteres)'; end if;
  update obra_avances set estado = case when p_aprobar then 'validado' else 'rechazado' end, validado_por = auth.uid(),
    validado_nombre = public.obra_nombre_actual(), validado_en = now(), validacion_nota = nullif(v_nota, '') where id = p_avance;
  perform public.obra_recalcular(r.actividad_id);
  select * into a from obra_actividades where id = r.actividad_id;
  perform public.obra_historial_registrar(a.frente_id, a.id, case when p_aprobar then 'Validar avance' else 'Rechazar avance' end,
    coalesce(nullif(v_nota, ''), 'Avance validado'), jsonb_build_object('avance', r.avance, 'fecha_corte', r.fecha_corte, 'estado', r.estado),
    jsonb_build_object('estado', case when p_aprobar then 'validado' else 'rechazado' end));
end $$;

create or replace function public.obra_control_registrar(p_frente uuid, p_actividad uuid, p_fecha date, p_tipo text, p_valor numeric, p_unidad text, p_observaciones text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.obra_requiere('obra.avance');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  if p_actividad is not null and not exists (select 1 from obra_actividades where id = p_actividad and frente_id = p_frente) then raise exception 'La actividad no es de este frente'; end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha del control no puede ser futura'; end if;
  if char_length(btrim(coalesce(p_tipo, ''))) < 3 then raise exception 'Indica el tipo de control (por ejemplo, asentamiento)'; end if;
  insert into obra_controles (id, frente_id, actividad_id, fecha, tipo, valor, unidad, observaciones, registrado_nombre)
  values (v_id, p_frente, p_actividad, p_fecha, btrim(p_tipo), p_valor, btrim(coalesce(p_unidad, '')), btrim(coalesce(p_observaciones, '')), public.obra_nombre_actual());
  perform public.obra_historial_registrar(p_frente, p_actividad, 'Registrar control técnico', 'Control ' || btrim(p_tipo) || ' del ' || p_fecha::text, null,
    jsonb_build_object('tipo', btrim(p_tipo), 'valor', p_valor, 'unidad', p_unidad));
  return v_id;
end $$;

/* --------------------------------------------------------------- evidencias */

create or replace function public.obra_evidencia_registrar(p_frente uuid, p_actividad uuid, p_avance uuid, p_tipo text, p_nombre text, p_descripcion text,
  p_ruta text, p_mime text, p_tamano bigint, p_fecha date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.obra_requiere('obra.avance');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  if p_actividad is not null and not exists (select 1 from obra_actividades where id = p_actividad and frente_id = p_frente) then raise exception 'La actividad no es de este frente'; end if;
  if p_avance is not null and not exists (select 1 from obra_avances where id = p_avance and actividad_id = p_actividad) then raise exception 'El avance no es de esta actividad'; end if;
  if p_tipo not in ('foto', 'informe', 'acta', 'plano', 'reporte', 'otro') then raise exception 'Tipo de evidencia no válido'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) < 1 then raise exception 'Indica el nombre del archivo'; end if;
  if p_ruta is null or p_ruta not like p_frente::text || '/%' then raise exception 'La ruta del archivo no corresponde al frente'; end if;
  if p_tamano is not null and (p_tamano < 0 or p_tamano > 26214400) then raise exception 'El archivo supera el máximo de 25 MB'; end if;
  if p_fecha is null or p_fecha > current_date then raise exception 'La fecha del archivo no puede ser futura'; end if;
  insert into obra_evidencias (id, frente_id, actividad_id, avance_id, tipo, nombre, descripcion, ruta, mime, tamano, fecha, cargado_nombre)
  values (v_id, p_frente, p_actividad, p_avance, p_tipo, btrim(p_nombre), btrim(coalesce(p_descripcion, '')), p_ruta, p_mime, p_tamano, p_fecha, public.obra_nombre_actual());
  perform public.obra_historial_registrar(p_frente, p_actividad, 'Cargar evidencia', 'Archivo ' || btrim(p_nombre), null, jsonb_build_object('tipo', p_tipo, 'ruta', p_ruta));
  return v_id;
end $$;

-- El archivo se conserva en el almacenamiento; la evidencia deja de mostrarse y queda el motivo.
create or replace function public.obra_evidencia_retirar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); e public.obra_evidencias;
begin
  perform public.obra_requiere('obra.editar');
  select * into e from obra_evidencias where id = p_id for update;
  if not found then raise exception 'La evidencia no existe'; end if;
  if e.retirado_en is not null then raise exception 'La evidencia ya fue retirada'; end if;
  update obra_evidencias set retirado_en = now(), retirado_por = auth.uid(), retirado_motivo = v_m where id = p_id;
  perform public.obra_historial_registrar(e.frente_id, e.actividad_id, 'Retirar evidencia', v_m, jsonb_build_object('nombre', e.nombre), null);
end $$;

/* ------------------------------------------------------------- importación */

-- Importa un cronograma. Todo o nada: si una fila no es válida, no se guarda ninguna. Las actividades se identifican por código
-- dentro del frente: si el código existe se actualiza, si no se crea. No toca los avances.
-- Filas: [{codigo, parent_codigo, nombre, descripcion, peso, plan_inicio, plan_fin, real_inicio, real_fin, duracion_dias, responsable_texto, estado, observaciones}]
create or replace function public.obra_importar(p_frente uuid, p_filas jsonb, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.obra_motivo(p_motivo);
  f jsonb; v_codigo text; v_nombre text; v_parent text; v_creadas int := 0; v_actualizadas int := 0;
  v_vistos text[] := '{}'; v_peso numeric; v_pi date; v_pf date; v_ri date; v_rf date; v_dur int; v_estado text; v_id uuid; v_pid uuid; v_cambio boolean := false; a public.obra_actividades;
  v_linea int := 0; v_texto text;
begin
  perform public.obra_requiere('obra.importar');
  if not exists (select 1 from obra_frentes where id = p_frente) then raise exception 'El frente no existe'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then raise exception 'El archivo no tiene actividades'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2000 actividades por importación'; end if;
  -- 1. Validación completa antes de escribir.
  for f in select * from jsonb_array_elements(p_filas) loop
    v_linea := v_linea + 1;
    v_codigo := btrim(coalesce(f ->> 'codigo', '')); v_nombre := btrim(coalesce(f ->> 'nombre', ''));
    if v_codigo = '' then raise exception 'Fila %: falta el código', v_linea; end if;
    if v_codigo = any (v_vistos) then raise exception 'Fila %: el código % está repetido en el archivo', v_linea, v_codigo; end if;
    v_vistos := v_vistos || v_codigo;
    if char_length(v_nombre) < 3 then raise exception 'Fila % (%): el nombre debe tener al menos 3 caracteres', v_linea, v_codigo; end if;
    begin
      v_peso := nullif(f ->> 'peso', '')::numeric; v_pi := nullif(f ->> 'plan_inicio', '')::date; v_pf := nullif(f ->> 'plan_fin', '')::date;
      v_ri := nullif(f ->> 'real_inicio', '')::date; v_rf := nullif(f ->> 'real_fin', '')::date; v_dur := nullif(f ->> 'duracion_dias', '')::int;
    exception when others then raise exception 'Fila % (%): hay un número o una fecha con formato no válido', v_linea, v_codigo; end;
    if v_peso is not null and (v_peso <= 0 or v_peso > 100) then raise exception 'Fila % (%): la ponderación debe estar entre 0 y 100', v_linea, v_codigo; end if;
    if v_pi is not null and v_pf is not null and v_pf < v_pi then raise exception 'Fila % (%): el fin previsto es anterior al inicio', v_linea, v_codigo; end if;
    if v_ri is not null and v_rf is not null and v_rf < v_ri then raise exception 'Fila % (%): el fin real es anterior al inicio', v_linea, v_codigo; end if;
    if v_dur is not null and v_dur <= 0 then raise exception 'Fila % (%): la duración debe ser mayor que cero', v_linea, v_codigo; end if;
    v_estado := coalesce(nullif(f ->> 'estado', ''), 'por_programar');
    if v_estado not in ('por_programar', 'programada', 'en_ejecucion', 'completada', 'pausada', 'cancelada') then raise exception 'Fila % (%): estado no válido', v_linea, v_codigo; end if;
    v_texto := btrim(coalesce(f ->> 'responsable_texto', ''));
    if v_texto <> '' and char_length(v_texto) < 3 then raise exception 'Fila % (%): el responsable debe tener al menos 3 caracteres', v_linea, v_codigo; end if;
  end loop;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_parent := btrim(coalesce(f ->> 'parent_codigo', ''));
    if v_parent <> '' and not (v_parent = any (v_vistos)) and not exists (select 1 from obra_actividades where frente_id = p_frente and codigo = v_parent) then
      raise exception 'La actividad % depende de la superior %, que no existe', f ->> 'codigo', v_parent;
    end if;
    if v_parent = btrim(f ->> 'codigo') then raise exception 'La actividad % no puede ser su propia superior', v_parent; end if;
  end loop;
  -- 2. Crea o actualiza sin padres, y luego enlaza (así el orden del archivo no importa).
  v_linea := 0;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_linea := v_linea + 1;
    v_codigo := btrim(f ->> 'codigo'); v_pi := nullif(f ->> 'plan_inicio', '')::date; v_pf := nullif(f ->> 'plan_fin', '')::date;
    v_dur := case when v_pi is not null and v_pf is not null then v_pf - v_pi + 1 else nullif(f ->> 'duracion_dias', '')::int end;
    v_peso := nullif(f ->> 'peso', '')::numeric; v_estado := coalesce(nullif(f ->> 'estado', ''), 'por_programar');
    select * into a from obra_actividades where frente_id = p_frente and codigo = v_codigo for update;
    if found then
      if a.peso is distinct from v_peso then v_cambio := true; end if;
      update obra_actividades set nombre = btrim(f ->> 'nombre'), descripcion = btrim(coalesce(f ->> 'descripcion', '')), peso = v_peso, plan_inicio = v_pi, plan_fin = v_pf,
        real_inicio = nullif(f ->> 'real_inicio', '')::date, real_fin = nullif(f ->> 'real_fin', '')::date, duracion_dias = v_dur,
        responsable_texto = case when a.responsable_id is null then btrim(coalesce(f ->> 'responsable_texto', '')) else a.responsable_texto end,
        estado = v_estado, observaciones = btrim(coalesce(f ->> 'observaciones', '')), orden = v_linea * 10, version = version + 1, actualizada_en = now()
      where id = a.id;
      v_actualizadas := v_actualizadas + 1;
    else
      insert into obra_actividades (frente_id, codigo, nombre, descripcion, orden, peso, plan_inicio, plan_fin, real_inicio, real_fin, duracion_dias, responsable_texto, estado, observaciones)
      values (p_frente, v_codigo, btrim(f ->> 'nombre'), btrim(coalesce(f ->> 'descripcion', '')), v_linea * 10, v_peso, v_pi, v_pf,
        nullif(f ->> 'real_inicio', '')::date, nullif(f ->> 'real_fin', '')::date, v_dur, btrim(coalesce(f ->> 'responsable_texto', '')), v_estado, btrim(coalesce(f ->> 'observaciones', '')));
      v_creadas := v_creadas + 1; v_cambio := true;
    end if;
  end loop;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_parent := nullif(btrim(coalesce(f ->> 'parent_codigo', '')), '');
    v_id := (select id from obra_actividades where frente_id = p_frente and codigo = btrim(f ->> 'codigo'));
    v_pid := case when v_parent is null then null else (select id from obra_actividades where frente_id = p_frente and codigo = v_parent) end;
    if v_pid is not null and (v_pid = v_id or public.obra_es_descendiente(v_id, v_pid)) then raise exception 'Las actividades % y % forman un ciclo', f ->> 'codigo', v_parent; end if;
    if (select parent_id from obra_actividades where id = v_id) is distinct from v_pid then
      update obra_actividades set parent_id = v_pid where id = v_id; v_cambio := true;
    end if;
  end loop;
  perform public.obra_historial_registrar(p_frente, null, 'Importar cronograma', v_m, null, jsonb_build_object('creadas', v_creadas, 'actualizadas', v_actualizadas));
  if v_cambio then perform public.obra_invalidar_pesos(p_frente, v_m); end if;
  return jsonb_build_object('creadas', v_creadas, 'actualizadas', v_actualizadas);
end $$;

/* ---------------------------------------------------------------- plantillas */

-- Carga las etapas de la plantilla en un frente vacío. Son punto de partida editable, sin fechas ni ponderaciones.
create or replace function public.obra_plantilla_cargar(p_frente uuid, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare v_m text := public.obra_motivo(p_motivo); v_codigo text; v_tipo text; v_n int := 0; r record;
begin
  perform public.obra_requiere('obra.editar');
  select codigo into v_codigo from obra_frentes where id = p_frente;
  if v_codigo is null then raise exception 'El frente no existe'; end if;
  if exists (select 1 from obra_actividades where frente_id = p_frente) then raise exception 'El frente ya tiene actividades: la plantilla solo se carga en un frente vacío'; end if;
  v_tipo := case when v_codigo in ('edificio1', 'edificio2') then 'edificio' else v_codigo end;
  for r in select * from obra_plantillas where tipo = v_tipo order by orden loop
    insert into obra_actividades (frente_id, codigo, nombre, descripcion, orden) values (p_frente, r.codigo, r.nombre, r.descripcion, r.orden);
    v_n := v_n + 1;
  end loop;
  update obra_actividades a set parent_id = p.id
  from obra_plantillas t join obra_actividades p on p.frente_id = p_frente and p.codigo = t.parent_codigo
  where t.tipo = v_tipo and t.parent_codigo is not null and a.frente_id = p_frente and a.codigo = t.codigo;
  perform public.obra_historial_registrar(p_frente, null, 'Cargar plantilla', v_m, null, jsonb_build_object('actividades', v_n));
  return v_n;
end $$;

/* ------------------------------------------------------------------ cálculos */

-- Avance de una actividad. Las que tienen subactividades se calculan con ellas; las hojas usan su registro (sin registro = 0).
-- Devuelve nulo si falta alguna ponderación en el camino.
create or replace function public.obra_avance_nodo(p_id uuid, p_modo text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare a public.obra_actividades; h record; v_suma numeric := 0; v_pesos numeric := 0; v_hijo numeric; v_n int := 0;
begin
  select * into a from obra_actividades where id = p_id;
  for h in select id, peso from obra_actividades where parent_id = p_id and estado <> 'cancelada' loop
    v_n := v_n + 1;
    if h.peso is null then return null; end if;
    v_hijo := public.obra_avance_nodo(h.id, p_modo);
    if v_hijo is null then return null; end if;
    v_suma := v_suma + h.peso * v_hijo; v_pesos := v_pesos + h.peso;
  end loop;
  if v_n = 0 then return coalesce(case when p_modo = 'validado' then a.avance_validado else a.avance_registrado end, 0); end if;
  return v_suma / v_pesos;
end $$;

-- Avance global de un frente. Nulo mientras no haya ponderaciones aprobadas y completas.
create or replace function public.obra_avance_frente(p_frente uuid, p_modo text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare h record; v_suma numeric := 0; v_pesos numeric := 0; v_hijo numeric; v_n int := 0;
begin
  if not exists (select 1 from obra_frentes where id = p_frente and pesos_aprobados_en is not null) then return null; end if;
  for h in select id, peso from obra_actividades where frente_id = p_frente and parent_id is null and estado <> 'cancelada' loop
    v_n := v_n + 1;
    if h.peso is null then return null; end if;
    v_hijo := public.obra_avance_nodo(h.id, p_modo);
    if v_hijo is null then return null; end if;
    v_suma := v_suma + h.peso * v_hijo; v_pesos := v_pesos + h.peso;
  end loop;
  if v_n = 0 then return null; end if;
  return round(v_suma / v_pesos, 2);
end $$;

-- Lo que ve quien solo consulta el resumen: avance oficial (validado), sin actividades ni notas técnicas.
create or replace function public.obra_resumen() returns table (
  frente_id uuid, codigo text, nombre text, descripcion text, orden smallint, pesos_aprobados boolean, avance_validado numeric, ultimo_corte date,
  actividades int, actividades_con_avance int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.tiene_permiso('obra.resumen') or public.tiene_permiso('obra.ver')) then raise exception 'No tienes permiso para consultar el avance de obra' using errcode = '42501'; end if;
  return query
    select f.id, f.codigo, f.nombre, f.descripcion, f.orden, f.pesos_aprobados_en is not null,
      case when f.pesos_aprobados_en is not null then public.obra_avance_frente(f.id, 'validado') end,
      (select max(a.ultimo_corte_validado) from obra_actividades a where a.frente_id = f.id),
      (select count(*)::int from obra_actividades a where a.frente_id = f.id and a.estado <> 'cancelada'
         and not exists (select 1 from obra_actividades h where h.parent_id = a.id and h.estado <> 'cancelada')),
      (select count(*)::int from obra_actividades a where a.frente_id = f.id and a.estado <> 'cancelada' and a.avance_validado is not null
         and not exists (select 1 from obra_actividades h where h.parent_id = a.id and h.estado <> 'cancelada'))
    from obra_frentes f order by f.orden;
end $$;

/* ------------------------------------------------- almacenamiento de evidencias */

-- Bucket privado. Si el proyecto no tiene Storage (pruebas locales), se omite.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('obra-evidencias', 'obra-evidencias', false, 26214400)
    on conflict (id) do update set public = false, file_size_limit = 26214400;
    drop policy if exists "obra evidencias consultar" on storage.objects;
    create policy "obra evidencias consultar" on storage.objects for select to authenticated
      using (bucket_id = 'obra-evidencias' and exists (select 1 from public.obra_evidencias e where e.ruta = name and e.retirado_en is null));
    drop policy if exists "obra evidencias cargar" on storage.objects;
    create policy "obra evidencias cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'obra-evidencias' and public.tiene_permiso('obra.avance')
        and exists (select 1 from public.obra_frentes f where f.id::text = split_part(name, '/', 1)));
  end if;
end $$;

/* ------------------------------------------------------------------- permisos */

revoke all on function public.obra_motivo(text) from public, anon, authenticated;
revoke all on function public.obra_requiere(text) from public, anon, authenticated;
revoke all on function public.obra_nombre_actual() from public, anon, authenticated;
revoke all on function public.obra_historial_registrar(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.obra_es_descendiente(uuid, uuid) from public, anon, authenticated;
revoke all on function public.obra_crea_ciclo_dep(uuid, uuid) from public, anon, authenticated;
revoke all on function public.obra_invalidar_pesos(uuid, text) from public, anon, authenticated;
revoke all on function public.obra_datos_actividad(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.obra_recalcular(uuid) from public, anon, authenticated;
revoke all on function public.obra_avance_nodo(uuid, text) from public, anon, authenticated;
revoke all on function public.obra_avance_frente(uuid, text) from public, anon, authenticated;
revoke all on function public.obra_actividad_guardar(uuid, uuid, int, jsonb, text) from public, anon;
revoke all on function public.obra_reordenar(uuid, jsonb, text) from public, anon;
revoke all on function public.obra_dependencia(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.obra_pesos(uuid, jsonb, text) from public, anon;
revoke all on function public.obra_pesos_aprobar(uuid, text) from public, anon;
revoke all on function public.obra_cronograma_aprobar(uuid, text) from public, anon;
revoke all on function public.obra_avance_registrar(uuid, date, numeric, text, text) from public, anon;
revoke all on function public.obra_avance_validar(uuid, boolean, text) from public, anon;
revoke all on function public.obra_control_registrar(uuid, uuid, date, text, numeric, text, text) from public, anon;
revoke all on function public.obra_evidencia_registrar(uuid, uuid, uuid, text, text, text, text, text, bigint, date) from public, anon;
revoke all on function public.obra_evidencia_retirar(uuid, text) from public, anon;
revoke all on function public.obra_importar(uuid, jsonb, text) from public, anon;
revoke all on function public.obra_plantilla_cargar(uuid, text) from public, anon;
revoke all on function public.obra_resumen() from public, anon;

grant execute on function public.obra_actividad_guardar(uuid, uuid, int, jsonb, text) to authenticated;
grant execute on function public.obra_reordenar(uuid, jsonb, text) to authenticated;
grant execute on function public.obra_dependencia(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.obra_pesos(uuid, jsonb, text) to authenticated;
grant execute on function public.obra_pesos_aprobar(uuid, text) to authenticated;
grant execute on function public.obra_cronograma_aprobar(uuid, text) to authenticated;
grant execute on function public.obra_avance_registrar(uuid, date, numeric, text, text) to authenticated;
grant execute on function public.obra_avance_validar(uuid, boolean, text) to authenticated;
grant execute on function public.obra_control_registrar(uuid, uuid, date, text, numeric, text, text) to authenticated;
grant execute on function public.obra_evidencia_registrar(uuid, uuid, uuid, text, text, text, text, text, bigint, date) to authenticated;
grant execute on function public.obra_evidencia_retirar(uuid, text) to authenticated;
grant execute on function public.obra_importar(uuid, jsonb, text) to authenticated;
grant execute on function public.obra_plantilla_cargar(uuid, text) to authenticated;
grant execute on function public.obra_resumen() to authenticated;

/* ----------------------------------------------------------- datos de plantillas */

-- Etapas y subactividades de partida, editables por frente. Sin fechas ni ponderaciones.
insert into public.obra_plantillas (tipo, codigo, parent_codigo, orden, nombre, descripcion) values
  ('terreno', 'T-01', null, '100', 'Precarga del terreno', 'Capa de tierra compactada de unos 3 m de altura, con permanencia prevista de 12 meses. El avance físico se registra con respaldo técnico, no por tiempo transcurrido.'),
  ('terreno', 'T-01.1', 'T-01', '101', 'Colocación de la precarga', ''),
  ('terreno', 'T-01.2', 'T-01', '102', 'Controles de asentamientos', ''),
  ('terreno', 'T-01.3', 'T-01', '103', 'Permanencia y monitoreo', ''),
  ('terreno', 'T-02', null, '200', 'Validación geotécnica y definición de cimentación', 'Evalúa una cimentación mediante losa en lugar de pilotes. La solución definitiva requiere validación técnica.'),
  ('terreno', 'T-02.1', 'T-02', '201', 'Estudio geotécnico', ''),
  ('terreno', 'T-02.2', 'T-02', '202', 'Informe técnico y decisión de cimentación', ''),
  ('edificio', 'E-01', null, '100', 'Preparación y replanteo', ''),
  ('edificio', 'E-01.1', 'E-01', '101', 'Replanteo', ''),
  ('edificio', 'E-01.2', 'E-01', '102', 'Instalaciones provisionales', ''),
  ('edificio', 'E-01.3', 'E-01', '103', 'Adecuación del área', ''),
  ('edificio', 'E-02', null, '200', 'Cimentación', 'Según el diseño aprobado.'),
  ('edificio', 'E-02.1', 'E-02', '201', 'Excavación', ''),
  ('edificio', 'E-02.2', 'E-02', '202', 'Preparación', ''),
  ('edificio', 'E-02.3', 'E-02', '203', 'Acero', ''),
  ('edificio', 'E-02.4', 'E-02', '204', 'Encofrado', ''),
  ('edificio', 'E-02.5', 'E-02', '205', 'Fundición de losa', ''),
  ('edificio', 'E-03', null, '300', 'Estructura', ''),
  ('edificio', 'E-03.1', 'E-03', '301', 'Columnas', ''),
  ('edificio', 'E-03.2', 'E-03', '302', 'Vigas', ''),
  ('edificio', 'E-03.3', 'E-03', '303', 'Losas', ''),
  ('edificio', 'E-03.4', 'E-03', '304', 'Escaleras', ''),
  ('edificio', 'E-03.5', 'E-03', '305', 'Elementos estructurales', ''),
  ('edificio', 'E-04', null, '400', 'Mampostería', ''),
  ('edificio', 'E-04.1', 'E-04', '401', 'Paredes interiores', ''),
  ('edificio', 'E-04.2', 'E-04', '402', 'Paredes exteriores', ''),
  ('edificio', 'E-04.3', 'E-04', '403', 'Divisiones', ''),
  ('edificio', 'E-05', null, '500', 'Instalaciones hidrosanitarias', ''),
  ('edificio', 'E-05.1', 'E-05', '501', 'Agua potable', ''),
  ('edificio', 'E-05.2', 'E-05', '502', 'Aguas servidas', ''),
  ('edificio', 'E-05.3', 'E-05', '503', 'Aguas lluvias', ''),
  ('edificio', 'E-06', null, '600', 'Instalaciones eléctricas y especiales', ''),
  ('edificio', 'E-06.1', 'E-06', '601', 'Canalizaciones', ''),
  ('edificio', 'E-06.2', 'E-06', '602', 'Cableado', ''),
  ('edificio', 'E-06.3', 'E-06', '603', 'Tableros', ''),
  ('edificio', 'E-06.4', 'E-06', '604', 'Telecomunicaciones y seguridad', ''),
  ('edificio', 'E-07', null, '700', 'Cubiertas e impermeabilización', ''),
  ('edificio', 'E-07.1', 'E-07', '701', 'Cubiertas', ''),
  ('edificio', 'E-07.2', 'E-07', '702', 'Terrazas', ''),
  ('edificio', 'E-07.3', 'E-07', '703', 'Sellos y protección contra humedad', ''),
  ('edificio', 'E-08', null, '800', 'Enlucidos y revestimientos', ''),
  ('edificio', 'E-08.1', 'E-08', '801', 'Enlucidos', ''),
  ('edificio', 'E-08.2', 'E-08', '802', 'Pisos', ''),
  ('edificio', 'E-08.3', 'E-08', '803', 'Revestimientos', ''),
  ('edificio', 'E-08.4', 'E-08', '804', 'Fachadas', ''),
  ('edificio', 'E-09', null, '900', 'Carpintería y ventanería', ''),
  ('edificio', 'E-09.1', 'E-09', '901', 'Puertas', ''),
  ('edificio', 'E-09.2', 'E-09', '902', 'Ventanas', ''),
  ('edificio', 'E-09.3', 'E-09', '903', 'Aluminio y vidrio', ''),
  ('edificio', 'E-09.4', 'E-09', '904', 'Mobiliario fijo', ''),
  ('edificio', 'E-10', null, '1000', 'Acabados', ''),
  ('edificio', 'E-10.1', 'E-10', '1001', 'Pintura', ''),
  ('edificio', 'E-10.2', 'E-10', '1002', 'Aparatos sanitarios', ''),
  ('edificio', 'E-10.3', 'E-10', '1003', 'Luminarias', ''),
  ('edificio', 'E-10.4', 'E-10', '1004', 'Accesorios y detalles', ''),
  ('edificio', 'E-11', null, '1100', 'Sistemas y equipamiento', 'Solo los equipos que apliquen al edificio.'),
  ('edificio', 'E-11.1', 'E-11', '1101', 'Ascensores', ''),
  ('edificio', 'E-11.2', 'E-11', '1102', 'Bombas', ''),
  ('edificio', 'E-11.3', 'E-11', '1103', 'Sistemas contra incendios', ''),
  ('edificio', 'E-11.4', 'E-11', '1104', 'Otros equipos aplicables', ''),
  ('edificio', 'E-12', null, '1200', 'Pruebas, inspecciones y entrega', ''),
  ('edificio', 'E-12.1', 'E-12', '1201', 'Inspecciones', ''),
  ('edificio', 'E-12.2', 'E-12', '1202', 'Pruebas de instalaciones', ''),
  ('edificio', 'E-12.3', 'E-12', '1203', 'Correcciones', ''),
  ('edificio', 'E-12.4', 'E-12', '1204', 'Recepción', ''),
  ('urbanismo', 'U-01', null, '100', 'Vías y accesos', ''),
  ('urbanismo', 'U-01.1', 'U-01', '101', 'Vías internas', ''),
  ('urbanismo', 'U-01.2', 'U-01', '102', 'Accesos', ''),
  ('urbanismo', 'U-02', null, '200', 'Aceras y bordillos', ''),
  ('urbanismo', 'U-02.1', 'U-02', '201', 'Bordillos', ''),
  ('urbanismo', 'U-02.2', 'U-02', '202', 'Aceras', ''),
  ('urbanismo', 'U-03', null, '300', 'Infraestructura y redes', ''),
  ('urbanismo', 'U-03.1', 'U-03', '301', 'Redes de agua', ''),
  ('urbanismo', 'U-03.2', 'U-03', '302', 'Drenaje', ''),
  ('urbanismo', 'U-03.3', 'U-03', '303', 'Electricidad', ''),
  ('urbanismo', 'U-04', null, '400', 'Parques y áreas verdes', ''),
  ('urbanismo', 'U-04.1', 'U-04', '401', 'Parques', ''),
  ('urbanismo', 'U-04.2', 'U-04', '402', 'Jardinería y paisajismo', ''),
  ('urbanismo', 'U-04.3', 'U-04', '403', 'Caminerías', ''),
  ('urbanismo', 'U-05', null, '500', 'Garita y cerramientos', ''),
  ('urbanismo', 'U-05.1', 'U-05', '501', 'Garita', ''),
  ('urbanismo', 'U-05.2', 'U-05', '502', 'Cerramientos', ''),
  ('urbanismo', 'U-05.3', 'U-05', '503', 'Accesos y controles', ''),
  ('urbanismo', 'U-06', null, '600', 'Club y áreas comunes', ''),
  ('urbanismo', 'U-06.1', 'U-06', '601', 'Construcción', ''),
  ('urbanismo', 'U-06.2', 'U-06', '602', 'Instalaciones', ''),
  ('urbanismo', 'U-06.3', 'U-06', '603', 'Acabados', ''),
  ('urbanismo', 'U-06.4', 'U-06', '604', 'Equipamiento', ''),
  ('urbanismo', 'U-07', null, '700', 'Iluminación y obras exteriores', ''),
  ('urbanismo', 'U-07.1', 'U-07', '701', 'Iluminación exterior', ''),
  ('urbanismo', 'U-07.2', 'U-07', '702', 'Estacionamientos', ''),
  ('urbanismo', 'U-07.3', 'U-07', '703', 'Señalización', ''),
  ('urbanismo', 'U-07.4', 'U-07', '704', 'Otros elementos del proyecto', ''),
  ('urbanismo', 'U-08', null, '800', 'Pruebas y entrega', ''),
  ('urbanismo', 'U-08.1', 'U-08', '801', 'Pruebas', ''),
  ('urbanismo', 'U-08.2', 'U-08', '802', 'Inspecciones', ''),
  ('urbanismo', 'U-08.3', 'U-08', '803', 'Recepción', '')
on conflict (tipo, codigo) do nothing;

commit;
