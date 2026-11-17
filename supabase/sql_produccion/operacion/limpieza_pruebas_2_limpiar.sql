-- AMURA · Limpieza de datos de prueba · PASO 2: LIMPIEZA (requiere autorización expresa y el PASO 1 hecho).
-- Una sola transacción: si cualquier control falla, no se borra nada.
-- Borra solo lo respaldado en respaldo_limpieza_20261117 (clientes de prueba y sus dependencias) y libera las unidades
-- que esas reservas tenían ocupadas, dejando constancia en el historial del inventario.
-- NO toca: usuarios, perfiles, contraseñas, permisos, inventario (salvo liberar esas unidades), precios, parámetros de pago
-- y plazos, cuentas bancarias, plantillas, documentos maestros, planos, auditoría (audit_log), migraciones ni tareas programadas.
-- Sin TRUNCATE ni borrado de tablas completas: cada DELETE filtra por los identificadores respaldados.

begin;

do $$
declare
  -- Lo medido en el diagnóstico del 2026-11-17. Si producción cambió desde entonces, la limpieza se detiene.
  v_esperado_clientes int := 11;
  v_esperado_reservas int := 9;
  v_esperado_unidades int := 4;
  v_clientes int; v_reservas int; v_unidades int; v_reales int; v_contratos int;
begin
  if to_regclass('respaldo_limpieza_20261117.clients') is null then
    raise exception 'Falta el respaldo: ejecuta primero limpieza_pruebas_1_respaldo.sql';
  end if;
  select count(*) into v_clientes from respaldo_limpieza_20261117.clients;
  select count(*) into v_reservas from respaldo_limpieza_20261117.reservations;
  select count(*) into v_unidades from public.inventory_units where reserva_id in (select id from respaldo_limpieza_20261117.reservations);
  select count(*) into v_reales from respaldo_limpieza_20261117.clients where nombre !~* '\mprueba\M';
  select count(*) into v_contratos from public.contracts where client_id in (select id from respaldo_limpieza_20261117.clients);
  if v_clientes <> v_esperado_clientes or v_reservas <> v_esperado_reservas or v_unidades <> v_esperado_unidades then
    raise exception 'Los datos cambiaron desde el diagnóstico (clientes %, reservas %, unidades %): revisa antes de limpiar', v_clientes, v_reservas, v_unidades;
  end if;
  if v_reales > 0 then raise exception 'Hay % cliente(s) sin la palabra «prueba» en el alcance: no se limpia', v_reales; end if;
  if v_contratos > 0 then raise exception 'Hay % contrato(s) de estos clientes: requieren otro procedimiento', v_contratos; end if;
  if not exists (select 1 from public.profiles where rol_id = 'administrador' and estado = 'activo') then
    raise exception 'No hay un administrador activo a cuyo nombre registrar la liberación de unidades';
  end if;
end $$;

-- Las funciones del flujo marcan la transacción para que los disparadores permitan los cambios de inventario.
select set_config('app.flujo', 'on', true);

-- 1. Liberar las unidades ocupadas por reservas de prueba, con constancia en el historial.
insert into public.inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
select (select p.id from public.profiles p where p.rol_id = 'administrador' and p.estado = 'activo' order by p.created_at limit 1), 'administrador', u.codigo, u.estado, 'disponible', 'Limpieza de datos de prueba (2026-11-17): reserva de prueba retirada', null
  from public.inventory_units u where u.reserva_id in (select id from respaldo_limpieza_20261117.reservations);
update public.inventory_units set estado = 'disponible', reserva_id = null, updated_at = now()
 where reserva_id in (select id from respaldo_limpieza_20261117.reservations);

-- 2. Avisos pendientes de esas operaciones (correos en modo prueba).
delete from public.cobranza_alertas where id in (select id from respaldo_limpieza_20261117.cobranza_alertas);

-- 3. Cobros de prueba: recibos y comprobantes de reservas de prueba.
delete from public.recibos_pago where id in (select id from respaldo_limpieza_20261117.recibos_pago);
delete from public.comprobantes_pago where id in (select id from respaldo_limpieza_20261117.comprobantes_pago);

-- 4. Reservas y lo que depende de ellas.
delete from public.reservas_cumplimiento_historial where id in (select id from respaldo_limpieza_20261117.reservas_cumplimiento_historial);
delete from public.desistimientos where id in (select id from respaldo_limpieza_20261117.desistimientos);
delete from public.reservations where id in (select id from respaldo_limpieza_20261117.reservations);

-- 5. Cotizaciones, órdenes de contrato, negociaciones y expediente.
delete from public.ordenes_contrato where id in (select id from respaldo_limpieza_20261117.ordenes_contrato);
delete from public.quotes where id in (select id from respaldo_limpieza_20261117.quotes);
delete from public.opportunity_events where id in (select id from respaldo_limpieza_20261117.opportunity_events);
delete from public.opportunities where id in (select id from respaldo_limpieza_20261117.opportunities);
delete from public.expediente_documentos where id in (select id from respaldo_limpieza_20261117.expediente_documentos);

-- 6. Clientes: actividades, historial de responsable y el cliente.
delete from public.client_activities where id in (select id from respaldo_limpieza_20261117.client_activities);
delete from public.client_assignment_history where id in (select id from respaldo_limpieza_20261117.client_assignment_history);
delete from public.clients where id in (select id from respaldo_limpieza_20261117.clients);

-- Control final dentro de la transacción: si algo quedó, no se confirma.
do $$
begin
  if exists (select 1 from public.clients where id in (select id from respaldo_limpieza_20261117.clients))
     or exists (select 1 from public.reservations where id in (select id from respaldo_limpieza_20261117.reservations))
     or exists (select 1 from public.inventory_units where reserva_id in (select id from respaldo_limpieza_20261117.reservations)) then
    raise exception 'La limpieza quedó incompleta: no se confirma';
  end if;
end $$;

commit;
