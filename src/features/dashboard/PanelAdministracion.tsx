import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowUpRight, Banknote, BellRing, Building2, CalendarCheck, CalendarClock, CheckCircle2, ChevronDown, ChevronRight,
  CircleDollarSign, FileSignature, HardHat, Info, Plus, Search, ShieldAlert, SquareKanban, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { useSession } from '@/app/session'
import Aviso from '@/components/Aviso'
import Estado, { Avatar } from '@/components/Estado'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AccionesRapidas from '@/features/clientes/components/AccionesRapidas'
import { TIPOS_ACTIVIDAD, type Cliente } from '@/features/clientes/model'
import { clientesVisibles, ordenarPorUrgencia, urgencia } from '@/features/clientes/service'
import { useClientesOpcional } from '@/features/clientes/store'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { ESTADO_EFECTIVO_ORDEN, ESTADOS_EFECTIVOS, estadoEfectivo, type EstadoEfectivo } from '@/features/inventario/estados'
import { calcularPrecio, fmtNum, fmtUsd } from '@/features/inventario/pricing'
import BuildingMap from '@/features/inventario/components/BuildingMap'
import UnitDetailSheet from '@/features/inventario/components/UnitDetailSheet'
import type { PricingParams, Unit } from '@/features/inventario/types'
import PanelLeads from '@/features/leads/PanelLeads'
import BannerBienvenida from '@/features/marca/BannerBienvenida'
import ConoceAmura from '@/features/marca/ConoceAmura'
import { useMedios } from '@/features/marca/useMedios'
import { reservasVisibles } from '@/features/reservas/service'
import { siguientePaso } from '@/features/reservas/siguiente'
import { useReservasOpcional } from '@/features/reservas/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import type { EdificioFiltro, Panel } from './panel'
import { usePanelProyecto, type DatosProyecto } from './proyecto'
import { nombreEdificio, numeroComercial, textoBusquedaUnidad } from '@/features/inventario/nomenclatura'

/**
 * Dashboard de administración: primero lo que pide una decisión, después una tira compacta de indicadores y
 * paneles con gráficos (embudo, ventas y cobros, inventario y cartera). Lo secundario queda en secciones desplegables.
 * Usa los mismos datos y cálculos de siempre; «—» significa sin acceso o sin lectura, nunca cero.
 */

/** Paleta de los paneles: cada área tiene su color y lo repite en su etiqueta y en su gráfico. */
const COLOR = { azul: '#2563EB', cian: '#06B6D4', verde: '#10B981', violeta: '#8B5CF6', ambar: '#F59E0B', rosa: '#F43F5E', naranja: '#F97316' }

const compacto = (v: number | null) => {
  if (v === null) return '—'
  const a = Math.abs(v)
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)} M`
  if (a >= 10_000) return `$${Math.round(v / 1000)} k`
  return fmtUsd(v)
}
const cuenta = (v: number | null) => (v === null ? '—' : String(v))
const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toLocaleString('es-EC', { maximumFractionDigits: 1 })} %` : '—')
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nombreMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`
const PLURAL: Record<EstadoEfectivo, string> = { disponible: 'Disponibles', reservado: 'Reservadas', vendido: 'Vendidas' }

function fechaLarga(hoy: string) {
  const [y, m, d] = hoy.split('-').map(Number)
  const f = new Intl.DateTimeFormat('es-EC', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(Date.UTC(y, m - 1, d, 12))
  return f.charAt(0).toUpperCase() + f.slice(1)
}

/* ---------------------------------------------------------------- piezas */

function Bloque({ titulo, etiqueta, color, icono: Icono, accion, children, className }: {
  titulo: string; etiqueta?: string; color: string; icono: LucideIcon; accion?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section aria-label={titulo} className={cn('h-full min-w-0 rounded-2xl border border-[#e6e8ec] bg-white shadow-[0_1px_2px_#1018280d]', className)}>
      <header className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
        <h2 className="text-[15px] font-semibold tracking-tight text-[#101828]">{titulo}</h2>
        {etiqueta && (
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[#e6e8ec] bg-[#fafbfc] px-1.5 text-xs font-semibold text-[#344054]">
            <span className="grid size-4 place-items-center rounded" style={{ background: color }}><Icono className="size-2.5 text-white" aria-hidden="true" /></span>{etiqueta}
          </span>
        )}
        {accion && <div className="ml-auto flex items-center gap-1">{accion}</div>}
      </header>
      <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
    </section>
  )
}

function Abrir({ to, titulo }: { to: string; titulo: string }) {
  return <Link to={to} aria-label={`Abrir ${titulo}`} title={`Abrir ${titulo}`} className="grid size-8 place-items-center rounded-lg text-[#667085] hover:bg-[#f2f4f7] hover:text-[#101828]"><ArrowUpRight className="size-4" /></Link>
}

function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-[#e6e8ec] bg-white shadow-[0_1px_2px_#1018280d]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[13.5px] font-semibold text-[#344054] hover:bg-[#f8f9fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-5 [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown className="size-4 text-[#667085] transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-[#eef0f3] p-4 sm:p-5">{children}</div>
    </details>
  )
}

/** Tendencia mínima para un indicador: solo la forma, sin ejes. */
function Tendencia({ valores, color }: { valores: number[]; color: string }) {
  if (valores.length < 2) return null
  const max = Math.max(...valores, 1)
  const min = Math.min(...valores, 0)
  const puntos = valores.map((v, i) => `${(i / (valores.length - 1)) * 64},${22 - ((v - min) / (max - min || 1)) * 20}`).join(' ')
  return <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0" aria-hidden="true"><polyline points={puntos} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

/* ---------------------------------------------------------------- centro de atención */

type Severidad = 'urgente' | 'accion' | 'aviso' | 'info'
const SEV: Record<Severidad, { color: string; fondo: string; icono: LucideIcon; nombre: string; orden: number }> = {
  urgente: { color: '#E11D48', fondo: '#FFF1F2', icono: ShieldAlert, nombre: 'Urgente', orden: 0 },
  accion: { color: '#4F46E5', fondo: '#EEF2FF', icono: BellRing, nombre: 'Por decidir', orden: 1 },
  aviso: { color: '#D97706', fondo: '#FFFBEB', icono: AlertTriangle, nombre: 'Revisar', orden: 2 },
  info: { color: '#0284C7', fondo: '#F0F9FF', icono: Info, nombre: 'En curso', orden: 3 },
}
interface Pendiente { clave: string; titulo: string; detalle: string; to: string; sev: Severidad }

function CentroAtencion({ items, ancho = false }: { items: Pendiente[]; ancho?: boolean }) {
  const [todos, setTodos] = useState(false)
  const urgentes = items.filter((i) => i.sev === 'urgente').length
  const visibles = todos ? items : items.slice(0, 5)
  return (
    <Bloque titulo="Centro de atención" etiqueta="Prioridades" color={COLOR.rosa} icono={BellRing}
      accion={<span className="text-xs font-semibold text-[#667085]">{pl(items.length, 'pendiente', 'pendientes')}{urgentes ? <span className="text-[#E11D48]"> · {pl(urgentes, 'urgente', 'urgentes')}</span> : null}</span>}>
      <ul className={cn('-mx-2 grid grid-cols-[minmax(0,1fr)] gap-0.5', ancho && 'xl:grid-cols-2 xl:gap-x-6')}>
        {visibles.map((a) => {
          const s = SEV[a.sev]
          return (
            <li key={a.clave}>
              <Link to={a.to} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[#f8f9fb]">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: s.fondo, color: s.color }}><s.icono className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[13.5px] font-semibold text-[#101828]">{a.titulo}</strong>
                  <span className="block truncate text-xs text-[#667085]">{a.detalle}</span>
                </span>
                <span className="hidden shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold sm:inline" style={{ background: s.fondo, color: s.color }}>{s.nombre}</span>
                <ChevronRight className="size-4 shrink-0 text-[#98a2b3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#101828]" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setTodos(!todos)} className="mt-2 text-xs font-semibold text-primary hover:underline">
          {todos ? 'Ver menos' : `Ver ${items.length - 5} más`}
        </button>
      )}
    </Bloque>
  )
}

function AgendaHoy({ clientes, onAviso }: { clientes: Cliente[]; onAviso: (m: string) => void }) {
  return (
    <Bloque titulo="Agenda de hoy" etiqueta="Equipo" color={COLOR.violeta} icono={CalendarClock}
      accion={<Link to="/clientes?filtro=vencidas" className="text-xs font-semibold text-primary hover:underline">Ver todas ({clientes.length})</Link>}>
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-[#f2f4f7]">
        {clientes.slice(0, 5).map((c) => {
          const u = urgencia(c)
          return (
            <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Avatar nombre={c.nombre} />
              <div className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <Link to={`/clientes?cliente=${c.id}`} className="truncate text-[13.5px] font-semibold text-[#101828] hover:underline">{c.nombre}</Link>
                  <Estado tono={u === 'vencida' ? 'peligro' : 'aviso'} className="h-5 px-2">{u === 'vencida' ? 'Vencida' : 'Hoy'}</Estado>
                </span>
                <span className="block truncate text-xs text-[#667085]">{c.proxima ? `${TIPOS_ACTIVIDAD[c.proxima.tipo]} · ${c.proxima.descripcion} · ${fmtFechaCorta(c.proxima.fecha)}` : 'Sin próxima gestión'} · {c.asesor}</span>
              </div>
              <AccionesRapidas cliente={c} onMessage={onAviso} />
            </li>
          )
        })}
      </ul>
    </Bloque>
  )
}

/* ---------------------------------------------------------------- indicadores */

interface Indicador { clave: string; label: string; valor: string; detalle: string; to: string; icono: LucideIcon; color: string; serie?: number[] }

function Indicadores({ items }: { items: Indicador[] }) {
  return (
    <section aria-label="Indicadores principales" className="overflow-hidden rounded-2xl border border-[#e6e8ec] bg-white shadow-[0_1px_2px_#1018280d]">
      <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((k) => (
          <Link key={k.clave} to={k.to} aria-label={`${k.label}: ${k.valor}`}
            className="flex min-w-0 flex-col gap-2 border-b border-r border-[#eef0f3] p-3.5 transition-colors hover:bg-[#f8f9fb] focus-visible:bg-[#f8f9fb] focus-visible:outline-none sm:p-4">
            <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#475467]">
              <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `${k.color}1f`, color: k.color }}><k.icono className="size-3.5" aria-hidden="true" /></span>
              <span className="truncate">{k.label}</span>
            </span>
            <span className="flex items-end justify-between gap-2">
              <b className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-[#101828]">{k.valor}</b>
              {k.serie && <Tendencia valores={k.serie} color={k.color} />}
            </span>
            <span className="truncate text-xs text-[#667085]">{k.detalle}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- embudo */

const DESTINO_ETAPA: Record<string, string> = { clientes: '/clientes', cotizaciones: '/cotizaciones', reservas: '/reservas', ventas: '/ventas' }

function EmbudoHorizontal({ etapas }: { etapas: Panel['embudo'] }) {
  const n = etapas.length
  const valores = etapas.map((e) => e.valor ?? 0)
  const max = Math.max(1, ...valores)
  const W = n * 100
  const H = 120
  const cy = H / 2
  const h = valores.map((v) => Math.max(5, (v / max) * 54))
  const xa = (i: number) => i * 100 + (i === 0 ? 0 : 30)
  const xb = (i: number) => (i + 1) * 100 - (i === n - 1 ? 0 : 30)
  // Tramos planos por etapa unidos con curvas suaves: el ancho de cada tramo es proporcional a su valor.
  let d = `M 0 ${cy - h[0]}`
  for (let i = 0; i < n; i++) {
    d += ` L ${xb(i)} ${cy - h[i]}`
    if (i < n - 1) { const bx = (i + 1) * 100; d += ` C ${bx} ${cy - h[i]}, ${bx} ${cy - h[i + 1]}, ${xa(i + 1)} ${cy - h[i + 1]}` }
  }
  d += ` L ${W} ${cy + h[n - 1]}`
  for (let i = n - 1; i >= 0; i--) {
    d += ` L ${xa(i)} ${cy + h[i]}`
    if (i > 0) { const bx = i * 100; d += ` C ${bx} ${cy + h[i]}, ${bx} ${cy + h[i - 1]}, ${xb(i - 1)} ${cy + h[i - 1]}` }
  }
  d += ' Z'
  const columnas = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }
  return (
    <div>
      <div className="grid text-center" style={columnas}>
        {etapas.map((e, i) => (
          <Link key={e.clave} to={DESTINO_ETAPA[e.clave] ?? '/clientes?vista=embudo'} className="grid justify-items-center gap-1 rounded-lg px-1 py-1 hover:bg-[#f8f9fb]">
            <span className="max-w-full truncate text-[13px] text-[#475467]">{e.etiqueta}</span>
            <span className="rounded-md bg-[#f2f4f7] px-1.5 text-xs font-semibold tabular-nums text-[#344054]">{pct(valores[i], valores[0])}</span>
          </Link>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 h-36 w-full" role="img"
        aria-label={`Embudo comercial: ${etapas.map((e) => `${e.etiqueta} ${cuenta(e.valor)}`).join(', ')}`}>
        <defs>
          <linearGradient id="amura-embudo" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#2563EB" /><stop offset="1" stopColor="#60A5FA" /></linearGradient>
        </defs>
        <path d={d} fill="url(#amura-embudo)" />
        {Array.from({ length: n - 1 }, (_, i) => <line key={i} x1={(i + 1) * 100} x2={(i + 1) * 100} y1="0" y2={H} stroke="#ffffff" strokeOpacity="0.7" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="mt-2 grid text-center" style={columnas}>
        {etapas.map((e) => <span key={e.clave} className="text-[15px] font-semibold tabular-nums text-[#101828]">{cuenta(e.valor)}</span>)}
      </div>
    </div>
  )
}

/** En el celular el embudo se lee de arriba abajo: cada etapa es una barra centrada y más angosta que la anterior. */
function EmbudoVertical({ etapas }: { etapas: Panel['embudo'] }) {
  const valores = etapas.map((e) => e.valor ?? 0)
  const max = Math.max(1, ...valores)
  return (
    <ol className="grid gap-2.5">
      {etapas.map((e, i) => (
        <li key={e.clave}>
          <Link to={DESTINO_ETAPA[e.clave] ?? '/clientes?vista=embudo'} className="block rounded-xl">
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-[#475467]">{e.etiqueta}</span>
              <span className="flex items-center gap-1.5"><b className="tabular-nums text-[#101828]">{cuenta(e.valor)}</b><span className="rounded-md bg-[#f2f4f7] px-1.5 text-xs font-semibold tabular-nums text-[#344054]">{pct(valores[i], valores[0])}</span></span>
            </span>
            <span className="mt-1 flex justify-center"><span className="h-6 rounded-md" style={{ width: `${Math.max(6, (valores[i] / max) * 100)}%`, background: 'linear-gradient(90deg, #2563EB, #60A5FA)' }} /></span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function EmbudoBloque({ panel, vertical }: { panel: Panel | null; vertical: boolean }) {
  const etapas = panel?.embudo ?? []
  const primero = etapas[0]?.valor ?? null
  const ultimo = etapas[etapas.length - 1]?.valor ?? null
  return (
    <Bloque titulo="Embudo comercial" etiqueta="Comercial" color={COLOR.azul} icono={SquareKanban}
      accion={<>
        <span className="mr-1 text-xs text-[#667085]">Conversión <b className="text-[#101828]">{primero && ultimo !== null ? pct(ultimo, primero) : '—'}</b></span>
        <Abrir to="/clientes?vista=embudo" titulo="Embudo de clientes" />
      </>}>
      {!panel ? <p className="text-xs text-[#667085]">Cargando…</p>
        : etapas.every((e) => e.valor === null) ? <p className="text-xs text-[#667085]">Tu perfil no consulta el embudo comercial.</p>
          : vertical ? <EmbudoVertical etapas={etapas} /> : <EmbudoHorizontal etapas={etapas} />}
    </Bloque>
  )
}

/* ---------------------------------------------------------------- ventas y cobros */

/** Escala redonda para el eje: 1, 2, 2,5 o 5 por potencia de diez. */
function escala(max: number) {
  const e = 10 ** Math.floor(Math.log10(max))
  const m = max / e
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e
}

/** Curva suave que pasa por todos los puntos (Catmull-Rom convertida a Bézier). */
function suave(p: [number, number][]) {
  if (p.length === 1) return `M ${p[0][0] - 24} ${p[0][1]} L ${p[0][0] + 24} ${p[0][1]}`
  let d = `M ${p[0][0]} ${p[0][1]}`
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]
    const [p1, p2] = [p[i], p[i + 1]]
    const p3 = p[i + 2] ?? p2
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`
  }
  return d
}

function LineasMes({ puntos, movil }: { puntos: Panel['meses']; movil: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(560)
  const [activo, setActivo] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const v = puntos.slice(movil ? -6 : -12)
  if (v.length === 1) {
    const [m] = v
    const tope1 = Math.max(1, m.ventas, m.cobros)
    return (
      <div className="grid gap-3">
        <p className="text-xs text-[#667085]">{nombreMes(m.mes)} · por ahora, el único mes con movimientos</p>
        {[{ l: 'Ventas firmadas', v: m.ventas, color: '#2563EB' }, { l: 'Cobros confirmados', v: m.cobros, color: '#06B6D4' }].map((s) => (
          <div key={s.l}>
            <p className="mb-1 flex items-baseline justify-between text-[13px]"><span className="text-[#475467]">{s.l}</span><b className="tabular-nums text-[#101828]">{fmtUsd(s.v)}</b></p>
            <div className="h-2.5 rounded-full bg-[#f2f4f7]"><div className="h-full rounded-full" style={{ width: `${Math.max(2, (s.v / tope1) * 100)}%`, background: s.color }} /></div>
          </div>
        ))}
      </div>
    )
  }
  const W = ancho
  const H = movil ? 190 : 230
  const [izq, der, arriba, abajo] = [54, 12, 14, 28]
  const tope = escala(Math.max(1, ...v.flatMap((p) => [p.ventas, p.cobros])))
  const x = (i: number) => (v.length === 1 ? izq + (W - izq - der) / 2 : izq + (i / (v.length - 1)) * (W - izq - der))
  const y = (val: number) => arriba + (1 - val / tope) * (H - arriba - abajo)
  const serie = (k: 'ventas' | 'cobros') => v.map((p, i) => [x(i), y(p[k])] as [number, number])
  const ventas = suave(serie('ventas'))
  const cobros = suave(serie('cobros'))
  const area = `${ventas} L ${v.length === 1 ? x(0) + 24 : x(v.length - 1)} ${H - abajo} L ${v.length === 1 ? x(0) - 24 : x(0)} ${H - abajo} Z`
  const salto = movil && v.length > 4 ? 2 : 1
  const mover = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = izq + ((e.clientX - r.left) / r.width) * (W - izq - der)
    let mejor = 0
    for (let i = 1; i < v.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(mejor) - px)) mejor = i
    setActivo(mejor)
  }
  const a = activo === null ? null : v[activo]
  return (
    <div ref={ref} className="relative">
      <p className="mb-1 flex flex-wrap justify-center gap-4 text-xs text-[#475467]">
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded-full bg-[#2563EB]" aria-hidden="true" />Ventas firmadas</span>
        <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded-full bg-[#06B6D4]" aria-hidden="true" />Cobros confirmados</span>
      </p>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full" role="img"
        aria-label={`Ventas y cobros por mes: ${v.map((p) => `${nombreMes(p.mes)} ventas ${fmtUsd(p.ventas)}, cobros ${fmtUsd(p.cobros)}`).join('; ')}`}>
        <defs>
          <linearGradient id="amura-ventas" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2563EB" stopOpacity="0.18" /><stop offset="1" stopColor="#2563EB" stopOpacity="0" /></linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={izq} x2={W - der} y1={y(tope * f)} y2={y(tope * f)} stroke="#EAECF0" strokeDasharray="3 4" />
            <text x={izq - 8} y={y(tope * f) + 4} textAnchor="end" fontSize="11" fill="#667085">{compacto(tope * f)}</text>
          </g>
        ))}
        <path d={area} fill="url(#amura-ventas)" />
        <path d={cobros} fill="none" stroke="#06B6D4" strokeWidth="2.25" strokeLinecap="round" />
        <path d={ventas} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
        {v.map((p, i) => (i % salto === 0 ? <text key={p.mes} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#667085">{nombreMes(p.mes)}</text> : null))}
        {a && activo !== null && (
          <g>
            <line x1={x(activo)} x2={x(activo)} y1={arriba} y2={H - abajo} stroke="#98A2B3" />
            <circle cx={x(activo)} cy={y(a.cobros)} r="4" fill="#06B6D4" stroke="#fff" strokeWidth="2" />
            <circle cx={x(activo)} cy={y(a.ventas)} r="4" fill="#2563EB" stroke="#fff" strokeWidth="2" />
          </g>
        )}
        <rect x={izq} y={arriba} width={Math.max(0, W - izq - der)} height={H - arriba - abajo} fill="transparent" onPointerMove={mover} onPointerLeave={() => setActivo(null)} />
      </svg>
      {a && activo !== null && (
        <div className="pointer-events-none absolute top-8 z-10 w-44 rounded-xl border border-[#e4e7ec] bg-white p-3 text-xs shadow-[0_12px_28px_#10182824]" style={{ left: Math.min(Math.max(x(activo) - 88, 0), W - 176) }}>
          <p className="mb-1.5 text-[13px] font-semibold text-[#101828]">{nombreMes(a.mes)}</p>
          <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-[#475467]"><i className="h-3 w-1 rounded bg-[#2563EB]" aria-hidden="true" />Ventas</span><b className="tabular-nums">{fmtUsd(a.ventas)}</b></p>
          <p className="mt-1 flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-[#475467]"><i className="h-3 w-1 rounded bg-[#06B6D4]" aria-hidden="true" />Cobros</span><b className="tabular-nums">{fmtUsd(a.cobros)}</b></p>
        </div>
      )}
    </div>
  )
}

function VentasBloque({ panel, movil }: { panel: Panel | null; movil: boolean }) {
  return (
    <Bloque titulo="Ventas y cobros por mes" etiqueta="Finanzas" color={COLOR.cian} icono={Banknote} accion={<Abrir to="/cobranzas" titulo="Cobranzas" />}>
      {panel && panel.meses.length > 0 ? <LineasMes puntos={panel.meses} movil={movil} /> : (
        <p className="grid min-h-28 place-content-center text-center text-xs text-[#667085]">{panel && panel.contratosFirmados === null ? 'Tu perfil no consulta ventas ni cobranzas.' : 'Aún no hay ventas firmadas ni cobros confirmados.'}</p>
      )}
    </Bloque>
  )
}

/* ---------------------------------------------------------------- inventario y cartera */

function InventarioBloque({ p }: { p: DatosProyecto }) {
  const { inv, unidades, filtro, q, referenciales } = p
  const total = inv.unidades
  const partes = ESTADO_EFECTIVO_ORDEN.map((e) => ({ e, n: inv.porEstado[e], color: ESTADOS_EFECTIVOS[e].color }))
  const enTramite = unidades.filter((u) => u.solicitud && u.estado === 'disponible').length
  const destino = (e: EstadoEfectivo) => `/inventario?estado=${e}${q ? `&edificio=${filtro}` : ''}`
  return (
    <Bloque titulo="Inventario" etiqueta="Proyecto" color={COLOR.verde} icono={Building2} accion={<Abrir to={`/inventario${q}`} titulo="Inventario" />}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[28px] font-semibold leading-none tabular-nums text-[#101828]">{inv.porEstado.disponible}<span className="ml-1.5 text-sm font-medium text-[#667085]">disponibles</span></p>
          <Link to={`/inventario${q}`} aria-label={`Departamentos: ${total}`} className="mt-1 inline-block text-xs text-[#667085] hover:underline">de {total} departamentos</Link>
        </div>
        <div className="text-right">
          <p className="text-xs text-[#667085]">Valor de lista</p>
          <p className="text-[15px] font-semibold tabular-nums text-[#101828]">{compacto(inv.total)}</p>
        </div>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#f2f4f7]" role="img" aria-label={partes.map((x) => `${x.n} ${PLURAL[x.e].toLowerCase()}`).join(', ')}>
        {partes.map((x) => <span key={x.e} style={{ width: total ? `${(x.n / total) * 100}%` : '0%', background: x.color }} />)}
      </div>
      <ul className="mt-2 grid grid-cols-3 gap-1">
        {partes.map((x) => (
          <li key={x.e}>
            <Link to={destino(x.e)} aria-label={x.e === 'disponible' ? `Disponibles para la venta: ${x.n}` : `${PLURAL[x.e]}: ${x.n}`} className="block rounded-lg px-2 py-1.5 hover:bg-[#f8f9fb]">
              <span className="flex items-center gap-1.5 text-xs text-[#667085]"><i className="size-2 rounded-full" style={{ background: x.color }} aria-hidden="true" />{PLURAL[x.e]}</span>
              <span className="mt-0.5 flex items-baseline gap-1"><b className="text-base tabular-nums text-[#101828]">{x.n}</b><span className="text-xs text-[#98a2b3]">{pct(x.n, total)}</span></span>
            </Link>
          </li>
        ))}
      </ul>
      {(enTramite > 0 || referenciales > 0) && (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {enTramite > 0 && <span className="text-[#0284C7]">{enTramite} con solicitud en trámite</span>}
          {referenciales > 0 && <span className="text-amber-700">Precio referencial en {referenciales} de {total}</span>}
        </p>
      )}
    </Bloque>
  )
}

function CarteraBloque({ panel }: { panel: Panel | null }) {
  const c = panel?.cartera ?? null
  const partes = c ? [
    { k: 'cobrado', l: 'Cobrado', v: c.cobrado, color: COLOR.verde },
    { k: 'porVencer', l: 'Por vencer', v: c.porVencer, color: COLOR.azul },
    { k: 'vencido', l: 'Vencido', v: c.vencido, color: COLOR.rosa },
  ] : []
  const total = partes.reduce((t, x) => t + x.v, 0)
  const mora = panel?.mora?.filter((m) => m.monto > 0) ?? []
  const topeMora = Math.max(1, ...mora.map((m) => m.monto))
  return (
    <Bloque titulo="Cartera y cobranza" etiqueta="Finanzas" color={COLOR.ambar} icono={Wallet} accion={<Abrir to="/cobranzas" titulo="Cobranzas" />}>
      <Link to="/cobranzas" aria-label={`Saldo por cobrar: ${compacto(panel?.saldoPendiente ?? null)}`} className="inline-block">
        <span className="block text-xs text-[#667085]">Saldo por cobrar</span>
        <span className="block text-[28px] font-semibold leading-tight tabular-nums text-[#101828]">{compacto(panel?.saldoPendiente ?? null)}</span>
      </Link>
      {c && c.pactado > 0 ? (
        <>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#f2f4f7]" role="img" aria-label={`Cartera: ${partes.map((x) => `${x.l.toLowerCase()} ${fmtUsd(x.v)}`).join(', ')}`}>
            {partes.map((x) => <span key={x.k} style={{ width: total ? `${(x.v / total) * 100}%` : '0%', background: x.color }} />)}
          </div>
          <ul className="mt-2 grid grid-cols-3 gap-1 text-xs">
            {partes.map((x) => <li key={x.k} className="px-1"><span className="flex items-center gap-1.5 text-[#667085]"><i className="size-2 rounded-full" style={{ background: x.color }} aria-hidden="true" />{x.l}</span><b className="mt-0.5 block text-[13.5px] tabular-nums text-[#101828]">{compacto(x.v)}</b></li>)}
          </ul>
          <p className="mt-2 text-xs text-[#667085]">Sobre {fmtUsd(c.pactado)} pactados en cuotas de entrada.</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-[#667085]">{c ? 'Aún no hay contratos firmados con cuotas de entrada.' : panel === null ? 'Cargando…' : 'Tu perfil no consulta cobranzas.'}</p>
      )}
      <div className="mt-3 border-t border-[#f2f4f7] pt-3">
        <p className="text-xs font-semibold text-[#344054]">Mora por antigüedad</p>
        {mora.length ? (
          <ul className="mt-2 grid gap-1.5">
            {mora.map((m, i) => (
              <li key={m.id} className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="truncate text-[#667085]">{m.etiqueta}</span>
                <span className="h-1.5 rounded-full bg-[#f2f4f7]"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, (m.monto / topeMora) * 100)}%`, background: ['#FBBF24', '#F59E0B', '#F97316', '#F43F5E', '#BE123C'][i] ?? COLOR.rosa }} /></span>
                <b className="tabular-nums text-[#101828]">{compacto(m.monto)}</b>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-xs text-[#667085]">{panel?.mora ? 'Sin cuotas vencidas.' : '—'}</p>}
      </div>
    </Bloque>
  )
}

function Barras({ filas, formato }: { filas: { key: string; label: string; value: number; color: string; to?: string }[]; formato: (v: number) => string }) {
  const tope = Math.max(1, ...filas.map((f) => f.value))
  return (
    <ul className="grid gap-2.5">
      {filas.map((f) => {
        const cuerpo = (
          <>
            <span className="mb-1 flex items-baseline justify-between gap-3 text-[13px]"><span className="truncate text-[#475467]">{f.label}</span><b className="tabular-nums text-[#101828]">{formato(f.value)}</b></span>
            <span className="block h-2 rounded-full bg-[#f2f4f7]"><span className="block h-full rounded-full" style={{ width: f.value ? `${Math.max((f.value / tope) * 100, 3)}%` : '0%', background: f.color }} /></span>
          </>
        )
        return <li key={f.key}>{f.to ? <Link to={f.to} className="block hover:opacity-80">{cuerpo}</Link> : cuerpo}</li>
      })}
    </ul>
  )
}

/* ---------------------------------------------------------------- mapa por edificio */

/** Mapa por edificio del inventario en el panel: el mismo componente de Inventario, con búsqueda y la ficha de cada departamento. */
function MapaEdificios({ units, params, filtro, movil, onAbrir }: {
  units: Unit[]; params: PricingParams; filtro: EdificioFiltro; movil: boolean; onAbrir: (codigo: string) => void
}) {
  const [buscar, setBuscar] = useState('')
  const [elegido, setElegido] = useState<1 | 2>(1)
  const coincidencias = useMemo(() => {
    const q = buscar.trim().toUpperCase()
    return q ? units.filter((u) => textoBusquedaUnidad(u).toUpperCase().includes(q)) : []
  }, [units, buscar])
  // En el celular, una búsqueda que cae en el otro edificio cambia la vista a ese edificio.
  const buscarEn = (texto: string) => {
    setBuscar(texto)
    const q = texto.trim().toUpperCase()
    const primero = q ? units.find((u) => textoBusquedaUnidad(u).toUpperCase().includes(q)) : undefined
    if (movil && primero) setElegido(primero.edificio)
  }
  const edificios: (1 | 2)[] = filtro === 'todos' ? (movil ? [elegido] : [1, 2]) : [filtro]
  return (
    <Bloque titulo="Mapa por edificio" etiqueta="Inventario" color={COLOR.verde} icono={Building2}
      accion={<Button size="sm" variant="outline" asChild><Link to="/inventario?vista=mapa">Ver mapa completo</Link></Button>}>
      <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 sm:max-w-sm sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#667085]" aria-hidden="true" />
          <Input type="search" value={buscar} onChange={(e) => buscarEn(e.target.value)}
            onKeyDown={(e) => {
              // Enter abre la ficha sin que la misma pulsación active un botón de la ficha recién abierta.
              if (e.key === 'Enter' && coincidencias.length === 1) { e.preventDefault(); onAbrir(coincidencias[0].codigo) }
            }}
            placeholder="Buscar departamento: A502 o B101" aria-label="Buscar departamento" className="h-9 bg-white pl-8 text-[13.5px]" />
        </div>
        {buscar.trim() && (
          <p className="text-xs text-[#667085]" aria-live="polite">
            {coincidencias.length === 0 ? 'Sin coincidencias' : coincidencias.length === 1 ? 'Un departamento: Enter abre su ficha' : `${coincidencias.length} departamentos`}
          </p>
        )}
        {movil && filtro === 'todos' && (
          <div role="group" aria-label="Edificio del mapa" className="grid grid-cols-2 gap-1 rounded-xl bg-[#eef0f3] p-1 sm:ml-auto sm:inline-grid sm:w-auto">
            {([1, 2] as const).map((e) => (
              <button key={e} type="button" aria-pressed={elegido === e} onClick={() => setElegido(e)}
                className={cn('h-8 rounded-lg px-3 text-[13px] font-semibold transition', elegido === e ? 'bg-white text-[#101828] shadow-xs' : 'text-[#475467]')}>
                {nombreEdificio(e)} ({units.filter((u) => u.edificio === e).length})
              </button>
            ))}
          </div>
        )}
      </div>
      <BuildingMap units={units} params={params} onOpen={onAbrir} edificios={edificios} buscar={buscar} sinMarco />
    </Bloque>
  )
}

/* ---------------------------------------------------------------- página */

const FILTROS: { valor: EdificioFiltro; etiqueta: string; param: string }[] = [
  { valor: 'todos', etiqueta: 'Todos', param: 'todos' }, { valor: 1, etiqueta: 'Edificio A', param: '1' }, { valor: 2, etiqueta: 'Edificio B', param: '2' },
]

export default function PanelAdministracion() {
  const p = usePanelProyecto()
  const { state, filtro, fijarFiltro, entrada, unidades, inv, referenciales, panel, q } = p
  const { can, actor } = useSession()
  const medios = useMedios('dashboard')
  const movil = useIsMobile()
  const clientesCtx = useClientesOpcional()
  const reservasCtx = useReservasOpcional()
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  // La ficha de un departamento se abre con ?unidad=, igual que en Inventario.
  const [params, setParams] = useSearchParams()
  const unidadAbierta = can('inventario.ver') ? params.get('unidad') : null
  const abrirUnidad = (codigo: string) => setParams((x) => { x.set('unidad', codigo); return x }, { replace: !!unidadAbierta })
  const cerrarUnidad = () => setParams((x) => { x.delete('unidad'); return x })
  const hoy = hoyGuayaquil()

  const valorPorEstado = useMemo(() => {
    const m = new Map<EstadoEfectivo, number>()
    for (const u of unidades) m.set(estadoEfectivo(u), (m.get(estadoEfectivo(u)) ?? 0) + calcularPrecio(u, state.params).precioVenta)
    return m
  }, [unidades, state.params])

  // Lo que pide una decisión, de lo más urgente a lo informativo. Las mismas fuentes y textos del panel anterior.
  const pendientes: Pendiente[] = []
  const propuestas = state.propuestas.filter((x) => x.estado === 'pendiente').length
  const enTramite = unidades.filter((u) => u.solicitud && u.estado === 'disponible')
  if (reservasCtx) {
    const n = reservasVisibles(reservasCtx.state.reservas, actor).filter((r) => siguientePaso(r, can, { remoto: reservasCtx.remoto }).accion).length
    if (n) pendientes.push({ clave: 'atender', titulo: `${pl(n, 'reserva espera', 'reservas esperan')} una acción`, detalle: 'Pagos por registrar o verificar y excepciones por autorizar.', to: '/reservas', sev: 'accion' })
  }
  if (enTramite.length > 0) pendientes.push({ clave: 'en_proceso', titulo: `${pl(enTramite.length, 'solicitud', 'solicitudes')} de reserva en trámite`, detalle: enTramite.map((u) => `${u.dpt}: ${u.solicitud?.codigo}`).slice(0, 3).join(' · '), to: '/reservas', sev: 'info' })
  if (clientesCtx) {
    const vencidas = clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && urgencia(c, hoy) === 'vencida').length
    if (vencidas) pendientes.push({ clave: 'vencidas', titulo: pl(vencidas, 'gestión comercial vencida', 'gestiones comerciales vencidas'), detalle: 'Clientes con la próxima acción atrasada.', to: '/clientes?filtro=vencidas', sev: 'urgente' })
    const sinGestion = clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && urgencia(c, hoy) === 'sin_actividad').length
    if (sinGestion) pendientes.push({ clave: 'sin_gestion', titulo: pl(sinGestion, 'cliente sin próxima gestión', 'clientes sin próxima gestión'), detalle: 'Sin siguiente paso programado: el seguimiento se enfría.', to: '/clientes?filtro=sin', sev: 'aviso' })
  }
  if (referenciales > 0 || propuestas > 0) pendientes.push({ clave: 'precios', titulo: 'Precios pendientes de aprobación', detalle: [referenciales ? `${referenciales} unidades con precio referencial` : '', propuestas ? `${propuestas} propuestas por resolver` : ''].filter(Boolean).join(' · '), to: propuestas ? '/precios' : '/inventario', sev: 'aviso' })
  if (panel?.reservasPorVencer?.length) {
    const r = panel.reservasPorVencer[0]
    pendientes.push({ clave: 'por_vencer', titulo: `${pl(panel.reservasPorVencer.length, 'reserva', 'reservas')} por vencer`, detalle: `${numeroComercial(r.unidad)}: ${r.dias < 0 ? `venció hace ${-r.dias} d` : r.dias === 0 ? 'vence hoy' : `vence en ${r.dias} d`}`, to: '/reservas', sev: 'urgente' })
  }
  if (panel?.cuotasVencidas && panel.cuotasVencidas.cuotas > 0) pendientes.push({ clave: 'cuotas', titulo: pl(panel.cuotasVencidas.cuotas, 'cuota vencida', 'cuotas vencidas'), detalle: `${fmtUsd(panel.cuotasVencidas.monto)} en ${pl(panel.cuotasVencidas.contratos, 'contrato', 'contratos')}`, to: '/cobranzas', sev: 'urgente' })
  if (panel?.contratosPendientesFirma) pendientes.push({ clave: 'firma', titulo: `${pl(panel.contratosPendientesFirma, 'contrato pendiente', 'contratos pendientes')} de firma`, detalle: 'Preparados, sin formalizar.', to: '/ventas', sev: 'accion' })
  if (entrada?.plantillasPendientes) pendientes.push({ clave: 'plantillas', titulo: `${pl(entrada.plantillasPendientes, 'documento contractual', 'documentos contractuales')} por aprobar`, detalle: 'Plantillas en borrador, sin uso hasta que Legal las apruebe.', to: '/ventas', sev: 'accion' })
  if (panel?.comprobantesPendientes) pendientes.push({ clave: 'comprobantes', titulo: `${pl(panel.comprobantesPendientes, 'comprobante', 'comprobantes')} por verificar`, detalle: 'Pagos registrados sin confirmar.', to: '/cobranzas', sev: 'accion' })
  if (entrada?.desistimientosPendientes) pendientes.push({ clave: 'desistimientos', titulo: `${pl(entrada.desistimientosPendientes, 'desistimiento', 'desistimientos')} por autorizar`, detalle: 'Las unidades siguen retenidas hasta decidir.', to: '/clientes', sev: 'urgente' })
  pendientes.sort((a, b) => SEV[a.sev].orden - SEV[b.sev].orden)

  const agenda = clientesCtx && can('clientes.ver')
    ? ordenarPorUrgencia(clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && ['vencida', 'hoy'].includes(urgencia(c, hoy))), hoy)
    : []

  const meses = panel?.meses.slice(-8) ?? []
  const kpis: Indicador[] = [
    { clave: 'disponibles', label: 'Disponibles', valor: String(inv.porEstado.disponible), detalle: `de ${inv.unidades} departamentos`, to: `/inventario?estado=disponible${q ? `&edificio=${filtro}` : ''}`, icono: Building2, color: COLOR.verde },
    { clave: 'clientes', label: 'Clientes registrados', valor: cuenta(panel?.clientes ?? null), detalle: panel && panel.clientes === null ? 'Sin acceso' : filtro === 'todos' ? 'En el proyecto' : `Interés en el ${nombreEdificio(filtro)}`, to: '/clientes', icono: Users, color: COLOR.azul },
    { clave: 'reservas', label: 'Reservas activas', valor: cuenta(panel?.reservasActivas ?? null), detalle: panel && panel.reservasActivas === null ? 'Sin acceso' : 'Sin contrato aún', to: '/reservas', icono: CalendarCheck, color: COLOR.violeta },
    { clave: 'contratos', label: 'Contratos firmados', valor: cuenta(panel?.contratosFirmados ?? null), detalle: panel && panel.contratosFirmados === null ? 'Sin acceso' : 'Formalizados en Ventas', to: '/ventas', icono: FileSignature, color: COLOR.cian },
    { clave: 'ventas', label: 'Ventas firmadas', valor: compacto(panel?.ventasFirmadas ?? null), detalle: 'Precio de contratos firmados', to: '/ventas', icono: Banknote, color: COLOR.azul, serie: meses.map((m) => m.ventas) },
    { clave: 'cobros', label: 'Cobros confirmados', valor: compacto(panel?.cobrosConfirmados ?? null), detalle: 'Verificados por Finanzas', to: '/cobranzas', icono: CircleDollarSign, color: COLOR.ambar, serie: meses.map((m) => m.cobros) },
  ]

  const obra = entrada?.obra?.filter((f) => (f.codigo === 'edificio1' || f.codigo === 'edificio2') && f.actividadesConAvance > 0 && f.avance !== null && (filtro === 'todos' || f.codigo === `edificio${filtro}`)) ?? []
  const etiquetaReserva: Record<string, string> = { solicitada: 'Solicitadas', pago_verificado: 'Excepciones por autorizar', confirmada: 'Confirmadas' }
  const filasReservas = (panel?.reservasPorEstado ?? []).map((r) => ({ key: r.estado, label: etiquetaReserva[r.estado] ?? r.estado, value: r.cantidad, color: COLOR.violeta, to: '/reservas' }))
  const filasEdificio = ([1, 2] as const).filter((e) => filtro === 'todos' || filtro === e).map((e) => {
    const propias = unidades.filter((u) => u.edificio === e)
    return { key: `e${e}`, label: `${nombreEdificio(e)} · ${propias.length} unidades · ${fmtNum(propias.reduce((t, u) => t + u.areaM2, 0))} m²`, value: propias.reduce((t, u) => t + calcularPrecio(u, state.params).precioVenta, 0), color: e === 1 ? COLOR.azul : COLOR.verde, to: `/inventario?edificio=${e}` }
  })

  const atencion = pendientes.length > 0 ? <CentroAtencion items={pendientes} ancho={!movil && agenda.length === 0} /> : null
  const agendaBloque = agenda.length > 0 ? <AgendaHoy clientes={agenda} onAviso={setAviso} /> : null
  // Mientras cargan los clientes, el panel no puede decir que el día está al día.
  const alDia = !atencion && !agendaBloque && !clientesCtx?.cargando
  const mapa = can('inventario.ver') ? <MapaEdificios units={state.units} params={state.params} filtro={filtro} movil={movil} onAbrir={abrirUnidad} /> : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#667085]">{fechaLarga(hoy)} · AMURA Apartments</p>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight text-[#101828] sm:text-[26px]">Panorama del negocio</h1>
          <p className="mt-1 text-[13.5px] text-[#667085]">Lo que pide una decisión, el embudo, el inventario y la cobranza, con datos en vivo.</p>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <div role="group" aria-label="Filtrar por edificio" className="inline-flex rounded-xl bg-[#eef0f3] p-1">
            {FILTROS.map((f) => (
              <button key={f.param} type="button" aria-pressed={filtro === f.valor} onClick={() => fijarFiltro(f.param)}
                className={cn('h-8 rounded-lg px-3 text-[13px] font-semibold transition', filtro === f.valor ? 'bg-white text-[#101828] shadow-xs' : 'text-[#475467] hover:text-[#101828]')}>{f.etiqueta}</button>
            ))}
          </div>
          {can('cotizaciones.crear') && <Button asChild><Link to="/venta"><Plus /><span className="max-[420px]:sr-only">Atender cliente</span></Link></Button>}
        </div>
      </div>
      {filtro !== 'todos' && <p className="-mt-2 text-xs text-[#667085]">Filtra inventario, reservas, contratos y cobros. Clientes y cotizaciones se cuentan por su interés en el edificio.</p>}

      {alDia && (
        <p className="flex items-center gap-2 rounded-xl border border-[#d1fadf] bg-[#f6fef9] px-4 py-2.5 text-[13.5px] font-medium text-[#05603a]">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />Todo al día: no hay decisiones pendientes ni gestiones para hoy.
        </p>
      )}

      {movil ? (
        <>
          {atencion}
          {agendaBloque}
          <Indicadores items={kpis} />
          {mapa}
          <EmbudoBloque panel={panel} vertical />
          <InventarioBloque p={p} />
          <VentasBloque panel={panel} movil />
          <CarteraBloque panel={panel} />
        </>
      ) : (
        <>
          {(atencion || agendaBloque) && (
            <div className={cn('grid grid-cols-[minmax(0,1fr)] items-start gap-5', atencion && agendaBloque && 'lg:grid-cols-12')}>
              {atencion && <div className={cn(agendaBloque && 'lg:col-span-7')}>{atencion}</div>}
              {agendaBloque && <div className={cn(atencion && 'lg:col-span-5')}>{agendaBloque}</div>}
            </div>
          )}
          <Indicadores items={kpis} />
          {mapa}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7"><EmbudoBloque panel={panel} vertical={false} /></div>
            <div className="lg:col-span-5"><InventarioBloque p={p} /></div>
            <div className="lg:col-span-7"><VentasBloque panel={panel} movil={false} /></div>
            <div className="lg:col-span-5"><CarteraBloque panel={panel} /></div>
          </div>
        </>
      )}

      {can('clientes.ver') && <PanelLeads />}

      {obra.length > 0 && (
        <Bloque titulo="Avance físico de obra" etiqueta="Obra" color={COLOR.naranja} icono={HardHat} accion={<Abrir to="/obra" titulo="Avance de obra" />}>
          <ul className="grid gap-4 md:grid-cols-2">
            {obra.map((f) => (
              <li key={f.codigo}>
                <div className="mb-1.5 flex items-baseline justify-between text-xs"><span className="font-semibold text-[#344054]">{f.nombre}</span><b className="tabular-nums">{f.avance!.toFixed(1)} %</b></div>
                <div className="h-2.5 rounded-full bg-[#f2f4f7]" role="progressbar" aria-valuenow={f.avance!} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance de ${f.nombre}`}><div className="h-full rounded-full" style={{ width: `${Math.min(f.avance!, 100)}%`, background: COLOR.naranja }} /></div>
              </li>
            ))}
          </ul>
        </Bloque>
      )}

      <Plegable titulo="Más análisis: reservas por estado y valor de lista">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
          <div><p className="mb-3 text-[13.5px] font-semibold text-[#101828]">Reservas por estado</p>
            {filasReservas.length ? <Barras filas={filasReservas} formato={(v) => String(v)} /> : <p className="text-xs text-[#667085]">{panel?.reservasActivas === null ? 'Tu perfil no consulta reservas.' : panel ? 'No hay reservas abiertas.' : 'Cargando…'}</p>}
          </div>
          <div><p className="mb-3 text-[13.5px] font-semibold text-[#101828]">Valor de lista por edificio</p><Barras filas={filasEdificio} formato={compacto} /></div>
          <div><p className="mb-3 text-[13.5px] font-semibold text-[#101828]">Valor de lista por estado</p>
            <Barras filas={ESTADO_EFECTIVO_ORDEN.filter((e) => (valorPorEstado.get(e) ?? 0) > 0).map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: valorPorEstado.get(e) ?? 0, color: ESTADOS_EFECTIVOS[e].color, to: `/inventario?estado=${e}${q ? `&edificio=${filtro}` : ''}` }))} formato={compacto} />
          </div>
        </div>
      </Plegable>

      <Plegable titulo="Material de marca: bienvenida, video y galería">
        <BannerBienvenida medios={medios} />
        <ConoceAmura medios={medios} />
      </Plegable>

      <p className="flex items-start gap-1.5 text-xs text-[#667085]"><Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span>El valor de lista usa precios {referenciales > 0 ? 'referenciales aún sin aprobar' : 'aprobados'}; no son ventas. Las ventas y los cobros salen de contratos firmados y pagos verificados. «—» indica que tu perfil no consulta ese dato.</span></p>
      {can('inventario.ver') && <UnitDetailSheet codigo={unidadAbierta} onClose={cerrarUnidad} onNavigate={abrirUnidad} onMessage={setAviso} mensaje={aviso} />}
      <Aviso texto={unidadAbierta ? null : aviso} onClose={cerrarAviso} />
    </div>
  )
}
