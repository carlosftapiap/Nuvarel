import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Color, Semaforo } from './calculo'
import { ESTADO_ACTIVIDAD, type Actividad, type EstadoActividad } from './model'

const COLOR: Record<Color, { punto: string; tono: string }> = {
  rojo: { punto: 'bg-rose-500', tono: 'text-rose-800 bg-rose-50 ring-rose-200' },
  ambar: { punto: 'bg-amber-500', tono: 'text-amber-900 bg-amber-50 ring-amber-200' },
  verde: { punto: 'bg-emerald-500', tono: 'text-emerald-800 bg-emerald-50 ring-emerald-200' },
  gris: { punto: 'bg-slate-400', tono: 'text-slate-700 bg-slate-50 ring-slate-200' },
}
export const colorBarra: Record<Color, string> = { rojo: '#e11d48', ambar: '#d97706', verde: '#059669', gris: '#94a3b8' }

/** El color siempre lleva texto: no indica por sí solo el estado. */
export function SemaforoBadge({ s, className }: { s: Semaforo; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', COLOR[s.color].tono, className)}>
      <span className={cn('size-1.5 rounded-full', COLOR[s.color].punto)} aria-hidden="true" />{s.texto}
    </span>
  )
}

export function EstadoBadge({ estado, bloqueada }: { estado: EstadoActividad; bloqueada?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ESTADO_ACTIVIDAD[estado].tone)}>{ESTADO_ACTIVIDAD[estado].label}</span>
      {bloqueada && <span className="whitespace-nowrap rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-200">Bloqueada</span>}
    </span>
  )
}

export function Kpi({ t, v, d, tone }: { t: string; v: ReactNode; d?: string; tone?: string }) {
  return (
    <div className="dashboard-card !p-4">
      <div className="text-xs text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums tracking-tight', tone)}>{v}</div>
      {d && <div className="mt-0.5 text-xs text-muted-foreground">{d}</div>}
    </div>
  )
}

export function fmtFecha(iso: string | null) {
  if (!iso) return 'Pendiente'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fmtPct(v: number | null) {
  return v === null ? 'Sin dato' : `${v.toLocaleString('es-EC', { maximumFractionDigits: 1 })}%`
}

export const pendiente = <span className="text-xs italic text-muted-foreground">Pendiente</span>

/** Nombre del responsable o texto original del archivo marcado como pendiente de vincular. */
export function nombreResponsable(a: Actividad, personas: Map<string, string>) {
  if (a.responsableId) return personas.get(a.responsableId) ?? 'Usuario fuera de tu alcance'
  if (a.responsableExterno) return a.responsableExterno
  return a.responsableTexto ? `${a.responsableTexto} (sin vincular)` : 'Sin responsable'
}
