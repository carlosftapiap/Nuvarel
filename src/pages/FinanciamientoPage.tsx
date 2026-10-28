import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { CalendarDays, Download, FileText, Percent } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DESCUENTO_MAX, fmtFechaCorta, generarPlan, hoyGuayaquil } from '@/features/financiamiento/plan'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { EstadoBadge, FieldError, pisoLabel } from '@/features/inventario/components/shared'
import { fmtM2, fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'

export default function FinanciamientoPage() {
  const { state } = useInventory()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const codigo = params.get('unidad') ?? ''
  const [fecha, setFecha] = useState(hoyGuayaquil())
  const [descuento, setDescuento] = useState('0')
  const puedeDescontar = can('cotizaciones.descuento')
  const unit = state.units.find((u) => u.codigo === codigo)

  const resultado = useMemo(() => {
    if (!unit) return { plan: null, error: null }
    try {
      return { plan: generarPlan(unit, state.params, { fechaReserva: fecha, descuentoPct: puedeDescontar ? Number(descuento.replace(',', '.')) || 0 : 0 }), error: null }
    } catch (e) {
      return { plan: null, error: (e as Error).message }
    }
  }, [unit, state.params, fecha, descuento, puedeDescontar])
  const plan = resultado.plan

  function exportar() {
    if (!plan || !unit) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(plan.cronograma.map((p) => ({
      'N.º': p.n, Concepto: p.concepto, Fecha: fmtFechaCorta(p.fecha), 'Monto (USD)': p.monto, 'Saldo (USD)': p.saldo,
    }))), 'Cronograma')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Departamento', `${unit.dpt} (${unit.codigo})`], ['Precio de lista', plan.precioLista], ['Descuento %', plan.descuentoPct],
      ['Precio final', plan.precioFinal], ['Reserva', plan.reserva], ['Cuotas', `${plan.meses} x ${plan.cuotaMensual}`], ['Contra entrega', plan.contraEntrega],
      ['Aviso', 'Precios referenciales sujetos a aprobación. Saldo pagadero a la entrega (fecha por confirmar).'],
    ]), 'Resumen')
    XLSX.writeFile(wb, `AMURA_cronograma_${unit.dpt}_${fecha}.xlsx`)
  }

  const cotizarUrl = `/cotizaciones?unidad=${encodeURIComponent(codigo)}&fecha=${fecha}${puedeDescontar && Number(descuento) > 0 ? `&descuento=${descuento}` : ''}`

  return (
    <>
      <PageHeader eyebrow="Ventas · Financiamiento" title="Simulador de financiamiento"
        subtitle={`Reserva ${state.params.reservaPct}% · ${state.params.cuotasPct}% en ${state.params.meses[1]} cuotas (Edificio 1) o ${state.params.meses[2]} cuotas (Edificio 2) · saldo a la entrega`}
        actions={plan && <>
          <Button variant="outline" size="sm" onClick={exportar}><Download />Cronograma Excel</Button>
          {can('cotizaciones.crear') && <Button size="sm" asChild><Link to={cotizarUrl}><FileText />Crear cotización</Link></Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="dashboard-card p-5 grid content-start gap-4" aria-label="Datos de la simulación">
          <UnitPicker id="fin-unidad" units={state.units} params={state.params} value={codigo}
            onChange={(c) => setParams((p) => { p.set('unidad', c); return p }, { replace: true })} />
          <div className="grid gap-1.5">
            <Label htmlFor="fin-fecha" className="text-xs">Fecha de reserva</Label>
            <div className="relative"><CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input id="fin-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="h-9 pl-8" /></div>
            <p className="text-[11px] text-muted-foreground">Las cuotas se cuentan mes a mes desde esta fecha.</p>
          </div>
          {puedeDescontar ? (
            <div className="grid gap-1.5">
              <Label htmlFor="fin-desc" className="text-xs">Descuento autorizado (%)</Label>
              <div className="relative"><Percent className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input id="fin-desc" inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} className="h-9 pl-8" /></div>
              <p className="text-[11px] text-muted-foreground">Máximo técnico {DESCUENTO_MAX}%. Úsalo solo con autorización.</p>
            </div>
          ) : <p className="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">Los descuentos los autoriza gerencia.</p>}
          {unit && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-center justify-between gap-2"><b>Departamento {unit.dpt}</b><EstadoBadge estado={unit.estado} /></div>
              <p className="mt-1 text-muted-foreground">Edificio {unit.edificio} · {pisoLabel(unit.piso)} · {unit.tipologia} · {fmtM2(unit.areaM2 + unit.bodegaM2)}{unit.patioM2 ? ` + patio ${fmtM2(unit.patioM2)}` : ''}</p>
            </div>
          )}
          <FieldError>{resultado.error}</FieldError>
        </section>

        {!plan ? (
          <div className="module-empty"><h2 className="text-lg font-semibold">Selecciona un departamento</h2><p className="mt-2 text-sm text-muted-foreground">Verás el plan de pagos y el cronograma completo para el comprador.</p></div>
        ) : (
          <div className="grid min-w-0 content-start gap-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Caja titulo="Precio final" valor={fmtUsd(plan.precioFinal)} detalle={plan.descuentoPct ? `Lista ${fmtUsd(plan.precioLista)} − ${plan.descuentoPct}%` : 'Precio de lista'} destacado />
              <Caja titulo={`Reserva ${plan.reservaPct}%`} valor={fmtUsd2(plan.reserva)} detalle={`A la firma · ${fmtFechaCorta(fecha)}`} />
              <Caja titulo={`Cuotas ${plan.cuotasPct}%`} valor={`${plan.meses} × ${fmtUsd2(plan.cuotaMensual)}`} detalle={`Total ${fmtUsd2(plan.cuotasTotal)}`} />
              <Caja titulo={`Contra entrega ${plan.entregaPct}%`} valor={fmtUsd2(plan.contraEntrega)} detalle="A la entrega (fecha por confirmar)" />
            </div>
            <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="crono">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 id="crono" className="text-sm font-semibold">Cronograma de pagos</h2>
                <span className="text-[11px] text-muted-foreground">{plan.cronograma.length} pagos</span>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
                    <tr><th className="px-4 py-2 text-left font-medium">N.º</th><th className="px-2 py-2 text-left font-medium">Concepto</th><th className="px-2 py-2 text-left font-medium">Fecha</th><th className="px-2 py-2 text-right font-medium">Monto</th><th className="px-4 py-2 text-right font-medium">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {plan.cronograma.map((p) => (
                      <tr key={p.n} className={`border-t border-border ${p.tipo !== 'cuota' ? 'bg-secondary/40 font-medium' : ''}`}>
                        <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{p.n}</td>
                        <td className="px-2 py-1.5">{p.concepto}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtFechaCorta(p.fecha)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(p.monto)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{fmtUsd2(p.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t border-border bg-muted font-semibold"><td className="px-4 py-2" colSpan={3}>Total</td><td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(plan.precioFinal)}</td><td /></tr></tfoot>
                </table>
              </div>
            </section>
            <p className="text-[11px] text-muted-foreground">Precios referenciales de la lista base del 28/10/2026, sujetos a aprobación. La última cuota ajusta los centavos para que el total sea exacto.</p>
          </div>
        )}
      </div>
    </>
  )
}

function Caja({ titulo, valor, detalle, destacado }: { titulo: string; valor: string; detalle: string; destacado?: boolean }) {
  return (
    <div className={`dashboard-card !p-4 ${destacado ? 'ring-1 ring-primary/30' : ''}`}>
      <div className="text-[11px] text-muted-foreground">{titulo}</div>
      <div className={`mt-1 font-semibold tabular-nums tracking-tight ${destacado ? 'text-2xl text-primary' : 'text-lg'}`}>{valor}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detalle}</div>
    </div>
  )
}
