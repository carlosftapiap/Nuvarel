-- AMURA · SQL de producción 0020. Copia exacta de supabase/migrations/20261129000000_orden_contrato.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- Orden de contrato AMURA: representante legal en Clientes e historial de órdenes emitidas.
-- Solo agrega: columnas nuevas (vacías), una tabla nueva de historial y una función de registro.
-- No modifica clientes, cotizaciones, reservas, pagos, contratos ni formularios maestros.
-- Dirección (domicilio), estado civil (estado_civil) y medio de captación (origen) ya existen en clients.

alter table public.clients add column if not exists representante_nombre text;
alter table public.clients add column if not exists representante_documento text;
alter table public.clients add column if not exists representante_calidad text;

create table if not exists public.ordenes_contrato (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id),
  client_id uuid references public.clients (id),
  version integer not null check (version >= 1),
  numero_cotizacion text not null,
  datos jsonb not null,
  pdf_sha256 text not null check (length(pdf_sha256) = 64),
  emitida_por uuid references auth.users (id),
  emitida_por_nombre text,
  emitida_en timestamptz not null default now(),
  unique (quote_id, version)
);

alter table public.ordenes_contrato enable row level security;

drop policy if exists "ordenes contrato consultar" on public.ordenes_contrato;
create policy "ordenes contrato consultar" on public.ordenes_contrato for select to authenticated
  using (public.tiene_permiso('ventas.documentos_ver') or public.tiene_permiso('cotizaciones.crear'));

-- Historial inmutable: nadie edita ni borra una orden emitida.
revoke insert, update, delete on public.ordenes_contrato from anon, authenticated;
grant select on public.ordenes_contrato to authenticated;

-- Registra una orden emitida. Solo para cotizaciones emitidas o aceptadas. La versión es la siguiente de esa cotización.
create or replace function public.ordenes_contrato_registrar(p_quote_id uuid, p_datos jsonb, p_sha256 text, p_emitida_por_nombre text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare q quotes; v integer; r ordenes_contrato;
begin
  if auth.uid() is null or not public.tiene_permiso('cotizaciones.crear') then
    raise exception 'No tienes permiso para emitir órdenes de contrato.' using errcode = '42501';
  end if;
  select * into q from quotes where id = p_quote_id;
  if not found then raise exception 'La cotización no existe.'; end if;
  if q.estado not in ('emitida', 'aceptada') then
    raise exception 'Solo se emite la orden de una cotización emitida o aceptada.';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_quote_id::text));
  select coalesce(max(version), 0) + 1 into v from ordenes_contrato where quote_id = p_quote_id;
  insert into ordenes_contrato (quote_id, client_id, version, numero_cotizacion, datos, pdf_sha256, emitida_por, emitida_por_nombre)
  values (p_quote_id, q.client_id, v, q.numero, p_datos, lower(p_sha256), auth.uid(), left(coalesce(p_emitida_por_nombre, ''), 120))
  returning * into r;
  return json_build_object('id', r.id, 'version', r.version, 'numero', r.numero_cotizacion, 'emitidaEn', r.emitida_en, 'emitidaPor', r.emitida_por_nombre);
end $$;

revoke all on function public.ordenes_contrato_registrar(uuid, jsonb, text, text) from public, anon;
grant execute on function public.ordenes_contrato_registrar(uuid, jsonb, text, text) to authenticated;
