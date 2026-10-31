-- AMURA · Controles finales de Cobranzas, aplicados en el servidor:
--   · Comprobante bancario obligatorio para registrar y confirmar un pago nuevo.
--   · Las funciones antiguas dejan de poder llamarse desde la app: solo se confirma con verificación bancaria y recibo.
--   · Sin NUVAREL como receptor no se confirma: el pago no queda sin recibo.
--   · Datos del emisor en el recibo y comprobante vinculado.
--   · Devoluciones y retenciones de reservas anuladas como movimientos aparte, con autorización y soporte.
--   · Limpieza segura de archivos no vinculados: solo quien los subió y solo si nada los usa.
-- No modifica pagos, reservas, recibos ni receptores existentes.
-- Revertir: restaurar las funciones desde 20261031180000_comprobantes_recibos.sql, volver a conceder execute a las funciones antiguas,
--   borrar reserva_movimientos (si está vacía), emisor_recibos, las columnas emisor_ruc, emisor_direccion y comprobante_id de recibos_pago, y la política "comprobantes pagos limpiar".
-- Ejecutar después de 20261031180000_comprobantes_recibos.sql y con un respaldo verificado.

/* ----------------------------------------------------------------- emisor */

create table if not exists public.emisor_recibos (
  id smallint primary key default 1 check (id = 1),
  razon_social text not null,
  ruc text not null,
  direccion text not null
);
insert into public.emisor_recibos (id, razon_social, ruc, direccion)
values (1, 'NUVAREL S.A.S.', '0993413661001', 'Av. León Febres Cordero Ribadeneyra y Alfredo Adum, diagonal al C.C. El Dorado Shopping, Daule, Guayas, Ecuador')
on conflict (id) do nothing;
alter table public.emisor_recibos enable row level security;
drop policy if exists "emisor de recibos legible" on public.emisor_recibos;
create policy "emisor de recibos legible" on public.emisor_recibos for select to authenticated using (true);
grant select on public.emisor_recibos to authenticated;

alter table public.recibos_pago add column if not exists emisor_ruc text;
alter table public.recibos_pago add column if not exists emisor_direccion text;
alter table public.recibos_pago add column if not exists comprobante_id uuid references public.comprobantes_pago (id);

-- Sin NUVAREL como receptor no hay recibo posible, y un pago no se confirma sin recibo: toda la operación se revierte.
create or replace function public.recibos_emitir(p_reserva uuid, p_pago uuid, p_client uuid, p_unidad text, p_concepto text, p_monto numeric, p_fecha date, p_referencia text, p_banco text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero text; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY'); cl clients; v_dpt text; v_nombre text; v_entidad text := coalesce(p_reserva, p_pago)::text;
  v_tipo text := case when p_reserva is not null then 'reserva' else 'pago' end; em emisor_recibos; v_comp uuid;
begin
  if public.cobros_receptor() is distinct from 'NUVAREL' then
    raise exception 'No se puede confirmar: el receptor de pagos configurado es %, y el recibo se emite a nombre de NUVAREL. Revísalo en Configuración', coalesce(public.cobros_receptor(), 'ninguno');
  end if;
  select * into em from emisor_recibos where id = 1;
  select * into cl from clients where id = p_client;
  select dpt into v_dpt from inventory_units where codigo = p_unidad;
  select nombre into v_nombre from profiles where id = auth.uid();
  select id into v_comp from comprobantes_pago where (reservation_id = p_reserva or payment_id = p_pago) and estado = 'confirmado' order by revisado_en desc limit 1;
  perform pg_advisory_xact_lock(hashtext('recibos_numero'));
  v_numero := 'REC-' || v_anio || '-' || lpad((select count(*) + 1 from recibos_pago where numero like 'REC-' || v_anio || '-%')::text, 4, '0');
  insert into recibos_pago (numero, reservation_id, payment_id, emisor, emisor_ruc, emisor_direccion, comprobante_id, cliente, documento, departamento, codigo_unidad, concepto, monto, fecha_pago, referencia, banco, aprobado_por, aprobado_nombre)
  values (v_numero, p_reserva, p_pago, em.razon_social, em.ruc, em.direccion, v_comp, cl.nombre, coalesce(cl.documento, ''), coalesce(v_dpt, p_unidad), p_unidad, p_concepto, p_monto, p_fecha, p_referencia, p_banco, auth.uid(), coalesce(v_nombre, 'Usuario'))
  returning id into v_id;
  perform public.auditar('Emitir recibo', v_tipo, v_entidad, 'Recibo ' || v_numero, null, jsonb_build_object('numero', v_numero, 'monto', p_monto));
  return v_id;
end $$;

/* ---------------------------------------------------- comprobante obligatorio */

-- Con Storage, el archivo debe existir de verdad: una ruta inventada no sirve de comprobante.
create or replace function public.comprobante_archivo_cargado(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if to_regclass('storage.objects') is null then return true; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)' into v using 'comprobantes-pagos', p_ruta;
  return v;
end $$;

create or replace function public.pagos_archivo_obligatorio(p_archivo jsonb, p_prefijo text) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_archivo is null or jsonb_typeof(p_archivo) = 'null' or coalesce(p_archivo ->> 'ruta', '') = '' then
    raise exception 'Adjunta la foto o el PDF del comprobante bancario';
  end if;
  perform public.pagos_archivo_valido(p_archivo, p_prefijo);
  if not public.comprobante_archivo_cargado(p_archivo ->> 'ruta') then raise exception 'El archivo del comprobante no se cargó. Vuelve a intentarlo'; end if;
end $$;

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
  perform public.pagos_archivo_obligatorio(p_archivo, 'reservas/' || p_id || '/');
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
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar pagos' using errcode = '42501'; end if;
  perform public.pagos_datos_validos(p_monto, p_fecha, p_banco, p_referencia);
  perform public.pagos_archivo_obligatorio(p_archivo, 'contratos/' || p_contract || '/');
  -- Alcance, contrato vigente y referencia única: los valida cobranzas_registrar_pago.
  v_id := public.cobranzas_registrar_pago(p_contract, p_monto, p_fecha, p_referencia, p_archivo ->> 'ruta');
  insert into comprobantes_pago (payment_id, monto, fecha, banco, referencia, ruta, archivo_nombre, archivo_mime, archivo_tamano, archivo_hash)
  values (v_id, p_monto, p_fecha, trim(p_banco), trim(p_referencia), p_archivo ->> 'ruta', p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash');
  return v_id;
end $$;

create or replace function public.reservas_confirmar_pago(p_id uuid, p_monto numeric, p_fecha date, p_referencia text, p_verificado_banco boolean, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; e comprobantes_pago; v_m text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Ingreso verificado en la cuenta bancaria');
begin
  if not public.tiene_permiso('reservas.verificar_pago') then raise exception 'Sin permiso para verificar pagos' using errcode = '42501'; end if;
  if public.cobros_receptor() is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  if p_verificado_banco is not true then raise exception 'Marca que verificaste el ingreso en la cuenta bancaria: el comprobante por sí solo no confirma el pago'; end if;
  select * into r from reservations where id = p_id;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  select * into e from comprobantes_pago where reservation_id = p_id and estado = 'reportado' and ruta is not null order by cargado_en desc limit 1;
  if not found then raise exception 'Falta el comprobante bancario: rechaza este registro y vuelve a registrar el pago con su foto o PDF'; end if;
  if e.cargado_por = auth.uid() then raise exception 'Quien registra un pago no puede confirmarlo'; end if;
  -- Receptor definido, estado, monto y separación de funciones: los valida reservas_verificar_pago.
  perform public.reservas_verificar_pago(p_id, p_monto, p_fecha, p_referencia, v_m);
  select * into r from reservations where id = p_id;
  update comprobantes_pago set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where id = e.id;
  return public.recibos_emitir(p_id, null, r.client_id, r.codigo_unidad, 'Reserva ' || r.codigo, p_monto, p_fecha, trim(p_referencia), e.banco);
end $$;

create or replace function public.cobranzas_confirmar_pago(p_payment uuid, p_verificado_banco boolean, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p payments; c contracts; e comprobantes_pago; v_antes jsonb; v_concepto text; v_m text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Ingreso verificado en la cuenta bancaria');
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para verificar ingresos' using errcode = '42501'; end if;
  if public.cobros_receptor() is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  if p_verificado_banco is not true then raise exception 'Marca que verificaste el ingreso en la cuenta bancaria: el comprobante por sí solo no confirma el pago'; end if;
  select * into p from payments where id = p_payment;
  if not found then raise exception 'Pago inexistente'; end if;
  if p.estado <> 'registrado' then raise exception 'El pago no está pendiente de verificación'; end if;
  if p.registrado_por = auth.uid() then raise exception 'Quien registra un pago no puede verificarlo'; end if;
  select * into e from comprobantes_pago where payment_id = p_payment and estado = 'reportado' and ruta is not null order by cargado_en desc limit 1;
  if not found then raise exception 'Falta el comprobante bancario: rechaza este registro y vuelve a registrar el pago con su foto o PDF'; end if;
  select * into c from contracts where id = p.contract_id;
  select coalesce(jsonb_object_agg(numero::text, pagado), '{}'::jsonb) into v_antes from installment_status where contract_id = p.contract_id;
  perform public.cobranzas_verificar_pago(p_payment, true, v_m);
  update comprobantes_pago set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where id = e.id;
  -- Lo que este pago cubrió: cuotas mensuales o extraordinarias.
  select string_agg(s.concepto, ', ' order by s.numero) into v_concepto from installment_status s
   where s.contract_id = p.contract_id and s.pagado > coalesce((v_antes ->> s.numero::text)::numeric, 0);
  return public.recibos_emitir(null, p_payment, c.client_id, c.codigo_unidad, 'Contrato ' || c.codigo || ': ' || coalesce(v_concepto, 'saldo a favor'), p.monto, p.fecha, p.referencia, e.banco);
end $$;

-- Rechazar un pago antiguo sin comprobante también debe ser posible; quien lo registró no puede.
create or replace function public.cobranzas_rechazar_pago(p_payment uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := trim(coalesce(p_motivo, ''));
begin
  if char_length(v_m) < 5 then raise exception 'Indica el motivo del rechazo'; end if;
  perform public.cobranzas_verificar_pago(p_payment, false, v_m);
  update comprobantes_pago set estado = 'rechazado', revisado_por = auth.uid(), revisado_en = now(), motivo_revision = v_m where payment_id = p_payment and estado = 'reportado';
end $$;

/* ------------------------------------------------- funciones antiguas cerradas */

-- Siguen existiendo porque las nuevas las usan por dentro; desde la app ya no se pueden llamar.
revoke all on function public.reservas_verificar_pago(uuid, numeric, date, text, text) from public, anon, authenticated;
revoke all on function public.reservas_adjuntar_comprobante(uuid, text, text) from public, anon, authenticated;
revoke all on function public.cobranzas_verificar_pago(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.cobranzas_registrar_pago(uuid, numeric, date, text, text) from public, anon, authenticated;

/* ---------------------------------- devoluciones y retenciones de reservas anuladas */

-- El pago confirmado no se toca: cada salida o retención es un movimiento aparte, con soporte y autorización de otra persona.
create table if not exists public.reserva_movimientos (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id),
  tipo text not null check (tipo in ('devolucion', 'retencion')),
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  referencia text not null check (char_length(btrim(referencia)) >= 3),
  motivo text not null check (char_length(btrim(motivo)) >= 5),
  ruta text not null unique,
  archivo_nombre text,
  archivo_mime text,
  archivo_tamano bigint,
  archivo_hash text,
  estado text not null default 'solicitado' check (estado in ('solicitado', 'autorizado', 'rechazado')),
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_en timestamptz not null default now(),
  resuelto_por uuid references auth.users (id),
  resuelto_en timestamptz,
  motivo_resolucion text
);
alter table public.reserva_movimientos enable row level security;
drop policy if exists "ver movimientos de reserva" on public.reserva_movimientos;
create policy "ver movimientos de reserva" on public.reserva_movimientos for select to authenticated using (public.pago_visible(reservation_id, null));
grant select on public.reserva_movimientos to authenticated;

create or replace function public.reservas_movimiento_registrar(p_reserva uuid, p_tipo text, p_monto numeric, p_fecha date, p_referencia text, p_motivo text, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; v_id uuid; v_usado numeric;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar movimientos' using errcode = '42501'; end if;
  select * into r from reservations where id = p_reserva for update;
  if not found or not public.cliente_en_alcance(r.client_id) then raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if r.estado <> 'anulada' or coalesce(r.pago_monto, 0) <= 0 then raise exception 'Solo aplica a reservas anuladas con un pago confirmado'; end if;
  if p_tipo not in ('devolucion', 'retencion') then raise exception 'Tipo de movimiento no válido'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'Fecha inválida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del movimiento'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo del movimiento'; end if;
  select coalesce(sum(monto), 0) into v_usado from reserva_movimientos where reservation_id = p_reserva and estado in ('solicitado', 'autorizado');
  if v_usado + p_monto > r.pago_monto then raise exception 'Los movimientos no pueden superar lo recibido (USD %)', r.pago_monto; end if;
  perform public.pagos_archivo_obligatorio(p_archivo, 'movimientos/' || p_reserva || '/');
  insert into reserva_movimientos (reservation_id, tipo, monto, fecha, referencia, motivo, ruta, archivo_nombre, archivo_mime, archivo_tamano, archivo_hash)
  values (p_reserva, p_tipo, p_monto, p_fecha, trim(p_referencia), trim(p_motivo), p_archivo ->> 'ruta', p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash')
  returning id into v_id;
  perform public.auditar('Registrar ' || p_tipo, 'reserva', p_reserva::text, trim(p_motivo), null, jsonb_build_object('monto', p_monto, 'referencia', trim(p_referencia)), p_archivo ->> 'ruta');
  return v_id;
end $$;

create or replace function public.reservas_movimiento_resolver(p_id uuid, p_autorizar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare m reserva_movimientos; v_m text := trim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('ventas.desistimiento_con_dinero') then raise exception 'Sin permiso para autorizar movimientos' using errcode = '42501'; end if;
  if char_length(v_m) < 5 then raise exception 'Indica el motivo'; end if;
  select * into m from reserva_movimientos where id = p_id for update;
  if not found or m.estado <> 'solicitado' then raise exception 'El movimiento no está pendiente'; end if;
  if m.registrado_por = auth.uid() then raise exception 'Quien registra un movimiento no puede autorizarlo'; end if;
  update reserva_movimientos set estado = case when p_autorizar then 'autorizado' else 'rechazado' end, resuelto_por = auth.uid(), resuelto_en = now(), motivo_resolucion = v_m where id = p_id;
  perform public.auditar(case when p_autorizar then 'Autorizar ' else 'Rechazar ' end || m.tipo, 'reserva', m.reservation_id::text, v_m, null, jsonb_build_object('monto', m.monto, 'referencia', m.referencia));
end $$;

/* ---------------------------------------------------------------- storage */

create or replace function public.comprobante_archivo_vinculado(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comprobantes_pago where ruta = p_ruta) or exists (select 1 from recibos_pago where pdf_ruta = p_ruta) or exists (select 1 from reserva_movimientos where ruta = p_ruta)
$$;
revoke all on function public.comprobante_archivo_vinculado(text) from public, anon;
grant execute on function public.comprobante_archivo_vinculado(text) to authenticated;

do $d$ begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "comprobantes pagos consultar" on storage.objects;
    create policy "comprobantes pagos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes-pagos' and (exists (select 1 from public.comprobantes_pago e where e.ruta = name) or exists (select 1 from public.recibos_pago v where v.pdf_ruta = name)
                                                   or exists (select 1 from public.reserva_movimientos m where m.ruta = name)
                                                   -- Sin esto no se podría limpiar: borrar exige poder leer. Solo quien lo subió, y solo lo que nada usa.
                                                   or (owner_id = auth.uid()::text and not public.comprobante_archivo_vinculado(name))));
    drop policy if exists "comprobantes pagos cargar" on storage.objects;
    create policy "comprobantes pagos cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes-pagos' and case when name like 'recibos/%' then public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago')
                                                         when name like 'movimientos/%' then public.tiene_permiso('cobranzas.registrar')
                                                         else public.tiene_permiso('reservas.solicitar') or public.tiene_permiso('cobranzas.registrar') end);
    -- Limpieza de una carga fallida: solo quien subió el archivo y solo si ningún registro lo usa. Lo vinculado no se borra ni se reemplaza.
    drop policy if exists "comprobantes pagos limpiar" on storage.objects;
    create policy "comprobantes pagos limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'comprobantes-pagos' and owner_id = auth.uid()::text and not public.comprobante_archivo_vinculado(name));
  end if;
end $d$;

revoke all on function public.comprobante_archivo_cargado(text) from public, anon, authenticated;
revoke all on function public.pagos_archivo_obligatorio(jsonb, text) from public, anon, authenticated;
revoke all on function public.reservas_movimiento_registrar(uuid, text, numeric, date, text, text, jsonb) from public, anon;
revoke all on function public.reservas_movimiento_resolver(uuid, boolean, text) from public, anon;
grant execute on function public.reservas_movimiento_registrar(uuid, text, numeric, date, text, text, jsonb) to authenticated;
grant execute on function public.reservas_movimiento_resolver(uuid, boolean, text) to authenticated;
