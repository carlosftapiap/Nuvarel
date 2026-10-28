import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Percent, Ruler } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { fmtNum, fmtPct, fmtUsd } from '../pricing'
import { aplicarCambioPrecio, crearPropuesta, describirAlcance, previsualizarCambioPrecio, type Alcance, type ModoPrecio } from '../service'
import { useInventory } from '../store'
import type { Edificio, Piso, Tipologia } from '../types'
import { FieldError } from './shared'

type TipoAlcance = 'seleccion' | 'filtro'

export default function PriceAdjustDialog({
  open, onOpenChange, codigos, onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Unidades preseleccionadas (una ficha o la selección de la tabla). */
  codigos: string[]
  onDone?: (mensaje: string) => void
}) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  const [tipo, setTipo] = useState<TipoAlcance>('filtro')
  const [edificio, setEdificio] = useState('todos')
  const [piso, setPiso] = useState('todos')
  const [tipologia, setTipologia] = useState('todos')
  const [modo, setModo] = useState<ModoPrecio>('porcentaje')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTipo(codigos.length ? 'seleccion' : 'filtro')
    setValor(codigos.length === 1 ? String(state.units.find((u) => u.codigo === codigos[0])?.usdM2 ?? '') : '')
    setModo(codigos.length === 1 ? 'fijar' : 'porcentaje')
    setMotivo('')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const alcance: Alcance = tipo === 'seleccion'
    ? { codigos }
    : {
        edificio: edificio === 'todos' ? undefined : (Number(edificio) as Edificio),
        piso: piso === 'todos' ? undefined : (piso as Piso),
        tipologia: tipologia === 'todos' ? undefined : (tipologia as Tipologia),
      }
  const numero = Number(valor.replace(',', '.'))
  const preview = useMemo(() => {
    if (!valor.trim()) return { error: null, data: null }
    try {
      return { error: null, data: previsualizarCambioPrecio(state, { alcance, modo, valor: numero, motivo }) }
    } catch (e) {
      return { error: (e as Error).message, data: null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tipo, edificio, piso, tipologia, modo, valor, codigos])

  const permitido = can('inventario.editar_precios')
  const aprueba = can('precios.aprobar')
  const delta = preview.data ? preview.data.totalDespues - preview.data.totalAntes : 0

  function aplicar() {
    setError(null)
    try {
      const input = { alcance, modo, valor: numero, motivo }
      if (aprueba) {
        update((s) => aplicarCambioPrecio(s, input, actor))
        onDone?.(`Precio actualizado en ${preview.data?.cambios.length ?? 0} unidades · ${describirAlcance(alcance)}`)
      } else {
        update((s) => crearPropuesta(s, input, actor))
        onDone?.(`Propuesta enviada a aprobación: ${preview.data?.cambios.length ?? 0} unidades · ${describirAlcance(alcance)}. Los precios oficiales no cambian hasta que se apruebe.`)
      }
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modificar precio por m²</DialogTitle>
          <DialogDescription>El precio de venta se recalcula como USD/m² × (área + bodega) + patio. Las unidades reservadas, prometidas o vendidas no se modifican. {aprueba ? 'Como administrador, el cambio queda oficial al aplicarlo.' : 'Tu cambio se enviará como propuesta; los precios oficiales no cambian hasta que administración lo apruebe.'}</DialogDescription>
        </DialogHeader>

        {!permitido ? (
          <FieldError>Tu rol actual no puede modificar precios. Solicita la aprobación de gerencia.</FieldError>
        ) : (
          <div className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-xs font-medium">Alcance</legend>
              <div className="flex flex-wrap gap-2">
                {codigos.length > 0 && (
                  <Opcion activo={tipo === 'seleccion'} onClick={() => setTipo('seleccion')}>
                    {codigos.length === 1 ? `Unidad ${codigos[0]}` : `${codigos.length} unidades seleccionadas`}
                  </Opcion>
                )}
                <Opcion activo={tipo === 'filtro'} onClick={() => setTipo('filtro')}>Por edificio, piso o tipología</Opcion>
              </div>
              {tipo === 'filtro' && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Sel id="adj-ed" label="Edificio" value={edificio} onChange={setEdificio} items={[['todos', 'Ambos edificios'], ['1', 'Edificio 1'], ['2', 'Edificio 2']]} />
                  <Sel id="adj-piso" label="Piso" value={piso} onChange={setPiso} items={[['todos', 'Todos los pisos'], ['PB', 'Planta baja'], ['1', 'Piso 1'], ['2', 'Piso 2'], ['3', 'Piso 3'], ['4', 'Piso 4'], ['5', 'Piso 5']]} />
                  <Sel id="adj-tip" label="Tipología" value={tipologia} onChange={setTipologia} items={[['todos', 'Todas'], ['1 hab', '1 hab'], ['2 hab', '2 hab'], ['2 hab + estudio', '2 hab + estudio']]} />
                </div>
              )}
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-xs font-medium">Tipo de cambio</legend>
              <div className="flex flex-wrap gap-2">
                <Opcion activo={modo === 'porcentaje'} onClick={() => { setModo('porcentaje'); setValor('') }}><Percent className="size-3.5" />Incremento o descuento %</Opcion>
                <Opcion activo={modo === 'fijar'} onClick={() => { setModo('fijar'); setValor('') }}><Ruler className="size-3.5" />Fijar USD/m²</Opcion>
              </div>
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="adj-valor" className="text-xs">{modo === 'porcentaje' ? 'Porcentaje (use negativo para descuento)' : 'Nuevo precio por m² (USD)'}</Label>
                <Input id="adj-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={modo === 'porcentaje' ? 'Ej. 3 o -2' : 'Ej. 2300'} />
              </div>
            </fieldset>

            {preview.error && <FieldError>{preview.error}</FieldError>}
            {preview.data && (
              <section aria-live="polite" className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span><b>{preview.data.cambios.length}</b> unidades cambian</span>
                  {preview.data.omitidas.length > 0 && <span className="text-amber-700">{preview.data.omitidas.length} omitidas (precio congelado)</span>}
                  <span className="ml-auto flex items-center gap-1.5 tabular-nums">{fmtUsd(preview.data.totalAntes)}<ArrowRight className="size-3" /><b>{fmtUsd(preview.data.totalDespues)}</b>
                    <span className={delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}>({delta >= 0 ? '+' : ''}{fmtUsd(delta)})</span></span>
                </div>
                {preview.data.cambios.length > 0 && (
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-border bg-card">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-card text-muted-foreground"><tr><th className="p-1.5 text-left font-medium">Unidad</th><th className="p-1.5 text-right font-medium">USD/m²</th><th className="p-1.5 text-right font-medium">Precio</th><th className="p-1.5 text-right font-medium">Variación</th></tr></thead>
                      <tbody>
                        {preview.data.cambios.map((c) => (
                          <tr key={c.codigo} className="border-t border-border">
                            <td className="p-1.5">{c.codigo}</td>
                            <td className="p-1.5 text-right tabular-nums">{fmtNum(c.antesUsdM2)} → <b>{fmtNum(c.despuesUsdM2)}</b></td>
                            <td className="p-1.5 text-right tabular-nums">{fmtUsd(c.antesPrecio)} → <b>{fmtUsd(c.despuesPrecio)}</b></td>
                            <td className="p-1.5 text-right tabular-nums">{fmtPct(Math.round((c.despuesPrecio / c.antesPrecio - 1) * 10000) / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="adj-motivo" className="text-xs">Motivo del cambio (queda en el historial)</Label>
              <Textarea id="adj-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Ajuste aprobado por gerencia en comité del 28/10/2026" rows={2} />
            </div>
            <FieldError>{error}</FieldError>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {permitido && <Button onClick={aplicar} disabled={!preview.data?.cambios.length || motivo.trim().length < 5}>{aprueba ? 'Aplicar cambio' : 'Enviar a aprobación'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Opcion({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={activo}
      className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors', activo ? 'border-primary bg-secondary text-secondary-foreground' : 'border-border hover:bg-muted')}>
      {children}
    </button>
  )
}

function Sel({ id, label, value, onChange, items }: { id: string; label: string; value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
