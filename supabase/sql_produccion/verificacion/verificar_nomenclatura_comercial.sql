-- AMURA · Verificación de 0015 (nomenclatura comercial). SOLO LECTURA: no modifica nada.
-- Ejecutar ANTES y DESPUÉS de 0015 y comparar:
--   · huella_sin_numero debe ser IDÉNTICA (códigos internos, edificio, piso, posición, tipología, metrajes, precios y estados intactos).
--   · Antes: formato_anterior = 72. Después: formato_nuevo = 72, coherentes = 72, restriccion = sí, edificio_contratos = texto.
--   · referencias_huerfanas = 0 siempre (reservas, cotizaciones y contratos siguen apuntando a unidades existentes).
select control, valor from (
  select 1 as orden, 'unidades' as control, count(*)::text as valor from public.inventory_units
  union all select 2, 'numeros_unicos', count(distinct dpt)::text from public.inventory_units
  union all select 3, 'formato_anterior (1001-2507)', count(*) filter (where dpt ~ '^[12][0-5]0[1-7]$')::text from public.inventory_units
  union all select 4, 'formato_nuevo (A001-B507)', count(*) filter (where dpt ~ '^[AB][0-5]0[1-7]$')::text from public.inventory_units
  union all select 5, 'coherentes con edificio, piso y posicion', count(*) filter (where dpt = case edificio when 1 then 'A' else 'B' end
      || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0'))::text from public.inventory_units
  union all select 6, 'codigos_internos_validos', count(*) filter (where codigo ~ '^E[12]-(PB|P[1-5])-A[1-7]$')::text from public.inventory_units
  union all select 7, 'huella_sin_numero', md5(string_agg(concat_ws('|', codigo, edificio, piso, posicion, ubicacion, tipologia, area_m2,
      bodega_codigo, bodega_m2, patio_m2, usd_m2, estado, reserva_id), ';' order by codigo)) from public.inventory_units
  union all select 8, 'restriccion', case when exists (select 1 from pg_constraint where conname = 'inventory_units_dpt_comercial') then 'sí' else 'no' end
  union all select 9, 'edificio_contratos', coalesce((select tipo from public.contract_fields where clave = 'unidad.edificio'), '—')
  union all select 10, 'referencias_huerfanas', (
      (select count(*) from public.reservations r where not exists (select 1 from public.inventory_units u where u.codigo = r.codigo_unidad))
    + (select count(*) from public.quotes q where not exists (select 1 from public.inventory_units u where u.codigo = q.codigo))
    + (select count(*) from public.contracts c where not exists (select 1 from public.inventory_units u where u.codigo = c.codigo_unidad)))::text
  union all select 11, 'muestra', string_agg(codigo || ' → ' || dpt, ', ' order by codigo) filter (where codigo in ('E1-PB-A1', 'E1-P1-A5', 'E2-PB-A7', 'E2-P5-A7')) from public.inventory_units
) x order by orden;
