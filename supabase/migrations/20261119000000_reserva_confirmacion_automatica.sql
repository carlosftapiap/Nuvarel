-- AMURA · Confirmación automática de reservas normales.
--   · Cuando Finanzas verifica el ingreso, la reserva queda confirmada en la misma operación si es normal:
--     unidad disponible, cotización aceptada y vigente, sin descuento, con el precio oficial vigente, sin cuotas extraordinarias
--     y con el precio de la reserva igual al de la cotización. La unidad pasa a reservada.
--   · Si hay alguna excepción, la reserva queda en «pago verificado» y Gerencia la autoriza (reservas_aprobar), como hasta ahora.
--     El aviso a Gerencia indica el motivo. El Supervisor conserva la visibilidad, sin aprobar.
--   · Se conservan los controles: quien solicita no verifica; Finanzas exige el comprobante y el ingreso bancario; quien verifica
--     no autoriza una excepción; la unidad se bloquea con FOR UPDATE antes de confirmar. Todo queda en la auditoría.
--   · Aprobar una reserva que ya está confirmada no hace nada (doble clic o confirmación automática previa).
--   · Nuevo aviso «reserva confirmada» a Legal (preparar contrato) y al vendedor.
-- No modifica reservas, pagos ni unidades existentes. Revertir: restaurar reservas_verificar_pago, reservas_aprobar y notif_reservas
-- desde sus migraciones anteriores y borrar reservas_excepciones_de y reservas_excepciones.

/* --------------------------------------------- excepciones de una reserva */

-- Motivos por los que una reserva necesita autorización de Gerencia. Vacío: reserva normal.
create or replace function public.reservas_excepciones_de(r public.reservations) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare q quotes; u inventory_units; pp pricing_params; v_oficial numeric; v text[] := '{}';
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  select * into q from quotes where id = r.quote_id;
  select * into u from inventory_units where codigo = r.codigo_unidad;
  select * into pp from pricing_params where id = 1;
  if u.estado <> 'disponible' then v := v || ('La unidad no está disponible (' || u.estado || ')'); end if;
  if q.id is null or q.estado <> 'aceptada' then v := v || 'La cotización no está aceptada'::text; end if;
  if r.vigencia_hasta < v_hoy then v := v || 'La cotización venció'::text; end if;
  if coalesce(q.descuento_pct, 0) > 0 then v := v || ('Descuento de ' || trim(to_char(q.descuento_pct, 'FM990.00')) || ' %'); end if;
  v_oficial := public.precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, u.usd_m2_lista, pp.patio_usd_m2);
  if abs(coalesce(q.precio_lista, 0) - v_oficial) > 0.5 then
    v := v || ('Precio distinto del oficial vigente (cotizado USD ' || trim(to_char(q.precio_lista, 'FM999G999G990D00')) || ', oficial USD ' || trim(to_char(v_oficial, 'FM999G999G990D00')) || ')');
  end if;
  if jsonb_array_length(coalesce(q.plan -> 'extraordinarias', '[]'::jsonb)) > 0 then v := v || 'Cuotas extraordinarias pactadas'::text; end if;
  if r.precio_acordado <> q.precio_final then v := v || 'El precio de la reserva no coincide con la cotización'::text; end if;
  return v;
end $$;
revoke all on function public.reservas_excepciones_de(public.reservations) from public, anon, authenticated;

-- Para las pantallas: solo con una reserva del alcance de quien consulta.
create or replace function public.reservas_excepciones(p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare r reservations;
begin
  select * into r from reservations where id = p_id;
  if not found or not (public.cliente_en_alcance(r.client_id) or public.tiene_permiso('reservas.confirmar') or public.tiene_permiso('reservas.verificar_pago')) then
    raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  return public.reservas_excepciones_de(r);
end $$;
revoke all on function public.reservas_excepciones(uuid) from public, anon;
grant execute on function public.reservas_excepciones(uuid) to authenticated;

/* ------------------------------------- verificación con confirmación */

create or replace function public.reservas_verificar_pago(p_id uuid, p_monto numeric, p_fecha date, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; u inventory_units; v_receptor text := public.cobros_receptor(); v_exc text[];
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  if not public.tiene_permiso('reservas.verificar_pago') then raise exception 'Sin permiso para verificar pagos' using errcode = '42501'; end if;
  if v_receptor is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if r.comprobante_subido_en is null then raise exception 'Falta registrar el comprobante del cliente'; end if;
  if r.created_by = auth.uid() then raise exception 'Quien solicita la reserva no puede verificar su pago'; end if;
  if p_monto is null or p_monto + 0.005 < r.monto_reserva then raise exception 'El ingreso verificado es menor a la reserva acordada'; end if;
  if p_fecha is null or p_fecha > v_hoy then raise exception 'Fecha de ingreso inválida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia bancaria del ingreso'; end if;

  -- La unidad se bloquea antes de decidir: dos verificaciones simultáneas no confirman dos reservas sobre la misma unidad.
  select * into u from inventory_units where codigo = r.codigo_unidad for update;
  v_exc := public.reservas_excepciones_de(r);
  if exists (select 1 from reservations x where x.codigo_unidad = r.codigo_unidad and x.id <> r.id and x.estado = 'confirmada') then
    v_exc := v_exc || 'La unidad ya tiene otra reserva confirmada'::text;
  end if;

  perform set_config('app.flujo', 'on', true);
  update reservations set estado = case when cardinality(v_exc) = 0 then 'confirmada' else 'pago_verificado' end,
    pago_monto = p_monto, pago_fecha = p_fecha, pago_referencia = trim(p_referencia),
    pago_receptor = v_receptor, pago_verificado_por = auth.uid(), pago_verificado_en = now(),
    comprobante = coalesce(comprobante, trim(p_referencia)), monto_recibido = p_monto,
    aprobado_en = case when cardinality(v_exc) = 0 then now() end,
    fecha_confirmacion = case when cardinality(v_exc) = 0 then v_hoy end
  where id = p_id;
  perform public.auditar('Verificar ingreso de reserva', 'reserva', p_id::text, trim(coalesce(p_motivo, 'Ingreso verificado')),
    jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'pago_verificado', 'monto', p_monto, 'fecha', p_fecha, 'receptor', v_receptor),
    trim(p_referencia));

  if cardinality(v_exc) > 0 then
    update opportunities set etapa = 'verificacion_pago' where id = r.opportunity_id;
    perform public.auditar('Reserva con excepción', 'reserva', p_id::text, 'Requiere autorización de Gerencia: ' || array_to_string(v_exc, '; '),
      null, jsonb_build_object('excepciones', to_jsonb(v_exc)));
    return;
  end if;

  -- Reserva normal: se confirma sin aprobación adicional.
  update inventory_units set estado = 'reservado', reserva_id = r.id, updated_at = now(), updated_by = auth.uid() where codigo = r.codigo_unidad;
  update clients set etapa = 'reserva' where id = r.client_id;
  update opportunities set etapa = 'aprobacion' where id = r.opportunity_id;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), r.codigo_unidad, u.estado, 'reservado',
          'Reserva ' || r.codigo || ' confirmada automáticamente: pago verificado y condiciones normales', r.id);
  perform public.auditar('Confirmar reserva automáticamente', 'reserva', p_id::text,
    'Pago verificado por Finanzas; unidad disponible, precio oficial, sin descuento ni condiciones especiales',
    jsonb_build_object('estado', 'pago_verificado', 'unidad', u.estado), jsonb_build_object('estado', 'confirmada', 'unidad', 'reservado'));
end $$;

/* ------------------------------------------- autorización de excepciones */

create or replace function public.reservas_aprobar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; u inventory_units; v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  if not public.tiene_permiso('reservas.confirmar') then raise exception 'Sin permiso para aprobar reservas' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  -- Ya confirmada (automáticamente o por otra aprobación): no hay nada que aprobar.
  if r.estado = 'confirmada' then return; end if;
  if r.estado <> 'pago_verificado' then raise exception 'Solo se aprueban reservas con el ingreso verificado por Finanzas (estado actual: %)', r.estado; end if;
  if r.pago_verificado_por = auth.uid() then raise exception 'Quien verificó el pago no puede aprobar la reserva'; end if;
  if r.vigencia_hasta < v_hoy then raise exception 'La cotización venció'; end if;
  select * into q from quotes where id = r.quote_id;
  if q.estado <> 'aceptada' then raise exception 'La cotización ya no está aceptada'; end if;
  if q.descuento_pct > 0 and q.descuento_autorizado_por is null then raise exception 'El descuento no tiene autorización registrada'; end if;
  if r.precio_acordado <> q.precio_final then raise exception 'El precio de la reserva no coincide con la cotización aceptada'; end if;
  select * into u from inventory_units where codigo = r.codigo_unidad for update;
  if u.estado <> 'disponible' then raise exception 'La unidad ya no está disponible (%)', u.estado; end if;
  perform set_config('app.flujo', 'on', true);
  update inventory_units set estado = 'reservado', reserva_id = r.id, updated_at = now(), updated_by = auth.uid() where codigo = r.codigo_unidad;
  update reservations set estado = 'confirmada', aprobado_por = auth.uid(), aprobado_en = now(), fecha_confirmacion = v_hoy where id = p_id;
  update clients set etapa = 'reserva' where id = r.client_id;
  update opportunities set etapa = 'aprobacion' where id = r.opportunity_id;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), r.codigo_unidad, u.estado, 'reservado', 'Reserva ' || r.codigo || ' autorizada por Gerencia', r.id);
  perform public.auditar('Aprobar reserva', 'reserva', p_id::text, trim(p_motivo), jsonb_build_object('estado', 'pago_verificado', 'unidad', u.estado, 'excepciones', to_jsonb(public.reservas_excepciones_de(r))),
    jsonb_build_object('estado', 'confirmada', 'unidad', 'reservado'));
end $$;

/* ----------------------------------------------------------- avisos */

create or replace function public.notif_reservas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cliente text;
begin
  if new.estado = 'pago_verificado' and old.estado is distinct from 'pago_verificado' then
    select nombre into v_cliente from clients where id = new.client_id;
    perform public.notif_seguro('reserva_por_aprobar', 'reserva', new.id::text, 'pago_verificado', 'reservas.confirmar', null,
      'Reserva con excepción por autorizar · ' || new.codigo_unidad, 'Reserva pendiente de autorización',
      jsonb_build_array(jsonb_build_array('Reserva', new.codigo), jsonb_build_array('Cliente', v_cliente), jsonb_build_array('Unidad', new.codigo_unidad),
        jsonb_build_array('Motivo', array_to_string(public.reservas_excepciones_de(new), '; '))),
      '/reservas', null);
  elsif new.estado = 'confirmada' and old.estado is distinct from 'confirmada' then
    select nombre into v_cliente from clients where id = new.client_id;
    perform public.notif_seguro('reserva_confirmada', 'reserva', new.id::text, 'confirmada', 'ventas.preparar', array[new.created_by],
      'Reserva confirmada · ' || new.codigo_unidad, 'Reserva confirmada: preparar el contrato',
      jsonb_build_array(jsonb_build_array('Reserva', new.codigo), jsonb_build_array('Cliente', v_cliente), jsonb_build_array('Unidad', new.codigo_unidad)),
      '/ventas', null);
  end if;
  return new;
end $$;
