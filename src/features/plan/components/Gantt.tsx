import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { diaNumero, semaforo, sumarDias } from '../calculo'
import type { DatosPlan } from '../api'
import type { Actividad } from '../model'
import { colorBarra, fmtFecha, fmtPct } from '../ui'

type Escala = 'semana' | 'mes' | 'trimestre'
const PX: Record<Escala, number> = { semana: 26, mes: 7, trimestre: 2.4 }
const ALTO = 30
const IZQ = 300
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

type Fila = { tipo: 'fase'; id: string; titulo: string; total: number } | { tipo: 'act'; a: Actividad; nivel: number; tieneHijas: boolean }

/**
 * Diagrama de Gantt: barras con fechas vigentes y avance, línea base debajo, dependencias fin a inicio y fecha de corte.
 * Las filas se agrupan por fase y las actividades superiores se pueden contraer.
 */
export default function Gantt({ d, acts, onAbrir }: { d: DatosPlan; acts: Actividad[]; onAbrir: (a: Actividad) => void }) {
  const plan = d.plan!
  const [escala, setEscala] = useState<Escala>('mes')
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())
  const px = PX[escala]
  const alternar = (id: string) => setCerrados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const { filas, inicio, dias } = useMemo(() => {
    const ids = new Set(acts.map((a) => a.id))
    const hijas = new Map<string, Actividad[]>()
    for (const a of acts) if (a.parentId && ids.has(a.parentId)) hijas.set(a.parentId, [...(hijas.get(a.parentId) ?? []), a])
    const filas: Fila[] = []
    const agregar = (a: Actividad, nivel: number) => {
      const h = hijas.get(a.id) ?? []
      filas.push({ tipo: 'act', a, nivel, tieneHijas: h.length > 0 })
      if (!cerrados.has(a.id)) for (const x of h) agregar(x, nivel + 1)
    }
    const grupos = [...d.fases.map((f) => ({ id: f.id, titulo: `${f.codigo} ${f.nombre}` })), { id: 'sin-fase', titulo: 'Sin fase' }]
    for (const g of grupos) {
      const raices = acts.filter((a) => (a.faseId ?? 'sin-fase') === g.id && (!a.parentId || !ids.has(a.parentId)))
      if (!raices.length) continue
      filas.push({ tipo: 'fase', id: g.id, titulo: g.titulo, total: acts.filter((a) => (a.faseId ?? 'sin-fase') === g.id).length })
      if (!cerrados.has(g.id)) for (const a of raices) agregar(a, 0)
    }
    const fechas = acts.flatMap((a) => [a.planInicio, a.planFin, a.baseInicio, a.baseFin]).filter((x): x is string => !!x)
    fechas.push(plan.fechaCorte)
    const min = fechas.reduce((m, x) => (x < m ? x : m))
    const max = fechas.reduce((m, x) => (x > m ? x : m))
    const inicio = sumarDias(min.slice(0, 8) + '01', 0)
    return { filas, inicio, dias: diaNumero(max) - diaNumero(inicio) + 21 }
  }, [acts, d.fases, cerrados, plan.fechaCorte])

  const x = (iso: string) => (diaNumero(iso) - diaNumero(inicio)) * px
  const ancho = Math.max(600, dias * px)
  const fila = new Map<string, number>()
  filas.forEach((f, i) => { if (f.tipo === 'act') fila.set(f.a.id, i) })

  const marcas: { x: number; t: string; mayor: boolean }[] = []
  for (let i = 0; i <= dias; i++) {
    const dia = sumarDias(inicio, i)
    const [y, m, dd] = dia.split('-').map(Number)
    if (escala === 'semana' && new Date(Date.UTC(y, m - 1, dd)).getUTCDay() === 1) marcas.push({ x: i * px, t: `${dd}/${m}`, mayor: dd <= 7 })
    else if (escala === 'mes' && dd === 1) marcas.push({ x: i * px, t: `${MESES[m - 1]} ${String(y).slice(2)}`, mayor: true })
    else if (escala === 'trimestre' && dd === 1 && (m - 1) % 3 === 0) marcas.push({ x: i * px, t: `T${(m + 2) / 3} ${y}`, mayor: true })
  }

  const flechas = d.dependencias.flatMap((dep) => {
    const p = acts.find((a) => a.id === dep.predecesoraId)
    const s = acts.find((a) => a.id === dep.sucesoraId)
    const ip = fila.get(dep.predecesoraId)
    const is = fila.get(dep.sucesoraId)
    if (!p || !s || ip === undefined || is === undefined || !p.planFin || !s.planInicio) return []
    const x1 = x(p.planFin) + px
    const x2 = x(s.planInicio)
    const y1 = ip * ALTO + ALTO / 2
    const y2 = is * ALTO + ALTO / 2
    const conflicto = s.planInicio <= p.planFin
    const codo = Math.max(x1 + 6, x2 - 6)
    return [{ k: `${p.id}-${s.id}`, d: `M${x1},${y1} H${codo} V${y2} H${x2}`, conflicto }]
  })

  if (!acts.length) return <div className="module-empty"><p className="text-sm text-muted-foreground">No hay actividades para mostrar.</p></div>
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <div className="flex gap-1" role="group" aria-label="Escala del Gantt">
          {(['semana', 'mes', 'trimestre'] as Escala[]).map((e) => (
            <button key={e} type="button" aria-pressed={escala === e} onClick={() => setEscala(e)} className={cn('rounded-full border px-3 py-1 capitalize', escala === e ? 'border-primary bg-secondary text-secondary-foreground' : 'border-border hover:bg-muted')}>{e === 'semana' ? 'Semanal' : e === 'mes' ? 'Mensual' : 'Trimestral'}</button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded bg-slate-300" />Línea base</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded bg-emerald-600" />Vigente (color = plazo; relleno = avance)</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-rose-500" />Fecha de corte {fmtFecha(plan.fechaCorte)}</span>
        <span className="inline-flex items-center gap-1"><span className="h-px w-5 bg-amber-500" />Dependencia a revisar</span>
      </div>
      <div className="dashboard-card !p-0 overflow-auto" style={{ maxHeight: '70vh' }}>
        <div className="relative" style={{ width: IZQ + ancho }}>
          <div className="sticky top-0 z-20 flex h-8 border-b border-border bg-white text-xs text-muted-foreground">
            <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-border bg-white px-3 font-medium" style={{ width: IZQ }}>Actividad</div>
            <div className="relative" style={{ width: ancho }}>
              {marcas.map((m) => <span key={m.x} className="absolute top-2 whitespace-nowrap" style={{ left: m.x + 3 }}>{m.t}</span>)}
            </div>
          </div>
          <div className="relative" style={{ height: filas.length * ALTO }}>
            <div className="absolute top-0 bottom-0" style={{ left: IZQ, width: ancho }}>
              {marcas.map((m) => <div key={m.x} className={cn('absolute top-0 bottom-0 w-px', m.mayor ? 'bg-slate-200' : 'bg-slate-100')} style={{ left: m.x }} />)}
              <div className="absolute top-0 bottom-0 w-px bg-rose-500" style={{ left: x(plan.fechaCorte) }} title={`Fecha de corte ${fmtFecha(plan.fechaCorte)}`} />
              <svg className="pointer-events-none absolute inset-0" width={ancho} height={filas.length * ALTO} aria-hidden="true">
                <defs>
                  <marker id="fl" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#64748b" /></marker>
                  <marker id="fl-r" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#d97706" /></marker>
                </defs>
                {flechas.map((f) => <path key={f.k} d={f.d} fill="none" stroke={f.conflicto ? '#d97706' : '#94a3b8'} strokeWidth={1.2} markerEnd={`url(#${f.conflicto ? 'fl-r' : 'fl'})`} />)}
              </svg>
            </div>
            {filas.map((f, i) => {
              if (f.tipo === 'fase') {
                return (
                  <div key={`g-${f.id}`} className="absolute left-0 flex items-center border-b border-border bg-slate-50" style={{ top: i * ALTO, height: ALTO, width: IZQ + ancho }}>
                    <button type="button" className="sticky left-0 flex h-full shrink-0 items-center gap-1 border-r border-border bg-slate-50 px-2 text-left text-xs font-semibold" style={{ width: IZQ }} onClick={() => alternar(f.id)} aria-expanded={!cerrados.has(f.id)}>
                      {cerrados.has(f.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}<span className="truncate">{f.titulo}</span><span className="ml-auto font-normal text-muted-foreground">{f.total}</span>
                    </button>
                  </div>
                )
              }
              const a = f.a
              const s = semaforo(a, plan.fechaCorte, plan.alertaDias)
              const color = colorBarra[s.color]
              return (
                <div key={a.id} className="absolute left-0 flex items-center border-b border-border/60 hover:bg-muted/30" style={{ top: i * ALTO, height: ALTO, width: IZQ + ancho }}>
                  <div className="sticky left-0 z-10 flex h-full shrink-0 items-center gap-1 border-r border-border bg-white px-2 text-xs" style={{ width: IZQ, paddingLeft: 8 + f.nivel * 14 }}>
                    {f.tieneHijas ? <button type="button" aria-label={cerrados.has(a.id) ? 'Expandir' : 'Contraer'} onClick={() => alternar(a.id)}>{cerrados.has(a.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button> : <span className="w-3.5" />}
                    <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:underline" onClick={() => onAbrir(a)}>
                      <span className="font-mono font-semibold">{a.codigo}</span><span className="truncate">{a.nombre}</span>
                    </button>
                  </div>
                  <div className="relative h-full" style={{ width: ancho }}>
                    {a.baseInicio && a.baseFin && <div className="absolute rounded-sm bg-slate-300" style={{ left: x(a.baseInicio), width: (diaNumero(a.baseFin) - diaNumero(a.baseInicio) + 1) * px, top: ALTO - 9, height: 3 }} title={`Línea base ${fmtFecha(a.baseInicio)} – ${fmtFecha(a.baseFin)}`} />}
                    {a.planInicio && a.planFin && (a.tipo === 'hito'
                      ? <button type="button" onClick={() => onAbrir(a)} className="absolute size-3 rotate-45" style={{ left: x(a.planInicio) + px / 2 - 6, top: ALTO / 2 - 8, background: color }} title={`${a.codigo} · hito ${fmtFecha(a.planFin)} · ${s.texto}`} />
                      : (
                        <button type="button" onClick={() => onAbrir(a)} className="absolute overflow-hidden rounded" style={{ left: x(a.planInicio), width: Math.max(4, (diaNumero(a.planFin) - diaNumero(a.planInicio) + 1) * px), top: 6, height: ALTO - 16, background: `${color}33`, border: `1px solid ${color}` }}
                          title={`${a.codigo} · ${fmtFecha(a.planInicio)} – ${fmtFecha(a.planFin)} · avance ${fmtPct(a.avance)} · ${s.texto}`}>
                          <span className="block h-full" style={{ width: `${a.avance ?? 0}%`, background: color }} />
                        </button>
                      ))}
                    {(!a.planInicio || !a.planFin) && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs italic text-muted-foreground">Fechas pendientes</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
