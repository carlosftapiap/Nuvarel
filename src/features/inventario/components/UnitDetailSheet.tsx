import { useEffect, useState } from 'react'
import { CalendarCheck, ChevronLeft, ChevronRight, FileImage, ImageOff, Lock, PencilLine, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { dataFlags, FUENTES } from '../data/data-quality'
import { ESTADOS, ESTADOS_DE_FLUJO, ESTADOS_PRECIO_BLOQUEADO, TRANSICIONES } from '../estados'
import { calcularPrecio, fmtFecha, fmtM2, fmtNum, fmtUsd, fmtUsd2 } from '../pricing'
import { cambiarEstado } from '../service'
import { useInventory } from '../store'
import type { EstadoComercial } from '../types'
import LocationSchema from './LocationSchema'
import { Dato, EstadoBadge, FieldError, NIVEL, pisoLabel } from './shared'

export default function UnitDetailSheet({
  codigo, onClose, onNavigate, onEditPrice, onMessage,
}: {
  codigo: string | null
  onClose: () => void
  onNavigate: (codigo: string) => void
  onEditPrice: (codigo: string) => void
  onMessage: (m: string) => void
}) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  const u = state.units.find((x) => x.codigo === codigo) ?? null
  const idx = u ? state.units.indexOf(u) : -1
  const [nuevoEstado, setNuevoEstado] = useState<string>('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setNuevoEstado(''); setMotivo(''); setError(null) }, [codigo])

  if (!u) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>

  const p = calcularPrecio(u, state.params)
  const flags = dataFlags(u)
  const precioBloqueado = ESTADOS_PRECIO_BLOQUEADO.includes(u.estado)
  const historialPrecios = state.priceHistory.flatMap((h) => h.cambios.filter((c) => c.codigo === u.codigo).map((c) => ({ h, c })))
  const historialEstados = state.statusHistory.filter((s) => s.codigo === u.codigo)
  const transiciones = TRANSICIONES[u.estado]

  function guardarEstado() {
    setError(null)
    try {
      update((s) => cambiarEstado(s, u!.codigo, nuevoEstado as EstadoComercial, motivo, actor))
      onMessage(`${u!.codigo}: estado actualizado a ${ESTADOS[nuevoEstado as EstadoComercial].label}`)
      setNuevoEstado(''); setMotivo('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet open={!!codigo} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-popover/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Edificio {u.edificio} · {pisoLabel(u.piso)}</span>
            <span className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon-xs" aria-label="Unidad anterior" disabled={idx <= 0} onClick={() => onNavigate(state.units[idx - 1].codigo)}><ChevronLeft /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Unidad siguiente" disabled={idx >= state.units.length - 1} onClick={() => onNavigate(state.units[idx + 1].codigo)}><ChevronRight /></Button>
              <SheetClose asChild><Button variant="ghost" size="icon-xs" aria-label="Cerrar ficha"><X /></Button></SheetClose>
            </span>
          </div>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">
            Departamento {u.dpt} <EstadoBadge estado={u.estado} />
          </SheetTitle>
          <SheetDescription>{u.codigo} · {u.tipologia} · {u.ubicacion}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-5 py-5">
          {/* Precio */}
          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="ficha-precio">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="ficha-precio" className="text-[11px] font-medium text-muted-foreground">Precio de venta referencial</h3>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{fmtUsd(p.precioVenta)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{fmtUsd2(p.usdM2)}/m² × {fmtNum(p.areaVendibleM2)} m²{p.valorPatio ? ` + patio ${fmtUsd(p.valorPatio)}` : ''}</p>
              </div>
              {can('inventario.editar_precios') && (
                precioBloqueado
                  ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"><Lock className="size-3" />Precio congelado</span>
                  : <Button size="sm" variant="outline" onClick={() => onEditPrice(u.codigo)}><PencilLine />Modificar precio</Button>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              <Dato label="Área + bodega">{fmtUsd(p.precioAreaBodega)}</Dato>
              <Dato label="Valor patio">{p.valorPatio ? fmtUsd(p.valorPatio) : '—'}</Dato>
              <Dato label="USD/m² efectivo">{fmtNum(p.usdM2Efectivo)}</Dato>
              <Dato label="USD/m² patio">{fmtUsd(state.params.patioUsdM2)}</Dato>
            </dl>
          </section>

          {/* Plan de pagos */}
          <section aria-labelledby="ficha-pagos">
            <h3 id="ficha-pagos" className="mb-2 text-sm font-semibold">Forma de pago</h3>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Reserva', `${state.params.reservaPct}%`, fmtUsd(p.reserva), 'a la firma'],
                ['Cuotas', `${state.params.cuotasPct}%`, fmtUsd(p.cuotaMensual), `${p.meses} cuotas · total ${fmtUsd(p.cuotasTotal)}`],
                ['Contra entrega', `${p.contraEntregaPct}%`, fmtUsd(p.contraEntrega), 'financiamiento / saldo'],
              ].map(([t, pct, v, h]) => (
                <div key={t} className="rounded-lg border border-border bg-muted/40 p-2.5">
                  <div className="text-[11px] text-muted-foreground">{t} · {pct}</div>
                  <div className="mt-1 text-sm font-semibold tabular-nums">{v}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{h}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Características */}
          <section aria-labelledby="ficha-datos">
            <h3 id="ficha-datos" className="mb-2 text-sm font-semibold">Características</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border p-4 sm:grid-cols-3">
              <Dato label="Tipología">{u.tipologia}</Dato>
              <Dato label="Área departamento">{fmtM2(u.areaM2)}</Dato>
              <Dato label="Bodega">{u.bodegaCodigo ? `${u.bodegaCodigo} · ${fmtM2(u.bodegaM2)}` : 'Sin bodega'}</Dato>
              <Dato label="Área + bodega">{fmtM2(p.areaVendibleM2)}</Dato>
              <Dato label="Patio">{u.patioM2 ? fmtM2(u.patioM2) : 'Sin patio'}</Dato>
              <Dato label="Ubicación">{u.ubicacion}</Dato>
              <Dato label="Parqueo">{u.parqueo ?? 'Sin asignar'}</Dato>
            </dl>
          </section>

          {/* Datos por confirmar */}
          <section aria-labelledby="ficha-calidad">
            <h3 id="ficha-calidad" className="mb-2 text-sm font-semibold">Calidad del dato</h3>
            <ul className="grid gap-1.5">
              {flags.map((f) => {
                const N = NIVEL[f.nivel]
                return (
                  <li key={f.campo + f.mensaje} className={`flex gap-2 rounded-lg px-3 py-2 text-xs ring-1 ring-inset ${N.tone}`}>
                    <N.icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span><b>{f.campo} · {N.label}.</b> {f.mensaje}</span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 text-[10px] text-muted-foreground">Fuentes: {FUENTES.lista}; {FUENTES.bodegas}; {FUENTES.planos}.</p>
          </section>

          {/* Plano e imágenes */}
          <section aria-labelledby="ficha-plano" className="grid gap-3 sm:grid-cols-2">
            <div>
              <h3 id="ficha-plano" className="mb-2 text-sm font-semibold">Posición en el piso</h3>
              <LocationSchema unit={u} units={state.units} onSelect={onNavigate} />
            </div>
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Plano e imágenes</h3>
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                <FileImage className="mb-1 size-5" aria-hidden="true" />Plano individual pendiente
                <span className="mt-1 text-[10px]">Se cargará en el almacenamiento privado (Centro de recursos).</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                <ImageOff className="size-4" aria-hidden="true" />Sin imágenes cargadas
              </div>
            </div>
          </section>

          {/* Estado comercial */}
          <section aria-labelledby="ficha-estado" className="rounded-xl border border-border p-4">
            <h3 id="ficha-estado" className="text-sm font-semibold">Estado comercial</h3>
            <p className="mt-1 text-xs text-muted-foreground">{ESTADOS[u.estado].descripcion}.{u.reservaId ? ` Reserva vinculada: ${u.reservaId}.` : ''}</p>
            {can('inventario.cambiar_estado') ? (
              transiciones.length ? (
                <div className="mt-3 grid gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor="ficha-nuevo-estado" className="text-[11px]">Cambiar a</Label>
                    <Select value={nuevoEstado} onValueChange={setNuevoEstado}>
                      <SelectTrigger id="ficha-nuevo-estado" className="h-8 w-full text-xs"><SelectValue placeholder="Selecciona el nuevo estado" /></SelectTrigger>
                      <SelectContent>{transiciones.map((t) => <SelectItem key={t} value={t}>{ESTADOS[t].label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {ESTADOS_DE_FLUJO.includes(nuevoEstado as EstadoComercial) && (
                    <p className="flex items-center gap-1.5 text-[11px] text-amber-700"><CalendarCheck className="size-3.5" />Cuando el módulo de Reservas esté activo, este estado se registrará desde allí.</p>
                  )}
                  <Label htmlFor="ficha-motivo" className="text-[11px]">Motivo</Label>
                  <Textarea id="ficha-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Disponibilidad confirmada por Inmobiliaria Jarval" />
                  <FieldError>{error}</FieldError>
                  <Button size="sm" className="justify-self-end" disabled={!nuevoEstado || motivo.trim().length < 5} onClick={guardarEstado}>Guardar estado</Button>
                </div>
              ) : <p className="mt-2 text-xs text-muted-foreground">Estado final: no admite más cambios.</p>
            ) : <p className="mt-2 text-xs text-muted-foreground">Tu rol sólo permite consultar el estado.</p>}
          </section>

          {/* Historial */}
          <section aria-labelledby="ficha-historial">
            <h3 id="ficha-historial" className="mb-2 text-sm font-semibold">Historial de la unidad</h3>
            {historialPrecios.length + historialEstados.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin cambios desde la lista base del 28/10/2026.</p>
            ) : (
              <ol className="grid gap-2 text-xs">
                {[...historialPrecios.map(({ h, c }) => ({ fecha: h.fecha, key: h.id, texto: <>Precio {fmtUsd(c.antesPrecio)} → <b>{fmtUsd(c.despuesPrecio)}</b> (USD/m² {fmtNum(c.antesUsdM2)} → {fmtNum(c.despuesUsdM2)})</>, quien: h.usuario, motivo: h.motivo })),
                  ...historialEstados.map((s) => ({ fecha: s.fecha, key: s.id, texto: <>Estado {ESTADOS[s.de].label} → <b>{ESTADOS[s.a].label}</b></>, quien: s.usuario, motivo: s.motivo }))]
                  .sort((a, b) => b.fecha.localeCompare(a.fecha))
                  .map((e) => (
                    <li key={e.key} className="rounded-lg border border-border p-2.5">
                      <div>{e.texto}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtFecha(e.fecha)} · {e.quien} · {e.motivo}</div>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
