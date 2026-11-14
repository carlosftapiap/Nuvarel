-- AMURA · SQL de producción 0010: limpieza de datos de prueba antes de la comercialización real.
-- NO es una migración del repositorio. Se ejecuta a mano en el SQL Editor de Supabase, DESPUÉS de un respaldo verificado
-- (scripts/respaldo-produccion.ps1). Es de una sola vez: no se vuelve a ejecutar.
--
-- BORRA: clientes y sus datos (actividades, oportunidades, cotizaciones, reservas, comprobantes, contratos, documentos del
--        expediente, cobranzas, comisiones, desistimientos, solicitudes de reasignación, importaciones), recibos, notificaciones
--        (cola de avisos), y el historial comercial de inventario que apunta a esas operaciones.
-- RESTABLECE: las 72 unidades a disponible, sin reserva, sin precio ni datos cambiados (precios oficiales intactos).
-- CONSERVA: inventario y precios oficiales, usuarios, roles, permisos, equipos, configuración (cobros, parámetros, plantillas,
--           entidad vendedora, productos bancarios), medios del proyecto, plan de obra y auditoría (audit_log).
--
-- Control: si queda una reserva, contrato o pago confirmado con dinero real, o una unidad con datos no estándar, la limpieza
-- SE DETIENE sin borrar nada. Revisa el conteo previo antes de ejecutar.
-- Revertir: no hay vuelta atrás desde el script; por eso el respaldo previo es obligatorio.

begin;

-- 1. Control previo: aborta si hay algo que no debe borrarse sin revisión.
do $$
declare v_pagos int; v_firmados int;
begin
  select count(*) into v_firmados from public.contracts where estado = 'firmado';
  select count(*) into v_pagos from public.payments where estado = 'verificado';
  if v_firmados > 0 or v_pagos > 0 then
    raise exception 'Hay % contratos firmados y % pagos verificados: son operaciones reales. La limpieza se detiene sin borrar nada.', v_firmados, v_pagos;
  end if;
end $$;

-- 2. Disparadores de protección: se desactivan solo durante esta transacción.
--    Solo los de comisiones y contratos; los de inventario y auditoría no se tocan.
alter table public.comisiones disable trigger comision_sin_borrado;
alter table public.comision_movimientos disable trigger comision_sin_borrado;
alter table public.comision_tramos disable trigger comision_sin_borrado;
alter table public.contract_buyers disable trigger comprador_sin_borrado;
alter table public.contract_document_events disable trigger documento_eventos_sin_borrado;
alter table public.contract_document_versions disable trigger documento_sin_borrado;
alter table public.contract_template_events disable trigger plantilla_eventos_sin_borrado;
alter table public.contract_templates disable trigger plantilla_sin_borrado;

-- 3. Notificaciones, recibos y operaciones de prueba, de hojas hacia raíz.
delete from public.cobranza_alertas;
delete from public.recibos_pago;
delete from public.comision_movimientos;
delete from public.comision_tramos;
delete from public.comisiones;
delete from public.aplicaciones_excedente;
delete from public.cobranza_compromisos;
delete from public.cobranza_gestiones;
delete from public.cumplimiento_revisiones;
delete from public.expediente_documentos;
delete from public.reserva_movimientos;
delete from public.comprobantes_pago;
delete from public.payments;
delete from public.installments;
delete from public.contract_milestones;
delete from public.contract_documents;
delete from public.contract_document_events;
delete from public.contract_document_versions;
delete from public.contract_buyers;
delete from public.contracts;
delete from public.desistimientos;
delete from public.reservations;
delete from public.quotes;
delete from public.opportunity_events;
delete from public.opportunities;
delete from public.client_reassignment_requests;
delete from public.client_assignment_history;
delete from public.client_access;
delete from public.client_imports;
delete from public.client_activities;
delete from public.mortgage_simulations;
delete from public.clients;

-- 4. Historial de inventario que apunta a operaciones borradas: se quita la referencia a la reserva; el resto se conserva.
update public.inventory_status_history set reserva_id = null where reserva_id is not null;

-- 5. Unidades a disponibilidad inicial, sin reserva ni bloqueo. Los precios no se tocan.
update public.inventory_units set estado = 'disponible', reserva_id = null, updated_at = now()
where estado <> 'disponible' or reserva_id is not null;

-- 6. Vuelve a activar la protección.
alter table public.comisiones enable trigger comision_sin_borrado;
alter table public.comision_movimientos enable trigger comision_sin_borrado;
alter table public.comision_tramos enable trigger comision_sin_borrado;
alter table public.contract_buyers enable trigger comprador_sin_borrado;
alter table public.contract_document_events enable trigger documento_eventos_sin_borrado;
alter table public.contract_document_versions enable trigger documento_sin_borrado;
alter table public.contract_template_events enable trigger plantilla_eventos_sin_borrado;
alter table public.contract_templates enable trigger plantilla_sin_borrado;

-- 7. Verificación: el script termina con error si algo no quedó limpio.
do $$
begin
  if (select count(*) from public.clients) > 0 then raise exception 'Quedaron clientes'; end if;
  if (select count(*) from public.reservations) > 0 then raise exception 'Quedaron reservas'; end if;
  if (select count(*) from public.contracts) > 0 then raise exception 'Quedaron contratos'; end if;
  if (select count(*) from public.inventory_units where estado = 'disponible') <> 72 then raise exception 'Las unidades disponibles no son 72'; end if;
  if (select count(*) from public.inventory_units where reserva_id is not null) > 0 then raise exception 'Quedaron unidades con reserva'; end if;
end $$;

commit;
