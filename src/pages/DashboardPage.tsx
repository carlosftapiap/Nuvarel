import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Banknote, Building2, CalendarClock, ChevronDown, ChevronRight, CircleDollarSign, FileSignature, HardHat, Info, Plus, Receipt, Tags, Users, type LucideIcon } from 'lucide-react'
import { PLANTILLAS_ROL } from '@/app/permissions'
import { useSession } from '@/app/session'
import Aviso from '@/components/Aviso'
import BannerBienvenida from '@/features/marca/BannerBienvenida'
import ConoceAmura from '@/features/marca/ConoceAmura'
import { useMedios } from '@/features/marca/useMedios'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import ColaDelDia, { FilaGestion, usePendientesDelDia } from '@/features/dashboard/Cola'
import PanelAdministracion, { MapaEdificios } from '@/features/dashboard/PanelAdministracion'
import { useIsMobile } from '@/hooks/use-mobile'
import { usePanelProyecto } from '@/features/dashboard/proyecto'
import { ETAPAS, ETAPAS_EMBUDO } from '@/features/clientes/model'
import { clientesVisibles, ordenarPorUrgencia, urgencia } from '@/features/clientes/service'
import { useClientesOpcional } from '@/features/clientes/store'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { EdificioFiltro, Panel } from '@/features/dashboard/panel'
import { ESTADO_EFECTIVO_ORDEN, ESTADOS_EFECTIVOS, estadoEfectivo, type EstadoEfectivo } from '@/features/inventario/estados'
import { calcularPrecio, fmtNum, fmtUsd } from '@/features/inventario/pricing'
import type { Actor, Unit } from '@/features/inventario/types'
import PanelLeads from '@/features/leads/PanelLeads'
import { reservasVisibles } from '@/features/reservas/service'
import { siguientePaso } from '@/features/reservas/siguiente'
import { useReservasOpcional } from '@/features/reservas/store'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import { CabeceraPanel } from '@/components/CabeceraPanel'
import { nombreEdificio, numeroComercial } from '@/features/inventario/nomenclatura'

/**
 * Inicio de cada perfil. Quien trabaja su propia cartera (Vendedor, Corredor) ve su día: qué hacer ahora, en orden.
 * Quien mira el negocio completo ve el panorama: el embudo, lo pendiente y los indicadores. «—» = sin acceso, nunca cero.
 */
export default function DashboardPage() {
  const { actor } = useSession()
  // Administración estrena su panel; Gerencia y Consulta siguen con el Panorama hasta aprobar el nuevo diseño.
  return alcanceDe(actor) === 'propio' ? <MiDia /> : actor.rol === 'administrador' ? <PanelAdministracion /> : <Panorama />
}

/**
 * Primera tarjeta para vendedores y supervisores: disponibilidad de cada departamento.
 * Es el mismo mapa del Inventario; tocar un departamento abre su ficha en Inventario.
 */
function MapaDisponibilidad() {
  const { state } = usePanelProyecto()
  const movil = useIsMobile()
  const navigate = useNavigate()
  return <MapaEdificios units={state.units} params={state.params} filtro="todos" movil={movil}
    onAbrir={(codigo) => navigate(`/inventario?vista=mapa&unidad=${encodeURIComponent(codigo)}`)} />
}

const alcanceDe = (a: Actor) => a.alcance?.tipo ?? PLANTILLAS_ROL.find((p) => p.id === a.rol)?.alcance ?? 'empresa'

const FILTROS: { valor: EdificioFiltro; etiqueta: string; param: string }[] = [
  { valor: 'todos', etiqueta: 'Todos', param: 'todos' }, { valor: 1, etiqueta: 'Edificio A', param: '1' }, { valor: 2, etiqueta: 'Edificio B', param: '2' },
]

const compacto = (v: number | null) => {
  if (v === null) return '—'
  const a = Math.abs(v)
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)} M`
  if (a >= 10_000) return `$${Math.round(v / 1000)} k`
  return fmtUsd(v)
}
const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const CORTO: Record<EstadoEfectivo, string> = { disponible: 'disponibles', reservado: 'reservadas', vendido: 'vendidas' }
const cuenta = (v: number | null) => (v === null ? '—' : String(v))
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nombreMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`

/** Fecha larga y saludo en hora de Ecuador. */
function encabezadoDelDia() {
  const ahora = new Date()
  const fecha = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', weekday: 'long', day: 'numeric', month: 'long' }).format(ahora)
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', hour12: false }).format(ahora))
  return { fecha: fecha.charAt(0).toUpperCase() + fecha.slice(1), saludo: hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches' }
}

interface Kpi { clave: string; label: string; valor: string; hint: ReactNode; icon: LucideIcon; color: string; soft: string; to: string; destacado?: boolean }

function Tarjeta({ k }: { k: Kpi }) {
  const { icon: Icon } = k
  return (
    <Link to={k.to} className={cn('group relative flex min-w-0 flex-col justify-between gap-2.5 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_#1018280a] transition hover:border-[#c7d2fe] hover:shadow-[0_8px_20px_-12px_#10182840] focus-visible:ring-2 focus-visible:ring-primary',
      k.destacado ? 'border-amber-300 bg-amber-50/60' : 'border-border', 'overflow-hidden')} aria-label={`${k.label}: ${k.valor}`}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: k.color }} />
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">
        <span className="truncate">{k.label}</span>
        <span className="grid grid-cols-[minmax(0,1fr)] size-8 shrink-0 place-items-center rounded-xl" style={{ background: k.soft, color: k.color }}><Icon className="size-4" aria-hidden="true" /></span>
      </div>
      <p className="font-display text-[clamp(22px,2.1vw,28px)] font-bold leading-none tracking-tight tabular-nums text-slate-900">{k.valor}</p>
      <p className="flex items-center justify-between gap-2 text-xs leading-snug text-slate-600"><span className="min-w-0">{k.hint}</span><ArrowUpRight className="size-3.5 shrink-0 text-slate-300 transition group-hover:text-primary" aria-hidden="true" /></p>
    </Link>
  )
}

function Seccion({ titulo, sub, to, children, className }: { titulo: string; sub?: string; to?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_#1018280a] sm:p-5', className)} aria-label={titulo}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900"><span aria-hidden="true" className="h-4 w-1 rounded-full bg-indigo-600" />{titulo}</h2>{sub && <p className="mt-0.5 text-xs text-slate-600">{sub}</p>}</div>
        {to && <Link to={to} className="text-slate-400 hover:text-primary" aria-label={`Abrir ${titulo}`}><ArrowUpRight className="size-4" /></Link>}
      </div>
      {children}
    </section>
  )
}

function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-border bg-white shadow-[0_1px_2px_#1018280a]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown className="size-4 text-slate-600 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-border p-4">{children}</div>
    </details>
  )
}

function Dona({ filas, total }: { filas: { key: string; label: string; value: number; color: string }[]; total: number }) {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative size-40 shrink-0" role="img" aria-label={`${total} unidades: ${filas.map((r) => `${r.value} ${r.label.toLowerCase()}`).join(', ')}`}>
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r="49" fill="none" stroke="#eef1f6" strokeWidth="11" />
          {filas.map((f, i) => {
            const largo = total ? (f.value / total) * 100 : 0
            const inicio = total ? (filas.slice(0, i).reduce((t, x) => t + x.value, 0) / total) * 100 : 0
            return <circle key={f.key} cx="60" cy="60" r="49" pathLength="100" fill="none" stroke={f.color} strokeWidth="11" strokeDasharray={`${Math.max(largo - 1, 0)} ${100 - largo + 1}`} strokeDashoffset={-inicio} />
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center"><strong className="text-3xl font-semibold tabular-nums leading-none">{total}</strong><span className="mt-1 text-xs text-slate-600">unidades</span></div>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] w-full gap-1.5 text-[13px]">
        {filas.map((f) => (
          <li key={f.key}><Link to={`/inventario?estado=${f.key}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
            <span className="flex min-w-0 items-center gap-2"><i className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} /><span className="truncate">{f.label}</span></span>
            <b className="tabular-nums">{f.value} <span className="font-normal text-slate-500">· {total ? Math.round((f.value / total) * 100) : 0} %</span></b>
          </Link></li>
        ))}
      </ul>
    </div>
  )
}

function PorEdificio({ unidades, filtro }: { unidades: Unit[]; filtro: EdificioFiltro }) {
  const filas = ([1, 2] as const).filter((e) => filtro === 'todos' || filtro === e).map((e) => {
    const propias = unidades.filter((u) => u.edificio === e)
    return { e, total: propias.length, por: ESTADO_EFECTIVO_ORDEN.map((s) => ({ s, n: propias.filter((u) => estadoEfectivo(u) === s).length })).filter((x) => x.n > 0) }
  })
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {filas.map((f) => (
        <div key={f.e}>
          <div className="mb-1.5 flex items-baseline justify-between text-xs"><Link to={`/inventario?edificio=${f.e}`} className="font-semibold hover:text-primary">{nombreEdificio(f.e)}</Link><span className="tabular-nums text-slate-600">{f.total} unidades</span></div>
          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${nombreEdificio(f.e)}: ${f.por.map((x) => `${x.n} ${ESTADOS_EFECTIVOS[x.s].label.toLowerCase()}`).join(', ')}`}>
            {f.por.map((x) => <span key={x.s} title={`${ESTADOS_EFECTIVOS[x.s].label}: ${x.n}`} style={{ width: `${(x.n / f.total) * 100}%`, background: ESTADOS_EFECTIVOS[x.s].color }} />)}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">{f.por.map((x) => <span key={x.s}><i className="mr-1 inline-block size-1.5 rounded-full" style={{ background: ESTADOS_EFECTIVOS[x.s].color }} />{x.n} {CORTO[x.s]}</span>)}</p>
        </div>
      ))}
    </div>
  )
}

function Embudo({ etapas }: { etapas: Panel['embudo'] }) {
  const maximo = Math.max(1, ...etapas.map((e) => e.valor ?? 0))
  const colores = ['#4f46e5', '#6366f1', '#8b5cf6', '#0e9f6e']
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {etapas.map((e, i) => (
        <li key={e.clave}>
          <div className="mb-1 flex items-baseline justify-between text-[13px]"><span>{e.etiqueta}</span><b className="tabular-nums">{cuenta(e.valor)}</b></div>
          <div className="h-3.5 rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: e.valor ? `${Math.max((e.valor / maximo) * 100, 4)}%` : '0%', background: colores[i] }} /></div>
        </li>
      ))}
    </ol>
  )
}

/** Barras horizontales con etiqueta y valor; cada fila puede enlazar a su módulo. */
function Barras({ filas, formato, nota }: { filas: { key: string; label: string; value: number; color: string; to?: string }[]; formato: (v: number) => string; nota?: string }) {
  const tope = Math.max(1, ...filas.map((f) => f.value))
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {filas.map((f) => {
        const cuerpo = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]"><span className="truncate">{f.label}</span><b className="tabular-nums">{formato(f.value)}</b></div>
            <div className="h-3 rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: f.value ? `${Math.max((f.value / tope) * 100, 3)}%` : '0%', background: f.color }} /></div>
          </>
        )
        return <div key={f.key}>{f.to ? <Link to={f.to} className="block hover:opacity-80">{cuerpo}</Link> : cuerpo}</div>
      })}
      {nota && <p className="text-xs text-slate-600">{nota}</p>}
    </div>
  )
}

/** Cartera de contratos firmados en una barra apilada con su leyenda. */
function Cartera({ c }: { c: NonNullable<Panel['cartera']> }) {
  const total = c.cobrado + c.porVencer + c.vencido
  const partes = [
    { k: 'cobrado', l: 'Cobrado', v: c.cobrado, color: '#0e9f6e' },
    { k: 'porVencer', l: 'Por vencer', v: c.porVencer, color: '#4f46e5' },
    { k: 'vencido', l: 'Vencido', v: c.vencido, color: '#d92d20' },
  ]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Cartera: ${partes.map((p) => `${p.l.toLowerCase()} ${fmtUsd(p.v)}`).join(', ')}`}>
        {partes.map((p) => <span key={p.k} title={`${p.l}: ${fmtUsd(p.v)}`} style={{ width: total ? `${(p.v / total) * 100}%` : '0%', background: p.color }} />)}
      </div>
      <ul className="grid gap-2 text-xs sm:grid-cols-3">
        {partes.map((p) => (
          <li key={p.k} className="rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-xs text-slate-600"><i className="size-2 rounded-full" style={{ background: p.color }} />{p.l}</span><b className="mt-1 block text-base tabular-nums">{fmtUsd(p.v)}</b></li>
        ))}
      </ul>
      <p className="text-xs text-slate-600">Sobre {fmtUsd(c.pactado)} pactados en cuotas de entrada de contratos firmados.</p>
    </div>
  )
}

function Meses({ puntos }: { puntos: Panel['meses'] }) {
  const v = puntos.slice(-6)
  const tope = Math.max(1, ...v.flatMap((p) => [p.ventas, p.cobros]))
  const ancho = 300 / v.length
  return (
    <div>
      <svg viewBox="0 0 300 130" className="mx-auto max-h-60 w-full" role="img" aria-label={`Ventas y cobros por mes: ${v.map((p) => `${nombreMes(p.mes)} ventas ${fmtUsd(p.ventas)}, cobros ${fmtUsd(p.cobros)}`).join('; ')}`}>
        <line x1="0" y1="105" x2="300" y2="105" stroke="#e3e8f0" />
        {v.map((p, i) => {
          const x = i * ancho + ancho / 2
          const h = (n: number) => (n / tope) * 90
          return (
            <g key={p.mes}>
              <rect x={x - 13} y={105 - h(p.ventas)} width="12" height={h(p.ventas)} rx="2.5" fill="#4f46e5"><title>Ventas {nombreMes(p.mes)}: {fmtUsd(p.ventas)}</title></rect>
              <rect x={x + 1} y={105 - h(p.cobros)} width="12" height={h(p.cobros)} rx="2.5" fill="#0e9f6e"><title>Cobros {nombreMes(p.mes)}: {fmtUsd(p.cobros)}</title></rect>
              <text x={x} y="121" textAnchor="middle" fontSize="8.5" fill="#5d6679">{nombreMes(p.mes)}</text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 flex gap-4 text-xs text-slate-600"><span><i className="mr-1 inline-block size-2 rounded-sm bg-[#4f46e5]" />Ventas firmadas</span><span><i className="mr-1 inline-block size-2 rounded-sm bg-[#0e9f6e]" />Cobros confirmados</span></p>
    </div>
  )
}

interface Alerta { clave: string; titulo: string; detalle: string; to: string; tono: 'ambar' | 'rojo' | 'azul' }
const TONO = { ambar: 'bg-aviso-bg text-aviso', rojo: 'bg-peligro-bg text-peligro', azul: 'bg-info-bg text-info' }


function FiltroEdificio({ filtro, fijar }: { filtro: EdificioFiltro; fijar: (p: string) => void }) {
  return (
    <div role="group" aria-label="Filtrar por edificio" className="inline-flex rounded-xl bg-[#eaedf2] p-1">
      {FILTROS.map((f) => (
        <button key={f.param} type="button" aria-pressed={filtro === f.valor} onClick={() => fijar(f.param)}
          className={cn('h-8 rounded-lg px-3 text-[13px] font-semibold transition', filtro === f.valor ? 'bg-white text-foreground shadow-xs' : 'text-slate-600 hover:text-foreground')}>{f.etiqueta}</button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Panorama (administración, gerencia, consulta) */

function Panorama() {
  const medios = useMedios('dashboard')
  const { can, actor } = useSession()
  const { state, filtro, fijarFiltro, entrada, unidades, inv, referenciales, panel, q } = usePanelProyecto()
  const clientesCtx = useClientesOpcional()
  const reservasCtx = useReservasOpcional()
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const propuestas = state.propuestas.filter((p) => p.estado === 'pendiente').length
  const { fecha } = encabezadoDelDia()
  const hoy = hoyGuayaquil()

  const enTramite = unidades.filter((u) => u.solicitud && u.estado === 'disponible')
  const kpisInventario: Kpi[] = [
    { clave: 'total', label: 'Departamentos', valor: String(inv.unidades), hint: filtro === 'todos' ? `Edificio A: ${state.units.filter((u) => u.edificio === 1).length} · Edificio B: ${state.units.filter((u) => u.edificio === 2).length}` : nombreEdificio(filtro), icon: Building2, color: '#4f46e5', soft: '#eef2ff', to: `/inventario${q}` },
    { clave: 'valor', label: 'Valor total de lista', valor: compacto(inv.total), hint: referenciales > 0 ? <span className="font-medium text-amber-700">Referencial · {referenciales} de {inv.unidades} sin aprobar</span> : 'Precios aprobados', icon: CircleDollarSign, color: '#0e9f6e', soft: '#e7f8f2', to: `/inventario${q}` },
    { clave: 'disponibles', label: 'Disponibles', valor: String(inv.porEstado.disponible), hint: enTramite.length ? `${pl(enTramite.length, 'con solicitud', 'con solicitud')} de reserva en trámite` : 'Listas para cotizar y reservar', icon: Building2, color: '#0e9f6e', soft: '#e3f7f2', to: `/inventario?estado=disponible${q ? `&edificio=${filtro}` : ''}` },
    { clave: 'reservadas', label: 'Reservadas', valor: String(inv.porEstado.reservado), hint: 'Con reserva vigente', icon: Receipt, color: '#8b5cf6', soft: '#f2ecff', to: `/inventario?estado=reservado${q ? `&edificio=${filtro}` : ''}` },
    { clave: 'vendidas', label: 'Vendidas', valor: String(inv.porEstado.vendido), hint: 'Venta formalizada', icon: FileSignature, color: '#4f46e5', soft: '#eef2ff', to: `/inventario?estado=vendido${q ? `&edificio=${filtro}` : ''}` },
  ]
  const kpisNegocio: Kpi[] = [
    { clave: 'clientes', label: 'Clientes registrados', valor: cuenta(panel?.clientes ?? null), hint: panel && panel.clientes === null ? 'Sin acceso' : filtro === 'todos' ? 'En el proyecto' : `Con interés en el ${nombreEdificio(filtro)}`, icon: Users, color: '#4f46e5', soft: '#eef2ff', to: '/clientes' },
    { clave: 'reservas', label: 'Reservas activas', valor: cuenta(panel?.reservasActivas ?? null), hint: panel && panel.reservasActivas === null ? 'Sin acceso' : 'Sin contrato aún', icon: Receipt, color: '#8b5cf6', soft: '#f2ecff', to: '/reservas' },
    { clave: 'contratos', label: 'Contratos firmados', valor: cuenta(panel?.contratosFirmados ?? null), hint: panel && panel.contratosFirmados === null ? 'Sin acceso' : 'Formalizados en Ventas', icon: FileSignature, color: '#0e9f6e', soft: '#e7f8f2', to: '/ventas' },
    { clave: 'ventas', label: 'Ventas firmadas', valor: compacto(panel?.ventasFirmadas ?? null), hint: 'Precio de contratos firmados', icon: Banknote, color: '#4f46e5', soft: '#eef2ff', to: '/ventas' },
    { clave: 'cobros', label: 'Cobros confirmados', valor: compacto(panel?.cobrosConfirmados ?? null), hint: 'Pagos verificados por Finanzas', icon: CircleDollarSign, color: '#0e9f6e', soft: '#e3f7f2', to: '/cobranzas' },
    { clave: 'saldo', label: 'Saldo por cobrar', valor: compacto(panel?.saldoPendiente ?? null), hint: 'Cuotas de contratos firmados', icon: Tags, color: '#b54708', soft: '#fff1d6', to: '/cobranzas' },
  ]
  // El embudo del negocio va primero; el resto de indicadores queda plegado para no alargar la pantalla.
  const PRINCIPALES = ['disponibles', 'clientes', 'reservas', 'contratos', 'ventas']
  const todos = [...kpisInventario, ...kpisNegocio]
  const principales = PRINCIPALES.map((c) => todos.find((k) => k.clave === c)!)
  const resto = todos.filter((k) => !PRINCIPALES.includes(k.clave))

  const alertas: Alerta[] = []
  if (reservasCtx) {
    const porAtender = reservasVisibles(reservasCtx.state.reservas, actor).filter((r) => siguientePaso(r, can, { remoto: reservasCtx.remoto }).accion).length
    if (porAtender) alertas.push({ clave: 'atender', titulo: `${pl(porAtender, 'reserva espera', 'reservas esperan')} una acción`, detalle: 'Pagos por registrar o verificar y excepciones por autorizar.', to: '/reservas', tono: 'azul' })
  }
  if (enTramite.length > 0) alertas.push({ clave: 'en_proceso', titulo: `${pl(enTramite.length, 'solicitud', 'solicitudes')} de reserva en trámite`, detalle: enTramite.map((u) => `${u.dpt}: ${u.solicitud?.codigo}`).slice(0, 3).join(' · '), to: '/reservas', tono: 'azul' })
  if (clientesCtx) {
    const vencidas = clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && urgencia(c, hoy) === 'vencida').length
    if (vencidas) alertas.push({ clave: 'vencidas', titulo: `${pl(vencidas, 'gestión comercial vencida', 'gestiones comerciales vencidas')}`, detalle: 'Clientes con la próxima acción atrasada.', to: '/clientes?filtro=vencidas', tono: 'rojo' })
    const sinGestion = clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && urgencia(c, hoy) === 'sin_actividad').length
    if (sinGestion) alertas.push({ clave: 'sin_gestion', titulo: pl(sinGestion, 'cliente sin próxima gestión', 'clientes sin próxima gestión'), detalle: 'Sin siguiente paso programado: el seguimiento se enfría.', to: '/clientes?filtro=sin', tono: 'ambar' })
  }
  if (referenciales > 0 || propuestas > 0) alertas.push({ clave: 'precios', titulo: 'Precios pendientes de aprobación', detalle: [referenciales ? `${referenciales} unidades con precio referencial` : '', propuestas ? `${propuestas} propuestas por resolver` : ''].filter(Boolean).join(' · '), to: propuestas ? '/precios' : '/inventario', tono: 'ambar' })
  if (panel?.reservasPorVencer?.length) {
    const p = panel.reservasPorVencer[0]
    alertas.push({ clave: 'reservas', titulo: `${pl(panel.reservasPorVencer.length, 'reserva', 'reservas')} por vencer`, detalle: `${numeroComercial(p.unidad)}: ${p.dias < 0 ? `venció hace ${-p.dias} d` : p.dias === 0 ? 'vence hoy' : `vence en ${p.dias} d`}`, to: '/reservas', tono: 'rojo' })
  }
  if (panel?.cuotasVencidas && panel.cuotasVencidas.cuotas > 0) alertas.push({ clave: 'cuotas', titulo: `${pl(panel.cuotasVencidas.cuotas, 'cuota vencida', 'cuotas vencidas')}`, detalle: `${fmtUsd(panel.cuotasVencidas.monto)} en ${pl(panel.cuotasVencidas.contratos, 'contrato', 'contratos')}`, to: '/cobranzas', tono: 'rojo' })
  if (panel?.contratosPendientesFirma) alertas.push({ clave: 'firma', titulo: `${pl(panel.contratosPendientesFirma, 'contrato pendiente', 'contratos pendientes')} de firma`, detalle: 'Preparados, sin formalizar.', to: '/ventas', tono: 'azul' })
  if (entrada?.plantillasPendientes) alertas.push({ clave: 'plantillas', titulo: `${pl(entrada.plantillasPendientes, 'documento contractual', 'documentos contractuales')} por aprobar`, detalle: 'Plantillas en borrador, sin uso hasta que Legal las apruebe.', to: '/ventas', tono: 'azul' })
  if (panel?.comprobantesPendientes) alertas.push({ clave: 'comprobantes', titulo: `${pl(panel.comprobantesPendientes, 'comprobante', 'comprobantes')} por verificar`, detalle: 'Pagos registrados sin confirmar.', to: '/cobranzas', tono: 'azul' })
  if (entrada?.desistimientosPendientes) alertas.push({ clave: 'desistimientos', titulo: `${pl(entrada.desistimientosPendientes, 'desistimiento', 'desistimientos')} por autorizar`, detalle: 'Las unidades siguen retenidas hasta decidir.', to: '/clientes', tono: 'rojo' })

  const agenda = clientesCtx ? ordenarPorUrgencia(clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && ['vencida', 'hoy'].includes(urgencia(c, hoy))), hoy) : []

  const valorPorEstado = useMemo(() => {
    const m = new Map<EstadoEfectivo, number>()
    for (const u of unidades) m.set(estadoEfectivo(u), (m.get(estadoEfectivo(u)) ?? 0) + calcularPrecio(u, state.params).precioVenta)
    return m
  }, [unidades, state.params])
  const filasEdificio = ([1, 2] as const).filter((e) => filtro === 'todos' || filtro === e).map((e) => {
    const propias = unidades.filter((u) => u.edificio === e)
    return {
      key: `e${e}`, label: nombreEdificio(e), value: propias.reduce((t, u) => t + calcularPrecio(u, state.params).precioVenta, 0),
      color: e === 1 ? '#4f46e5' : '#0e9f6e', to: `/inventario?edificio=${e}`, unidades: propias.length, m2: propias.reduce((t, u) => t + u.areaM2, 0),
    }
  })
  const etiquetaReserva: Record<string, string> = { solicitada: 'Solicitadas', pago_verificado: 'Excepciones por autorizar', confirmada: 'Confirmadas' }
  const filasReservas = (panel?.reservasPorEstado ?? []).map((r) => ({ key: r.estado, label: etiquetaReserva[r.estado] ?? r.estado, value: r.cantidad, color: '#8b5cf6', to: '/reservas' }))
  const filasDona = ESTADO_EFECTIVO_ORDEN.map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: inv.porEstado[e], color: ESTADOS_EFECTIVOS[e].color })).filter((r) => r.value > 0)
  const obra = entrada?.obra?.filter((f) => (f.codigo === 'edificio1' || f.codigo === 'edificio2') && f.actividadesConAvance > 0 && f.avance !== null && (filtro === 'todos' || f.codigo === `edificio${filtro}`)) ?? []

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {can('inventario.ver') && <MapaDisponibilidad />}
      <CabeceraPanel eyebrow={`${fecha} · AMURA Apartments`} title="Panorama del negocio" subtitle="Cifras reales de Supabase. Primero lo que espera una decisión; después el embudo y los indicadores."
        acciones={<>
          <FiltroEdificio filtro={filtro} fijar={fijarFiltro} />
          {can('cotizaciones.crear') && <Button asChild><Link to="/venta"><Plus />Atender cliente</Link></Button>}
        </>} />
      {filtro !== 'todos' && <p className="-mt-3 text-xs text-slate-600">Filtra inventario, reservas, contratos y cobros. Clientes y cotizaciones se cuentan por su interés en el edificio.</p>}

      <section aria-label="Indicadores principales" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{principales.map((k) => <Tarjeta key={k.clave} k={k} />)}</section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Seccion titulo="Requiere atención" sub={alertas.length ? 'Lo que está registrado y espera una decisión' : 'Nada espera una decisión en este momento'}>
          {alertas.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {alertas.map((a) => (
                <li key={a.clave}><Link to={a.to} className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:border-[#c7d2fe] hover:bg-[#fafbff]">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', TONO[a.tono])}><AlertTriangle className="size-4" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1 text-xs"><strong className="block text-[13.5px] text-slate-900">{a.titulo}</strong><span className="mt-0.5 block truncate text-slate-600">{a.detalle}</span></span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                </Link></li>
              ))}
            </ul>
          ) : <p className="rounded-xl bg-muted/60 p-4 text-[13px] text-slate-600">Todo al día: no hay reservas, precios ni documentos por decidir.</p>}
        </Seccion>
        {clientesCtx && can('clientes.ver') && (
          <Seccion titulo="Agenda comercial de hoy" sub={agenda.length ? `${agenda.length} gestiones vencidas o para hoy en todo el equipo` : 'Sin gestiones vencidas ni para hoy'} to="/clientes?filtro=hoy">
            {agenda.length ? (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">{agenda.slice(0, 5).map((c) => <FilaGestion key={c.id} c={c} onAviso={setAviso} vendedor />)}</ul>
            ) : <p className="rounded-xl bg-muted/60 p-4 text-[13px] text-slate-600">El seguimiento del equipo está al día.</p>}
            {agenda.length > 5 && <Link to="/clientes?filtro=vencidas" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Ver las {agenda.length} gestiones<ChevronRight className="size-3.5" /></Link>}
          </Seccion>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Seccion titulo="Embudo comercial" sub="De clientes a ventas firmadas" to="/clientes?vista=embudo">{panel ? <Embudo etapas={panel.embudo} /> : <p className="text-xs text-slate-600">Cargando…</p>}</Seccion>
        <Seccion titulo="Inventario por estado" sub="Unidades por estado comercial" to="/inventario"><Dona filas={filasDona} total={inv.unidades} /></Seccion>
      </div>

      <Plegable titulo={`Ver los ${resto.length} indicadores restantes`}>
        <section aria-label="Más indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3">{resto.map((k) => <Tarjeta key={k.clave} k={k} />)}</section>
      </Plegable>

      <Plegable titulo="Ver más gráficos: ventas y cobranzas, reservas, cartera, mora y valores de lista">
        <div className="grid gap-5 lg:grid-cols-2">
          <Seccion titulo="Ventas y cobranzas por mes" sub="Contratos firmados y pagos verificados" to="/cobranzas">
            {panel && panel.meses.length > 0 ? <Meses puntos={panel.meses} /> : (
              <p className="grid grid-cols-[minmax(0,1fr)] min-h-28 place-content-center text-center text-xs text-slate-600">{panel && panel.contratosFirmados === null ? 'Tu perfil no consulta ventas ni cobranzas.' : 'Aún no hay ventas firmadas ni cobros confirmados.'}</p>
            )}
          </Seccion>
          <Seccion titulo="Reservas por estado" sub="Reservas abiertas y su etapa" to="/reservas">
            {filasReservas.length ? <Barras filas={filasReservas} formato={(v) => String(v)} /> : (
              <p className="grid grid-cols-[minmax(0,1fr)] min-h-28 place-content-center text-center text-xs text-slate-600">{panel?.reservasActivas === null ? 'Tu perfil no consulta reservas.' : panel ? 'No hay reservas abiertas.' : 'Cargando…'}</p>
            )}
          </Seccion>
          <Seccion titulo="Edificio A vs. Edificio B" sub="Reparto de estados en cada edificio"><PorEdificio unidades={unidades} filtro={filtro} /></Seccion>
          <Seccion titulo="Cartera de contratos firmados" sub="Cuánto se ha cobrado y cuánto falta" to="/cobranzas">
            {panel?.cartera && panel.cartera.pactado > 0 ? <Cartera c={panel.cartera} /> : (
              <p className="grid grid-cols-[minmax(0,1fr)] min-h-28 place-content-center text-center text-xs text-slate-600">{panel?.cartera ? 'Aún no hay contratos firmados con cuotas de entrada.' : panel === null ? 'Cargando…' : 'Tu perfil no consulta cobranzas.'}</p>
            )}
          </Seccion>
          <Seccion titulo="Mora por antigüedad" sub="Saldo vencido según días de atraso" to="/cobranzas">
            {panel?.mora && panel.mora.some((m) => m.monto > 0) ? (
              <Barras filas={panel.mora.map((m, i) => ({ key: m.id, label: m.etiqueta, value: m.monto, color: ['#f5a524', '#f08a24', '#e2662e', '#d92d20', '#9f1239'][i], to: '/cobranzas' }))} formato={fmtUsd} nota="Solo cuotas de entrada de contratos firmados." />
            ) : (
              <p className="grid grid-cols-[minmax(0,1fr)] min-h-28 place-content-center text-center text-xs text-slate-600">{panel?.mora ? 'Sin cuotas vencidas: no hay mora que mostrar.' : panel === null ? 'Cargando…' : 'Tu perfil no consulta cobranzas.'}</p>
            )}
          </Seccion>
          <Seccion titulo="Valor de lista por edificio" sub="Precios referenciales hasta su aprobación" to="/inventario">
            <Barras filas={filasEdificio} formato={compacto} nota={filasEdificio.map((f) => `${f.label}: ${f.unidades} unidades · ${fmtNum(f.m2)} m²`).join('  ·  ')} />
          </Seccion>
          <Seccion titulo="Valor de lista por estado" sub="Cuánto vale cada grupo de unidades" to="/inventario">
            <Barras filas={ESTADO_EFECTIVO_ORDEN.filter((e) => (valorPorEstado.get(e) ?? 0) > 0).map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: valorPorEstado.get(e) ?? 0, color: ESTADOS_EFECTIVOS[e].color, to: `/inventario?estado=${e}${q ? `&edificio=${filtro}` : ''}` }))} formato={compacto} />
          </Seccion>
        </div>
      </Plegable>

      {can('clientes.ver') && <PanelLeads />}

      {obra.length > 0 && (
        <Seccion titulo="Avance físico de obra" sub="Avance actual por edificio" to="/obra">
          <ul className="grid gap-4 md:grid-cols-2">
            {obra.map((f) => (
              <li key={f.codigo}>
                <div className="mb-1.5 flex items-baseline justify-between text-xs"><span className="flex items-center gap-1.5 font-semibold"><HardHat className="size-3.5 text-slate-400" aria-hidden="true" />{f.nombre}</span><b className="tabular-nums">{f.avance!.toFixed(1)} %</b></div>
                <div className="h-3.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={f.avance!} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance de ${f.nombre}`}><div className="h-full rounded-full bg-[#0e9f6e]" style={{ width: `${Math.min(f.avance!, 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <p className="flex items-start gap-1.5 text-xs text-slate-600"><Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span>El valor de lista usa precios {referenciales > 0 ? 'referenciales aún sin aprobar' : 'aprobados'}; no son ventas. Las ventas y los cobros salen de contratos firmados y pagos verificados. «—» indica que tu perfil no consulta ese dato.</span></p>
      <BannerBienvenida medios={medios} />
      <ConoceAmura medios={medios} />
      <Aviso texto={aviso} onClose={cerrarAviso} />
    </div>
  )
}

/* ------------------------------------------------------------------ Mi día (Vendedor, Corredor) */

function MiDia() {
  const medios = useMedios('dashboard')
  const { actor, can } = useSession()
  const { inv, panel } = usePanelProyecto()
  const clientesCtx = useClientesOpcional()
  const reservasCtx = useReservasOpcional()
  const pendientes = usePendientesDelDia()
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const [error, setError] = useState<string | null>(null)
  const { fecha, saludo } = encabezadoDelDia()
  const hoy = hoyGuayaquil()
  const mios = clientesCtx ? clientesVisibles(clientesCtx.state.clientes, actor) : []
  const activos = mios.filter((c) => c.etapa !== 'perdido')
  const enCurso = reservasCtx ? reservasVisibles(reservasCtx.state.reservas, actor).filter((r) => r.estado === 'solicitada' || r.estado === 'pago_verificado').length : null
  const maxEtapa = Math.max(1, ...ETAPAS_EMBUDO.map((e) => activos.filter((c) => c.etapa === e).length))
  const partes = pendientes ? [
    pendientes.reservas ? pl(pendientes.reservas, 'reserva por atender', 'reservas por atender') : '',
    pendientes.vencidas ? pl(pendientes.vencidas, 'gestión vencida', 'gestiones vencidas') : '',
    pendientes.deHoy ? pl(pendientes.deHoy, 'gestión para hoy', 'gestiones para hoy') : '',
    pendientes.sinGestion ? pl(pendientes.sinGestion, 'cliente sin próxima gestión', 'clientes sin próxima gestión') : '',
  ].filter(Boolean) : []
  const resumen = pendientes === null ? 'Tu agenda comercial del día.'
    : partes.length === 0 ? 'Todo al día: sin reservas ni gestiones pendientes, y cada cliente tiene su próxima gestión.'
      : `Tienes ${partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]}.`
  const kpis: { label: string; valor: string; detalle: string; to: string; icon: LucideIcon }[] = [
    { label: 'Mis clientes activos', valor: String(activos.length), detalle: `${activos.filter((c) => urgencia(c, hoy) === 'sin_actividad').length} sin próxima gestión`, to: '/clientes', icon: Users },
    { label: 'Gestiones de hoy', valor: String(activos.filter((c) => urgencia(c, hoy) === 'hoy').length), detalle: `${activos.filter((c) => urgencia(c, hoy) === 'vencida').length} vencidas`, to: '/clientes?filtro=hoy', icon: CalendarClock },
    { label: 'Reservas en curso', valor: enCurso === null ? '—' : String(enCurso), detalle: 'Solicitadas o por autorizar', to: '/reservas', icon: Receipt },
    { label: 'Disponibles para vender', valor: String(inv.porEstado.disponible), detalle: `De ${inv.unidades} departamentos`, to: '/inventario?estado=disponible', icon: Building2 },
  ]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {can('inventario.ver') && <MapaDisponibilidad />}
      <PageHeader eyebrow={fecha} title={`${saludo}, ${actor.nombre.split(' ')[0]}`} subtitle={resumen}
        actions={can('cotizaciones.crear') ? <Button asChild><Link to="/venta"><Plus />Atender cliente</Link></Button> : undefined} />
      {error && <FieldError>{error}</FieldError>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="hacer-ahora" className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <h2 id="hacer-ahora" className="text-[15px] font-semibold">Hacer ahora</h2>
          <ColaDelDia onAviso={(m) => { setError(null); setAviso(m) }} onError={setError} />
        </section>
        <aside className="grid grid-cols-[minmax(0,1fr)] gap-3" aria-label="Mis indicadores">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
            {kpis.map((k) => (
              <Link key={k.label} to={k.to} aria-label={`${k.label}: ${k.valor}`} className="group rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_#1018280a] transition hover:border-[#c7d2fe]">
                <span className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-600">{k.label}<k.icon className="size-4 text-slate-400 group-hover:text-primary" aria-hidden="true" /></span>
                <span className="mt-1.5 block text-2xl font-semibold tabular-nums">{k.valor}</span>
                <span className="mt-0.5 block text-xs text-slate-600">{k.detalle}</span>
              </Link>
            ))}
          </div>
          {activos.length > 0 && (
            <Seccion titulo="Mi embudo" sub="Clientes activos por etapa" to="/clientes?vista=embudo">
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {ETAPAS_EMBUDO.map((e) => {
                  const n = activos.filter((c) => c.etapa === e).length
                  return (
                    <li key={e} className="grid grid-cols-[96px_1fr_24px] items-center gap-2 text-xs">
                      <span className="text-slate-600">{ETAPAS[e].label}</span>
                      <span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full" style={{ width: `${(n / maxEtapa) * 100}%`, background: ETAPAS[e].color }} /></span>
                      <b className="text-right tabular-nums">{n}</b>
                    </li>
                  )
                })}
              </ul>
            </Seccion>
          )}
        </aside>
      </div>
      {can('clientes.ver') && <PanelLeads />}
      <Plegable titulo="Ver el panorama del proyecto: embudo e inventario">
        <div className="grid gap-5 lg:grid-cols-2">
          <Seccion titulo="Embudo comercial" sub="De clientes a ventas firmadas">{panel ? <Embudo etapas={panel.embudo} /> : <p className="text-xs text-slate-600">Cargando…</p>}</Seccion>
          <Seccion titulo="Inventario por estado" sub="Unidades por estado comercial" to="/inventario"><Dona filas={ESTADO_EFECTIVO_ORDEN.map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: inv.porEstado[e], color: ESTADOS_EFECTIVOS[e].color })).filter((r) => r.value > 0)} total={inv.unidades} /></Seccion>
        </div>
      </Plegable>
      <Plegable titulo="Conoce AMURA: video y galería">
        <ConoceAmura medios={medios} />
      </Plegable>
      <Aviso texto={aviso} onClose={cerrarAviso} />
    </div>
  )
}
