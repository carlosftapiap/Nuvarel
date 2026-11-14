import type { ReactNode } from 'react'
import { CircleDashed, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NivelDato } from '../data/data-quality'
import { ESTADOS_EFECTIVOS, type EstadoEfectivo } from '../estados'
import type { Unit } from '../types'

export function EstadoBadge({ estado, className }: { estado: EstadoEfectivo; className?: string }) {
  const e = ESTADOS_EFECTIVOS[estado]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', e.tone, className)} title={e.descripcion}>
      <span className="size-1.5 rounded-full" style={{ background: e.color }} aria-hidden="true" />
      {e.label}
    </span>
  )
}

export const NIVEL: Record<NivelDato, { label: string; icon: typeof Info; tone: string }> = {
  pendiente: { label: 'Pendiente', icon: CircleDashed, tone: 'text-amber-800 bg-amber-50 ring-amber-200' },
  referencial: { label: 'Referencial', icon: Info, tone: 'text-slate-700 bg-slate-50 ring-slate-200' },
}

export function Dato({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{children}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** La misma explicación en Inventario y Precios. */
export function ReglaPrecios() {
  return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"><b>Quién propone y quién aprueba:</b> Gerencia envía propuestas y el precio oficial no cambia hasta que se aprueben. Administración, que aprueba precios, aplica el cambio directamente. Todo queda en el historial.</p>
}

export const ETIQUETA_PRECIO = {
  aprobado: { label: 'Aprobado', tono: 'text-emerald-700' },
  referencial: { label: 'Referencial', tono: 'text-amber-800' },
} as const

export const pisoLabel = (p: Unit['piso']) => (p === 'PB' ? 'Planta baja' : `Piso ${p}`)
export const pisoCorto = (p: Unit['piso']) => (p === 'PB' ? 'PB' : `P${p}`)

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{children}</p>
}
