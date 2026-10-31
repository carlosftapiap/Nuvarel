-- AMURA · Cuotas extraordinarias dentro del 14 % de la entrada. El esquema 6 % + 14 % + 80 % y los plazos no cambian:
-- las cuotas mensuales se recalculan para que mensuales + extraordinarias sumen exactamente el 14 %.
-- Se pactan en la cotización y pasan al contrato cuando se genera. Una cuota programada no es un pago: los pagos siguen siendo solo los que registra y verifica Finanzas.
-- Aditiva: no modifica cotizaciones, contratos, cuotas ni pagos existentes. Un plan sin extraordinarias produce el mismo cronograma de siempre.
-- Revertir: drop function public.cotizaciones_emitir_extraordinarias(uuid, numeric, int, text, jsonb);
--           drop function public.cuotas_con_extraordinarias(numeric, int, jsonb);
--           y restaurar contratos_crear, contratos_datos_documento y contratos_faltantes desde sus migraciones.
-- Ejecutar después de 20261031160000_clientes_nombres.sql y con un respaldo verificado.

-- Misma regla que repartirCuotas en src/features/financiamiento/plan.ts.
create or replace function public.cuotas_con_extraordinarias(p_total numeric, p_meses int, p_extra jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare e jsonb; v_mes int; v_monto numeric; v_suma numeric := 0; v_cuota numeric; v_ultima numeric; v_lista jsonb;
begin
  if jsonb_typeof(coalesce(p_extra, '[]'::jsonb)) <> 'array' then raise exception 'Cuotas extraordinarias no válidas'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) loop
    if coalesce(e ->> 'mes', '') !~ '^[0-9]+$' then raise exception 'El mes de cada cuota extraordinaria debe estar entre 1 y %', p_meses; end if;
    v_mes := (e ->> 'mes')::int;
    if v_mes < 1 or v_mes > p_meses then raise exception 'El mes de cada cuota extraordinaria debe estar entre 1 y %', p_meses; end if;
    if coalesce(e ->> 'monto', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' or (e ->> 'monto')::numeric <= 0 then raise exception 'El monto de cada cuota extraordinaria debe ser mayor a cero, con hasta dos decimales'; end if;
    v_monto := (e ->> 'monto')::numeric;
    v_suma := v_suma + v_monto;
  end loop;
  if v_suma >= p_total then raise exception 'Las cuotas extraordinarias deben dejar saldo para las cuotas mensuales: el 14 %% es USD %', p_total; end if;
  v_cuota := round((p_total - v_suma) / p_meses, 2);
  v_ultima := round(p_total - v_suma - v_cuota * (p_meses - 1), 2);
  if v_cuota <= 0 or v_ultima <= 0 then raise exception 'Las cuotas extraordinarias deben dejar saldo para las cuotas mensuales: el 14 %% es USD %', p_total; end if;
  select coalesce(jsonb_agg(jsonb_build_object('mes', (x.v ->> 'mes')::int, 'monto', (x.v ->> 'monto')::numeric) order by (x.v ->> 'mes')::int, x.o), '[]'::jsonb) into v_lista
    from jsonb_array_elements(coalesce(p_extra, '[]'::jsonb)) with ordinality x(v, o);
  return jsonb_build_object('cuotaMensual', v_cuota, 'ultimaCuota', v_ultima, 'extraordinarias', v_lista);
end $$;

-- La cotización la sigue calculando cotizaciones_emitir: aquí solo se agregan las extraordinarias, en la misma transacción.
create or replace function public.cotizaciones_emitir_extraordinarias(p_opportunity uuid, p_descuento_pct numeric, p_vigencia_dias int, p_observaciones text, p_extraordinarias jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; q quotes; v_rep jsonb;
begin
  v_id := public.cotizaciones_emitir(p_opportunity, p_descuento_pct, p_vigencia_dias, p_observaciones);
  select * into q from quotes where id = v_id for update;
  v_rep := public.cuotas_con_extraordinarias((q.plan ->> 'cuotasTotal')::numeric, (q.plan ->> 'meses')::int, p_extraordinarias);
  update quotes set plan = plan || v_rep where id = v_id;
  perform public.auditar('Pactar cuotas extraordinarias', 'cotizacion', v_id::text, 'Cotización ' || q.numero, null, v_rep);
  return v_id;
end $$;

-- Cronograma: 0 reserva, 1 pago a la firma, cuotas mensuales y extraordinarias por fecha, y al final el saldo contra entrega.
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

create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

-- Documentos: «pago.cuotas» y su total incluyen las extraordinarias; el número de cuotas mensuales no cambia. Solo los documentos nuevos lo reflejan.
select pg_temp.parchar('public.contratos_datos_documento(uuid, jsonb)',
  $x$'num_cuotas', jsonb_array_length(v_cuotas),$x$,
  $x$'num_cuotas', (select count(*) from installments where contract_id = p_contract and concepto like 'Cuota % de %' and concepto not like 'Cuota extraordinaria%'),
    'extraordinarias', (select coalesce(jsonb_agg(jsonb_build_object('numero', i.numero, 'concepto', i.concepto, 'vencimiento', i.vencimiento, 'monto', i.monto) order by i.numero), '[]'::jsonb)
                        from installments i where i.contract_id = p_contract and i.concepto like 'Cuota extraordinaria%'),$x$)
where to_regprocedure('public.contratos_datos_documento(uuid, jsonb)') is not null;

-- Un contrato sin extraordinarias no tiene ningún dato faltante por ello.
select pg_temp.parchar('public.contratos_faltantes(uuid, jsonb)',
  $x$v_clave := x ->> 'clave';$x$,
  $x$v_clave := x ->> 'clave';
    if v_clave = 'pago.extraordinarias' then continue; end if;$x$)
where to_regprocedure('public.contratos_faltantes(uuid, jsonb)') is not null;

do $d$ begin
  if to_regclass('public.contract_fields') is not null then
    insert into public.contract_fields (clave, grupo, etiqueta, tipo, descripcion) values
      ('pago.extraordinarias', 'Condiciones de pago', 'Cuotas extraordinarias (lista)', 'lista', 'Número, concepto, vencimiento y monto. Vacía si el plan no las tiene')
    on conflict (clave) do nothing;
  end if;
end $d$;

revoke all on function public.cuotas_con_extraordinarias(numeric, int, jsonb) from public, anon;
revoke all on function public.cotizaciones_emitir_extraordinarias(uuid, numeric, int, text, jsonb) from public, anon;
grant execute on function public.cuotas_con_extraordinarias(numeric, int, jsonb) to authenticated;
grant execute on function public.cotizaciones_emitir_extraordinarias(uuid, numeric, int, text, jsonb) to authenticated;
