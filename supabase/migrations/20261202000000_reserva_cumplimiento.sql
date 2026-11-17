-- AMURA · Cumplimiento antes del pago de la reserva (sin ejecutar en producción).
-- Regla: Finanzas solo verifica el pago de una reserva cuando el Oficial de Cumplimiento la aprobó.
--   · No se exige contrato ni promesa para registrar el comprobante (reservas_reportar_pago no cambia).
--   · Al solicitar la reserva: estado de Cumplimiento «pendiente» y apartado de 48 horas.
--   · Observado: 48 horas más para corregir. Una sola prórroga, con permiso reservas.prorrogar (supervisor).
--   · Rechazado: la reserva queda anulada con motivo. Los comprobantes y documentos se conservan; no hay devoluciones automáticas.
--   · Revisan la documentación el Oficial de Cumplimiento y el administrador (cumplimiento.revisar, ya en la semilla).
--     Vendedores y supervisores no revisan. Quien solicita no puede revisar su propia reserva.
--   · Quien solicita o quien revisa Cumplimiento no puede verificar el pago de esa misma operación.
--   · Cambiar departamento, precio, monto o cliente después de la aprobación exige nueva revisión.
-- Agrega columnas, historial, pagador, funciones y disparadores. Reemplaza reservas_verificar_pago
-- (misma lógica de la versión vigente más Cumplimiento y pagador).
-- Única modificación de filas existentes: las solicitudes abiertas pasan a revisión de Cumplimiento con 48 horas
-- de apartado desde esta migración. Reservas confirmadas o anuladas no se tocan.

-- 1. Estado de la operación en Cumplimiento y plazo del apartado.
alter table public.reservations add column if not exists cumplimiento_estado text
  check (cumplimiento_estado in ('pendiente', 'observado', 'aprobado', 'rechazado'));
alter table public.reservations add column if not exists apartado_hasta timestamptz;
alter table public.reservations add column if not exists prorrogas smallint not null default 0 check (prorrogas between 0 and 1);
alter table public.reservations add column if not exists cumplimiento_decidido_por uuid references auth.users (id);
alter table public.reservations add column if not exists cumplimiento_decidido_en timestamptz;

-- 2. Historial de decisiones (solo se agrega; nadie lo edita ni lo borra).
create table if not exists public.reservas_cumplimiento_historial (
  id uuid primary key default gen_random_uuid(),
  reserva_id uuid not null references public.reservations (id),
  estado text not null check (estado in ('pendiente', 'observado', 'aprobado', 'rechazado', 'prorrogado', 'vencido')),
  motivo text not null default '',
  actor_id uuid references auth.users (id),
  creado_en timestamptz not null default now()
);
alter table public.reservas_cumplimiento_historial enable row level security;
revoke all on public.reservas_cumplimiento_historial from anon, authenticated;
grant select on public.reservas_cumplimiento_historial to authenticated;
drop policy if exists "reservas cumplimiento historial ver" on public.reservas_cumplimiento_historial;
create policy "reservas cumplimiento historial ver" on public.reservas_cumplimiento_historial for select to authenticated
  using (public.tiene_permiso('cumplimiento.ver')
    or exists (select 1 from public.reservations r where r.id = reserva_id and public.cliente_en_alcance(r.client_id)));

-- 2b. Pagador: quién hizo el pago. La verificación de Finanzas lo exige.
alter table public.reservations add column if not exists pagador_nombre text
  check (pagador_nombre is null or char_length(btrim(pagador_nombre)) between 3 and 120);
alter table public.reservations add column if not exists pagador_identificacion text
  check (pagador_identificacion is null or char_length(btrim(pagador_identificacion)) between 5 and 20);
alter table public.reservations add column if not exists pagador_relacion text
  check (pagador_relacion in ('titular', 'conyuge', 'familiar', 'empresa', 'tercero'));
alter table public.reservations add column if not exists pagador_referencia text
  check (pagador_referencia is null or char_length(btrim(pagador_referencia)) between 3 and 60);

-- 2c. Registrar el pagador: lo hace quien solicitó la reserva. Un cambio de pagador después de la aprobación exige nueva revisión.
create or replace function public.reservas_registrar_pagador(p_id uuid, p_nombre text, p_identificacion text, p_relacion text, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; v_cambio boolean;
begin
  if auth.uid() is null or not public.tiene_permiso('reservas.solicitar') then
    raise exception 'Sin permiso para registrar el pagador' using errcode = '42501';
  end if;
  select * into r from reservations where id = p_id for update;
  if not found or r.created_by <> auth.uid() then raise exception 'Solo quien solicitó la reserva registra el pagador'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  -- Registrar el pagador por primera vez no es un cambio. Cambiarlo después de la aprobación sí exige nueva revisión.
  v_cambio := r.pagador_nombre is not null
    and (r.pagador_nombre, r.pagador_identificacion, r.pagador_relacion) is distinct from (btrim(p_nombre), btrim(p_identificacion), p_relacion);
  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set
    pagador_nombre = btrim(p_nombre), pagador_identificacion = btrim(p_identificacion),
    pagador_relacion = p_relacion, pagador_referencia = btrim(p_referencia),
    cumplimiento_estado = case when v_cambio and cumplimiento_estado = 'aprobado' then 'pendiente' else cumplimiento_estado end,
    cumplimiento_decidido_por = case when v_cambio and cumplimiento_estado = 'aprobado' then null else cumplimiento_decidido_por end
  where id = p_id;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
  values (p_id, 'pendiente', 'Pagador registrado: ' || btrim(p_nombre) || ' (' || p_relacion || ')', auth.uid());
end $$;

-- 2d. Liberación automática de apartados vencidos. Solo si no hay comprobantes reportados ni ingresos verificados.
-- Con pagos reportados, la reserva sigue abierta y se queda en la bandeja de Cumplimiento y Finanzas.
create or replace function public.reservas_liberar_apartados_vencidos() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in
    select id from reservations x
     where x.estado = 'solicitada' and x.cumplimiento_estado in ('pendiente', 'observado') and x.apartado_hasta < now()
       and not exists (select 1 from comprobantes_pago c where c.reservation_id = x.id and c.estado = 'reportado')
       and not exists (select 1 from comprobantes_pago c where c.reservation_id = x.id and c.estado = 'confirmado')
     for update skip locked
  loop
    perform set_config('app.flujo', 'on', true);
    perform set_config('app.cumplimiento', 'on', true);
    update reservations set estado = 'anulada', motivo_anulacion = 'Apartado vencido sin aprobación de Cumplimiento y sin pagos reportados'
     where id = r.id;
    insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
    values (r.id, 'vencido', 'Liberación automática: apartado vencido sin pagos reportados', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Programación diaria si la base tiene pg_cron. Si no, la liberación se ejecuta manualmente.
do $$
begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('reservas-liberar-apartados', '15 5 * * *', 'select public.reservas_liberar_apartados_vencidos()');
  end if;
end $$;

-- 3. Permiso de prórroga (supervisor). Sin cambios en los permisos existentes.
insert into public.permissions (clave, modulo, descripcion)
values ('reservas.prorrogar', 'Reservas', 'Autorizar la única prórroga para corregir documentos observados por Cumplimiento')
on conflict (clave) do nothing;
insert into public.role_permissions (role_id, permiso)
select r, 'reservas.prorrogar' from unnest(array['administrador', 'supervisor']) r
 where exists (select 1 from public.roles where id = r)
on conflict do nothing;

-- 4. Alta de una solicitud: nace pendiente de Cumplimiento con 48 horas de apartado.
create or replace function public.reservas_cumplimiento_alta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'solicitada' then
    new.cumplimiento_estado := 'pendiente';
    new.apartado_hasta := now() + interval '48 hours';
  end if;
  return new;
end $$;

create or replace function public.reservas_cumplimiento_historial_alta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'solicitada' then
    insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
    values (new.id, 'pendiente', 'Solicitud de reserva registrada', coalesce(auth.uid(), new.created_by));
  end if;
  return null;
end $$;

drop trigger if exists reservas_cumplimiento_alta on public.reservations;
create trigger reservas_cumplimiento_alta before insert on public.reservations
  for each row execute function public.reservas_cumplimiento_alta();
drop trigger if exists reservas_cumplimiento_historial_alta on public.reservations;
create trigger reservas_cumplimiento_historial_alta after insert on public.reservations
  for each row execute function public.reservas_cumplimiento_historial_alta();

-- 5. Guardia: el estado de Cumplimiento solo cambia desde sus funciones; una operación aprobada no cambia de unidad, precio, monto ni cliente.
create or replace function public.reservas_cumplimiento_guardia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cumplimiento_estado is distinct from old.cumplimiento_estado
     and coalesce(current_setting('app.cumplimiento', true), '') <> 'on' then
    raise exception 'El estado de Cumplimiento solo lo cambia la revisión de Cumplimiento';
  end if;
  if old.cumplimiento_estado = 'aprobado'
     and (new.codigo_unidad, new.precio_acordado, new.monto_reserva, new.client_id)
         is distinct from (old.codigo_unidad, old.precio_acordado, old.monto_reserva, old.client_id) then
    raise exception 'Cambió el departamento, precio, monto o cliente después de la aprobación de Cumplimiento: se requiere una nueva revisión';
  end if;
  return new;
end $$;

drop trigger if exists reservas_cumplimiento_guardia on public.reservations;
create trigger reservas_cumplimiento_guardia before update on public.reservations
  for each row execute function public.reservas_cumplimiento_guardia();

-- 6. Decisión de Cumplimiento: aprobar, observar o rechazar. Quien solicitó no puede decidir.
create or replace function public.reservas_cumplimiento_resolver(p_id uuid, p_estado text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null or not public.tiene_permiso('cumplimiento.revisar') then
    raise exception 'Sin permiso para revisar Cumplimiento' using errcode = '42501';
  end if;
  if p_estado not in ('aprobado', 'observado', 'rechazado') then raise exception 'Decisión no válida: %', p_estado; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'Solo se revisa una reserva solicitada (estado actual: %)', r.estado; end if;
  if r.cumplimiento_estado is null then raise exception 'Esta reserva no tiene revisión de Cumplimiento (registro anterior a esta regla)'; end if;
  if r.cumplimiento_estado = 'aprobado' then raise exception 'La operación ya está aprobada por Cumplimiento'; end if;
  if r.created_by = auth.uid() then raise exception 'Quien solicita la reserva no puede revisarla'; end if;
  if p_estado <> 'aprobado' and char_length(v_motivo) < 5 then raise exception 'Indica el motivo de la observación o del rechazo'; end if;

  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set
    cumplimiento_estado = p_estado,
    cumplimiento_decidido_por = auth.uid(),
    cumplimiento_decidido_en = now(),
    apartado_hasta = case when p_estado = 'observado' then now() + interval '48 hours' else apartado_hasta end,
    estado = case when p_estado = 'rechazado' then 'anulada' else estado end,
    motivo_anulacion = case when p_estado = 'rechazado' then v_motivo else motivo_anulacion end
  where id = p_id;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id) values (p_id, p_estado, v_motivo, auth.uid());
  perform public.auditar('Revisión de Cumplimiento de reserva', 'reserva', p_id::text,
    coalesce(nullif(v_motivo, ''), 'Operación aprobada por Cumplimiento'),
    jsonb_build_object('cumplimiento', r.cumplimiento_estado), jsonb_build_object('cumplimiento', p_estado), null);
end $$;

-- 7. Corrección del cliente: vuelve a pendiente mientras el apartado siga vigente.
create or replace function public.reservas_cumplimiento_reenviar(p_id uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  if auth.uid() is null or not public.tiene_permiso('reservas.solicitar') then
    raise exception 'Sin permiso para reenviar reservas' using errcode = '42501';
  end if;
  select * into r from reservations where id = p_id for update;
  if not found or r.created_by <> auth.uid() then raise exception 'Solo quien solicitó la reserva puede reenviarla'; end if;
  if r.estado <> 'solicitada' or r.cumplimiento_estado <> 'observado' then raise exception 'La reserva no tiene documentos observados'; end if;
  if r.apartado_hasta < now() then raise exception 'El apartado venció: solicita una reserva nueva'; end if;
  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set cumplimiento_estado = 'pendiente' where id = p_id;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
  values (p_id, 'pendiente', 'Documentación corregida' || coalesce(': ' || nullif(btrim(p_nota), ''), ''), auth.uid());
end $$;

-- 8. Única prórroga para observados, con autorización del supervisor.
create or replace function public.reservas_cumplimiento_prorrogar(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if auth.uid() is null or not public.tiene_permiso('reservas.prorrogar') then
    raise exception 'Solo un supervisor puede autorizar la prórroga' using errcode = '42501';
  end if;
  if char_length(v_motivo) < 5 then raise exception 'Indica el motivo de la prórroga'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' or r.cumplimiento_estado <> 'observado' then raise exception 'Solo se prorroga una reserva con documentos observados'; end if;
  if r.prorrogas >= 1 then raise exception 'Esta reserva ya usó su única prórroga'; end if;
  if r.apartado_hasta < now() then raise exception 'El apartado ya venció'; end if;
  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set prorrogas = prorrogas + 1, apartado_hasta = apartado_hasta + interval '48 hours' where id = p_id;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id) values (p_id, 'prorrogado', v_motivo, auth.uid());
  perform public.auditar('Prórroga de corrección de reserva', 'reserva', p_id::text, v_motivo, null, null, null);
end $$;

-- 9. Apartado vencido sin aprobación: la reserva se anula y la unidad vuelve a estar libre. Lo puede pedir quien solicitó o Cumplimiento.
create or replace function public.reservas_vencer_apartado(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if auth.uid() is null or not (r.created_by = auth.uid() or public.tiene_permiso('cumplimiento.revisar')) then
    raise exception 'Sin permiso para vencer este apartado' using errcode = '42501';
  end if;
  if r.estado <> 'solicitada' or r.cumplimiento_estado not in ('pendiente', 'observado') then raise exception 'Solo vence un apartado sin aprobación de Cumplimiento'; end if;
  if r.apartado_hasta > now() then raise exception 'El apartado todavía está vigente'; end if;
  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set estado = 'anulada', motivo_anulacion = 'Apartado vencido sin aprobación de Cumplimiento' where id = p_id;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
  values (p_id, 'vencido', 'Apartado vencido sin aprobación de Cumplimiento', auth.uid());
end $$;

-- 10. Verificación del pago: exige aprobación de Cumplimiento y separación de funciones. Resto igual a la versión vigente.
create or replace function public.reservas_verificar_pago(p_id uuid, p_monto numeric, p_fecha date, p_referencia text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r reservations; u inventory_units; v_receptor text := public.cobros_receptor(); v_exc text[];
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  if not public.tiene_permiso('reservas.verificar_pago') then raise exception 'Sin permiso para verificar pagos' using errcode = '42501'; end if;
  if v_receptor is null then raise exception 'Verificación de cobros deshabilitada: falta definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'; end if;
  select * into r from reservations where id = p_id for update;
  if not found then raise exception 'Reserva inexistente'; end if;
  if r.estado <> 'solicitada' then raise exception 'La reserva ya está %', r.estado; end if;
  if r.cumplimiento_estado is distinct from 'aprobado' then
    raise exception 'Cumplimiento debe aprobar la operación antes de verificar el pago (estado: %)', coalesce(r.cumplimiento_estado, 'sin revisión');
  end if;
  if r.pagador_nombre is null or r.pagador_identificacion is null or r.pagador_relacion is null then
    raise exception 'Registra el pagador (nombre, identificación y relación con el comprador) antes de verificar el ingreso';
  end if;
  if r.created_by = auth.uid() then raise exception 'Quien solicita la reserva no puede verificar su pago'; end if;
  if r.cumplimiento_decidido_por = auth.uid() then raise exception 'Quien revisó Cumplimiento no puede verificar el pago de la misma operación'; end if;
  if r.comprobante_subido_en is null then raise exception 'Falta registrar el comprobante del cliente'; end if;
  if p_monto is null or p_monto + 0.005 < r.monto_reserva then raise exception 'El ingreso verificado es menor a la reserva acordada'; end if;
  if p_fecha is null or p_fecha > v_hoy then raise exception 'Fecha de ingreso inválida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia bancaria del ingreso'; end if;

  select * into u from inventory_units where codigo = r.codigo_unidad for update;
  v_exc := public.reservas_excepciones_de(r);
  if exists (select 1 from reservations x where x.codigo_unidad = r.codigo_unidad and x.id <> r.id and x.estado = 'confirmada') then
    v_exc := v_exc || 'La unidad ya tiene otra reserva confirmada'::text;
  end if;

  perform set_config('app.flujo', 'on', true);
  update reservations set estado = case when cardinality(v_exc) = 0 then 'confirmada' else 'pago_verificado' end,
    pago_monto = p_monto, pago_fecha = p_fecha, pago_referencia = trim(p_referencia),
    pago_receptor = v_receptor, pago_verificado_por = auth.uid(), pago_verificado_en = now(),
    comprobante = coalesce(comprobante, trim(p_referencia)), monto_recibido = p_monto,
    aprobado_en = case when cardinality(v_exc) = 0 then now() end,
    fecha_confirmacion = case when cardinality(v_exc) = 0 then v_hoy end
  where id = p_id;
  perform public.auditar('Verificar ingreso de reserva', 'reserva', p_id::text, trim(coalesce(p_motivo, 'Ingreso verificado')),
    jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'pago_verificado', 'monto', p_monto, 'fecha', p_fecha, 'receptor', v_receptor),
    trim(p_referencia));

  if cardinality(v_exc) > 0 then
    update opportunities set etapa = 'verificacion_pago' where id = r.opportunity_id;
    perform public.auditar('Reserva con excepción', 'reserva', p_id::text, 'Requiere autorización de Gerencia: ' || array_to_string(v_exc, '; '),
      null, jsonb_build_object('excepciones', to_jsonb(v_exc)));
    return;
  end if;

  update inventory_units set estado = 'reservado', reserva_id = r.id, updated_at = now(), updated_by = auth.uid() where codigo = r.codigo_unidad;
  update clients set etapa = 'reserva' where id = r.client_id;
  update opportunities set etapa = 'aprobacion' where id = r.opportunity_id;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), r.codigo_unidad, u.estado, 'reservado',
          'Reserva ' || r.codigo || ' confirmada automáticamente: pago verificado y condiciones normales', r.id);
  perform public.auditar('Confirmar reserva automáticamente', 'reserva', p_id::text,
    'Pago verificado por Finanzas; Cumplimiento aprobó la operación; unidad disponible, precio oficial, sin descuento ni condiciones especiales',
    jsonb_build_object('estado', 'pago_verificado', 'unidad', u.estado), jsonb_build_object('estado', 'confirmada', 'unidad', 'reservado'));
end $$;

-- 11. Solicitudes abiertas de antes de esta regla: pasan a revisión con 48 horas de apartado desde hoy.
do $$
declare v_flags text;
begin
  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  update reservations set cumplimiento_estado = 'pendiente', apartado_hasta = now() + interval '48 hours'
   where estado = 'solicitada' and cumplimiento_estado is null;
  insert into reservas_cumplimiento_historial (reserva_id, estado, motivo, actor_id)
  select id, 'pendiente', 'Solicitud anterior a la regla de Cumplimiento: enviada a revisión', null
    from reservations where estado = 'solicitada' and cumplimiento_estado = 'pendiente' and apartado_hasta > now() - interval '1 minute';
end $$;

revoke all on function public.reservas_cumplimiento_alta() from public, anon, authenticated;
revoke all on function public.reservas_cumplimiento_historial_alta() from public, anon, authenticated;
revoke all on function public.reservas_cumplimiento_guardia() from public, anon, authenticated;
revoke all on function public.reservas_cumplimiento_resolver(uuid, text, text) from public, anon;
revoke all on function public.reservas_cumplimiento_reenviar(uuid, text) from public, anon;
revoke all on function public.reservas_cumplimiento_prorrogar(uuid, text) from public, anon;
revoke all on function public.reservas_vencer_apartado(uuid) from public, anon;
grant execute on function public.reservas_cumplimiento_resolver(uuid, text, text) to authenticated;
grant execute on function public.reservas_cumplimiento_reenviar(uuid, text) to authenticated;
grant execute on function public.reservas_cumplimiento_prorrogar(uuid, text) to authenticated;
grant execute on function public.reservas_vencer_apartado(uuid) to authenticated;
