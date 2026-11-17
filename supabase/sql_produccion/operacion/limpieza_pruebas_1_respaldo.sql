-- AMURA · Limpieza de datos de prueba · PASO 1: RESPALDO (no borra nada).
-- Copia en el esquema respaldo_limpieza_20261117 todas las filas que el paso 2 eliminará o modificará,
-- y una foto completa del inventario y de su historial. Al final compara conteos y huellas: deben coincidir.
-- Alcance: clientes cuyo nombre contiene la palabra «prueba» (diagnóstico del 2026-11-17: 11 clientes, todos de prueba)
-- y todo lo que depende de ellos. Ejecutar completo en el SQL Editor. Se puede repetir: reemplaza el respaldo anterior.

drop schema if exists respaldo_limpieza_20261117 cascade;
create schema respaldo_limpieza_20261117;
revoke all on schema respaldo_limpieza_20261117 from public, anon, authenticated;

create table respaldo_limpieza_20261117.clientes_alcance as select id from public.clients where nombre ~* '\mprueba\M';
create table respaldo_limpieza_20261117.clients as select * from public.clients where id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.client_activities as select * from public.client_activities where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.client_assignment_history as select * from public.client_assignment_history where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.opportunities as select * from public.opportunities where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.opportunity_events as select * from public.opportunity_events where opportunity_id in (select id from respaldo_limpieza_20261117.opportunities);
create table respaldo_limpieza_20261117.quotes as select * from public.quotes where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.ordenes_contrato as select * from public.ordenes_contrato where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.reservations as select * from public.reservations where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.reservas_cumplimiento_historial as select * from public.reservas_cumplimiento_historial where reserva_id in (select id from respaldo_limpieza_20261117.reservations);
create table respaldo_limpieza_20261117.comprobantes_pago as select * from public.comprobantes_pago where reservation_id in (select id from respaldo_limpieza_20261117.reservations);
create table respaldo_limpieza_20261117.recibos_pago as select * from public.recibos_pago where reservation_id in (select id from respaldo_limpieza_20261117.reservations);
create table respaldo_limpieza_20261117.desistimientos as select * from public.desistimientos where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.expediente_documentos as select * from public.expediente_documentos where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance);
create table respaldo_limpieza_20261117.cobranza_alertas as select * from public.cobranza_alertas where entidad_id in (
  select id::text from respaldo_limpieza_20261117.clients union all select id::text from respaldo_limpieza_20261117.reservations
  union all select id::text from respaldo_limpieza_20261117.comprobantes_pago union all select id::text from respaldo_limpieza_20261117.desistimientos
  union all select id::text from respaldo_limpieza_20261117.opportunities union all select id::text from respaldo_limpieza_20261117.quotes);
create table respaldo_limpieza_20261117.inventory_units as select * from public.inventory_units;
create table respaldo_limpieza_20261117.inventory_status_history as select * from public.inventory_status_history;

-- Comprobación: cada respaldo tiene las mismas filas y la misma huella que su origen.
select t as tabla, respaldo, origen, respaldo = origen as coincide from (
  select 'clients' as t, (select count(*) from respaldo_limpieza_20261117.clients) as respaldo, (select count(*) from public.clients where id in (select id from respaldo_limpieza_20261117.clientes_alcance)) as origen
  union all select 'client_activities', (select count(*) from respaldo_limpieza_20261117.client_activities), (select count(*) from public.client_activities where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance))
  union all select 'opportunities', (select count(*) from respaldo_limpieza_20261117.opportunities), (select count(*) from public.opportunities where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance))
  union all select 'quotes', (select count(*) from respaldo_limpieza_20261117.quotes), (select count(*) from public.quotes where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance))
  union all select 'reservations', (select count(*) from respaldo_limpieza_20261117.reservations), (select count(*) from public.reservations where client_id in (select id from respaldo_limpieza_20261117.clientes_alcance))
  union all select 'comprobantes_pago', (select count(*) from respaldo_limpieza_20261117.comprobantes_pago), (select count(*) from public.comprobantes_pago where reservation_id in (select id from respaldo_limpieza_20261117.reservations))
  union all select 'recibos_pago', (select count(*) from respaldo_limpieza_20261117.recibos_pago), (select count(*) from public.recibos_pago where reservation_id in (select id from respaldo_limpieza_20261117.reservations))
  union all select 'inventory_units', (select count(*) from respaldo_limpieza_20261117.inventory_units), (select count(*) from public.inventory_units)
  union all select 'huella clients', (select count(*) from respaldo_limpieza_20261117.clients b join public.clients o on o.id = b.id and md5(row_to_json(o)::text) = md5(row_to_json(b)::text)), (select count(*) from respaldo_limpieza_20261117.clients)
  union all select 'huella reservations', (select count(*) from respaldo_limpieza_20261117.reservations b join public.reservations o on o.id = b.id and md5(row_to_json(o)::text) = md5(row_to_json(b)::text)), (select count(*) from respaldo_limpieza_20261117.reservations)
) s order by 1;
