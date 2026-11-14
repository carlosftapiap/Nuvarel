import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Tonos de estado comunes: el mismo color significa lo mismo en reservas, clientes, pagos y unidades. */
export type Tono = 'ok' | 'aviso' | 'peligro' | 'info' | 'neutro' | 'acento'

const TONOS: Record<Tono, string> = {
  ok: 'bg-ok-bg text-ok',
  aviso: 'bg-aviso-bg text-aviso',
  peligro: 'bg-peligro-bg text-peligro',
  info: 'bg-info-bg text-info',
  neutro: 'bg-neutro-bg text-neutro',
  acento: 'bg-secondary text-secondary-foreground',
}

/** Etiqueta de estado. Con `punto`, un círculo del mismo color acompaña al texto (el texto siempre dice el estado). */
export default function Estado({ tono, punto, children, className }: { tono: Tono; punto?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold', TONOS[tono], className)}>
      {punto && <i className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Iniciales para el avatar de una persona. */
// eslint-disable-next-line react-refresh/only-export-components
export const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

export function Avatar({ nombre, className }: { nombre: string; className?: string }) {
  return <span aria-hidden="true" className={cn('grid size-8 shrink-0 place-items-center rounded-full bg-[#e0e7ff] text-xs font-bold text-[#3730a3]', className)}>{iniciales(nombre)}</span>
}
