import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, FileImage, ImageOff, Lock, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { dataFlags, ESTADO_DOCUMENTO, estadoDocumento, FUENTES } from '../data/data-quality'
import { ESTADOS, ESTADOS_EFECTIVOS, ESTADOS_PRECIO_BLOQUEADO, estadoEfectivo, MOTIVO_SIN_CAMBIO, TRANSICIONES_MANUALES } from '../estados'
import { calcularPrecio, etiquetaPagoFirma, fmtCuotas, fmtFecha, fmtM2, fmtNum, fmtPct, fmtUsd, fmtUsd2, NOTA_RESERVA, RESERVA_PREDETERMINADA, round2, type PriceBreakdown } from '../pricing'
import { cambiarEstado, estadoPrecio, guardarCambioPrecio, previsualizarCambioPrecio } from '../service'
import { useInventory } from '../store'
import type { EstadoComercial, Unit } from '../types'
import { TIPO, TrazaTexto } from './HistoryPanel'
import LocationSchema from './LocationSchema'
import { Dato, ETIQUETA_PRECIO, EstadoBadge, FieldError, NIVEL, pisoLabel, ReglaPrecios } from './shared'

export default function UnitDetailSheet({
  codigo, onClose, onNavigate, onMessage, mensaje,
}: {
  codigo: string | null
  onClose: () => void
  onNavigate: (codigo: string) => void
  onMessage: (m: string) => void
  /** Confirmación de la última acción: se muestra dentro de la ficha, que tapa el resto de la página. */
  mensaje?: string | null
}) {
  const { state } = useInventory()
  const { can } = useSession()
  const u = state.units.find((x) => x.codigo === codigo) ?? null
  const idx = u ? state.units.indexOf(u) : -1

  if (!u) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>

  const p = calcularPrecio(u, state.params)
  const flags = dataFlags(u)
  const precioBloqueado = ESTADOS_PRECIO_BLOQUEADO.includes(u.estado)
  const vigencia = estadoPrecio(state.priceHistory, u.codigo)
  const historialPrecios = state.priceHistory.flatMap((h) => h.cambios.filter((c) => c.codigo === u.codigo).map((c) => ({ h, c })))
  const historialEstados = state.statusHistory.filter((s) => s.codigo === u.codigo)

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
            Departamento {u.dpt} <EstadoBadge estado={estadoEfectivo(u)} />
          </SheetTitle>
          <SheetDescription>{u.codigo} · {u.tipologia} · {u.ubicacion}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-5 py-5">
          {mensaje && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4 shrink-0" />{mensaje}</p>}

          {/* 1. Disponibilidad */}
          <EstadoComercialSeccion key={`estado-${u.codigo}`} u={u} onMessage={onMessage} />

          {/* 2. Precio y simulador */}
          <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="ficha-precio">
            <h3 id="ficha-precio" className="text-[11px] font-medium text-muted-foreground">
              Precio de venta · <span className={ETIQUETA_PRECIO[vigencia.tipo].tono}>{ETIQUETA_PRECIO[vigencia.tipo].label}</span> · vigente desde {fmtFechaCorta(vigencia.fecha)}
            </h3>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{fmtUsd(p.precioVenta)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{fmtUsd2(p.usdM2)}/m² × {fmtNum(p.areaVendibleM2)} m² (área + bodega){p.valorPatio ? ` + patio ${fmtUsd(p.valorPatio)}` : ''}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              <Dato label="Área + bodega">{fmtUsd(p.precioAreaBodega)}</Dato>
              <Dato label="Valor patio">{p.valorPatio ? fmtUsd(p.valorPatio) : '—'}</Dato>
              <Dato label="USD/m² efectivo">{fmtNum(p.usdM2Efectivo)}</Dato>
              <Dato label="USD/m² patio">{fmtUsd(state.params.patioUsdM2)}</Dato>
            </dl>
            {can('inventario.editar_precios') && (
              precioBloqueado
                ? <p className="mt-3 flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground"><Lock className="size-3 shrink-0" />Precio congelado: la unidad está {ESTADOS[u.estado].label.toLowerCase()}.</p>
                : <SimuladorPrecio key={`precio-${u.codigo}`} u={u} actual={p} onMessage={onMessage} />
            )}
          </section>

          {/* 3. Forma de pago */}
          <FormaPago key={`pago-${u.codigo}`} p={p} firmaPct={state.params.reservaPct} cuotasPct={state.params.cuotasPct} />

          {/* 4. Características */}
          <section aria-labelledby="ficha-datos">
            <h3 id="ficha-datos" className="mb-2 text-sm font-semibold">Características y superficies</h3>
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

          {/* 5. Plano e imágenes */}
          <section aria-labelledby="ficha-plano" className="grid gap-3 sm:grid-cols-2">
            <div>
              <h3 id="ficha-plano" className="mb-2 text-sm font-semibold">Ubicación orientativa</h3>
              <LocationSchema unit={u} units={state.units} onSelect={onNavigate} />
            </div>
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Plano e imágenes</h3>
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                <FileImage className="mb-1 size-5" aria-hidden="true" /><span className="flex items-center gap-1.5">Plano individual <DocEstado cargado={!!u.planoPath} /></span>
              </div>
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
                <ImageOff className="size-4" aria-hidden="true" />Imágenes <DocEstado cargado={u.imagenes.length > 0} />
              </div>
            </div>
          </section>

          {/* 6. Pendientes e historial */}
          <section aria-labelledby="ficha-calidad">
            <h3 id="ficha-calidad" className="mb-2 text-sm font-semibold">Pendientes de información</h3>
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

          <section aria-labelledby="ficha-historial">
            <h3 id="ficha-historial" className="mb-2 text-sm font-semibold">Historial de la unidad</h3>
            {historialPrecios.length + historialEstados.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin cambios desde la lista base del 28/10/2026.</p>
            ) : (
              <ol className="grid gap-2 text-xs">
                {[...historialPrecios.map(({ h, c }) => ({ fecha: h.fecha, key: h.id, origen: TIPO[h.tipo], texto: <>Precio {fmtUsd(c.antesPrecio)} → <b>{fmtUsd(c.despuesPrecio)}</b> (USD/m² {fmtNum(c.antesUsdM2)} → {fmtNum(c.despuesUsdM2)})</>, quien: null, traza: h, motivo: h.motivo })),
                  ...historialEstados.map((s) => ({ fecha: s.fecha, key: s.id, origen: 'Cambio de estado', texto: <>Estado {ESTADOS[s.de].label} → <b>{ESTADOS[s.a].label}</b></>, quien: s.usuario, traza: null, motivo: s.motivo }))]
                  .sort((a, b) => b.fecha.localeCompare(a.fecha))
                  .map((e) => (
                    <li key={e.key} className="rounded-lg border border-border p-2.5">
                      <div>{e.texto}</div>
                      {e.traza && <div className="mt-1 grid"><TrazaTexto h={e.traza} propuestas={state.propuestas} /></div>}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{e.origen} · {fmtFecha(e.fecha)}{e.quien ? ` · ${e.quien}` : ''} · {e.motivo}</div>
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

function EstadoComercialSeccion({ u, onMessage }: { u: Unit; onMessage: (m: string) => void }) {
  const { update } = useInventory()
  const { actor, can } = useSession()
  const [nuevoEstado, setNuevoEstado] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const opciones = TRANSICIONES_MANUALES[u.estado]

  function guardar() {
    setError(null)
    try {
      update((s) => cambiarEstado(s, u.codigo, nuevoEstado as EstadoComercial, motivo, actor))
      onMessage(`Departamento ${u.dpt}: estado actualizado a ${ESTADOS[nuevoEstado as EstadoComercial].label}`)
      setNuevoEstado(''); setMotivo('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section aria-labelledby="ficha-estado" className="rounded-xl border border-border p-4">
      <h3 id="ficha-estado" className="text-sm font-semibold">Disponibilidad</h3>
      <p className="mt-1 text-xs text-muted-foreground"><b className="text-foreground">{ESTADOS_EFECTIVOS[estadoEfectivo(u)].label}.</b> {ESTADOS_EFECTIVOS[estadoEfectivo(u)].descripcion}.</p>
      {u.solicitud && estadoEfectivo(u) === 'en_proceso_reserva' && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
          Solicitud {u.solicitud.codigo}{u.solicitud.vigenciaHasta && u.solicitud.vigenciaHasta < hoyGuayaquil() ? ' · cotización vencida: sigue activa hasta que se anule en Reservas' : ''}.
          {u.solicitud.cotizacionId && can('cotizaciones.crear') && <Button size="xs" variant="outline" asChild><Link to={`/venta?cotizacion=${u.solicitud.cotizacionId}`}>Continuar operación</Link></Button>}
        </p>
      )}
      {!can('inventario.cambiar_estado') ? <p className="mt-2 text-xs text-muted-foreground">Tu rol solo permite consultar el estado.</p>
        : opciones.length === 0 ? <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3 shrink-0" />{MOTIVO_SIN_CAMBIO[u.estado]}</p>
        : (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium">Solicitar cambio de estado</summary>
            <div className="mt-3 grid gap-2">
              <div className="grid gap-1">
                <Label htmlFor="ficha-nuevo-estado" className="text-[11px]">Cambiar a</Label>
                <Select value={nuevoEstado} onValueChange={setNuevoEstado}>
                  <SelectTrigger id="ficha-nuevo-estado" className="h-8 w-full text-xs"><SelectValue placeholder="Selecciona el nuevo estado" /></SelectTrigger>
                  <SelectContent>{opciones.map((t) => <SelectItem key={t} value={t}>{ESTADOS[t].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {nuevoEstado && <p className="flex flex-wrap items-center gap-1.5 text-[11px]">{ESTADOS[u.estado].label}<ArrowRight className="size-3" aria-hidden="true" /><b>{ESTADOS[nuevoEstado as EstadoComercial].label}</b><span className="text-muted-foreground">· Responsable: {actor.nombre}</span></p>}
              <Label htmlFor="ficha-motivo" className="text-[11px]">Motivo</Label>
              <Textarea id="ficha-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Disponibilidad confirmada por Inmobiliaria Jarval" />
              <FieldError>{error}</FieldError>
              <Button size="sm" className="justify-self-end" disabled={!nuevoEstado || motivo.trim().length < 5} onClick={guardar}>Guardar estado</Button>
            </div>
          </details>
        )}
    </section>
  )
}

/** Edita el USD/m² dentro de la ficha: se ve el resultado al escribir y nada cambia hasta guardar. */
function SimuladorPrecio({ u, actual, onMessage }: { u: Unit; actual: PriceBreakdown; onMessage: (m: string) => void }) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const aprueba = can('precios.aprobar')
  const numero = Number(valor.replace(',', '.'))
  const input = useMemo(() => ({ alcance: { codigos: [u.codigo] }, modo: 'fijar' as const, valor: numero, motivo: '' }), [u.codigo, numero])
  const preview = useMemo(() => {
    if (!valor.trim()) return { error: null, cambia: false }
    try {
      return { error: null, cambia: previsualizarCambioPrecio(state, input).cambios.length > 0 }
    } catch (e) {
      return { error: (e as Error).message, cambia: false }
    }
  }, [state, input, valor])
  const sim = preview.cambia ? calcularPrecio({ ...u, usdM2: round2(numero) }, state.params) : null
  const diferencia = sim ? round2(sim.precioVenta - actual.precioVenta) : 0

  function descartar() {
    setValor(''); setMotivo(''); setError(null)
  }
  function guardar() {
    setError(null)
    try {
      update((s) => guardarCambioPrecio(s, { ...input, motivo }, actor))
      onMessage(aprueba
        ? `Departamento ${u.dpt}: precio actualizado a ${fmtUsd(sim!.precioVenta)}`
        : `Departamento ${u.dpt}: propuesta enviada a aprobación. El precio oficial no cambia hasta que se apruebe.`)
      descartar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="ficha-usd-m2" className="text-xs font-medium">Simular nuevo USD/m²</Label>
        {sim && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Cambios sin guardar</span>}
      </div>
      <Input id="ficha-usd-m2" inputMode="decimal" className="h-9 sm:max-w-40" value={valor} placeholder={fmtNum(u.usdM2)} onChange={(e) => setValor(e.target.value)} />
      <FieldError>{preview.error}</FieldError>
      {valor.trim() && !preview.error && !sim && <p className="text-[11px] text-muted-foreground">Es el precio por m² actual: no hay cambios.</p>}
      {sim && (
        <div aria-live="polite" className="grid gap-2 rounded-lg bg-muted/50 p-3 text-xs" aria-label="Vista previa del precio">
          <p className="flex flex-wrap items-center gap-2 text-base tabular-nums">
            <span className="text-muted-foreground">{fmtUsd(actual.precioVenta)}</span><ArrowRight className="size-4" aria-hidden="true" /><b>{fmtUsd(sim.precioVenta)}</b>
            <span className={`text-xs font-medium ${diferencia >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{diferencia >= 0 ? '+' : '−'}{fmtUsd(Math.abs(diferencia))} ({fmtPct(round2((sim.precioVenta / actual.precioVenta - 1) * 100))})</span>
          </p>
          <dl className="grid gap-1 text-[11px]">
            <Comparacion t="Pago a la firma" a={fmtUsd2(actual.reserva)} b={fmtUsd2(sim.reserva)} />
            <Comparacion t="Cuota de entrada" a={fmtUsd2(actual.cuotaMensual)} b={fmtUsd2(sim.cuotaMensual)} />
            <Comparacion t="Saldo contra entrega" a={fmtUsd2(actual.contraEntrega)} b={fmtUsd2(sim.contraEntrega)} />
          </dl>
          <ReglaPrecios />
          <Label htmlFor="ficha-precio-motivo" className="text-[11px]">Motivo del cambio</Label>
          <Textarea id="ficha-precio-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Ajuste aprobado en comité" />
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={descartar}>Cancelar</Button>
            <Button size="sm" disabled={motivo.trim().length < 5} onClick={guardar}>{aprueba ? 'Guardar precio' : 'Enviar a aprobación'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Comparacion({ t, a, b }: { t: string; a: string; b: string }) {
  return <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{t}</dt><dd className="tabular-nums">{a} → <b>{b}</b></dd></div>
}

/** El 6 % es el acumulado a la firma: la reserva se paga antes y se acredita, nunca se cobra dos veces. */
function FormaPago({ p, firmaPct, cuotasPct }: { p: PriceBreakdown; firmaPct: number; cuotasPct: number }) {
  const [reservaTxt, setReservaTxt] = useState(String(RESERVA_PREDETERMINADA))
  const reserva = Number(reservaTxt.replace(',', '.'))
  const conReserva = reservaTxt.trim() !== '' && Number.isFinite(reserva) && reserva > 0
  const excede = conReserva && reserva > p.reserva
  return (
    <section aria-labelledby="ficha-pagos">
      <h3 id="ficha-pagos" className="mb-2 text-sm font-semibold">Forma de pago</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <Parte t={etiquetaPagoFirma(firmaPct)} v={fmtUsd2(p.reserva)} h="Acumulado a la firma; incluye la reserva" />
        <Parte t={`Cuotas de entrada · ${cuotasPct} %`} v={fmtUsd2(p.cuotasTotal)} h={fmtCuotas(p)} />
        <Parte t={`Contra entrega · ${p.contraEntregaPct} %`} v={fmtUsd2(p.contraEntrega)} h="Financiamiento o saldo" />
      </div>
      <div className="mt-2 grid gap-1.5 rounded-lg border border-border p-3 text-xs">
        <Label htmlFor="ficha-reserva" className="text-[11px] font-medium">Reserva (USD)</Label>
        <Input id="ficha-reserva" inputMode="decimal" className="h-8 sm:max-w-40" value={reservaTxt} placeholder={String(RESERVA_PREDETERMINADA)} onChange={(e) => setReservaTxt(e.target.value)} />
        {excede
          ? <FieldError>La reserva no puede superar el pago a la firma de {fmtUsd2(p.reserva)}.</FieldError>
          : conReserva
            ? <p>Reserva <b className="tabular-nums">{fmtUsd2(reserva)}</b> + a completar en la firma <b className="tabular-nums">{fmtUsd2(round2(p.reserva - reserva))}</b> = {fmtUsd2(p.reserva)}. No se cobra dos veces.</p>
            : <p className="text-muted-foreground">{NOTA_RESERVA}</p>}
      </div>
    </section>
  )
}

function DocEstado({ cargado }: { cargado: boolean }) {
  const e = ESTADO_DOCUMENTO[estadoDocumento(cargado)]
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${e.tono}`}>{e.label}</span>
}

function Parte({ t, v, h }: { t: string; v: string; h: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2.5">
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{v}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{h}</div>
    </div>
  )
}
