-- AMURA · Desistimiento del comprador desde la app, y anulación de reservas que libera la unidad solo si corresponde.
-- Nada se borra: reserva, cotización, negociación y cliente quedan marcados, con historial y auditoría.
-- No genera pagos, devoluciones ni comisiones: si hubo dinero, queda pendiente de revisión de Finanzas.
-- Ejecutar después de 20261031000000_clientes_crm.sql (o de su correctivo). No depende del Gantt.

do $$ begin
  if to_regclass('public.client_access') is null or to_regprocedure('public.reservas_anular(uuid, text)') is null then
    raise exception 'Falta Clientes: aplica antes 20261031000000_clientes_crm.sql o correctivo_clientes_produccion.sql';
  end if;
end $$;

/* ---------------------------------------------------------------------- permiso */

insert into public.permissions (clave, modulo, descripcion) values ('ventas.desistimiento', 'Ventas y contratos', 'Registrar desistimientos de su alcance')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;
insert into public.role_permissions (role_id, permiso)
select r.id, 'ventas.desistimiento' from public.roles r where r.id in ('administrador', 'gerencia', 'supervisor', 'asesor', 'corredor')
on conflict do nothing;

/* --------------------------------------------------------------------- registro */

create table if not exists public.desistimientos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  opportunity_id uuid references public.opportunities (id),
  reservation_id uuid references public.reservations (id),
  codigo_unidad text references public.inventory_units (codigo),
  motivo text not null check (motivo in ('cambio_decision', 'sin_financiamiento', 'precio', 'compro_otro', 'personal', 'otro')),
  observaciones text not null default '',
  -- Lo que le ocurrió a la unidad, tal como quedó al registrar.
  unidad_antes text,
  unidad_despues text,
  unidad_detalle text not null default '',
  -- Dinero ya recibido o informado. No se devuelve ni se mueve desde aquí.
  monto_recibido numeric(14,2),
  revision_financiera text not null default 'no_aplica' check (revision_financiera in ('no_aplica', 'pendiente', 'revisada')),
  revision_nota text,
  revisada_por uuid references auth.users (id),
  revisada_en timestamptz,
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_nombre text not null,
  registrado_en timestamptz not null default now()
);
alter table public.desistimientos enable row level security;
-- Sin políticas de escritura: solo las funciones siguientes.
drop policy if exists "ver desistimientos" on public.desistimientos;
create policy "ver desistimientos" on public.desistimientos for select to authenticated
  using ((public.tiene_permiso('clientes.ver') or public.tiene_permiso('reservas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(client_id));

/* --------------------------------------------- qué le corresponde a la unidad */

-- Decide sin cambiar nada. Una unidad solo se libera si esta reserva es la que la tiene y nadie más la compromete.
-- Si Gerencia la tenía bloqueada antes de la reserva, vuelve a bloqueada. Devuelve null si no cambia.
create or replace function public.reservas_destino_unidad(r public.reservations, u public.inventory_units) returns public.estado_comercial
language plpgsql stable security definer set search_path = public as $$
declare v_previo estado_comercial;
begin
  if u.estado <> 'reservado' or u.reserva_id is distinct from r.id then return null; end if;
  if exists (select 1 from reservations x where x.codigo_unidad = u.codigo and x.id <> r.id and x.estado in ('solicitada', 'pago_verificado', 'confirmada')) then return null; end if;
  if exists (select 1 from contracts k where k.codigo_unidad = u.codigo and k.estado <> 'anulado') then return null; end if;
  select h.de into v_previo from inventory_status_history h where h.reserva_id = r.id and h.a = 'reservado' order by h.fecha desc limit 1;
  return case when v_previo = 'bloqueado' then 'bloqueado'::estado_comercial else 'disponible'::estado_comercial end;
end $$;

-- Aplica la decisión con la unidad ya bloqueada por quien llama. Devuelve el texto para el historial.
create or replace function public.reservas_liberar_unidad(r public.reservations, u public.inventory_units, p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
declare v_destino estado_comercial := public.reservas_destino_unidad(r, u);
begin
  if v_destino is null then
    return case
      when u.reserva_id is distinct from r.id and u.estado = 'reservado' then 'La unidad está reservada por otra operación: no cambia'
      when u.estado = 'bloqueado' then 'La unidad sigue bloqueada por Gerencia'
      when u.estado in ('promesa', 'vendido') then 'La unidad tiene un compromiso vigente: no cambia'
      when u.estado = 'reservado' then 'La unidad tiene otra operación vigente: no cambia'
      else 'La solicitud no había retenido la unidad: no cambia' end;
  end if;
  update inventory_units set estado = v_destino, reserva_id = null, updated_at = now(), updated_by = auth.uid() where codigo = u.codigo;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), u.codigo, 'reservado', v_destino, p_motivo, r.id);
  return case when v_destino = 'bloqueado' then 'La unidad vuelve a estar bloqueada, como antes de la reserva' else 'La unidad queda disponible' end;
end $$;

-- La anulación de Gerencia usa la misma regla: ya no libera a ciegas. Sigue dejando la negociación en Cotización para retomarla.
create or replace function public.reservas_anular(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; u inventory_units;
begin
  if not public.tiene_permiso('reservas.anular') then raise exception 'Sin permiso para anular' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la anulación'; end if;
  select * into r from reservations where id = p_id for update;
  if not found or not public.cliente_en_alcance(r.client_id) then raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if r.estado in ('anulada', 'rechazada') then raise exception 'La reserva ya está %', r.estado; end if;
  if exists (select 1 from contracts c where c.reservation_id = p_id and c.estado <> 'anulado') then raise exception 'La reserva ya tiene contrato; anula primero el contrato'; end if;
  perform set_config('app.flujo', 'on', true);
  if r.estado = 'confirmada' then
    select * into u from inventory_units where codigo = r.codigo_unidad for update;
    perform public.reservas_liberar_unidad(r, u, 'Reserva ' || r.codigo || ' anulada');
    update clients set etapa = 'negociacion' where id = r.client_id and etapa = 'reserva'
      and not exists (select 1 from reservations x where x.client_id = r.client_id and x.id <> r.id and x.estado = 'confirmada');
  end if;
  update opportunities set etapa = 'cotizacion' where id = r.opportunity_id;
  update reservations set estado = 'anulada', motivo_anulacion = trim(p_motivo) where id = p_id;
  perform public.auditar('Anular reserva', 'reserva', p_id::text, trim(p_motivo), jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'anulada'));
end $$;

/* ---------------------------------------------------------------- desistimiento */

create or replace function public.desistimiento_motivo_texto(p_motivo text) returns text
language sql immutable as $$
  select case p_motivo when 'cambio_decision' then 'Cambió de decisión' when 'sin_financiamiento' then 'No obtuvo financiamiento' when 'precio' then 'Precio o condiciones'
    when 'compro_otro' then 'Compró en otro proyecto' when 'personal' then 'Motivos personales' when 'otro' then 'Otro motivo' end
$$;

-- Reserva activa de la operación. También encuentra reservas anteriores al flujo, que no tienen negociación.
create or replace function public.desistimiento_reserva(o public.opportunities) returns public.reservations
language sql stable security definer set search_path = public as $$
  select r.* from reservations r
  where r.estado in ('solicitada', 'pago_verificado', 'confirmada')
    and (r.opportunity_id = o.id or (r.opportunity_id is null and r.client_id = o.client_id and r.codigo_unidad = o.codigo_unidad))
  limit 1
$$;

-- Lo recibido por esta operación: el mayor entre el ingreso verificado de la reserva y los pagos verificados de un contrato suyo ya anulado.
create or replace function public.desistimiento_recibido(p_reserva uuid, p_oportunidad uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select nullif(greatest(
    coalesce((select r.pago_monto from reservations r where r.id = p_reserva), 0),
    coalesce((select max(s.total) from (
      select sum(p.monto) as total from payments p join contracts k on k.id = p.contract_id
      where p.estado = 'verificado' and (k.reservation_id = p_reserva or k.opportunity_id = p_oportunidad) group by k.id) s), 0)), 0)
$$;

-- Muestra qué pasaría, sin cambiar nada, para confirmar con la información a la vista.
create or replace function public.desistimientos_previsualizar(p_client uuid, p_oportunidad uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o opportunities; r reservations; u inventory_units; v_destino estado_comercial; v_bloqueo text; v_recibido numeric;
begin
  if not public.tiene_permiso('ventas.desistimiento') then raise exception 'Sin permiso para registrar desistimientos' using errcode = '42501'; end if;
  if not public.cliente_en_alcance(p_client) then raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if p_oportunidad is null then return jsonb_build_object('reserva', null, 'bloqueo', null, 'unidad', null); end if;
  select * into o from opportunities where id = p_oportunidad and client_id = p_client;
  if not found then raise exception 'La negociación no corresponde a este cliente'; end if;
  r := public.desistimiento_reserva(o);
  if exists (select 1 from contracts k where k.estado <> 'anulado' and (k.opportunity_id = o.id or (r.id is not null and k.reservation_id = r.id))) then
    v_bloqueo := 'Tiene un contrato vigente: anúlalo primero en Ventas y contratos.';
  elsif o.etapa = 'perdida' then
    v_bloqueo := 'Esta negociación ya está cerrada.';
  end if;
  select * into u from inventory_units where codigo = coalesce(r.codigo_unidad, o.codigo_unidad);
  if r.id is not null then v_destino := public.reservas_destino_unidad(r, u); end if;
  v_recibido := public.desistimiento_recibido(r.id, o.id);
  return jsonb_build_object('bloqueo', v_bloqueo, 'unidad', u.codigo, 'unidad_estado', u.estado, 'unidad_destino', v_destino,
    'reserva', r.codigo, 'reserva_estado', r.estado, 'comprobante', r.comprobante, 'monto_recibido', v_recibido);
end $$;

-- Todo o nada: una función es una sola transacción. Si algo falla, no queda ningún cambio.
create or replace function public.desistimientos_registrar(p_client uuid, p_oportunidad uuid, p_motivo text, p_observaciones text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c clients; o opportunities; r reservations; u inventory_units; v_id uuid;
  v_obs text := trim(coalesce(p_observaciones, '')); v_texto text; v_detalle text := ''; v_antes text; v_despues text;
  v_recibido numeric; v_pendiente boolean := false; v_etapa etapa_cliente; v_otras boolean; v_nombre text;
begin
  if not public.tiene_permiso('ventas.desistimiento') then raise exception 'Sin permiso para registrar desistimientos' using errcode = '42501'; end if;
  v_texto := public.desistimiento_motivo_texto(p_motivo);
  if v_texto is null then raise exception 'Elige el motivo del desistimiento'; end if;
  if p_motivo = 'otro' and char_length(v_obs) < 5 then raise exception 'Con "Otro motivo", explica en las observaciones qué ocurrió'; end if;

  -- Siempre en este orden: cliente, negociación, reserva, unidad.
  select * into c from clients where id = p_client for update;
  if not found or not public.cliente_en_alcance(p_client) then raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501'; end if;

  if p_oportunidad is null then
    if exists (select 1 from opportunities x where x.client_id = p_client and x.etapa <> 'perdida') then raise exception 'El cliente tiene negociaciones abiertas: elige de cuál desiste'; end if;
    if c.etapa = 'perdido' then raise exception 'El cliente ya está marcado como perdido'; end if;
    if c.etapa = 'reserva' then raise exception 'El cliente tiene una reserva: elige la operación'; end if;
  else
    select * into o from opportunities where id = p_oportunidad and client_id = p_client for update;
    if not found then raise exception 'La negociación no corresponde a este cliente'; end if;
    if o.etapa = 'perdida' then raise exception 'Esta negociación ya está cerrada'; end if;
    select * into r from reservations where id = (public.desistimiento_reserva(o)).id for update;
    if exists (select 1 from contracts k where k.estado <> 'anulado' and (k.opportunity_id = o.id or (r.id is not null and k.reservation_id = r.id))) then
      raise exception 'Tiene un contrato vigente: anúlalo primero en Ventas y contratos';
    end if;
    if r.id is not null and o.codigo_unidad is not null and r.codigo_unidad <> o.codigo_unidad then
      raise exception 'La reserva % no corresponde a la unidad de esta negociación', r.codigo;
    end if;
    if coalesce(r.codigo_unidad, o.codigo_unidad) is not null then
      select * into u from inventory_units where codigo = coalesce(r.codigo_unidad, o.codigo_unidad) for update;
      v_antes := u.estado::text;
    end if;

    v_recibido := public.desistimiento_recibido(r.id, o.id);
    v_pendiente := v_recibido is not null or r.comprobante is not null;

    perform set_config('app.flujo', 'on', true);
    if r.id is not null then
      v_detalle := public.reservas_liberar_unidad(r, u, 'Desistimiento · reserva ' || r.codigo);
      update reservations set estado = 'anulada', motivo_anulacion = 'Desistimiento: ' || v_texto where id = r.id;
      perform public.auditar('Anular reserva por desistimiento', 'reserva', r.id::text, 'Desistimiento: ' || v_texto, jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'anulada'));
    elsif u.codigo is not null then
      v_detalle := 'Sin reserva propia: la unidad no cambia';
    end if;
    -- Las cotizaciones quedan como historia, pero ya no sirven para reservar.
    update quotes set estado = 'anulada' where opportunity_id = o.id and estado in ('emitida', 'aceptada');
    update opportunities set etapa = 'perdida', motivo_perdida = 'Desistimiento: ' || v_texto where id = o.id;
    if u.codigo is not null then select estado::text into v_despues from inventory_units where codigo = u.codigo; end if;
  end if;

  -- El cliente solo pasa a Perdido si no le queda otra operación; con otras, conserva su seguimiento.
  v_otras := exists (select 1 from opportunities x where x.client_id = p_client and x.etapa <> 'perdida');
  if c.etapa = 'reserva' and exists (select 1 from reservations x where x.client_id = p_client and x.estado = 'confirmada') then
    v_etapa := 'reserva';
  elsif v_otras then
    v_etapa := case when c.etapa = 'reserva' then 'negociacion'::etapa_cliente else c.etapa end;
  else
    v_etapa := 'perdido';
  end if;
  if v_etapa <> c.etapa then
    perform set_config('app.flujo', 'on', true);
    update clients set etapa = v_etapa,
      motivo_perdida = case when v_etapa = 'perdido' then 'Desistimiento: ' || v_texto else '' end,
      fecha_retomar = null,
      proxima_tipo = case when v_etapa = 'perdido' then null else proxima_tipo end,
      proxima_descripcion = case when v_etapa = 'perdido' then null else proxima_descripcion end,
      proxima_fecha = case when v_etapa = 'perdido' then null else proxima_fecha end
    where id = p_client;
    perform public.clientes_nota(p_client, 'etapa', public.clientes_etiqueta(c.etapa) || ' → ' || public.clientes_etiqueta(v_etapa) || ' · desistimiento');
  end if;

  select nombre into v_nombre from profiles where id = auth.uid();
  insert into desistimientos (client_id, opportunity_id, reservation_id, codigo_unidad, motivo, observaciones, unidad_antes, unidad_despues, unidad_detalle, monto_recibido, revision_financiera, registrado_nombre)
  values (p_client, o.id, r.id, u.codigo, p_motivo, v_obs, v_antes, v_despues, v_detalle, v_recibido, case when v_pendiente then 'pendiente' else 'no_aplica' end, coalesce(v_nombre, 'Sin nombre'))
  returning id into v_id;
  perform public.clientes_nota(p_client, 'nota', 'Desistimiento: ' || v_texto || coalesce(' · ' || u.codigo, '') || case when v_obs <> '' then ' · ' || v_obs else '' end
    || case when v_detalle <> '' then ' · ' || v_detalle else '' end || case when v_pendiente then ' · pendiente de revisión de Finanzas' else '' end);
  perform public.auditar('Registrar desistimiento', 'cliente', p_client::text, 'Desistimiento: ' || v_texto,
    jsonb_build_object('etapa_cliente', c.etapa, 'etapa_negociacion', o.etapa, 'reserva', r.codigo, 'reserva_estado', r.estado, 'unidad', u.codigo, 'unidad_estado', v_antes),
    jsonb_build_object('etapa_cliente', v_etapa, 'etapa_negociacion', case when o.id is null then null else 'perdida' end, 'unidad_estado', v_despues, 'monto_recibido', v_recibido, 'observaciones', v_obs));
  return v_id;
end $$;

-- Finanzas deja constancia de la revisión. No crea ni mueve dinero: la devolución o retención se resuelve fuera, según la política comercial.
create or replace function public.desistimientos_marcar_revisado(p_id uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare d desistimientos; v_m text := public.clientes_motivo(p_nota);
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para revisar desistimientos' using errcode = '42501'; end if;
  select * into d from desistimientos where id = p_id for update;
  if not found or not public.cliente_en_alcance(d.client_id) then raise exception 'Desistimiento inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if d.revision_financiera <> 'pendiente' then raise exception 'Este desistimiento no tiene revisión pendiente'; end if;
  update desistimientos set revision_financiera = 'revisada', revision_nota = v_m, revisada_por = auth.uid(), revisada_en = now() where id = p_id;
  perform public.auditar('Revisar desistimiento', 'cliente', d.client_id::text, v_m, jsonb_build_object('revision', 'pendiente'), jsonb_build_object('revision', 'revisada'));
end $$;

/* --------------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array['public.desistimientos_previsualizar(uuid, uuid)', 'public.desistimientos_registrar(uuid, uuid, text, text)', 'public.desistimientos_marcar_revisado(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'public.reservas_destino_unidad(public.reservations, public.inventory_units)', 'public.reservas_liberar_unidad(public.reservations, public.inventory_units, text)',
    'public.desistimiento_reserva(public.opportunities)', 'public.desistimiento_recibido(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
