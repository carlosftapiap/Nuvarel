-- AMURA · Fase 0: estado del envío de correos. SOLO LECTURA: no modifica nada ni envía correos.
-- Pegar completo en el editor SQL de Supabase. Muestra extensiones del programador y la cola de alertas por estado.
-- La cola sin enviar es la que saldría de golpe si se activa COBRANZA_ENVIO_REAL: revisarla antes.
select 'extension' as seccion, e.name as detalle, coalesce(x.extversion, 'NO INSTALADA') as valor, null::bigint as cantidad
from (values ('pg_cron'), ('pg_net')) e(name)
left join pg_extension x on x.extname = e.name
union all
select 'cola', a.estado, coalesce(a.error, ''), count(*)
from public.cobranza_alertas a
group by a.estado, a.error
union all
select 'cola mas antigua sin enviar', min(a.creada_en)::text, '', count(*)
from public.cobranza_alertas a where a.estado = 'pendiente'
order by 1, 2;

-- Solo si pg_cron aparece instalada arriba, ejecutar también (en una consulta aparte):
-- select jobname, schedule, active from cron.job;
