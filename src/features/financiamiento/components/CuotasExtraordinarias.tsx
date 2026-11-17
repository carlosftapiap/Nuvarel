import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { fechaCuota, fmtFechaCorta, type CronogramaMes, type CuotaExtraordinaria } from '../plan'

/** Lo que el vendedor escribe, antes de validarlo. */
export interface FilaExtra { mes: string; monto: string }

export const aFilas = (extras: CuotaExtraordinaria[] = []): FilaExtra[] => extras.map((e) => ({ mes: String(e.mes), monto: String(e.monto) }))

/** Texto → cuotas. Una fila ilegible queda con NaN: repartirCuotas la rechaza con su mensaje. */
export const leerFilas = (filas: FilaExtra[]): CuotaExtraordinaria[] => filas.map((f) => ({ mes: f.mes.trim() === '' ? NaN : Number(f.mes), monto: leerMonto(f.monto) ?? NaN }))

/** Para pasar el plan de una pantalla a otra en la dirección: 6:5000,12:2500. */
export const filasAParam = (filas: FilaExtra[]) => filas.map((f) => `${f.mes.trim()}:${leerMonto(f.monto) ?? ''}`).join(',')
export const filasDeParam = (v: string | null): FilaExtra[] => (v ? v.split(',').map((x) => { const [mes, monto] = x.split(':'); return { mes: mes ?? '', monto: monto ?? '' } }) : [])

export default function CuotasExtraordinarias({ filas, onChange, meses, fechaBase, vencimientos, soloLectura = false }: { filas: FilaExtra[]; onChange: (f: FilaExtra[]) => void; meses: number; fechaBase: string; vencimientos?: string[]; soloLectura?: boolean }) {
  const cambiar = (i: number, cambio: Partial<FilaExtra>) => onChange(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)))
  const fecha = (mes: string) => { const m = Number(mes); return Number.isInteger(m) && m >= 1 && m <= meses ? fmtFechaCorta(fechaCuota({ vencimientos }, fechaBase, m)) : '—' }
  return (
    <div className="grid gap-2" role="group" aria-label="Cuotas extraordinarias">
      {filas.map((f, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label htmlFor={`extra-mes-${i}`} className="text-xs">Mes (1 a {meses})</Label><Input id={`extra-mes-${i}`} inputMode="numeric" className="h-8 w-24" disabled={soloLectura} value={f.mes} onChange={(e) => cambiar(i, { mes: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor={`extra-monto-${i}`} className="text-xs">Monto (USD)</Label><Input id={`extra-monto-${i}`} inputMode="decimal" className="h-8 w-32" disabled={soloLectura} value={f.monto} onChange={(e) => cambiar(i, { monto: e.target.value })} /></div>
          <span className="pb-1.5 text-xs text-muted-foreground tabular-nums">{fecha(f.mes)}</span>
          {!soloLectura && <Button type="button" size="icon-xs" variant="ghost" aria-label={`Eliminar cuota extraordinaria ${i + 1}`} onClick={() => onChange(filas.filter((_, j) => j !== i))}><Trash2 /></Button>}
        </div>
      ))}
      {!soloLectura && <Button type="button" size="xs" variant="outline" className="justify-self-start" onClick={() => onChange([...filas, { mes: '', monto: '' }])}><Plus />Agregar cuota extraordinaria</Button>}
      {filas.length > 0 && <p className="text-xs text-muted-foreground">Es un pago programado, no un pago recibido: solo Finanzas confirma los ingresos. Las cuotas mensuales se recalculan para completar exactamente el 14 %.</p>}
    </div>
  )
}

/** Cronograma por mes: cuota mensual, extraordinaria y total. */
export function TablaCronogramaMes({ filas }: { filas: CronogramaMes[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
        <tr>
          <th className="px-3 py-2 text-left font-medium">Mes</th>
          <th className="px-2 py-2 text-left font-medium">Fecha</th>
          <th className="px-2 py-2 text-right font-medium">Cuota mensual</th>
          <th className="px-2 py-2 text-right font-medium">Extraordinaria</th>
          <th className="px-3 py-2 text-right font-medium">Total del mes</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.mes} className={f.extraordinaria > 0 ? 'border-t border-border bg-secondary/40 font-medium' : 'border-t border-border'}>
            <td className="px-3 py-1.5 tabular-nums">{f.mes}</td>
            <td className="px-2 py-1.5 tabular-nums">{fmtFechaCorta(f.fecha)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(f.cuota)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{f.extraordinaria > 0 ? fmtUsd2(f.extraordinaria) : '—'}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{fmtUsd2(f.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
