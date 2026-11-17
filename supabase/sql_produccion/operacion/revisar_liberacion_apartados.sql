-- AMURA · SOLO LECTURA. Qué haría hoy la liberación automática de apartados, sin ejecutarla.
-- Lista las solicitudes vencidas y, para cada una, si hay comprobantes, documentos por revisar o si la tarea la liberaría.

select r.codigo, r.codigo_unidad, r.cumplimiento_estado, r.apartado_hasta,
       (select count(*) from public.comprobantes_pago c where c.reservation_id = r.id) as comprobantes,
       (select count(*) from public.comprobantes_pago c where c.reservation_id = r.id and c.estado = 'rechazado') as comprobantes_rechazados,
       (select count(*) from public.expediente_documentos d where d.client_id = r.client_id and d.estado = 'cargado') as documentos_por_revisar,
       (not exists (select 1 from public.comprobantes_pago c where c.reservation_id = r.id and c.estado in ('reportado', 'confirmado'))) as la_tarea_la_liberaria,
       (select active from cron.job where jobname = 'reservas-liberar-apartados') as tarea_activa
  from public.reservations r
 where r.estado = 'solicitada' and r.cumplimiento_estado in ('pendiente', 'observado') and r.apartado_hasta < now()
 order by r.apartado_hasta;
