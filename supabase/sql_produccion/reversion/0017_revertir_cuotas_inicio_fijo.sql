-- AMURA · Reversión de 0017 (cuotas con inicio fijo). Úsala solo si 0017 se aplicó y hay que volver atrás.
-- Restaura: Edificio A a 30 meses, sin inicio fijo, precios anteriores de las seis unidades, función contratos_crear anterior
-- y la reserva de prueba RES-2026-0001 a 30 meses (cuota 755,21; última 755,25). Hacer respaldo antes.

do $$
begin
  update public.inventory_units u
     set usd_m2 = l.usd, usd_m2_lista = l.usd, precio_referencia = public.precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, l.usd, 230), updated_at = now()
    from (values ('E1-PB-A3', 'A003', 2220), ('E1-P1-A3', 'A103', 2230), ('E1-P2-A3', 'A203', 2240), ('E1-P3-A3', 'A303', 2240), ('E1-P4-A3', 'A403', 2250), ('E1-P5-A3', 'A503', 2250)) as l(codigo, dpt, usd)
   where u.codigo = l.codigo and u.dpt = l.dpt;
  update public.pricing_params set meses_e1 = 30, inicio_cuotas = null where id = 1;
  update public.quotes set plan = plan || '{"meses": 30, "cuotaMensual": 755.21, "ultimaCuota": 755.25}'::jsonb where numero = 'COT-2026-0001';
  update public.reservations set meses = 30, cuota_mensual = 755.21 where codigo = 'RES-2026-0001';
end $$;

create or replace function public.contratos_crear(p_reservation uuid, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
  v_meses int; v_cuota numeric; v_ultima numeric; v_entrega numeric; v_acumulado numeric; v_firma numeric; i int; v_extra jsonb; v_n int;
begin
  if not public.tiene_permiso('ventas.preparar') then raise exception 'Sin permiso para preparar contratos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_reservation for update;
  if not found or r.estado <> 'confirmada' then raise exception 'Solo se genera contrato de una reserva aprobada'; end if;
  if not public.cliente_en_alcance(r.client_id) then raise exception 'Fuera de tu alcance' using errcode = '42501'; end if;
  if exists (select 1 from contracts c where c.reservation_id = r.id and c.estado <> 'anulado') then raise exception 'La reserva ya tiene contrato'; end if;
  select * into q from quotes where id = r.quote_id;
  v_meses := (q.plan ->> 'meses')::int;
  v_cuota := (q.plan ->> 'cuotaMensual')::numeric;
  v_ultima := (q.plan ->> 'ultimaCuota')::numeric;
  v_entrega := (q.plan ->> 'contraEntrega')::numeric;
  v_extra := coalesce(q.plan -> 'extraordinarias', '[]'::jsonb);
  v_n := jsonb_array_length(v_extra);
  v_acumulado := round(r.precio_acordado * 6 / 100, 2);
  v_firma := round(v_acumulado - r.monto_reserva, 2);
  if v_firma < 0 then raise exception 'La reserva supera el 6%% acumulado a la firma'; end if;

  insert into contracts (codigo, reservation_id, client_id, opportunity_id, codigo_unidad, precio, fecha_contrato)
  values ('CON-' || v_anio || '-' || lpad((select count(*) + 1 from contracts where codigo like 'CON-' || v_anio || '-%')::text, 4, '0'),
          r.id, r.client_id, r.opportunity_id, r.codigo_unidad, r.precio_acordado, p_fecha)
  returning id into v_id;

  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  values (v_id, 0, 'Reserva (se acredita al 6%)', r.fecha_confirmacion, r.monto_reserva);
  if v_firma > 0 then
    insert into installments (contract_id, numero, concepto, vencimiento, monto)
    values (v_id, 1, 'Pago a la firma (completa el 6%)', p_fecha, v_firma);
  end if;
  for i in 1..v_meses loop
    insert into installments (contract_id, numero, concepto, vencimiento, monto)
    values (v_id, i + 1 + (select count(*) from jsonb_array_elements(v_extra) e where (e ->> 'mes')::int < i)::int, 'Cuota ' || i || ' de ' || v_meses,
            (p_fecha + make_interval(months => i))::date, case when i = v_meses then v_ultima else v_cuota end);
  end loop;
  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  select v_id, (x.v ->> 'mes')::int + 1 + x.o::int, 'Cuota extraordinaria ' || x.o || ' de ' || v_n,
         (p_fecha + make_interval(months => (x.v ->> 'mes')::int))::date, (x.v ->> 'monto')::numeric
    from jsonb_array_elements(v_extra) with ordinality x(v, o);
  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  values (v_id, v_meses + 2 + v_n, 'Saldo contra entrega (80%)', null, v_entrega);
  if abs((select sum(monto) from installments where contract_id = v_id) - r.precio_acordado) > 0.01 then
    raise exception 'El cronograma no suma el precio acordado';
  end if;

  -- La reserva ya verificada por Finanzas se conserva como primer pago: no se pierde al activar el cronograma.
  insert into payments (contract_id, monto, fecha, referencia, estado, receptor, registrado_por, verificado_por, verificado_en, motivo)
  values (v_id, r.pago_monto, r.pago_fecha, r.pago_referencia, 'verificado', r.pago_receptor, r.pago_verificado_por, r.pago_verificado_por, r.pago_verificado_en, 'Reserva ' || r.codigo);
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'contrato' where id = r.opportunity_id;
  perform public.auditar('Generar contrato', 'contrato', v_id::text, trim(p_motivo), null,
    jsonb_build_object('reserva', r.codigo, 'precio', r.precio_acordado, 'reserva_monto', r.monto_reserva, 'pago_a_la_firma', v_firma, 'cuotas', v_meses, 'extraordinarias', v_n));
  return v_id;
end $$;
