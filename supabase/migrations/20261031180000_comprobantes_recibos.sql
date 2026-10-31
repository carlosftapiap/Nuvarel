-- AMURA · Comprobantes de pago y recibos numerados, para reservas y pagos de contrato (cuotas mensuales y extraordinarias).
--   · comprobantes_pago: lo que se reportó (monto, fecha, banco, referencia, archivo en bucket privado, quién y cuándo). No confirma nada.
--   · recibos_pago: se emite solo al confirmar, en la misma transacción, y una sola vez por pago. No es un comprobante tributario del SRI.
-- Aditiva: no modifica pagos, reservas ni contratos existentes; los pagos históricos no reciben recibo.
-- Las funciones anteriores siguen disponibles: las nuevas las usan y agregan la verificación bancaria, el comprobante y el recibo.
-- Revertir (solo si las tablas están vacías): restaurar cobranzas_anular_pago desde 20261029050000_cobranza_cronograma.sql;
--   drop table public.recibos_pago, public.comprobantes_pago; y borrar las funciones y las políticas de este archivo y el bucket comprobantes-pagos.
-- Ejecutar después de 20261031170000_cuotas_extraordinarias.sql y con un respaldo verificado.

create table if not exists public.comprobantes_pago (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id),
  payment_id uuid references public.payments (id),
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  banco text not null check (char_length(btrim(banco)) >= 2),
  referencia text not null check (char_length(btrim(referencia)) >= 3),
  ruta text unique,
  archivo_nombre text,
  archivo_mime text,
  archivo_tamano bigint,
  archivo_hash text,
  estado text not null default 'reportado' check (estado in ('reportado', 'confirmado', 'rechazado')),
  cargado_por uuid not null default auth.uid() references auth.users (id),
  cargado_en timestamptz not null default now(),
  revisado_por uuid references auth.users (id),
  revisado_en timestamptz,
  motivo_revision text,
  check ((reservation_id is null) <> (payment_id is null))
);

create table if not exists public.recibos_pago (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  reservation_id uuid references public.reservations (id),
  payment_id uuid references public.payments (id),
  emisor text not null default 'NUVAREL S.A.S.',
  cliente text not null,
  documento text not null default '',
  departamento text not null,
  codigo_unidad text not null,
  concepto text not null,
  monto numeric(14,2) not null check (monto > 0),
  fecha_pago date not null,
  referencia text not null,
  banco text,
  aprobado_por uuid not null references auth.users (id),
  aprobado_nombre text not null,
  emitido_en timestamptz not null default now(),
  pdf_ruta text unique,
  pdf_hash text,
  anulado_en timestamptz,
  motivo_anulacion text,
  check ((reservation_id is null) <> (payment_id is null))
);
-- Un doble clic no puede emitir dos recibos.
create unique index if not exists recibos_uno_por_reserva on public.recibos_pago (reservation_id) where reservation_id is not null;
create unique index if not exists recibos_uno_por_pago on public.recibos_pago (payment_id) where payment_id is not null;

-- Quien gestiona o revisa pagos, dentro de su alcance. Sin escritura directa: solo las funciones de abajo.
create or replace function public.pago_visible(p_reserva uuid, p_pago uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago') or public.tiene_permiso('reservas.confirmar')
          or public.tiene_permiso('reservas.solicitar') or public.tiene_permiso('cobranzas.registrar'))
    and public.cliente_en_alcance(coalesce(
      (select r.client_id from reservations r where r.id = p_reserva),
      (select c.client_id from payments p join contracts c on c.id = p.contract_id where p.id = p_pago)))
$$;

alter table public.comprobantes_pago enable row level security;
alter table public.recibos_pago enable row level security;
drop policy if exists "ver comprobantes de pago" on public.comprobantes_pago;
create policy "ver comprobantes de pago" on public.comprobantes_pago for select to authenticated using (public.pago_visible(reservation_id, payment_id));
drop policy if exists "ver recibos de pago" on public.recibos_pago;
create policy "ver recibos de pago" on public.recibos_pago for select to authenticated using (public.pago_visible(reservation_id, payment_id));

create or replace function public.pagos_archivo_valido(p_archivo jsonb, p_prefijo text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_archivo is null or jsonb_typeof(p_archivo) = 'null' then return; end if;
  if position(p_prefijo in coalesce(p_archivo ->> 'ruta', '')) <> 1 then raise exception 'La ruta del comprobante no corresponde a esta operación'; end if;
  if coalesce(p_archivo ->> 'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'El comprobante debe ser una foto (JPG o PNG) o un PDF'; end if;
  if coalesce((p_archivo ->> 'tamano')::bigint, 0) not between 1 and 10485760 then raise exception 'El comprobante supera el máximo de 10 MB'; end if;
end $$;

-- Validaciones comunes del reporte. Registrar un pago nunca lo confirma.
create or replace function public.pagos_datos_validos(p_monto numeric, p_fecha date, p_banco text, p_referencia text) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'Fecha de pago inválida'; end if;
  if char_length(trim(coalesce(p_banco, ''))) < 2 then raise exception 'Indica el banco'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del pago'; end if;
end $$;

/* ------------------------------------------------------------ registrar */

create or replace function public.reservas_reportar_pago(p_id uuid, p_monto numeric, p_fecha date, p_banco text, p_referencia text, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; v_id uuid;
begin
  if not (public.tiene_permiso('reservas.solicitar') or public.tiene_permiso('cobranzas.registrar')) then raise exception 'Sin permiso para registrar pagos' using errcode = '42501'; end if;
  select * into r from reservations where id = p_id for update;
  if not found or not public.cliente_en_alcance(r.client_id) then raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if r.comprobante is not null then raise exception 'La reserva ya tiene un pago registrado (%): Finanzas debe revisarlo primero', r.comprobante; end if;
  perform public.pagos_datos_validos(p_monto, p_fecha, p_banco, p_referencia);
  perform public.pagos_archivo_valido(p_archivo, 'reservas/' || p_id || '/');
  update reservations set comprobante = trim(p_referencia), comprobante_path = p_archivo ->> 'ruta', comprobante_subido_en = now() where id = p_id;
  insert into comprobantes_pago (reservation_id, monto, fecha, banco, referencia, ruta, archivo_nombre, archivo_mime, archivo_tamano, archivo_hash)
  values (p_id, p_monto, p_fecha, trim(p_banco), trim(p_referencia), p_archivo ->> 'ruta', p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash')
  returning id into v_id;
  perform public.auditar('Registrar pago de reserva', 'reserva', p_id::text, 'Pago reportado (pendiente de verificación)', null,
    jsonb_build_object('monto', p_monto, 'fecha', p_fecha, 'banco', trim(p_banco), 'referencia', trim(p_referencia)), p_archivo ->> 'ruta');
  return v_id;
end $$;

create or replace function public.cobranzas_reportar_pago(p_contract uuid, p_monto numeric, p_fecha date, p_banco text, p_referencia text, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.pagos_datos_validos(p_monto, p_fecha, p_banco, p_referencia);
  perform public.pagos_archivo_valido(p_archivo, 'contratos/' || p_contract || '/');
  -- Permiso, alcance, contrato vigente y referencia única: los valida cobranzas_registrar_pago.
  v_id := public.cobranzas_registrar_pago(p_contract, p_monto, p_fecha, p_referencia, p_archivo ->> 'ruta');
  insert into comprobantes_pago (payment_id, monto, fecha, banco, referencia, ruta, archivo_nombre, archivo_mime, archivo_tamano, archivo_hash)
  values (v_id, p_monto, p_fecha, trim(p_banco), trim(p_referencia), p_archivo ->> 'ruta', p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash');
  return v_id;
end $$;

/* --------------------------------------------------------------- recibo */

-- Solo al confirmar. Sus datos quedan fijos. Si los pagos los recibe otro, NUVAREL no puede emitir el recibo: el pago se confirma igual y queda constancia.
create or replace function public.recibos_emitir(p_reserva uuid, p_pago uuid, p_client uuid, p_unidad text, p_concepto text, p_monto numeric, p_fecha date, p_referencia text, p_banco text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero text; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY'); cl clients; v_dpt text; v_nombre text; v_entidad text := coalesce(p_reserva, p_pago)::text;
  v_tipo text := case when p_reserva is not null then 'reserva' else 'pago' end;
begin
  if public.cobros_receptor() is distinct from 'NUVAREL' then
    perform public.auditar('Recibo no emitido', v_tipo, v_entidad, 'Los pagos los recibe ' || coalesce(public.cobros_receptor(), 'otro receptor') || ', no NUVAREL', null, null);
    return null;
  end if;
  select * into cl from clients where id = p_client;
  select dpt into v_dpt from inventory_units where codigo = p_unidad;
  select nombre into v_nombre from profiles where id = auth.uid();
  perform pg_advisory_xact_lock(hashtext('recibos_numero'));
  v_numero := 'REC-' || v_anio || '-' || lpad((select count(*) + 1 from recibos_pago where numero like 'REC-' || v_anio || '-%')::text, 4, '0');
  insert into recibos_pago (numero, reservation_id, payment_id, cliente, documento, departamento, codigo_unidad, concepto, monto, fecha_pago, referencia, banco, aprobado_por, aprobado_nombre)
  values (v_numero, p_reserva, p_pago, cl.nombre, coalesce(cl.documento, ''), coalesce(v_dpt, p_unidad), p_unidad, p_concepto, p_monto, p_fecha, p_referencia, p_banco, auth.uid(), coalesce(v_nombre, 'Usuario'))
  returning id into v_id;
  perform public.auditar('Emitir recibo', v_tipo, v_entidad, 'Recibo ' || v_numero, null, jsonb_build_object('numero', v_numero, 'monto', p_monto));
  return v_id;
end $$;

-- El PDF se guarda una sola vez: no se reemplaza.
create or replace function public.recibos_registrar_pdf(p_id uuid, p_ruta text, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare v recibos_pago;
begin
  if not (public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v from recibos_pago where id = p_id for update;
  if not found then raise exception 'Recibo inexistente'; end if;
  if v.pdf_ruta is not null then return; end if;
  if position('recibos/' in coalesce(p_ruta, '')) <> 1 then raise exception 'Ruta de recibo no válida'; end if;
  update recibos_pago set pdf_ruta = p_ruta, pdf_hash = p_hash where id = p_id;
  perform public.auditar('Guardar PDF del recibo', case when v.reservation_id is not null then 'reserva' else 'pago' end, coalesce(v.reservation_id, v.payment_id)::text, 'Recibo ' || v.numero, null, null, p_ruta);
end $$;

/* --------------------------------------------------- confirmar y rechazar */

create or replace function public.reservas_confirmar_pago(p_id uuid, p_monto numeric, p_fecha date, p_referencia text, p_verificado_banco boolean, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; e comprobantes_pago; v_m text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Ingreso verificado en la cuenta bancaria');
begin
  if p_verificado_banco is not true then raise exception 'Marca que verificaste el ingreso en la cuenta bancaria: el comprobante por sí solo no confirma el pago'; end if;
  select * into e from comprobantes_pago where reservation_id = p_id and estado = 'reportado' order by cargado_en desc limit 1;
  if found and e.cargado_por = auth.uid() then raise exception 'Quien registra un pago no puede confirmarlo'; end if;
  -- Permiso, receptor definido, estado, monto y separación de funciones: los valida reservas_verificar_pago.
  perform public.reservas_verificar_pago(p_id, p_monto, p_fecha, p_referencia, v_m);
  select * into r from reservations where id = p_id;
  update comprobantes_pago set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where id = e.id;
  return public.recibos_emitir(p_id, null, r.client_id, r.codigo_unidad, 'Reserva ' || r.codigo, p_monto, p_fecha, trim(p_referencia), e.banco);
end $$;

create or replace function public.reservas_rechazar_pago(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; v_m text := trim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('reservas.verificar_pago') then raise exception 'Sin permiso para rechazar pagos' using errcode = '42501'; end if;
  if char_length(v_m) < 5 then raise exception 'Indica el motivo del rechazo'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' or r.comprobante is null then raise exception 'La reserva no tiene un pago por verificar'; end if;
  if exists (select 1 from comprobantes_pago e where e.reservation_id = p_id and e.estado = 'reportado' and e.cargado_por = auth.uid()) then raise exception 'Quien registra un pago no puede rechazarlo'; end if;
  -- El comprobante se conserva con su motivo; la reserva vuelve a esperar el pago.
  update comprobantes_pago set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where reservation_id = p_id and estado = 'reportado';
  update reservations set comprobante = null, comprobante_path = null, comprobante_subido_en = null where id = p_id;
  perform public.auditar('Rechazar pago de reserva', 'reserva', p_id::text, v_m, jsonb_build_object('referencia', r.comprobante), null);
end $$;

create or replace function public.cobranzas_confirmar_pago(p_payment uuid, p_verificado_banco boolean, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p payments; c contracts; e comprobantes_pago; v_antes jsonb; v_concepto text; v_m text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Ingreso verificado en la cuenta bancaria');
begin
  if p_verificado_banco is not true then raise exception 'Marca que verificaste el ingreso en la cuenta bancaria: el comprobante por sí solo no confirma el pago'; end if;
  select * into p from payments where id = p_payment;
  if not found then raise exception 'Pago inexistente'; end if;
  select * into c from contracts where id = p.contract_id;
  select coalesce(jsonb_object_agg(numero::text, pagado), '{}'::jsonb) into v_antes from installment_status where contract_id = p.contract_id;
  -- Permiso, receptor definido, estado y separación de funciones: los valida cobranzas_verificar_pago.
  perform public.cobranzas_verificar_pago(p_payment, true, v_m);
  update comprobantes_pago set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where payment_id = p_payment and estado = 'reportado' returning * into e;
  -- Lo que este pago cubrió: cuotas mensuales o extraordinarias.
  select string_agg(s.concepto, ', ' order by s.numero) into v_concepto from installment_status s
   where s.contract_id = p.contract_id and s.pagado > coalesce((v_antes ->> s.numero::text)::numeric, 0);
  return public.recibos_emitir(null, p_payment, c.client_id, c.codigo_unidad, 'Contrato ' || c.codigo || ': ' || coalesce(v_concepto, 'saldo a favor'), p.monto, p.fecha, p.referencia, e.banco);
end $$;

create or replace function public.cobranzas_rechazar_pago(p_payment uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := trim(coalesce(p_motivo, ''));
begin
  if char_length(v_m) < 5 then raise exception 'Indica el motivo del rechazo'; end if;
  perform public.cobranzas_verificar_pago(p_payment, false, v_m);
  update comprobantes_pago set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where payment_id = p_payment and estado = 'reportado';
end $$;

-- Anular un pago confirmado también anula su recibo, que se conserva con el motivo.
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;
select pg_temp.parchar('public.cobranzas_anular_pago(uuid, text)',
  $x$update payments set estado = 'anulado', motivo = trim(p_motivo) where id = p_payment;$x$,
  $x$update payments set estado = 'anulado', motivo = trim(p_motivo) where id = p_payment;
  update recibos_pago set anulado_en = now(), motivo_anulacion = trim(p_motivo) where payment_id = p_payment and anulado_en is null;$x$);

/* -------------------------------------------------------------- historial */

create or replace function public.pagos_historial(p_reserva uuid, p_pago uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pago_visible(p_reserva, p_pago) then raise exception 'Sin acceso a este pago' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('accion', a.accion, 'motivo', a.motivo, 'usuario', coalesce(pr.nombre, 'Sistema'), 'fecha', a.fecha) order by a.fecha desc), '[]'::jsonb) into v
  from audit_log a left join profiles pr on pr.id = a.actor_id
  where a.entidad_id = coalesce(p_reserva, p_pago)::text and a.entidad = case when p_reserva is not null then 'reserva' else 'pago' end;
  return v;
end $$;

/* ---------------------------------------------------------------- storage */

-- Bucket privado. Sin políticas de actualización ni de borrado: un comprobante o recibo no se reemplaza ni se elimina.
do $d$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit) values ('comprobantes-pagos', 'comprobantes-pagos', false, 10485760)
      on conflict (id) do update set public = false, file_size_limit = 10485760;
    drop policy if exists "comprobantes pagos consultar" on storage.objects;
    create policy "comprobantes pagos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes-pagos' and (exists (select 1 from public.comprobantes_pago e where e.ruta = name) or exists (select 1 from public.recibos_pago v where v.pdf_ruta = name)));
    drop policy if exists "comprobantes pagos cargar" on storage.objects;
    create policy "comprobantes pagos cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes-pagos' and case when name like 'recibos/%' then public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago')
                                                         else public.tiene_permiso('reservas.solicitar') or public.tiene_permiso('cobranzas.registrar') end);
  end if;
end $d$;

revoke all on function public.pago_visible(uuid, uuid) from public, anon;
revoke all on function public.pagos_archivo_valido(jsonb, text) from public, anon, authenticated;
revoke all on function public.pagos_datos_validos(numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.recibos_emitir(uuid, uuid, uuid, text, text, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb) from public, anon;
revoke all on function public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb) from public, anon;
revoke all on function public.recibos_registrar_pdf(uuid, text, text) from public, anon;
revoke all on function public.reservas_confirmar_pago(uuid, numeric, date, text, boolean, text) from public, anon;
revoke all on function public.reservas_rechazar_pago(uuid, text) from public, anon;
revoke all on function public.cobranzas_confirmar_pago(uuid, boolean, text) from public, anon;
revoke all on function public.cobranzas_rechazar_pago(uuid, text) from public, anon;
revoke all on function public.pagos_historial(uuid, uuid) from public, anon;
grant execute on function public.pago_visible(uuid, uuid) to authenticated;
grant execute on function public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb) to authenticated;
grant execute on function public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb) to authenticated;
grant execute on function public.recibos_registrar_pdf(uuid, text, text) to authenticated;
grant execute on function public.reservas_confirmar_pago(uuid, numeric, date, text, boolean, text) to authenticated;
grant execute on function public.reservas_rechazar_pago(uuid, text) to authenticated;
grant execute on function public.cobranzas_confirmar_pago(uuid, boolean, text) to authenticated;
grant execute on function public.cobranzas_rechazar_pago(uuid, text) to authenticated;
grant execute on function public.pagos_historial(uuid, uuid) to authenticated;
grant select on public.comprobantes_pago, public.recibos_pago to authenticated;
