-- AMURA · Cuotas con inicio fijo y lista de seis departamentos del Edificio A.
-- Edificio A (Edificio 1): 36 cuotas mensuales. Torre B (Edificio 2): 42 cuotas mensuales. Ambas empiezan en diciembre de 2026.
-- Regla de la primera cuota: diciembre de 2026 si la firma es en noviembre de 2026 o antes; si la firma es posterior,
-- el mes siguiente a la firma (mismo día), siempre con el plazo del edificio. Las demás cuotas siguen cada mes.
-- Precios: solo cambian A003, A103, A203, A303, A403 y A503 (USD/m² nuevo, precio de venta redondeado a dólar entero + patio).
-- El resto de unidades mantiene su precio. Contratos ya emitidos no cambian (su cronograma se guarda en la base).
-- La reserva de prueba COT-2026-0001 / RES-2026-0001 (E1-PB-A1, sin contrato) pasa de 30 a 36 meses; su precio no cambia.
-- Revertir: supabase/sql_produccion/reversion/0017_revertir_cuotas_inicio_fijo.sql (la hace el usuario en el SQL Editor).

alter table public.pricing_params add column if not exists inicio_cuotas date;

do $$
declare v_patio numeric := (select patio_usd_m2 from public.pricing_params where id = 1); v_n int; v_total numeric; v_meses_e2 int;
begin
  if v_patio is distinct from 230 then raise exception 'El patio debe estar a USD 230/m² (está en %)', v_patio; end if;
  select meses_e2 into v_meses_e2 from public.pricing_params where id = 1;
  if v_meses_e2 is distinct from 42 then raise exception 'La Torre B debe estar a 42 meses (está en %)', v_meses_e2; end if;

  update public.pricing_params set meses_e1 = 36, inicio_cuotas = date '2026-12-01' where id = 1;

  update public.inventory_units u
     set usd_m2 = l.usd, usd_m2_lista = l.usd, precio_referencia = public.precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, l.usd, v_patio), updated_at = now()
    from (values ('E1-PB-A3', 'A003', 2000), ('E1-P1-A3', 'A103', 2140), ('E1-P2-A3', 'A203', 2150), ('E1-P3-A3', 'A303', 2160), ('E1-P4-A3', 'A403', 2160), ('E1-P5-A3', 'A503', 2160)) as l(codigo, dpt, usd)
   where u.codigo = l.codigo and u.dpt = l.dpt;
  get diagnostics v_n = row_count;
  if v_n <> 6 then raise exception 'Se esperaban 6 unidades y se actualizaron %', v_n; end if;

  -- Reserva de prueba: 30 → 36 meses. Cuota = cuotas ÷ 36; la última absorbe los centavos.
  if exists (select 1 from public.quotes where numero = 'COT-2026-0001' and (plan ->> 'meses')::int = 30) then
    update public.quotes set plan = plan || jsonb_build_object('meses', 36,
        'cuotaMensual', round((plan ->> 'cuotasTotal')::numeric / 36, 2),
        'ultimaCuota', round((plan ->> 'cuotasTotal')::numeric - round((plan ->> 'cuotasTotal')::numeric / 36, 2) * 35, 2))
     where numero = 'COT-2026-0001';
    update public.reservations r set meses = 36, cuota_mensual = round((q.plan ->> 'cuotasTotal')::numeric / 36, 2)
      from public.quotes q where q.id = r.quote_id and q.numero = 'COT-2026-0001' and r.codigo = 'RES-2026-0001';
  end if;

  -- Verificación: el total de la lista de las seis unidades y las condiciones de los edificios.
  select sum(public.precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, v_patio)) into v_total
    from public.inventory_units where codigo in ('E1-PB-A3', 'E1-P1-A3', 'E1-P2-A3', 'E1-P3-A3', 'E1-P4-A3', 'E1-P5-A3');
  if abs(v_total - 694441.50) > 0.01 then raise exception 'El total de las seis unidades es % y debe ser 694441.50', v_total; end if;
  if (select meses_e1 from public.pricing_params where id = 1) <> 36 then raise exception 'El Edificio A debe quedar a 36 meses'; end if;
  if (select inicio_cuotas from public.pricing_params where id = 1) <> date '2026-12-01' then raise exception 'El inicio de cuotas debe ser 01/12/2026'; end if;
end $$;

-- Cronograma: la primera cuota sigue la regla de inicio fijo y las demás cada mes desde ahí.
create or replace function public.contratos_crear(p_reservation uuid, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_primera date; v_inicio date; v_minima date; r reservations; q quotes; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
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
  -- Primera cuota: el inicio fijo (dic 2026) si la firma cae en ese mes o antes; si no, el mes siguiente a la firma.
  select inicio_cuotas into v_inicio from pricing_params where id = 1;
  v_minima := (p_fecha + interval '1 month')::date;
  v_primera := case when v_inicio is not null and date_trunc('month', v_minima) <= date_trunc('month', v_inicio) then v_inicio else v_minima end;
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
            (case when v_primera = v_minima then p_fecha + make_interval(months => i) else v_inicio + make_interval(months => i - 1) end)::date, case when i = v_meses then v_ultima else v_cuota end);
  end loop;
  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  select v_id, (x.v ->> 'mes')::int + 1 + x.o::int, 'Cuota extraordinaria ' || x.o || ' de ' || v_n,
         (case when v_primera = v_minima then p_fecha + make_interval(months => (x.v ->> 'mes')::int) else v_inicio + make_interval(months => (x.v ->> 'mes')::int - 1) end)::date, (x.v ->> 'monto')::numeric
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

