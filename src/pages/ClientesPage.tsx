import { useCallback, useMemo, useState } from 'react'
import { celularLocal } from '@/features/clientes/celular'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, Columns3, List, Search, UserPlus } from 'lucide-react'
import Aviso from '@/components/Aviso'
import { Avatar } from '@/components/Estado'
import PageHeader from '@/components/PageHeader'
import { SolicitudesReasignacion } from '@/features/clientes/components/Reasignaciones'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import AccionesRapidas from '@/features/clientes/components/AccionesRapidas'
import DesistimientoDialog from '@/features/clientes/components/DesistimientoDialog'
import ClienteFormDialog from '@/features/clientes/components/ClienteFormDialog'
import ClienteSheet, { CategoriaBadge, EtapaBadge } from '@/features/clientes/components/ClienteSheet'
import ImportarLocal from '@/features/clientes/components/ImportarLocalDialog'
import MoverEtapaDialog from '@/features/clientes/components/MoverEtapaDialog'
import TableroPipeline from '@/features/clientes/components/TableroPipeline'
import { ETAPA_ORDEN, ETAPAS, ORIGENES, TIPOS_ACTIVIDAD, type Cliente, type Etapa } from '@/features/clientes/model'
import { clientesVisibles, moverEtapa, ordenarPorUrgencia, urgencia, type Urgencia } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Vista recordada entre módulos; la primera vez se abre la lista de trabajo. */
const CLAVE_VISTA = 'amura.clientes.vista'
const vistaGuardada = (): 'tablero' | 'lista' => (typeof localStorage !== 'undefined' && localStorage.getItem(CLAVE_VISTA) === 'tablero' ? 'tablero' : 'lista')

type Filtro = 'activos' | 'vencidas' | 'hoy' | 'semana' | 'sin' | 'nuevos' | 'perdidos' | 'todos'
const activo = (c: Cliente) => c.etapa !== 'perdido'
const con = (u: Urgencia) => (c: Cliente) => activo(c) && urgencia(c) === u

/** Filtros de un clic. El número de cada uno coincide con la lista que muestra. */
const FILTROS: { k: Filtro; label: string; fn: (c: Cliente) => boolean; alerta?: string }[] = [
  { k: 'activos', label: 'Activos', fn: activo },
  { k: 'vencidas', label: 'Vencidas', fn: con('vencida'), alerta: 'bg-rose-100 text-rose-800' },
  { k: 'hoy', label: 'Para hoy', fn: con('hoy'), alerta: 'bg-amber-100 text-amber-900' },
  { k: 'semana', label: 'Próximos 7 días', fn: con('semana') },
  { k: 'sin', label: 'Sin próxima gestión', fn: con('sin_actividad') },
  { k: 'nuevos', label: 'Por contactar', fn: (c) => c.etapa === 'nuevo' },
  { k: 'perdidos', label: 'Perdidos', fn: (c) => c.etapa === 'perdido' },
  { k: 'todos', label: 'Todos', fn: () => true },
]
const esFiltro = (v: string | null): v is Filtro => FILTROS.some((f) => f.k === v)

export default function ClientesPage() {
  const { state, guardar, cargando, faltaMigracion, hayDesistimientos } = useClientes()
  const { state: inv } = useInventory()
  const { actor, can } = useSession()
  const [desiste, setDesiste] = useState(false)
  const [params, setParams] = useSearchParams()
  const [vista, setVistaState] = useState<'tablero' | 'lista'>(vistaGuardada)
  const setVista = (v: 'tablero' | 'lista') => { setVistaState(v); localStorage.setItem(CLAVE_VISTA, v) }
  // El inicio enlaza a una lista ya filtrada (p. ej. /clientes?filtro=vencidas).
  const [filtro, setFiltro] = useState<Filtro>(() => { const f = params.get('filtro'); return esFiltro(f) ? f : 'activos' })
  const [etapaFiltro, setEtapaFiltro] = useState<'todas' | Etapa>('todas')
  const [q, setQ] = useState('')
  const [asesor, setAsesor] = useState('todos')
  const [form, setForm] = useState<{ open: boolean; id?: string }>({ open: false })
  const [pedido, setPedido] = useState<{ id: string; nombre: string; etapa: Etapa } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const [error, setError] = useState<string | null>(null)
  // En celular la lista siempre es de tarjetas: el pipeline y el cambio de vista son de computadora.
  const movil = useIsMobile()
  const hoy = hoyGuayaquil()

  const abierta = params.get('cliente')
  const abrir = (id: string) => setParams((p) => { p.set('cliente', id); return p })
  const cerrar = () => setParams((p) => { p.delete('cliente'); return p })

  const visibles = useMemo(() => clientesVisibles(state.clientes, actor), [state.clientes, actor])
  const asesores = useMemo(() => [...new Set(visibles.map((c) => c.asesor))].sort(), [visibles])
  const filtroActual = FILTROS.find((f) => f.k === filtro)!
  const enBusqueda = (c: Cliente) =>
    (etapaFiltro === 'todas' || c.etapa === etapaFiltro) &&
    (asesor === 'todos' || c.asesor === asesor) &&
    (!q.trim() || norm(`${c.nombre} ${c.telefono} ${celularLocal(c.telefono)} ${c.email} ${c.unidadesInteres.join(' ')}`).includes(norm(q.trim())))
  // El pipeline muestra todas las etapas: el filtro rápido solo aplica a la lista.
  const tablero = vista === 'tablero' && !movil
  const filtrados = ordenarPorUrgencia(visibles.filter((c) => (tablero || filtroActual.fn(c)) && enBusqueda(c)), hoy)
  const cuenta = (f: (c: Cliente) => boolean) => visibles.filter(f).length
  const vencidas = cuenta(con('vencida'))
  const filtrosActivos = filtro !== 'activos' || etapaFiltro !== 'todas' || asesor !== 'todos' || q.trim() !== ''
  const limpiar = () => { setFiltro('activos'); setEtapaFiltro('todas'); setAsesor('todos'); setQ('') }

  async function mover(c: Cliente, etapa: Etapa) {
    setError(null)
    if (c.etapa === etapa) return
    if (etapa === 'perdido' || etapa === 'seguimiento') return setPedido({ id: c.id, nombre: c.nombre, etapa })
    try {
      await guardar((s) => moverEtapa(s, c.id, etapa, actor))
      setAviso(`${c.nombre} → ${ETAPAS[etapa].label}`)
    } catch (e) { setError((e as Error).message) }
  }
  const dpt = (codigo: string) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? codigo
  const proxima = (c: Cliente) => {
    const u = urgencia(c, hoy)
    if (!c.proxima) return <span className={cn('text-xs', c.etapa === 'perdido' ? 'text-slate-500' : 'font-medium text-amber-700')}>{c.etapa === 'perdido' ? 'Cliente perdido' : 'Sin próxima gestión'}</span>
    return (
      <span className={cn('flex min-w-0 items-center gap-1.5 text-[13px]', u === 'vencida' ? 'text-rose-700' : u === 'hoy' ? 'text-amber-800' : 'text-slate-700')}>
        <CalendarClock className="size-4 shrink-0" aria-hidden="true" />
        <b className="shrink-0 font-semibold">{TIPOS_ACTIVIDAD[c.proxima.tipo]}</b>
        <span className="min-w-0 truncate">{c.proxima.descripcion}</span>
        <span className={cn('shrink-0 whitespace-nowrap', u !== 'vencida' && u !== 'hoy' && 'text-slate-500')}>· {u === 'hoy' ? 'hoy' : fmtFechaCorta(c.proxima.fecha)}{u === 'vencida' ? ' · vencida' : ''}</span>
      </span>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Clientes"
        subtitle={`${cuenta(activo)} activos · ${vencidas} con gestión vencida · ${cuenta(con('hoy'))} para hoy`}
        actions={<>
          {hayDesistimientos && can('ventas.desistimiento') && <Button variant="outline" onClick={() => setDesiste(true)}>Registrar desistimiento</Button>}
          <Button onClick={() => setForm({ open: true })}><UserPlus />Nuevo cliente</Button>
        </>} />

      <div className="mb-4 empty:hidden"><SolicitudesReasignacion /></div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[min(100%,280px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="cli-q" className="sr-only">Buscar cliente</label>
          <Input id="cli-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, celular, correo o departamento" className="h-10 bg-white pl-9 text-sm" />
        </div>
        <Select value={etapaFiltro} onValueChange={(v) => setEtapaFiltro(v as 'todas' | Etapa)}>
          <SelectTrigger className="h-10 min-w-40 bg-white text-[13px]" aria-label="Filtrar por etapa"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todas">Etapa: todas</SelectItem>{ETAPA_ORDEN.map((e) => <SelectItem key={e} value={e}>{ETAPAS[e].label}</SelectItem>)}</SelectContent>
        </Select>
        {asesores.length > 1 && (
          <Select value={asesor} onValueChange={setAsesor}>
            <SelectTrigger className="h-10 min-w-44 bg-white text-[13px]" aria-label="Filtrar por vendedor"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Vendedor: todos</SelectItem>{asesores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {!movil && (
          <div className="flex rounded-xl bg-[#eaedf2] p-1" role="group" aria-label="Vista">
            <Button size="sm" variant="ghost" className={cn('h-8 text-slate-600', vista === 'lista' && 'bg-white text-foreground shadow-xs hover:bg-white')} aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}><List />Lista</Button>
            <Button size="sm" variant="ghost" className={cn('h-8 text-slate-600', vista === 'tablero' && 'bg-white text-foreground shadow-xs hover:bg-white')} aria-pressed={vista === 'tablero'} onClick={() => setVista('tablero')}><Columns3 />Pipeline</Button>
          </div>
        )}
      </div>

      {!tablero && (
        <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtros rápidos de clientes">
          {FILTROS.map((f) => {
            const n = cuenta(f.fn)
            return (
              <button key={f.k} type="button" aria-pressed={filtro === f.k} onClick={() => setFiltro(f.k)}
                className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
                  filtro === f.k ? 'border-[#101828] bg-[#101828] text-white' : 'border-border bg-white text-slate-700 hover:bg-muted')}>
                {f.label}
                <span className={cn('rounded-full px-1.5 text-xs font-bold tabular-nums', filtro === f.k ? 'bg-white text-[#101828]' : n && f.alerta ? f.alerta : 'bg-muted text-slate-600')}>{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {filtrosActivos && filtrados.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Mostrando {filtrados.length} de {visibles.length}</span>
          <Button size="xs" variant="ghost" onClick={limpiar}>Limpiar filtros</Button>
        </div>
      )}
      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}

      {faltaMigracion && (
        <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          La base de datos todavía no tiene las funciones de Clientes: puedes consultar, pero no guardar. Falta aplicar la migración <code>20261031000000_clientes_crm.sql</code>. Tus datos locales siguen intactos.
        </p>
      )}
      <ImportarLocal onMessage={setAviso} />

      {cargando ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando clientes…</p>
      ) : visibles.length === 0 ? (
        <div className="module-empty">
          <span className="module-empty-icon"><UserPlus className="size-7" aria-hidden="true" /></span>
          <h2 className="text-xl font-semibold tracking-tight">Aún no hay clientes</h2>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">Registra el primer interesado para empezar a darle seguimiento.</p>
          <Button className="mt-6" onClick={() => setForm({ open: true })}><UserPlus />Nuevo cliente</Button>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="dashboard-card flex flex-col items-center gap-2 p-8 text-center">
          <h2 className="text-sm font-semibold">{filtro === 'vencidas' && !q.trim() ? 'Sin gestiones vencidas' : 'No hay clientes que coincidan'}</h2>
          <p className="max-w-sm text-xs text-muted-foreground">{filtro === 'vencidas' && !q.trim() ? 'Todo el seguimiento está al día.' : 'Cambia la búsqueda o los filtros, o vuelve a ver todos los clientes.'}</p>
          {filtrosActivos && <Button size="sm" variant="outline" className="mt-2" onClick={limpiar}>Limpiar filtros</Button>}
        </div>
      ) : tablero ? (
        <TableroPipeline clientes={filtrados} dpt={dpt} onAbrir={abrir} onMover={(c, e) => void mover(c, e)} onMessage={setAviso} />
      ) : movil ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Clientes">
          {filtrados.map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-2xl border border-border bg-white p-3.5 shadow-[0_1px_2px_#1018280a]">
              <button type="button" onClick={() => abrir(c.id)} aria-label={`Abrir ficha de ${c.nombre}`} className="flex items-start justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold">{c.nombre} <CategoriaBadge cliente={c} /></span>
                  <span className="mt-0.5 block text-xs text-slate-600">{celularLocal(c.telefono) || c.email || 'Sin celular'} · {c.asesor}</span>
                </span>
                <EtapaBadge etapa={c.etapa} />
              </button>
              <div className="min-w-0">{proxima(c)}</div>
              <AccionesRapidas cliente={c} onMessage={setAviso} className="border-t border-border pt-2.5" />
            </li>
          ))}
        </ul>
      ) : (
        <div className="dashboard-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border bg-[#fafbfc] text-xs text-slate-600">
              <tr><th className="px-4 py-2.5 text-left font-semibold">Cliente</th><th className="px-2 py-2.5 text-left font-semibold">Etapa</th><th className="px-2 py-2.5 text-left font-semibold">Próxima gestión</th><th className="px-2 py-2.5 text-left font-semibold">Vendedor</th><th className="px-4 py-2.5 text-right font-semibold"><span className="sr-only">Acciones</span></th></tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-border first:border-t-0 hover:bg-[#fafbff]" onClick={() => abrir(c.id)}>
                  <td className="px-4 py-2.5">
                    <button type="button" className="text-left" aria-label={`Abrir ficha de ${c.nombre}`} onClick={(e) => { e.stopPropagation(); abrir(c.id) }}>
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{c.nombre} <CategoriaBadge cliente={c} /></span>
                      <span className="block text-xs text-slate-600">{celularLocal(c.telefono) || c.email || 'Sin celular'} · {ORIGENES[c.origen]}{c.unidadesInteres.length ? ` · ${c.unidadesInteres.map(dpt).join(', ')}` : ''}{c.presupuesto ? ` · ${fmtUsd(c.presupuesto)}` : ''}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5"><EtapaBadge etapa={c.etapa} /></td>
                  <td className="max-w-[340px] px-2 py-2.5">{proxima(c)}</td>
                  <td className="px-2 py-2.5"><span className="flex items-center gap-2 whitespace-nowrap text-slate-700"><Avatar nombre={c.asesor} className="size-7" />{c.asesor}</span></td>
                  <td className="px-4 py-2.5"><AccionesRapidas cliente={c} onMessage={setAviso} className="justify-end" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Aviso texto={aviso} onClose={cerrarAviso} />
      <ClienteSheet id={abierta} onClose={cerrar} onEdit={(id) => setForm({ open: true, id })} onMessage={setAviso}
        onPedirEtapa={(id, etapa) => { const c = state.clientes.find((x) => x.id === id); if (c) setPedido({ id, nombre: c.nombre, etapa }) }} />
      <ClienteFormDialog open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))}
        cliente={form.id ? state.clientes.find((c) => c.id === form.id) : undefined}
        onSaved={(id, m) => { setAviso(m); if (!form.id) abrir(id) }} />
      {desiste && <DesistimientoDialog onClose={() => setDesiste(false)} onDone={setAviso} />}
      <MoverEtapaDialog pedido={pedido} onClose={() => setPedido(null)} onDone={setAviso} />
    </>
  )
}
