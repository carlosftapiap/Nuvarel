import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, CloudOff, Loader2, Lock, Plus, Users } from 'lucide-react'
import Aviso from '@/components/Aviso'
import { Avatar } from '@/components/Estado'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import ColaDelDia from '@/features/dashboard/Cola'
import { reservasVisibles } from '@/features/reservas/service'
import { siguientePaso } from '@/features/reservas/siguiente'
import { useReservasOpcional } from '@/features/reservas/store'
import { useConexion } from '@/app/auth'
import { SolicitudesReasignacion } from '@/features/clientes/components/Reasignaciones'
import { useSession } from '@/app/session'
import { ETAPAS, ETAPAS_OPORTUNIDAD, TIPOS_ACTIVIDAD, type Etapa, type TipoActividad } from '@/features/clientes/model'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import {
  cargarEquipo, cotizacionesDe, gruposPorSupervisor, indicadores, nombreCliente, oportunidadesPorEtapa, RESERVA_APROBADA, RESERVA_RECHAZADA, reservasDe, totales,
  type DatosEquipo, type GrupoSupervisor, type Indicadores, type Periodo, type Vendedor,
} from '@/features/equipo/resumen'
import { fechaGuayaquil, fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import PanelLeads from '@/features/leads/PanelLeads'
import { fmtUsd } from '@/features/inventario/pricing'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { numeroComercial } from '@/features/inventario/nomenclatura'

/** Dashboard de equipo y detalle por vendedor. Solo con Supabase: el alcance de equipo lo aplica la base. */
export default function EquipoPage({ vista }: { vista: 'dashboard' | 'detalle' }) {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  if (!remoto || !datos) return <div className="module-empty"><span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Requiere la base de datos</h2></div>
  if (!can('clientes.asignar')) return <div className="module-empty"><span className="module-empty-icon"><Lock className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Sin acceso a la gestión del equipo</h2></div>
  return <Panel datos={datos} vista={vista} />
}

function Kpi({ t, v, d, tono }: { t: string; v: string | number; d?: string; tono?: string }) {
  return <div className="dashboard-card !p-4"><div className="text-xs text-muted-foreground">{t}</div><div className={cn('mt-1 text-lg font-semibold tabular-nums tracking-tight', tono)}>{v}</div>{d && <div className="mt-0.5 text-xs text-muted-foreground">{d}</div>}</div>
}

function Kpis({ i }: { i: Indicadores }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi t="Clientes asignados" v={i.clientes} d={`${i.nuevos} nuevos registrados`} />
      <Kpi t="Cotizaciones" v={i.cotizaciones} d={`${i.oportunidadesAbiertas} oportunidades abiertas`} />
      <Kpi t="Reservas solicitadas" v={i.reservasSolicitadas} d={`${i.reservasAprobadas} aprobadas · ${i.reservasRechazadas} rechazadas o anuladas`} />
      <Kpi t="Ventas concretadas" v={i.ventas} d={`${fmtUsd(i.montoVendido)} vendidos`} />
      <Kpi t="Actividades registradas" v={i.actividades} d="Llamadas, mensajes, visitas y notas" />
      <Kpi t="Seguimientos vencidos" v={i.seguimientosVencidos} d="Clientes con la próxima acción atrasada" tono={i.seguimientosVencidos ? 'text-rose-700' : undefined} />
    </div>
  )
}

function Panel({ datos, vista }: { datos: Datos; vista: 'dashboard' | 'detalle' }) {
  const { actor, can } = useSession()
  const [d, setD] = useState<DatosEquipo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const cargar = useCallback(async () => {
    try { setD(await cargarEquipo(datos, actor.id)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [datos, actor.id])
  useRefresco(cargar)
  const filas = useMemo(() => (d ? d.vendedores.map((v) => ({ v, i: indicadores(d, v.id, periodo) })) : []), [d, periodo])

  if (!d) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando equipo…</p>
  const selector = (
    <div className="flex gap-1.5" role="group" aria-label="Periodo">
      {([['mes', 'Este mes'], ['todo', 'Todo']] as const).map(([k, l]) => (
        <button key={k} type="button" aria-pressed={periodo === k} onClick={() => setPeriodo(k)}
          className={cn('rounded-full border px-3 py-1 text-xs', periodo === k ? 'border-primary bg-secondary' : 'border-border hover:bg-muted')}>{l}</button>
      ))}
    </div>
  )
  const sinEquipo = d.vendedores.length === 0 && (
    <div className="module-empty"><span className="module-empty-icon"><Users className="size-7" aria-hidden="true" /></span>
      <h2 className="text-lg font-semibold">Todavía no tienes vendedores asignados</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">El administrador te asigna un equipo en Configuración → Equipos (tú como supervisor) y agrega a cada vendedor a ese equipo desde Usuarios.</p>
    </div>
  )

  if (vista === 'detalle') return <Detalle d={d} periodo={periodo} selector={selector} />

  // Mis ventas y Mi equipo van por separado; el total del equipo suma las ventas propias una sola vez.
  const propias = indicadores(d, d.yo, periodo)
  const equipo = totales(filas.map((f) => f.i))
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader eyebrow="Equipo comercial" title="Dashboard de equipo" subtitle="Tus ventas propias y la actividad de tus vendedores. Solo ves a los vendedores asignados a tus equipos."
        actions={<>{selector}{can('cotizaciones.crear') && <Button asChild><Link to="/venta"><Plus />Atender cliente</Link></Button>}</>} />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <AtencionEquipo filas={filas} onCambio={() => void cargar()} />
        <section aria-labelledby="mi-dia" className="grid grid-cols-[minmax(0,1fr)] gap-3">
          <h2 id="mi-dia" className="text-[15px] font-semibold">Mi día</h2>
          <ColaDelDia propios max={4} onAviso={setAviso} onError={setAviso} />
        </section>
      </div>
      <section aria-labelledby="mis-ventas" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mis-ventas" className="text-sm font-semibold">Mis ventas</h2>
          <Link className="text-xs text-primary hover:underline" to={`/mi-equipo?vendedor=${d.yo}`}>Ver mi detalle</Link>
        </div>
        <Kpis i={propias} />
      </section>
      <section aria-labelledby="mi-equipo" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <h2 id="mi-equipo" className="text-sm font-semibold">Mi equipo</h2>
        {sinEquipo || (
          <>
            <Kpis i={equipo} />
            <div className="dashboard-card !p-0 overflow-x-auto">
              <div className="px-4 pt-3 text-xs font-semibold">Indicadores por vendedor</div>
              <table className="w-full text-xs">
                <thead className="text-xs text-muted-foreground"><tr>
                  {['Vendedor', 'Clientes', 'Nuevos', 'Cotizaciones', 'Reservas', 'Aprobadas', 'Rechazadas', 'Ventas', 'Monto vendido', 'Actividades', 'Seguimientos vencidos', ''].map((h, k) => <th key={k} className={cn('px-2 py-2 font-medium', k === 0 ? 'px-4 text-left' : 'text-right')}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filas.map(({ v, i }) => (
                    <FilaIndicadores key={v.id} i={i} nombre={v.nombre} detalle={`${ROL_VENTA[v.rol] ?? 'Vendedor'}${v.equipo ? ` · ${v.equipo}` : ''}`} enlace={`/mi-equipo?vendedor=${v.id}`} />
                  ))}
                  <FilaIndicadores i={propias} nombre={`Mis ventas · ${d.propio.nombre}`} detalle="Ventas propias, contadas aparte" enlace={`/mi-equipo?vendedor=${d.yo}`} className="bg-muted/40" />
                  <FilaIndicadores i={totales([equipo, propias])} nombre="Total del equipo" detalle="Vendedores más mis ventas" className="border-t-2 font-semibold" />
                </tbody>
              </table>
            </div>
            <PanelLeads />
            <Actividades d={d} ids={[...d.vendedores.map((v) => v.id), d.yo]} periodo={periodo} />
          </>
        )}
      </section>
      <Aviso texto={aviso} onClose={cerrarAviso} />
    </div>
  )
}

/** Lo que pide la atención del Supervisor: reservas del equipo por atender, gestiones atrasadas por vendedor y reasignaciones. */
function AtencionEquipo({ filas, onCambio }: { filas: { v: { id: string; nombre: string }; i: Indicadores }[]; onCambio: () => void }) {
  const { actor, can } = useSession()
  const reservasCtx = useReservasOpcional()
  const porAtender = reservasCtx ? reservasVisibles(reservasCtx.state.reservas, actor).filter((r) => siguientePaso(r, can, { remoto: reservasCtx.remoto }).accion).length : 0
  const atrasados = filas.filter((f) => f.i.seguimientosVencidos > 0).sort((a, b) => b.i.seguimientosVencidos - a.i.seguimientosVencidos)
  const items = [
    ...(porAtender ? [{ k: 'reservas', t: `${porAtender} ${porAtender === 1 ? 'reserva espera' : 'reservas esperan'} una acción`, d: 'Pagos por registrar o comprobantes por revisar en tu equipo', to: '/reservas' }] : []),
    ...atrasados.map((f) => ({ k: f.v.id, t: `${f.i.seguimientosVencidos} ${f.i.seguimientosVencidos === 1 ? 'gestión atrasada' : 'gestiones atrasadas'} de ${f.v.nombre}`, d: 'Clientes con la próxima acción vencida', to: `/mi-equipo?vendedor=${f.v.id}` })),
  ]
  return (
    <section aria-labelledby="atencion-equipo" className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <h2 id="atencion-equipo" className="text-[15px] font-semibold">Requiere atención en tu equipo</h2>
      {items.length === 0 ? <p className="rounded-2xl border border-dashed border-[#c9cfda] bg-white p-5 text-[13px] text-slate-600">Tu equipo está al día: sin reservas por atender ni gestiones atrasadas.</p> : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {items.map((x) => (
            <li key={x.k}><Link to={x.to} className="flex items-center gap-3 rounded-2xl border border-border bg-white p-3 transition hover:border-[#c7d2fe]">
              <span className="grid grid-cols-[minmax(0,1fr)] size-10 shrink-0 place-items-center rounded-xl bg-peligro-bg text-peligro"><AlertTriangle className="size-[18px]" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><strong className="block text-sm">{x.t}</strong><span className="block truncate text-xs text-slate-600">{x.d}</span></span>
              <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
            </Link></li>
          ))}
        </ul>
      )}
      <SolicitudesReasignacion onCambio={onCambio} />
    </section>
  )
}

const ROL_VENTA: Record<string, string> = { asesor: 'Vendedor', corredor: 'Corredor', supervisor: 'Supervisor' }

function FilaIndicadores({ i, nombre, detalle, enlace, className }: { i: Indicadores; nombre: string; detalle: string; enlace?: string; className?: string }) {
  return (
    <tr className={cn('border-t border-border', className)}>
      <td className="px-4 py-2 font-medium">{nombre}<div className="text-xs font-normal text-muted-foreground">{detalle}</div></td>
      {[i.clientes, i.nuevos, i.cotizaciones, i.reservasSolicitadas, i.reservasAprobadas, i.reservasRechazadas, i.ventas].map((x, k) => <td key={k} className="px-2 py-2 text-right tabular-nums">{x}</td>)}
      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd(i.montoVendido)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{i.actividades}</td>
      <td className={cn('px-2 py-2 text-right tabular-nums', i.seguimientosVencidos && 'text-rose-700')}>{i.seguimientosVencidos}</td>
      <td className="px-4 py-2 text-right">{enlace && <Link className="text-primary hover:underline" to={enlace}>Ver detalle</Link>}</td>
    </tr>
  )
}

function Actividades({ d, ids, periodo }: { d: DatosEquipo; ids: string[]; periodo: Periodo }) {
  const nombre = (id: unknown) => (id === d.yo ? d.propio.nombre : d.vendedores.find((v) => v.id === id)?.nombre ?? '')
  const lista = d.actividades.filter((a) => ids.includes(String(a.user_id)) && (periodo === 'todo' || String(a.fecha).slice(0, 7) === hoyGuayaquil().slice(0, 7)))
    .sort((a, b) => String(b.created_at ?? b.fecha).localeCompare(String(a.created_at ?? a.fecha))).slice(0, 15)
  return (
    <div className="dashboard-card">
      <div className="mb-2 text-xs font-semibold">Actividad comercial reciente</div>
      {lista.length === 0 ? <p className="text-xs text-muted-foreground">Sin actividades registradas en el periodo.</p> : (
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-1 text-xs">
          {lista.map((a) => (
            <li key={String(a.id)} className="flex flex-wrap gap-1.5 text-muted-foreground">
              <span className="tabular-nums">{fmtFechaCorta(String(a.fecha).slice(0, 10))}</span>
              <b className="text-foreground">{TIPOS_ACTIVIDAD[a.tipo as TipoActividad] ?? String(a.tipo)}</b>
              <span>· {nombreCliente(d, a.client_id)}</span>{ids.length > 1 && <span>· {nombre(a.user_id)}</span>}
              <span>· {String(a.descripcion)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// La acción tiene el mismo ancho en cada fila y en el resumen del equipo, así las cifras quedan en la misma columna.
const BOTON_VER = 'justify-self-start sm:w-24 sm:justify-self-end'
const METRICAS: { t: string; k: keyof Indicadores }[] = [
  { t: 'Clientes', k: 'clientes' }, { t: 'Cotizaciones', k: 'cotizaciones' }, { t: 'Reservas', k: 'reservasSolicitadas' },
  { t: 'Ventas', k: 'ventas' }, { t: 'Vencidas', k: 'seguimientosVencidos' },
]

/** Los cinco números que se comparan entre personas: en columnas en escritorio y en pares en celular. */
function Metricas({ i, etiqueta, className }: { i: Indicadores; etiqueta: string; className?: string }) {
  return (
    <dl role="group" aria-label={etiqueta} className={cn('grid grid-cols-3 gap-x-3 gap-y-1 sm:grid-cols-5 sm:gap-x-2', className)}>
      {METRICAS.map(({ t, k }) => (
        <div key={k} className="flex items-baseline justify-between gap-1.5 sm:block sm:text-center">
          <dt className="text-xs text-slate-600">{t}</dt>
          <dd className={cn('text-sm font-semibold tabular-nums', k === 'seguimientosVencidos' && i[k] > 0 && 'text-rose-700')}>{i[k]}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Un vendedor en una fila (escritorio) o en una tarjeta (celular), con su gestión a un clic. */
function FilaVendedor({ v, i, onVer }: { v: Vendedor; i: Indicadores; onVer: (id: string) => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,28rem)_auto] sm:items-center sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar nombre={v.nombre} className="size-8" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{v.nombre}</div>
          <div className="text-xs text-slate-600">{ROL_VENTA[v.rol] ?? 'Vendedor'}</div>
        </div>
      </div>
      <Metricas i={i} etiqueta={`Indicadores de ${v.nombre}`} />
      <Button size="sm" variant="outline" className={BOTON_VER} aria-label={`Ver gestión de ${v.nombre}`} onClick={() => onVer(v.id)}>Ver gestión</Button>
    </li>
  )
}

/** Ventas propias de una persona, separadas de su equipo: así una venta nunca se cuenta dos veces. */
function VentasPropias({ persona, i, titulo, onVer }: { persona: Vendedor; i: Indicadores; titulo: string; onVer: (id: string) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-dashed border-[#c9cfda] bg-[#fafbfc] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,28rem)_auto] sm:items-center sm:px-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{titulo}</div>
        <div className="text-xs text-slate-600">Se muestra aparte: no se suma a los vendedores del equipo</div>
      </div>
      <Metricas i={i} etiqueta={titulo} />
      <Button size="sm" variant="outline" className={BOTON_VER} aria-label={`Ver gestión de ${persona.nombre}`} onClick={() => onVer(persona.id)}>Ver gestión</Button>
    </div>
  )
}

/** Un equipo: sus indicadores consolidados (solo vendedores) arriba y, debajo, cada vendedor. */
function EquipoView({ nombre, vendedores, d, periodo, onVer }: { nombre: string; vendedores: Vendedor[]; d: DatosEquipo; periodo: Periodo; onVer: (id: string) => void }) {
  const consolidado = totales(vendedores.map((v) => indicadores(d, v.id, periodo)))
  return (
    <section aria-label={nombre} className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{nombre}</h3>
        <span className="text-xs text-slate-600">{vendedores.length === 1 ? '1 vendedor' : `${vendedores.length} vendedores`}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl bg-[#f6f7fb] px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,28rem)_auto] sm:items-center sm:px-4">
        <div className="text-xs font-semibold text-slate-600">Indicadores del equipo</div>
        <Metricas i={consolidado} etiqueta={`Indicadores de ${nombre}`} />
        <span aria-hidden="true" className="hidden sm:block sm:w-24" />
      </div>
      {vendedores.length === 0
        ? <p className="px-1 text-xs text-slate-600">Sin vendedores: se asignan desde cada usuario.</p>
        : <ul className="grid gap-2">{vendedores.map((v) => <FilaVendedor key={v.id} v={v} i={indicadores(d, v.id, periodo)} onVer={onVer} />)}</ul>}
    </section>
  )
}

const SIN_SUPERVISOR = 'sin-supervisor'
const claveGrupo = (g: GrupoSupervisor) => g.supervisorId ?? SIN_SUPERVISOR
const nombreGrupo = (g: GrupoSupervisor) => g.supervisor?.nombre ?? (g.supervisorId ? 'Supervisor no visible para tu perfil' : 'Sin supervisor asignado')

/** Un supervisor: sus equipos, sus ventas propias y los vendedores sin equipo a su cargo. Se pliega en celular. */
function GrupoView({ g, d, periodo, abierto, onAlternar, onVer }: { g: GrupoSupervisor; d: DatosEquipo; periodo: Periodo; abierto: boolean; onAlternar: () => void; onVer: (id: string) => void }) {
  const nombre = nombreGrupo(g)
  const esYo = g.supervisorId === d.yo
  const numEquipos = g.equipos.length
  return (
    <section aria-label={`Supervisor ${nombre}`} className="overflow-hidden rounded-2xl border border-border bg-white">
      <h2>
        <button type="button" aria-expanded={abierto} onClick={onAlternar} className="flex w-full items-center gap-3 px-4 py-3 text-left">
          <Avatar nombre={g.supervisor?.nombre ?? '?'} className="size-9" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{nombre}{esYo && ' (tú)'}</span>
            <span className="block text-xs text-slate-600">{numEquipos === 1 ? '1 equipo' : `${numEquipos} equipos`}{g.sinEquipo.length > 0 && ` · ${g.sinEquipo.length} sin equipo`}</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-slate-500 transition-transform', abierto && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {abierto && (
        <div className="grid gap-4 border-t border-border p-4">
          {g.supervisor && <VentasPropias persona={g.supervisor} i={indicadores(d, g.supervisor.id, periodo)} titulo={esYo ? 'Tus ventas propias' : `Ventas propias de ${g.supervisor.nombre}`} onVer={onVer} />}
          {g.equipos.map(({ equipo, vendedores }) => <EquipoView key={equipo.id} nombre={equipo.nombre} vendedores={vendedores} d={d} periodo={periodo} onVer={onVer} />)}
          {g.sinEquipo.length > 0 && (
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{g.supervisor ? `Sin equipo a cargo de ${g.supervisor.nombre}` : 'Sin equipo asignado'}</h3>
              <ul className="grid gap-2">{g.sinEquipo.map((v) => <FilaVendedor key={v.id} v={v} i={indicadores(d, v.id, periodo)} onVer={onVer} />)}</ul>
            </section>
          )}
        </div>
      )}
    </section>
  )
}

/** Mi equipo: equipos agrupados por supervisor, con las asignaciones reales. La gestión de cada vendedor se abre en un panel, sin cambiar de pantalla. */
function Detalle({ d, periodo, selector }: { d: DatosEquipo; periodo: Periodo; selector: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({})
  const movil = useIsMobile()
  const grupos = useMemo(() => gruposPorSupervisor(d), [d])
  const fichas = useMemo(() => [d.propio, ...d.vendedores].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [d])
  const pedido = params.get('supervisor') ?? 'todos'
  const supervisorFiltro = grupos.some((g) => claveGrupo(g) === pedido) ? pedido : 'todos'
  const fichaId = params.get('vendedor')
  const ficha = fichas.find((p) => p.id === fichaId)
  const visibles = supervisorFiltro === 'todos' ? grupos : grupos.filter((g) => claveGrupo(g) === supervisorFiltro)
  const yoSupervisa = grupos.some((g) => g.supervisorId === d.yo)
  const verFicha = (id: string) => setParams((p) => { p.set('vendedor', id); return p }, { replace: true })
  const cerrarFicha = () => setParams((p) => { p.delete('vendedor'); return p }, { replace: true })
  const elegirSupervisor = (clave: string) => setParams((p) => { if (clave === 'todos') p.delete('supervisor'); else p.set('supervisor', clave); return p }, { replace: true })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader eyebrow="Equipo comercial" title="Mi equipo" subtitle="Equipos agrupados por supervisor, con los indicadores de cada vendedor. Elige uno para revisar su gestión." />
      <div className="flex flex-wrap items-center gap-2">
        {selector}
        {grupos.length > 1 && (
          <Select value={supervisorFiltro} onValueChange={elegirSupervisor}>
            <SelectTrigger className="h-9 min-w-44 bg-white text-[13px] max-md:w-full" aria-label="Filtrar por supervisor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Supervisor: todos</SelectItem>
              {grupos.map((g) => <SelectItem key={claveGrupo(g)} value={claveGrupo(g)}>{nombreGrupo(g)}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {fichas.length > 1 && (
          <Select value="" onValueChange={verFicha}>
            <SelectTrigger className="h-9 min-w-44 bg-white text-[13px] max-md:w-full" aria-label="Abrir la gestión de un vendedor"><SelectValue placeholder="Vendedor: elegir" /></SelectTrigger>
            <SelectContent>{fichas.map((p) => <SelectItem key={p.id} value={p.id}>{p.id === d.yo ? `${p.nombre} (tú)` : p.nombre}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>
      {d.vendedores.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[#c9cfda] bg-white px-5 py-4 text-sm text-slate-600">Todavía no tienes vendedores asignados. El administrador asigna cada vendedor a un equipo desde Usuarios, y el equipo a su supervisor desde Configuración → Equipos.</p>
      )}
      {!yoSupervisa && <VentasPropias persona={d.propio} i={indicadores(d, d.yo, periodo)} titulo="Tus ventas propias" onVer={verFicha} />}
      <div className="grid gap-3">
        {visibles.map((g, k) => {
          const clave = claveGrupo(g)
          const abierto = abiertos[clave] ?? (!movil || k === 0)
          return <GrupoView key={clave} g={g} d={d} periodo={periodo} abierto={abierto} onAlternar={() => setAbiertos((a) => ({ ...a, [clave]: !abierto }))} onVer={verFicha} />
        })}
      </div>
      <Sheet open={!!fichaId} onOpenChange={(o) => { if (!o) cerrarFicha() }}>
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
          <SheetHeader className="sticky top-0 z-10 border-b border-border bg-popover/95 px-5 py-4 backdrop-blur">
            <SheetTitle className="text-xl">{ficha?.nombre ?? 'Gestión del vendedor'}</SheetTitle>
            <SheetDescription>{ficha ? `${ficha.id === d.yo ? 'Tus ventas propias' : ROL_VENTA[ficha.rol] ?? 'Vendedor'} · ${ficha.equipo ?? 'Sin equipo'}` : 'Solo ves a los vendedores de tus equipos.'}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 px-5 py-5">
            {ficha ? <FichaVendedor d={d} id={ficha.id} periodo={periodo} /> : <p className="text-sm text-muted-foreground">Ese vendedor no pertenece a tu equipo.</p>}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Tabla({ titulo, cols, filas, vacio }: { titulo: string; cols: string[]; filas: React.ReactNode[][]; vacio: string }) {
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <div className="px-4 pt-3 text-xs font-semibold">{titulo} ({filas.length})</div>
      {filas.length === 0 ? <p className="px-4 py-3 text-xs text-muted-foreground">{vacio}</p> : (
        <table className="w-full text-xs">
          <thead className="text-xs text-muted-foreground"><tr>{cols.map((c, k) => <th key={k} className={cn('py-2 text-left font-medium', k === 0 ? 'px-4' : 'px-2')}>{c}</th>)}</tr></thead>
          <tbody>{filas.map((f, k) => <tr key={k} className="border-t border-border">{f.map((c, j) => <td key={j} className={cn('py-1.5', j === 0 ? 'px-4' : 'px-2')}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </div>
  )
}

const ESTADO_RESERVA: Record<string, string> = { solicitada: 'Solicitada', pago_verificado: 'Excepción por autorizar', confirmada: 'Confirmada', anulada: 'Anulada', rechazada: 'Rechazada' }

function FichaVendedor({ d, id, periodo }: { d: DatosEquipo; id: string; periodo: Periodo }) {
  // Fechas y marcas de tiempo, siempre en hora de Ecuador.
  const fecha = (x: unknown) => (x ? fmtFechaCorta(String(x).length > 10 ? fechaGuayaquil(String(x)) : String(x)) : '—')
  const clientes = d.clientes.filter((c) => c.asesor_id === id)
  const etapas = [...oportunidadesPorEtapa(d, id).entries()]
  return (
    <>
      <Kpis i={indicadores(d, id, periodo)} />
      <div className="dashboard-card !p-4">
        <div className="mb-2 text-xs font-semibold">Oportunidades por etapa</div>
        {etapas.length === 0 ? <p className="text-xs text-muted-foreground">Sin oportunidades.</p> : (
          <div className="flex flex-wrap gap-1.5 text-xs">{etapas.map(([e, n]) => <span key={e} className="rounded-full border border-border px-2 py-0.5">{ETAPAS_OPORTUNIDAD[e] ?? e}: <b>{n}</b></span>)}</div>
        )}
      </div>
      <Tabla titulo="Clientes asignados" cols={['Cliente', 'Etapa', 'Próxima acción', 'Registrado']} vacio="Sin clientes asignados."
        filas={clientes.map((c) => [
          <Link key="n" className="font-medium hover:underline" to={`/clientes?cliente=${String(c.id)}`}>{String(c.nombre)}</Link>,
          ETAPAS[c.etapa as Etapa]?.label ?? String(c.etapa),
          c.proxima_fecha ? `${fecha(c.proxima_fecha)} · ${String(c.proxima_descripcion ?? '')}` : '—',
          fecha(c.created_at),
        ])} />
      <Tabla titulo="Cotizaciones" cols={['Número', 'Cliente', 'Unidad', 'Precio final', 'Fecha']} vacio="Sin cotizaciones."
        filas={cotizacionesDe(d, id).map((q) => [String(q.numero), nombreCliente(d, q.client_id), numeroComercial(String(q.codigo ?? '—')), fmtUsd(Number(q.precio_final ?? 0)), fecha(q.fecha)])} />
      <Tabla titulo="Reservas" cols={['Reserva', 'Cliente', 'Unidad', 'Estado', 'Solicitada']} vacio="Sin reservas."
        filas={reservasDe(d, id).map((r) => [String(r.codigo), nombreCliente(d, r.client_id), numeroComercial(String(r.codigo_unidad)),
          <span key="e" className={cn(RESERVA_APROBADA.includes(String(r.estado)) && 'text-emerald-700', RESERVA_RECHAZADA.includes(String(r.estado)) && 'text-rose-700')}>{ESTADO_RESERVA[String(r.estado)] ?? String(r.estado)}</span>, fecha(r.created_at)])} />
      <Tabla titulo="Ventas" cols={['Contrato', 'Cliente', 'Unidad', 'Precio', 'Estado']} vacio="Sin contratos."
        filas={d.contratos.filter((k) => k.asesor_id === id).map((k) => [String(k.codigo), nombreCliente(d, k.client_id), numeroComercial(String(k.codigo_unidad)), fmtUsd(Number(k.precio ?? 0)), String(k.estado) === 'firmado' ? 'Firmado' : String(k.estado) === 'anulado' ? 'Anulado' : 'En preparación'])} />
      <Actividades d={d} ids={[id]} periodo={periodo} />
    </>
  )
}
