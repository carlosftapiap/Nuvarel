import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ESTADO_ACTIVIDAD, type EstadoActividad } from '../model'

export const pct = (v: number | null, vacio = '—') => (v === null ? vacio : `${v.toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`)
export const fechaCorta = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
export const fechaHora = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' })
}

export function Barra({ valor, etiqueta, tono = 'bg-primary' }: { valor: number | null; etiqueta: string; tono?: string }) {
  if (valor === null) return <div className="h-2 rounded-full bg-muted" role="img" aria-label={`${etiqueta}: sin dato`} />
  const v = Math.max(0, Math.min(100, valor))
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={v}>
      <div className={cn('h-full rounded-full transition-all', tono)} style={{ width: `${v}%` }} />
    </div>
  )
}

export function Etiqueta({ children, tono }: { children: ReactNode; tono: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', tono)}>{children}</span>
}

export const EtiquetaEstado = ({ estado }: { estado: EstadoActividad }) => <Etiqueta tono={ESTADO_ACTIVIDAD[estado].tono}>{ESTADO_ACTIVIDAD[estado].label}</Etiqueta>

export function Aviso({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{children}</p>
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {children && <div className="mx-auto mt-2 max-w-lg text-xs text-muted-foreground">{children}</div>}
    </div>
  )
}
