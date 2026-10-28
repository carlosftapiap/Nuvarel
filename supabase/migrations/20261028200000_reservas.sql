-- AMURA · Reservas: solicitud, confirmación con pago verificado y anulación.
-- Ejecutar después de 20261028180000_clientes.sql.

create type public.estado_reserva as enum ('solicitada', 'confirmada', 'anulada');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  client_id uuid not null references public.clients (id),
  codigo_unidad text not null references public.inventory_units (codigo),
  quote_id uuid not null references public.quotes (id),
  vigencia_hasta date not null,
  precio_acordado numeric(14,2) not null check (precio_acordado > 0),
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 50),
  reserva_pct numeric(5,2) not null,
  monto_reserva numeric(14,2) not null check (monto_reserva > 0),
  meses smallint not null,
  cuota_mensual numeric(14,2) not null,
  estado public.estado_reserva not null default 'solicitada',
  comprobante text,
  monto_recibido numeric(14,2),
  fecha_confirmacion date,
  motivo_anulacion text not null default '',
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (estado <> 'confirmada' or (comprobante is not null and monto_recibido >= monto_reserva)),
  check (estado <> 'anulada' or char_length(motivo_anulacion) >= 5)
);
-- Una sola reserva activa por unidad: evita que dos corredores la reserven a la vez.
create unique index reservations_una_activa_por_unidad on public.reservations (codigo_unidad) where estado <> 'anulada';

alter table public.reservations enable row level security;
-- Misma visibilidad que clientes: los corredores solo ven sus propias solicitudes.
create policy "ver reservas" on public.reservations for select to authenticated
  using (public.current_app_role() in ('administrador', 'gerencia', 'asesor') or created_by = auth.uid());
-- Sin políticas de escritura: solo las funciones siguientes modifican reservas.

create or replace function public.reservas_solicitar(p_quote_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.current_app_role();
  q public.quotes;
  u public.inventory_units;
  v_id uuid;
begin
  if v_rol is null then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into q from quotes where id = p_quote_id;
  if not found then raise exception 'Cotización inexistente'; end if;
  if q.created_by <> auth.uid() and v_rol not in ('administrador', 'gerencia') then
    raise exception 'Solo puedes solicitar reservas de tus cotizaciones' using errcode = '42501';
  end if;
  if q.client_id is null then raise exception 'La cotización no está vinculada a un cliente'; end if;
  if q.valida_hasta < (now() at time zone 'America/Guayaquil')::date then raise exception 'La cotización venció'; end if;
  select * into u from inventory_units where codigo = q.codigo for update;
  if u.estado = 'por_confirmar' then raise exception 'La unidad aún no tiene disponibilidad confirmada'; end if;
  if u.estado not in ('disponible', 'bloqueado') then raise exception 'La unidad no puede reservarse (%)', u.estado; end if;
  insert into reservations (codigo, client_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, descuento_pct, reserva_pct,
                            monto_reserva, meses, cuota_mensual, created_by)
  values (
    'RES-' || to_char(now() at time zone 'America/Guayaquil', 'YYYY') || '-' ||
      lpad((select count(*) + 1 from reservations where codigo like 'RES-' || to_char(now() at time zone 'America/Guayaquil', 'YYYY') || '-%')::text, 4, '0'),
    q.client_id, q.codigo, q.id, q.valida_hasta, q.precio_final, q.descuento_pct,
    (q.plan ->> 'reservaPct')::numeric, (q.plan ->> 'reserva')::numeric, (q.plan ->> 'meses')::smallint,
    (q.plan ->> 'cuotaMensual')::numeric, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.reservas_confirmar(p_id uuid, p_comprobante text, p_monto_recibido numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.current_app_role();
  r public.reservations;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  if v_rol not in ('administrador', 'gerencia') then raise exception 'Solo gerencia o administración confirma reservas' using errcode = '42501'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if char_length(trim(coalesce(p_comprobante, ''))) < 3 then raise exception 'Registra el comprobante de pago'; end if;
  if p_monto_recibido + 0.005 < r.monto_reserva then raise exception 'El monto recibido es menor a la reserva acordada'; end if;
  if r.vigencia_hasta < v_hoy then raise exception 'La cotización venció'; end if;
  -- Bloquea la unidad: si otra reserva confirmada ya la tiene, el índice único y este chequeo lo impiden.
  perform 1 from inventory_units where codigo = r.codigo_unidad for update;
  if exists (select 1 from reservations where codigo_unidad = r.codigo_unidad and estado = 'confirmada') then
    raise exception 'La unidad ya está reservada';
  end if;
  update inventory_units set estado = 'reservado', reserva_id = r.id, updated_at = now(), updated_by = auth.uid()
    where codigo = r.codigo_unidad;
  update reservations set estado = 'confirmada', comprobante = trim(p_comprobante), monto_recibido = p_monto_recibido,
    fecha_confirmacion = v_hoy where id = p_id;
  update clients set etapa = 'reserva' where id = r.client_id;
end $$;

create or replace function public.reservas_anular(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.current_app_role();
  r public.reservations;
begin
  if v_rol not in ('administrador', 'gerencia') then raise exception 'Sin permiso para anular' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Indica el motivo de la anulación'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado = 'anulada' then raise exception 'La reserva ya está anulada'; end if;
  if r.estado = 'confirmada' then
    update inventory_units set estado = 'disponible', reserva_id = null, updated_at = now(), updated_by = auth.uid()
      where codigo = r.codigo_unidad;
    update clients set etapa = 'negociacion' where id = r.client_id and etapa = 'reserva';
  end if;
  update reservations set estado = 'anulada', motivo_anulacion = trim(p_motivo) where id = p_id;
end $$;

revoke all on function public.reservas_solicitar(uuid) from public, anon;
revoke all on function public.reservas_confirmar(uuid, text, numeric) from public, anon;
revoke all on function public.reservas_anular(uuid, text) from public, anon;
grant execute on function public.reservas_solicitar(uuid) to authenticated;
grant execute on function public.reservas_confirmar(uuid, text, numeric) to authenticated;
grant execute on function public.reservas_anular(uuid, text) to authenticated;
