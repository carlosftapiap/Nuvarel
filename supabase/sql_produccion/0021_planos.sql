-- AMURA · SQL de producción 0021. Copia exacta de supabase/migrations/20261130000000_planos.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- Planos AMURA: planos generales de piso y planos individuales de departamento.
-- Bucket privado `planos-amura`. Solo el permiso config.planos (administrador) carga, publica y rechaza.
-- Los demás perfiles solo ven planos publicados. La base compara lo que dice el plano (nivel y unidades)
-- con el inventario: si no coincide o el archivo está repetido, queda «en revisión» y no se puede publicar.
-- Solo agrega: no modifica inventario, cotizaciones, reservas, pagos ni formularios.

insert into public.permissions (clave, modulo, descripcion)
values ('config.planos', 'Configuración', 'Cargar, revisar y publicar planos de piso y de departamento')
on conflict (clave) do nothing;
insert into public.role_permissions (role_id, permiso)
select 'administrador', 'config.planos' where exists (select 1 from public.roles where id = 'administrador')
on conflict do nothing;

create table if not exists public.planos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('piso', 'unidad')),
  edificio smallint not null check (edificio in (1, 2)),
  piso text not null check (piso in ('PB', '1', '2', '3', '4', '5')),
  -- Sin clave foránea: la migración 0016 controla las relaciones de Inventario. planos_registrar valida que la unidad exista.
  unidad_codigo text,
  -- Lo que dice el plano, tal como lo lee el administrador (no se asume que coincida con el inventario).
  nivel_en_plano text not null check (char_length(btrim(nivel_en_plano)) between 1 and 20),
  unidades_en_plano text[] not null default '{}',
  archivo_nombre text not null check (char_length(archivo_nombre) between 1 and 200),
  ruta text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  paginas integer not null check (paginas between 1 and 20),
  estado text not null check (estado in ('en_revision', 'pendiente_aprobacion', 'publicado', 'reemplazado', 'rechazado')),
  inconsistencias jsonb not null default '[]'::jsonb,
  motivo_rechazo text,
  cargado_por uuid references auth.users (id),
  cargado_en timestamptz not null default now(),
  aprobado_por uuid references auth.users (id),
  aprobado_en timestamptz,
  check ((tipo = 'unidad') = (unidad_codigo is not null))
);

-- Un solo plano publicado por piso (tipo piso) o por departamento (tipo unidad).
create unique index if not exists planos_publicado_uk on public.planos (tipo, edificio, piso, coalesce(unidad_codigo, '')) where estado = 'publicado';
create index if not exists planos_ubicacion_idx on public.planos (edificio, piso);

alter table public.planos enable row level security;
revoke insert, update, delete on public.planos from anon, authenticated;
grant select on public.planos to authenticated;

drop policy if exists "planos consultar" on public.planos;
create policy "planos consultar" on public.planos for select to authenticated
  using (estado = 'publicado' or public.tiene_permiso('config.planos'));

-- Normaliza un código escrito en el plano: «B-101» → «B101», «P-3» → «3», «PB» → «PB».
create or replace function public.plano_normalizar_unidad(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function public.plano_normalizar_nivel(p text) returns text
language sql immutable as $$
  select case
    when upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) in ('PB', 'P0', '0', 'PLANTABAJA') then 'PB'
    else regexp_replace(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '^(P|PISO|PLANTAALTA|PA)', '')
  end
$$;

-- Diferencias entre lo que dice el plano y el inventario. Lista vacía: el plano es consistente.
create or replace function public.plano_inconsistencias(
  p_id uuid, p_tipo text, p_edificio smallint, p_piso text, p_unidad text, p_nivel text, p_unidades text[], p_sha256 text
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  e text[] := '{}';
  v_nivel text := public.plano_normalizar_nivel(p_nivel);
  v_declaradas text[];
  v_inventario text[];
  v_sobran text[];
  v_faltan text[];
  v_unidad inventory_units;
  v_dup record;
begin
  select coalesce(array_agg(distinct public.plano_normalizar_unidad(x)) filter (where btrim(x) <> ''), '{}') into v_declaradas from unnest(coalesce(p_unidades, '{}')) x;
  select coalesce(array_agg(dpt order by dpt), '{}') into v_inventario from inventory_units where edificio = p_edificio and piso = p_piso;

  if v_nivel is distinct from p_piso then
    e := e || format('El plano indica el nivel «%s» y se cargó para el piso %s del inventario.', p_nivel, case when p_piso = 'PB' then 'PB' else p_piso end);
  end if;
  if cardinality(v_declaradas) = 0 then
    e := e || 'No se registraron las unidades que aparecen en el plano.'::text;
  end if;

  if p_tipo = 'unidad' then
    select * into v_unidad from inventory_units where codigo = p_unidad;
    if not found then
      e := e || 'El departamento no existe en el inventario.'::text;
    else
      if v_unidad.edificio <> p_edificio or v_unidad.piso <> p_piso then
        e := e || format('El departamento %s pertenece a otro edificio o piso del inventario.', v_unidad.dpt);
      end if;
      if cardinality(v_declaradas) > 0 and v_declaradas <> array[v_unidad.dpt] then
        e := e || format('El plano muestra %s y se cargó para el departamento %s.', array_to_string(v_declaradas, ', '), v_unidad.dpt);
      end if;
    end if;
  elsif cardinality(v_declaradas) > 0 then
    select coalesce(array_agg(x order by x), '{}') into v_sobran from unnest(v_declaradas) x where x <> all (v_inventario);
    select coalesce(array_agg(x order by x), '{}') into v_faltan from unnest(v_inventario) x where x <> all (v_declaradas);
    if cardinality(v_sobran) > 0 then
      e := e || format('El plano muestra unidades que no están en ese piso del inventario: %s.', array_to_string(v_sobran, ', '));
    end if;
    if cardinality(v_faltan) > 0 then
      e := e || format('Faltan en el plano unidades de ese piso del inventario: %s.', array_to_string(v_faltan, ', '));
    end if;
  end if;

  for v_dup in
    select p.edificio, p.piso, p.tipo from planos p
     where p.sha256 = p_sha256 and p.id is distinct from p_id and p.estado in ('en_revision', 'pendiente_aprobacion', 'publicado')
  loop
    e := e || format('El archivo es idéntico a otro plano cargado (edificio %s, piso %s).', case v_dup.edificio when 1 then 'A' else 'B' end, v_dup.piso);
  end loop;

  return to_jsonb(e);
end $$;

-- Registra un plano recién subido. Queda en revisión si tiene inconsistencias, o pendiente de aprobación si no.
create or replace function public.planos_registrar(
  p_tipo text, p_edificio smallint, p_piso text, p_unidad text, p_nivel_en_plano text, p_unidades text[],
  p_ruta text, p_sha256 text, p_paginas integer, p_nombre text
) returns json
language plpgsql security definer set search_path = public, storage as $$
declare v_inc jsonb; r planos;
begin
  if auth.uid() is null or not public.tiene_permiso('config.planos') then
    raise exception 'Solo un administrador puede cargar planos.' using errcode = '42501';
  end if;
  if p_ruta !~ ('^E' || p_edificio || '/' || p_piso || '/') then
    raise exception 'Ruta de archivo no válida.';
  end if;
  if to_regclass('storage.objects') is not null
     and not exists (select 1 from storage.objects o where o.bucket_id = 'planos-amura' and o.name = p_ruta) then
    raise exception 'El archivo no se encontró en el almacenamiento de planos.';
  end if;
  v_inc := public.plano_inconsistencias(null, p_tipo, p_edificio, p_piso, nullif(p_unidad, ''), p_nivel_en_plano, p_unidades, lower(p_sha256));
  insert into planos (tipo, edificio, piso, unidad_codigo, nivel_en_plano, unidades_en_plano, archivo_nombre, ruta, sha256, paginas, estado, inconsistencias, cargado_por)
  values (p_tipo, p_edificio, p_piso, nullif(p_unidad, ''), btrim(p_nivel_en_plano), coalesce(p_unidades, '{}'), left(p_nombre, 200), p_ruta, lower(p_sha256), p_paginas,
          case when jsonb_array_length(v_inc) = 0 then 'pendiente_aprobacion' else 'en_revision' end, v_inc, auth.uid())
  returning * into r;
  return json_build_object('id', r.id, 'estado', r.estado, 'inconsistencias', r.inconsistencias);
end $$;

-- Publica un plano consistente. Recalcula las inconsistencias en el momento: si aparece alguna, no publica.
-- El plano publicado anterior del mismo piso o departamento pasa a «reemplazado» (se conserva).
create or replace function public.planos_publicar(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare p planos; v_inc jsonb;
begin
  if auth.uid() is null or not public.tiene_permiso('config.planos') then
    raise exception 'Solo un administrador puede publicar planos.' using errcode = '42501';
  end if;
  select * into p from planos where id = p_id for update;
  if not found then raise exception 'El plano no existe.'; end if;
  if p.estado <> 'pendiente_aprobacion' then
    raise exception 'Solo se publica un plano pendiente de aprobación (estado actual: %).', p.estado;
  end if;
  v_inc := public.plano_inconsistencias(p.id, p.tipo, p.edificio, p.piso, p.unidad_codigo, p.nivel_en_plano, p.unidades_en_plano, p.sha256);
  if jsonb_array_length(v_inc) > 0 then
    update planos set estado = 'en_revision', inconsistencias = v_inc where id = p.id;
    return json_build_object('id', p.id, 'estado', 'en_revision', 'inconsistencias', v_inc);
  end if;
  update planos set estado = 'reemplazado'
   where estado = 'publicado' and tipo = p.tipo and edificio = p.edificio and piso = p.piso and coalesce(unidad_codigo, '') = coalesce(p.unidad_codigo, '');
  update planos set estado = 'publicado', aprobado_por = auth.uid(), aprobado_en = now() where id = p.id;
  return json_build_object('id', p.id, 'estado', 'publicado', 'inconsistencias', '[]'::jsonb);
end $$;

-- Descarta un plano (en revisión o pendiente). Se conserva con su motivo; el archivo deja de estar disponible.
create or replace function public.planos_rechazar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.tiene_permiso('config.planos') then
    raise exception 'Solo un administrador puede rechazar planos.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indica el motivo del rechazo.'; end if;
  update planos set estado = 'rechazado', motivo_rechazo = btrim(p_motivo)
   where id = p_id and estado in ('en_revision', 'pendiente_aprobacion');
  if not found then raise exception 'Solo se rechaza un plano en revisión o pendiente de aprobación.'; end if;
end $$;

revoke all on function public.plano_inconsistencias(uuid, text, smallint, text, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.planos_registrar(text, smallint, text, text, text, text[], text, text, integer, text) from public, anon;
revoke all on function public.planos_publicar(uuid) from public, anon;
revoke all on function public.planos_rechazar(uuid, text) from public, anon;
grant execute on function public.planos_registrar(text, smallint, text, text, text, text[], text, text, integer, text) to authenticated;
grant execute on function public.planos_publicar(uuid) to authenticated;
grant execute on function public.planos_rechazar(uuid, text) to authenticated;

-- Storage: bucket privado, solo PDF. Lectura: archivos de planos publicados, o el administrador. Carga y limpieza: administrador.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('planos-amura', 'planos-amura', false, 20971520, array['application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

    drop policy if exists "planos amura consultar" on storage.objects;
    create policy "planos amura consultar" on storage.objects for select to authenticated
      using (bucket_id = 'planos-amura' and (
        public.tiene_permiso('config.planos')
        or exists (select 1 from public.planos p where p.ruta = name and p.estado = 'publicado')));

    drop policy if exists "planos amura cargar" on storage.objects;
    create policy "planos amura cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'planos-amura' and public.tiene_permiso('config.planos'));

    drop policy if exists "planos amura limpiar" on storage.objects;
    create policy "planos amura limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'planos-amura' and public.tiene_permiso('config.planos')
             and not exists (select 1 from public.planos p where p.ruta = name));
  end if;
end $$;
