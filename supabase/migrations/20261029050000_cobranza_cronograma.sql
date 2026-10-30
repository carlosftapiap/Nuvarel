-- AMURA · Cobranza del 20% a favor de Nuvarel.
-- Ejecutar después de 20261029040000_administrador_inicial.sql.
-- ESTADO: probado en base local (supabase/tests/cobranza.test.ts). NO aplicado en producción hasta confirmación final.
-- Cambios:
--   · Reserva configurable (acreditada al 6%) y pago a la firma separado; el cronograma es exigible solo al firmar.
--   · Pagos anulables con auditoría, sin duplicar referencias; excedentes como saldo a favor.
--   · Estados de cuota en las vistas; gestiones, compromisos y reprogramación con historial.
--   · Tabla de alertas (cola de correos). El envío lo hace una función del servidor, no el navegador.

do $$ begin
  if to_regclass('public.installments') is null or to_regclass('public.payments') is null or to_regclass('public.contracts') is null
     or to_regprocedure('public.contratos_firmar(uuid, text, text)') is null or to_regprocedure('public.cobros_receptor()') is null then
    raise exception 'Faltan dependencias: instala primero el flujo comercial (20261029000000)';
  end if;
end $$;

/* ------------------------------------------------ 1. reserva configurable */

-- La reserva es el monto que paga el cliente al reservar. Puede ser menor al 6% y nunca mayor.
create or replace function public.reservas_fijar_monto(p_id uuid, p_monto numeric, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; v_max numeric;
begin
  if not public.tiene_permiso('reservas.solicitar') then raise exception 'Sin permiso para ajustar la reserva' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into r from reservations where id = p_id for update;
  if not found or r.estado <> 'solicitada' then raise exception 'Solo se ajusta la reserva mientras está solicitada'; end if;
  if not (public.en_alcance(r.created_by) or public.cliente_en_alcance(r.client_id)) then raise exception 'Fuera de tu alcance' using errcode = '42501'; end if;
  select * into q from quotes where id = r.quote_id;
  v_max := round(q.precio_final * 6 / 100, 2);
  if p_monto is null or p_monto <= 0 or p_monto > v_max then
    raise exception 'La reserva debe ser mayor a cero y no superar el 6%% (USD %)', v_max;
  end if;
  update reservations set monto_reserva = p_monto where id = p_id;
  perform public.auditar('Ajustar reserva', 'reserva', p_id::text, trim(p_motivo),
    jsonb_build_object('monto_reserva', r.monto_reserva), jsonb_build_object('monto_reserva', p_monto));
end $$;

/* ----------------------------------------------- 2. cronograma al firmar */

-- Cronograma: 0 reserva (acreditada), 1 pago a la firma (completa el 6%), 2..n+1 cuotas (14%), n+2 saldo contra entrega (80%).
-- Se crea en borrador, pero solo es exigible cuando el contrato está firmado (ver las vistas).
create or replace function public.contratos_crear(p_reservation uuid, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r reservations; q quotes; v_id uuid; v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
  v_meses int; v_cuota numeric; v_ultima numeric; v_entrega numeric; v_acumulado numeric; v_firma numeric; i int;
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
    values (v_id, i + 1, 'Cuota ' || i || ' de ' || v_meses, (p_fecha + make_interval(months => i))::date,
            case when i = v_meses then v_ultima else v_cuota end);
  end loop;
  insert into installments (contract_id, numero, concepto, vencimiento, monto)
  values (v_id, v_meses + 2, 'Saldo contra entrega (80%)', null, v_entrega);
  if abs((select sum(monto) from installments where contract_id = v_id) - r.precio_acordado) > 0.01 then
    raise exception 'El cronograma no suma el precio acordado';
  end if;

  -- La reserva ya verificada por Finanzas se conserva como primer pago: no se pierde al activar el cronograma.
  insert into payments (contract_id, monto, fecha, referencia, estado, receptor, registrado_por, verificado_por, verificado_en, motivo)
  values (v_id, r.pago_monto, r.pago_fecha, r.pago_referencia, 'verificado', r.pago_receptor, r.pago_verificado_por, r.pago_verificado_por, r.pago_verificado_en, 'Reserva ' || r.codigo);
  perform set_config('app.flujo', 'on', true);
  update opportunities set etapa = 'contrato' where id = r.opportunity_id;
  perform public.auditar('Generar contrato', 'contrato', v_id::text, trim(p_motivo), null,
    jsonb_build_object('reserva', r.codigo, 'precio', r.precio_acordado, 'reserva_monto', r.monto_reserva, 'pago_a_la_firma', v_firma, 'cuotas', v_meses));
  return v_id;
end $$;

/* ------------------------------------------------------ 3. pagos y anulación */

alter table public.payments drop constraint if exists payments_estado_check;
alter table public.payments add constraint payments_estado_check check (estado in ('registrado', 'verificado', 'rechazado', 'anulado'));
-- Un mismo comprobante no se registra dos veces en el mismo contrato.
create unique index if not exists payments_referencia_unica on public.payments (contract_id, upper(referencia))
  where estado in ('registrado', 'verificado');

create or replace function public.cobranzas_registrar_pago(p_contract uuid, p_monto numeric, p_fecha date, p_referencia text, p_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts; v_id uuid;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar pagos' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if c.estado = 'anulado' then raise exception 'El contrato está anulado'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Monto inválido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'Fecha de pago inválida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del pago'; end if;
  begin
    insert into payments (contract_id, monto, fecha, referencia, comprobante_path) values (p_contract, p_monto, p_fecha, trim(p_referencia), p_path)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Ya existe un pago con la referencia % en este contrato', trim(p_referencia);
  end;
  perform public.auditar('Registrar pago', 'pago', v_id::text, 'Comprobante registrado (pendiente de verificación)', null,
    jsonb_build_object('monto', p_monto, 'fecha', p_fecha), p_path);
  return v_id;
end $$;

-- Corrección: anula un pago registrado o verificado. Queda en auditoría; el pago deja de contar en los saldos.
create or replace function public.cobranzas_anular_pago(p_payment uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para anular pagos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into p from payments where id = p_payment for update;
  if not found or p.estado not in ('registrado', 'verificado') then raise exception 'Solo se anulan pagos registrados o verificados'; end if;
  update payments set estado = 'anulado', motivo = trim(p_motivo) where id = p_payment;
  perform public.auditar('Anular pago', 'pago', p_payment::text, trim(p_motivo),
    jsonb_build_object('estado', p.estado, 'monto', p.monto), jsonb_build_object('estado', 'anulado'), p.referencia);
end $$;

/* ---------------------------------------------- 4. reprogramación con historial */

alter table public.installments add column if not exists vencimiento_original date;

-- Reprograma la fecha de una cuota. No cambia montos ni pagos; conserva la fecha original para no borrar el atraso.
create or replace function public.cobranza_reprogramar_cuota(p_contract uuid, p_numero int, p_nuevo date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts; i installments;
begin
  if not public.tiene_permiso('cobranzas.verificar') then raise exception 'Sin permiso para reprogramar cuotas' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into c from contracts where id = p_contract;
  if not found or c.estado = 'anulado' then raise exception 'Contrato inexistente o anulado'; end if;
  select * into i from installments where contract_id = p_contract and numero = p_numero for update;
  if not found then raise exception 'Cuota inexistente'; end if;
  if i.vencimiento is null then raise exception 'Esta cuota no tiene fecha que reprogramar'; end if;
  if p_nuevo is null then raise exception 'Indica la nueva fecha'; end if;
  update installments set vencimiento_original = coalesce(vencimiento_original, vencimiento), vencimiento = p_nuevo where id = i.id;
  perform public.auditar('Reprogramar cuota', 'cuota', i.id::text, trim(p_motivo),
    jsonb_build_object('vencimiento', i.vencimiento), jsonb_build_object('vencimiento', p_nuevo));
end $$;

/* ------------------------------------- 5. gestiones, compromisos y alertas */

create table if not exists public.cobranza_gestiones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  numero_cuota int,
  tipo text not null check (tipo in ('llamada', 'mensaje', 'visita', 'correo', 'nota')),
  descripcion text not null check (char_length(trim(descripcion)) >= 3),
  fecha timestamptz not null default now(),
  user_id uuid not null default auth.uid() references auth.users (id)
);

create table if not exists public.cobranza_compromisos (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  numero_cuota int,
  monto numeric(14,2) not null check (monto > 0),
  fecha_compromiso date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'cumplido', 'incumplido', 'cancelado')),
  registrado_por uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  cerrado_en timestamptz
);

-- Cola de correos internos. Solo la escribe el servidor (service role); los usuarios solo leen.
create table if not exists public.cobranza_alertas (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  contract_id uuid references public.contracts (id),
  numero_cuota int,
  tipo text not null,
  destinatario text not null,
  asunto text not null,
  cuerpo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviada', 'fallida', 'cancelada')),
  intentos int not null default 0,
  proveedor_id text,
  error text,
  creada_en timestamptz not null default now(),
  enviada_en timestamptz,
  actualizada_en timestamptz not null default now()
);
create index if not exists cobranza_alertas_pendientes on public.cobranza_alertas (estado) where estado = 'pendiente';

alter table public.cobranza_gestiones enable row level security;
alter table public.cobranza_compromisos enable row level security;
alter table public.cobranza_alertas enable row level security;
drop policy if exists "ver gestiones" on public.cobranza_gestiones;
drop policy if exists "ver compromisos" on public.cobranza_compromisos;
drop policy if exists "ver alertas" on public.cobranza_alertas;
create policy "ver gestiones" on public.cobranza_gestiones for select to authenticated
  using (public.tiene_permiso('cobranzas.ver') and exists (select 1 from contracts c where c.id = contract_id and public.cliente_en_alcance(c.client_id)));
create policy "ver compromisos" on public.cobranza_compromisos for select to authenticated
  using (public.tiene_permiso('cobranzas.ver') and exists (select 1 from contracts c where c.id = contract_id and public.cliente_en_alcance(c.client_id)));
create policy "ver alertas" on public.cobranza_alertas for select to authenticated using (public.tiene_permiso('cobranzas.ver'));

create or replace function public.cobranza_registrar_gestion(p_contract uuid, p_numero int, p_tipo text, p_descripcion text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts; v_id uuid;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar gestiones' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  insert into cobranza_gestiones (contract_id, numero_cuota, tipo, descripcion) values (p_contract, p_numero, p_tipo, trim(p_descripcion))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cobranza_registrar_compromiso(p_contract uuid, p_numero int, p_monto numeric, p_fecha date, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts; v_id uuid;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso para registrar compromisos' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into c from contracts where id = p_contract;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if p_fecha is null then raise exception 'Indica la fecha del compromiso'; end if;
  insert into cobranza_compromisos (contract_id, numero_cuota, monto, fecha_compromiso) values (p_contract, p_numero, p_monto, p_fecha)
  returning id into v_id;
  perform public.auditar('Registrar compromiso de pago', 'contrato', p_contract::text, trim(p_motivo), null,
    jsonb_build_object('monto', p_monto, 'fecha', p_fecha, 'cuota', p_numero));
  return v_id;
end $$;

create or replace function public.cobranza_cerrar_compromiso(p_id uuid, p_estado text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare k cobranza_compromisos;
begin
  if not public.tiene_permiso('cobranzas.registrar') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if p_estado not in ('cumplido', 'incumplido', 'cancelado') then raise exception 'Estado no válido'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  select * into k from cobranza_compromisos where id = p_id for update;
  if not found or k.estado <> 'pendiente' then raise exception 'El compromiso no está pendiente'; end if;
  update cobranza_compromisos set estado = p_estado, cerrado_en = now() where id = p_id;
  perform public.auditar('Cerrar compromiso de pago', 'contrato', k.contract_id::text, trim(p_motivo),
    jsonb_build_object('estado', 'pendiente'), jsonb_build_object('estado', p_estado));
end $$;

/* ------------------------------------------------------- 6. vistas de saldos */

-- Estados por cuota. Solo cuenta como exigible cuando el contrato está firmado. Pagos verificados se aplican en orden de cuota.
drop view if exists public.contract_balances;
drop view if exists public.installment_status;
create view public.installment_status with (security_invoker = on) as
with pagado as (
  select contract_id, coalesce(sum(monto) filter (where estado = 'verificado'), 0) as verificado from payments group by contract_id
), asignado as (
  select i.contract_id, i.numero, i.concepto, i.vencimiento, i.vencimiento_original, i.monto, c.estado as estado_contrato,
    greatest(0, least(i.monto, coalesce(pg.verificado, 0) - (sum(i.monto) over (partition by i.contract_id order by i.numero) - i.monto))) as pagado
  from installments i join contracts c on c.id = i.contract_id left join pagado pg on pg.contract_id = i.contract_id
)
select contract_id, numero, concepto, vencimiento, vencimiento_original, monto, estado_contrato, pagado,
  round(monto - pagado, 2) as pendiente,
  (estado_contrato = 'firmado') as exigible,
  case when monto - pagado <= 0.005 then 'pagada' when pagado > 0 then 'parcial' else 'pendiente' end as situacion
from asignado;

create view public.contract_balances with (security_invoker = on) as
select c.id as contract_id, c.codigo, c.client_id, c.codigo_unidad, c.precio, c.estado as estado_contrato,
  coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) as pagado_verificado,
  coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'registrado'), 0) as pendiente_verificacion,
  round(c.precio - coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0), 2) as saldo,
  greatest(0, round(coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) - c.precio, 2)) as saldo_a_favor,
  coalesce((select sum(s.pendiente) from installment_status s where s.contract_id = c.id and s.exigible), 0) as saldo_exigible,
  coalesce((select sum(s.pendiente) from installment_status s where s.contract_id = c.id and s.exigible
            and s.vencimiento < (now() at time zone 'America/Guayaquil')::date), 0) as vencido
from contracts c;

grant select on public.installment_status, public.contract_balances to authenticated;

/* ------------------------------------------------------------- permisos */

revoke all on function public.reservas_fijar_monto(uuid, numeric, text) from public, anon;
revoke all on function public.cobranzas_anular_pago(uuid, text) from public, anon;
revoke all on function public.cobranza_reprogramar_cuota(uuid, int, date, text) from public, anon;
revoke all on function public.cobranza_registrar_gestion(uuid, int, text, text) from public, anon;
revoke all on function public.cobranza_registrar_compromiso(uuid, int, numeric, date, text) from public, anon;
revoke all on function public.cobranza_cerrar_compromiso(uuid, text, text) from public, anon;
grant execute on function public.reservas_fijar_monto(uuid, numeric, text) to authenticated;
grant execute on function public.cobranzas_anular_pago(uuid, text) to authenticated;
grant execute on function public.cobranza_reprogramar_cuota(uuid, int, date, text) to authenticated;
grant execute on function public.cobranza_registrar_gestion(uuid, int, text, text) to authenticated;
grant execute on function public.cobranza_registrar_compromiso(uuid, int, numeric, date, text) to authenticated;
grant execute on function public.cobranza_cerrar_compromiso(uuid, text, text) to authenticated;
