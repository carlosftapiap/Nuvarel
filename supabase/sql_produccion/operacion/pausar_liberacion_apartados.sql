-- AMURA · Pausa reversible de la liberación automática de apartados (tarea pg_cron «reservas-liberar-apartados»).
-- No borra la tarea ni cambia reservas: solo la desactiva. Para reactivarla, usar reanudar_liberacion_apartados.sql.
-- Por qué: la tarea anula a las 48 horas las solicitudes sin comprobante reportado ni confirmado, aunque el cliente
-- tenga documentos esperando la revisión de Cumplimiento o un comprobante rechazado por corregir. Mientras se publica
-- la versión con las pantallas de Cumplimiento y se acuerda esa regla, conviene pausarla.
-- Ejecutar completo en el SQL Editor. Devuelve el estado de la tarea después del cambio.

select cron.alter_job(job_id := jobid, active := false)
  from cron.job where jobname = 'reservas-liberar-apartados';

select jobid, jobname, schedule, active from cron.job where jobname = 'reservas-liberar-apartados';
