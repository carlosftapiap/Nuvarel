-- AMURA · SQL de producción 0006. Copia exacta de supabase/migrations/20261118000000_precios_lista_oficial.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Lista oficial de precios del 12/11/2026. Reemplaza la lista anterior en las 72 unidades: usd_m2, usd_m2_lista y
-- precio_referencia quedan con el mismo valor, así hay una sola lista vigente. El patio sigue a USD 230/m² (pricing_params).
-- Las cotizaciones, reservas y contratos ya emitidos conservan el precio con que se emitieron.
-- Verifica que se actualicen las 72 unidades y que el total del proyecto sea USD 11.129.497 (redondeo de hasta USD 60).
-- Revertir: no aplica; la lista anterior se reemplaza por decisión comercial.
-- Ejecutar después de 20261117000000_clientes_unicos_reasignacion.sql.

do $$
declare v_patio numeric := (select patio_usd_m2 from public.pricing_params where id = 1); v_n int; v_total numeric;
begin
  if v_patio is distinct from 230 then raise exception 'El patio debe estar a USD 230/m² (está en %)', v_patio; end if;
  update public.inventory_units u
     set usd_m2 = l.usd, usd_m2_lista = l.usd, precio_referencia = public.precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, l.usd, v_patio), updated_at = now()
    from (values
      ('E1-PB-A1', 2230), ('E1-PB-A2', 2230), ('E1-PB-A3', 2220), ('E1-PB-A4', 2230), ('E1-PB-A5', 2230),
      ('E1-P1-A1', 2250), ('E1-P1-A2', 2250), ('E1-P1-A3', 2230), ('E1-P1-A4', 2250), ('E1-P1-A5', 2250),
      ('E1-P2-A1', 2270), ('E1-P2-A2', 2270), ('E1-P2-A3', 2240), ('E1-P2-A4', 2270), ('E1-P2-A5', 2270),
      ('E1-P3-A1', 2280), ('E1-P3-A2', 2280), ('E1-P3-A3', 2240), ('E1-P3-A4', 2280), ('E1-P3-A5', 2280),
      ('E1-P4-A1', 2285), ('E1-P4-A2', 2285), ('E1-P4-A3', 2250), ('E1-P4-A4', 2285), ('E1-P4-A5', 2285),
      ('E1-P5-A1', 2285), ('E1-P5-A2', 2285), ('E1-P5-A3', 2250), ('E1-P5-A4', 2285), ('E1-P5-A5', 2285),
      ('E2-PB-A1', 2270), ('E2-PB-A2', 2270), ('E2-PB-A3', 2260), ('E2-PB-A4', 2260), ('E2-PB-A5', 2270), ('E2-PB-A6', 2270), ('E2-PB-A7', 2260),
      ('E2-P1-A1', 2320), ('E2-P1-A2', 2320), ('E2-P1-A3', 2290), ('E2-P1-A4', 2290), ('E2-P1-A5', 2320), ('E2-P1-A6', 2320), ('E2-P1-A7', 2290),
      ('E2-P2-A1', 2340), ('E2-P2-A2', 2340), ('E2-P2-A3', 2300), ('E2-P2-A4', 2300), ('E2-P2-A5', 2340), ('E2-P2-A6', 2340), ('E2-P2-A7', 2300),
      ('E2-P3-A1', 2360), ('E2-P3-A2', 2360), ('E2-P3-A3', 2300), ('E2-P3-A4', 2300), ('E2-P3-A5', 2360), ('E2-P3-A6', 2360), ('E2-P3-A7', 2300),
      ('E2-P4-A1', 2375), ('E2-P4-A2', 2375), ('E2-P4-A3', 2310), ('E2-P4-A4', 2310), ('E2-P4-A5', 2375), ('E2-P4-A6', 2375), ('E2-P4-A7', 2310),
      ('E2-P5-A1', 2375), ('E2-P5-A2', 2375), ('E2-P5-A3', 2310), ('E2-P5-A4', 2310), ('E2-P5-A5', 2375), ('E2-P5-A6', 2375), ('E2-P5-A7', 2310)
    ) as l(codigo, usd)
   where u.codigo = l.codigo;
  get diagnostics v_n = row_count;
  if v_n <> 72 then raise exception 'Se esperaban 72 unidades y se actualizaron %', v_n; end if;
  select sum(public.precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, v_patio)) into v_total from public.inventory_units;
  if abs(v_total - 11129497) > 60 then raise exception 'El total del proyecto es USD % y debe ser USD 11.129.497', v_total; end if;
end $$;
