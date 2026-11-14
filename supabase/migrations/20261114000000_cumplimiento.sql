-- AMURA · Oficial de Cumplimiento, expediente del cliente y revisión antes de la firma (fase 3 del plan de brechas, decisiones 3, 4 y 7).
--   · Rol nuevo oficial_cumplimiento: ve Clientes y Ventas y contratos, descarga el expediente, observa, aprueba o rechaza. No toca pagos, precios ni contratos.
--   · Expediente: documentos habilitantes por persona (cliente o comprador sin ficha), en el bucket privado expediente-clientes.
--     Cargar el mismo tipo otra vez crea una versión nueva; la anterior queda "reemplazado" y no se borra.
--   · Revisión del contrato: Legal la envía; Cumplimiento la resuelve. Cada cambio es una fila nueva (historial completo).
--   · Un contrato en borrador solo pasa a firmado con la última revisión aprobada. Los contratos ya firmados no se tocan.
--   · Descargas y revisiones quedan en auditoría.
-- Catálogo de tipos en expediente_tipos, provisional y versionado (expediente_catalogo): se ajusta sin migración cuando llegue la lista de Jarval.
-- Separación de funciones: quien carga un documento no lo revisa; quien prepara o envía el expediente no lo aprueba.
-- Revertir (solo sin documentos ni revisiones): borrar el disparador contratos_cumplimiento y su función, las funciones expediente_* y cumplimiento_*,
--   las tablas cumplimiento_revisiones, expediente_documentos, expediente_tipos_historial, expediente_catalogo y expediente_tipos, las columnas tipo_persona, las políticas "expediente clientes *",
--   el bucket expediente-clientes (primero sus archivos), el rol oficial_cumplimiento y los permisos cumplimiento.*.
-- Antes de aplicar: listar contratos en borrador (quedarán sin poder firmarse hasta pasar Cumplimiento). Ejecutar con un respaldo verificado.

do $$
begin
  if to_regclass('public.contract_buyers') is null or to_regprocedure('public.contratos_tomar(uuid, text)') is null
     or to_regprocedure('public.cliente_en_alcance(uuid)') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Faltan dependencias: instala antes Clientes, Ventas y contratos y Documentos contractuales';
  end if;
end $$;

/* ---------------------------------------------------------- rol y permisos */

insert into public.permissions (clave, modulo, descripcion) values
  ('cumplimiento.ver', 'Cumplimiento', 'Consultar y descargar el expediente de cumplimiento'),
  ('cumplimiento.revisar', 'Cumplimiento', 'Observar, aprobar o rechazar documentos y expedientes')
on conflict (clave) do nothing;
insert into public.roles (id, nombre, descripcion, alcance, sistema)
values ('oficial_cumplimiento', 'Oficial de Cumplimiento', 'Revisión del expediente del cliente antes de la firma, sin acceso a pagos ni precios', 'empresa', true)
on conflict (id) do nothing;
insert into public.role_permissions (role_id, permiso)
select r, p from (values
  ('administrador', 'cumplimiento.ver'), ('administrador', 'cumplimiento.revisar'),
  ('oficial_cumplimiento', 'clientes.ver'), ('oficial_cumplimiento', 'reservas.ver'), ('oficial_cumplimiento', 'ventas.ver'),
  ('oficial_cumplimiento', 'ventas.documentos_ver'), ('oficial_cumplimiento', 'cumplimiento.ver'), ('oficial_cumplimiento', 'cumplimiento.revisar')
) x(r, p) where exists (select 1 from public.roles where id = x.r)
on conflict do nothing;

-- Ventas y contratos lee los parámetros de pago (porcentajes) para mostrar las condiciones comerciales del contrato.
-- Solo se agrega cumplimiento.ver (Oficial y Administrador): ningún otro perfil gana acceso.
drop policy if exists "leer parametros" on public.pricing_params;
create policy "leer parametros" on public.pricing_params for select to authenticated
  using (public.tiene_permiso('inventario.ver') or public.tiene_permiso('financiamiento.simular') or public.tiene_permiso('cotizaciones.ver') or public.tiene_permiso('cumplimiento.ver'));

/* --------------------------------------------------- tipo de persona y tipos */

alter table public.clients add column if not exists tipo_persona text not null default 'natural';
alter table public.contract_buyers add column if not exists tipo_persona text not null default 'natural';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clients_tipo_persona_valido') then
    alter table public.clients add constraint clients_tipo_persona_valido check (tipo_persona in ('natural', 'juridica'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contract_buyers_tipo_persona_valido') then
    alter table public.contract_buyers add constraint contract_buyers_tipo_persona_valido check (tipo_persona in ('natural', 'juridica'));
  end if;
end $$;

create table if not exists public.expediente_tipos (
  clave text primary key,
  tipo_persona text not null check (tipo_persona in ('natural', 'juridica')),
  nombre text not null,
  obligatorio boolean not null default true,
  orden int not null default 0,
  activo boolean not null default true
);
insert into public.expediente_tipos (clave, tipo_persona, nombre, orden) values
  ('pn_cedula', 'natural', 'Cédula de identidad', 1),
  ('pn_votacion', 'natural', 'Certificado de votación', 2),
  ('pn_servicio_basico', 'natural', 'Planilla de servicio básico', 3),
  ('pn_origen_fondos', 'natural', 'Declaración de origen de fondos', 4),
  ('pn_conozca_cliente', 'natural', 'Formulario Conozca a su Cliente (firmado)', 5),
  ('pj_ruc', 'juridica', 'RUC', 1),
  ('pj_constitucion', 'juridica', 'Escritura de constitución', 2),
  ('pj_nombramiento', 'juridica', 'Nombramiento del representante legal', 3),
  ('pj_cedula_representante', 'juridica', 'Cédula del representante legal', 4),
  ('pj_accionistas', 'juridica', 'Nómina de accionistas', 5),
  ('pj_origen_fondos', 'juridica', 'Declaración de origen de fondos', 6),
  ('pj_conozca_cliente', 'juridica', 'Formulario Conozca a su Cliente (firmado)', 7)
on conflict (clave) do nothing;
-- Lista provisional y versionada hasta recibir la definitiva de Jarval. Cada cambio crea una versión con su copia completa.
create table if not exists public.expediente_catalogo (
  version int primary key,
  provisional boolean not null default true,
  motivo text not null,
  definido_por uuid references auth.users (id),
  definido_en timestamptz not null default now()
);
create table if not exists public.expediente_tipos_historial (
  version int not null references public.expediente_catalogo (version),
  clave text not null, tipo_persona text not null, nombre text not null, obligatorio boolean not null, orden int not null, activo boolean not null,
  primary key (version, clave)
);
insert into public.expediente_catalogo (version, provisional, motivo) values (1, true, 'Lista provisional hasta recibir la definitiva de Jarval') on conflict do nothing;
insert into public.expediente_tipos_historial (version, clave, tipo_persona, nombre, obligatorio, orden, activo)
select 1, clave, tipo_persona, nombre, obligatorio, orden, activo from public.expediente_tipos on conflict do nothing;
alter table public.expediente_catalogo enable row level security;
alter table public.expediente_tipos_historial enable row level security;
drop policy if exists "ver catalogo de expediente" on public.expediente_catalogo;
create policy "ver catalogo de expediente" on public.expediente_catalogo for select to authenticated
  using (public.tiene_permiso('clientes.ver') or public.tiene_permiso('ventas.ver') or public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('config.roles'));
drop policy if exists "ver historial de catalogo" on public.expediente_tipos_historial;
create policy "ver historial de catalogo" on public.expediente_tipos_historial for select to authenticated
  using (public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('config.roles'));
grant select on public.expediente_catalogo, public.expediente_tipos_historial to authenticated;

-- Agrega o cambia un tipo y deja una versión nueva del catálogo con su copia completa. Ningún tipo se borra: se desactiva.
create or replace function public.expediente_catalogo_definir(p_clave text, p_tipo_persona text, p_nombre text, p_obligatorio boolean, p_orden int, p_activo boolean, p_provisional boolean, p_motivo text) returns int
language plpgsql security definer set search_path = public as $$
declare v int; v_m text := btrim(coalesce(p_motivo, '')); v_antes jsonb;
begin
  if not public.tiene_permiso('config.roles') then raise exception 'Solo administración define el catálogo de documentos' using errcode = '42501'; end if;
  if char_length(v_m) < 10 then raise exception 'Indica el motivo del cambio (mínimo 10 caracteres)'; end if;
  if coalesce(p_clave, '') !~ '^[a-z][a-z0-9_]{2,40}$' then raise exception 'Clave no válida: minúsculas, números y guion bajo'; end if;
  if p_tipo_persona not in ('natural', 'juridica') then raise exception 'Tipo de persona no válido'; end if;
  if char_length(btrim(coalesce(p_nombre, ''))) < 3 then raise exception 'Indica el nombre del documento'; end if;
  perform pg_advisory_xact_lock(hashtext('expediente_catalogo'));
  select to_jsonb(t) into v_antes from expediente_tipos t where clave = p_clave;
  if v_antes is not null and v_antes ->> 'tipo_persona' <> p_tipo_persona then raise exception 'Un tipo existente no cambia de tipo de persona: crea otra clave'; end if;
  select coalesce(max(version), 0) + 1 into v from expediente_catalogo;
  insert into expediente_catalogo (version, provisional, motivo, definido_por) values (v, coalesce(p_provisional, true), v_m, auth.uid());
  insert into expediente_tipos (clave, tipo_persona, nombre, obligatorio, orden, activo)
  values (p_clave, p_tipo_persona, btrim(p_nombre), coalesce(p_obligatorio, true), coalesce(p_orden, 0), coalesce(p_activo, true))
  on conflict (clave) do update set nombre = excluded.nombre, obligatorio = excluded.obligatorio, orden = excluded.orden, activo = excluded.activo;
  insert into expediente_tipos_historial (version, clave, tipo_persona, nombre, obligatorio, orden, activo)
  select v, clave, tipo_persona, nombre, obligatorio, orden, activo from expediente_tipos;
  perform public.auditar('Definir catálogo de documentos del expediente', 'catalogo', v::text, v_m, v_antes,
    jsonb_build_object('clave', p_clave, 'nombre', btrim(p_nombre), 'obligatorio', p_obligatorio, 'activo', p_activo, 'version', v));
  return v;
end $$;

alter table public.expediente_tipos enable row level security;
drop policy if exists "ver tipos de expediente" on public.expediente_tipos;
create policy "ver tipos de expediente" on public.expediente_tipos for select to authenticated
  using (public.tiene_permiso('clientes.ver') or public.tiene_permiso('ventas.ver') or public.tiene_permiso('cumplimiento.ver'));
grant select on public.expediente_tipos to authenticated;

/* ------------------------------------------------------------- expediente */

-- La persona es un cliente o, si el comprador no tiene ficha de cliente, ese comprador.
create table if not exists public.expediente_documentos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id),
  buyer_id uuid references public.contract_buyers (id),
  tipo text not null references public.expediente_tipos (clave),
  ruta text not null unique,
  archivo_nombre text,
  archivo_mime text,
  archivo_tamano bigint,
  archivo_hash text,
  vigencia_hasta date,
  estado text not null default 'cargado' check (estado in ('cargado', 'observado', 'aprobado', 'rechazado', 'reemplazado')),
  observacion text,
  revisado_por uuid references auth.users (id),
  revisado_en timestamptz,
  reemplaza uuid references public.expediente_documentos (id),
  cargado_por uuid not null references auth.users (id),
  cargado_en timestamptz not null default now(),
  check ((client_id is null) <> (buyer_id is null))
);
create index if not exists expediente_documentos_cliente on public.expediente_documentos (client_id, tipo);
create index if not exists expediente_documentos_comprador on public.expediente_documentos (buyer_id, tipo);

create or replace function public.expediente_en_alcance(p_client uuid, p_buyer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cliente_en_alcance(coalesce(p_client, (select c.client_id from contract_buyers b join contracts c on c.id = b.contract_id where b.id = p_buyer)))
$$;

-- Los datos del documento (tipo y estado) los ven quienes cargan o revisan. El archivo, solo Cumplimiento o quien lo subió (política de Storage).
alter table public.expediente_documentos enable row level security;
drop policy if exists "ver expediente" on public.expediente_documentos;
create policy "ver expediente" on public.expediente_documentos for select to authenticated
  using ((public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('clientes.editar') or public.tiene_permiso('ventas.datos_comprador'))
         and public.expediente_en_alcance(client_id, buyer_id));
grant select on public.expediente_documentos to authenticated;

create or replace function public.expediente_archivo_cargado(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if to_regclass('storage.objects') is null then return true; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v using 'expediente-clientes', p_ruta;
  return v;
end $$;

-- Ruta: clientes/<cliente>/<archivo> o compradores/<comprador>/<archivo>.
create or replace function public.expediente_puede_subir(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p text[] := string_to_array(coalesce(p_ruta, ''), '/');
begin
  if coalesce(array_length(p, 1), 0) <> 3 or p[2] !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then return false; end if;
  if not (public.tiene_permiso('clientes.editar') or public.tiene_permiso('ventas.datos_comprador')) then return false; end if;
  if p[1] = 'clientes' then return exists (select 1 from clients where id = p[2]::uuid) and public.expediente_en_alcance(p[2]::uuid, null); end if;
  if p[1] = 'compradores' then return exists (select 1 from contract_buyers where id = p[2]::uuid and client_id is null) and public.expediente_en_alcance(null, p[2]::uuid); end if;
  return false;
end $$;

create or replace function public.expediente_cargar(p_client uuid, p_buyer uuid, p_tipo text, p_archivo jsonb, p_vigencia date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prev uuid; v_ruta text := p_archivo ->> 'ruta'; v_prefijo text;
begin
  if not (public.tiene_permiso('clientes.editar') or public.tiene_permiso('ventas.datos_comprador')) then raise exception 'Sin permiso para cargar documentos del expediente' using errcode = '42501'; end if;
  if (p_client is null) = (p_buyer is null) then raise exception 'Indica el cliente o el comprador'; end if;
  if p_buyer is not null and exists (select 1 from contract_buyers where id = p_buyer and client_id is not null) then
    raise exception 'Ese comprador tiene ficha de cliente: carga el documento en su ficha';
  end if;
  if not public.expediente_en_alcance(p_client, p_buyer) then raise exception 'Persona inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if not exists (select 1 from expediente_tipos where clave = p_tipo and activo) then raise exception 'Tipo de documento no válido'; end if;
  v_prefijo := case when p_client is not null then 'clientes/' || p_client else 'compradores/' || p_buyer end || '/';
  if coalesce(v_ruta, '') = '' then raise exception 'Adjunta el documento'; end if;
  if position(v_prefijo in v_ruta) <> 1 then raise exception 'La ruta del documento no corresponde a esta persona'; end if;
  if coalesce(p_archivo ->> 'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'El documento debe ser un PDF o una foto (JPG o PNG)'; end if;
  if coalesce((p_archivo ->> 'tamano')::bigint, 0) not between 1 and 10485760 then raise exception 'El documento supera el máximo de 10 MB'; end if;
  if not public.expediente_archivo_cargado(v_ruta) then raise exception 'El documento no se cargó. Vuelve a intentarlo'; end if;
  -- La versión vigente anterior del mismo tipo queda reemplazada; no se borra.
  select id into v_prev from expediente_documentos
   where tipo = p_tipo and estado <> 'reemplazado' and client_id is not distinct from p_client and buyer_id is not distinct from p_buyer
   order by cargado_en desc limit 1 for update;
  update expediente_documentos set estado = 'reemplazado'
   where tipo = p_tipo and estado <> 'reemplazado' and client_id is not distinct from p_client and buyer_id is not distinct from p_buyer;
  insert into expediente_documentos (client_id, buyer_id, tipo, ruta, archivo_nombre, archivo_mime, archivo_tamano, archivo_hash, vigencia_hasta, reemplaza, cargado_por)
  values (p_client, p_buyer, p_tipo, v_ruta, p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash', p_vigencia, v_prev, auth.uid())
  returning id into v_id;
  perform public.auditar(case when v_prev is null then 'Cargar documento del expediente' else 'Reemplazar documento del expediente' end,
    case when p_client is not null then 'cliente' else 'comprador' end, coalesce(p_client, p_buyer)::text, p_tipo, null,
    jsonb_build_object('documento', v_id, 'tipo', p_tipo, 'reemplaza', v_prev), v_ruta);
  return v_id;
end $$;

create or replace function public.expediente_revisar(p_id uuid, p_estado text, p_observacion text) returns void
language plpgsql security definer set search_path = public as $$
declare d expediente_documentos; v_o text := btrim(coalesce(p_observacion, ''));
begin
  if not public.tiene_permiso('cumplimiento.revisar') then raise exception 'Sin permiso para revisar documentos' using errcode = '42501'; end if;
  if p_estado not in ('observado', 'aprobado', 'rechazado') then raise exception 'Estado no válido'; end if;
  if p_estado <> 'aprobado' and char_length(v_o) < 5 then raise exception 'Indica la observación'; end if;
  select * into d from expediente_documentos where id = p_id for update;
  if not found or not public.expediente_en_alcance(d.client_id, d.buyer_id) then raise exception 'Documento inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if d.estado = 'reemplazado' then raise exception 'Este documento fue reemplazado por una versión nueva'; end if;
  if d.cargado_por = auth.uid() then raise exception 'Quien carga un documento no puede revisarlo'; end if;
  update expediente_documentos set estado = p_estado, observacion = nullif(v_o, ''), revisado_por = auth.uid(), revisado_en = now() where id = p_id;
  perform public.auditar('Revisar documento del expediente', case when d.client_id is not null then 'cliente' else 'comprador' end, coalesce(d.client_id, d.buyer_id)::text,
    coalesce(nullif(v_o, ''), 'Aprobado'), jsonb_build_object('documento', p_id, 'estado', d.estado), jsonb_build_object('documento', p_id, 'estado', p_estado));
end $$;

-- Registra la descarga y devuelve solo las rutas que esa persona puede abrir: Cumplimiento, o quien subió el archivo.
create or replace function public.expediente_registrar_descarga(p_ids uuid[]) returns table (id uuid, ruta text, archivo_nombre text)
language plpgsql security definer set search_path = public as $$
declare d expediente_documentos;
begin
  for d in select * from expediente_documentos e where e.id = any (p_ids) loop
    if not public.expediente_en_alcance(d.client_id, d.buyer_id) or not (public.tiene_permiso('cumplimiento.ver') or d.cargado_por = auth.uid()) then
      raise exception 'Sin permiso para descargar este documento del expediente' using errcode = '42501';
    end if;
    perform public.auditar('Descargar documento del expediente', case when d.client_id is not null then 'cliente' else 'comprador' end, coalesce(d.client_id, d.buyer_id)::text,
      d.tipo, null, jsonb_build_object('documento', d.id, 'en_lote', cardinality(p_ids) > 1), d.ruta);
    id := d.id; ruta := d.ruta; archivo_nombre := d.archivo_nombre;
    return next;
  end loop;
end $$;

create or replace function public.expediente_definir_tipo_persona(p_client uuid, p_buyer uuid, p_tipo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes text;
begin
  if not (public.tiene_permiso('clientes.editar') or public.tiene_permiso('ventas.datos_comprador')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_tipo not in ('natural', 'juridica') then raise exception 'Tipo de persona no válido'; end if;
  if (p_client is null) = (p_buyer is null) or not public.expediente_en_alcance(p_client, p_buyer) then raise exception 'Persona inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if p_client is not null then
    select tipo_persona into v_antes from clients where id = p_client;
    update clients set tipo_persona = p_tipo where id = p_client;
  else
    select tipo_persona into v_antes from contract_buyers where id = p_buyer;
    update contract_buyers set tipo_persona = p_tipo where id = p_buyer;
  end if;
  perform public.auditar('Definir tipo de persona', case when p_client is not null then 'cliente' else 'comprador' end, coalesce(p_client, p_buyer)::text, p_tipo,
    jsonb_build_object('tipo_persona', v_antes), jsonb_build_object('tipo_persona', p_tipo));
end $$;

/* ------------------------------------------------ revisión del contrato */

create table if not exists public.cumplimiento_revisiones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  estado text not null check (estado in ('pendiente', 'observado', 'aprobado', 'rechazado')),
  observaciones text,
  registrado_por uuid not null references auth.users (id),
  -- Nombre al momento del registro: el historial se lee sin depender del acceso a perfiles.
  registrado_nombre text,
  registrado_en timestamptz not null default clock_timestamp()
);
create index if not exists cumplimiento_revisiones_contrato on public.cumplimiento_revisiones (contract_id, registrado_en desc);
alter table public.cumplimiento_revisiones enable row level security;
drop policy if exists "ver revisiones de cumplimiento" on public.cumplimiento_revisiones;
create policy "ver revisiones de cumplimiento" on public.cumplimiento_revisiones for select to authenticated
  using ((public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('ventas.ver')) and exists (select 1 from contracts c where c.id = contract_id));
grant select on public.cumplimiento_revisiones to authenticated;

create or replace function public.cumplimiento_estado(p_contract uuid) returns text
language sql stable security definer set search_path = public as $$
  select estado from cumplimiento_revisiones where contract_id = p_contract order by registrado_en desc, id desc limit 1
$$;

-- Personas del expediente del contrato: compradores vigentes; sin compradores registrados, el cliente del contrato.
create or replace function public.cumplimiento_personas(p_contract uuid) returns table (client_id uuid, buyer_id uuid, nombre text, tipo_persona text)
language sql stable security definer set search_path = public as $$
  select b.client_id, case when b.client_id is null then b.id end, coalesce(cl.nombre, b.nombre), coalesce(cl.tipo_persona, b.tipo_persona)
    from contract_buyers b left join clients cl on cl.id = b.client_id
   where b.contract_id = p_contract and b.rol = 'comprador' and b.retirado_en is null
  union all
  select c.client_id, null::uuid, cl.nombre, cl.tipo_persona
    from contracts c join clients cl on cl.id = c.client_id
   where c.id = p_contract and not exists (select 1 from contract_buyers b where b.contract_id = p_contract and b.rol = 'comprador' and b.retirado_en is null)
$$;

-- Documentos obligatorios de cada persona con el estado de su versión vigente ('falta' si no hay).
create or replace function public.cumplimiento_requisitos(p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c contracts; v jsonb;
  -- Quien solo consulta ventas (p. ej. Finanzas) ve el estado de cada requisito, no nombres de archivo ni observaciones.
  v_detalle boolean := public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('clientes.editar') or public.tiene_permiso('ventas.datos_comprador');
begin
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) or not (public.tiene_permiso('cumplimiento.ver') or public.tiene_permiso('ventas.ver')) then
    raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'client_id', p.client_id, 'buyer_id', p.buyer_id, 'persona', p.nombre, 'tipo_persona', p.tipo_persona, 'tipo', t.clave, 'nombre', t.nombre,
      'documento', case when v_detalle then d.id end, 'archivo_nombre', case when v_detalle then d.archivo_nombre end, 'observacion', case when v_detalle then d.observacion end,
      'cargado_por', case when v_detalle then d.cargado_por end, 'cargado_en', d.cargado_en, 'vigencia_hasta', d.vigencia_hasta,
      'estado', case when d.id is null then 'falta'
                     when d.estado = 'aprobado' and d.vigencia_hasta is not null and d.vigencia_hasta < (now() at time zone 'America/Guayaquil')::date then 'vencido'
                     else d.estado end) order by p.nombre, t.orden), '[]'::jsonb)
    into v
    from public.cumplimiento_personas(p_contract) p
    join expediente_tipos t on t.tipo_persona = p.tipo_persona and t.activo and t.obligatorio
    left join lateral (
      select e.id, e.estado, e.vigencia_hasta, e.archivo_nombre, e.observacion, e.cargado_por, e.cargado_en from expediente_documentos e
       where e.tipo = t.clave and e.estado <> 'reemplazado' and e.client_id is not distinct from p.client_id and e.buyer_id is not distinct from p.buyer_id
       order by e.cargado_en desc limit 1
    ) d on true;
  return v;
end $$;

create or replace function public.cumplimiento_enviar(p_contract uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts := public.contratos_tomar(p_contract, 'ventas.preparar'); v_actual text; v_faltan int;
begin
  if c.estado <> 'borrador' then raise exception 'Solo se envía a Cumplimiento un contrato en borrador'; end if;
  v_actual := public.cumplimiento_estado(p_contract);
  if v_actual = 'pendiente' then raise exception 'El expediente ya está en revisión de Cumplimiento'; end if;
  if v_actual = 'aprobado' then raise exception 'Cumplimiento ya aprobó este expediente'; end if;
  select count(*) into v_faltan from jsonb_array_elements(public.cumplimiento_requisitos(p_contract)) r where r ->> 'estado' in ('falta', 'rechazado', 'vencido');
  if v_faltan > 0 then raise exception 'Faltan % documento(s) obligatorio(s) del expediente: cárgalos antes de enviar', v_faltan; end if;
  insert into cumplimiento_revisiones (contract_id, estado, observaciones, registrado_por, registrado_nombre)
  values (p_contract, 'pendiente', nullif(btrim(coalesce(p_nota, '')), ''), auth.uid(), (select nombre from profiles where id = auth.uid()));
  perform public.auditar('Enviar a Cumplimiento', 'contrato', p_contract::text, coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Expediente enviado a revisión'),
    jsonb_build_object('estado', v_actual), jsonb_build_object('estado', 'pendiente'));
end $$;

create or replace function public.cumplimiento_resolver(p_contract uuid, p_estado text, p_observaciones text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts; r cumplimiento_revisiones; v_o text := btrim(coalesce(p_observaciones, '')); v_pend int;
begin
  if not public.tiene_permiso('cumplimiento.revisar') then raise exception 'Sin permiso para resolver la revisión de Cumplimiento' using errcode = '42501'; end if;
  if p_estado not in ('observado', 'aprobado', 'rechazado') then raise exception 'Estado no válido'; end if;
  if p_estado <> 'aprobado' and char_length(v_o) < 5 then raise exception 'Indica las observaciones'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  select * into r from cumplimiento_revisiones where contract_id = p_contract order by registrado_en desc, id desc limit 1;
  if not found or r.estado <> 'pendiente' then raise exception 'El expediente no está pendiente de revisión'; end if;
  if r.registrado_por = auth.uid() then raise exception 'Quien envía el expediente a revisión no puede resolverlo'; end if;
  if p_estado = 'aprobado' then
    select count(*) into v_pend from jsonb_array_elements(public.cumplimiento_requisitos(p_contract)) x where x ->> 'estado' <> 'aprobado';
    if v_pend > 0 then raise exception 'Hay % documento(s) obligatorio(s) sin aprobar: revísalos antes de aprobar el expediente', v_pend; end if;
    if exists (select 1 from jsonb_array_elements(public.cumplimiento_requisitos(p_contract)) x where x ->> 'cargado_por' = auth.uid()::text) then
      raise exception 'Quien preparó el expediente (cargó documentos o lo envió) no puede aprobarlo';
    end if;
  end if;
  insert into cumplimiento_revisiones (contract_id, estado, observaciones, registrado_por, registrado_nombre)
  values (p_contract, p_estado, nullif(v_o, ''), auth.uid(), (select nombre from profiles where id = auth.uid()));
  perform public.auditar('Resolver revisión de Cumplimiento', 'contrato', p_contract::text, coalesce(nullif(v_o, ''), 'Expediente aprobado'),
    jsonb_build_object('estado', 'pendiente'), jsonb_build_object('estado', p_estado));
end $$;

-- Ningún camino marca un contrato como firmado sin la aprobación vigente de Cumplimiento, ni llamando la función directamente.
create or replace function public.contratos_exigir_cumplimiento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado = 'borrador' and new.estado = 'firmado' and public.cumplimiento_estado(new.id) is distinct from 'aprobado' then
    raise exception 'Falta la aprobación de Cumplimiento: envía el expediente a revisión antes de registrar la firma';
  end if;
  return new;
end $$;
drop trigger if exists contratos_cumplimiento on public.contracts;
create trigger contratos_cumplimiento before update of estado on public.contracts for each row execute function public.contratos_exigir_cumplimiento();

/* ---------------------------------------------------------------- storage */

do $d$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('expediente-clientes', 'expediente-clientes', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
      on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];
    drop policy if exists "expediente clientes cargar" on storage.objects;
    create policy "expediente clientes cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'expediente-clientes' and public.expediente_puede_subir(name));
    -- Finanzas y Gerencia no lo abren salvo que tengan cumplimiento.ver. Lo no vinculado solo lo ve quien lo subió (para limpiar una carga fallida).
    drop policy if exists "expediente clientes consultar" on storage.objects;
    create policy "expediente clientes consultar" on storage.objects for select to authenticated
      using (bucket_id = 'expediente-clientes' and (
        exists (select 1 from public.expediente_documentos e where e.ruta = name and (public.tiene_permiso('cumplimiento.ver') or e.cargado_por = auth.uid())
                and public.expediente_en_alcance(e.client_id, e.buyer_id))
        or (owner_id = auth.uid()::text and not exists (select 1 from public.expediente_documentos e where e.ruta = name))));
    drop policy if exists "expediente clientes limpiar" on storage.objects;
    create policy "expediente clientes limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'expediente-clientes' and owner_id = auth.uid()::text and not exists (select 1 from public.expediente_documentos e where e.ruta = name));
  end if;
end $d$;

/* -------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.expediente_cargar(uuid, uuid, text, jsonb, date)', 'public.expediente_revisar(uuid, text, text)', 'public.expediente_registrar_descarga(uuid[])',
    'public.expediente_definir_tipo_persona(uuid, uuid, text)', 'public.expediente_puede_subir(text)', 'public.expediente_en_alcance(uuid, uuid)',
    'public.expediente_catalogo_definir(text, text, text, boolean, int, boolean, boolean, text)',
    'public.cumplimiento_estado(uuid)', 'public.cumplimiento_requisitos(uuid)', 'public.cumplimiento_enviar(uuid, text)', 'public.cumplimiento_resolver(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  execute 'revoke all on function public.expediente_archivo_cargado(text) from public, anon, authenticated';
  execute 'revoke all on function public.cumplimiento_personas(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.contratos_exigir_cumplimiento() from public, anon, authenticated';
end $$;
