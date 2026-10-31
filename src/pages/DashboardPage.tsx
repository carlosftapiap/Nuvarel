import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowUpRight, Banknote, Building2, CircleDollarSign, FileSignature, HardHat, Info, Plus, Receipt, Tags, Users, type LucideIcon } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import BannerBienvenida from '@/features/marca/BannerBienvenida'
import ConoceAmura from '@/features/marca/ConoceAmura'
import { useMedios } from '@/features/marca/useMedios'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { useDatosPanel } from '@/features/dashboard/datos'
import { calcularPanel, type EdificioFiltro, type Panel } from '@/features/dashboard/panel'
import { ESTADO_EFECTIVO_ORDEN, ESTADOS_EFECTIVOS, estadoEfectivo, type EstadoEfectivo } from '@/features/inventario/estados'
import { estadoPrecio, resumenInventario } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'
import { calcularPrecio, fmtNum, fmtUsd } from '@/features/inventario/pricing'
import type { Unit } from '@/features/inventario/types'
import { cn } from '@/lib/utils'

/** Panel gerencial. Inventario sale del módulo de Inventario; lo comercial y financiero, de las tablas con RLS. «—» = sin acceso o sin lectura, nunca cero. */

const FILTROS: { valor: EdificioFiltro; etiqueta: string; param: string }[] = [
  { valor: 'todos', etiqueta: 'Todos', param: 'todos' }, { valor: 1, etiqueta: 'Edificio 1', param: '1' }, { valor: 2, etiqueta: 'Edificio 2', param: '2' },
]

const compacto = (v: number | null) => {
  if (v === null) return '—'
  const a = Math.abs(v)
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)} M`
  if (a >= 10_000) return `$${Math.round(v / 1000)} k`
  return fmtUsd(v)
}
const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const CORTO: Record<EstadoEfectivo, string> = { en_proceso_reserva: 'en proceso de reserva', por_confirmar: 'por confirmar', disponible: 'disponibles', bloqueado: 'bloqueadas', reservado: 'reservadas', promesa: 'prometidas', vendido: 'vendidas', no_disponible: 'no disponibles' }
const cuenta = (v: number | null) => (v === null ? '—' : String(v))
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nombreMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`

interface Kpi { clave: string; label: string; valor: string; hint: ReactNode; icon: LucideIcon; color: string; soft: string; to: string; destacado?: boolean }

function Tarjeta({ k }: { k: Kpi }) {
  const { icon: Icon } = k
  return (
    <Link to={k.to} className={cn('group relative flex min-w-0 flex-col justify-between gap-3 rounded-2xl border bg-white p-4 shadow-[0_3px_8px_#18243d05] transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-12px_#18243d40] focus-visible:ring-2 focus-visible:ring-primary sm:p-5',
      k.destacado ? 'border-amber-300 bg-amber-50/60' : 'border-border')} aria-label={`${k.label}: ${k.valor}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
        <span className="truncate">{k.label}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ background: k.soft, color: k.color }}><Icon className="size-4" aria-hidden="true" /></span>
      </div>
      <p className="text-[clamp(22px,2.2vw,30px)] font-semibold leading-none tracking-tight tabular-nums text-slate-900">{k.valor}</p>
      <p className="flex items-center justify-between gap-2 text-[10.5px] leading-snug text-slate-500"><span className="min-w-0">{k.hint}</span><ArrowUpRight className="size-3.5 shrink-0 text-slate-300 transition group-hover:text-primary" aria-hidden="true" /></p>
    </Link>
  )
}

function Seccion({ titulo, sub, to, children, className }: { titulo: string; sub?: string; to?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-border bg-white p-4 shadow-[0_3px_8px_#18243d05] sm:p-5', className)} aria-label={titulo}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>{sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}</div>
        {to && <Link to={to} className="text-slate-400 hover:text-primary" aria-label={`Abrir ${titulo}`}><ArrowUpRight className="size-4" /></Link>}
      </div>
      {children}
    </section>
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
        <div className="absolute inset-0 grid place-content-center text-center"><strong className="text-3xl font-semibold tabular-nums leading-none">{total}</strong><span className="mt-1 text-[10px] text-slate-500">unidades</span></div>
      </div>
      <ul className="grid w-full gap-1.5 text-xs">
        {filas.map((f) => (
          <li key={f.key}><Link to={`/inventario?estado=${f.key}`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
            <span className="flex min-w-0 items-center gap-2"><i className="size-2.5 shrink-0 rounded-full" style={{ background: f.color }} /><span className="truncate">{f.label}</span></span>
            <b className="tabular-nums">{f.value}</b>
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
    <div className="grid gap-5">
      {filas.map((f) => (
        <div key={f.e}>
          <div className="mb-1.5 flex items-baseline justify-between text-xs"><Link to={`/inventario?edificio=${f.e}`} className="font-semibold hover:text-primary">Edificio {f.e}</Link><span className="tabular-nums text-slate-500">{f.total} unidades</span></div>
          <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Edificio ${f.e}: ${f.por.map((x) => `${x.n} ${ESTADOS_EFECTIVOS[x.s].label.toLowerCase()}`).join(', ')}`}>
            {f.por.map((x) => <span key={x.s} title={`${ESTADOS_EFECTIVOS[x.s].label}: ${x.n}`} style={{ width: `${(x.n / f.total) * 100}%`, background: ESTADOS_EFECTIVOS[x.s].color }} />)}
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-slate-500">{f.por.map((x) => <span key={x.s}><i className="mr-1 inline-block size-1.5 rounded-full" style={{ background: ESTADOS_EFECTIVOS[x.s].color }} />{x.n} {CORTO[x.s]}</span>)}</p>
        </div>
      ))}
    </div>
  )
}

function Embudo({ etapas }: { etapas: Panel['embudo'] }) {
  const maximo = Math.max(1, ...etapas.map((e) => e.valor ?? 0))
  const colores = ['#3563f3', '#5b82f5', '#8b5cf6', '#12a88b']
  return (
    <ol className="grid gap-3">
      {etapas.map((e, i) => (
        <li key={e.clave}>
          <div className="mb-1 flex items-baseline justify-between text-xs"><span>{e.etiqueta}</span><b className="tabular-nums">{cuenta(e.valor)}</b></div>
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
    <div className="grid gap-3">
      {filas.map((f) => {
        const cuerpo = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className="truncate">{f.label}</span><b className="tabular-nums">{formato(f.value)}</b></div>
            <div className="h-3 rounded-full bg-slate-100"><div className="h-full rounded-full transition-all" style={{ width: f.value ? `${Math.max((f.value / tope) * 100, 3)}%` : '0%', background: f.color }} /></div>
          </>
        )
        return <div key={f.key}>{f.to ? <Link to={f.to} className="block hover:opacity-80">{cuerpo}</Link> : cuerpo}</div>
      })}
      {nota && <p className="text-[10.5px] text-slate-500">{nota}</p>}
    </div>
  )
}

/** Cartera de contratos firmados en una barra apilada con su leyenda. */
function Cartera({ c }: { c: NonNullable<Panel['cartera']> }) {
  const total = c.cobrado + c.porVencer + c.vencido
  const partes = [
    { k: 'cobrado', l: 'Cobrado', v: c.cobrado, color: '#12a88b' },
    { k: 'porVencer', l: 'Por vencer', v: c.porVencer, color: '#3563f3' },
    { k: 'vencido', l: 'Vencido', v: c.vencido, color: '#d34259' },
  ]
  return (
    <div className="grid gap-4">
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Cartera: ${partes.map((p) => `${p.l.toLowerCase()} ${fmtUsd(p.v)}`).join(', ')}`}>
        {partes.map((p) => <span key={p.k} title={`${p.l}: ${fmtUsd(p.v)}`} style={{ width: total ? `${(p.v / total) * 100}%` : '0%', background: p.color }} />)}
      </div>
      <ul className="grid gap-2 text-xs sm:grid-cols-3">
        {partes.map((p) => (
          <li key={p.k} className="rounded-xl border border-border p-3"><span className="flex items-center gap-1.5 text-[11px] text-slate-500"><i className="size-2 rounded-full" style={{ background: p.color }} />{p.l}</span><b className="mt-1 block text-base tabular-nums">{fmtUsd(p.v)}</b></li>
        ))}
      </ul>
      <p className="text-[10.5px] text-slate-500">Sobre {fmtUsd(c.pactado)} pactados en cuotas de entrada de contratos firmados.</p>
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
              <rect x={x - 13} y={105 - h(p.ventas)} width="12" height={h(p.ventas)} rx="2.5" fill="#3563f3"><title>Ventas {nombreMes(p.mes)}: {fmtUsd(p.ventas)}</title></rect>
              <rect x={x + 1} y={105 - h(p.cobros)} width="12" height={h(p.cobros)} rx="2.5" fill="#12a88b"><title>Cobros {nombreMes(p.mes)}: {fmtUsd(p.cobros)}</title></rect>
              <text x={x} y="121" textAnchor="middle" fontSize="8.5" fill="#7b89a1">{nombreMes(p.mes)}</text>
            </g>
          )
        })}
      </svg>
      <p className="mt-1 flex gap-4 text-[10.5px] text-slate-500"><span><i className="mr-1 inline-block size-2 rounded-sm bg-[#3563f3]" />Ventas firmadas</span><span><i className="mr-1 inline-block size-2 rounded-sm bg-[#12a88b]" />Cobros confirmados</span></p>
    </div>
  )
}

interface Alerta { clave: string; titulo: string; detalle: string; to: string; tono: 'ambar' | 'rojo' | 'azul' }
const TONO = { ambar: 'bg-amber-50 text-amber-700', rojo: 'bg-rose-50 text-rose-700', azul: 'bg-blue-50 text-blue-700' }

export default function DashboardPage() {
  const medios = useMedios('dashboard')
  const { state } = useInventory()
  const { can } = useSession()
  const { datos } = useConexion()
  const [params, setParams] = useSearchParams()
  const filtro: EdificioFiltro = params.get('edificio') === '1' ? 1 : params.get('edificio') === '2' ? 2 : 'todos'
  const entrada = useDatosPanel(datos, can)
  const hoy = hoyGuayaquil()

  const unidades = useMemo(() => (filtro === 'todos' ? state.units : state.units.filter((u) => u.edificio === filtro)), [state.units, filtro])
  const inv = useMemo(() => resumenInventario({ ...state, units: unidades }), [state, unidades])
  const referenciales = useMemo(() => unidades.filter((u) => estadoPrecio(state.priceHistory, u.codigo).tipo === 'referencial').length, [unidades, state.priceHistory])
  const propuestas = state.propuestas.filter((p) => p.estado === 'pendiente').length
  const panel = useMemo(() => (entrada ? calcularPanel(entrada, filtro, hoy) : null), [entrada, filtro, hoy])
  const q = filtro === 'todos' ? '' : `?edificio=${filtro}`

  const reservadas = inv.porEstado.reservado + inv.porEstado.promesa
  const kpisInventario: Kpi[] = [
    { clave: 'total', label: 'Departamentos', valor: String(inv.unidades), hint: filtro === 'todos' ? `Edificio 1: ${state.units.filter((u) => u.edificio === 1).length} · Edificio 2: ${state.units.filter((u) => u.edificio === 2).length}` : `Edificio ${filtro}`, icon: Building2, color: '#3563f3', soft: '#edf2ff', to: `/inventario${q}` },
    { clave: 'valor', label: 'Valor total de lista', valor: compacto(inv.total), hint: referenciales > 0 ? <span className="font-medium text-amber-700">Referencial · {referenciales} de {inv.unidades} sin aprobar</span> : 'Precios aprobados', icon: CircleDollarSign, color: '#0b9f85', soft: '#e7f8f2', to: `/inventario${q}` },
    { clave: 'disponibles', label: 'Disponibles', valor: String(inv.porEstado.disponible), hint: inv.porEstado.en_proceso_reserva ? `${pl(inv.porEstado.en_proceso_reserva, 'otra', 'otras')} en proceso de reserva` : 'Listas para cotizar y reservar', icon: Building2, color: '#12a88b', soft: '#e3f7f2', to: `/inventario?estado=disponible${q ? `&edificio=${filtro}` : ''}` },
    { clave: 'reservadas', label: 'Reservadas', valor: String(reservadas), hint: inv.porEstado.promesa ? `Incluye ${inv.porEstado.promesa} con promesa` : 'Con reserva vigente', icon: Receipt, color: '#8b5cf6', soft: '#f2ecff', to: `/inventario?estado=reservado${q ? `&edificio=${filtro}` : ''}` },
    { clave: 'vendidas', label: 'Vendidas', valor: String(inv.porEstado.vendido), hint: 'Venta cerrada', icon: FileSignature, color: '#3563f3', soft: '#edf2ff', to: `/inventario?estado=vendido${q ? `&edificio=${filtro}` : ''}` },
    { clave: 'por_confirmar', label: 'Por confirmar', valor: String(inv.porEstado.por_confirmar), hint: inv.porEstado.por_confirmar ? 'Disponibilidad sin validar: no se reservan' : 'Todas validadas', icon: AlertTriangle, color: '#c2791c', soft: '#fff1d6', to: `/inventario?estado=por_confirmar${q ? `&edificio=${filtro}` : ''}`, destacado: inv.porEstado.por_confirmar > 0 },
  ]
  const kpisNegocio: Kpi[] = [
    { clave: 'clientes', label: 'Clientes registrados', valor: cuenta(panel?.clientes ?? null), hint: panel && panel.clientes === null ? 'Sin acceso' : filtro === 'todos' ? 'En el proyecto' : `Con interés en el Edificio ${filtro}`, icon: Users, color: '#3563f3', soft: '#edf2ff', to: '/clientes' },
    { clave: 'reservas', label: 'Reservas activas', valor: cuenta(panel?.reservasActivas ?? null), hint: panel && panel.reservasActivas === null ? 'Sin acceso' : 'Sin contrato aún', icon: Receipt, color: '#8b5cf6', soft: '#f2ecff', to: '/reservas' },
    { clave: 'contratos', label: 'Contratos firmados', valor: cuenta(panel?.contratosFirmados ?? null), hint: panel && panel.contratosFirmados === null ? 'Sin acceso' : 'Formalizados en Ventas', icon: FileSignature, color: '#0b9f85', soft: '#e7f8f2', to: '/ventas' },
    { clave: 'ventas', label: 'Ventas firmadas', valor: compacto(panel?.ventasFirmadas ?? null), hint: 'Precio de contratos firmados', icon: Banknote, color: '#3563f3', soft: '#edf2ff', to: '/ventas' },
    { clave: 'cobros', label: 'Cobros confirmados', valor: compacto(panel?.cobrosConfirmados ?? null), hint: 'Pagos verificados por Finanzas', icon: CircleDollarSign, color: '#12a88b', soft: '#e3f7f2', to: '/cobranzas' },
    { clave: 'saldo', label: 'Saldo por cobrar', valor: compacto(panel?.saldoPendiente ?? null), hint: 'Cuotas de contratos firmados', icon: Tags, color: '#c2791c', soft: '#fff1d6', to: '/cobranzas' },
  ]

  const alertas: Alerta[] = []
  if (inv.porEstado.por_confirmar > 0) alertas.push({ clave: 'confirmar', titulo: `${pl(inv.porEstado.por_confirmar, 'unidad', 'unidades')} por confirmar`, detalle: 'Su disponibilidad no está validada: no se pueden cotizar ni reservar.', to: `/inventario?estado=por_confirmar${q ? `&edificio=${filtro}` : ''}`, tono: 'ambar' })
  if (inv.porEstado.en_proceso_reserva > 0) alertas.push({ clave: 'en_proceso', titulo: `${pl(inv.porEstado.en_proceso_reserva, 'unidad', 'unidades')} en proceso de reserva`, detalle: unidades.filter((u) => estadoEfectivo(u) === 'en_proceso_reserva').map((u) => `${u.dpt}: ${u.solicitud?.codigo}`).slice(0, 3).join(' · '), to: `/inventario?estado=en_proceso_reserva${q ? `&edificio=${filtro}` : ''}`, tono: 'azul' })
  if (referenciales > 0 || propuestas > 0) alertas.push({ clave: 'precios', titulo: 'Precios pendientes de aprobación', detalle: [referenciales ? `${referenciales} unidades con precio referencial` : '', propuestas ? `${propuestas} propuestas por resolver` : ''].filter(Boolean).join(' · '), to: propuestas ? '/precios' : '/inventario', tono: 'ambar' })
  if (panel?.reservasPorVencer?.length) {
    const p = panel.reservasPorVencer[0]
    alertas.push({ clave: 'reservas', titulo: `${pl(panel.reservasPorVencer.length, 'reserva', 'reservas')} por vencer`, detalle: `${p.unidad}: ${p.dias < 0 ? `venció hace ${-p.dias} d` : p.dias === 0 ? 'vence hoy' : `vence en ${p.dias} d`}`, to: '/reservas', tono: 'rojo' })
  }
  if (panel?.cuotasVencidas && panel.cuotasVencidas.cuotas > 0) alertas.push({ clave: 'cuotas', titulo: `${pl(panel.cuotasVencidas.cuotas, 'cuota vencida', 'cuotas vencidas')}`, detalle: `${fmtUsd(panel.cuotasVencidas.monto)} en ${pl(panel.cuotasVencidas.contratos, 'contrato', 'contratos')}`, to: '/cobranzas', tono: 'rojo' })
  if (panel?.contratosPendientesFirma) alertas.push({ clave: 'firma', titulo: `${pl(panel.contratosPendientesFirma, 'contrato pendiente', 'contratos pendientes')} de firma`, detalle: 'Preparados, sin formalizar.', to: '/ventas', tono: 'azul' })
  if (entrada?.plantillasPendientes) alertas.push({ clave: 'plantillas', titulo: `${pl(entrada.plantillasPendientes, 'documento contractual', 'documentos contractuales')} por aprobar`, detalle: 'Plantillas en borrador, sin uso hasta que Legal las apruebe.', to: '/ventas', tono: 'azul' })
  if (panel?.comprobantesPendientes) alertas.push({ clave: 'comprobantes', titulo: `${pl(panel.comprobantesPendientes, 'comprobante', 'comprobantes')} por verificar`, detalle: 'Pagos registrados sin confirmar.', to: '/cobranzas', tono: 'azul' })
  if (entrada?.desistimientosPendientes) alertas.push({ clave: 'desistimientos', titulo: `${pl(entrada.desistimientosPendientes, 'desistimiento', 'desistimientos')} por autorizar`, detalle: 'Las unidades siguen retenidas hasta decidir.', to: '/clientes', tono: 'rojo' })

  const valorPorEstado = useMemo(() => {
    const m = new Map<EstadoEfectivo, number>()
    for (const u of unidades) m.set(estadoEfectivo(u), (m.get(estadoEfectivo(u)) ?? 0) + calcularPrecio(u, state.params).precioVenta)
    return m
  }, [unidades, state.params])
  const filasEdificio = ([1, 2] as const).filter((e) => filtro === 'todos' || filtro === e).map((e) => {
    const propias = unidades.filter((u) => u.edificio === e)
    return {
      key: `e${e}`, label: `Edificio ${e}`, value: propias.reduce((t, u) => t + calcularPrecio(u, state.params).precioVenta, 0),
      color: e === 1 ? '#3563f3' : '#0b9f85', to: `/inventario?edificio=${e}`, unidades: propias.length, m2: propias.reduce((t, u) => t + u.areaM2, 0),
    }
  })
  const etiquetaReserva: Record<string, string> = { solicitada: 'Solicitadas', pago_verificado: 'Pago verificado', confirmada: 'Confirmadas' }
  const filasReservas = (panel?.reservasPorEstado ?? []).map((r) => ({ key: r.estado, label: etiquetaReserva[r.estado] ?? r.estado, value: r.cantidad, color: '#8b5cf6', to: '/reservas' }))
  const filasDona = ESTADO_EFECTIVO_ORDEN.map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: inv.porEstado[e], color: ESTADOS_EFECTIVOS[e].color })).filter((r) => r.value > 0)
  const obra = entrada?.obra?.filter((f) => (f.codigo === 'edificio1' || f.codigo === 'edificio2') && f.actividadesConAvance > 0 && f.avance !== null && (filtro === 'todos' || f.codigo === `edificio${filtro}`)) ?? []

  return (
    <div className="grid gap-5">
      <BannerBienvenida medios={medios} />
      <PageHeader title="Tu proyecto, en perspectiva." eyebrow="Panel general" subtitle="AMURA Apartments · cifras reales de Supabase"
        actions={<Button asChild className="h-9 gap-2 text-[11px] shadow-sm"><Link to="/venta"><Plus className="size-3.5" />Atender cliente</Link></Button>} />

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filtrar por edificio" className="inline-flex rounded-xl border border-border bg-white p-1 shadow-sm">
          {FILTROS.map((f) => (
            <button key={f.param} type="button" aria-pressed={filtro === f.valor}
              onClick={() => setParams((p) => { if (f.param === 'todos') p.delete('edificio'); else p.set('edificio', f.param); return p }, { replace: true })}
              className={cn('rounded-lg px-3.5 py-1.5 text-xs font-medium transition', filtro === f.valor ? 'bg-primary text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100')}>{f.etiqueta}</button>
          ))}
        </div>
        {filtro !== 'todos' && <span className="text-[11px] text-slate-500">Filtra inventario, reservas, contratos y cobros. Clientes y cotizaciones se cuentan por su interés en el edificio.</span>}
      </div>

      <section aria-label="Inventario" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{kpisInventario.map((k) => <Tarjeta key={k.clave} k={k} />)}</section>
      <section aria-label="Negocio" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{kpisNegocio.map((k) => <Tarjeta key={k.clave} k={k} />)}</section>

      {alertas.length > 0 && (
        <Seccion titulo="Requiere acción" sub="Solo lo que está registrado y espera una decisión">
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {alertas.map((a) => (
              <li key={a.clave}><Link to={a.to} className="flex h-full items-start gap-3 rounded-xl border border-border p-3 transition hover:border-primary/40 hover:bg-slate-50">
                <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', TONO[a.tono])}><AlertTriangle className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 text-xs"><strong className="block text-slate-900">{a.titulo}</strong><span className="mt-0.5 block text-slate-500">{a.detalle}</span></span>
              </Link></li>
            ))}
          </ul>
        </Seccion>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Seccion titulo="Inventario por estado" sub="Unidades por estado comercial" to="/inventario"><Dona filas={filasDona} total={inv.unidades} /></Seccion>
        <Seccion titulo="Edificio 1 vs. Edificio 2" sub="Reparto de estados en cada edificio"><PorEdificio unidades={unidades} filtro={filtro} /></Seccion>
        <Seccion titulo="Embudo comercial" sub="De clientes a ventas firmadas">{panel ? <Embudo etapas={panel.embudo} /> : <p className="text-xs text-slate-500">Cargando…</p>}</Seccion>
        <Seccion titulo="Ventas y cobranzas por mes" sub="Contratos firmados y pagos verificados" to="/cobranzas">
          {panel && panel.meses.length > 0 ? <Meses puntos={panel.meses} /> : (
            <p className="grid min-h-28 place-content-center text-center text-xs text-slate-500">{panel && panel.contratosFirmados === null ? 'Tu perfil no consulta ventas ni cobranzas.' : 'Aún no hay ventas firmadas ni cobros confirmados.'}</p>
          )}
        </Seccion>
        <Seccion titulo="Cartera de contratos firmados" sub="Cuánto se ha cobrado y cuánto falta" to="/cobranzas">
          {panel?.cartera && panel.cartera.pactado > 0 ? <Cartera c={panel.cartera} /> : (
            <p className="grid min-h-28 place-content-center text-center text-xs text-slate-500">{panel?.cartera ? 'Aún no hay contratos firmados con cuotas de entrada.' : panel === null ? 'Cargando…' : 'Tu perfil no consulta cobranzas.'}</p>
          )}
        </Seccion>
        <Seccion titulo="Mora por antigüedad" sub="Saldo vencido según días de atraso" to="/cobranzas">
          {panel?.mora && panel.mora.some((m) => m.monto > 0) ? (
            <Barras filas={panel.mora.map((m, i) => ({ key: m.id, label: m.etiqueta, value: m.monto, color: ['#f5a524', '#f08a24', '#e2662e', '#d34259', '#9f1239'][i], to: '/cobranzas' }))} formato={fmtUsd} nota="Solo cuotas de entrada de contratos firmados." />
          ) : (
            <p className="grid min-h-28 place-content-center text-center text-xs text-slate-500">{panel?.mora ? 'Sin cuotas vencidas: no hay mora que mostrar.' : panel === null ? 'Cargando…' : 'Tu perfil no consulta cobranzas.'}</p>
          )}
        </Seccion>
        <Seccion titulo="Reservas por estado" sub="Reservas abiertas y su etapa" to="/reservas">
          {filasReservas.length ? <Barras filas={filasReservas} formato={(v) => String(v)} /> : (
            <p className="grid min-h-28 place-content-center text-center text-xs text-slate-500">{panel?.reservasActivas === null ? 'Tu perfil no consulta reservas.' : panel ? 'No hay reservas abiertas.' : 'Cargando…'}</p>
          )}
        </Seccion>
        <Seccion titulo="Valor de lista por edificio" sub="Precios referenciales hasta su aprobación" to="/inventario">
          <Barras filas={filasEdificio} formato={compacto} nota={filasEdificio.map((f) => `${f.label}: ${f.unidades} unidades · ${fmtNum(f.m2)} m²`).join('  ·  ')} />
        </Seccion>
        <Seccion titulo="Valor de lista por estado" sub="Cuánto vale cada grupo de unidades" to="/inventario">
          <Barras filas={ESTADO_EFECTIVO_ORDEN.filter((e) => (valorPorEstado.get(e) ?? 0) > 0).map((e) => ({ key: e, label: ESTADOS_EFECTIVOS[e].label, value: valorPorEstado.get(e) ?? 0, color: ESTADOS_EFECTIVOS[e].color, to: `/inventario?estado=${e}${q ? `&edificio=${filtro}` : ''}` }))} formato={compacto} />
        </Seccion>
      </div>

      {obra.length > 0 && (
        <Seccion titulo="Avance físico de obra" sub="Avance actual por edificio" to="/obra">
          <ul className="grid gap-4 md:grid-cols-2">
            {obra.map((f) => (
              <li key={f.codigo}>
                <div className="mb-1.5 flex items-baseline justify-between text-xs"><span className="flex items-center gap-1.5 font-semibold"><HardHat className="size-3.5 text-slate-400" aria-hidden="true" />{f.nombre}</span><b className="tabular-nums">{f.avance!.toFixed(1)} %</b></div>
                <div className="h-3.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={f.avance!} aria-valuemin={0} aria-valuemax={100} aria-label={`Avance de ${f.nombre}`}><div className="h-full rounded-full bg-[#12a88b]" style={{ width: `${Math.min(f.avance!, 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      <p className="flex items-start gap-1.5 text-[10.5px] text-slate-500"><Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span>El valor de lista usa precios {referenciales > 0 ? 'referenciales aún sin aprobar' : 'aprobados'}; no son ventas. Las ventas y los cobros salen de contratos firmados y pagos verificados. «—» indica que tu perfil no consulta ese dato.</span></p>
      <ConoceAmura medios={medios} />
    </div>
  )
}
