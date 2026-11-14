import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronRight, CloudOff, Loader2, Lock, Plus, Users } from 'lucide-react'
import Aviso from '@/components/Aviso'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
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
  cargarEquipo, cotizacionesDe, indicadores, nombreCliente, oportunidadesPorEtapa, RESERVA_APROBADA, RESERVA_RECHAZADA, reservasDe, totales,
  type DatosEquipo, type Indicadores, type Periodo,
} from '@/features/equipo/resumen'
import { fechaGuayaquil, fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import PanelLeads from '@/features/leads/PanelLeads'
import { fmtUsd } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'

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

  if (vista === 'detalle') return <Detalle d={d} periodo={periodo} selector={selector} vacio={sinEquipo} />

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

function Detalle({ d, periodo, selector, vacio }: { d: DatosEquipo; periodo: Periodo; selector: React.ReactNode; vacio: React.ReactNode }) {
  const [params, setParams] = useSearchParams()
  // Mis ventas primero; después, cada vendedor del equipo.
  const personas = [{ ...d.propio, nombre: 'Mis ventas' }, ...d.vendedores]
  const id = params.get('vendedor') ?? d.vendedores[0]?.id ?? d.yo
  const v = personas.find((x) => x.id === id) ?? null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader eyebrow="Equipo comercial" title="Mi equipo" subtitle="Elige tus ventas o las de un vendedor para revisar su gestión: clientes, cotizaciones, reservas, ventas y seguimiento." actions={selector} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vendedor">
        {personas.map((x) => (
          <button key={x.id} type="button" aria-pressed={x.id === id} onClick={() => setParams({ vendedor: x.id }, { replace: true })}
            className={cn('rounded-full border px-3 py-1 text-xs', x.id === id ? 'border-primary bg-secondary font-medium' : 'border-border hover:bg-muted')}>{x.nombre}</button>
        ))}
      </div>
      {v ? <FichaVendedor d={d} id={v.id} periodo={periodo} /> : <p className="text-sm text-muted-foreground">Ese vendedor no pertenece a tu equipo.</p>}
      {id === d.yo && vacio}
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
      <div className="dashboard-card">
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
        filas={cotizacionesDe(d, id).map((q) => [String(q.numero), nombreCliente(d, q.client_id), String(q.codigo ?? '—'), fmtUsd(Number(q.precio_final ?? 0)), fecha(q.fecha)])} />
      <Tabla titulo="Reservas" cols={['Reserva', 'Cliente', 'Unidad', 'Estado', 'Solicitada']} vacio="Sin reservas."
        filas={reservasDe(d, id).map((r) => [String(r.codigo), nombreCliente(d, r.client_id), String(r.codigo_unidad),
          <span key="e" className={cn(RESERVA_APROBADA.includes(String(r.estado)) && 'text-emerald-700', RESERVA_RECHAZADA.includes(String(r.estado)) && 'text-rose-700')}>{ESTADO_RESERVA[String(r.estado)] ?? String(r.estado)}</span>, fecha(r.created_at)])} />
      <Tabla titulo="Ventas" cols={['Contrato', 'Cliente', 'Unidad', 'Precio', 'Estado']} vacio="Sin contratos."
        filas={d.contratos.filter((k) => k.asesor_id === id).map((k) => [String(k.codigo), nombreCliente(d, k.client_id), String(k.codigo_unidad), fmtUsd(Number(k.precio ?? 0)), String(k.estado) === 'firmado' ? 'Firmado' : String(k.estado) === 'anulado' ? 'Anulado' : 'En preparación'])} />
      <Actividades d={d} ids={[id]} periodo={periodo} />
    </>
  )
}
