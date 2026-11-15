import { useMemo, useState } from 'react'
import { ArrowRight, Check, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { ROLES } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { FieldError, ReglaPrecios, pisoCorto } from '@/features/inventario/components/shared'
import { calcularPrecio, fmtFecha, fmtNum, fmtPct, fmtUsd, round2, totalVenta } from '@/features/inventario/pricing'
import { aprobarPropuesta, guardarCambioPrecio, previsualizarCambioPrecio, rechazarPropuesta, type Alcance, type ModoPrecio } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'
import type { Edificio, Piso, PriceProposal, Tipologia } from '@/features/inventario/types'
import { comparacionPorPiso, conteoPosiciones, posicion, POSICION_LABEL, rangoParaPiso, type Posicion, type RangoFratelli } from '@/features/precios/competencia'
import { useFratelli } from '@/features/precios/useFratelli'
import { cn } from '@/lib/utils'
import { nombreEdificio } from '@/features/inventario/nomenclatura'

const POS_TONE: Record<Posicion, string> = {
  bajo: 'bg-sky-50 text-sky-700 ring-sky-200',
  dentro: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sobre: 'bg-amber-50 text-amber-800 ring-amber-200',
}
const PosBadge = ({ p }: { p: Posicion }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${POS_TONE[p]}`}>{POSICION_LABEL[p]}</span>

export default function PreciosPage() {
  const { state } = useInventory()
  const { can } = useSession()
  const pendientes = state.propuestas.filter((p) => p.estado === 'pendiente').length
  const fratelli = useFratelli()
  return (
    <>
      <PageHeader eyebrow="Ventas · Precios" title="Precios dinámicos"
        subtitle="Simula cambios de precio por m² o porcentuales sin alterar los precios oficiales hasta su aprobación." />
      <Tabs defaultValue="simulacion" className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="simulacion">Simulación</TabsTrigger>
          <TabsTrigger value="propuestas">Propuestas{pendientes ? ` (${pendientes})` : ''}</TabsTrigger>
          {can('precios.competencia') && <TabsTrigger value="competencia">Competencia FRATELLI</TabsTrigger>}
        </TabsList>
        <TabsContent value="simulacion" className="min-w-0"><Simulacion rangos={fratelli.rangos} /></TabsContent>
        <TabsContent value="propuestas" className="min-w-0"><Propuestas /></TabsContent>
        {can('precios.competencia') && <TabsContent value="competencia" className="min-w-0"><Competencia fratelli={fratelli} /></TabsContent>}
      </Tabs>
    </>
  )
}

/* ------------------------------------------------------------------ simulación */

function Simulacion({ rangos }: { rangos: Record<string, RangoFratelli> | null }) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  // Sin valor inicial: el edificio se elige, también para simular.
  const [edificio, setEdificio] = useState('')
  const [piso, setPiso] = useState('todos')
  const [tipologia, setTipologia] = useState('todos')
  const [modo, setModo] = useState<ModoPrecio>('porcentaje')
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const alcance: Alcance = {
    edificio: edificio === 'todos' ? undefined : (Number(edificio) as Edificio),
    piso: piso === 'todos' ? undefined : (piso as Piso),
    tipologia: tipologia === 'todos' ? undefined : (tipologia as Tipologia),
  }
  const numero = Number(valor.replace(',', '.'))
  const preview = useMemo(() => {
    if (!valor.trim() || !edificio) return { data: null, error: null }
    try { return { data: previsualizarCambioPrecio(state, { alcance, modo, valor: numero, motivo: '' }), error: null } }
    catch (e) { return { data: null, error: (e as Error).message } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, edificio, piso, tipologia, modo, valor])

  const totalActual = totalVenta(state.units, state.params)
  const totalNuevo = preview.data ? round2(totalActual - preview.data.totalAntes + preview.data.totalDespues) : totalActual
  const porCodigo = new Map(state.units.map((u) => [u.codigo, u]))

  function proponer() {
    setError(null); setOk(null)
    try {
      update((s) => guardarCambioPrecio(s, { alcance, modo, valor: numero, motivo }, actor))
      setOk(can('precios.aprobar') ? 'Cambio aplicado: ya es el precio oficial.' : 'Propuesta enviada a aprobación. Los precios oficiales no cambian hasta que administración la apruebe.')
      setValor(''); setMotivo('')
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <section className="dashboard-card p-5 grid content-start gap-4" aria-label="Parámetros de la simulación">
        <div className="grid gap-2">
          <span className="text-xs font-medium">Alcance</span>
          <Sel id="sim-ed" label="Edificio" placeholder="Elige el edificio" value={edificio} onChange={setEdificio} items={[['todos', 'Ambos edificios'], ['1', 'Edificio A'], ['2', 'Edificio B']]} />
          <Sel id="sim-piso" label="Piso" value={piso} onChange={setPiso} items={[['todos', 'Todos los pisos'], ['PB', 'Planta baja'], ['1', 'Piso 1'], ['2', 'Piso 2'], ['3', 'Piso 3'], ['4', 'Piso 4'], ['5', 'Piso 5']]} />
          <Sel id="sim-tip" label="Tipología" value={tipologia} onChange={setTipologia} items={[['todos', 'Todas'], ['1 hab', '1 hab'], ['2 hab', '2 hab'], ['2 hab + estudio', '2 hab + estudio']]} />
        </div>
        <div className="grid gap-2">
          <span className="text-xs font-medium">Tipo de cambio</span>
          <div className="flex gap-2">
            {(['porcentaje', 'fijar'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={modo === m} onClick={() => { setModo(m); setValor('') }}
                className={cn('flex-1 rounded-lg border px-3 py-1.5 text-xs', modo === m ? 'border-primary bg-secondary text-secondary-foreground' : 'border-border hover:bg-muted')}>
                {m === 'porcentaje' ? 'Incremento / descuento %' : 'Fijar USD/m²'}
              </button>
            ))}
          </div>
          <Label htmlFor="sim-valor" className="text-xs text-muted-foreground">{modo === 'porcentaje' ? 'Porcentaje (negativo para reducir)' : 'Nuevo USD/m²'}</Label>
          <Input id="sim-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={modo === 'porcentaje' ? 'Ej. 2 o -1,5' : 'Ej. 2300'} className="h-9" />
        </div>
        {!edificio && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Elige el edificio para simular o preparar el cambio.</p>}
        <FieldError>{preview.error}</FieldError>
        {can('precios.proponer') ? (
          <div className="grid gap-2">
            <ReglaPrecios />
            <Label htmlFor="sim-motivo" className="text-xs">Motivo del cambio</Label>
            <Textarea id="sim-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Alinear piso 1 del Edificio B con FRATELLI" />
            <FieldError>{error}</FieldError>
            {ok && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{ok}</p>}
            <Button onClick={proponer} disabled={!preview.data?.cambios.length || motivo.trim().length < 5}>{can('precios.aprobar') ? 'Aplicar cambio' : 'Enviar a aprobación'}</Button>
          </div>
        ) : <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Puedes simular; solo gerencia y administración envían propuestas.</p>}
      </section>

      <div className="grid min-w-0 content-start gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi t="Valor del inventario (oficial)" v={fmtUsd(totalActual)} />
          <Kpi t="Valor simulado" v={fmtUsd(totalNuevo)} d={preview.data ? `${totalNuevo >= totalActual ? '+' : ''}${fmtUsd(totalNuevo - totalActual)} (${fmtPct(round2((totalNuevo / totalActual - 1) * 100))})` : 'Sin cambios'} />
          <Kpi t="Unidades afectadas" v={String(preview.data?.cambios.length ?? 0)} d={preview.data?.omitidas.length ? `${preview.data.omitidas.length} con precio congelado` : 'Reservadas, prometidas o vendidas no cambian'} />
        </div>
        <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="sim-tabla">
          <h2 id="sim-tabla" className="border-b border-border px-4 py-3 text-sm font-semibold">Impacto por departamento</h2>
          {!preview.data ? <p className="p-6 text-center text-xs text-muted-foreground">Define un alcance y un valor para ver el impacto en cada departamento.</p> : (
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left font-medium">Unidad</th><th className="px-2 py-2 text-right font-medium">USD/m²</th><th className="px-2 py-2 text-right font-medium">Precio oficial</th><th className="px-2 py-2 text-right font-medium">Precio simulado</th><th className="px-2 py-2 text-right font-medium">Variación</th>{can('precios.competencia') && <th className="px-4 py-2 text-left font-medium">vs FRATELLI</th>}</tr>
                </thead>
                <tbody>
                  {preview.data.cambios.map((c) => {
                    const u = porCodigo.get(c.codigo)!
                    const nuevoComp = calcularPrecio({ ...u, usdM2: c.despuesUsdM2 }, state.params)
                    const pos = rangos ? posicion(nuevoComp.precioAreaBodega / nuevoComp.areaVendibleM2, rangoParaPiso(u.piso, rangos)) : null
                    return (
                      <tr key={c.codigo} className="border-t border-border">
                        <td className="px-4 py-1.5"><b>{u.dpt}</b> <span className="text-muted-foreground">{nombreEdificio(u.edificio)} · {pisoCorto(u.piso)} · {u.tipologia}</span></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(c.antesUsdM2)} → <b>{fmtNum(c.despuesUsdM2)}</b></td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd(c.antesPrecio)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmtUsd(c.despuesPrecio)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${c.despuesPrecio >= c.antesPrecio ? 'text-emerald-700' : 'text-rose-700'}`}>{c.despuesPrecio >= c.antesPrecio ? '+' : ''}{fmtUsd(c.despuesPrecio - c.antesPrecio)}</td>
                        {can('precios.competencia') && <td className="px-4 py-1.5">{pos ? <PosBadge p={pos} /> : <span className="text-muted-foreground">—</span>}</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ propuestas */

function Propuestas() {
  const { state } = useInventory()
  if (!state.propuestas.length) return <div className="module-empty"><h2 className="text-lg font-semibold">Sin propuestas</h2><p className="mt-2 text-sm text-muted-foreground">Las propuestas creadas en la simulación aparecerán aquí para su aprobación.</p></div>
  return <div className="grid gap-3">{state.propuestas.map((p) => <PropuestaCard key={p.id} p={p} />)}</div>
}

function PropuestaCard({ p }: { p: PriceProposal }) {
  const { update } = useInventory()
  const { actor, can } = useSession()
  const [comentario, setComentario] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ver, setVer] = useState(false)
  const delta = p.totalDespues - p.totalAntes
  const run = (fn: () => void) => { setError(null); try { fn() } catch (e) { setError((e as Error).message) } }
  const tono = p.estado === 'pendiente' ? 'bg-amber-50 text-amber-800 ring-amber-200' : p.estado === 'aprobada' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-rose-200'
  return (
    <article className="dashboard-card !p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${tono}`}>{p.estado}</span>
        <h3 className="text-sm font-semibold">{p.descripcion}</h3>
        <span className={`ml-auto text-sm font-semibold tabular-nums ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta >= 0 ? '+' : ''}{fmtUsd(delta)}</span>
        <p className="basis-full text-xs text-muted-foreground">{fmtFecha(p.fecha)} · {p.usuario} ({ROLES[p.rol].label}) · “{p.motivo}” · {p.cambios.length} unidades · {fmtUsd(p.totalAntes)} <ArrowRight className="inline size-3" /> {fmtUsd(p.totalDespues)}</p>
        {p.resolucion && <p className="basis-full text-xs text-muted-foreground">Resuelta por {p.resolucion.usuario} el {fmtFecha(p.resolucion.fecha)}{p.resolucion.comentario ? ` · “${p.resolucion.comentario}”` : ''}</p>}
      </div>
      <button type="button" className="mt-2 text-xs text-primary hover:underline" onClick={() => setVer(!ver)} aria-expanded={ver}>{ver ? 'Ocultar detalle' : 'Ver detalle por unidad'}</button>
      {ver && (
        <div className="mt-2 max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full text-xs"><tbody>
            {p.cambios.map((c) => <tr key={c.codigo} className="border-t border-border first:border-0"><td className="p-1.5">{c.codigo}</td><td className="p-1.5 text-right tabular-nums">{fmtNum(c.antesUsdM2)} → {fmtNum(c.despuesUsdM2)}</td><td className="p-1.5 text-right tabular-nums">{fmtUsd(c.antesPrecio)} → <b>{fmtUsd(c.despuesPrecio)}</b></td></tr>)}
          </tbody></table>
        </div>
      )}
      {p.estado === 'pendiente' && (can('precios.aprobar') ? (
        <div className="mt-3 grid gap-2 border-t border-border pt-3">
          <Label htmlFor={`com-${p.id}`} className="text-xs">Comentario (obligatorio para rechazar)</Label>
          <Textarea id={`com-${p.id}`} rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} />
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => run(() => update((s) => rechazarPropuesta(s, p.id, comentario, actor)))}><X />Rechazar</Button>
            <Button size="sm" onClick={() => run(() => update((s) => aprobarPropuesta(s, p.id, comentario, actor)))}><Check />Aprobar y aplicar</Button>
          </div>
          <p className="text-xs text-muted-foreground">Al aprobar, el cambio se recalcula sobre los precios vigentes y queda en el historial de precios.</p>
        </div>
      ) : <p className="mt-2 text-xs text-muted-foreground">Pendiente de aprobación por administración.</p>)}
    </article>
  )
}

/* ------------------------------------------------------------------ competencia */

function Competencia({ fratelli }: { fratelli: ReturnType<typeof useFratelli> }) {
  const { state } = useInventory()
  const { lista, error, rangos, total } = fratelli
  const filas = useMemo(() => (rangos ? comparacionPorPiso(state.units, state.params, rangos) : []), [state, rangos])
  if (error) return <FieldError>{error}</FieldError>
  if (!lista || !rangos || !total) return <p className="text-sm text-muted-foreground">Cargando competencia…</p>
  const conteo = conteoPosiciones(state.units, state.params, rangos)
  const min = 2000, max = 2650
  const pct = (v: number) => `${((v - min) / (max - min)) * 100}%`
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi t="FRATELLI · rango de precio" v={`${fmtUsd(total.precioMin)} – ${fmtUsd(total.precioMax)}`} d={`${lista.length} unidades`} />
        <Kpi t="FRATELLI · USD/m²" v={`${fmtNum(total.m2Min)} – ${fmtNum(total.m2Max)}`} d="Precio / (dpto + bodega)" />
        <Kpi t="AMURA · USD/m² promedio" v={fmtNum(filas.reduce((t, f) => t + f.amuraM2 * f.unidades, 0) / filas.reduce((t, f) => t + f.unidades, 0))} d="Área + bodega, sin patio" />
        <Kpi t="AMURA frente al rango" v={`${conteo.bajo} · ${conteo.dentro} · ${conteo.sobre}`} d="Bajo · dentro · sobre (por unidad)" />
      </div>
      <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="comp-pisos">
        <div className="section-heading"><div><h2 id="comp-pisos">USD/m² por piso: AMURA vs. rango FRATELLI</h2><p>FRATELLI llega al piso 3; los pisos 4 y 5 de AMURA se comparan con su piso 3.</p></div></div>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {([1, 2] as const).map((ed) => (
            <div key={ed} className="grid gap-2">
              <h3 className="text-xs font-semibold">{nombreEdificio(ed)}</h3>
              {filas.filter((f) => f.edificio === ed).map((f) => (
                <div key={f.piso} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-xs">
                  <span className="text-muted-foreground">{f.piso === 'PB' ? 'Planta baja' : `Piso ${f.piso}`}</span>
                  <div className="relative h-5 rounded bg-muted" aria-label={`AMURA ${fmtNum(f.amuraM2)}; FRATELLI ${fmtNum(f.rango.m2Min)} a ${fmtNum(f.rango.m2Max)}`}>
                    <span className="absolute inset-y-0.5 rounded bg-sky-200" style={{ left: pct(f.rango.m2Min), width: `calc(${pct(f.rango.m2Max)} - ${pct(f.rango.m2Min)})` }} />
                    <span className="absolute inset-y-0 w-1.5 -translate-x-1/2 rounded bg-primary" style={{ left: pct(f.amuraM2) }} />
                  </div>
                  <span className="w-28 text-right"><b className="tabular-nums">{fmtNum(f.amuraM2)}</b> <PosBadge p={f.posicion} /></span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span><i className="mr-1 inline-block size-2 rounded-sm bg-primary" />AMURA (promedio del piso)</span><span><i className="mr-1 inline-block size-2 rounded-sm bg-sky-200" />FRATELLI: mínimo a máximo del mismo piso</span></p>
      </section>
      <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="comp-lista">
        <h2 id="comp-lista" className="border-b border-border px-4 py-3 text-sm font-semibold">Lista de precios FRATELLI (Isla Celeste)</h2>
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Torre · Depto</th><th className="px-2 py-2 text-left font-medium">Planta</th><th className="px-2 py-2 text-right font-medium">Dpto + bodega</th><th className="px-2 py-2 text-right font-medium">Patio</th><th className="px-2 py-2 text-right font-medium">Precio total</th><th className="px-2 py-2 text-right font-medium">USD/m²</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-4 py-2 text-left font-medium">Entrega est.</th></tr></thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.torre + f.depto} className="border-t border-border">
                  <td className="px-4 py-1.5">{f.torre} · {f.depto} <span className="text-muted-foreground">Modelo {f.modelo}</span></td>
                  <td className="px-2 py-1.5">{f.planta}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(f.dptoM2 + f.bodegaM2)} m²</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{f.patioM2 ? `${fmtNum(f.patioM2)} m²` : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{fmtUsd(f.precioTotal)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(f.precioTotal / (f.dptoM2 + f.bodegaM2))}</td>
                  <td className="px-2 py-1.5">{f.estado}</td>
                  <td className="px-4 py-1.5 tabular-nums">{f.entregaEstimada}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Fuente: {lista[0]?.fuente ?? ''}. Uso interno: no visible para corredores externos.</p>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ comunes */

function Kpi({ t, v, d }: { t: string; v: string; d?: string }) {
  return (
    <div className="dashboard-card !p-4">
      <div className="text-xs text-muted-foreground">{t}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums tracking-tight">{v}</div>
      {d && <div className="mt-0.5 text-xs text-muted-foreground">{d}</div>}
    </div>
  )
}

function Sel({ id, label, value, onChange, items, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; items: [string, string][]; placeholder?: string }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 w-full text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
