-- AMURA · SQL de producción 0004. Copia exacta de supabase/migrations/20261116000000_notificaciones.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Notificaciones internas por evento (fase 5 del plan de brechas, decisión 5).
--   · Usa la cola existente (cobranza_alertas): misma entrega con reintentos, clave única contra duplicados y modo prueba (CORREO_PRUEBA_DESTINO).
--   · Cada aviso guarda el evento, el registro (entidad e id), el enlace relativo y la persona destinataria. El enlace absoluto lo arma la función
--     de envío con APP_ORIGIN ({{APP}} en el cuerpo), así no depende del dominio definitivo.
--   · Los avisos se encolan en la misma transacción del hecho, con disparadores. Si encolar falla, el hecho se guarda igual (queda un aviso en el registro).
--   · Destinatarios: usuarios activos cuyo rol tiene el permiso de la acción; si no hay, administración. Nunca el comprador ni corredores externos.
--   · Recordatorios diarios (notificaciones_recordatorios) para lo que sigue esperando: una vez por estado, sin repetir.
-- No envía nada por sí sola: el envío sigue en la función cobranza-diaria, con su modo prueba.
-- Revertir: borrar los disparadores notif_* y sus funciones, notif_destinatarios, notif_encolar, notificaciones_recordatorios,
--   restaurar la política "ver alertas" de 20261029050000_cobranza_cronograma.sql y quitar las columnas nuevas de cobranza_alertas.
-- Ejecutar después de 20261114000000_cumplimiento.sql y con un respaldo verificado.

do $$
begin
  if to_regclass('public.cobranza_alertas') is null or to_regclass('public.cumplimiento_revisiones') is null or to_regclass('public.aplicaciones_excedente') is null then
    raise exception 'Faltan dependencias: instala antes Cobranzas, pagos anticipados y Cumplimiento';
  end if;
end $$;

alter table public.cobranza_alertas add column if not exists evento text;
alter table public.cobranza_alertas add column if not exists entidad text;
alter table public.cobranza_alertas add column if not exists entidad_id text;
alter table public.cobranza_alertas add column if not exists enlace text;
alter table public.cobranza_alertas add column if not exists destinatario_usuario uuid references auth.users (id);
create index if not exists cobranza_alertas_evento on public.cobranza_alertas (evento, creada_en desc) where evento is not null;

-- Los avisos de cobranza (sin evento) los sigue viendo Cobranzas. Los de evento: auditoría o la persona destinataria.
drop policy if exists "ver alertas" on public.cobranza_alertas;
create policy "ver alertas" on public.cobranza_alertas for select to authenticated
  using ((evento is null and public.tiene_permiso('cobranzas.ver')) or public.tiene_permiso('config.auditoria') or destinatario_usuario = auth.uid());

/* --------------------------------------------------------------- base */

create or replace function public.notif_destinatarios(p_permiso text, p_excluir uuid) returns table (usuario uuid, email text)
language sql stable security definer set search_path = public as $$
  -- Quien hizo la acción no se avisa a sí mismo. Administración recibe solo si ningún otro rol tiene el permiso.
  with con_permiso as (
    select p.id, lower(btrim(p.email)) as email from profiles p join role_permissions rp on rp.role_id = p.rol_id and rp.permiso = p_permiso
     where p.estado = 'activo' and p.rol_id <> 'administrador' and coalesce(btrim(p.email), '') <> ''
  )
  select id, email from con_permiso where id is distinct from p_excluir
  union all
  select p.id, lower(btrim(p.email)) from profiles p
   where not exists (select 1 from con_permiso) and p.estado = 'activo' and p.rol_id = 'administrador' and coalesce(btrim(p.email), '') <> '' and p.id is distinct from p_excluir
$$;

create or replace function public.notif_texto(p text) returns text
language sql immutable as $$ select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

-- Cuerpo uniforme: título, datos, enlace al registro y aviso de que es un correo automático.
create or replace function public.notif_cuerpo(p_titulo text, p_filas jsonb, p_enlace text) returns text
language sql immutable set search_path = public as $$
  select '<h2>' || public.notif_texto(p_titulo) || '</h2><table>'
    || coalesce((select string_agg('<tr><td><b>' || public.notif_texto(f ->> 0) || '</b></td><td>' || public.notif_texto(f ->> 1) || '</td></tr>', '' order by o)
                 from jsonb_array_elements(p_filas) with ordinality x(f, o)), '')
    || '</table><p><a href="{{APP}}' || public.notif_texto(p_enlace) || '">Abrir el registro en AMURA</a></p>'
    || '<p style="color:#666">Aviso automático de AMURA. Requiere iniciar sesión.</p>'
$$;

-- Un aviso por destinatario. La clave única (evento, registro, momento, correo) evita duplicados aunque el hecho se repita.
create or replace function public.notif_encolar(p_evento text, p_entidad text, p_entidad_id text, p_momento text, p_permiso text, p_extra uuid[],
  p_asunto text, p_titulo text, p_filas jsonb, p_enlace text, p_contract uuid) returns int
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0; v_cuerpo text := public.notif_cuerpo(p_titulo, p_filas, p_enlace);
begin
  for d in
    select usuario, email from public.notif_destinatarios(p_permiso, auth.uid()) where p_permiso is not null
    union
    select p.id, lower(btrim(p.email)) from profiles p where p.id = any (coalesce(p_extra, '{}')) and p.estado = 'activo' and coalesce(btrim(p.email), '') <> '' and p.id is distinct from auth.uid()
  loop
    insert into cobranza_alertas (dedupe_key, contract_id, tipo, evento, entidad, entidad_id, enlace, destinatario, destinatario_usuario, asunto, cuerpo)
    values (p_evento || ':' || p_entidad_id || ':' || coalesce(p_momento, '') || '|' || d.email, p_contract, p_evento, p_evento, p_entidad, p_entidad_id, p_enlace,
            d.email, d.usuario, '[AMURA] ' || p_asunto, v_cuerpo)
    on conflict (dedupe_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Las acciones críticas (anulaciones y dinero aplicado) también se informan a administración.
create or replace function public.notif_administradores() returns uuid[]
language sql stable security definer set search_path = public as $$ select coalesce(array_agg(id), '{}') from profiles where rol_id = 'administrador' and estado = 'activo' $$;

-- Ningún aviso detiene el hecho que lo origina.
create or replace function public.notif_seguro(p_evento text, p_entidad text, p_entidad_id text, p_momento text, p_permiso text, p_extra uuid[],
  p_asunto text, p_titulo text, p_filas jsonb, p_enlace text, p_contract uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.notif_encolar(p_evento, p_entidad, p_entidad_id, p_momento, p_permiso, p_extra, p_asunto, p_titulo, p_filas, p_enlace, p_contract);
exception when others then
  raise warning 'No se pudo encolar el aviso % de %: %', p_evento, p_entidad_id, sqlerrm;
end $$;

create or replace function public.notif_datos_contrato(p_contract uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_array(jsonb_build_array('Contrato', c.codigo), jsonb_build_array('Cliente', cl.nombre), jsonb_build_array('Unidad', c.codigo_unidad))
    from contracts c join clients cl on cl.id = c.client_id where c.id = p_contract
$$;

/* ---------------------------------------------------------- disparadores */

-- Reserva con pago verificado: queda por aprobar.
create or replace function public.notif_reservas() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cliente text;
begin
  if new.estado = 'pago_verificado' and old.estado is distinct from 'pago_verificado' then
    select nombre into v_cliente from clients where id = new.client_id;
    perform public.notif_seguro('reserva_por_aprobar', 'reserva', new.id::text, 'pago_verificado', 'reservas.confirmar', null,
      'Reserva por aprobar · ' || new.codigo_unidad, 'Reserva pendiente de aprobación',
      jsonb_build_array(jsonb_build_array('Reserva', new.codigo), jsonb_build_array('Cliente', v_cliente), jsonb_build_array('Unidad', new.codigo_unidad)),
      '/reservas', null);
  end if;
  return new;
end $$;
drop trigger if exists notif_reservas on public.reservations;
create trigger notif_reservas after update of estado on public.reservations for each row execute function public.notif_reservas();

-- Comprobante registrado: Finanzas debe verificarlo.
create or replace function public.notif_comprobantes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_contract uuid; v_unidad text; v_cliente text;
begin
  if new.reservation_id is not null then
    select r.codigo_unidad, cl.nombre into v_unidad, v_cliente from reservations r join clients cl on cl.id = r.client_id where r.id = new.reservation_id;
    perform public.notif_seguro('pago_por_verificar', 'comprobante', new.id::text, 'reportado', 'reservas.verificar_pago', null,
      'Pago por verificar · ' || coalesce(v_unidad, ''), 'Comprobante de reserva por verificar',
      jsonb_build_array(jsonb_build_array('Cliente', v_cliente), jsonb_build_array('Unidad', v_unidad), jsonb_build_array('Referencia', new.referencia), jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00'))),
      '/cobranzas', null);
  else
    select p.contract_id into v_contract from payments p where p.id = new.payment_id;
    select c.codigo_unidad, cl.nombre into v_unidad, v_cliente from contracts c join clients cl on cl.id = c.client_id where c.id = v_contract;
    perform public.notif_seguro('pago_por_verificar', 'comprobante', new.id::text, 'reportado', 'cobranzas.verificar', null,
      'Pago por verificar · ' || coalesce(v_unidad, ''), 'Comprobante de pago por verificar',
      jsonb_build_array(jsonb_build_array('Cliente', v_cliente), jsonb_build_array('Unidad', v_unidad), jsonb_build_array('Referencia', new.referencia), jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00'))),
      '/cobranzas?contrato=' || v_contract, v_contract);
  end if;
  return new;
end $$;
drop trigger if exists notif_comprobantes on public.comprobantes_pago;
create trigger notif_comprobantes after insert on public.comprobantes_pago for each row execute function public.notif_comprobantes();

-- Contrato nuevo: Legal arma el expediente. Contrato anulado: acción crítica para Finanzas.
create or replace function public.notif_contratos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.estado = 'borrador' then
    perform public.notif_seguro('contrato_por_documentar', 'contrato', new.id::text, 'borrador', 'ventas.preparar', null,
      'Contrato por documentar · ' || new.codigo, 'Contrato pendiente de documentación y revisión de Cumplimiento',
      public.notif_datos_contrato(new.id), '/ventas?contrato=' || new.id, new.id);
  elsif tg_op = 'UPDATE' and new.estado = 'anulado' and old.estado is distinct from 'anulado' then
    perform public.notif_seguro('contrato_anulado', 'contrato', new.id::text, 'anulado', 'cobranzas.verificar', public.notif_administradores(),
      'Contrato anulado · ' || new.codigo, 'Contrato anulado: revisar dinero recibido y cobranzas',
      public.notif_datos_contrato(new.id), '/cobranzas?contrato=' || new.id, new.id);
  end if;
  return new;
end $$;
drop trigger if exists notif_contratos on public.contracts;
create trigger notif_contratos after insert or update of estado on public.contracts for each row execute function public.notif_contratos();

-- Revisión de Cumplimiento: pendiente → Oficial; resultado → quien envió y Legal; aprobado → quien registra la firma.
create or replace function public.notif_cumplimiento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_envio uuid; v_codigo text; v_filas jsonb := public.notif_datos_contrato(new.contract_id); v_enlace text := '/ventas?contrato=' || new.contract_id;
begin
  select codigo into v_codigo from contracts where id = new.contract_id;
  if new.observaciones is not null then v_filas := v_filas || jsonb_build_array(jsonb_build_array('Observaciones', new.observaciones)); end if;
  if new.estado = 'pendiente' then
    perform public.notif_seguro('expediente_por_revisar', 'contrato', new.contract_id::text, new.id::text, 'cumplimiento.revisar', null,
      'Expediente por revisar · ' || v_codigo, 'Expediente enviado a revisión de Cumplimiento', v_filas, v_enlace, new.contract_id);
  else
    select registrado_por into v_envio from cumplimiento_revisiones where contract_id = new.contract_id and estado = 'pendiente' order by registrado_en desc limit 1;
    perform public.notif_seguro('expediente_' || new.estado, 'contrato', new.contract_id::text, new.id::text, 'ventas.preparar', array[v_envio],
      'Expediente ' || new.estado || ' · ' || v_codigo, 'Cumplimiento: expediente ' || new.estado, v_filas, v_enlace, new.contract_id);
    if new.estado = 'aprobado' then
      perform public.notif_seguro('contrato_por_firmar', 'contrato', new.contract_id::text, new.id::text, 'ventas.formalizar', null,
        'Contrato listo para firma · ' || v_codigo, 'Cumplimiento aprobó el expediente: el contrato puede firmarse', v_filas, v_enlace, new.contract_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists notif_cumplimiento on public.cumplimiento_revisiones;
create trigger notif_cumplimiento after insert on public.cumplimiento_revisiones for each row execute function public.notif_cumplimiento();

-- Pago anulado y excedente aplicado: acciones que Finanzas debe conocer.
create or replace function public.notif_pagos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'anulado' and old.estado is distinct from 'anulado' then
    perform public.notif_seguro('pago_anulado', 'pago', new.id::text, 'anulado', 'cobranzas.verificar', public.notif_administradores(),
      'Pago anulado · ref. ' || new.referencia, 'Pago anulado', public.notif_datos_contrato(new.contract_id)
        || jsonb_build_array(jsonb_build_array('Referencia', new.referencia), jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00'))),
      '/cobranzas?contrato=' || new.contract_id, new.contract_id);
  end if;
  return new;
end $$;
drop trigger if exists notif_pagos on public.payments;
create trigger notif_pagos after update of estado on public.payments for each row execute function public.notif_pagos();

create or replace function public.notif_excedentes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notif_seguro('excedente_aplicado', 'aplicacion', new.id::text, 'autorizada', 'cobranzas.verificar', public.notif_administradores(),
      'Excedente aplicado al 80 %', 'Saldo a favor aplicado al saldo contra entrega',
      public.notif_datos_contrato(new.contract_id) || jsonb_build_array(jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00')), jsonb_build_array('Motivo', new.motivo)),
      '/cobranzas?contrato=' || new.contract_id, new.contract_id);
  elsif new.anulado_en is not null and old.anulado_en is null then
    perform public.notif_seguro('excedente_anulado', 'aplicacion', new.id::text, 'anulada', 'cobranzas.verificar', public.notif_administradores(),
      'Aplicación de excedente anulada', 'Se anuló una aplicación de saldo a favor',
      public.notif_datos_contrato(new.contract_id) || jsonb_build_array(jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00')), jsonb_build_array('Motivo', new.motivo_anulacion)),
      '/cobranzas?contrato=' || new.contract_id, new.contract_id);
  end if;
  return new;
end $$;
drop trigger if exists notif_excedentes on public.aplicaciones_excedente;
create trigger notif_excedentes after insert or update of anulado_en on public.aplicaciones_excedente for each row execute function public.notif_excedentes();

-- Devolución o retención de una reserva anulada: requiere autorización.
create or replace function public.notif_movimientos() returns trigger
language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  if new.estado = 'solicitado' then
    select * into r from reservations where id = new.reservation_id;
    perform public.notif_seguro('movimiento_por_autorizar', 'movimiento', new.id::text, 'solicitado', 'ventas.desistimiento_con_dinero', null,
      initcap(new.tipo) || ' por autorizar · ' || coalesce(r.codigo_unidad, ''), 'Movimiento de dinero de una reserva anulada por autorizar',
      jsonb_build_array(jsonb_build_array('Reserva', r.codigo), jsonb_build_array('Tipo', new.tipo), jsonb_build_array('Monto', 'USD ' || to_char(new.monto, 'FM999G999G990D00')), jsonb_build_array('Motivo', new.motivo)),
      '/cobranzas', null);
  end if;
  return new;
end $$;
drop trigger if exists notif_movimientos on public.reserva_movimientos;
create trigger notif_movimientos after insert on public.reserva_movimientos for each row execute function public.notif_movimientos();

/* -------------------------------------------------- recordatorios diarios */

-- Lo que sigue esperando: un recordatorio por registro y estado, sin repetir. La llama cobranza-diaria con la clave de servicio.
create or replace function public.notificaciones_recordatorios(p_hoy date) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; x record;
begin
  for x in select r.* from reservations r where r.estado = 'pago_verificado' and r.pago_verificado_en < p_hoy - 2 loop
    n := n + public.notif_encolar('recordatorio_reserva_por_aprobar', 'reserva', x.id::text, 'pago_verificado', 'reservas.confirmar', null,
      'Recordatorio: reserva por aprobar · ' || x.codigo_unidad, 'Reserva con pago verificado hace más de 2 días, aún sin aprobar',
      jsonb_build_array(jsonb_build_array('Reserva', x.codigo), jsonb_build_array('Unidad', x.codigo_unidad)), '/reservas', null);
  end loop;
  for x in select c.* from contracts c where c.estado = 'borrador' and public.cumplimiento_estado(c.id) is null and c.created_at < p_hoy - 3 loop
    n := n + public.notif_encolar('recordatorio_contrato_por_documentar', 'contrato', x.id::text, 'borrador', 'ventas.preparar', null,
      'Recordatorio: contrato sin enviar a Cumplimiento · ' || x.codigo, 'Contrato en borrador hace más de 3 días sin enviar a Cumplimiento',
      public.notif_datos_contrato(x.id), '/ventas?contrato=' || x.id, x.id);
  end loop;
  for x in select c.*, (select id from cumplimiento_revisiones v where v.contract_id = c.id order by v.registrado_en desc limit 1) as revision
             from contracts c where c.estado = 'borrador' and public.cumplimiento_estado(c.id) = 'pendiente'
              and (select registrado_en from cumplimiento_revisiones v where v.contract_id = c.id order by v.registrado_en desc limit 1) < p_hoy - 2 loop
    n := n + public.notif_encolar('recordatorio_expediente_por_revisar', 'contrato', x.id::text, x.revision::text, 'cumplimiento.revisar', null,
      'Recordatorio: expediente por revisar · ' || x.codigo, 'Expediente en revisión de Cumplimiento hace más de 2 días',
      public.notif_datos_contrato(x.id), '/ventas?contrato=' || x.id, x.id);
  end loop;
  for x in select c.*, (select id from cumplimiento_revisiones v where v.contract_id = c.id order by v.registrado_en desc limit 1) as revision
             from contracts c where c.estado = 'borrador' and public.cumplimiento_estado(c.id) = 'aprobado'
              and (select registrado_en from cumplimiento_revisiones v where v.contract_id = c.id order by v.registrado_en desc limit 1) < p_hoy - 3 loop
    n := n + public.notif_encolar('recordatorio_contrato_por_firmar', 'contrato', x.id::text, x.revision::text, 'ventas.formalizar', null,
      'Recordatorio: contrato aprobado sin firma · ' || x.codigo, 'Contrato aprobado por Cumplimiento hace más de 3 días, aún sin firma',
      public.notif_datos_contrato(x.id), '/ventas?contrato=' || x.id, x.id);
  end loop;
  return n;
end $$;

/* -------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.notif_destinatarios(text, uuid)', 'public.notif_cuerpo(text, jsonb, text)', 'public.notif_texto(text)', 'public.notif_datos_contrato(uuid)',
    'public.notif_encolar(text, text, text, text, text, uuid[], text, text, jsonb, text, uuid)', 'public.notif_seguro(text, text, text, text, text, uuid[], text, text, jsonb, text, uuid)',
    'public.notificaciones_recordatorios(date)', 'public.notif_administradores()', 'public.notif_reservas()', 'public.notif_comprobantes()', 'public.notif_contratos()', 'public.notif_cumplimiento()',
    'public.notif_pagos()', 'public.notif_excedentes()', 'public.notif_movimientos()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- La función cobranza-diaria llama a los recordatorios con la clave de servicio.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.notificaciones_recordatorios(date) to service_role';
  end if;
end $$;
