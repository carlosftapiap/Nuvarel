import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { celularLocal } from '@/features/clientes/celular'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Building2, CheckCircle2, ChevronDown, ChevronUp, FileText, Pencil, Search, UserPlus, Users } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { barraDe } from '@/app/navigation'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useIsMobile } from '@/hooks/use-mobile'
import ClienteFormDialog from '@/features/clientes/components/ClienteFormDialog'
import { ETAPAS } from '@/features/clientes/model'
import { clientesVisibles } from '@/features/clientes/service'
import { versionDelPlan } from '@/features/financiamiento/condiciones'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import BuildingMap from '@/features/inventario/components/BuildingMap'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { EstadoBadge, FieldError } from '@/features/inventario/components/shared'
import { ESTADOS_COTIZABLES } from '@/features/cotizaciones/cotizacion'
import { estadoEfectivo } from '@/features/inventario/estados'
import { nombreEdificio } from '@/features/inventario/nomenclatura'
import { fmtM2, fmtUsd } from '@/features/inventario/pricing'
import type { Unit } from '@/features/inventario/types'
import PresentacionProyecto from '@/features/marca/PresentacionProyecto'
import ResumenFinanciero from '@/features/financiamiento/components/ResumenFinanciero'
import AsistenteVenta from '@/features/venta/AsistenteVenta'
import { borradorVacio, claveBorrador, guardarJson, leerBorrador, type Borrador } from '@/features/venta/borrador'
import { COLOR_ETAPA } from '@/features/venta/colores'
import DocumentosVenta from '@/features/venta/DocumentosVenta'
import { EstadoPaso } from '@/features/venta/GuiaVenta'
import { pasoActual, PASOS_VENTA } from '@/features/venta/operacion'
import { useOperacion } from '@/features/venta/useOperacion'
import { cn } from '@/lib/utils'

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
/** Etapas que se resuelven en esta pantalla: aquí no hace falta repetir el aviso de «Ahora te toca». */
const ACCIONES_DE_ESTA_PANTALLA = ['cliente', 'unidad', 'plan', 'emitir']

/**
 * Atender cliente: la venta empieza aquí, eligiendo el cliente y el departamento, y sigue en Financiamiento.
 * El plan, la cotización, la reserva y los pagos se gestionan en Financiamiento; aquí solo se resume.
 */
export default function VentaPage() {
  const { actor, can } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const movil = useIsMobile()
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
  const [edificio, setEdificio] = useState<1 | 2 | null>(null)
  const [verMapa, setVerMapa] = useState(true)
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
    if (!q) return visibles.slice(0, 6)
    return visibles.filter((c) => normalizar(`${c.nombre} ${c.telefono} ${celularLocal(c.telefono)} ${c.email} ${c.documento ?? ''}`).includes(q)).slice(0, 8)
  })()
  const plan = bloqueada ? cotizacion?.plan ?? null : calc.plan
  const irAFinanciamiento = () => { guardarJson(claveBorrador(actor.id), b); navigate('/financiamiento?operacion=1') }
  const retomar = (id: string) => { guardarJson(claveBorrador(actor.id), { ...borradorVacio(hoy), cotizacionId: id }); navigate('/financiamiento?operacion=1') }
  const listo = !!cliente && !!unit
  const accion = op.paso.accion
  const etapa = PASOS_VENTA[pasoActual(accion)].clave
  // Una cotización ya está guardada. Sin ella, se pierde lo elegido además del cliente.
  const f = b.financiamiento
  const sinGuardar = !b.cotizacionId && !!(b.codigo || b.observaciones.trim() || f.reserva !== null || f.extras.length || f.descuento !== '0' || b.planConfirmado)
  /** Solo reinicia lo que se está escribiendo. Clientes, cotizaciones y reservas guardados no se tocan. */
  const reiniciar = () => { setB(() => borradorVacio(hoy)); setBusqueda(''); setVerMapa(true); op.setError(null); op.setAviso(null) }
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
  // El mapa usa las mismas reglas que el selector: solo se eligen unidades cotizables y sin solicitud en trámite.
  const cotizable = (u: Unit) => (ESTADOS_COTIZABLES as string[]).includes(estadoEfectivo(u)) && !u.solicitud
  const disponibles = op.inv.units.filter(cotizable).length
  const edificioMapa = edificio ?? unit?.edificio ?? 1
  const mostrarUnidad = !bloqueada && (!!cliente || !!b.codigo)
  const registrar = can('clientes.editar') ? () => setDialogoCliente('nuevo') : null

  // Una sola acción principal: en el celular va fija abajo; en computadora, en el resumen.
  const principal: ReactNode = bloqueada && cotizacion
    ? <Button size="lg" className={cn('h-12 w-full bg-violet-600 text-base hover:bg-violet-700', op.paso.responsable === 'Vendedor' && 'guia-pulso')} onClick={irAFinanciamiento}><ArrowRight />Abrir la operación</Button>
    : listo
      ? <Button ref={continuar} size="lg" className={cn('h-12 w-full bg-violet-600 text-base shadow-[0_8px_20px_-8px_#7c3aed] hover:bg-violet-700', (accion === 'plan' || accion === 'emitir') && 'guia-pulso')} onClick={irAFinanciamiento}><FileText />{b.planConfirmado ? 'Editar financiamiento' : 'Continuar en Financiamiento'}</Button>
      : null
  const principalMovil: ReactNode = principal ?? (cliente
    ? <Button size="lg" className="h-12 w-full bg-teal-600 text-base hover:bg-teal-700" onClick={() => setFoco({ destino: 'unidad', demora: 0 })}><Building2 />Elegir departamento</Button>
    : registrar && <Button size="lg" className="h-12 w-full bg-indigo-600 text-base hover:bg-indigo-700" onClick={registrar}><UserPlus />Registrar nuevo cliente</Button>)
  const conBarra = barraDe(actor.rol, can).length > 0

  return (
    <div className={cn(movil && 'pb-24')}>
      <header className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 px-4 py-4 text-white shadow-[0_16px_40px_-20px_#4f46e5] sm:px-7 sm:py-6">
        <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-24 size-48 rounded-full bg-fuchsia-400/20" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-100">Ventas · Nueva operación</p>
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">Atender cliente</h1>
            <p className="mt-1 max-w-xl truncate text-sm text-indigo-50 sm:whitespace-normal">
              {cliente ? <>Atendiendo a <b className="font-semibold text-white">{cliente.nombre}</b>{unit ? <> · Departamento <b className="font-semibold text-white">{unit.dpt}</b></> : null}</> : cotizacion ? <>Operación de <b className="font-semibold text-white">{cotizacion.cliente.nombre}</b></> : 'Cliente, departamento y cotización en un solo recorrido.'}
            </p>
          </div>
          <div className="flex gap-2">
            <span className="flex items-baseline gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/25 sm:block"><b className="text-base font-bold leading-none tabular-nums sm:block sm:text-lg">{disponibles}</b>disponibles</span>
            {op.abiertas.length > 0 && <a href="#ve-abiertas" className="flex items-baseline gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/25 transition hover:bg-white/25 sm:block"><b className="text-base font-bold leading-none tabular-nums sm:block sm:text-lg">{op.abiertas.length}</b>ventas en curso</a>}
          </div>
        </div>
      </header>

      <AsistenteVenta paso={op.paso} />

      {op.aviso && <p role="status" className="mb-4 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{op.aviso}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-4">
          <Etapa id="ve-cliente" refSeccion={inicio} clave="cliente" n={1} titulo="Cliente" activa={etapa === 'cliente'} hecha={!!cliente || !!cotizacion}
            descripcion={cliente || cotizacion ? undefined : 'Selecciona o registra un cliente para comenzar'}>
            {cliente ? (
              <div className="flex flex-wrap items-center gap-3">
                <Avatar nombre={cliente.nombre} />
                <div className="min-w-[12rem] flex-1">
                  <div className="text-base font-semibold">{cliente.nombre}</div>
                  <div className="text-sm text-muted-foreground">{[cliente.documento, celularLocal(cliente.telefono) || cliente.telefono, cliente.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">{ETAPAS[cliente.etapa].label}</span>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {can('clientes.editar') && <Button variant="ghost" className="h-10" onClick={() => setDialogoCliente('editar')}><Pencil />Editar ficha</Button>}
                  <Button variant="outline" className="h-10" onClick={otroCliente}>{bloqueada ? 'Atender a otro cliente' : 'Cambiar cliente'}</Button>
                </div>
              </div>
            ) : cotizacion ? (
              <div className="flex flex-wrap items-center gap-3">
                <Avatar nombre={cotizacion.cliente.nombre} />
                <span className="min-w-0 flex-1 text-base font-semibold">{cotizacion.cliente.nombre}</span>
                <Button variant="outline" className="h-10" onClick={otroCliente}>Atender a otro cliente</Button>
              </div>
            ) : (
              <div className="grid gap-4">
                {registrar && !movil && (
                  <Button size="lg" className="h-14 w-full justify-start gap-3 rounded-xl bg-indigo-600 px-4 text-base shadow-[0_10px_24px_-10px_#4f46e5] hover:bg-indigo-700 sm:w-auto sm:min-w-80" onClick={registrar}>
                    <span className="grid size-8 place-items-center rounded-lg bg-white/20"><UserPlus className="size-[18px]" /></span>Registrar nuevo cliente
                  </Button>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="ve-buscar" className="text-sm font-medium">Buscar cliente existente</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-indigo-500" />
                    <Input ref={buscador} id="ve-buscar" className="h-12 rounded-xl border-slate-300 pl-11 text-base shadow-sm focus-visible:border-indigo-500 focus-visible:ring-indigo-500/25" placeholder="Nombre, teléfono, cédula o correo" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                  </div>
                </div>
                {clientes.length > 0 ? (
                  <div className="grid gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{busqueda ? `${clientes.length} coincidencia${clientes.length === 1 ? '' : 's'}` : 'Clientes recientes'}</p>
                    <ul className="grid gap-2 sm:grid-cols-2">{clientes.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => elegirCliente(c.id)}
                          className="group flex min-h-16 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:-translate-y-px hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-indigo-500">
                          <Avatar nombre={c.nombre} chico />
                          <span className="min-w-0 flex-1">
                            <b className="block truncate text-sm font-semibold">{c.nombre}</b>
                            <span className="block truncate text-xs text-muted-foreground">{celularLocal(c.telefono) || c.email || 'sin contacto'} · {ETAPAS[c.etapa].label}</span>
                          </span>
                          <ArrowRight className="size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" aria-hidden="true" />
                        </button>
                      </li>
                    ))}</ul>
                  </div>
                ) : <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-muted-foreground">{busqueda ? 'Ningún cliente coincide. Regístralo sin salir de esta pantalla.' : 'Aún no hay clientes en tu alcance.'}</p>}
              </div>
            )}
          </Etapa>

          {(mostrarUnidad || unit) && (
            <Etapa id="ve-unidad" clave="unidad" n={2} titulo="Departamento" activa={etapa === 'unidad'} hecha={!!unit && etapa !== 'unidad'}
              descripcion={unit ? undefined : 'Elige en el mapa o por número. Solo puedes elegir los disponibles.'}>
              {unit && plan && (
                <div className="mb-4 grid gap-3 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-2xl font-bold text-teal-800">{unit.dpt}</span>
                      <span className="text-sm font-medium">{unit.tipologia}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2"><EstadoBadge estado={estadoEfectivo(unit)} />{unit.solicitud && <span className="text-xs text-muted-foreground">Solicitud {unit.solicitud.codigo} en trámite</span>}</div>
                    <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-6">
                      <Dato t="Edificio" v={nombreEdificio(unit.edificio).replace('Edificio ', '')} />
                      <Dato t="Piso" v={unit.piso === 'PB' ? 'PB' : String(unit.piso)} />
                      <Dato t="Ubicación" v={unit.ubicacion || '—'} />
                      <Dato t="Área" v={fmtM2(unit.areaM2)} />
                      <Dato t="Bodega" v={unit.bodegaM2 ? fmtM2(unit.bodegaM2) : 'No'} />
                      <Dato t="Patio" v={unit.patioM2 ? fmtM2(unit.patioM2) : 'No'} />
                    </dl>
                  </div>
                  <div className="sm:text-right">
                    {plan.descuentoPct > 0 && <div className="text-xs text-muted-foreground line-through">{fmtUsd(plan.precioLista)}</div>}
                    <div className="font-display text-2xl font-bold tabular-nums text-slate-900">{fmtUsd(plan.precioFinal)}</div>
                    <div className="text-xs text-muted-foreground">{fmtUsd(plan.usdM2Final)} por m²</div>
                  </div>
                </div>
              )}
              {op.otraReserva && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
                  <span className="min-w-0 flex-1">Esta unidad ya tiene la solicitud {op.otraReserva.codigo}. No admite otra reserva.</span>
                  {op.otraReserva.cotizacionId && op.otraReserva.cotizacionId !== b.cotizacionId && <Button size="sm" variant="outline" onClick={() => retomar(op.otraReserva!.cotizacionId!)}>Continuar operación</Button>}
                </div>
              )}
              {mostrarUnidad && (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-56 flex-1 sm:max-w-sm"><UnitPicker id="ve-picker" label="Departamento disponible" units={op.inv.units} params={op.inv.params} value={op.codigo}
                      onChange={elegirUnidad} permitidos={ESTADOS_COTIZABLES} soloPermitidos /></div>
                    <div role="group" aria-label="Edificio del mapa" className="inline-flex rounded-xl bg-slate-100 p-1">
                      {([1, 2] as const).map((ed) => (
                        <button key={ed} type="button" aria-pressed={edificioMapa === ed} onClick={() => { setEdificio(ed); setVerMapa(true) }}
                          className={cn('h-9 rounded-lg px-3.5 text-sm font-semibold transition', edificioMapa === ed && verMapa ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                          {nombreEdificio(ed)}
                        </button>
                      ))}
                    </div>
                    {unit && <Button variant="ghost" className="h-10" aria-expanded={verMapa} onClick={() => setVerMapa((v) => !v)}>{verMapa ? <ChevronUp /> : <ChevronDown />}{verMapa ? 'Ocultar mapa' : 'Ver mapa'}</Button>}
                  </div>
                  {verMapa && (
                    <BuildingMap units={op.inv.units} params={op.inv.params} edificios={[edificioMapa]} sinMarco
                      seleccionable={cotizable} seleccionado={op.codigo} onOpen={(c) => { elegirUnidad(c); if (cliente) setVerMapa(false) }} />
                  )}
                </div>
              )}
            </Etapa>
          )}

          {bloqueada && cotizacion && <DocumentosVenta cotizacion={cotizacion} datos={op.datos} onError={op.setError} />}
        </div>

        <aside aria-label="Resumen de la operación" className="grid content-start gap-4 lg:sticky lg:top-20 lg:self-start">
          <section aria-labelledby="ve-fin" className="dashboard-card overflow-hidden">
            <div className="border-b border-border bg-slate-50/80 px-5 py-3">
              <h2 id="ve-fin" className="text-sm font-semibold">Tu operación</h2>
            </div>
            <div className="grid gap-3 p-5">
              <Resumen clave="cliente" t="Cliente" v={cliente?.nombre ?? cotizacion?.cliente.nombre} />
              <Resumen clave="unidad" t="Departamento" v={unit ? `${unit.dpt} · ${unit.tipologia}` : undefined} />
              {plan && unit && (
                <div className="flex items-baseline justify-between gap-2 rounded-xl bg-slate-900 px-4 py-3 text-white">
                  <span className="text-xs text-slate-300">Precio</span>
                  <span className="font-display text-xl font-bold tabular-nums">{fmtUsd(plan.precioFinal)}</span>
                </div>
              )}
              {bloqueada && cotizacion && <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">Cotización {cotizacion.numero} · versión <b>{versionDelPlan(cotizacion.plan)}</b> · vence el {fmtFechaCorta(cotizacion.validaHasta)}</p>}
              {!bloqueada && b.planConfirmado && <p className="text-xs text-emerald-800">Plan confirmado · versión <b>{b.planConfirmado.version}</b></p>}
              {!movil && principal && <div className="mt-1">{principal}</div>}
              {!movil && principal && !bloqueada && <p className="text-center text-xs text-muted-foreground">En Financiamiento ajustas el plan y emites la cotización.</p>}
              {(listo || bloqueada) && calc.plan && calc.entrada && unit ? (
                <details className="group rounded-xl border border-slate-200 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium">Cómo se paga<ChevronDown className="size-4 text-muted-foreground transition group-open:rotate-180" aria-hidden="true" /></summary>
                  <div className="border-t border-slate-200 p-2"><ResumenFinanciero calc={calc} plan={calc.plan} edificio={unit.edificio} /></div>
                </details>
              ) : <p className="text-xs text-muted-foreground">{!cliente && !cotizacion ? 'Empieza por el cliente.' : 'Elige el departamento para ver el precio y el plan.'}</p>}
              {!ACCIONES_DE_ESTA_PANTALLA.includes(accion) && <EstadoPaso paso={op.paso} clienteId={op.clienteId} className="mt-0" />}
              <div className="empty:hidden"><FieldError>{op.error ?? op.errorCarga}</FieldError></div>
            </div>
          </section>
        </aside>
      </div>

      {op.abiertas.length > 0 && (
        <section id="ve-abiertas" aria-labelledby="ve-abiertas-tit" className="dashboard-card mt-4 scroll-mt-20 p-4 sm:p-5">
          <h2 id="ve-abiertas-tit" className="text-sm font-semibold">Ventas iniciadas</h2>
          <ul className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {op.abiertas.slice(0, 6).map(({ cotizacion: q, reserva: r, paso: etapaOp }) => {
              const c = COLOR_ETAPA[r ? 'reserva' : 'cotizacion']
              return (
                <li key={q.id} className={cn('flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2.5', q.id === b.cotizacionId ? 'border-violet-400 ring-1 ring-violet-300' : 'border-slate-200')}>
                  <span className={cn('h-10 w-1 shrink-0 rounded-full', c.solido)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{q.cliente.nombre}</div>
                    <div className="truncate text-xs text-muted-foreground">{q.unidad.dpt} · {r?.codigo ?? q.numero} · <span className={c.texto}>{etapaOp}</span></div>
                  </div>
                  <Button size="sm" variant="outline" className="h-9 shrink-0" aria-label={`Continuar operación de ${q.cliente.nombre}, ${q.unidad.dpt}`} onClick={() => retomar(q.id)}>Continuar</Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="mt-4"><PresentacionProyecto /></div>

      {movil && principalMovil && (
        <div className={cn('fixed inset-x-0 z-20 border-t border-slate-200 bg-white/95 px-4 pb-3 pt-2.5 shadow-[0_-8px_24px_-12px_rgba(15,23,42,.25)] backdrop-blur', conBarra ? 'bottom-[calc(62px+env(safe-area-inset-bottom))]' : 'bottom-0 pb-[calc(12px+env(safe-area-inset-bottom))]')}>
          {(cliente || unit) && <p className="mb-1.5 truncate text-xs text-muted-foreground">{[cliente?.nombre, unit?.dpt, plan ? fmtUsd(plan.precioFinal) : null].filter(Boolean).join(' · ')}</p>}
          {principalMovil}
        </div>
      )}

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
    </div>
  )
}

/** Tarjeta de una etapa: número y borde con el color de la etapa; la activa se destaca y las terminadas se marcan. */
function Etapa({ id, clave, n, titulo, descripcion, activa, hecha, refSeccion, children }: {
  id: string; clave: keyof typeof COLOR_ETAPA; n: number; titulo: string; descripcion?: string; activa: boolean; hecha: boolean; refSeccion?: Ref<HTMLElement>; children: ReactNode
}) {
  const c = COLOR_ETAPA[clave]
  return (
    <section ref={refSeccion} aria-labelledby={id} className={cn('dashboard-card relative scroll-mt-20 overflow-hidden p-4 sm:p-5', activa && cn('ring-2', c.anillo))}>
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', c.solido)} />
      <div className="mb-4 flex items-center gap-3">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold', hecha && !activa ? 'bg-emerald-600 text-white' : c.solido)}>{hecha && !activa ? <CheckCircle2 className="size-4" aria-hidden="true" /> : n}</span>
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold leading-tight">{titulo}</h2>
          {descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Avatar({ nombre, chico = false }: { nombre: string; chico?: boolean }) {
  return <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 font-semibold text-white', chico ? 'size-10 text-sm' : 'size-12 text-base')}>{iniciales(nombre) || <Users className="size-4" />}</span>
}

function Resumen({ clave, t, v }: { clave: keyof typeof COLOR_ETAPA; t: string; v?: string }) {
  const c = COLOR_ETAPA[clave]
  return (
    <div className="flex items-center gap-3">
      <span className={cn('size-2.5 shrink-0 rounded-full', v ? c.solido : 'bg-slate-200')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{t}</div>
        <div className={cn('truncate text-sm font-semibold', !v && 'font-normal text-slate-400')}>{v ?? 'Sin elegir'}</div>
      </div>
    </div>
  )
}

function Dato({ t, v }: { t: string; v: string }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t}</dt><dd className="truncate font-semibold">{v}</dd></div>
}
