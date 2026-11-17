-- AMURA · SQL de producción 0018. Copia exacta de supabase/migrations/20261127000000_calendario_fijo_cuotas.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Calendario fijo de cuotas por edificio y día de pago elegido por el comprador. Corrige 0017 sin editarla:
-- el plazo NO se reinicia con cada comprador.
-- Edificio A: diciembre 2026 a noviembre 2029 (36 meses). Torre B: diciembre 2026 a mayo 2030 (42 meses).
-- Cuotas que quedan = meses desde el mes de firma (incluido) hasta el mes final del edificio; firma antes de dic 2026: todas.
-- Día de pago: 1 a 31 o 'ultimo' (predeterminado). Día 29-31 en un mes más corto: último día del mes.
-- Si el día elegido ya pasó en el mes de firma, la cuota de ese mes vence el mismo día de la firma (nunca antes de firmar).
-- El 14 % se divide entre las cuotas que quedan; la última absorbe los centavos. 6 % y 80 % no cambian.
-- La cotización guarda día de pago, fecha de firma, vencimientos y la aceptación del comprador; la reserva hereda el día;
-- el contrato recalcula con la fecha real de firma y el mismo día. No cambia cotizaciones, reservas ni contratos existentes.
-- Ejecutar después de 0017. Revertir: supabase/sql_produccion/reversion/0018_revertir_calendario_fijo_cuotas.sql

-- 1. Calendario del edificio a una fecha de firma.
create or replace function public.cuotas_calendario(p_edificio int, p_fecha date)
returns table (meses int, mes_inicial date, mes_final date)
language plpgsql stable security definer set search_path = public as $$
declare pp pricing_params; v_total int; v_ini date; v_desde date;
begin
  select * into pp from pricing_params where id = 1;
  v_total := case p_edificio when 1 then pp.meses_e1 else pp.meses_e2 end;
  if pp.inicio_cuotas is null then
    return query select v_total, null::date, null::date;
    return;
  end if;
  v_ini := date_trunc('month', pp.inicio_cuotas)::date;
  v_desde := greatest(date_trunc('month', p_fecha)::date, v_ini);
  meses := v_total - ((extract(year from v_desde)::int * 12 + extract(month from v_desde)::int) - (extract(year from v_ini)::int * 12 + extract(month from v_ini)::int));
  mes_final := (v_ini + make_interval(months => v_total - 1))::date;
  if meses < 1 then
    raise exception 'El calendario de cuotas del edificio terminó en %: no quedan cuotas para el 14 %%', to_char(mes_final, 'MM/YYYY');
  end if;
  mes_inicial := v_desde;
  return next;
end $$;
revoke all on function public.cuotas_calendario(int, date) from public, anon;
grant execute on function public.cuotas_calendario(int, date) to authenticated;

-- 2. Vencimiento de la cuota n según el día elegido. Nunca antes de la firma.
create or replace function public.cuota_vencimiento(p_mes1 date, p_n int, p_dia text, p_firma date) returns date
language plpgsql immutable set search_path = public as $$
declare v_mes date := (date_trunc('month', p_mes1) + make_interval(months => p_n - 1))::date; v_ult date; v_fecha date;
begin
  if coalesce(p_dia, '') !~ '^(ultimo|[1-9]|[12][0-9]|3[01])$' then raise exception 'Día de pago no válido: elige del 1 al 31 o el último día del mes'; end if;
  v_ult := (v_mes + interval '1 month' - interval '1 day')::date;
  v_fecha := case when p_dia = 'ultimo' then v_ult else least(v_mes + (p_dia::int - 1), v_ult) end;
  return greatest(v_fecha, p_firma);
end $$;
revoke all on function public.cuota_vencimiento(date, int, text, date) from public, anon;
grant execute on function public.cuota_vencimiento(date, int, text, date) to authenticated;

-- 3. Cotización directa: cuotas que quedan a la fecha de emisión. Se reemplaza solo esa línea de la versión vigente.
do $$
declare v_def text := replace(pg_get_functiondef(to_regprocedure('public.cotizaciones_emitir(uuid,numeric,integer,text)')), chr(13), '');
  v_old text := 'v_meses := case u.edificio when 1 then pp.meses_e1 else pp.meses_e2 end;';
  v_new text := 'v_meses := (select cal.meses from public.cuotas_calendario(u.edificio, v_hoy) cal);';
begin
  if position(v_new in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then raise exception 'cotizaciones_emitir difiere de la versión auditada'; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 4. Emisión con calendario: en una sola transacción emite, recalcula a la fecha de firma prevista y guarda el día de pago,
--    los vencimientos y la aceptación expresa del comprador.
create or replace function public.cotizaciones_emitir_calendario(p_opportunity uuid, p_descuento_pct numeric, p_vigencia_dias int, p_observaciones text,
  p_extraordinarias jsonb, p_fecha_firma date, p_dia_pago text, p_acepta boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; q quotes; v_edificio int; v_meses int; v_mes1 date; v_rep jsonb; v_venc jsonb;
begin
  if p_acepta is not true then raise exception 'El comprador debe aceptar expresamente el calendario de pagos'; end if;
  if coalesce(p_dia_pago, '') !~ '^(ultimo|[1-9]|[12][0-9]|3[01])$' then raise exception 'Día de pago no válido: elige del 1 al 31 o el último día del mes'; end if;
  if p_fecha_firma is null then raise exception 'Indica la fecha de firma prevista'; end if;
  if jsonb_array_length(coalesce(p_extraordinarias, '[]'::jsonb)) > 0 then
    v_id := public.cotizaciones_emitir_extraordinarias(p_opportunity, p_descuento_pct, p_vigencia_dias, p_observaciones, p_extraordinarias);
  else
    v_id := public.cotizaciones_emitir(p_opportunity, p_descuento_pct, p_vigencia_dias, p_observaciones);
  end if;
  select * into q from quotes where id = v_id;
  select edificio into v_edificio from inventory_units where codigo = q.codigo;
  select x.meses, x.mes_inicial into v_meses, v_mes1 from public.cuotas_calendario(v_edificio, p_fecha_firma) x;
  if v_mes1 is null then
    update quotes set plan = plan || jsonb_build_object('diaPago', p_dia_pago, 'fechaFirma', p_fecha_firma, 'calendarioAceptado', true) where id = v_id;
  else
    v_rep := public.cuotas_con_extraordinarias((q.plan ->> 'cuotasTotal')::numeric, v_meses, coalesce(q.plan -> 'extraordinarias', '[]'::jsonb));
    select jsonb_agg(public.cuota_vencimiento(v_mes1, i, p_dia_pago, p_fecha_firma) order by i) into v_venc from generate_series(1, v_meses) i;
    update quotes set plan = plan || v_rep || jsonb_build_object('meses', v_meses, 'diaPago', p_dia_pago, 'fechaFirma', p_fecha_firma,
        'vencimientos', v_venc, 'ultimaFecha', v_venc ->> (v_meses - 1), 'cuotaEnFirma', (v_venc ->> 0)::date = p_fecha_firma and p_dia_pago <> 'ultimo' and p_dia_pago::int < extract(day from p_fecha_firma)::int, 'calendarioAceptado', true)
     where id = v_id;
  end if;
  perform public.auditar('Aceptar calendario de pagos', 'cotizacion', v_id::text, 'Día de pago ' || p_dia_pago || ' · firma ' || p_fecha_firma, null,
    jsonb_build_object('diaPago', p_dia_pago, 'fechaFirma', p_fecha_firma, 'cuotas', coalesce(v_meses, (q.plan ->> 'meses')::int)));
  return v_id;
end $$;
revoke all on function public.cotizaciones_emitir_calendario(uuid, numeric, int, text, jsonb, date, text, boolean) from public, anon;
grant execute on function public.cotizaciones_emitir_calendario(uuid, numeric, int, text, jsonb, date, text, boolean) to authenticated;

-- 5. Reserva y contrato conservan el día elegido.
alter table public.reservations add column if not exists dia_pago text check (dia_pago ~ '^(ultimo|[1-9]|[12][0-9]|3[01])$');
alter table public.contracts add column if not exists dia_pago text check (dia_pago ~ '^(ultimo|[1-9]|[12][0-9]|3[01])$');
create or replace function public.reserva_dia_pago() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dia_pago is null then new.dia_pago := coalesce((select plan ->> 'diaPago' from quotes where id = new.quote_id), 'ultimo'); end if;
  return new;
end $$;
revoke all on function public.reserva_dia_pago() from public, anon, authenticated;
drop trigger if exists reserva_dia_pago on public.reservations;
create trigger reserva_dia_pago before insert on public.reservations for each row execute function public.reserva_dia_pago();

-- 6. Contrato: cuotas que quedan a la fecha de firma, con el día elegido.
create or replace function public.contratos_crear(p_reservation uuid, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_mes1 date; v_rep jsonb; v_edificio int; v_dia text; r reservations; q quotes; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
  v_meses int; v_cuota numeric; v_ultima numeric; v_entrega numeric; v_acumulado numeric; v_firma numeric; i int; v_extra jsonb; v_n int;
begin
  if not public.tiene_permiso('ventas.preparar') then raise exception 'Sin permiso para preparar contratos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_reservation for update;
  if not found or r.estado <> 'confirmada' then raise exception 'Solo se genera contrato de una reserva aprobada'; end if;
  if not public.cliente_en_alcance(r.client_id) then raise exception 'Fuera de tu alcance' using errcode = '42501'; end if;
  if exists (select 1 from contracts c where c.reservation_id = r.id and c.estado <> 'anulado') then raise exception 'La reserva ya tiene contrato'; end if;
  select * into q from quotes where id = r.quote_id;
  -- Calendario fijo del edificio: cuotas desde el mes de firma (o el de inicio, si la firma es anterior) hasta el mes final.
  -- El día de pago es el que eligió el comprador en la cotización; no cambia después de la firma.
  v_dia := coalesce(r.dia_pago, q.plan ->> 'diaPago', 'ultimo');
  select edificio into v_edificio from inventory_units where codigo = r.codigo_unidad;
  select cal.meses, cal.mes_inicial into v_meses, v_mes1 from public.cuotas_calendario(v_edificio, p_fecha) cal;
  if v_mes1 is null then v_meses := (q.plan ->> 'meses')::int; end if;
  v_cuota := (q.plan ->> 'cuotaMensual')::numeric;
  v_ultima := (q.plan ->> 'ultimaCuota')::numeric;
  v_entrega := (q.plan ->> 'contraEntrega')::numeric;
  v_extra := coalesce(q.plan -> 'extraordinarias', '[]'::jsonb);
  v_n := jsonb_array_length(v_extra);
  if v_mes1 is not null then
    -- El 14 % se divide entre las cuotas que quedan a la fecha de firma; la última absorbe los centavos.
    v_rep := public.cuotas_con_extraordinarias((q.plan ->> 'cuotasTotal')::numeric, v_meses, v_extra);
    v_cuota := (v_rep ->> 'cuotaMensual')::numeric;
    v_ultima := (v_rep ->> 'ultimaCuota')::numeric;
  end if;
  v_acumulado := round(r.precio_acordado * 6 / 100, 2);
  v_firma := round(v_acumulado - r.monto_reserva, 2);
  if v_firma < 0 then raise exception 'La reserva supera el 6%% acumulado a la firma'; end if;

  insert into contracts (codigo, reservation_id, client_id, opportunity_id, codigo_unidad, precio, fecha_contrato, dia_pago)
  values ('CON-' || v_anio || '-' || lpad((select count(*) + 1 from contracts where codigo like 'CON-' || v_anio || '-%')::text, 4, '0'),
          r.id, r.client_id, r.opportunity_id, r.codigo_unidad, r.precio_acordado, p_fecha, v_dia)
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
            (case when v_mes1 is null then (p_fecha + make_interval(months => i))::date else public.cuota_vencimiento(v_mes1, i, v_dia, p_fecha) end), case when i = v_meses then v_ultima else v_cuota end);
  end loop;
  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  select v_id, (x.v ->> 'mes')::int + 1 + x.o::int, 'Cuota extraordinaria ' || x.o || ' de ' || v_n,
         (case when v_mes1 is null then (p_fecha + make_interval(months => (x.v ->> 'mes')::int))::date else public.cuota_vencimiento(v_mes1, (x.v ->> 'mes')::int, v_dia, p_fecha) end), (x.v ->> 'monto')::numeric
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

-- 7. Verificación: A 36/35/34 y B 42/41/40 (firmas dic 2026, ene 2027, feb 2027) y vencimientos de los ejemplos aprobados.
do $$ begin
  if (select array_agg(c.meses order by f) from unnest(array[date '2026-11-16', date '2026-12-15', date '2027-01-20', date '2027-02-10']) f, public.cuotas_calendario(1, f) c) <> array[36, 36, 35, 34]
  or (select array_agg(c.meses order by f) from unnest(array[date '2026-11-16', date '2026-12-15', date '2027-01-20', date '2027-02-10']) f, public.cuotas_calendario(2, f) c) <> array[42, 42, 41, 40]
  or (select mes_final from public.cuotas_calendario(1, date '2027-01-20')) <> date '2029-11-01'
  or (select mes_final from public.cuotas_calendario(2, date '2027-01-20')) <> date '2030-05-01' then
    raise exception 'El calendario fijo no da 36/35/34 (A, hasta 11/2029) y 42/41/40 (B, hasta 05/2030)';
  end if;
  if public.cuota_vencimiento('2026-12-01', 1, 'ultimo', '2026-12-15') <> '2026-12-31'
  or public.cuota_vencimiento('2026-12-01', 36, 'ultimo', '2026-12-15') <> '2029-11-30'
  or public.cuota_vencimiento('2027-01-01', 1, '10', '2027-01-20') <> '2027-01-20'
  or public.cuota_vencimiento('2027-01-01', 2, '10', '2027-01-20') <> '2027-02-10'
  or public.cuota_vencimiento('2027-01-01', 2, '31', '2027-01-05') <> '2027-02-28'
  or public.cuota_vencimiento('2027-02-01', 1, '30', '2027-02-10') <> '2027-02-28'
  or public.cuota_vencimiento('2027-02-01', 2, '30', '2027-02-10') <> '2027-03-30' then
    raise exception 'Los vencimientos por día de pago no coinciden con los ejemplos aprobados';
  end if;
end $$;
