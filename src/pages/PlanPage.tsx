import { useMemo, useState } from 'react'
import { CheckCircle2, CloudOff, Download, Loader2, RefreshCw } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { puedeVerDe, type Permiso } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FieldError } from '@/features/inventario/components/shared'
import { semaforo } from '@/features/plan/calculo'
import ConfigPlan, { CrearPlan } from '@/features/plan/components/ConfigPlan'
import DetalleActividad, { AccionDialog, type Accion } from '@/features/plan/components/DetalleActividad'
import Gantt from '@/features/plan/components/Gantt'
import Importacion from '@/features/plan/components/Importacion'
import Resumen from '@/features/plan/components/Resumen'
import TablaActividades from '@/features/plan/components/TablaActividades'
import { descargarPlan } from '@/features/plan/exportar'
import { FILTROS_INICIALES, filtrar, hayFiltros, type Filtros } from '@/features/plan/filtros'
import { ESTADO_ACTIVIDAD, type Actividad } from '@/features/plan/model'
import { usePlan } from '@/features/plan/usePlan'
import { fmtFecha } from '@/features/plan/ui'

const sel = 'h-8 rounded-md border border-border bg-white px-2 text-xs'

export default function PlanPage() {
  const { remoto } = useConexion()
  if (!remoto) {
    return (
      <>
        <PageHeader eyebrow="Sistema · Plan de implementación" title="Plan de implementación" />
        <div className="module-empty">
          <CloudOff className="size-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-semibold">Requiere la conexión con Supabase</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">El plan es compartido por varios usuarios y no funciona con datos guardados en el navegador. Configura la URL y la clave publicable de Supabase e inicia sesión.</p>
        </div>
      </>
    )
  }
  return <PlanConectado />
}

function PlanConectado() {
  const p = usePlan()
  const { actor, can } = useSession()
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [accion, setAccion] = useState<{ id: string; accion: Accion } | null>(null)
  const [tab, setTab] = useState('resumen')
  const d = p.data

  const acts = useMemo(() => (d ? filtrar(d.actividades, filtros, d.fases) : []), [d, filtros])
  const mias = useMemo(() => {
    if (!d?.plan) return []
    const orden = { rojo: 0, ambar: 1, gris: 2, verde: 3 }
    return d.actividades.filter((a) => a.responsableId === actor.id).sort((a, b) =>
      orden[semaforo(a, d.plan!.fechaCorte, d.plan!.alertaDias).color] - orden[semaforo(b, d.plan!.fechaCorte, d.plan!.alertaDias).color] || (a.planFin ?? '9').localeCompare(b.planFin ?? '9'))
  }, [d, actor.id])

  /** Aproximación en pantalla (el servidor decide): permiso + responsable dentro del alcance del usuario. */
  const puede = (permiso: string, a: Actividad) => can(permiso as Permiso) && puedeVerDe(actor, [a.responsableId]) || (can(permiso as Permiso) && !a.responsableId && actor.alcance?.tipo === 'empresa')
  const actividad = d?.actividades.find((a) => a.id === abierta) ?? null
  const enAccion = d?.actividades.find((a) => a.id === accion?.id) ?? null

  if (p.cargando) return <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando el plan…</p>
  if (!d) return <div className="p-6"><FieldError>{p.error ?? 'No se pudo cargar el plan.'}</FieldError></div>

  if (!d.plan) {
    return (
      <>
        <PageHeader eyebrow="Sistema · Plan de implementación" title="Plan de implementación" subtitle="Todavía no hay un plan registrado." />
        <FieldError>{p.error}</FieldError>
        {can('plan.alcance') ? <CrearPlan datos={p.datos!} ejecutar={p.ejecutar} onCreado={(id) => p.setPlanId(id)} /> : (
          <div className="module-empty"><p className="max-w-md text-sm text-muted-foreground">Un administrador con permiso para modificar el alcance del plan debe crearlo e importar el cronograma.</p></div>
        )}
      </>
    )
  }

  const plan = d.plan
  return (
    <>
      <PageHeader eyebrow="Sistema · Plan de implementación" title={plan.nombre}
        subtitle={`Código ${plan.codigo} · fecha de corte ${fmtFecha(plan.fechaCorte)} · ${d.actividades.length} actividades visibles para ti`}
        actions={(
          <>
            {d.planes.length > 1 && (
              <select aria-label="Plan" className={sel} value={plan.id} onChange={(e) => p.setPlanId(e.target.value)}>
                {d.planes.map((x) => <option key={x.id} value={x.id}>{x.codigo}</option>)}
              </select>
            )}
            <Button variant="outline" size="sm" onClick={() => void p.recargar()}><RefreshCw />Actualizar</Button>
            {can('plan.exportar') && <Button variant="outline" size="sm" disabled={!acts.length} onClick={() => descargarPlan(d, acts, actor.nombre)}><Download />Exportar Excel</Button>}
          </>
        )} />

      {p.aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{p.aviso}</p>}
      <div className="mb-3"><FieldError>{p.error}</FieldError></div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
        <Input aria-label="Buscar actividad" placeholder="Buscar código, actividad o responsable" className="h-8 w-60 text-xs" value={filtros.texto} onChange={(e) => setFiltros({ ...filtros, texto: e.target.value })} />
        <select aria-label="Frente" className={sel} value={filtros.frente} onChange={(e) => setFiltros({ ...filtros, frente: e.target.value })}>
          <option value="todos">Todos los frentes</option>
          {d.frentes.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          <option value="sin">Sin frente</option>
        </select>
        <select aria-label="Fase" className={sel} value={filtros.fase} onChange={(e) => setFiltros({ ...filtros, fase: e.target.value })}>
          <option value="todas">Todas las fases</option>
          {d.fases.map((f) => <option key={f.id} value={f.id}>{f.codigo} {f.nombre}</option>)}
        </select>
        <select aria-label="Responsable" className={sel} value={filtros.responsable} onChange={(e) => setFiltros({ ...filtros, responsable: e.target.value })}>
          <option value="todos">Todos los responsables</option>
          <option value="sin">Sin responsable vinculado</option>
          {d.personas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
        <select aria-label="Estado" className={sel} value={filtros.estado} onChange={(e) => setFiltros({ ...filtros, estado: e.target.value as Filtros['estado'] })}>
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADO_ACTIVIDAD).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select aria-label="Prioridad" className={sel} value={filtros.prioridad} onChange={(e) => setFiltros({ ...filtros, prioridad: e.target.value as Filtros['prioridad'] })}>
          <option value="todas">Todas las prioridades</option>
          <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option><option value="sin">Sin prioridad</option>
        </select>
        {hayFiltros(filtros) && <Button size="sm" variant="ghost" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar filtros</Button>}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="actividades">Actividades ({acts.length})</TabsTrigger>
          <TabsTrigger value="gantt">Gantt</TabsTrigger>
          <TabsTrigger value="mias">Mis actividades ({mias.length})</TabsTrigger>
          {can('plan.importar') && <TabsTrigger value="importar">Importar</TabsTrigger>}
          {can('plan.alcance') && <TabsTrigger value="config">Configuración del plan</TabsTrigger>}
        </TabsList>
        <TabsContent value="resumen"><Resumen d={d} acts={acts} onAbrir={(a) => setAbierta(a.id)} /></TabsContent>
        <TabsContent value="actividades">
          <TablaActividades d={d} acts={acts} onAbrir={(a) => setAbierta(a.id)} onAvance={(a) => setAccion({ id: a.id, accion: 'avance' })} puedeAvance={(a) => puede('plan.avance', a)} />
        </TabsContent>
        <TabsContent value="gantt"><Gantt d={d} acts={acts} onAbrir={(a) => setAbierta(a.id)} /></TabsContent>
        <TabsContent value="mias">
          {mias.length ? <TablaActividades d={d} acts={mias} onAbrir={(a) => setAbierta(a.id)} onAvance={(a) => setAccion({ id: a.id, accion: 'avance' })} puedeAvance={(a) => puede('plan.avance', a)} />
            : <div className="module-empty"><p className="max-w-md text-sm text-muted-foreground">No tienes actividades asignadas en este plan. Las actividades importadas quedan sin responsable hasta que se vinculen a un usuario.</p></div>}
        </TabsContent>
        {can('plan.importar') && <TabsContent value="importar"><Importacion d={d} datos={p.datos!} ejecutar={p.ejecutar} /></TabsContent>}
        {can('plan.alcance') && <TabsContent value="config"><ConfigPlan key={plan.id + plan.fechaCorte} d={d} datos={p.datos!} ejecutar={p.ejecutar} /></TabsContent>}
      </Tabs>

      <DetalleActividad d={d} a={actividad} datos={p.datos!} puede={puede} version={actividad?.version ?? 0}
        onAccion={(a, x) => setAccion({ id: a.id, accion: x })} onClose={() => setAbierta(null)} />
      {enAccion && accion && <AccionDialog key={`${enAccion.id}-${accion.accion}`} d={d} datos={p.datos!} a={enAccion} accion={accion.accion} onClose={() => setAccion(null)} ejecutar={p.ejecutar} />}
    </>
  )
}
