-- AMURA · Reactiva la liberación automática de apartados (tarea pg_cron «reservas-liberar-apartados»).
-- Usar solo cuando la aplicación publicada tenga las pantallas de Cumplimiento y se haya aprobado la regla de liberación.
-- Ejecutar completo en el SQL Editor. Devuelve el estado de la tarea después del cambio.

select cron.alter_job(job_id := jobid, active := true)
  from cron.job where jobname = 'reservas-liberar-apartados';

select jobid, jobname, schedule, active from cron.job where jobname = 'reservas-liberar-apartados';
