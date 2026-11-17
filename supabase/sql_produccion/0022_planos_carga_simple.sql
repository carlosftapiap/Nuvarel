-- AMURA · SQL de producción 0022. Copia exacta de supabase/migrations/20261201000000_planos_carga_simple.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- Planos AMURA: carga directa (sobre la 0021, ya ejecutada).
-- Sección exclusiva del administrador (permiso config.planos, sin cambios). Sin pasos de aprobación:
--   · Un PDF sin inconsistencias queda publicado al cargarlo y lo ven vendedores y supervisores.
--   · Si ya hay un plano publicado del mismo edificio, piso y tipo (o del mismo departamento), solo se sustituye
--     con confirmación expresa (p_reemplazar). El anterior pasa a «reemplazado» y se conserva.
--   · Con inconsistencias (departamento de otro piso, numeración registrada que no coincide, archivo repetido)
--     el plano queda «bloqueado» (estado en_revision): no se publica y no se muestra a vendedores.
--   · Eliminar no borra: el plano pasa a «eliminado», deja de mostrarse y su archivo se conserva internamente.
-- La numeración original del plano (nivel y unidades) es opcional; si se registra, se compara con el inventario.
-- No modifica filas existentes de planos ni ninguna otra tabla.

alter table public.planos alter column nivel_en_plano drop not null;
alter table public.planos drop constraint if exists planos_nivel_en_plano_check;
alter table public.planos add constraint planos_nivel_en_plano_check
  check (nivel_en_plano is null or char_length(btrim(nivel_en_plano)) between 1 and 20);

alter table public.planos drop constraint if exists planos_estado_check;
alter table public.planos add constraint planos_estado_check
  check (estado in ('en_revision', 'pendiente_aprobacion', 'publicado', 'reemplazado', 'rechazado', 'eliminado'));
alter table public.planos add column if not exists eliminado_por uuid references auth.users (id);
alter table public.planos add column if not exists eliminado_en timestamptz;

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

  -- La numeración del plano es opcional: solo se compara lo que el administrador registró.
  if nullif(btrim(p_nivel), '') is not null and v_nivel is distinct from p_piso then
    e := e || format('El plano indica el nivel «%s» y se cargó para el piso %s del inventario.', p_nivel, case when p_piso = 'PB' then 'PB' else p_piso end);
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

-- Se retiran las funciones del flujo de aprobación de la 0021.
drop function if exists public.planos_registrar(text, smallint, text, text, text, text[], text, text, integer, text);
drop function if exists public.planos_publicar(uuid);
drop function if exists public.planos_rechazar(uuid, text);

-- Registra un plano recién subido. Sin inconsistencias: queda publicado (reemplazando al anterior solo con confirmación).
-- Con inconsistencias: queda bloqueado (en_revision) y no se muestra a vendedores.
create or replace function public.planos_registrar(
  p_tipo text, p_edificio smallint, p_piso text, p_unidad text, p_nivel_en_plano text, p_unidades text[],
  p_ruta text, p_sha256 text, p_paginas integer, p_nombre text, p_reemplazar boolean
) returns json
language plpgsql security definer set search_path = public, storage as $$
declare v_inc jsonb; r planos; v_anterior planos;
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

  if jsonb_array_length(v_inc) = 0 then
    select * into v_anterior from planos
     where estado = 'publicado' and tipo = p_tipo and edificio = p_edificio and piso = p_piso
       and coalesce(unidad_codigo, '') = coalesce(nullif(p_unidad, ''), '')
     for update;
    if found then
      if p_reemplazar is not true then
        raise exception 'Ya hay un plano publicado para esta ubicación (%). Confirma que quieres reemplazarlo.', v_anterior.archivo_nombre;
      end if;
      update planos set estado = 'reemplazado' where id = v_anterior.id;
    end if;
  end if;

  insert into planos (tipo, edificio, piso, unidad_codigo, nivel_en_plano, unidades_en_plano, archivo_nombre, ruta, sha256, paginas,
                      estado, inconsistencias, cargado_por, aprobado_por, aprobado_en)
  values (p_tipo, p_edificio, p_piso, nullif(p_unidad, ''), nullif(btrim(p_nivel_en_plano), ''), coalesce(p_unidades, '{}'), left(p_nombre, 200), p_ruta, lower(p_sha256), p_paginas,
          case when jsonb_array_length(v_inc) = 0 then 'publicado' else 'en_revision' end, v_inc, auth.uid(),
          case when jsonb_array_length(v_inc) = 0 then auth.uid() end, case when jsonb_array_length(v_inc) = 0 then now() end)
  returning * into r;
  return json_build_object('id', r.id, 'estado', r.estado, 'inconsistencias', r.inconsistencias, 'reemplazo', v_anterior.id);
end $$;

-- Retira un plano (publicado o bloqueado). No borra el registro ni el archivo: se conservan como historial interno.
create or replace function public.planos_eliminar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.tiene_permiso('config.planos') then
    raise exception 'Solo un administrador puede eliminar planos.' using errcode = '42501';
  end if;
  update planos set estado = 'eliminado', eliminado_por = auth.uid(), eliminado_en = now()
   where id = p_id and estado in ('publicado', 'en_revision', 'pendiente_aprobacion');
  if not found then raise exception 'El plano no existe o ya fue retirado.'; end if;
end $$;

revoke all on function public.plano_inconsistencias(uuid, text, smallint, text, text, text, text[], text) from public, anon, authenticated;
revoke all on function public.planos_registrar(text, smallint, text, text, text, text[], text, text, integer, text, boolean) from public, anon;
revoke all on function public.planos_eliminar(uuid) from public, anon;
grant execute on function public.planos_registrar(text, smallint, text, text, text, text[], text, text, integer, text, boolean) to authenticated;
grant execute on function public.planos_eliminar(uuid) to authenticated;
