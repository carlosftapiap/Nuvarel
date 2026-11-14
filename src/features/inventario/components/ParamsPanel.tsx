import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FUENTES } from '../data/data-quality'
import { actualizarParametros, restablecerListaBase } from '../service'
import { useInventory } from '../store'
import type { PricingParams } from '../types'
import { FieldError } from './shared'

export default function ParamsPanel({ onMessage }: { onMessage: (m: string) => void }) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  const editable = can('inventario.parametros')
  const [form, setForm] = useState(() => toForm(state.params))
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setForm(toForm(state.params)) }, [state.params])

  const params: PricingParams = {
    patioUsdM2: Number(form.patio), reservaPct: Number(form.reserva), cuotasPct: Number(form.cuotas),
    meses: { 1: Number(form.m1), 2: Number(form.m2) },
  }
  const contra = 100 - params.reservaPct - params.cuotasPct

  function guardar() {
    setError(null)
    try { update((s) => actualizarParametros(s, params, motivo, actor)); setMotivo(''); onMessage('Parámetros de pago actualizados') }
    catch (e) { setError((e as Error).message) }
  }
  function restablecer() {
    setError(null)
    try { update((s) => restablecerListaBase(s, motivo, actor)); setMotivo(''); onMessage('Lista base del 28/10/2026 restablecida') }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="par-title">
        <div className="section-heading"><div><h2 id="par-title">Parámetros de precio y forma de pago</h2><p>{editable ? 'Sólo el administrador puede modificarlos. Cada cambio queda en el historial.' : 'Consulta. Sólo el administrador puede modificarlos.'}</p></div></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Campo id="par-patio" label="Valor del m² de patio (USD)" value={form.patio} onChange={(v) => setForm({ ...form, patio: v })} disabled={!editable} />
          <Campo id="par-reserva" label="Pago a la firma, acumulado (%)" value={form.reserva} onChange={(v) => setForm({ ...form, reserva: v })} disabled />
          <Campo id="par-cuotas" label="Cuotas durante la obra (%)" value={form.cuotas} onChange={(v) => setForm({ ...form, cuotas: v })} disabled />
          <div className="grid gap-1"><span className="text-xs text-muted-foreground">Contra entrega (calculado)</span><span className="flex h-8 items-center rounded-lg border border-border bg-muted px-3 text-sm tabular-nums">{Number.isFinite(contra) ? `${contra}%` : '—'}</span></div>
          <Campo id="par-m1" label="Meses de cuotas · Edificio 1" value={form.m1} onChange={(v) => setForm({ ...form, m1: v })} disabled={!editable} />
          <Campo id="par-m2" label="Meses de cuotas · Edificio 2" value={form.m2} onChange={(v) => setForm({ ...form, m2: v })} disabled={!editable} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">La entrada es política comercial fija: 6 % a la firma + 14 % en cuotas = 20 %; 80 % contra entrega.</p>
        {editable && (
          <div className="mt-4 grid gap-2">
            <Label htmlFor="par-motivo" className="text-xs">Motivo</Label>
            <Textarea id="par-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Nueva política comercial aprobada" />
            <FieldError>{error}</FieldError>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="sm" onClick={restablecer} disabled={motivo.trim().length < 5}><RotateCcw />Restablecer lista base</Button>
              <Button size="sm" onClick={guardar} disabled={motivo.trim().length < 5}>Guardar parámetros</Button>
            </div>
          </div>
        )}
      </section>
      <section className="dashboard-card p-5 [&_.section-heading]:p-0 text-xs leading-relaxed text-muted-foreground" aria-labelledby="par-regla">
        <div className="section-heading"><div><h2 id="par-regla">Regla de cálculo</h2><p>Igual al simulador de precios AMURA.</p></div></div>
        <ol className="mt-3 list-decimal space-y-1.5 pl-4">
          <li>Área vendible = área del departamento + bodega.</li>
          <li>Precio área + bodega = USD/m² × área vendible, redondeado al dólar.</li>
          <li>Valor patio = m² de patio × valor del m² de patio.</li>
          <li>Precio de venta = precio área + bodega + valor patio.</li>
          <li>Pago a la firma y cuotas = porcentaje del precio. La reserva se acredita al pago a la firma; no se cobra dos veces. Cuota = cuotas ÷ meses; la última ajusta los centavos.</li>
          <li>Contra entrega = precio − pago a la firma − cuotas.</li>
        </ol>
        <p className="mt-3">Fuente de la lista base: {FUENTES.lista}. Superficies verificadas con {FUENTES.bodegas} y {FUENTES.planos}.</p>
      </section>
    </div>
  )
}

const toForm = (p: PricingParams) => ({ patio: String(p.patioUsdM2), reserva: String(p.reservaPct), cuotas: String(p.cuotasPct), m1: String(p.meses[1]), m2: String(p.meses[2]) })

function Campo({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">{label}</Label>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8" />
    </div>
  )
}
