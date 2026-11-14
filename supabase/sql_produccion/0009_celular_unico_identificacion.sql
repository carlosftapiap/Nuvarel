-- AMURA · SQL de producción 0009. Copia exacta de supabase/migrations/20261120000000_celular_unico_identificacion.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Celular obligatorio y único, e identificación para reservar.
--   · Un celular no puede estar en dos fichas de clientes, sea cual sea el vendedor o el equipo. Se compara normalizado:
--     09XXXXXXXX, 5939XXXXXXXX y +5939XXXXXXXX son el mismo número. Mensaje: «Este celular ya se encuentra registrado en AMURA».
--     Para cambiar de responsable se usa la solicitud de reasignación ya existente (autorizada y auditada).
--   · El celular es obligatorio al registrar un cliente y al cambiar su número: Ecuador, 10 dígitos que empiezan por 09
--     (o +593 9…); otros países, con + y el código del país (8 a 15 dígitos). Se guarda normalizado (+5939XXXXXXXX).
--     Las fichas existentes sin celular se pueden seguir editando; el celular se valida cuando se registra o cambia.
--   · Para solicitar una reserva, el cliente debe tener identificación válida: cédula, pasaporte o RUC; una persona jurídica,
--     RUC; un ecuatoriano no reserva con pasaporte. Un prospecto sin identificación puede recibir seguimiento y cotizaciones.
-- No modifica datos existentes (en producción no hay celulares repetidos). Revertir: drop index clients_celular_uk;
-- restaurar clientes_existente, clientes_verificar_documento, clientes_unicos, reservas_solicitar y reservas_solicitar_acordada
-- desde sus migraciones anteriores y borrar celular_normalizado, clientes_mensaje_coincidencia y reservas_exigir_identificacion.

/* ------------------------------------------------------------- celular */

-- Celular en formato internacional (+5939XXXXXXXX), o null si no es un celular válido.
create or replace function public.celular_normalizado(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when x.d ~ '^09[0-9]{8}$' then '+593' || substr(x.d, 2)
    when x.d ~ '^5939[0-9]{8}$' then '+' || x.d
    when x.d ~ '^593' then null
    when x.mas and x.d ~ '^[1-9][0-9]{7,14}$' then '+' || x.d
    else null end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d, btrim(coalesce(p, '')) like '+%' as mas) x
$$;

-- La base lo garantiza aunque dos registros lleguen a la vez.
create unique index if not exists clients_celular_uk on public.clients (public.celular_normalizado(telefono)) where public.celular_normalizado(telefono) is not null;

create or replace function public.clientes_existente(p_documento text, p_telefono text, p_email text, p_excluir uuid) returns public.clients
language sql stable security definer set search_path = public as $$
  select c.* from clients c
  where c.id is distinct from p_excluir and (
    (public.clientes_clave_documento(public.clientes_tipo_documento(p_documento), p_documento) is not null
      and c.documento_clave = public.clientes_clave_documento(public.clientes_tipo_documento(p_documento), p_documento))
    or (public.celular_normalizado(p_telefono) is not null and public.celular_normalizado(c.telefono) = public.celular_normalizado(p_telefono))
    or (coalesce(btrim(p_email), '') <> '' and c.email <> '' and lower(c.email) = lower(btrim(p_email))))
  order by c.created_at limit 1
$$;

-- El celular repetido tiene su propio mensaje, el mismo para todos; documento y correo conservan el anterior.
create or replace function public.clientes_mensaje_coincidencia(c public.clients, p_telefono text) returns text
language sql stable security definer set search_path = public as $$
  select case when public.celular_normalizado(p_telefono) is not null and public.celular_normalizado(c.telefono) = public.celular_normalizado(p_telefono)
    then 'Este celular ya se encuentra registrado en AMURA.'
    else public.clientes_mensaje_existente(c) end
$$;

create or replace function public.clientes_verificar_documento(p_documento text, p_telefono text, p_email text, p_excluir uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clients; v_tipo text := public.clientes_tipo_documento(p_documento); v_digitos text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para registrar clientes' using errcode = '42501'; end if;
  c := public.clientes_existente(p_documento, p_telefono, p_email, p_excluir);
  return jsonb_build_object(
    'tipo', v_tipo,
    'valido', case when v_tipo = 'cedula' then public.cedula_valida(v_digitos)
                   when v_tipo = 'ruc' then v_digitos ~ '001$' and (substr(v_digitos, 3, 1) >= '6' or public.cedula_valida(left(v_digitos, 10)))
                   else true end,
    'existe', c.id is not null,
    'visible', c.id is not null and public.cliente_en_alcance(c.id),
    'cliente_id', case when c.id is not null and public.cliente_en_alcance(c.id) then c.id end,
    'mensaje', case when c.id is not null then public.clientes_mensaje_coincidencia(c, p_telefono) end);
end $$;

create or replace function public.clientes_unicos() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients; v_digitos text; v_cel text;
begin
  new.documento := btrim(coalesce(new.documento, ''));
  if tg_op = 'INSERT' or new.documento is distinct from old.documento or new.tipo_documento is distinct from old.tipo_documento then
    if tg_op = 'UPDATE' and new.tipo_documento is not distinct from old.tipo_documento then new.tipo_documento := null; end if;
    new.tipo_documento := coalesce(new.tipo_documento, public.clientes_tipo_documento(new.documento));
    v_digitos := regexp_replace(new.documento, '\D', '', 'g');
    if new.tipo_documento = 'cedula' and not public.cedula_valida(v_digitos) then raise exception 'La cédula % no es válida: revisa los dígitos', new.documento; end if;
    if new.tipo_documento = 'ruc' and (v_digitos !~ '^[0-9]{10}001$' or (substr(v_digitos, 3, 1) < '6' and not public.cedula_valida(left(v_digitos, 10)))) then
      raise exception 'El RUC % no es válido: revisa los dígitos', new.documento;
    end if;
    if new.tipo_documento = 'pasaporte' and upper(regexp_replace(new.documento, '[^0-9A-Za-z]', '', 'g')) !~ '^[0-9A-Z]{5,20}$' then
      raise exception 'El pasaporte % no es válido', new.documento;
    end if;
  end if;
  -- Celular obligatorio al registrar y al cambiarlo; se guarda normalizado.
  if tg_op = 'INSERT' or new.telefono is distinct from old.telefono then
    if coalesce(btrim(new.telefono), '') = '' then raise exception 'Ingresa el celular del cliente'; end if;
    v_cel := public.celular_normalizado(new.telefono);
    if v_cel is null then
      raise exception 'El celular % no es válido: en Ecuador, 10 dígitos que empiezan por 09 (o +593 9…); de otro país, con + y el código del país', new.telefono;
    end if;
    new.telefono := v_cel;
  end if;
  if tg_op = 'INSERT' or new.documento is distinct from old.documento or new.telefono is distinct from old.telefono or new.email is distinct from old.email then
    c := public.clientes_existente(
      case when tg_op = 'INSERT' or new.documento is distinct from old.documento then new.documento end,
      case when tg_op = 'INSERT' or new.telefono is distinct from old.telefono then new.telefono end,
      case when tg_op = 'INSERT' or new.email is distinct from old.email then new.email end, new.id);
    if c.id is not null then
      raise exception '%', public.clientes_mensaje_coincidencia(c, case when tg_op = 'INSERT' or new.telefono is distinct from old.telefono then new.telefono end)
        using errcode = '23505', hint = 'cliente_existente';
    end if;
  end if;
  return new;
end $$;

/* --------------------------------------------- identificación para reservar */

create or replace function public.reservas_exigir_identificacion(p_client uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare c clients;
begin
  select * into c from clients where id = p_client;
  if c.documento_clave is null then
    raise exception 'Para solicitar la reserva, completa la identificación del cliente (cédula, pasaporte o RUC) en su ficha';
  end if;
  if c.tipo_persona = 'juridica' and c.tipo_documento <> 'ruc' then raise exception 'Una persona jurídica reserva con su RUC: complétalo en la ficha del cliente'; end if;
  if c.tipo_documento = 'pasaporte' and lower(coalesce(c.nacionalidad, '')) like 'ecuator%' then
    raise exception 'Un cliente ecuatoriano reserva con su cédula: complétala en la ficha del cliente';
  end if;
end $$;
revoke all on function public.reservas_exigir_identificacion(uuid) from public, anon, authenticated;

-- Solicitar la reserva (con y sin monto acordado) exige la identificación. Igual que en producción, más esa comprobación.
create or replace function public.reservas_solicitar(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q quotes; u inventory_units; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
begin
  if not public.tiene_permiso('reservas.solicitar') then raise exception 'Sin permiso para solicitar reservas' using errcode = '42501'; end if;
  select * into q from quotes where id = p_quote_id;
  if not found or not public.cliente_en_alcance(q.client_id) then raise exception 'Cotización inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if q.estado <> 'aceptada' then raise exception 'Solo se reserva con la cotización aceptada por el cliente'; end if;
  if q.client_id is null or q.opportunity_id is null then raise exception 'La cotización debe estar vinculada a cliente y oportunidad'; end if;
  perform public.reservas_exigir_identificacion(q.client_id);
  if q.valida_hasta < (now() at time zone 'America/Guayaquil')::date then raise exception 'La cotización venció'; end if;
  select * into u from inventory_units where codigo = q.codigo for update;
  if u.estado <> 'disponible' then raise exception 'La unidad no puede reservarse (%)', u.estado; end if;
  begin
    insert into reservations (codigo, client_id, opportunity_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, descuento_pct,
                              reserva_pct, monto_reserva, meses, cuota_mensual, created_by)
    values ('RES-' || v_anio || '-' || lpad((select count(*) + 1 from reservations where codigo like 'RES-' || v_anio || '-%')::text, 4, '0'),
            q.client_id, q.opportunity_id, q.codigo, q.id, q.valida_hasta, q.precio_final, q.descuento_pct,
            (q.plan ->> 'reservaPct')::numeric, (q.plan ->> 'reserva')::numeric, (q.plan ->> 'meses')::smallint,
            (q.plan ->> 'cuotaMensual')::numeric, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'La unidad % ya tiene una reserva activa', q.codigo;
  end;
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'solicitud_reserva' where id = q.opportunity_id;
  perform public.auditar('Solicitar reserva', 'reserva', v_id::text, 'Solicitud desde cotización ' || q.numero || ' v' || q.version, null,
    jsonb_build_object('unidad', q.codigo, 'precio', q.precio_final, 'reserva', q.plan ->> 'reserva'));
  return v_id;
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
  perform public.reservas_exigir_identificacion(q.client_id);
  if q.valida_hasta < v_hoy then raise exception 'La cotización venció'; end if;
  v_max := round(q.precio_final * (q.plan ->> 'reservaPct')::numeric / 100, 2);
  if p_monto is null or p_monto <= 0 or p_monto > v_max then
    raise exception 'La reserva debe ser mayor a cero y no superar el 6%% (USD %)', v_max;
  end if;

  select * into u from inventory_units where codigo = q.codigo for update;
  if u.estado <> 'disponible' then raise exception 'La unidad no puede reservarse (%)', u.estado; end if;
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
