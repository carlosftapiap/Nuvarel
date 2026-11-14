-- AMURA · Diagnóstico previo a la fase 2 (pagos anticipados). SOLO LECTURA: no modifica nada.
-- Lista los contratos cuyo total verificado supera la entrada (todo el cronograma menos el saldo contra entrega del 80 %).
-- Con la regla nueva, ese excedente dejará de descontarse solo del 80 % y quedará como saldo a favor hasta que Finanzas lo autorice.
-- Pegar completo en el editor SQL de Supabase. Si no devuelve filas, la fase 2 no cambia ningún saldo existente.
with entrada as (
  select contract_id,
    sum(monto) filter (where concepto not like 'Saldo contra entrega%') as entrada,
    sum(monto) filter (where concepto like 'Saldo contra entrega%') as financiamiento
  from public.installments group by contract_id
), verificado as (
  select contract_id, sum(monto) as verificado from public.payments where estado = 'verificado' group by contract_id
)
select c.codigo as contrato, c.codigo_unidad as unidad, c.estado, c.precio,
  e.entrada, e.financiamiento, coalesce(v.verificado, 0) as verificado,
  round(coalesce(v.verificado, 0) - e.entrada, 2) as excedente_sobre_entrada
from public.contracts c
join entrada e on e.contract_id = c.id
left join verificado v on v.contract_id = c.id
where c.estado <> 'anulado' and coalesce(v.verificado, 0) > e.entrada + 0.005
order by excedente_sobre_entrada desc;
