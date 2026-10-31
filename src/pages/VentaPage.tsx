import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FileText, Pencil, Search, UserPlus } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ClienteFormDialog from '@/features/clientes/components/ClienteFormDialog'
import { ETAPAS } from '@/features/clientes/model'
import { clientesVisibles } from '@/features/clientes/service'
import { versionDelPlan } from '@/features/financiamiento/condiciones'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { EstadoBadge, FieldError } from '@/features/inventario/components/shared'
import { ESTADOS_COTIZABLES } from '@/features/cotizaciones/cotizacion'
import { estadoEfectivo } from '@/features/inventario/estados'
import { fmtM2, fmtUsd } from '@/features/inventario/pricing'
import PresentacionProyecto from '@/features/marca/PresentacionProyecto'
import ResumenFinanciero from '@/features/financiamiento/components/ResumenFinanciero'
import { borradorVacio, claveBorrador, guardarJson, leerBorrador, type Borrador } from '@/features/venta/borrador'
import { useOperacion } from '@/features/venta/useOperacion'
import { cn } from '@/lib/utils'

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Atender cliente: la venta empieza aquí, eligiendo el cliente y el departamento, y sigue en Financiamiento.
 * El plan, la cotización, la reserva y los pagos se gestionan en Financiamiento; aquí solo se resume.
 */
export default function VentaPage() {
  const { actor, can } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const hoy = hoyGuayaquil()
  const [b, setB] = useState(() => {
    const cliente = params.get('cliente'), unidad = params.get('unidad')
    return cliente || unidad ? { ...borradorVacio(hoy), clienteId: cliente ?? '', codigo: unidad ?? '' } : leerBorrador(actor.id, hoy)
  })
  useEffect(() => guardarJson(claveBorrador(actor.id), b), [b, actor.id])
  const op = useOperacion(b, setB, can('cotizaciones.descuento'))
  const [busqueda, setBusqueda] = useState('')
  const [dialogoCliente, setDialogoCliente] = useState<'nuevo' | 'editar' | null>(null)
  const [confirmarCambio, setConfirmarCambio] = useState(false)
  const cambioConfirmado = useRef(false)
  const inicio = useRef<HTMLElement>(null)
  const buscador = useRef<HTMLInputElement>(null)
  const continuar = useRef<HTMLButtonElement>(null)
  // Lleva al usuario al paso que sigue. Tras cerrar un selector o un diálogo se espera a que devuelvan el foco.
  const [foco, setFoco] = useState<{ destino: 'cliente' | 'unidad' | 'continuar'; demora: number } | null>(null)
  useEffect(() => {
    if (!foco) return
    const mover = () => {
      if (foco.destino === 'cliente') {
        inicio.current?.scrollIntoView({ block: 'start' })
        buscador.current?.focus({ preventScroll: true })
      } else {
        const el = foco.destino === 'unidad' ? document.getElementById('ve-picker') : continuar.current
        el?.scrollIntoView({ block: 'center' })
        el?.focus({ preventScroll: true })
      }
    }
    if (!foco.demora) { mover(); return }
    const reloj = setTimeout(mover, foco.demora)
    return () => clearTimeout(reloj)
  }, [foco])

  // Enlaces desde otras pantallas (ficha de cliente, cobranzas, unidades): aplican sus datos y abren la operación.
  // Va después de guardar el borrador actual, para que el nuevo sea el último escrito.
  useEffect(() => {
    const cliente = params.get('cliente'), unidad = params.get('unidad'), cot = params.get('cotizacion')
    if (!cot && !(cliente && unidad)) return
    const nuevo: Borrador = cot ? { ...borradorVacio(hoy), cotizacionId: cot } : { ...borradorVacio(hoy), clienteId: cliente ?? '', codigo: unidad ?? '' }
    guardarJson(claveBorrador(actor.id), nuevo)
    navigate('/financiamiento?operacion=1', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al llegar desde un enlace.
  }, [])

  if (!can('cotizaciones.crear')) return <PageHeader title="Atender cliente" subtitle="Tu perfil no puede emitir cotizaciones." />
  if (!op.remoto) return <PageHeader title="Atender cliente" subtitle="Esta pantalla necesita conexión con la base de datos." />

  const { cotizacion, cliente, unit, bloqueada, calc, cs } = op
  const clientes = (() => {
    const q = normalizar(busqueda.trim())
    const visibles = clientesVisibles(cs.clientes, actor).filter((c) => c.etapa !== 'perdido')
    if (!q) return visibles.slice(0, 5)
    return visibles.filter((c) => normalizar(`${c.nombre} ${c.telefono} ${c.email} ${c.documento ?? ''}`).includes(q)).slice(0, 8)
  })()
  const plan = bloqueada ? cotizacion?.plan ?? null : calc.plan
  const irAFinanciamiento = () => { guardarJson(claveBorrador(actor.id), b); navigate('/financiamiento?operacion=1') }
  const retomar = (id: string) => { guardarJson(claveBorrador(actor.id), { ...borradorVacio(hoy), cotizacionId: id }); navigate('/financiamiento?operacion=1') }
  const listo = !!cliente && !!unit
  // Guía del proceso: cada paso se marca solo con lo que ya está guardado.
  const pasos = [
    { titulo: 'Seleccionar o registrar cliente', hecho: !!cliente || !!cotizacion, quien: 'Vendedor' },
    { titulo: 'Seleccionar departamento', hecho: !!unit, quien: 'Vendedor' },
    { titulo: 'Configurar financiamiento y cuotas', hecho: !!b.planConfirmado || !!cotizacion, quien: 'Vendedor' },
    { titulo: 'Emitir cotización y descargar PDF', hecho: !!cotizacion, quien: 'Vendedor' },
    { titulo: 'Solicitar la reserva', hecho: !!op.reserva, quien: 'Vendedor' },
    { titulo: 'Registrar el pago de la reserva', hecho: !!op.reserva?.comprobante, quien: 'Vendedor' },
    { titulo: 'Verificar el pago y aprobar la reserva', hecho: op.reserva?.estado === 'confirmada', quien: 'Finanzas y Gerencia' },
    { titulo: 'Generar contrato y documentos', hecho: !!op.contrato, quien: 'Legal' },
  ]
  const actual = pasos.findIndex((x) => !x.hecho)
  // Una cotización ya está guardada. Sin ella, se pierde lo elegido además del cliente.
  const f = b.financiamiento
  const sinGuardar = !b.cotizacionId && !!(b.codigo || b.observaciones.trim() || f.reserva !== null || f.extras.length || f.descuento !== '0' || b.planConfirmado)
  /** Solo reinicia lo que se está escribiendo. Clientes, cotizaciones y reservas guardados no se tocan. */
  const reiniciar = () => { setB(() => borradorVacio(hoy)); setBusqueda(''); op.setError(null); op.setAviso(null) }
  const otroCliente = () => {
    if (sinGuardar) { setConfirmarCambio(true); return }
    reiniciar(); setFoco({ destino: 'cliente', demora: 0 })
  }
  const elegirCliente = (id: string) => {
    setB((x) => ({ ...x, clienteId: id })); setBusqueda('')
    setFoco({ destino: b.codigo ? 'continuar' : 'unidad', demora: 200 })
  }
  const elegirUnidad = (codigo: string) => {
    setB((x) => ({ ...x, codigo, planConfirmado: null }))
    if (cliente) setFoco({ destino: 'continuar', demora: 200 })
  }

  return (
    <>
      <PageHeader eyebrow="Ventas · Atender cliente" title="Atender cliente" subtitle="Selecciona el cliente y el departamento, y continúa en Financiamiento para emitir la cotización y seguir hacia la reserva." />

      <section aria-labelledby="ve-proceso" className="dashboard-card mb-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ve-proceso" className="text-sm font-semibold">Proceso de venta</h2>
          <span className="text-[11px] text-muted-foreground">{actual === -1 ? 'Venta completa' : `Paso ${actual + 1} de ${pasos.length}`}</span>
        </div>
        <ol aria-label="Pasos de la venta" className="mt-3 grid gap-1.5 md:grid-cols-2 xl:grid-cols-4">
          {pasos.map((x, i) => (
            <li key={x.titulo} aria-current={i === actual ? 'step' : undefined}
              className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', x.hecho ? 'border-emerald-200 bg-emerald-50/60' : i === actual ? 'border-primary bg-secondary' : 'border-border text-muted-foreground')}>
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold', x.hecho ? 'bg-emerald-600 text-white' : i === actual ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{x.hecho ? '✓' : i + 1}</span>
              <span className="min-w-0"><span className="block font-medium text-foreground">{x.titulo}</span><span className="text-[11px]">{x.quien}</span></span>
            </li>
          ))}
        </ol>
        {op.paso && actual !== -1 && <p className="mt-3 text-xs"><b>Ahora:</b> {op.paso.titulo}. <span className="text-muted-foreground">{op.paso.detalle}</span></p>}
      </section>

      {op.aviso && <p role="status" className="mb-4 flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />{op.aviso}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-4">
          <section ref={inicio} aria-labelledby="ve-cliente" className="dashboard-card scroll-mt-20 p-5">
            <h2 id="ve-cliente" className="text-sm font-semibold">1. Seleccionar o registrar cliente</h2>
            {cliente ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-xs">
                <div className="min-w-[12rem] flex-1">
                  <div className="font-semibold">{cliente.nombre}</div>
                  <div className="text-[11px] text-muted-foreground">{[cliente.documento, cliente.telefono, cliente.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'} · {ETAPAS[cliente.etapa].label}</div>
                </div>
                {can('clientes.editar') && <Button size="xs" variant="ghost" onClick={() => setDialogoCliente('editar')}><Pencil />Editar ficha</Button>}
                <Button size="xs" variant="outline" onClick={otroCliente}>{bloqueada ? 'Atender a otro cliente' : 'Cambiar cliente'}</Button>
              </div>
            ) : cotizacion ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 font-semibold">{cotizacion.cliente.nombre}</span>
                <Button size="xs" variant="outline" onClick={otroCliente}>Atender a otro cliente</Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-2">
                <p className="text-sm font-medium">Selecciona o registra un cliente para comenzar</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid min-w-60 flex-1 gap-1.5">
                    <Label htmlFor="ve-buscar" className="text-xs">Buscar cliente existente</Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                      <Input ref={buscador} id="ve-buscar" className="h-9 pl-8" placeholder="Nombre, teléfono, cédula o correo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                    </div>
                  </div>
                  {can('clientes.editar') && <Button variant="outline" onClick={() => setDialogoCliente('nuevo')}><UserPlus />Registrar nuevo cliente</Button>}
                </div>
                {clientes.length > 0
                  ? <ul className="grid gap-1">{clientes.map((c) => (
                    <li key={c.id}><button type="button" className="w-full rounded-md border border-border px-3 py-1.5 text-left text-xs hover:bg-muted" onClick={() => elegirCliente(c.id)}>
                      <b>{c.nombre}</b> <span className="text-muted-foreground">· {c.telefono || c.email || 'sin contacto'} · {ETAPAS[c.etapa].label}</span>
                    </button></li>
                  ))}</ul>
                  : <p className="text-xs text-muted-foreground">{busqueda ? 'Ningún cliente coincide. Regístralo sin salir de esta pantalla.' : 'Aún no hay clientes en tu alcance.'}</p>}
              </div>
            )}
          </section>

          <section aria-labelledby="ve-unidad" className="dashboard-card p-5">
            <h2 id="ve-unidad" className="text-sm font-semibold">2. Seleccionar departamento</h2>
            {!bloqueada && !cliente && !b.codigo && <p className="mt-2 text-xs text-muted-foreground">Primero selecciona el cliente.</p>}
            {!bloqueada && (cliente || b.codigo) && <div className="mt-3 max-w-xl"><UnitPicker id="ve-picker" label="Departamento disponible" units={op.inv.units} params={op.inv.params} value={op.codigo}
              onChange={elegirUnidad} permitidos={ESTADOS_COTIZABLES} soloPermitidos /></div>}
            {unit && plan && (
              <>
                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{unit.dpt} · {unit.tipologia}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><EstadoBadge estado={estadoEfectivo(unit)} />{unit.solicitud && estadoEfectivo(unit) === 'en_proceso_reserva' && <span className="text-[11px] text-muted-foreground">{unit.solicitud.codigo}</span>}</div>
                  </div>
                  <div className="text-right">
                    {plan.descuentoPct > 0 && <div className="text-[11px] text-muted-foreground line-through">{fmtUsd(plan.precioLista)}</div>}
                    <div className="text-xl font-semibold tabular-nums text-primary">{fmtUsd(plan.precioFinal)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtUsd(plan.usdM2Final)} por m²</div>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  <Dato t="Edificio" v={String(unit.edificio)} />
                  <Dato t="Piso" v={String(unit.piso)} />
                  <Dato t="Ubicación" v={unit.ubicacion || '—'} />
                  <Dato t="Área" v={fmtM2(unit.areaM2)} />
                  <Dato t="Bodega" v={unit.bodegaM2 ? fmtM2(unit.bodegaM2) : 'No'} />
                  <Dato t="Patio" v={unit.patioM2 ? fmtM2(unit.patioM2) : 'No'} />
                </dl>
                {unit.estado === 'por_confirmar' && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Disponibilidad por confirmar: se puede cotizar, pero no reservar hasta que se confirme en Inventario.</p>}
                {op.otraReserva && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-[11px] text-yellow-900">
                    <span className="min-w-0 flex-1">Esta unidad ya tiene la solicitud {op.otraReserva.codigo}. No admite otra reserva.</span>
                    {op.otraReserva.cotizacionId && op.otraReserva.cotizacionId !== b.cotizacionId && <Button size="xs" variant="outline" onClick={() => retomar(op.otraReserva!.cotizacionId!)}>Continuar operación</Button>}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-4 xl:sticky xl:top-4 xl:self-start">
          <section aria-labelledby="ve-fin" className="dashboard-card p-5">
            <h2 id="ve-fin" className="text-sm font-semibold">3. Continuar en Financiamiento</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Allí configuras el plan, emites la cotización y continúas hacia la reserva.</p>
            {(listo || bloqueada) && calc.plan && calc.entrada && unit ? (
              <div className="mt-3 grid gap-2">
                <ResumenFinanciero calc={calc} plan={calc.plan} edificio={unit.edificio} />
                {bloqueada && cotizacion && <p className="rounded-lg bg-muted px-3 py-2 text-[11px]">Cotización {cotizacion.numero} · versión <b>{versionDelPlan(cotizacion.plan)}</b> · vence el {fmtFechaCorta(cotizacion.validaHasta)}</p>}
                {!bloqueada && b.planConfirmado && <p className="text-[11px] text-emerald-800">Plan confirmado · versión <b>{b.planConfirmado.version}</b></p>}
              </div>
            ) : <p className="mt-2 text-xs text-muted-foreground">Falta {!cliente ? 'seleccionar el cliente' : 'seleccionar el departamento'}. Después podrás continuar en Financiamiento.</p>}
            <div className="mt-4 grid gap-2 empty:hidden">
              {bloqueada && cotizacion && <Button variant="outline" onClick={irAFinanciamiento}><ArrowRight />Abrir la operación</Button>}
              {!bloqueada && listo && <Button ref={continuar} onClick={irAFinanciamiento}><FileText />{b.planConfirmado ? 'Editar financiamiento' : 'Continuar en Financiamiento'}</Button>}
            </div>
            <div className="mt-3 empty:hidden"><FieldError>{op.errorCarga}</FieldError></div>
          </section>
        </aside>
      </div>

      <div className="mt-4 grid gap-4">
        <PresentacionProyecto />
        {op.abiertas.length > 0 && (
          <section aria-labelledby="ve-abiertas" className="dashboard-card mb-4 p-4">
            <h2 id="ve-abiertas" className="text-sm font-semibold">Ventas iniciadas</h2>
            <ul className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {op.abiertas.slice(0, 6).map(({ cotizacion: q, reserva: r, paso: etapa }) => (
                <li key={q.id} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', q.id === b.cotizacionId ? 'border-primary bg-secondary' : 'border-border')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{q.cliente.nombre}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{q.unidad.dpt} · {r?.codigo ?? q.numero} · {etapa}</div>
                  </div>
                  <Button size="xs" variant="outline" aria-label={`Continuar operación de ${q.cliente.nombre}, ${q.unidad.dpt}`} onClick={() => retomar(q.id)}>Continuar operación</Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <Dialog open={confirmarCambio} onOpenChange={setConfirmarCambio}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => {
          // Al aceptar, el foco va al buscador y no de vuelta al botón.
          if (!cambioConfirmado.current) return
          e.preventDefault()
          cambioConfirmado.current = false
          setFoco({ destino: 'cliente', demora: 0 })
        }}>
          <DialogHeader>
            <DialogTitle>¿Descartar esta venta sin guardar?</DialogTitle>
            <DialogDescription>Se quitará lo elegido y escrito{cliente ? ` para ${cliente.nombre}` : ''}{unit ? `, departamento ${unit.dpt}` : ''}, porque aún no tiene cotización. No se borra ningún cliente, cotización ni reserva guardados.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarCambio(false)}>Seguir con esta venta</Button>
            <Button variant="destructive" onClick={() => { cambioConfirmado.current = true; reiniciar(); setConfirmarCambio(false) }}>Descartar y elegir otro cliente</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClienteFormDialog open={dialogoCliente !== null} onOpenChange={(v) => { if (!v) setDialogoCliente(null) }} cliente={dialogoCliente === 'editar' ? cliente : undefined}
        onSaved={(id, m) => { if (dialogoCliente === 'editar') op.setAviso(m); else { elegirCliente(id); op.setAviso(m) } }} />
    </>
  )
}

function Dato({ t, v }: { t: string; v: string }) {
  return <div className="rounded-lg bg-muted px-2.5 py-1.5"><dt className="text-[10px] text-muted-foreground">{t}</dt><dd className="font-medium">{v}</dd></div>
}

