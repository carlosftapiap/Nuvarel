-- AMURA · Desistimiento del comprador y anulación de reservas con autorización, desde la app.
--   · Sin reserva, o reserva solicitada sin pago ni comprobante: se aplica al registrarla.
--   · Reserva aprobada sin dinero: la autoriza un supervisor o Gerencia.
--   · Con dinero o comprobante: la autoriza Gerencia y la revisa Finanzas.
--   · Contrato vigente: no se puede; primero se anula el contrato en Ventas y contratos.
-- Hasta completar las autorizaciones no cambia nada. Quien solicita no autoriza, y Gerencia y Finanzas son personas distintas.
-- Nada se borra. No genera pagos, devoluciones ni comisiones.
-- Ejecutar después de 20261031000000_clientes_crm.sql (o de su correctivo). No depende del Gantt.

do $$ begin
  if to_regclass('public.client_access') is null or to_regprocedure('public.reservas_anular(uuid, text)') is null then
    raise exception 'Falta Clientes: aplica antes 20261031000000_clientes_crm.sql o correctivo_clientes_produccion.sql';
  end if;
end $$;

/* --------------------------------------------------------------------- permisos */

insert into public.permissions (clave, modulo, descripcion) values
  ('ventas.desistimiento', 'Ventas y contratos', 'Registrar desistimientos de su alcance'),
  ('ventas.desistimiento_autorizar', 'Ventas y contratos', 'Autorizar anulación de reservas aprobadas sin dinero'),
  ('ventas.desistimiento_con_dinero', 'Ventas y contratos', 'Autorizar anulación de reservas con dinero recibido')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;
insert into public.role_permissions (role_id, permiso)
select x.rol, x.permiso from (values
  ('administrador', 'ventas.desistimiento'), ('gerencia', 'ventas.desistimiento'), ('supervisor', 'ventas.desistimiento'), ('asesor', 'ventas.desistimiento'), ('corredor', 'ventas.desistimiento'),
  ('administrador', 'ventas.desistimiento_autorizar'), ('gerencia', 'ventas.desistimiento_autorizar'), ('supervisor', 'ventas.desistimiento_autorizar'),
  ('administrador', 'ventas.desistimiento_con_dinero'), ('gerencia', 'ventas.desistimiento_con_dinero')
) as x(rol, permiso) where exists (select 1 from public.roles r where r.id = x.rol)
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
  -- directo: se aplica al registrar. supervisor_o_gerencia y gerencia_y_finanzas: esperan autorización.
  nivel text not null check (nivel in ('directo', 'supervisor_o_gerencia', 'gerencia_y_finanzas')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aplicado', 'rechazado')),
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_nombre text not null,
  registrado_en timestamptz not null default now(),
  autorizado_por uuid references auth.users (id),
  autorizado_nombre text,
  autorizado_en timestamptz,
  autorizacion_nota text,
  -- Dinero recibido o informado. Finanzas deja constancia; no se devuelve ni se mueve desde aquí.
  monto_recibido numeric(14,2),
  revision_financiera text not null default 'no_aplica' check (revision_financiera in ('no_aplica', 'pendiente', 'revisada')),
  revision_nota text,
  revisada_por uuid references auth.users (id),
  revisada_nombre text,
  revisada_en timestamptz,
  rechazado_por uuid references auth.users (id),
  rechazado_nombre text,
  rechazado_en timestamptz,
  motivo_rechazo text,
  -- Lo que le ocurrió a la unidad, tal como quedó al aplicar.
  aplicado_en timestamptz,
  unidad_antes text,
  unidad_despues text,
  unidad_detalle text not null default ''
);
-- Una sola solicitud pendiente por operación.
create unique index if not exists desistimientos_una_pendiente_oportunidad on public.desistimientos (opportunity_id) where estado = 'pendiente';
create unique index if not exists desistimientos_una_pendiente_reserva on public.desistimientos (reservation_id) where estado = 'pendiente';
alter table public.desistimientos enable row level security;
-- Sin políticas de escritura: solo las funciones siguientes.
drop policy if exists "ver desistimientos" on public.desistimientos;
create policy "ver desistimientos" on public.desistimientos for select to authenticated
  using ((public.tiene_permiso('clientes.ver') or public.tiene_permiso('reservas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(client_id));

-- Mientras se decide, la operación queda en pausa: la reserva no avanza y no se genera contrato.
-- Dos funciones separadas: PL/pgSQL valida los campos de NEW al compilar, así que cada tabla usa solo los suyos.
create or replace function public.desistimiento_en_pausa_reserva() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado is not distinct from old.estado or new.estado = 'anulada' then return new; end if;
  if exists (select 1 from desistimientos d where d.reservation_id = new.id and d.estado = 'pendiente') then
    raise exception 'Hay una solicitud de anulación pendiente: resuélvela primero';
  end if;
  return new;
end $$;
create or replace function public.desistimiento_en_pausa_contrato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from desistimientos d where d.reservation_id = new.reservation_id and d.estado = 'pendiente') then
    raise exception 'Hay una solicitud de anulación pendiente: resuélvela primero';
  end if;
  return new;
end $$;
drop trigger if exists desistimiento_en_pausa on public.reservations;
drop trigger if exists desistimiento_en_pausa_reserva on public.reservations;
create trigger desistimiento_en_pausa_reserva before update on public.reservations for each row execute function public.desistimiento_en_pausa_reserva();
drop trigger if exists desistimiento_en_pausa on public.contracts;
drop trigger if exists desistimiento_en_pausa_contrato on public.contracts;
create trigger desistimiento_en_pausa_contrato before insert on public.contracts for each row execute function public.desistimiento_en_pausa_contrato();

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

-- Anular sin pasar por autorización solo vale para una solicitud sin pago ni comprobante, que no retiene la unidad.
-- Una reserva aprobada o con dinero se anula con una solicitud autorizada.
create or replace function public.reservas_anular(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  if not public.tiene_permiso('reservas.anular') then raise exception 'Sin permiso para anular' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la anulación'; end if;
  select * into r from reservations where id = p_id for update;
  if not found or not public.cliente_en_alcance(r.client_id) then raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if r.estado in ('anulada', 'rechazada') then raise exception 'La reserva ya está %', r.estado; end if;
  if exists (select 1 from contracts c where c.reservation_id = p_id and c.estado <> 'anulado') then raise exception 'La reserva ya tiene contrato; anula primero el contrato'; end if;
  if r.estado <> 'solicitada' or r.comprobante is not null or public.desistimiento_recibido(r.id, r.opportunity_id) is not null then
    raise exception 'Esta reserva requiere autorización: registra el desistimiento para solicitar su anulación';
  end if;
  perform set_config('app.flujo', 'on', true);
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

-- La regla, en un solo lugar.
create or replace function public.desistimiento_nivel(p_estado text, p_comprobante text, p_recibido numeric) returns text
language sql immutable as $$
  select case
    when p_recibido is not null or p_comprobante is not null then 'gerencia_y_finanzas'
    when p_estado in ('confirmada', 'pago_verificado') then 'supervisor_o_gerencia'
    else 'directo' end
$$;

-- Muestra qué pasaría, sin cambiar nada, para confirmar con la información a la vista.
create or replace function public.desistimientos_previsualizar(p_client uuid, p_oportunidad uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o opportunities; r reservations; u inventory_units; v_destino estado_comercial; v_bloqueo text; v_recibido numeric;
begin
  if not public.tiene_permiso('ventas.desistimiento') then raise exception 'Sin permiso para registrar desistimientos' using errcode = '42501'; end if;
  if not public.cliente_en_alcance(p_client) then raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if p_oportunidad is null then return jsonb_build_object('reserva', null, 'bloqueo', null, 'unidad', null, 'nivel', 'directo'); end if;
  select * into o from opportunities where id = p_oportunidad and client_id = p_client;
  if not found then raise exception 'La negociación no corresponde a este cliente'; end if;
  r := public.desistimiento_reserva(o);
  if exists (select 1 from contracts k where k.estado <> 'anulado' and (k.opportunity_id = o.id or (r.id is not null and k.reservation_id = r.id))) then
    v_bloqueo := 'Tiene un contrato vigente: primero debe anularse en Ventas y contratos, con su procedimiento.';
  elsif o.etapa = 'perdida' then
    v_bloqueo := 'Esta negociación ya está cerrada.';
  elsif exists (select 1 from desistimientos d where d.opportunity_id = o.id and d.estado = 'pendiente') then
    v_bloqueo := 'Ya hay una solicitud pendiente de autorización para esta operación.';
  end if;
  select * into u from inventory_units where codigo = coalesce(r.codigo_unidad, o.codigo_unidad);
  if r.id is not null then v_destino := public.reservas_destino_unidad(r, u); end if;
  v_recibido := public.desistimiento_recibido(r.id, o.id);
  return jsonb_build_object('bloqueo', v_bloqueo, 'unidad', u.codigo, 'unidad_estado', u.estado, 'unidad_destino', v_destino,
    'reserva', r.codigo, 'reserva_estado', r.estado, 'comprobante', r.comprobante, 'monto_recibido', v_recibido,
    'nivel', public.desistimiento_nivel(r.estado, r.comprobante, v_recibido));
end $$;

-- Aplica el desistimiento ya autorizado. Interna; vuelve a comprobar todo. Si algo falla, no queda ningún cambio.
create or replace function public.desistimiento_aplicar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  d desistimientos; c clients; o opportunities; r reservations; u inventory_units;
  v_texto text; v_detalle text := ''; v_antes text; v_despues text; v_recibido numeric; v_etapa etapa_cliente; v_otras boolean;
begin
  select * into d from desistimientos where id = p_id for update;
  v_texto := public.desistimiento_motivo_texto(d.motivo);
  select * into c from clients where id = d.client_id for update;

  if d.opportunity_id is null then
    if exists (select 1 from opportunities x where x.client_id = c.id and x.etapa <> 'perdida') then raise exception 'El cliente tiene negociaciones abiertas: elige de cuál desiste'; end if;
    if c.etapa = 'perdido' then raise exception 'El cliente ya está marcado como perdido'; end if;
    if c.etapa = 'reserva' then raise exception 'El cliente tiene una reserva: elige la operación'; end if;
  else
    select * into o from opportunities where id = d.opportunity_id for update;
    if o.etapa = 'perdida' then raise exception 'Esta negociación ya está cerrada'; end if;
    select * into r from reservations where id = (public.desistimiento_reserva(o)).id for update;
    if exists (select 1 from contracts k where k.estado <> 'anulado' and (k.opportunity_id = o.id or (r.id is not null and k.reservation_id = r.id))) then
      raise exception 'Tiene un contrato vigente: primero debe anularse en Ventas y contratos';
    end if;
    if r.id is not null and o.codigo_unidad is not null and r.codigo_unidad <> o.codigo_unidad then
      raise exception 'La reserva % no corresponde a la unidad de esta negociación', r.codigo;
    end if;
    v_recibido := public.desistimiento_recibido(r.id, o.id);
    -- Si desde la solicitud llegó dinero, la autorización dada ya no alcanza.
    if d.nivel <> 'gerencia_y_finanzas' and public.desistimiento_nivel(r.estado, r.comprobante, v_recibido) = 'gerencia_y_finanzas' then
      raise exception 'La operación recibió dinero después de la solicitud: recházala y registra una nueva';
    end if;
    if coalesce(r.codigo_unidad, o.codigo_unidad) is not null then
      select * into u from inventory_units where codigo = coalesce(r.codigo_unidad, o.codigo_unidad) for update;
      v_antes := u.estado::text;
    end if;

    perform set_config('app.flujo', 'on', true);
    -- Primero se cierra la solicitud: el disparador de pausa deja anular, no avanzar.
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
  v_otras := exists (select 1 from opportunities x where x.client_id = c.id and x.etapa <> 'perdida');
  if c.etapa = 'reserva' and exists (select 1 from reservations x where x.client_id = c.id and x.estado = 'confirmada') then
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
    where id = c.id;
    perform public.clientes_nota(c.id, 'etapa', public.clientes_etiqueta(c.etapa) || ' → ' || public.clientes_etiqueta(v_etapa) || ' · desistimiento');
  end if;

  update desistimientos set estado = 'aplicado', aplicado_en = now(), reservation_id = coalesce(reservation_id, r.id), unidad_antes = v_antes, unidad_despues = v_despues, unidad_detalle = v_detalle where id = p_id;
  perform public.clientes_nota(c.id, 'nota', 'Desistimiento aplicado: ' || v_texto || coalesce(' · ' || u.codigo, '') || case when v_detalle <> '' then ' · ' || v_detalle else '' end);
  perform public.auditar('Aplicar desistimiento', 'cliente', c.id::text, 'Desistimiento: ' || v_texto,
    jsonb_build_object('etapa_cliente', c.etapa, 'etapa_negociacion', o.etapa, 'reserva', r.codigo, 'reserva_estado', r.estado, 'unidad', u.codigo, 'unidad_estado', v_antes),
    jsonb_build_object('etapa_cliente', v_etapa, 'etapa_negociacion', case when o.id is null then null else 'perdida' end, 'unidad_estado', v_despues, 'monto_recibido', d.monto_recibido, 'observaciones', d.observaciones));
end $$;

-- Registra el desistimiento. Si no necesita autorización se aplica en el acto; si la necesita, no cambia nada hasta completarla.
create or replace function public.desistimientos_registrar(p_client uuid, p_oportunidad uuid, p_motivo text, p_observaciones text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c clients; o opportunities; r reservations; v_id uuid; v_nivel text; v_recibido numeric; v_nombre text;
  v_obs text := trim(coalesce(p_observaciones, '')); v_texto text;
begin
  if not public.tiene_permiso('ventas.desistimiento') then raise exception 'Sin permiso para registrar desistimientos' using errcode = '42501'; end if;
  v_texto := public.desistimiento_motivo_texto(p_motivo);
  if v_texto is null then raise exception 'Elige el motivo del desistimiento'; end if;
  if p_motivo = 'otro' and char_length(v_obs) < 5 then raise exception 'Con "Otro motivo", explica en las observaciones qué ocurrió'; end if;

  select * into c from clients where id = p_client for update;
  if not found or not public.cliente_en_alcance(p_client) then raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501'; end if;

  if p_oportunidad is null then
    if exists (select 1 from opportunities x where x.client_id = p_client and x.etapa <> 'perdida') then raise exception 'El cliente tiene negociaciones abiertas: elige de cuál desiste'; end if;
    if c.etapa = 'perdido' then raise exception 'El cliente ya está marcado como perdido'; end if;
    if c.etapa = 'reserva' then raise exception 'El cliente tiene una reserva: elige la operación'; end if;
    v_nivel := 'directo';
  else
    select * into o from opportunities where id = p_oportunidad and client_id = p_client for update;
    if not found then raise exception 'La negociación no corresponde a este cliente'; end if;
    if o.etapa = 'perdida' then raise exception 'Esta negociación ya está cerrada'; end if;
    if exists (select 1 from desistimientos d where d.opportunity_id = o.id and d.estado = 'pendiente') then raise exception 'Ya hay una solicitud pendiente de autorización para esta operación'; end if;
    select * into r from reservations where id = (public.desistimiento_reserva(o)).id for update;
    if exists (select 1 from contracts k where k.estado <> 'anulado' and (k.opportunity_id = o.id or (r.id is not null and k.reservation_id = r.id))) then
      raise exception 'Tiene un contrato vigente: primero debe anularse en Ventas y contratos';
    end if;
    if r.id is not null and o.codigo_unidad is not null and r.codigo_unidad <> o.codigo_unidad then
      raise exception 'La reserva % no corresponde a la unidad de esta negociación', r.codigo;
    end if;
    v_recibido := public.desistimiento_recibido(r.id, o.id);
    v_nivel := public.desistimiento_nivel(r.estado, r.comprobante, v_recibido);
  end if;

  select nombre into v_nombre from profiles where id = auth.uid();
  insert into desistimientos (client_id, opportunity_id, reservation_id, codigo_unidad, motivo, observaciones, nivel, monto_recibido, revision_financiera, registrado_nombre)
  values (p_client, o.id, r.id, coalesce(r.codigo_unidad, o.codigo_unidad), p_motivo, v_obs, v_nivel, v_recibido,
          case when v_nivel = 'gerencia_y_finanzas' then 'pendiente' else 'no_aplica' end, coalesce(v_nombre, 'Sin nombre'))
  returning id into v_id;
  perform public.clientes_nota(p_client, 'nota', case when v_nivel = 'directo' then 'Desistimiento registrado: ' else 'Solicitud de anulación por desistimiento: ' end || v_texto
    || coalesce(' · ' || coalesce(r.codigo_unidad, o.codigo_unidad), '') || case when v_obs <> '' then ' · ' || v_obs else '' end);
  perform public.auditar('Registrar desistimiento', 'cliente', p_client::text, 'Desistimiento: ' || v_texto, null,
    jsonb_build_object('nivel', v_nivel, 'reserva', r.codigo, 'monto_recibido', v_recibido, 'observaciones', v_obs));
  if r.id is not null then
    perform public.auditar('Registrar desistimiento', 'reserva', r.id::text, 'Desistimiento: ' || v_texto, null, jsonb_build_object('nivel', v_nivel));
  end if;
  if v_nivel = 'directo' then perform public.desistimiento_aplicar(v_id); end if;
  return v_id;
end $$;

-- Toma la solicitud pendiente, con el cliente bloqueado primero, y comprueba alcance.
create or replace function public.desistimiento_tomar(p_id uuid) returns public.desistimientos
language plpgsql security definer set search_path = public as $$
declare d desistimientos; v_cliente uuid;
begin
  select client_id into v_cliente from desistimientos where id = p_id;
  if not found or not public.cliente_en_alcance(v_cliente) then raise exception 'Solicitud inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  perform 1 from clients where id = v_cliente for update;
  select * into d from desistimientos where id = p_id for update;
  if d.estado <> 'pendiente' then raise exception 'Esta solicitud ya está %', d.estado; end if;
  if d.registrado_por = auth.uid() then raise exception 'Quien registra la solicitud no puede autorizarla ni rechazarla' using errcode = '42501'; end if;
  return d;
end $$;

-- Quien puede decidir según el nivel: supervisor o Gerencia sin dinero; Gerencia con dinero.
create or replace function public.desistimiento_puede_decidir(p_nivel text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_nivel when 'gerencia_y_finanzas' then public.tiene_permiso('ventas.desistimiento_con_dinero')
    when 'supervisor_o_gerencia' then public.tiene_permiso('ventas.desistimiento_autorizar') else false end
$$;

-- Autoriza. Si no falta nada más, se aplica en la misma transacción. Devuelve el estado resultante.
create or replace function public.desistimientos_autorizar(p_id uuid, p_nota text) returns text
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_nota); d desistimientos := public.desistimiento_tomar(p_id); v_nombre text;
begin
  if not public.desistimiento_puede_decidir(d.nivel) then
    raise exception 'Sin permiso para autorizar esta anulación: %', case when d.nivel = 'gerencia_y_finanzas' then 'con dinero recibido la autoriza Gerencia' else 'la autoriza un supervisor o Gerencia' end using errcode = '42501';
  end if;
  if d.autorizado_por is not null then raise exception 'Esta solicitud ya está autorizada'; end if;
  if d.revisada_por = auth.uid() then raise exception 'Quien hizo la revisión de Finanzas no puede autorizarla' using errcode = '42501'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update desistimientos set autorizado_por = auth.uid(), autorizado_nombre = v_nombre, autorizado_en = now(), autorizacion_nota = v_m where id = p_id;
  perform public.clientes_nota(d.client_id, 'nota', 'Anulación autorizada por ' || coalesce(v_nombre, 'Sin nombre') || ' · ' || v_m);
  perform public.auditar('Autorizar anulación por desistimiento', 'cliente', d.client_id::text, v_m, jsonb_build_object('estado', 'pendiente'), jsonb_build_object('nivel', d.nivel));
  if d.nivel = 'gerencia_y_finanzas' and d.revisada_por is null then return 'pendiente'; end if;
  perform public.desistimiento_aplicar(p_id);
  return 'aplicado';
end $$;

-- Finanzas deja constancia de cómo se resuelve el dinero. No crea ni mueve pagos; la devolución o retención se gestiona según la política comercial.
create or replace function public.desistimientos_revisar_finanzas(p_id uuid, p_nota text) returns text
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_nota); d desistimientos; v_nombre text;
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para revisar desistimientos' using errcode = '42501'; end if;
  d := public.desistimiento_tomar(p_id);
  if d.nivel <> 'gerencia_y_finanzas' then raise exception 'Esta solicitud no requiere revisión de Finanzas'; end if;
  if d.revisada_por is not null then raise exception 'Esta solicitud ya tiene la revisión de Finanzas'; end if;
  if d.autorizado_por = auth.uid() then raise exception 'Quien autorizó no puede hacer también la revisión de Finanzas' using errcode = '42501'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update desistimientos set revision_financiera = 'revisada', revision_nota = v_m, revisada_por = auth.uid(), revisada_nombre = v_nombre, revisada_en = now() where id = p_id;
  perform public.clientes_nota(d.client_id, 'nota', 'Revisión de Finanzas por ' || coalesce(v_nombre, 'Sin nombre') || ' · ' || v_m);
  perform public.auditar('Revisar desistimiento', 'cliente', d.client_id::text, v_m, jsonb_build_object('revision', 'pendiente'), jsonb_build_object('revision', 'revisada', 'monto_recibido', d.monto_recibido));
  if d.autorizado_por is null then return 'pendiente'; end if;
  perform public.desistimiento_aplicar(p_id);
  return 'aplicado';
end $$;

-- Rechaza: la reserva y la unidad siguen como estaban. La operación continúa.
create or replace function public.desistimientos_rechazar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); d desistimientos := public.desistimiento_tomar(p_id); v_nombre text;
begin
  if not public.desistimiento_puede_decidir(d.nivel) then raise exception 'Sin permiso para rechazar esta solicitud' using errcode = '42501'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update desistimientos set estado = 'rechazado', rechazado_por = auth.uid(), rechazado_nombre = v_nombre, rechazado_en = now(), motivo_rechazo = v_m,
    revision_financiera = case when revision_financiera = 'pendiente' then 'no_aplica' else revision_financiera end where id = p_id;
  perform public.clientes_nota(d.client_id, 'nota', 'Solicitud de anulación rechazada por ' || coalesce(v_nombre, 'Sin nombre') || ' · ' || v_m);
  perform public.auditar('Rechazar anulación por desistimiento', 'cliente', d.client_id::text, v_m, jsonb_build_object('estado', 'pendiente'), jsonb_build_object('estado', 'rechazado'));
end $$;

/* ------------------------------------------------------------ permisos de funciones */

do $$
declare fn text;
begin
  foreach fn in array array['public.desistimientos_previsualizar(uuid, uuid)', 'public.desistimientos_registrar(uuid, uuid, text, text)', 'public.desistimientos_autorizar(uuid, text)',
    'public.desistimientos_revisar_finanzas(uuid, text)', 'public.desistimientos_rechazar(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'public.reservas_destino_unidad(public.reservations, public.inventory_units)', 'public.reservas_liberar_unidad(public.reservations, public.inventory_units, text)',
    'public.desistimiento_reserva(public.opportunities)', 'public.desistimiento_recibido(uuid, uuid)', 'public.desistimiento_aplicar(uuid)',
    'public.desistimiento_tomar(uuid)', 'public.desistimiento_puede_decidir(text)', 'public.desistimiento_en_pausa_reserva()', 'public.desistimiento_en_pausa_contrato()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
