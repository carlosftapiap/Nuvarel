-- AMURA · Solo lectura: qué acceso cambiaría al aplicar correctivo_clientes_produccion.sql. No modifica nada.
-- Ejecutar antes del correctivo. Sin filas, nadie pierde acceso a un cliente ni a una negociación.
select 'cliente' as tipo, c.id::text as registro, c.nombre as cliente, c.etapa::text as etapa,
  coalesce(a.nombre, 'sin nombre') as asesor, coalesce(p.nombre, 'sin nombre') as pierde_acceso,
  'Lo creó, pero no es su asesor ni lleva una negociación abierta' as motivo
from public.clients c
left join public.profiles a on a.id = c.asesor_id
left join public.profiles p on p.id = c.created_by
where c.created_by is not null and c.created_by <> c.asesor_id
  and not exists (select 1 from public.opportunities o where o.client_id = c.id and o.etapa <> 'perdida' and o.responsable_id = c.created_by)
union all
select 'negociacion cerrada', o.id::text, c.nombre, o.etapa::text,
  coalesce(a.nombre, 'sin nombre'), coalesce(p.nombre, 'sin nombre'),
  'Era responsable de una negociación cerrada, y no es asesor ni creó el cliente'
from public.opportunities o
join public.clients c on c.id = o.client_id
left join public.profiles a on a.id = c.asesor_id
left join public.profiles p on p.id = o.responsable_id
where o.etapa = 'perdida' and o.responsable_id is distinct from c.asesor_id and o.responsable_id is distinct from c.created_by
  and not exists (select 1 from public.opportunities x where x.client_id = c.id and x.etapa <> 'perdida' and x.responsable_id = o.responsable_id);
