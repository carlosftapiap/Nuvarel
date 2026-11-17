-- AMURA · Limpieza de datos de prueba · PASO 3: VERIFICACIÓN (solo lectura).
-- Después de la limpieza todo debe dar 0, salvo lo indicado como «se conserva».
select json_build_object(
  'clientes_de_prueba', (select count(*) from public.clients where nombre ~* '\mprueba\M'),
  'clientes_restantes', (select count(*) from public.clients),
  'reservas_activas', (select count(*) from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')),
  'reservas_restantes', (select count(*) from public.reservations),
  'contratos', (select count(*) from public.contracts),
  'cobros_en_comprobantes', (select coalesce(sum(monto), 0) from public.comprobantes_pago where estado = 'confirmado'),
  'cobros_en_reservas', (select coalesce(sum(monto_recibido), 0) from public.reservations),
  'cuotas_pendientes', (select coalesce(sum(monto), 0) from public.installments),
  'comisiones_por_pagar', (select count(*) from public.comision_tramos where estado not in ('pagada', 'anulada')),
  'unidades', (select json_object_agg(estado, n) from (select estado::text as estado, count(*) n from public.inventory_units group by 1) s),
  'unidades_con_reserva', (select count(*) from public.inventory_units where reserva_id is not null),
  'se_conserva_usuarios_activos', (select count(*) from public.profiles where estado = 'activo'),
  'se_conserva_permisos', (select count(*) from public.role_permissions),
  'se_conserva_parametros', (select reserva_pct || ' % firma, ' || cuotas_pct || ' % cuotas, ' || meses_e1 || ' / ' || meses_e2 || ' meses' from public.pricing_params where id = 1),
  'se_conserva_receptor', (select receptor from public.payment_settings where id = 1),
  'se_conserva_auditoria', (select count(*) from public.audit_log),
  'se_conserva_tarea_liberacion', (select active from cron.job where jobname = 'reservas-liberar-apartados')
) as resultado;
