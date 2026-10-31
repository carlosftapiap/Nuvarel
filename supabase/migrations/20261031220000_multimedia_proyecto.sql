-- AMURA · Biblioteca multimedia del proyecto: fotografías y videos administrados desde Configuración.
--   El administrador administra; el resto de usuarios activos solo lee lo publicado.
--   Reemplazar añade una versión: la anterior y su archivo se conservan, y se pueden restaurar.
--   Las cinco piezas actuales entran como versión 1, apuntando a los archivos que la app ya publica en /media.
-- No toca clientes, reservas, pagos ni el bucket de comprobantes. Se puede repetir.
-- Revertir: borrar las políticas "multimedia proyecto *" de storage.objects, el bucket multimedia-proyecto (primero sus archivos),
--   las tablas medio_versiones y medios_proyecto, las funciones medio_* y medios_*, y el permiso config.multimedia.
-- Ejecutar con un respaldo verificado.

do $$
begin
  if to_regclass('public.permissions') is null or to_regprocedure('public.tiene_permiso(text)') is null
     or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Faltan dependencias: instala antes los módulos de usuarios y de flujo comercial';
  end if;
end $$;

insert into public.permissions (clave, modulo, descripcion)
values ('config.multimedia', 'Configuración', 'Administrar fotografías y videos del proyecto')
on conflict (clave) do nothing;
insert into public.role_permissions (role_id, permiso)
select 'administrador', 'config.multimedia' where exists (select 1 from public.roles where id = 'administrador')
on conflict do nothing;

create table if not exists public.medios_proyecto (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('imagen', 'video')),
  titulo text not null check (char_length(btrim(titulo)) between 3 and 120),
  descripcion text not null default '' check (char_length(descripcion) <= 500),
  en_dashboard boolean not null default false,
  en_venta boolean not null default false,
  destacado boolean not null default false,
  orden int not null default 0,
  activo boolean not null default true,
  version_vigente uuid,
  eliminado_en timestamptz,
  eliminado_por uuid references public.profiles (id),
  creado_en timestamptz not null default now(),
  creado_por uuid references public.profiles (id),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.profiles (id)
);
-- Un solo contenido en el banner del Dashboard.
create unique index if not exists medios_proyecto_un_destacado on public.medios_proyecto (destacado) where destacado;

create table if not exists public.medio_versiones (
  id uuid primary key default gen_random_uuid(),
  medio_id uuid not null references public.medios_proyecto (id),
  numero int not null,
  ruta text not null,
  ruta_vertical text,
  miniatura_ruta text not null,
  mime text not null,
  tamano bigint,
  ancho int,
  alto int,
  duracion numeric,
  hash text,
  archivo_nombre text,
  cargado_por uuid references public.profiles (id),
  cargado_en timestamptz not null default now(),
  unique (medio_id, numero)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'medios_proyecto_version_fk') then
    alter table public.medios_proyecto add constraint medios_proyecto_version_fk foreign key (version_vigente) references public.medio_versiones (id);
  end if;
end $$;

/* --------------------------------------------------------------- lectura */

create or replace function public.medio_lector() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and estado = 'activo')
$$;

alter table public.medios_proyecto enable row level security;
alter table public.medio_versiones enable row level security;

-- Sin políticas de escritura: todo cambio pasa por las funciones de este archivo.
drop policy if exists "medios consultar" on public.medios_proyecto;
create policy "medios consultar" on public.medios_proyecto for select to authenticated
  using (public.tiene_permiso('config.multimedia')
         or (public.medio_lector() and activo and eliminado_en is null and (en_dashboard or en_venta)));

drop policy if exists "medio versiones consultar" on public.medio_versiones;
create policy "medio versiones consultar" on public.medio_versiones for select to authenticated
  using (public.tiene_permiso('config.multimedia')
         or (public.medio_lector() and exists (select 1 from public.medios_proyecto m where m.version_vigente = medio_versiones.id
                                               and m.activo and m.eliminado_en is null and (m.en_dashboard or m.en_venta))));

revoke insert, update, delete, truncate on public.medios_proyecto, public.medio_versiones from public, anon, authenticated;
revoke select on public.medios_proyecto, public.medio_versiones from public, anon;
grant select on public.medios_proyecto, public.medio_versiones to authenticated;

/* ------------------------------------------------------- archivos en Storage */

create or replace function public.medio_archivo_vinculado(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from medio_versiones v where p_ruta in (v.ruta, v.ruta_vertical, v.miniatura_ruta))
$$;

create or replace function public.medio_archivo_visible(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('config.multimedia')
    or (public.medio_lector() and exists (
      select 1 from medio_versiones v join medios_proyecto m on m.version_vigente = v.id
      where p_ruta in (v.ruta, v.ruta_vertical, v.miniatura_ruta) and m.activo and m.eliminado_en is null and (m.en_dashboard or m.en_venta)))
$$;

-- Lo que Storage registró al recibir el archivo, no lo que declara el navegador. Sin Storage (pruebas sin él), no aplica.
create or replace function public.medio_archivo_comprobar(p_ruta text, p_mimes text[], p_maximo bigint) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_mime text; v_tamano bigint; v_dueno text;
begin
  if coalesce(p_ruta, '') !~ '^archivos/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-[A-Za-z0-9._-]+$' then raise exception 'La ruta del archivo no es válida'; end if;
  if public.medio_archivo_vinculado(p_ruta) then raise exception 'Ese archivo ya pertenece a otra versión'; end if;
  if to_regclass('storage.objects') is null then return null; end if;
  execute 'select owner_id, metadata->>''mimetype'', (metadata->>''size'')::bigint from storage.objects where bucket_id = $1 and name = $2'
    into v_dueno, v_mime, v_tamano using 'multimedia-proyecto', p_ruta;
  if v_dueno is null then raise exception 'El archivo no se cargó con tu usuario'; end if;
  if v_dueno <> auth.uid()::text then raise exception 'El archivo no se cargó con tu usuario'; end if;
  if v_mime is null or not (v_mime = any (p_mimes)) then raise exception 'Formato de archivo no permitido'; end if;
  if v_tamano is null or v_tamano <= 0 or v_tamano > p_maximo then raise exception 'El archivo supera el tamaño permitido'; end if;
  return v_tamano;
end $$;

-- Crea la versión con los datos de la carga. No cambia cuál está vigente.
create or replace function public.medio_version_agregar(p_medio uuid, p_tipo text, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_ruta text := p_archivo->>'ruta'; v_vertical text := nullif(p_archivo->>'ruta_vertical', ''); v_mini text := p_archivo->>'miniatura_ruta';
  v_mime text := p_archivo->>'mime'; v_hash text := p_archivo->>'hash'; v_real bigint;
  v_mimes text[]; v_max bigint;
begin
  if p_tipo = 'imagen' then v_mimes := array['image/jpeg', 'image/png', 'image/webp']; v_max := 15728640;
  else v_mimes := array['video/mp4', 'video/webm']; v_max := 52428800; end if;
  if v_mime is null or not (v_mime = any (v_mimes)) then raise exception 'Formato de archivo no permitido'; end if;
  if coalesce(v_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Huella del archivo no válida'; end if;
  if v_vertical is not null and p_tipo <> 'video' then raise exception 'Solo un video tiene versión vertical'; end if;
  if v_ruta = v_mini or v_ruta = v_vertical or v_mini = v_vertical then raise exception 'La ruta del archivo no es válida'; end if;
  v_real := public.medio_archivo_comprobar(v_ruta, v_mimes, v_max);
  perform public.medio_archivo_comprobar(v_mini, array['image/webp', 'image/jpeg'], 5242880);
  if v_vertical is not null then perform public.medio_archivo_comprobar(v_vertical, v_mimes, v_max); end if;
  insert into medio_versiones (medio_id, numero, ruta, ruta_vertical, miniatura_ruta, mime, tamano, ancho, alto, duracion, hash, archivo_nombre, cargado_por)
  values (p_medio, coalesce((select max(numero) from medio_versiones where medio_id = p_medio), 0) + 1, v_ruta, v_vertical, v_mini, v_mime,
          coalesce(v_real, (p_archivo->>'tamano')::bigint), (p_archivo->>'ancho')::int, (p_archivo->>'alto')::int, (p_archivo->>'duracion')::numeric,
          v_hash, left(p_archivo->>'nombre', 200), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

/* --------------------------------------------------------- administración */

create or replace function public.medio_exigir_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('config.multimedia') then raise exception 'Solo un administrador puede modificar el material del proyecto' using errcode = '42501'; end if;
end $$;

create or replace function public.medio_crear(p_tipo text, p_titulo text, p_descripcion text, p_en_dashboard boolean, p_en_venta boolean, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_version uuid;
begin
  perform public.medio_exigir_admin();
  if p_tipo not in ('imagen', 'video') then raise exception 'Tipo de contenido no válido'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escribe un título de al menos 3 caracteres'; end if;
  insert into medios_proyecto (tipo, titulo, descripcion, en_dashboard, en_venta, orden, creado_por, actualizado_por)
  values (p_tipo, btrim(p_titulo), coalesce(btrim(p_descripcion), ''), coalesce(p_en_dashboard, false), coalesce(p_en_venta, false),
          coalesce((select max(orden) from medios_proyecto), 0) + 1, auth.uid(), auth.uid())
  returning id into v_id;
  v_version := public.medio_version_agregar(v_id, p_tipo, p_archivo);
  update medios_proyecto set version_vigente = v_version where id = v_id;
  perform public.auditar('Cargar contenido multimedia', 'multimedia', v_id::text, 'Nuevo contenido: ' || btrim(p_titulo), null, jsonb_build_object('tipo', p_tipo, 'version', 1), p_archivo->>'ruta');
  return v_id;
end $$;

create or replace function public.medio_reemplazar(p_id uuid, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto; v_version uuid;
begin
  perform public.medio_exigir_admin();
  select * into m from medios_proyecto where id = p_id for update;
  if not found or m.eliminado_en is not null then raise exception 'Este contenido ya no existe'; end if;
  v_version := public.medio_version_agregar(p_id, m.tipo, p_archivo);
  update medios_proyecto set version_vigente = v_version, actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  perform public.auditar('Reemplazar contenido multimedia', 'multimedia', p_id::text, 'Nueva versión de: ' || m.titulo, jsonb_build_object('version_id', m.version_vigente), jsonb_build_object('version_id', v_version), p_archivo->>'ruta');
  return v_version;
end $$;

create or replace function public.medio_restaurar_version(p_id uuid, p_version uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto; v_numero int;
begin
  perform public.medio_exigir_admin();
  select * into m from medios_proyecto where id = p_id for update;
  if not found or m.eliminado_en is not null then raise exception 'Este contenido ya no existe'; end if;
  select numero into v_numero from medio_versiones where id = p_version and medio_id = p_id;
  if not found then raise exception 'Esa versión no pertenece a este contenido'; end if;
  if m.version_vigente = p_version then return; end if;
  update medios_proyecto set version_vigente = p_version, actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  perform public.auditar('Restaurar versión multimedia', 'multimedia', p_id::text, 'Restaurada la versión ' || v_numero || ' de: ' || m.titulo, jsonb_build_object('version_id', m.version_vigente), jsonb_build_object('version_id', p_version));
end $$;

create or replace function public.medio_actualizar(p_id uuid, p_titulo text, p_descripcion text, p_en_dashboard boolean, p_en_venta boolean, p_activo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto;
begin
  perform public.medio_exigir_admin();
  select * into m from medios_proyecto where id = p_id for update;
  if not found or m.eliminado_en is not null then raise exception 'Este contenido ya no existe'; end if;
  if char_length(btrim(coalesce(p_titulo, ''))) < 3 then raise exception 'Escribe un título de al menos 3 caracteres'; end if;
  -- Lo que deja de verse en el Dashboard no puede seguir en el banner.
  update medios_proyecto set titulo = btrim(p_titulo), descripcion = coalesce(btrim(p_descripcion), ''), en_dashboard = p_en_dashboard, en_venta = p_en_venta, activo = p_activo,
    destacado = destacado and p_en_dashboard and p_activo, actualizado_en = now(), actualizado_por = auth.uid()
  where id = p_id;
  perform public.auditar('Editar contenido multimedia', 'multimedia', p_id::text, 'Datos de: ' || btrim(p_titulo),
    jsonb_build_object('titulo', m.titulo, 'en_dashboard', m.en_dashboard, 'en_venta', m.en_venta, 'activo', m.activo),
    jsonb_build_object('titulo', btrim(p_titulo), 'en_dashboard', p_en_dashboard, 'en_venta', p_en_venta, 'activo', p_activo));
end $$;

-- Sin contenido (null), el banner vuelve a la primera imagen publicada en el Dashboard.
create or replace function public.medio_destacar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto;
begin
  perform public.medio_exigir_admin();
  if p_id is not null then
    select * into m from medios_proyecto where id = p_id for update;
    if not found or m.eliminado_en is not null or not m.activo then raise exception 'Solo un contenido visible puede ir en el banner'; end if;
  end if;
  update medios_proyecto set destacado = false where destacado and id is distinct from p_id;
  if p_id is not null then
    update medios_proyecto set destacado = true, en_dashboard = true, actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  end if;
  perform public.auditar('Elegir banner del Dashboard', 'multimedia', coalesce(p_id::text, 'ninguno'), coalesce('Banner: ' || m.titulo, 'Banner sin contenido elegido'), null, null);
end $$;

create or replace function public.medio_reordenar(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.medio_exigir_admin();
  update medios_proyecto m set orden = o.pos, actualizado_en = now(), actualizado_por = auth.uid()
  from unnest(p_ids) with ordinality as o (id, pos) where m.id = o.id and m.orden is distinct from o.pos;
  perform public.auditar('Ordenar contenido multimedia', 'multimedia', 'orden', 'Nuevo orden de presentación', null, to_jsonb(p_ids));
end $$;

-- Eliminación lógica: los archivos y sus versiones se conservan y el contenido se puede recuperar.
create or replace function public.medio_eliminar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto;
begin
  perform public.medio_exigir_admin();
  select * into m from medios_proyecto where id = p_id for update;
  if not found or m.eliminado_en is not null then raise exception 'Este contenido ya no existe'; end if;
  update medios_proyecto set eliminado_en = now(), eliminado_por = auth.uid(), activo = false, destacado = false, actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  perform public.auditar('Eliminar contenido multimedia', 'multimedia', p_id::text, 'Eliminado sin borrar archivos: ' || m.titulo, null, null);
end $$;

-- Vuelve oculto: el administrador decide cuándo publicarlo otra vez.
create or replace function public.medio_recuperar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m medios_proyecto;
begin
  perform public.medio_exigir_admin();
  select * into m from medios_proyecto where id = p_id for update;
  if not found or m.eliminado_en is null then raise exception 'Este contenido no está eliminado'; end if;
  update medios_proyecto set eliminado_en = null, eliminado_por = null, actualizado_en = now(), actualizado_por = auth.uid() where id = p_id;
  perform public.auditar('Recuperar contenido multimedia', 'multimedia', p_id::text, 'Recuperado y oculto: ' || m.titulo, null, null);
end $$;

/* ------------------------------------------------------- archivos huérfanos */

-- Cargas interrumpidas. Las 24 horas evitan tocar una carga que aún esté en curso.
create or replace function public.medios_sin_vincular() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.medio_exigir_admin();
  if to_regclass('storage.objects') is null then return '[]'::jsonb; end if;
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('ruta', o.name, 'cargado_en', o.created_at) order by o.created_at), '[]'::jsonb) from storage.objects o
    where o.bucket_id = 'multimedia-proyecto' and o.created_at < now() - interval '24 hours' and not public.medio_archivo_vinculado(o.name)$q$ into v;
  return v;
end $$;

create or replace function public.medio_limpieza_registrar(p_ruta text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.medio_exigir_admin();
  if public.medio_archivo_vinculado(p_ruta) then raise exception 'Este archivo pertenece a una versión y no se puede quitar'; end if;
  perform public.auditar('Quitar archivo multimedia sin vincular', 'multimedia', p_ruta, 'Archivo sin vincular por más de 24 horas', null, null, p_ruta);
end $$;

/* ---------------------------------------------------- material actual de AMURA */

-- Los títulos y descripciones se pueden cambiar desde Configuración. Repetir la migración no pisa esos cambios.
insert into public.medios_proyecto (id, tipo, titulo, descripcion, en_dashboard, en_venta, destacado, orden) values
  ('a1000000-0000-4000-8000-000000000001', 'video', 'Video promocional de AMURA', 'Presentación del proyecto en 24 segundos.', true, true, false, 1),
  ('a1000000-0000-4000-8000-000000000002', 'imagen', 'Torres AMURA', 'Dos torres de seis niveles: 30 apartamentos en el Edificio 1 y 42 en el Edificio 2.', true, true, true, 2),
  ('a1000000-0000-4000-8000-000000000003', 'imagen', 'Sala y comedor', 'Sala y comedor de un departamento, con balcón.', true, true, false, 3),
  ('a1000000-0000-4000-8000-000000000004', 'imagen', 'Dormitorio', 'Dormitorio de un departamento, con ventana amplia.', true, true, false, 4),
  ('a1000000-0000-4000-8000-000000000005', 'imagen', 'Piso Edificio 1', 'Distribución de un piso del Edificio 1 en vista tridimensional.', true, true, false, 5)
on conflict (id) do nothing;

insert into public.medio_versiones (id, medio_id, numero, ruta, ruta_vertical, miniatura_ruta, mime, ancho, alto, duracion, archivo_nombre) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 1, '/media/video-horizontal.mp4', '/media/video-vertical.mp4', '/media/portada-horizontal.webp', 'video/mp4', 1920, 1080, 24, 'AMURA HORIZONTAL 24s.mp4'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 1, '/media/torres.webp', null, '/media/miniaturas/torres.webp', 'image/webp', 941, 1672, null, 'TORRES AMURA DIA.webp'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 1, '/media/sala.webp', null, '/media/miniaturas/sala.webp', 'image/webp', 1122, 1402, null, 'SALA COMEDOR AMURA.webp'),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000004', 1, '/media/dormitorio.webp', null, '/media/miniaturas/dormitorio.webp', 'image/webp', 1122, 1402, null, 'DORMITORIO AMURA.webp'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000005', 1, '/media/piso.webp', null, '/media/miniaturas/piso.webp', 'image/webp', 1122, 1402, null, 'PISO EDIF 1.webp')
on conflict (id) do nothing;

update public.medios_proyecto m set version_vigente = ('a2' || substr(m.id::text, 3))::uuid
where m.version_vigente is null and m.id::text like 'a1000000-0000-4000-8000-00000000000_';

/* ---------------------------------------------------------------- storage */

-- Bucket propio y privado. Sin política de actualización: un archivo no se sobrescribe; una versión nueva es un archivo nuevo.
do $d$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('multimedia-proyecto', 'multimedia-proyecto', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
    on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = excluded.allowed_mime_types;
    drop policy if exists "multimedia proyecto consultar" on storage.objects;
    create policy "multimedia proyecto consultar" on storage.objects for select to authenticated
      using (bucket_id = 'multimedia-proyecto' and public.medio_archivo_visible(name));
    drop policy if exists "multimedia proyecto cargar" on storage.objects;
    create policy "multimedia proyecto cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'multimedia-proyecto' and name like 'archivos/%' and public.tiene_permiso('config.multimedia'));
    -- Lo que pertenece a una versión nunca se borra; solo cargas sin registrar.
    drop policy if exists "multimedia proyecto limpiar" on storage.objects;
    create policy "multimedia proyecto limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'multimedia-proyecto' and public.tiene_permiso('config.multimedia') and not public.medio_archivo_vinculado(name)
             and (owner_id = auth.uid()::text or created_at < now() - interval '24 hours'));
  end if;
end $d$;

/* --------------------------------------------------------------- accesos */

revoke all on function public.medio_lector() from public, anon, authenticated;
revoke all on function public.medio_archivo_vinculado(text) from public, anon;
revoke all on function public.medio_archivo_visible(text) from public, anon;
revoke all on function public.medio_archivo_comprobar(text, text[], bigint) from public, anon, authenticated;
revoke all on function public.medio_version_agregar(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.medio_exigir_admin() from public, anon, authenticated;
revoke all on function public.medio_crear(text, text, text, boolean, boolean, jsonb) from public, anon;
revoke all on function public.medio_reemplazar(uuid, jsonb) from public, anon;
revoke all on function public.medio_restaurar_version(uuid, uuid) from public, anon;
revoke all on function public.medio_actualizar(uuid, text, text, boolean, boolean, boolean) from public, anon;
revoke all on function public.medio_destacar(uuid) from public, anon;
revoke all on function public.medio_reordenar(uuid[]) from public, anon;
revoke all on function public.medio_eliminar(uuid) from public, anon;
revoke all on function public.medio_recuperar(uuid) from public, anon;
revoke all on function public.medios_sin_vincular() from public, anon;
revoke all on function public.medio_limpieza_registrar(text) from public, anon;

-- Las políticas se evalúan con el usuario de la sesión: necesitan poder ejecutar estas funciones.
grant execute on function public.medio_lector() to authenticated;
grant execute on function public.medio_archivo_vinculado(text) to authenticated;
grant execute on function public.medio_archivo_visible(text) to authenticated;
grant execute on function public.medio_crear(text, text, text, boolean, boolean, jsonb) to authenticated;
grant execute on function public.medio_reemplazar(uuid, jsonb) to authenticated;
grant execute on function public.medio_restaurar_version(uuid, uuid) to authenticated;
grant execute on function public.medio_actualizar(uuid, text, text, boolean, boolean, boolean) to authenticated;
grant execute on function public.medio_destacar(uuid) to authenticated;
grant execute on function public.medio_reordenar(uuid[]) to authenticated;
grant execute on function public.medio_eliminar(uuid) to authenticated;
grant execute on function public.medio_recuperar(uuid) to authenticated;
grant execute on function public.medios_sin_vincular() to authenticated;
grant execute on function public.medio_limpieza_registrar(text) to authenticated;
