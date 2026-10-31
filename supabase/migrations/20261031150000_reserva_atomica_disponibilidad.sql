-- AMURA · Solicitud de reserva en una sola operación y disponibilidad visible para todos los perfiles comerciales.
--   · reservas_solicitar_acordada: acepta la cotización y crea la solicitud con el monto acordado, en una sola transacción.
--     Repetirla (doble clic, reintento) devuelve la misma solicitud; no crea otra.
--   · inventario_solicitudes_activas: qué unidades tienen una solicitud en trámite, sin datos del cliente.
--     No cambia el estado guardado de la unidad: la solicitud sigue sin bloquearla hasta que Gerencia apruebe.
-- Aditiva: no modifica reservas, cotizaciones, pagos ni unidades existentes. Se puede repetir.
-- Revertir: drop function public.reservas_solicitar_acordada(uuid, numeric);
--           drop function public.inventario_solicitudes_activas();
--           y restaurar reserva_monto_predeterminado desde 20261031080000_integracion_final.sql.
-- Ejecutar después de 20261031140000_reserva_predeterminada.sql y con un respaldo verificado.

-- El monto ya acordado entra tal cual; las demás solicitudes siguen con el predeterminado.
create or replace function public.reserva_monto_predeterminado() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.reserva_acordada', true), '') = 'on' then return new; end if;
  new.monto_reserva := least(500.00, new.monto_reserva);
  return new;
end $$;

create or replace function public.reservas_solicitar_acordada(p_quote_id uuid, p_monto numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  q quotes; u inventory_units; r reservations; v_id uuid; v_max numeric;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
begin
  if not public.tiene_permiso('reservas.solicitar') then raise exception 'Sin permiso para solicitar reservas' using errcode = '42501'; end if;
  select * into q from quotes where id = p_quote_id for update;
  if not found or not public.cliente_en_alcance(q.client_id) then raise exception 'Cotización inexistente o fuera de tu alcance' using errcode = '42501'; end if;

  -- Reintento de la misma solicitud: no se duplica.
  select * into r from reservations where quote_id = q.id and estado in ('solicitada', 'pago_verificado', 'confirmada') limit 1;
  if found then
    if r.monto_reserva = p_monto then return r.id; end if;
    raise exception 'Esta cotización ya tiene la solicitud % por USD %', r.codigo, r.monto_reserva;
  end if;

  if q.estado not in ('emitida', 'aceptada') then raise exception 'La cotización está %', q.estado; end if;
  if q.estado = 'emitida' and not public.tiene_permiso('cotizaciones.crear') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if q.client_id is null or q.opportunity_id is null then raise exception 'La cotización debe estar vinculada a cliente y oportunidad'; end if;
  if q.valida_hasta < v_hoy then raise exception 'La cotización venció'; end if;
  v_max := round(q.precio_final * (q.plan ->> 'reservaPct')::numeric / 100, 2);
  if p_monto is null or p_monto <= 0 or p_monto > v_max then
    raise exception 'La reserva debe ser mayor a cero y no superar el 6%% (USD %)', v_max;
  end if;

  select * into u from inventory_units where codigo = q.codigo for update;
  if u.estado = 'por_confirmar' then raise exception 'La unidad aún no tiene disponibilidad confirmada'; end if;
  if u.estado not in ('disponible', 'bloqueado') then raise exception 'La unidad no puede reservarse (%)', u.estado; end if;
  select * into r from reservations where codigo_unidad = q.codigo and estado in ('solicitada', 'pago_verificado', 'confirmada') limit 1;
  if found then raise exception 'La unidad % ya tiene una reserva activa (%)', q.codigo, r.codigo; end if;

  perform set_config('app.flujo', 'on', true);
  if q.estado = 'emitida' then
    update quotes set estado = 'reemplazada' where opportunity_id = q.opportunity_id and estado in ('emitida', 'aceptada') and id <> q.id;
    update quotes set estado = 'aceptada', aceptada_en = now() where id = q.id;
    perform public.auditar('Cotización aceptada', 'cotizacion', q.id::text, 'Aceptada por el cliente', null,
      jsonb_build_object('numero', q.numero, 'version', q.version, 'precio_final', q.precio_final, 'descuento_pct', q.descuento_pct));
  end if;

  -- El consecutivo se calcula de a uno, aunque se soliciten unidades distintas a la vez.
  perform pg_advisory_xact_lock(hashtext('reservas_codigo'));
  perform set_config('app.reserva_acordada', 'on', true);
  begin
    insert into reservations (codigo, client_id, opportunity_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, descuento_pct,
                              reserva_pct, monto_reserva, meses, cuota_mensual, created_by)
    values ('RES-' || v_anio || '-' || lpad((select count(*) + 1 from reservations where codigo like 'RES-' || v_anio || '-%')::text, 4, '0'),
            q.client_id, q.opportunity_id, q.codigo, q.id, q.valida_hasta, q.precio_final, q.descuento_pct,
            (q.plan ->> 'reservaPct')::numeric, p_monto, (q.plan ->> 'meses')::smallint, (q.plan ->> 'cuotaMensual')::numeric, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'La unidad % ya tiene una reserva activa', q.codigo;
  end;
  perform set_config('app.reserva_acordada', 'off', true);

  update opportunities set etapa = 'solicitud_reserva' where id = q.opportunity_id;
  perform public.auditar('Solicitar reserva', 'reserva', v_id::text, 'Solicitud desde cotización ' || q.numero || ' v' || q.version, null,
    jsonb_build_object('unidad', q.codigo, 'precio', q.precio_final, 'reserva', p_monto));
  return v_id;
end $$;

-- Sin datos del cliente: el código y el estado de la solicitud. La cotización solo llega a quien tiene acceso a ese cliente.
create or replace function public.inventario_solicitudes_activas() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'codigo_unidad', r.codigo_unidad, 'codigo', r.codigo, 'estado', r.estado, 'vigencia_hasta', r.vigencia_hasta,
    'quote_id', case when public.tiene_permiso('reservas.ver') and public.cliente_en_alcance(r.client_id) then r.quote_id end)), '[]'::jsonb)
  from reservations r
  where r.estado in ('solicitada', 'pago_verificado')
    and (public.tiene_permiso('inventario.ver') or public.tiene_permiso('cotizaciones.ver') or public.tiene_permiso('reservas.ver')
         or public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver'))
$$;

revoke all on function public.reservas_solicitar_acordada(uuid, numeric) from public, anon;
revoke all on function public.inventario_solicitudes_activas() from public, anon;
grant execute on function public.reservas_solicitar_acordada(uuid, numeric) to authenticated;
grant execute on function public.inventario_solicitudes_activas() to authenticated;
