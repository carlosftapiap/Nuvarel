-- AMURA · Reversión de 0018 (calendario fijo y día de pago). Vuelve a la regla de 0017. Hacer respaldo antes.
-- Conserva las columnas dia_pago (no se pierden datos); deja de usarlas.

do $$
declare v_def text := replace(pg_get_functiondef(to_regprocedure('public.cotizaciones_emitir(uuid,numeric,integer,text)')), chr(13), '');
begin
  execute replace(v_def, 'v_meses := (select cal.meses from public.cuotas_calendario(u.edificio, v_hoy) cal);', 'v_meses := case u.edificio when 1 then pp.meses_e1 else pp.meses_e2 end;');
end $$;

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

drop trigger if exists reserva_dia_pago on public.reservations;
drop function if exists public.reserva_dia_pago();
drop function if exists public.cotizaciones_emitir_calendario(uuid, numeric, int, text, jsonb, date, text, boolean);
drop function if exists public.cuota_vencimiento(date, int, text, date);
drop function if exists public.cuotas_calendario(int, date);
