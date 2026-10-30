import { ChevronRight, Pencil } from 'lucide-react'
import { duracion, operativas, semaforo } from '../calculo'
import type { DatosPlan } from '../api'
import type { Actividad } from '../model'
import { EstadoBadge, SemaforoBadge, fmtFecha, fmtPct, nombreResponsable } from '../ui'

/** Lista editable: cada fila abre el detalle con las acciones que el usuario tiene permitidas (el servidor vuelve a verificarlas). */
export default function TablaActividades({ d, acts, onAbrir, onAvance, puedeAvance }: {
  d: DatosPlan
  acts: Actividad[]
  onAbrir: (a: Actividad) => void
  onAvance: (a: Actividad) => void
  puedeAvance: (a: Actividad) => boolean
}) {
  const plan = d.plan!
  const personas = new Map(d.personas.map((p) => [p.id, p.nombre]))
  const fase = new Map(d.fases.map((f) => [f.id, f]))
  const hojas = new Set(operativas(d.actividades).map((a) => a.id))
  if (!acts.length) return <div className="module-empty"><p className="text-sm text-muted-foreground">No hay actividades que coincidan con los filtros.</p></div>
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <table className="w-full min-w-[1080px] text-xs">
        <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Código</th>
            <th className="px-2 py-2 text-left font-medium">Actividad</th>
            <th className="px-2 py-2 text-left font-medium">Fase</th>
            <th className="px-2 py-2 text-left font-medium">Responsable</th>
            <th className="px-2 py-2 text-left font-medium">Inicio</th>
            <th className="px-2 py-2 text-left font-medium">Fin</th>
            <th className="px-2 py-2 text-right font-medium">Días</th>
            <th className="px-2 py-2 text-right font-medium">Peso</th>
            <th className="px-2 py-2 text-right font-medium">Avance</th>
            <th className="px-2 py-2 text-left font-medium">Estado</th>
            <th className="px-3 py-2 text-left font-medium">Plazo</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {acts.map((a) => {
            const f = a.faseId ? fase.get(a.faseId) : undefined
            const reprog = a.baseFin && a.planFin && a.baseFin !== a.planFin
            return (
              <tr key={a.id} className="cursor-pointer border-t border-border align-top hover:bg-muted/40" onClick={() => onAbrir(a)}>
                <td className="px-3 py-2 font-mono font-semibold">{a.codigo}{a.tipo === 'hito' && <span className="ml-1 rounded bg-violet-50 px-1 text-[9px] font-sans text-violet-700">Hito</span>}</td>
                <td className="max-w-80 px-2 py-2"><div className="line-clamp-2">{a.parentId ? '↳ ' : ''}{a.nombre}</div></td>
                <td className="px-2 py-2 text-muted-foreground">{f ? `${f.codigo}` : <span className="italic">—</span>}</td>
                <td className="max-w-44 px-2 py-2"><span className={a.responsableId ? '' : 'italic text-muted-foreground'}>{nombreResponsable(a, personas)}</span></td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtFecha(a.planInicio)}</td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">{fmtFecha(a.planFin)}{reprog && <div className="text-[10px] text-muted-foreground">base {fmtFecha(a.baseFin)}</div>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{duracion(a.planInicio, a.planFin) ?? '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums">{a.peso ?? <span className="italic text-muted-foreground">Pend.</span>}</td>
                <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  {hojas.has(a.id) && puedeAvance(a) && a.estado !== 'completada' && a.estado !== 'cancelada'
                    ? <button type="button" className="inline-flex items-center gap-1 rounded px-1 tabular-nums hover:bg-muted" title="Actualizar avance" onClick={() => onAvance(a)}>{fmtPct(a.avance)}<Pencil className="size-3 text-muted-foreground" /></button>
                    : <span className="tabular-nums">{hojas.has(a.id) ? fmtPct(a.avance) : <span className="text-muted-foreground">Calculado</span>}</span>}
                </td>
                <td className="px-2 py-2"><EstadoBadge estado={a.estado} bloqueada={a.bloqueada} /></td>
                <td className="px-3 py-2"><SemaforoBadge s={semaforo(a, plan.fechaCorte, plan.alertaDias)} /></td>
                <td className="px-2 py-2 text-muted-foreground"><ChevronRight className="size-4" /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
