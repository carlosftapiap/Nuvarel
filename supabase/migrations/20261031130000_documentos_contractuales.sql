-- AMURA · Documentos contractuales: plantillas (Word o texto) versionadas, documentos generados con los datos exactos usados,
-- compradores adicionales y apoderados, entidad vendedora y almacenamiento privado.
-- Es aditiva: no modifica contratos, cuotas, precios, reservas, inventario ni cobros, ni reescribe ninguna función existente.
-- Los estados comerciales del contrato no cambian: el documento tiene su propio estado (borrador, pendiente de firma, firmado, anulado).
-- Nada se borra: las plantillas se retiran, los documentos se anulan y cada cambio deja evento y auditoría.
-- No depende de otras migraciones pendientes (Plan ni Avance de obra). NO APLICAR en producción sin respaldo verificado y autorización.

begin;

do $$ begin
  if to_regclass('public.contracts') is null or to_regclass('public.installments') is null or to_regclass('public.clients') is null
     or to_regprocedure('public.cliente_en_alcance(uuid)') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Falta Ventas y contratos: aplica antes las migraciones anteriores';
  end if;
end $$;

/* ------------------------------------------------------------------ permisos */

insert into public.permissions (clave, modulo, descripcion) values
  ('ventas.plantillas_ver', 'Ventas y contratos', 'Consultar plantillas contractuales y sus versiones'),
  ('ventas.plantillas', 'Ventas y contratos', 'Crear y editar borradores de plantillas, subir modelos Word y configurar la entidad vendedora'),
  ('ventas.plantillas_aprobar', 'Ventas y contratos', 'Aprobar y retirar plantillas contractuales'),
  ('ventas.documentos_ver', 'Ventas y contratos', 'Consultar y descargar documentos contractuales'),
  ('ventas.documentos_generar', 'Ventas y contratos', 'Generar documentos contractuales desde plantillas aprobadas'),
  ('ventas.documentos_emitir', 'Ventas y contratos', 'Autorizar la emisión definitiva de documentos contractuales'),
  ('ventas.datos_comprador', 'Ventas y contratos', 'Completar y corregir datos legales de compradores, compradores adicionales y apoderados')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.role_permissions (role_id, permiso)
select x.rol, x.permiso from (values
  ('administrador', 'ventas.plantillas_ver'), ('administrador', 'ventas.plantillas'), ('administrador', 'ventas.plantillas_aprobar'),
  ('administrador', 'ventas.documentos_ver'), ('administrador', 'ventas.documentos_generar'), ('administrador', 'ventas.documentos_emitir'), ('administrador', 'ventas.datos_comprador'),
  ('legal', 'ventas.plantillas_ver'), ('legal', 'ventas.plantillas'), ('legal', 'ventas.plantillas_aprobar'),
  ('legal', 'ventas.documentos_ver'), ('legal', 'ventas.documentos_generar'), ('legal', 'ventas.datos_comprador'),
  ('gerencia', 'ventas.plantillas_ver'), ('gerencia', 'ventas.documentos_ver'), ('gerencia', 'ventas.documentos_emitir'),
  ('finanzas', 'ventas.documentos_ver')
) as x(rol, permiso) where exists (select 1 from public.roles r where r.id = x.rol)
on conflict do nothing;

/* ----------------------------------------------- datos legales del comprador */

-- Aditivo: no cambia datos existentes ni las reglas de Clientes.
alter table public.clients add column if not exists domicilio text;
alter table public.clients add column if not exists ciudad text;
alter table public.clients add column if not exists estado_civil text;
alter table public.clients add column if not exists nacionalidad text;
alter table public.clients drop constraint if exists clients_estado_civil_valido;
alter table public.clients add constraint clients_estado_civil_valido check (estado_civil is null or estado_civil in ('soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho'));

/* ------------------------------------------------------------ catálogo de campos */

create table if not exists public.contract_fields (
  clave text primary key,
  grupo text not null,
  etiqueta text not null,
  tipo text not null check (tipo in ('texto', 'numero', 'fecha', 'dinero', 'lista')),
  deriva_de text references public.contract_fields (clave),
  descripcion text not null default ''
);

insert into public.contract_fields (clave, grupo, etiqueta, tipo, descripcion) values
  ('contrato.codigo', 'Contrato', 'Código del contrato', 'texto', 'Identificador del contrato en AMURA'),
  ('contrato.fecha', 'Contrato', 'Fecha del contrato', 'fecha', 'Fecha con la que se generó el contrato'),
  ('vendedora.razon_social', 'Parte vendedora', 'Razón social de la vendedora', 'texto', 'Configurada en la entidad vendedora'),
  ('vendedora.ruc', 'Parte vendedora', 'RUC de la vendedora', 'texto', ''),
  ('vendedora.domicilio', 'Parte vendedora', 'Domicilio de la vendedora', 'texto', ''),
  ('vendedora.representante_nombre', 'Parte vendedora', 'Representante legal', 'texto', ''),
  ('vendedora.representante_cargo', 'Parte vendedora', 'Cargo del representante', 'texto', ''),
  ('vendedora.representante_documento', 'Parte vendedora', 'Documento del representante', 'texto', ''),
  ('vendedora.email', 'Parte vendedora', 'Correo de la vendedora', 'texto', ''),
  ('vendedora.telefono', 'Parte vendedora', 'Teléfono de la vendedora', 'texto', ''),
  ('comprador.nombre', 'Comprador principal', 'Nombres y apellidos', 'texto', 'Tomado del cliente'),
  ('comprador.documento', 'Comprador principal', 'Cédula o RUC', 'texto', ''),
  ('comprador.nacionalidad', 'Comprador principal', 'Nacionalidad', 'texto', ''),
  ('comprador.estado_civil', 'Comprador principal', 'Estado civil', 'texto', ''),
  ('comprador.domicilio', 'Comprador principal', 'Domicilio', 'texto', ''),
  ('comprador.ciudad', 'Comprador principal', 'Ciudad', 'texto', ''),
  ('comprador.telefono', 'Comprador principal', 'Teléfono', 'texto', ''),
  ('comprador.email', 'Comprador principal', 'Correo electrónico', 'texto', ''),
  ('compradores', 'Compradores', 'Todos los compradores (lista)', 'lista', 'Principal y adicionales: nombre, documento, nacionalidad, estado civil, domicilio'),
  ('compradores_adicionales', 'Compradores', 'Compradores adicionales (lista)', 'lista', 'Solo los adicionales'),
  ('apoderados', 'Compradores', 'Apoderados o representantes (lista)', 'lista', 'Incluye el detalle del poder'),
  ('unidad.codigo', 'Unidad', 'Código de la unidad', 'texto', ''),
  ('unidad.departamento', 'Unidad', 'Número de departamento', 'texto', ''),
  ('unidad.edificio', 'Unidad', 'Edificio', 'numero', ''),
  ('unidad.piso', 'Unidad', 'Piso', 'texto', ''),
  ('unidad.tipologia', 'Unidad', 'Tipología', 'texto', ''),
  ('unidad.ubicacion', 'Unidad', 'Ubicación en el piso', 'texto', ''),
  ('unidad.area_m2', 'Unidad', 'Área del departamento (m²)', 'numero', ''),
  ('unidad.bodega_codigo', 'Unidad', 'Código de la bodega', 'texto', ''),
  ('unidad.bodega_m2', 'Unidad', 'Área de la bodega (m²)', 'numero', ''),
  ('unidad.patio_m2', 'Unidad', 'Área del patio (m²)', 'numero', ''),
  ('unidad.parqueo', 'Unidad', 'Parqueo asignado', 'texto', ''),
  ('precio.total', 'Precio', 'Precio contractual', 'dinero', 'Precio congelado al generar el contrato'),
  ('precio.lista', 'Precio', 'Precio de lista', 'dinero', ''),
  ('precio.descuento_pct', 'Precio', 'Descuento acordado (%)', 'numero', ''),
  ('pago.reserva', 'Condiciones de pago', 'Reserva abonada', 'dinero', ''),
  ('pago.firma', 'Condiciones de pago', 'Pago a la firma', 'dinero', ''),
  ('pago.num_cuotas', 'Condiciones de pago', 'Número de cuotas', 'numero', ''),
  ('pago.cuota_mensual', 'Condiciones de pago', 'Valor de la cuota mensual', 'dinero', ''),
  ('pago.total_cuotas', 'Condiciones de pago', 'Total de cuotas', 'dinero', ''),
  ('pago.saldo', 'Condiciones de pago', 'Saldo contra entrega o financiamiento', 'dinero', ''),
  ('pago.cuotas', 'Condiciones de pago', 'Cuotas (lista)', 'lista', 'Número, concepto, vencimiento y monto'),
  ('pago.cronograma', 'Condiciones de pago', 'Cronograma completo (lista)', 'lista', 'Reserva, firma, cuotas y saldo')
on conflict (clave) do update set grupo = excluded.grupo, etiqueta = excluded.etiqueta, tipo = excluded.tipo, descripcion = excluded.descripcion;

-- Campos que se calculan a partir de otro (monto en letras, fecha en texto). Se derivan al generar.
insert into public.contract_fields (clave, grupo, etiqueta, tipo, deriva_de, descripcion) values
  ('contrato.fecha_larga', 'Contrato', 'Fecha del contrato en texto', 'texto', 'contrato.fecha', 'Por ejemplo, 30 de octubre de 2026'),
  ('precio.total_letras', 'Precio', 'Precio contractual en letras', 'texto', 'precio.total', ''),
  ('pago.reserva_letras', 'Condiciones de pago', 'Reserva en letras', 'texto', 'pago.reserva', ''),
  ('pago.saldo_letras', 'Condiciones de pago', 'Saldo en letras', 'texto', 'pago.saldo', '')
on conflict (clave) do update set grupo = excluded.grupo, etiqueta = excluded.etiqueta, tipo = excluded.tipo, deriva_de = excluded.deriva_de, descripcion = excluded.descripcion;

/* ---------------------------------------------------------- entidad vendedora */

create table if not exists public.entidad_vendedora (
  id smallint primary key default 1 check (id = 1),
  razon_social text not null default '',
  ruc text not null default '',
  domicilio text not null default '',
  representante_nombre text not null default '',
  representante_cargo text not null default '',
  representante_documento text not null default '',
  email text not null default '',
  telefono text not null default '',
  actualizado_por uuid references auth.users (id),
  actualizado_nombre text,
  actualizado_en timestamptz
);
insert into public.entidad_vendedora (id) values (1) on conflict (id) do nothing;

/* ----------------------------------------------------------------- plantillas */

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  familia_id uuid not null,
  version int not null check (version > 0),
  nombre text not null check (char_length(btrim(nombre)) >= 3),
  tipo_documento text not null check (tipo_documento in ('contrato_compraventa', 'promesa_compraventa', 'contrato_reserva', 'anexo', 'adenda', 'otro')),
  tipo_operacion text not null default 'general' check (tipo_operacion in ('general', 'contado', 'financiamiento_bancario', 'plan_directo')),
  formato text not null check (formato in ('docx', 'texto')),
  cuerpo text,
  archivo_ruta text unique,
  archivo_nombre text,
  archivo_hash text,
  archivo_tamano bigint check (archivo_tamano is null or (archivo_tamano > 0 and archivo_tamano <= 26214400)),
  variables jsonb not null default '[]'::jsonb,
  notas text not null default '',
  estado text not null default 'borrador' check (estado in ('borrador', 'aprobada', 'retirada')),
  creada_por uuid not null default auth.uid() references auth.users (id),
  creada_nombre text not null,
  creada_en timestamptz not null default now(),
  aprobada_por uuid references auth.users (id),
  aprobada_nombre text,
  aprobada_en timestamptz,
  retirada_por uuid references auth.users (id),
  retirada_nombre text,
  retirada_en timestamptz,
  retirada_motivo text,
  unique (familia_id, version),
  check ((formato = 'texto' and cuerpo is not null and char_length(btrim(cuerpo)) > 0) or (formato = 'docx' and archivo_ruta is not null and archivo_hash is not null))
);
-- Una sola versión aprobada por plantilla; y un solo borrador abierto por plantilla.
create unique index if not exists contract_templates_aprobada_unica on public.contract_templates (familia_id) where estado = 'aprobada';
create unique index if not exists contract_templates_borrador_unico on public.contract_templates (familia_id) where estado = 'borrador';

create table if not exists public.contract_template_events (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references public.contract_templates (id),
  accion text not null,
  usuario text not null,
  motivo text not null,
  fecha timestamptz not null default now()
);

/* ------------------------------------------------- compradores y apoderados */

create table if not exists public.contract_buyers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  rol text not null check (rol in ('comprador', 'apoderado')),
  client_id uuid references public.clients (id),
  nombre text not null check (char_length(btrim(nombre)) >= 3),
  documento text not null default '',
  nacionalidad text not null default '',
  estado_civil text check (estado_civil is null or estado_civil in ('soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho')),
  domicilio text not null default '',
  ciudad text not null default '',
  telefono text not null default '',
  email text not null default '',
  representa_a uuid references public.contract_buyers (id),
  poder_detalle text not null default '',
  porcentaje numeric(5,2) check (porcentaje is null or (porcentaje > 0 and porcentaje <= 100)),
  orden int not null default 0,
  creado_por uuid not null default auth.uid() references auth.users (id),
  creado_en timestamptz not null default now(),
  retirado_en timestamptz,
  retirado_por uuid references auth.users (id),
  retirado_motivo text
);
create index if not exists contract_buyers_contrato_idx on public.contract_buyers (contract_id, orden);

/* ------------------------------------------------------- documentos generados */

create table if not exists public.contract_document_versions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  plantilla_id uuid not null references public.contract_templates (id),
  plantilla_nombre text not null,
  plantilla_version int not null,
  tipo_documento text not null,
  numero int not null check (numero > 0),
  estado text not null default 'borrador' check (estado in ('borrador', 'pendiente_firma', 'firmado', 'anulado')),
  datos jsonb not null,
  pdf_ruta text not null unique,
  pdf_hash text not null check (pdf_hash ~ '^[0-9a-f]{64}$'),
  pdf_tamano bigint,
  docx_ruta text unique,
  docx_hash text check (docx_hash is null or docx_hash ~ '^[0-9a-f]{64}$'),
  docx_tamano bigint,
  generado_por uuid not null default auth.uid() references auth.users (id),
  generado_nombre text not null,
  generado_en timestamptz not null default now(),
  generado_motivo text not null,
  emitido_por uuid references auth.users (id),
  emitido_nombre text,
  emitido_en timestamptz,
  emitido_motivo text,
  firmado_ruta text unique,
  firmado_nombre text,
  firmado_mime text,
  firmado_tamano bigint,
  firmado_hash text check (firmado_hash is null or firmado_hash ~ '^[0-9a-f]{64}$'),
  firmado_fecha date,
  firmado_cargado_por uuid references auth.users (id),
  firmado_cargado_nombre text,
  firmado_cargado_en timestamptz,
  firma_validada_por uuid references auth.users (id),
  firma_validada_nombre text,
  firma_validada_en timestamptz,
  firma_validada_motivo text,
  anulado_por uuid references auth.users (id),
  anulado_nombre text,
  anulado_en timestamptz,
  anulado_motivo text,
  unique (contract_id, tipo_documento, numero)
);
-- Un solo documento vigente por contrato y tipo; las versiones sustituidas quedan anuladas y se conservan.
create unique index if not exists contract_documents_vigente_unico on public.contract_document_versions (contract_id, tipo_documento) where estado <> 'anulado';

create table if not exists public.contract_document_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  version_id uuid references public.contract_document_versions (id),
  accion text not null,
  usuario text not null,
  motivo text not null default '',
  detalle jsonb,
  fecha timestamptz not null default now()
);
create index if not exists contract_document_events_contrato_idx on public.contract_document_events (contract_id, fecha desc);

/* ---------------------------------------------------------- inmutabilidad */

create or replace function public.contratos_doc_sin_borrado() returns trigger
language plpgsql as $$
begin
  raise exception 'Los registros contractuales no se borran: se anulan o se retiran con su motivo' using errcode = '42501';
end $$;

drop trigger if exists plantilla_sin_borrado on public.contract_templates;
create trigger plantilla_sin_borrado before delete on public.contract_templates for each row execute function public.contratos_doc_sin_borrado();
drop trigger if exists plantilla_eventos_sin_borrado on public.contract_template_events;
create trigger plantilla_eventos_sin_borrado before delete on public.contract_template_events for each row execute function public.contratos_doc_sin_borrado();
drop trigger if exists comprador_sin_borrado on public.contract_buyers;
create trigger comprador_sin_borrado before delete on public.contract_buyers for each row execute function public.contratos_doc_sin_borrado();
drop trigger if exists documento_sin_borrado on public.contract_document_versions;
create trigger documento_sin_borrado before delete on public.contract_document_versions for each row execute function public.contratos_doc_sin_borrado();
drop trigger if exists documento_eventos_sin_borrado on public.contract_document_events;
create trigger documento_eventos_sin_borrado before delete on public.contract_document_events for each row execute function public.contratos_doc_sin_borrado();

-- Una plantilla aprobada o retirada conserva su contenido: solo cambia de estado.
create or replace function public.contratos_plantilla_proteger() returns trigger
language plpgsql as $$
begin
  if old.estado in ('aprobada', 'retirada') and (
       new.familia_id is distinct from old.familia_id or new.version is distinct from old.version or new.nombre is distinct from old.nombre
       or new.tipo_documento is distinct from old.tipo_documento or new.tipo_operacion is distinct from old.tipo_operacion or new.formato is distinct from old.formato
       or new.cuerpo is distinct from old.cuerpo or new.archivo_ruta is distinct from old.archivo_ruta or new.archivo_nombre is distinct from old.archivo_nombre
       or new.archivo_hash is distinct from old.archivo_hash or new.archivo_tamano is distinct from old.archivo_tamano
       or new.variables is distinct from old.variables or new.notas is distinct from old.notas) then
    raise exception 'Una plantilla aprobada no se edita: crea una nueva versión' using errcode = '42501';
  end if;
  if old.estado = 'retirada' and new.estado <> 'retirada' then raise exception 'Una plantilla retirada no se reactiva: crea una nueva versión' using errcode = '42501'; end if;
  if old.estado = 'aprobada' and new.estado = 'borrador' then raise exception 'Una plantilla aprobada no vuelve a borrador' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists plantilla_proteger on public.contract_templates;
create trigger plantilla_proteger before update on public.contract_templates for each row execute function public.contratos_plantilla_proteger();

-- Un documento generado no cambia: ni sus datos, ni sus archivos, ni la plantilla. Solo avanza su estado.
create or replace function public.contratos_documento_proteger() returns trigger
language plpgsql as $$
begin
  if new.contract_id is distinct from old.contract_id or new.plantilla_id is distinct from old.plantilla_id or new.plantilla_nombre is distinct from old.plantilla_nombre
     or new.plantilla_version is distinct from old.plantilla_version or new.tipo_documento is distinct from old.tipo_documento or new.numero is distinct from old.numero
     or new.datos is distinct from old.datos or new.pdf_ruta is distinct from old.pdf_ruta or new.pdf_hash is distinct from old.pdf_hash or new.pdf_tamano is distinct from old.pdf_tamano
     or new.docx_ruta is distinct from old.docx_ruta or new.docx_hash is distinct from old.docx_hash or new.docx_tamano is distinct from old.docx_tamano
     or new.generado_por is distinct from old.generado_por or new.generado_en is distinct from old.generado_en or new.generado_motivo is distinct from old.generado_motivo then
    raise exception 'Un documento generado no se modifica: genera una nueva versión' using errcode = '42501';
  end if;
  if old.estado = 'anulado' then raise exception 'Un documento anulado no cambia' using errcode = '42501'; end if;
  if old.estado = 'firmado' and new.estado not in ('firmado', 'anulado') then raise exception 'Un documento firmado solo puede anularse' using errcode = '42501'; end if;
  if old.estado = 'pendiente_firma' and new.estado = 'borrador' then raise exception 'Un documento emitido no vuelve a borrador' using errcode = '42501'; end if;
  if old.estado = 'borrador' and new.estado = 'firmado' then raise exception 'Un documento no pasa a firmado sin haber sido emitido' using errcode = '42501'; end if;
  -- Con la firma validada, el archivo firmado queda fijo.
  if old.firma_validada_en is not null and (new.firmado_ruta is distinct from old.firmado_ruta or new.firmado_hash is distinct from old.firmado_hash
     or new.firmado_nombre is distinct from old.firmado_nombre or new.firma_validada_en is distinct from old.firma_validada_en) then
    raise exception 'El documento firmado y validado no se modifica' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists documento_proteger on public.contract_document_versions;
create trigger documento_proteger before update on public.contract_document_versions for each row execute function public.contratos_documento_proteger();

/* ------------------------------------------------------------- lectura (RLS) */

alter table public.contract_fields enable row level security;
alter table public.entidad_vendedora enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contract_template_events enable row level security;
alter table public.contract_buyers enable row level security;
alter table public.contract_document_versions enable row level security;
alter table public.contract_document_events enable row level security;

-- Sin políticas de escritura: todo cambio pasa por las funciones de abajo, que validan permiso, alcance, reglas e historial.
drop policy if exists "campos de contrato legibles" on public.contract_fields;
create policy "campos de contrato legibles" on public.contract_fields for select to authenticated
  using (public.tiene_permiso('ventas.plantillas_ver') or public.tiene_permiso('ventas.plantillas') or public.tiene_permiso('ventas.documentos_generar'));
drop policy if exists "entidad vendedora legible" on public.entidad_vendedora;
create policy "entidad vendedora legible" on public.entidad_vendedora for select to authenticated
  using (public.tiene_permiso('ventas.plantillas_ver') or public.tiene_permiso('ventas.plantillas') or public.tiene_permiso('ventas.documentos_generar'));
drop policy if exists "ver plantillas" on public.contract_templates;
create policy "ver plantillas" on public.contract_templates for select to authenticated using (
  public.tiene_permiso('ventas.plantillas_ver') or public.tiene_permiso('ventas.plantillas')
  or (estado = 'aprobada' and public.tiene_permiso('ventas.documentos_generar')));
drop policy if exists "ver eventos de plantillas" on public.contract_template_events;
create policy "ver eventos de plantillas" on public.contract_template_events for select to authenticated
  using (public.tiene_permiso('ventas.plantillas_ver') or public.tiene_permiso('ventas.plantillas'));
-- Compradores y documentos: solo de contratos que la persona puede ver (el alcance del cliente lo resuelve la política de contratos).
drop policy if exists "ver compradores del contrato" on public.contract_buyers;
create policy "ver compradores del contrato" on public.contract_buyers for select to authenticated
  using ((public.tiene_permiso('ventas.documentos_ver') or public.tiene_permiso('ventas.datos_comprador')) and exists (select 1 from public.contracts c where c.id = contract_id));
drop policy if exists "ver documentos del contrato" on public.contract_document_versions;
create policy "ver documentos del contrato" on public.contract_document_versions for select to authenticated
  using (public.tiene_permiso('ventas.documentos_ver') and exists (select 1 from public.contracts c where c.id = contract_id));
drop policy if exists "ver eventos de documentos" on public.contract_document_events;
create policy "ver eventos de documentos" on public.contract_document_events for select to authenticated
  using (public.tiene_permiso('ventas.documentos_ver') and exists (select 1 from public.contracts c where c.id = contract_id));

/* ------------------------------------------------------------------- ayudas */

create or replace function public.contratos_doc_requiere(p_permiso text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso(p_permiso) then raise exception 'No tienes permiso para esta acción' using errcode = '42501'; end if;
end $$;

create or replace function public.contratos_doc_nombre() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from public.profiles where id = auth.uid()), 'Usuario')
$$;

create or replace function public.contratos_doc_motivo(p_motivo text) returns text
language plpgsql immutable as $$
begin
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo (mínimo 5 caracteres)'; end if;
  return btrim(p_motivo);
end $$;

create or replace function public.contratos_doc_evento(p_contract uuid, p_version uuid, p_accion text, p_motivo text, p_detalle jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into contract_document_events (contract_id, version_id, accion, usuario, motivo, detalle)
  values (p_contract, p_version, p_accion, public.contratos_doc_nombre(), coalesce(p_motivo, ''), p_detalle);
  perform public.auditar('documento contractual: ' || p_accion, 'contract_document_versions', coalesce(p_version, p_contract)::text, coalesce(p_motivo, ''), null, p_detalle, null);
end $$;

create or replace function public.contratos_plantilla_evento(p_plantilla uuid, p_accion text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into contract_template_events (plantilla_id, accion, usuario, motivo) values (p_plantilla, p_accion, public.contratos_doc_nombre(), p_motivo);
  perform public.auditar('plantilla contractual: ' || p_accion, 'contract_templates', p_plantilla::text, p_motivo, null, null, null);
end $$;

-- Contrato visible y de un cliente dentro del alcance de quien llama. Bloquea la fila para serializar cambios.
create or replace function public.contratos_doc_tomar(p_contract uuid) returns public.contracts
language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  select * into c from contracts where id = p_contract for update;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  return c;
end $$;

/* ------------------------------------------------------------ entidad vendedora */

create or replace function public.contratos_entidad_guardar(p_datos jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.contratos_doc_motivo(p_motivo);
  v_ruc text := btrim(coalesce(p_datos ->> 'ruc', ''));
  v_email text := lower(btrim(coalesce(p_datos ->> 'email', '')));
  antes jsonb;
begin
  perform public.contratos_doc_requiere('ventas.plantillas');
  if v_ruc <> '' and v_ruc !~ '^[0-9]{13}$' then raise exception 'El RUC debe tener 13 dígitos'; end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'El correo no es válido'; end if;
  select to_jsonb(e) - 'actualizado_por' into antes from entidad_vendedora e where id = 1;
  update entidad_vendedora set razon_social = btrim(coalesce(p_datos ->> 'razon_social', '')), ruc = v_ruc, domicilio = btrim(coalesce(p_datos ->> 'domicilio', '')),
    representante_nombre = btrim(coalesce(p_datos ->> 'representante_nombre', '')), representante_cargo = btrim(coalesce(p_datos ->> 'representante_cargo', '')),
    representante_documento = btrim(coalesce(p_datos ->> 'representante_documento', '')), email = v_email, telefono = btrim(coalesce(p_datos ->> 'telefono', '')),
    actualizado_por = auth.uid(), actualizado_nombre = public.contratos_doc_nombre(), actualizado_en = now()
  where id = 1;
  perform public.auditar('entidad vendedora actualizada', 'entidad_vendedora', '1', v_m, antes, p_datos, null);
end $$;

/* ------------------------------------------------------------------ plantillas */

create or replace function public.contratos_plantilla_validar_variables(p_vars jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare x jsonb; v_clave text; v_origen text; v_claves text[] := '{}'; v_salida jsonb := '[]'::jsonb;
begin
  if p_vars is null or jsonb_typeof(p_vars) <> 'array' then raise exception 'Las variables deben ser una lista'; end if;
  if jsonb_array_length(p_vars) > 200 then raise exception 'Máximo 200 variables por plantilla'; end if;
  for x in select * from jsonb_array_elements(p_vars) loop
    v_clave := btrim(coalesce(x ->> 'clave', ''));
    v_origen := coalesce(x ->> 'origen', '');
    if v_clave = '' or char_length(v_clave) > 80 or v_clave !~ '^[A-Za-z0-9_.]+$' then raise exception 'Variable no válida: «%»', v_clave; end if;
    if v_clave = any (v_claves) then raise exception 'La variable % está repetida', v_clave; end if;
    v_claves := v_claves || v_clave;
    if v_origen not in ('catalogo', 'manual') then raise exception 'La variable % debe ser del catálogo o manual', v_clave; end if;
    if v_origen = 'catalogo' and not exists (select 1 from contract_fields where clave = v_clave) then raise exception 'La variable % no existe en el catálogo de AMURA', v_clave; end if;
    v_salida := v_salida || jsonb_build_object('clave', v_clave, 'etiqueta', btrim(coalesce(nullif(x ->> 'etiqueta', ''), v_clave)), 'origen', v_origen,
      'obligatorio', coalesce((x ->> 'obligatorio')::boolean, true));
  end loop;
  return v_salida;
end $$;

-- Crea una plantilla (o una nueva versión de la misma familia) o edita su borrador abierto.
-- p_datos: nombre, tipo_documento, tipo_operacion, formato, cuerpo, archivo_ruta, archivo_nombre, archivo_hash, archivo_tamano, variables, notas.
create or replace function public.contratos_plantilla_guardar(p_id uuid, p_familia uuid, p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.contratos_doc_motivo(p_motivo);
  t contract_templates; v_id uuid; v_familia uuid; v_version int;
  v_formato text := coalesce(p_datos ->> 'formato', '');
  v_ruta text := nullif(btrim(coalesce(p_datos ->> 'archivo_ruta', '')), '');
  v_vars jsonb;
begin
  perform public.contratos_doc_requiere('ventas.plantillas');
  v_vars := public.contratos_plantilla_validar_variables(coalesce(p_datos -> 'variables', '[]'::jsonb));
  if v_formato not in ('docx', 'texto') then raise exception 'El formato debe ser Word o texto'; end if;
  if v_formato = 'docx' and (v_ruta is null or coalesce(p_datos ->> 'archivo_hash', '') !~ '^[0-9a-f]{64}$') then raise exception 'Sube el modelo en Word antes de guardar'; end if;
  if v_formato = 'texto' and char_length(btrim(coalesce(p_datos ->> 'cuerpo', ''))) = 0 then raise exception 'El texto de la plantilla no puede estar vacío'; end if;
  if p_id is null then
    if p_familia is null then raise exception 'Falta la plantilla a la que pertenece'; end if;
    v_familia := p_familia;
    select coalesce(max(version), 0) + 1 into v_version from contract_templates where familia_id = v_familia;
    if exists (select 1 from contract_templates where familia_id = v_familia and estado = 'borrador') then raise exception 'Esta plantilla ya tiene un borrador abierto: edítalo o apruébalo'; end if;
    if v_ruta is not null and split_part(v_ruta, '/', 1) <> v_familia::text then raise exception 'La ruta del archivo no corresponde a la plantilla'; end if;
    insert into contract_templates (familia_id, version, nombre, tipo_documento, tipo_operacion, formato, cuerpo, archivo_ruta, archivo_nombre, archivo_hash, archivo_tamano, variables, notas, creada_nombre)
    values (v_familia, v_version, btrim(coalesce(p_datos ->> 'nombre', '')), coalesce(p_datos ->> 'tipo_documento', ''), coalesce(nullif(p_datos ->> 'tipo_operacion', ''), 'general'), v_formato,
      case when v_formato = 'texto' then p_datos ->> 'cuerpo' end, case when v_formato = 'docx' then v_ruta end, case when v_formato = 'docx' then p_datos ->> 'archivo_nombre' end,
      case when v_formato = 'docx' then p_datos ->> 'archivo_hash' end, case when v_formato = 'docx' then (p_datos ->> 'archivo_tamano')::bigint end, v_vars,
      btrim(coalesce(p_datos ->> 'notas', '')), public.contratos_doc_nombre())
    returning id into v_id;
    perform public.contratos_plantilla_evento(v_id, case when v_version = 1 then 'Crear plantilla' else 'Crear versión ' || v_version end, v_m);
  else
    select * into t from contract_templates where id = p_id for update;
    if not found then raise exception 'La plantilla no existe'; end if;
    if t.estado <> 'borrador' then raise exception 'Solo se edita un borrador: crea una nueva versión' using errcode = '42501'; end if;
    if v_ruta is not null and split_part(v_ruta, '/', 1) <> t.familia_id::text then raise exception 'La ruta del archivo no corresponde a la plantilla'; end if;
    update contract_templates set nombre = btrim(coalesce(p_datos ->> 'nombre', '')), tipo_documento = coalesce(p_datos ->> 'tipo_documento', ''),
      tipo_operacion = coalesce(nullif(p_datos ->> 'tipo_operacion', ''), 'general'), formato = v_formato,
      cuerpo = case when v_formato = 'texto' then p_datos ->> 'cuerpo' end, archivo_ruta = case when v_formato = 'docx' then v_ruta end,
      archivo_nombre = case when v_formato = 'docx' then p_datos ->> 'archivo_nombre' end, archivo_hash = case when v_formato = 'docx' then p_datos ->> 'archivo_hash' end,
      archivo_tamano = case when v_formato = 'docx' then (p_datos ->> 'archivo_tamano')::bigint end, variables = v_vars, notas = btrim(coalesce(p_datos ->> 'notas', ''))
    where id = p_id;
    v_id := p_id;
    perform public.contratos_plantilla_evento(v_id, 'Editar borrador', v_m);
  end if;
  return v_id;
end $$;

-- Aprueba el borrador. La versión aprobada anterior de la misma plantilla pasa a «retirada» y se conserva.
create or replace function public.contratos_plantilla_aprobar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); t contract_templates;
begin
  perform public.contratos_doc_requiere('ventas.plantillas_aprobar');
  select * into t from contract_templates where id = p_id for update;
  if not found then raise exception 'La plantilla no existe'; end if;
  if t.estado <> 'borrador' then raise exception 'Solo se aprueba un borrador'; end if;
  update contract_templates set estado = 'retirada', retirada_por = auth.uid(), retirada_nombre = public.contratos_doc_nombre(), retirada_en = now(),
    retirada_motivo = 'Sustituida por la versión ' || t.version
  where familia_id = t.familia_id and estado = 'aprobada';
  update contract_templates set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_nombre = public.contratos_doc_nombre(), aprobada_en = now() where id = p_id;
  perform public.contratos_plantilla_evento(p_id, 'Aprobar versión ' || t.version, v_m);
end $$;

create or replace function public.contratos_plantilla_retirar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); t contract_templates;
begin
  perform public.contratos_doc_requiere('ventas.plantillas_aprobar');
  select * into t from contract_templates where id = p_id for update;
  if not found then raise exception 'La plantilla no existe'; end if;
  if t.estado <> 'aprobada' then raise exception 'Solo se retira una plantilla aprobada'; end if;
  update contract_templates set estado = 'retirada', retirada_por = auth.uid(), retirada_nombre = public.contratos_doc_nombre(), retirada_en = now(), retirada_motivo = v_m where id = p_id;
  perform public.contratos_plantilla_evento(p_id, 'Retirar versión ' || t.version, v_m);
end $$;

/* ------------------------------------------------------ compradores y apoderados */

create or replace function public.contratos_comprador_guardar(p_contract uuid, p_id uuid, p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.contratos_doc_motivo(p_motivo);
  c contracts; b contract_buyers; v_id uuid;
  v_rol text := coalesce(p_datos ->> 'rol', '');
  v_nombre text := btrim(coalesce(p_datos ->> 'nombre', ''));
  v_civil text := nullif(btrim(coalesce(p_datos ->> 'estado_civil', '')), '');
  v_client uuid := nullif(p_datos ->> 'client_id', '')::uuid;
  v_rep uuid := nullif(p_datos ->> 'representa_a', '')::uuid;
  v_pct numeric := nullif(p_datos ->> 'porcentaje', '')::numeric;
  v_email text := lower(btrim(coalesce(p_datos ->> 'email', '')));
begin
  perform public.contratos_doc_requiere('ventas.datos_comprador');
  c := public.contratos_doc_tomar(p_contract);
  if c.estado = 'anulado' then raise exception 'El contrato está anulado'; end if;
  if v_rol not in ('comprador', 'apoderado') then raise exception 'El rol debe ser comprador o apoderado'; end if;
  if char_length(v_nombre) < 3 then raise exception 'Ingresa los nombres y apellidos completos'; end if;
  if v_civil is not null and v_civil not in ('soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho') then raise exception 'Estado civil no válido'; end if;
  if v_email <> '' and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then raise exception 'El correo no es válido'; end if;
  if v_client is not null and not exists (select 1 from clients where id = v_client) then raise exception 'El cliente no existe'; end if;
  if v_client is not null and v_client = c.client_id then raise exception 'El comprador principal ya forma parte del contrato'; end if;
  if v_rep is not null and not exists (select 1 from contract_buyers where id = v_rep and contract_id = p_contract and retirado_en is null and rol = 'comprador') then raise exception 'Elige un comprador adicional vigente como representado'; end if;
  if v_rol = 'comprador' and v_rep is not null then raise exception 'Un comprador no representa a otro'; end if;
  if p_id is null then
    insert into contract_buyers (contract_id, rol, client_id, nombre, documento, nacionalidad, estado_civil, domicilio, ciudad, telefono, email, representa_a, poder_detalle, porcentaje, orden)
    values (p_contract, v_rol, v_client, v_nombre, btrim(coalesce(p_datos ->> 'documento', '')), btrim(coalesce(p_datos ->> 'nacionalidad', '')), v_civil,
      btrim(coalesce(p_datos ->> 'domicilio', '')), btrim(coalesce(p_datos ->> 'ciudad', '')), btrim(coalesce(p_datos ->> 'telefono', '')), v_email, v_rep,
      btrim(coalesce(p_datos ->> 'poder_detalle', '')), v_pct, coalesce((select max(orden) + 1 from contract_buyers where contract_id = p_contract), 1))
    returning id into v_id;
    perform public.contratos_doc_evento(p_contract, null, case when v_rol = 'apoderado' then 'Agregar apoderado' else 'Agregar comprador adicional' end, v_m, jsonb_build_object('nombre', v_nombre));
  else
    select * into b from contract_buyers where id = p_id and contract_id = p_contract and retirado_en is null for update;
    if not found then raise exception 'La persona no existe en este contrato'; end if;
    update contract_buyers set rol = v_rol, client_id = v_client, nombre = v_nombre, documento = btrim(coalesce(p_datos ->> 'documento', '')),
      nacionalidad = btrim(coalesce(p_datos ->> 'nacionalidad', '')), estado_civil = v_civil, domicilio = btrim(coalesce(p_datos ->> 'domicilio', '')),
      ciudad = btrim(coalesce(p_datos ->> 'ciudad', '')), telefono = btrim(coalesce(p_datos ->> 'telefono', '')), email = v_email, representa_a = v_rep,
      poder_detalle = btrim(coalesce(p_datos ->> 'poder_detalle', '')), porcentaje = v_pct
    where id = p_id;
    v_id := p_id;
    perform public.contratos_doc_evento(p_contract, null, 'Editar datos de ' || case when v_rol = 'apoderado' then 'apoderado' else 'comprador adicional' end, v_m, jsonb_build_object('nombre', v_nombre));
  end if;
  return v_id;
end $$;

create or replace function public.contratos_comprador_retirar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); b contract_buyers; c contracts;
begin
  perform public.contratos_doc_requiere('ventas.datos_comprador');
  select * into b from contract_buyers where id = p_id for update;
  if not found or b.retirado_en is not null then raise exception 'La persona no existe o ya fue retirada'; end if;
  c := public.contratos_doc_tomar(b.contract_id);
  update contract_buyers set retirado_en = now(), retirado_por = auth.uid(), retirado_motivo = v_m where id = p_id or representa_a = p_id;
  perform public.contratos_doc_evento(b.contract_id, null, 'Retirar ' || case when b.rol = 'apoderado' then 'apoderado' else 'comprador adicional' end, v_m, jsonb_build_object('nombre', b.nombre));
end $$;

-- Completa o corrige los datos legales del comprador principal (los del cliente), con motivo y auditoría.
create or replace function public.contratos_comprador_principal_guardar(p_contract uuid, p_datos jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); c contracts; cl clients; v_civil text := nullif(btrim(coalesce(p_datos ->> 'estado_civil', '')), '');
begin
  perform public.contratos_doc_requiere('ventas.datos_comprador');
  c := public.contratos_doc_tomar(p_contract);
  select * into cl from clients where id = c.client_id;
  if v_civil is not null and v_civil not in ('soltero', 'casado', 'divorciado', 'viudo', 'union_de_hecho') then raise exception 'Estado civil no válido'; end if;
  if btrim(coalesce(p_datos ->> 'documento', '')) <> '' and btrim(p_datos ->> 'documento') !~ '^[0-9A-Za-z-]{5,20}$' then raise exception 'El documento no es válido'; end if;
  update clients set documento = btrim(coalesce(p_datos ->> 'documento', documento)), domicilio = nullif(btrim(coalesce(p_datos ->> 'domicilio', '')), ''),
    ciudad = nullif(btrim(coalesce(p_datos ->> 'ciudad', '')), ''), estado_civil = v_civil, nacionalidad = nullif(btrim(coalesce(p_datos ->> 'nacionalidad', '')), '')
  where id = c.client_id;
  perform public.contratos_doc_evento(p_contract, null, 'Corregir datos del comprador principal', v_m,
    jsonb_build_object('antes', jsonb_build_object('documento', cl.documento, 'domicilio', cl.domicilio, 'ciudad', cl.ciudad, 'estado_civil', cl.estado_civil, 'nacionalidad', cl.nacionalidad),
                       'despues', p_datos));
end $$;

/* ------------------------------------------------------- datos del documento */

-- Los datos exactos con los que se genera un documento, tomados de Supabase. Quien llama no los digita: los recibe y los envía de vuelta.
create or replace function public.contratos_datos_documento(p_contract uuid, p_manuales jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c contracts; cl clients; u inventory_units; e entidad_vendedora; v_comp jsonb; v_extra jsonb; v_apod jsonb; v_pago jsonb; v_cron jsonb; v_cuotas jsonb;
  v_principal jsonb;
begin
  if not (public.tiene_permiso('ventas.documentos_generar') or public.tiene_permiso('ventas.plantillas')) then raise exception 'No tienes permiso para generar documentos' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  select * into cl from clients where id = c.client_id;
  select * into u from inventory_units where codigo = c.codigo_unidad;
  select * into e from entidad_vendedora where id = 1;
  v_principal := jsonb_build_object('nombre', cl.nombre, 'documento', cl.documento, 'nacionalidad', coalesce(cl.nacionalidad, ''), 'estado_civil', coalesce(cl.estado_civil, ''),
    'domicilio', coalesce(cl.domicilio, ''), 'ciudad', coalesce(cl.ciudad, ''), 'telefono', cl.telefono, 'email', cl.email, 'es_principal', true, 'porcentaje', null);
  select coalesce(jsonb_agg(jsonb_build_object('nombre', b.nombre, 'documento', b.documento, 'nacionalidad', b.nacionalidad, 'estado_civil', coalesce(b.estado_civil, ''),
    'domicilio', b.domicilio, 'ciudad', b.ciudad, 'telefono', b.telefono, 'email', b.email, 'es_principal', false, 'porcentaje', b.porcentaje) order by b.orden), '[]'::jsonb)
    into v_extra from contract_buyers b where b.contract_id = p_contract and b.rol = 'comprador' and b.retirado_en is null;
  select coalesce(jsonb_agg(jsonb_build_object('nombre', b.nombre, 'documento', b.documento, 'nacionalidad', b.nacionalidad, 'estado_civil', coalesce(b.estado_civil, ''),
    'domicilio', b.domicilio, 'ciudad', b.ciudad, 'telefono', b.telefono, 'email', b.email, 'poder_detalle', b.poder_detalle,
    'representa_a', coalesce((select r.nombre from contract_buyers r where r.id = b.representa_a), cl.nombre)) order by b.orden), '[]'::jsonb)
    into v_apod from contract_buyers b where b.contract_id = p_contract and b.rol = 'apoderado' and b.retirado_en is null;
  v_comp := jsonb_build_array(v_principal) || v_extra;
  select coalesce(jsonb_agg(jsonb_build_object('numero', i.numero, 'concepto', i.concepto, 'vencimiento', i.vencimiento, 'monto', i.monto) order by i.numero), '[]'::jsonb)
    into v_cron from installments i where i.contract_id = p_contract;
  select coalesce(jsonb_agg(jsonb_build_object('numero', i.numero, 'concepto', i.concepto, 'vencimiento', i.vencimiento, 'monto', i.monto) order by i.numero), '[]'::jsonb)
    into v_cuotas from installments i where i.contract_id = p_contract and i.concepto like 'Cuota %';
  v_pago := jsonb_build_object(
    'reserva', (select monto from installments where contract_id = p_contract and concepto like 'Reserva%' order by numero limit 1),
    'firma', (select monto from installments where contract_id = p_contract and concepto like 'Pago a la firma%' order by numero limit 1),
    'num_cuotas', jsonb_array_length(v_cuotas),
    'cuota_mensual', (select monto from installments where contract_id = p_contract and concepto like 'Cuota %' order by numero limit 1),
    'total_cuotas', (select sum(monto) from installments where contract_id = p_contract and concepto like 'Cuota %'),
    'saldo', (select monto from installments where contract_id = p_contract and concepto like 'Saldo%' order by numero desc limit 1),
    'cuotas', v_cuotas, 'cronograma', v_cron);
  return jsonb_build_object(
    'contrato', jsonb_build_object('codigo', c.codigo, 'fecha', c.fecha_contrato),
    'vendedora', jsonb_build_object('razon_social', e.razon_social, 'ruc', e.ruc, 'domicilio', e.domicilio, 'representante_nombre', e.representante_nombre,
      'representante_cargo', e.representante_cargo, 'representante_documento', e.representante_documento, 'email', e.email, 'telefono', e.telefono),
    'comprador', v_principal, 'compradores', v_comp, 'compradores_adicionales', v_extra, 'apoderados', v_apod,
    'unidad', jsonb_build_object('codigo', u.codigo, 'departamento', u.dpt, 'edificio', u.edificio, 'piso', u.piso, 'tipologia', u.tipologia, 'ubicacion', u.ubicacion,
      'area_m2', u.area_m2, 'bodega_codigo', coalesce(u.bodega_codigo, ''), 'bodega_m2', u.bodega_m2, 'patio_m2', u.patio_m2, 'parqueo', coalesce(u.parqueo, '')),
    'precio', jsonb_build_object('total', c.precio,
      'lista', (select q.precio_lista from quotes q join reservations r on r.quote_id = q.id where r.id = c.reservation_id),
      'descuento_pct', (select q.descuento_pct from quotes q join reservations r on r.quote_id = q.id where r.id = c.reservation_id)),
    'pago', v_pago, 'manual', coalesce(p_manuales, '{}'::jsonb));
end $$;

-- Qué falta para que una plantilla pueda emitirse con estos datos. Vacío = completo.
create or replace function public.contratos_faltantes(p_plantilla uuid, p_datos jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t contract_templates; x jsonb; v_clave text; v_base text; v_valor jsonb; v_salida jsonb := '[]'::jsonb; v_grupo text; i int; b jsonb;
begin
  select * into t from contract_templates where id = p_plantilla;
  if not found then raise exception 'La plantilla no existe'; end if;
  for x in select * from jsonb_array_elements(t.variables) loop
    if not coalesce((x ->> 'obligatorio')::boolean, true) then continue; end if;
    v_clave := x ->> 'clave';
    if x ->> 'origen' = 'manual' then
      v_valor := p_datos -> 'manual' -> v_clave;
      v_grupo := 'manual';
    else
      select deriva_de into v_base from contract_fields where clave = v_clave;
      v_valor := p_datos #> string_to_array(coalesce(v_base, v_clave), '.');
      v_grupo := split_part(v_clave, '.', 1);
    end if;
    if v_valor is null or v_valor = 'null'::jsonb or (jsonb_typeof(v_valor) = 'string' and btrim(v_valor #>> '{}') = '')
       or (jsonb_typeof(v_valor) = 'array' and jsonb_array_length(v_valor) = 0) then
      v_salida := v_salida || jsonb_build_object('clave', v_clave, 'etiqueta', coalesce((select etiqueta from contract_fields where clave = v_clave), x ->> 'etiqueta'), 'donde', v_grupo);
    end if;
  end loop;
  -- Si la plantilla usa la lista de compradores, cada uno necesita nombre y documento.
  if exists (select 1 from jsonb_array_elements(t.variables) y where y ->> 'clave' in ('compradores', 'compradores_adicionales') and coalesce((y ->> 'obligatorio')::boolean, true)) then
    i := 0;
    for b in select * from jsonb_array_elements(p_datos -> 'compradores') loop
      i := i + 1;
      if btrim(coalesce(b ->> 'documento', '')) = '' then
        v_salida := v_salida || jsonb_build_object('clave', 'compradores[' || i || '].documento', 'etiqueta', 'Documento de ' || coalesce(b ->> 'nombre', 'comprador ' || i), 'donde', 'compradores');
      end if;
    end loop;
  end if;
  return v_salida;
end $$;

/* ------------------------------------------------------ documentos generados */

-- Registra el documento ya generado y subido. El servidor vuelve a tomar los datos y exige que sean idénticos a los usados, que la plantilla
-- esté aprobada y que no falte ningún dato obligatorio. No cambia el contrato, su precio ni sus cuotas.
create or replace function public.contratos_documento_registrar(p_contract uuid, p_plantilla uuid, p_manuales jsonb, p_datos jsonb, p_pdf jsonb, p_docx jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.contratos_doc_motivo(p_motivo);
  c contracts; t contract_templates; v_actual jsonb; v_faltan jsonb; v_numero int; v_id uuid := gen_random_uuid();
  v_prev record;
begin
  perform public.contratos_doc_requiere('ventas.documentos_generar');
  c := public.contratos_doc_tomar(p_contract);
  if c.estado = 'anulado' then raise exception 'El contrato está anulado'; end if;
  select * into t from contract_templates where id = p_plantilla;
  if not found then raise exception 'La plantilla no existe'; end if;
  if t.estado <> 'aprobada' then raise exception 'La plantilla no está aprobada por Legal: no se pueden emitir documentos con ella' using errcode = '42501'; end if;
  v_actual := public.contratos_datos_documento(p_contract, p_manuales);
  if p_datos is distinct from v_actual then raise exception 'Los datos del contrato cambiaron mientras se generaba el documento: vuelve a generarlo'; end if;
  v_faltan := public.contratos_faltantes(p_plantilla, v_actual);
  if jsonb_array_length(v_faltan) > 0 then
    raise exception 'Faltan datos obligatorios: %', (select string_agg(f ->> 'etiqueta', ', ') from jsonb_array_elements(v_faltan) f);
  end if;
  if coalesce(p_pdf ->> 'ruta', '') = '' or split_part(p_pdf ->> 'ruta', '/', 1) <> p_contract::text or coalesce(p_pdf ->> 'hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'El PDF no es válido'; end if;
  if p_docx is not null and (split_part(coalesce(p_docx ->> 'ruta', ''), '/', 1) <> p_contract::text or coalesce(p_docx ->> 'hash', '') !~ '^[0-9a-f]{64}$') then raise exception 'El archivo Word no es válido'; end if;
  if exists (select 1 from contract_document_versions where contract_id = p_contract and tipo_documento = t.tipo_documento and estado = 'firmado') then
    raise exception 'Ya hay un documento firmado de este tipo: anúlalo con su motivo antes de generar otro';
  end if;
  for v_prev in select id, numero, estado from contract_document_versions where contract_id = p_contract and tipo_documento = t.tipo_documento and estado in ('borrador', 'pendiente_firma') loop
    update contract_document_versions set estado = 'anulado', anulado_por = auth.uid(), anulado_nombre = public.contratos_doc_nombre(), anulado_en = now(),
      anulado_motivo = 'Sustituido por una nueva versión del documento' where id = v_prev.id;
    perform public.contratos_doc_evento(p_contract, v_prev.id, 'Anular versión sustituida', 'Se generó una nueva versión', jsonb_build_object('numero', v_prev.numero));
  end loop;
  select coalesce(max(numero), 0) + 1 into v_numero from contract_document_versions where contract_id = p_contract and tipo_documento = t.tipo_documento;
  insert into contract_document_versions (id, contract_id, plantilla_id, plantilla_nombre, plantilla_version, tipo_documento, numero, datos, pdf_ruta, pdf_hash, pdf_tamano,
    docx_ruta, docx_hash, docx_tamano, generado_nombre, generado_motivo)
  values (v_id, p_contract, p_plantilla, t.nombre, t.version, t.tipo_documento, v_numero, v_actual, p_pdf ->> 'ruta', p_pdf ->> 'hash', (p_pdf ->> 'tamano')::bigint,
    p_docx ->> 'ruta', p_docx ->> 'hash', (p_docx ->> 'tamano')::bigint, public.contratos_doc_nombre(), v_m);
  perform public.contratos_doc_evento(p_contract, v_id, 'Generar documento', v_m, jsonb_build_object('numero', v_numero, 'plantilla', t.nombre, 'version_plantilla', t.version));
  return v_id;
end $$;

-- Gerencia (o quien tenga el permiso) autoriza la emisión: el borrador pasa a pendiente de firma.
create or replace function public.contratos_documento_emitir(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); d contract_document_versions; c contracts;
begin
  perform public.contratos_doc_requiere('ventas.documentos_emitir');
  select * into d from contract_document_versions where id = p_id for update;
  if not found then raise exception 'El documento no existe'; end if;
  c := public.contratos_doc_tomar(d.contract_id);
  if d.estado <> 'borrador' then raise exception 'Solo se emite un documento en borrador'; end if;
  if not exists (select 1 from contract_templates where id = d.plantilla_id and estado = 'aprobada') then
    raise exception 'La plantilla de este documento fue retirada: genera una nueva versión con la plantilla vigente';
  end if;
  update contract_document_versions set estado = 'pendiente_firma', emitido_por = auth.uid(), emitido_nombre = public.contratos_doc_nombre(), emitido_en = now(), emitido_motivo = v_m where id = p_id;
  perform public.contratos_doc_evento(d.contract_id, p_id, 'Autorizar emisión', v_m, jsonb_build_object('numero', d.numero));
end $$;

-- Adjunta el documento suscrito. No lo marca como firmado: Legal debe validarlo.
create or replace function public.contratos_documento_adjuntar_firmado(p_id uuid, p_archivo jsonb, p_fecha_firma date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); d contract_document_versions; c contracts;
begin
  perform public.contratos_doc_requiere('ventas.preparar');
  select * into d from contract_document_versions where id = p_id for update;
  if not found then raise exception 'El documento no existe'; end if;
  c := public.contratos_doc_tomar(d.contract_id);
  if d.estado <> 'pendiente_firma' then raise exception 'Solo se adjunta el firmado a un documento emitido y pendiente de firma'; end if;
  if split_part(coalesce(p_archivo ->> 'ruta', ''), '/', 1) <> d.contract_id::text or coalesce(p_archivo ->> 'hash', '') !~ '^[0-9a-f]{64}$' or btrim(coalesce(p_archivo ->> 'nombre', '')) = '' then
    raise exception 'El archivo firmado no es válido';
  end if;
  if p_archivo ->> 'ruta' in (d.pdf_ruta, coalesce(d.docx_ruta, '')) then raise exception 'El archivo firmado debe ser distinto del documento generado'; end if;
  if p_fecha_firma is null or p_fecha_firma > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de firma no puede ser futura'; end if;
  update contract_document_versions set firmado_ruta = p_archivo ->> 'ruta', firmado_nombre = p_archivo ->> 'nombre', firmado_mime = p_archivo ->> 'mime',
    firmado_tamano = (p_archivo ->> 'tamano')::bigint, firmado_hash = p_archivo ->> 'hash', firmado_fecha = p_fecha_firma,
    firmado_cargado_por = auth.uid(), firmado_cargado_nombre = public.contratos_doc_nombre(), firmado_cargado_en = now()
  where id = p_id;
  perform public.contratos_doc_evento(d.contract_id, p_id, 'Adjuntar documento firmado', v_m, jsonb_build_object('archivo', p_archivo ->> 'nombre', 'reemplaza', d.firmado_ruta));
end $$;

create or replace function public.contratos_documento_validar_firma(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); d contract_document_versions; c contracts;
begin
  perform public.contratos_doc_requiere('ventas.formalizar');
  select * into d from contract_document_versions where id = p_id for update;
  if not found then raise exception 'El documento no existe'; end if;
  c := public.contratos_doc_tomar(d.contract_id);
  if d.estado <> 'pendiente_firma' then raise exception 'Solo se valida la firma de un documento pendiente de firma'; end if;
  if d.firmado_ruta is null then raise exception 'Adjunta primero el documento firmado'; end if;
  update contract_document_versions set estado = 'firmado', firma_validada_por = auth.uid(), firma_validada_nombre = public.contratos_doc_nombre(), firma_validada_en = now(),
    firma_validada_motivo = v_m where id = p_id;
  perform public.contratos_doc_evento(d.contract_id, p_id, 'Validar firma', v_m, jsonb_build_object('numero', d.numero));
end $$;

create or replace function public.contratos_documento_anular(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.contratos_doc_motivo(p_motivo); d contract_document_versions; c contracts;
begin
  perform public.contratos_doc_requiere('ventas.formalizar');
  select * into d from contract_document_versions where id = p_id for update;
  if not found then raise exception 'El documento no existe'; end if;
  c := public.contratos_doc_tomar(d.contract_id);
  if d.estado = 'anulado' then raise exception 'El documento ya está anulado'; end if;
  update contract_document_versions set estado = 'anulado', anulado_por = auth.uid(), anulado_nombre = public.contratos_doc_nombre(), anulado_en = now(), anulado_motivo = v_m where id = p_id;
  perform public.contratos_doc_evento(d.contract_id, p_id, 'Anular documento', v_m, jsonb_build_object('numero', d.numero, 'estaba', d.estado));
end $$;

/* ------------------------------------------------- almacenamiento privado */

-- Dos buckets privados. Si el proyecto no tiene Storage (pruebas locales), se omite.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit) values ('plantillas-contratos', 'plantillas-contratos', false, 26214400)
      on conflict (id) do update set public = false, file_size_limit = 26214400;
    insert into storage.buckets (id, name, public, file_size_limit) values ('documentos-contratos', 'documentos-contratos', false, 26214400)
      on conflict (id) do update set public = false, file_size_limit = 26214400;

    drop policy if exists "plantillas contratos consultar" on storage.objects;
    create policy "plantillas contratos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'plantillas-contratos' and exists (select 1 from public.contract_templates t where t.archivo_ruta = name));
    drop policy if exists "plantillas contratos cargar" on storage.objects;
    create policy "plantillas contratos cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'plantillas-contratos' and public.tiene_permiso('ventas.plantillas'));

    drop policy if exists "documentos contratos consultar" on storage.objects;
    create policy "documentos contratos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'documentos-contratos' and public.tiene_permiso('ventas.documentos_ver')
        and exists (select 1 from public.contract_document_versions d where d.pdf_ruta = name or d.docx_ruta = name or d.firmado_ruta = name));
    drop policy if exists "documentos contratos cargar" on storage.objects;
    create policy "documentos contratos cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'documentos-contratos' and (public.tiene_permiso('ventas.documentos_generar') or public.tiene_permiso('ventas.preparar'))
        and exists (select 1 from public.contracts c where c.id::text = split_part(name, '/', 1)));
  end if;
end $$;

/* ------------------------------------------------------------------- permisos */

revoke all on function public.contratos_doc_sin_borrado() from public, anon, authenticated;
revoke all on function public.contratos_plantilla_proteger() from public, anon, authenticated;
revoke all on function public.contratos_documento_proteger() from public, anon, authenticated;
revoke all on function public.contratos_doc_requiere(text) from public, anon, authenticated;
revoke all on function public.contratos_doc_nombre() from public, anon, authenticated;
revoke all on function public.contratos_doc_motivo(text) from public, anon, authenticated;
revoke all on function public.contratos_doc_evento(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.contratos_plantilla_evento(uuid, text, text) from public, anon, authenticated;
revoke all on function public.contratos_doc_tomar(uuid) from public, anon, authenticated;
revoke all on function public.contratos_plantilla_validar_variables(jsonb) from public, anon, authenticated;
revoke all on function public.contratos_faltantes(uuid, jsonb) from public, anon;
revoke all on function public.contratos_entidad_guardar(jsonb, text) from public, anon;
revoke all on function public.contratos_plantilla_guardar(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.contratos_plantilla_aprobar(uuid, text) from public, anon;
revoke all on function public.contratos_plantilla_retirar(uuid, text) from public, anon;
revoke all on function public.contratos_comprador_guardar(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.contratos_comprador_retirar(uuid, text) from public, anon;
revoke all on function public.contratos_comprador_principal_guardar(uuid, jsonb, text) from public, anon;
revoke all on function public.contratos_datos_documento(uuid, jsonb) from public, anon;
revoke all on function public.contratos_documento_registrar(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
revoke all on function public.contratos_documento_emitir(uuid, text) from public, anon;
revoke all on function public.contratos_documento_adjuntar_firmado(uuid, jsonb, date, text) from public, anon;
revoke all on function public.contratos_documento_validar_firma(uuid, text) from public, anon;
revoke all on function public.contratos_documento_anular(uuid, text) from public, anon;

grant execute on function public.contratos_faltantes(uuid, jsonb) to authenticated;
grant execute on function public.contratos_entidad_guardar(jsonb, text) to authenticated;
grant execute on function public.contratos_plantilla_guardar(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.contratos_plantilla_aprobar(uuid, text) to authenticated;
grant execute on function public.contratos_plantilla_retirar(uuid, text) to authenticated;
grant execute on function public.contratos_comprador_guardar(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.contratos_comprador_retirar(uuid, text) to authenticated;
grant execute on function public.contratos_comprador_principal_guardar(uuid, jsonb, text) to authenticated;
grant execute on function public.contratos_datos_documento(uuid, jsonb) to authenticated;
grant execute on function public.contratos_documento_registrar(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.contratos_documento_emitir(uuid, text) to authenticated;
grant execute on function public.contratos_documento_adjuntar_firmado(uuid, jsonb, date, text) to authenticated;
grant execute on function public.contratos_documento_validar_firma(uuid, text) to authenticated;
grant execute on function public.contratos_documento_anular(uuid, text) to authenticated;

commit;
