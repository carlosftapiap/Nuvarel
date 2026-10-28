-- AMURA · Flujo comercial conectado: oportunidades, cotizaciones versionadas, reservas en tres pasos
-- (solicitud → verificación de ingreso por Finanzas → aprobación gerencial), contratos, cuotas, pagos y saldos.
-- Ejecutar después de 20261028220000_usuarios_permisos.sql y supabase/seed_roles.sql.

alter table public.audit_log add column if not exists evidencia text;

-- Las funciones de este flujo marcan la transacción para que los disparadores permitan sus cambios.
create or replace function public.en_flujo() returns boolean language sql stable as $$
  select coalesce(current_setting('app.flujo', true), '') = 'on'
$$;

create or replace function public.auditar(p_accion text, p_entidad text, p_id text, p_motivo text, p_antes jsonb, p_despues jsonb, p_evidencia text default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues, evidencia)
  values (auth.uid(), p_accion, p_entidad, p_id, p_motivo, p_antes, p_despues, p_evidencia)
$$;

/* ------------------------------------------------------- 1. receptor de pagos */

-- Decisión pendiente: NUVAREL, JARVAL o una fiduciaria. Mientras no se defina, no se verifica ningún cobro.
create table public.payment_settings (
  id smallint primary key default 1 check (id = 1),
  receptor text check (receptor in ('NUVAREL', 'JARVAL', 'FIDUCIARIA')),
  definido_por uuid references auth.users (id),
  definido_en timestamptz
);
insert into public.payment_settings (id) values (1);
alter table public.payment_settings enable row level security;
create policy "configuracion de cobros legible" on public.payment_settings for select to authenticated using (true);

create or replace function public.cobros_receptor() returns text language sql stable security definer set search_path = public as $$
  select receptor from payment_settings where id = 1
$$;

create or replace function public.config_definir_receptor(p_receptor text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_antes text := public.cobros_receptor();
begin
  if not public.tiene_permiso('config.cobros') then raise exception 'Sin permiso para definir el receptor de pagos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_receptor not in ('NUVAREL', 'JARVAL', 'FIDUCIARIA') then raise exception 'Receptor no válido'; end if;
  update payment_settings set receptor = p_receptor, definido_por = auth.uid(), definido_en = now() where id = 1;
  perform public.auditar('Definir receptor de pagos', 'cobros', '1', trim(p_motivo), jsonb_build_object('receptor', v_antes), jsonb_build_object('receptor', p_receptor));
end $$;

/* --------------------------------------------------------------- 2. oportunidades */

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  codigo_unidad text references public.inventory_units (codigo),
  etapa text not null default 'calificacion' check (etapa in (
    'captacion', 'calificacion', 'visita', 'cotizacion', 'solicitud_reserva', 'verificacion_pago',
    'aprobacion', 'contrato', 'cobranza', 'entrega', 'posventa', 'perdida')),
  responsable_id uuid not null references auth.users (id),
  proxima_descripcion text,
  proxima_fecha date,
  motivo_perdida text,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (etapa <> 'perdida' or char_length(coalesce(motivo_perdida, '')) >= 5)
);

create table public.opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  etapa text not null,
  descripcion text not null,
  evidencia text,
  user_id uuid not null default auth.uid() references auth.users (id),
  fecha timestamptz not null default now()
);

create or replace function public.cliente_en_alcance(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clients c where c.id = p_client and (public.en_alcance(c.asesor_id) or public.en_alcance(c.created_by)))
$$;

alter table public.opportunities enable row level security;
alter table public.opportunity_events enable row level security;
create policy "ver oportunidades" on public.opportunities for select to authenticated
  using (public.tiene_permiso('clientes.ver') and (public.en_alcance(responsable_id) or public.cliente_en_alcance(client_id)));
create policy "crear oportunidades" on public.opportunities for insert to authenticated
  with check (public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(client_id) and public.en_alcance(responsable_id)
              and created_by = auth.uid() and etapa in ('captacion', 'calificacion', 'visita', 'cotizacion'));
create policy "editar oportunidades" on public.opportunities for update to authenticated
  using (public.tiene_permiso('clientes.editar') and (public.en_alcance(responsable_id) or public.cliente_en_alcance(client_id)))
  with check (public.en_alcance(responsable_id));
create policy "ver eventos" on public.opportunity_events for select to authenticated
  using (exists (select 1 from opportunities o where o.id = opportunity_id));
create policy "registrar eventos" on public.opportunity_events for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from opportunities o where o.id = opportunity_id));

-- Cambiar la etapa en el CRM no confirma nada: las etapas de reserva en adelante solo las mueve el flujo.
create or replace function public.oportunidad_proteger_etapa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa then
    if not public.en_flujo() and (new.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')
                                   or old.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')) then
      raise exception 'Esta etapa la determina el flujo de reservas, contratos y cobranzas' using errcode = '42501';
    end if;
    insert into opportunity_events (opportunity_id, etapa, descripcion, user_id)
    values (new.id, new.etapa, old.etapa || ' → ' || new.etapa, coalesce(auth.uid(), new.responsable_id));
  end if;
  if new.responsable_id is distinct from old.responsable_id then
    if not (public.tiene_permiso('clientes.asignar') and public.en_alcance(new.responsable_id)) then
      raise exception 'Sin permiso para reasignar la oportunidad' using errcode = '42501';
    end if;
    perform public.auditar('Reasignar oportunidad', 'oportunidad', new.id::text, 'Reasignación de responsable',
      jsonb_build_object('responsable_id', old.responsable_id), jsonb_build_object('responsable_id', new.responsable_id));
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger oportunidad_proteger_etapa before update on public.opportunities for each row execute function public.oportunidad_proteger_etapa();

-- Igual para la etapa "reserva" del cliente: no se asigna a mano.
create or replace function public.clients_proteger_etapa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa and (new.etapa = 'reserva' or old.etapa = 'reserva') and not public.en_flujo() then
    raise exception 'La etapa Reserva del cliente solo cambia al aprobar o anular una reserva' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger clients_proteger_etapa before update on public.clients for each row execute function public.clients_proteger_etapa();

/* --------------------------------------------------- 3. cotizaciones versionadas */

alter table public.quotes add column if not exists opportunity_id uuid references public.opportunities (id);
alter table public.quotes add column if not exists version int not null default 1;
alter table public.quotes add column if not exists estado text not null default 'emitida' check (estado in ('emitida', 'aceptada', 'reemplazada', 'anulada'));
alter table public.quotes add column if not exists descuento_autorizado_por uuid references auth.users (id);
alter table public.quotes add column if not exists aceptada_en timestamptz;
create unique index if not exists quotes_una_aceptada_por_oportunidad on public.quotes (opportunity_id) where estado = 'aceptada';

-- Versión correlativa por oportunidad y coherencia cliente/unidad.
create or replace function public.quotes_antes_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
declare o opportunities;
begin
  if new.opportunity_id is not null then
    select * into o from opportunities where id = new.opportunity_id;
    if not found then raise exception 'Oportunidad inexistente'; end if;
    if o.client_id is distinct from new.client_id then raise exception 'La cotización no corresponde al cliente de la oportunidad'; end if;
    if o.codigo_unidad is not null and o.codigo_unidad <> new.codigo then raise exception 'La cotización no corresponde a la unidad de la oportunidad'; end if;
    new.version := coalesce((select max(version) from quotes where opportunity_id = new.opportunity_id), 0) + 1;
  end if;
  new.estado := 'emitida';
  return new;
end $$;
create trigger quotes_antes_insertar before insert on public.quotes for each row execute function public.quotes_antes_insertar();

drop policy if exists "crear cotizaciones" on public.quotes;
create policy "crear cotizaciones" on public.quotes for insert to authenticated
  with check (
    created_by = auth.uid() and public.tiene_permiso('cotizaciones.crear')
    and (client_id is null or public.cliente_en_alcance(client_id))
    and (descuento_pct = 0 or (public.tiene_permiso('cotizaciones.descuento') and descuento_autorizado_por = auth.uid()))
    and exists (select 1 from public.inventory_units u where u.codigo = quotes.codigo and u.estado in ('disponible', 'por_confirmar'))
  );

-- El cliente acepta una versión; las anteriores de la misma oportunidad quedan reemplazadas.
create or replace function public.cotizaciones_aceptar(p_quote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare q quotes;
begin
  if not public.tiene_permiso('cotizaciones.crear') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into q from quotes where id = p_quote for update;
  if not found or not public.en_alcance(q.created_by) then raise exception 'Cotización inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if q.opportunity_id is null then raise exception 'La cotización debe pertenecer a una oportunidad'; end if;
  if q.estado <> 'emitida' then raise exception 'La cotización está %', q.estado; end if;
  if q.valida_hasta < (now() at time zone 'America/Guayaquil')::date then raise exception 'La cotización venció'; end if;
  perform set_config('app.flujo', 'on', true);
  update quotes set estado = 'reemplazada' where opportunity_id = q.opportunity_id and estado in ('emitida', 'aceptada') and id <> q.id;
  update quotes set estado = 'aceptada', aceptada_en = now() where id = q.id;
  perform public.auditar('Cotización aceptada', 'cotizacion', q.id::text, trim(coalesce(p_motivo, 'Aceptada por el cliente')), null,
    jsonb_build_object('numero', q.numero, 'version', q.version, 'precio_final', q.precio_final, 'descuento_pct', q.descuento_pct));
end $$;

/* ------------------------------------------------------ 4. reservas en tres pasos */

drop index if exists public.reservations_una_activa_por_unidad;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.reservations'::regclass and contype = 'c' loop
    execute format('alter table public.reservations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.reservations alter column estado drop default;
alter table public.reservations alter column estado type text using estado::text;
alter table public.reservations alter column estado set default 'solicitada';
alter table public.reservations add constraint reservations_estado_valido check (estado in ('solicitada', 'pago_verificado', 'confirmada', 'anulada', 'rechazada'));
-- Una sola reserva activa por unidad, aun con solicitudes simultáneas (lo garantiza la base de datos).
create unique index reservations_una_activa_por_unidad on public.reservations (codigo_unidad) where estado in ('solicitada', 'pago_verificado', 'confirmada');

alter table public.reservations add column if not exists opportunity_id uuid references public.opportunities (id);
alter table public.reservations add column if not exists comprobante_path text;
alter table public.reservations add column if not exists comprobante_subido_en timestamptz;
alter table public.reservations add column if not exists pago_monto numeric(14,2);
alter table public.reservations add column if not exists pago_fecha date;
alter table public.reservations add column if not exists pago_referencia text;
alter table public.reservations add column if not exists pago_receptor text;
alter table public.reservations add column if not exists pago_verificado_por uuid references auth.users (id);
alter table public.reservations add column if not exists pago_verificado_en timestamptz;
alter table public.reservations add column if not exists aprobado_por uuid references auth.users (id);
alter table public.reservations add column if not exists aprobado_en timestamptz;

create or replace function public.reservas_solicitar(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare q quotes; u inventory_units; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
begin
  if not public.tiene_permiso('reservas.solicitar') then raise exception 'Sin permiso para solicitar reservas' using errcode = '42501'; end if;
  select * into q from quotes where id = p_quote_id;
  if not found or not public.en_alcance(q.created_by) then raise exception 'Cotización inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if q.estado <> 'aceptada' then raise exception 'Solo se reserva con la cotización aceptada por el cliente'; end if;
  if q.client_id is null or q.opportunity_id is null then raise exception 'La cotización debe estar vinculada a cliente y oportunidad'; end if;
  if q.valida_hasta < (now() at time zone 'America/Guayaquil')::date then raise exception 'La cotización venció'; end if;
  select * into u from inventory_units where codigo = q.codigo for update;
  if u.estado = 'por_confirmar' then raise exception 'La unidad aún no tiene disponibilidad confirmada'; end if;
  if u.estado not in ('disponible', 'bloqueado') then raise exception 'La unidad no puede reservarse (%)', u.estado; end if;
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

-- El vendedor adjunta el comprobante: es evidencia, no confirma el pago.
create or replace function public.reservas_adjuntar_comprobante(p_id uuid, p_referencia text, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  select * into r from reservations where id = p_id for update;
  if not found or not public.tiene_permiso('reservas.solicitar') or not (public.en_alcance(r.created_by) or public.cliente_en_alcance(r.client_id)) then
    raise exception 'Reserva inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del comprobante'; end if;
  update reservations set comprobante = trim(p_referencia), comprobante_path = p_path, comprobante_subido_en = now() where id = p_id;
  perform public.auditar('Adjuntar comprobante', 'reserva', p_id::text, 'Comprobante entregado por el cliente', null,
    jsonb_build_object('referencia', trim(p_referencia)), p_path);
end $$;

-- Finanzas verifica el ingreso real (no basta el comprobante). Bloqueado hasta definir el receptor de pagos.
create or replace function public.reservas_verificar_pago(p_id uuid, p_monto numeric, p_fecha date, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; v_receptor text := public.cobros_receptor();
begin
  if not public.tiene_permiso('reservas.verificar_pago') then raise exception 'Sin permiso para verificar pagos' using errcode = '42501'; end if;
  if v_receptor is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if r.created_by = auth.uid() then raise exception 'Quien solicita la reserva no puede verificar su pago'; end if;
  if p_monto is null or p_monto + 0.005 < r.monto_reserva then raise exception 'El ingreso verificado es menor a la reserva acordada'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'Fecha de ingreso inválida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia bancaria del ingreso'; end if;
  update reservations set estado = 'pago_verificado', pago_monto = p_monto, pago_fecha = p_fecha, pago_referencia = trim(p_referencia),
    pago_receptor = v_receptor, pago_verificado_por = auth.uid(), pago_verificado_en = now(),
    comprobante = coalesce(comprobante, trim(p_referencia)), monto_recibido = p_monto
  where id = p_id;
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'verificacion_pago' where id = r.opportunity_id;
  perform public.auditar('Verificar ingreso de reserva', 'reserva', p_id::text, trim(coalesce(p_motivo, 'Ingreso verificado')),
    jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'pago_verificado', 'monto', p_monto, 'fecha', p_fecha, 'receptor', v_receptor),
    trim(p_referencia));
end $$;

-- Gerencia aprueba: comprueba disponibilidad, pago verificado y condiciones; reserva e inventario en una sola operación.
drop function if exists public.reservas_confirmar(uuid, text, numeric);
create or replace function public.reservas_aprobar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; u inventory_units; v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  if not public.tiene_permiso('reservas.confirmar') then raise exception 'Sin permiso para aprobar reservas' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'pago_verificado' then raise exception 'Solo se aprueban reservas con el ingreso verificado por Finanzas (estado actual: %)', r.estado; end if;
  if r.pago_verificado_por = auth.uid() then raise exception 'Quien verificó el pago no puede aprobar la reserva'; end if;
  if r.vigencia_hasta < v_hoy then raise exception 'La cotización venció'; end if;
  select * into q from quotes where id = r.quote_id;
  if q.estado <> 'aceptada' then raise exception 'La cotización ya no está aceptada'; end if;
  if q.descuento_pct > 0 and q.descuento_autorizado_por is null then raise exception 'El descuento no tiene autorización registrada'; end if;
  if r.precio_acordado <> q.precio_final then raise exception 'El precio de la reserva no coincide con la cotización aceptada'; end if;
  select * into u from inventory_units where codigo = r.codigo_unidad for update;
  if u.estado not in ('disponible', 'bloqueado') then raise exception 'La unidad ya no está disponible (%)', u.estado; end if;
  perform set_config('app.flujo', 'on', true);
  update inventory_units set estado = 'reservado', reserva_id = r.id, updated_at = now(), updated_by = auth.uid() where codigo = r.codigo_unidad;
  update reservations set estado = 'confirmada', aprobado_por = auth.uid(), aprobado_en = now(), fecha_confirmacion = v_hoy where id = p_id;
  update clients set etapa = 'reserva' where id = r.client_id;
  update opportunities set etapa = 'aprobacion' where id = r.opportunity_id;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), coalesce(public.current_app_role(), 'gerencia'), r.codigo_unidad, u.estado, 'reservado', 'Reserva ' || r.codigo || ' aprobada', r.id);
  perform public.auditar('Aprobar reserva', 'reserva', p_id::text, trim(p_motivo), jsonb_build_object('estado', 'pago_verificado', 'unidad', u.estado),
    jsonb_build_object('estado', 'confirmada', 'unidad', 'reservado'));
end $$;

create or replace function public.reservas_anular(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  if not public.tiene_permiso('reservas.anular') then raise exception 'Sin permiso para anular' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la anulación'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado in ('anulada', 'rechazada') then raise exception 'La reserva ya está %', r.estado; end if;
  if exists (select 1 from contracts c where c.reservation_id = p_id and c.estado <> 'anulado') then raise exception 'La reserva ya tiene contrato; anula primero el contrato'; end if;
  perform set_config('app.flujo', 'on', true);
  if r.estado = 'confirmada' then
    update inventory_units set estado = 'disponible', reserva_id = null, updated_at = now(), updated_by = auth.uid() where codigo = r.codigo_unidad;
    update clients set etapa = 'negociacion' where id = r.client_id and etapa = 'reserva';
  end if;
  update opportunities set etapa = 'cotizacion' where id = r.opportunity_id;
  update reservations set estado = 'anulada', motivo_anulacion = trim(p_motivo) where id = p_id;
  perform public.auditar('Anular reserva', 'reserva', p_id::text, trim(p_motivo), jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'anulada'));
end $$;

/* ------------------------------------------------- 5. contratos, cuotas y pagos */

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  reservation_id uuid not null unique references public.reservations (id),
  client_id uuid not null references public.clients (id),
  opportunity_id uuid references public.opportunities (id),
  codigo_unidad text not null references public.inventory_units (codigo),
  precio numeric(14,2) not null check (precio > 0),
  estado text not null default 'borrador' check (estado in ('borrador', 'firmado', 'anulado')),
  fecha_contrato date not null,
  firmado_por uuid references auth.users (id),
  firmado_en timestamptz,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  numero int not null,
  concepto text not null,
  vencimiento date,
  monto numeric(14,2) not null check (monto >= 0),
  unique (contract_id, numero)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  monto numeric(14,2) not null check (monto > 0),
  fecha date not null,
  referencia text not null,
  comprobante_path text,
  estado text not null default 'registrado' check (estado in ('registrado', 'verificado', 'rechazado')),
  receptor text,
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_en timestamptz not null default now(),
  verificado_por uuid references auth.users (id),
  verificado_en timestamptz,
  motivo text
);

alter table public.contracts enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
create policy "ver contratos" on public.contracts for select to authenticated
  using ((public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(client_id));
create policy "ver cuotas" on public.installments for select to authenticated
  using (exists (select 1 from contracts c where c.id = contract_id));
create policy "ver pagos" on public.payments for select to authenticated
  using (public.tiene_permiso('cobranzas.ver') and exists (select 1 from contracts c where c.id = contract_id));
-- Escritura solo mediante las funciones siguientes.

create or replace function public.contratos_crear(p_reservation uuid, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
  v_meses int; v_cuota numeric; v_ultima numeric; v_entrega numeric; i int;
begin
  if not public.tiene_permiso('ventas.preparar') then raise exception 'Sin permiso para preparar contratos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_reservation for update;
  if not found or r.estado <> 'confirmada' then raise exception 'Solo se genera contrato de una reserva aprobada'; end if;
  if not public.cliente_en_alcance(r.client_id) then raise exception 'Fuera de tu alcance' using errcode = '42501'; end if;
  select * into q from quotes where id = r.quote_id;
  v_meses := (q.plan ->> 'meses')::int;
  v_cuota := (q.plan ->> 'cuotaMensual')::numeric;
  v_ultima := (q.plan ->> 'ultimaCuota')::numeric;
  v_entrega := (q.plan ->> 'contraEntrega')::numeric;
  insert into contracts (codigo, reservation_id, client_id, opportunity_id, codigo_unidad, precio, fecha_contrato)
  values ('CON-' || v_anio || '-' || lpad((select count(*) + 1 from contracts where codigo like 'CON-' || v_anio || '-%')::text, 4, '0'),
          r.id, r.client_id, r.opportunity_id, r.codigo_unidad, r.precio_acordado, p_fecha)
  returning id into v_id;
  -- Calendario desde las condiciones aceptadas: reserva, cuotas mensuales y saldo contra entrega.
  insert into installments (contract_id, numero, concepto, vencimiento, monto) values (v_id, 0, 'Reserva', r.fecha_confirmacion, r.monto_reserva);
  for i in 1..v_meses loop
    insert into installments (contract_id, numero, concepto, vencimiento, monto)
    values (v_id, i, 'Cuota ' || i || ' de ' || v_meses, (p_fecha + make_interval(months => i))::date, case when i = v_meses then v_ultima else v_cuota end);
  end loop;
  insert into installments (contract_id, numero, concepto, vencimiento, monto) values (v_id, v_meses + 1, 'Saldo contra entrega', null, v_entrega);
  if abs((select sum(monto) from installments where contract_id = v_id) - r.precio_acordado) > 0.01 then
    raise exception 'El calendario no suma el precio acordado';
  end if;
  -- El ingreso de la reserva ya verificado por Finanzas se registra como primer pago.
  insert into payments (contract_id, monto, fecha, referencia, estado, receptor, registrado_por, verificado_por, verificado_en, motivo)
  values (v_id, r.pago_monto, r.pago_fecha, r.pago_referencia, 'verificado', r.pago_receptor, r.pago_verificado_por, r.pago_verificado_por, r.pago_verificado_en, 'Reserva ' || r.codigo);
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'contrato' where id = r.opportunity_id;
  perform public.auditar('Generar contrato', 'contrato', v_id::text, trim(p_motivo), null, jsonb_build_object('reserva', r.codigo, 'precio', r.precio_acordado, 'cuotas', v_meses));
  return v_id;
end $$;

create or replace function public.contratos_firmar(p_id uuid, p_motivo text, p_evidencia text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  if not public.tiene_permiso('ventas.formalizar') then raise exception 'Sin permiso para formalizar contratos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_evidencia, ''))) < 3 then raise exception 'Adjunta la evidencia del contrato firmado'; end if;
  select * into c from contracts where id = p_id for update;
  if not found or c.estado <> 'borrador' then raise exception 'El contrato no está en borrador'; end if;
  update contracts set estado = 'firmado', firmado_por = auth.uid(), firmado_en = now() where id = p_id;
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'cobranza' where id = c.opportunity_id;
  perform public.auditar('Firmar contrato', 'contrato', p_id::text, trim(coalesce(p_motivo, 'Contrato firmado')), jsonb_build_object('estado', 'borrador'), jsonb_build_object('estado', 'firmado'), p_evidencia);
end $$;

create or replace function public.cobranzas_registrar_pago(p_contract uuid, p_monto numeric, p_fecha date, p_referencia text, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts; v_id uuid;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar pagos' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if c.estado = 'anulado' then raise exception 'El contrato está anulado'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del pago'; end if;
  insert into payments (contract_id, monto, fecha, referencia, comprobante_path) values (p_contract, p_monto, p_fecha, trim(p_referencia), p_path) returning id into v_id;
  perform public.auditar('Registrar pago', 'pago', v_id::text, 'Comprobante registrado (pendiente de verificación)', null, jsonb_build_object('monto', p_monto, 'fecha', p_fecha), p_path);
  return v_id;
end $$;

create or replace function public.cobranzas_verificar_pago(p_payment uuid, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p payments; v_receptor text := public.cobros_receptor();
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para verificar ingresos' using errcode = '42501'; end if;
  if v_receptor is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into p from payments where id = p_payment for update;
  if not found or p.estado <> 'registrado' then raise exception 'El pago no está pendiente de verificación'; end if;
  if p.registrado_por = auth.uid() then raise exception 'Quien registra un pago no puede verificarlo'; end if;
  update payments set estado = case when p_aprobar then 'verificado' else 'rechazado' end, receptor = case when p_aprobar then v_receptor end,
    verificado_por = auth.uid(), verificado_en = now(), motivo = trim(p_motivo)
  where id = p_payment;
  perform public.auditar(case when p_aprobar then 'Verificar pago' else 'Rechazar pago' end, 'pago', p_payment::text, trim(p_motivo),
    jsonb_build_object('estado', 'registrado'), jsonb_build_object('estado', case when p_aprobar then 'verificado' else 'rechazado' end, 'monto', p.monto), p.referencia);
end $$;

-- Saldos calculados solo con pagos verificados; las cuotas se cubren en orden de vencimiento.
create view public.installment_status with (security_invoker = on) as
with pagado as (
  select contract_id, coalesce(sum(monto) filter (where estado = 'verificado'), 0) as verificado from payments group by contract_id
)
select i.contract_id, i.numero, i.concepto, i.vencimiento, i.monto,
  least(i.monto, greatest(0, coalesce(pg.verificado, 0) - (sum(i.monto) over (partition by i.contract_id order by i.numero) - i.monto))) as pagado,
  i.monto - least(i.monto, greatest(0, coalesce(pg.verificado, 0) - (sum(i.monto) over (partition by i.contract_id order by i.numero) - i.monto))) as pendiente
from installments i left join pagado pg on pg.contract_id = i.contract_id;

create view public.contract_balances with (security_invoker = on) as
select c.id as contract_id, c.codigo, c.client_id, c.codigo_unidad, c.precio,
  coalesce((select sum(monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) as pagado_verificado,
  coalesce((select sum(monto) from payments p where p.contract_id = c.id and p.estado = 'registrado'), 0) as pendiente_verificacion,
  c.precio - coalesce((select sum(monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) as saldo,
  coalesce((select sum(s.pendiente) from installment_status s where s.contract_id = c.id and s.vencimiento < (now() at time zone 'America/Guayaquil')::date), 0) as vencido
from contracts c;

/* --------------------------------------------------------------- permisos */

revoke all on function public.config_definir_receptor(text, text) from public, anon;
revoke all on function public.cotizaciones_aceptar(uuid, text) from public, anon;
revoke all on function public.reservas_solicitar(uuid) from public, anon;
revoke all on function public.reservas_adjuntar_comprobante(uuid, text, text) from public, anon;
revoke all on function public.reservas_verificar_pago(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.reservas_aprobar(uuid, text) from public, anon;
revoke all on function public.reservas_anular(uuid, text) from public, anon;
revoke all on function public.contratos_crear(uuid, date, text) from public, anon;
revoke all on function public.contratos_firmar(uuid, text, text) from public, anon;
revoke all on function public.cobranzas_registrar_pago(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.cobranzas_verificar_pago(uuid, boolean, text) from public, anon;
revoke all on function public.auditar(text, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.config_definir_receptor(text, text) to authenticated;
grant execute on function public.cotizaciones_aceptar(uuid, text) to authenticated;
grant execute on function public.reservas_solicitar(uuid) to authenticated;
grant execute on function public.reservas_adjuntar_comprobante(uuid, text, text) to authenticated;
grant execute on function public.reservas_verificar_pago(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.reservas_aprobar(uuid, text) to authenticated;
grant execute on function public.reservas_anular(uuid, text) to authenticated;
grant execute on function public.contratos_crear(uuid, date, text) to authenticated;
grant execute on function public.contratos_firmar(uuid, text, text) to authenticated;
grant execute on function public.cobranzas_registrar_pago(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.cobranzas_verificar_pago(uuid, boolean, text) to authenticated;
grant select on public.installment_status, public.contract_balances to authenticated;
