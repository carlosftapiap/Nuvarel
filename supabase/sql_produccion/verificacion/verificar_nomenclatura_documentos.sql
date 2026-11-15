-- SOLO LECTURA. Ejecutar tras 0016; el mapeo exportable incluye exactamente las 72 unidades.
select codigo as codigo_interno,dpt_anterior as numero_anterior,dpt as codigo_comercial,
 case edificio when 1 then 'Edificio A' else 'Edificio B' end as edificio,piso,posicion
from public.inventory_units order by edificio,piso,posicion;

select 'unidades' control,count(*)::text valor from public.inventory_units
union all select 'codigos_comerciales_unicos',count(distinct dpt)::text from public.inventory_units
union all select 'edificio_A',count(*)::text from public.inventory_units where edificio=1
union all select 'edificio_B',count(*)::text from public.inventory_units where edificio=2
union all select 'siete_fk_validadas',count(*)::text from pg_constraint where contype='f' and confrelid='public.inventory_units'::regclass and convalidated
union all select 'inventario_igual_al_respaldo_0016',((select inventario from public.nomenclatura_respaldo where version='0016') =
 (select jsonb_agg(to_jsonb(u)-'dpt_anterior' order by codigo) from public.inventory_units u))::text
union all select 'triggers_snapshot',count(*)::text from pg_trigger where not tgisinternal and tgname in
 ('quotes_unidad_snapshot','recibos_unidad_snapshot','simulaciones_unidad_snapshot','comprobantes_documento_snapshot')
union all select 'historicos_sin_snapshot_no_regenerar',((select count(*) from public.quotes where unidad_snapshot is null)
 +(select count(*) from public.recibos_pago where unidad_snapshot is null and pdf_ruta is null)
 +(select count(*) from public.comprobantes_pago where constancia_numero is not null and constancia_snapshot is null))::text;

-- La ausencia de snapshot en un histórico es intencional: nunca rellenarlo con los datos actuales.
-- Antes de operaciones, comparar además el control de 0015 con el respaldo previo y VERIFICAR_DESPLIEGUE.sql.

select 'contracts' relacion,count(*) huerfanas from public.contracts x where not exists(select 1 from public.inventory_units u where u.codigo=x.codigo_unidad)
union all select 'reservations',count(*) from public.reservations x where not exists(select 1 from public.inventory_units u where u.codigo=x.codigo_unidad)
union all select 'quotes',count(*) from public.quotes x where not exists(select 1 from public.inventory_units u where u.codigo=x.codigo)
union all select 'opportunities',count(*) from public.opportunities x where x.codigo_unidad is not null and not exists(select 1 from public.inventory_units u where u.codigo=x.codigo_unidad)
union all select 'desistimientos',count(*) from public.desistimientos x where x.codigo_unidad is not null and not exists(select 1 from public.inventory_units u where u.codigo=x.codigo_unidad)
union all select 'mortgage_simulations',count(*) from public.mortgage_simulations x where not exists(select 1 from public.inventory_units u where u.codigo=x.codigo_unidad)
union all select 'inventory_status_history',count(*) from public.inventory_status_history x where not exists(select 1 from public.inventory_units u where u.codigo=x.codigo);
