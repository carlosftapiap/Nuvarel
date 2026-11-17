import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Cabecera de los paneles de gestión: el mismo degradado y tipografía que Atender cliente. */
export function CabeceraPanel({ eyebrow, title, subtitle, acciones, className }: { eyebrow: string; title: string; subtitle?: string; acciones?: ReactNode; className?: string }) {
  return (
    <header className={cn('relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 px-4 py-4 text-white shadow-[0_16px_40px_-20px_#4f46e5] sm:px-7 sm:py-6', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 right-24 size-48 rounded-full bg-fuchsia-400/20" />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-100">{eyebrow}</p>
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-indigo-50">{subtitle}</p>}
        </div>
        {acciones && (
          // Sobre el degradado: los botones van translúcidos, el elegido en blanco y los enlaces de acción en blanco.
          <div className="flex flex-wrap items-center gap-2 [&_[role=group]]:rounded-xl [&_[role=group]]:bg-white/10 [&_[role=group]]:p-1 [&_button]:border-0 [&_button]:bg-white/15 [&_button]:text-white [&_button]:ring-1 [&_button]:ring-white/25 [&_button:hover]:bg-white/25 [&_button[aria-pressed=true]]:bg-white [&_button[aria-pressed=true]]:text-indigo-700 [&_a]:bg-white [&_a]:text-indigo-700 [&_a:hover]:bg-indigo-50">{acciones}</div>
        )}
      </div>
    </header>
  )
}

/** Tono de color de una tarjeta de indicador. Mismos colores que las etapas de venta. */
export type TonoKpi = 'indigo' | 'teal' | 'violeta' | 'ambar' | 'verde' | 'rojo'
const TONOS: Record<TonoKpi, { barra: string; texto: string; suave: string }> = {
  indigo: { barra: 'bg-indigo-600', texto: 'text-indigo-700', suave: 'bg-indigo-50' },
  teal: { barra: 'bg-teal-600', texto: 'text-teal-700', suave: 'bg-teal-50' },
  violeta: { barra: 'bg-violet-600', texto: 'text-violet-700', suave: 'bg-violet-50' },
  ambar: { barra: 'bg-amber-400', texto: 'text-amber-800', suave: 'bg-amber-50' },
  verde: { barra: 'bg-emerald-600', texto: 'text-emerald-700', suave: 'bg-emerald-50' },
  rojo: { barra: 'bg-rose-600', texto: 'text-rose-700', suave: 'bg-rose-50' },
}

/** Tarjeta de indicador con barra de color y etiqueta. */
export function KpiColor({ t, v, d, tono = 'indigo', alerta = false, icono }: { t: string; v: string | number; d?: string; tono?: TonoKpi; alerta?: boolean; icono?: ReactNode }) {
  const c = TONOS[alerta ? 'rojo' : tono]
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1', c.barra)} />
      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
        {icono && <span className={cn('grid size-7 place-items-center rounded-lg', c.suave, c.texto)} aria-hidden="true">{icono}</span>}{t}
      </div>
      <div className={cn('mt-2 font-display text-xl font-bold tabular-nums tracking-tight', alerta ? 'text-rose-700' : 'text-slate-900')}>{v}</div>
      {d && <div className="mt-0.5 text-xs text-slate-500">{d}</div>}
    </div>
  )
}

/** Título de sección con color, como en el asistente de venta. */
export function TituloSeccion({ id, children, tono = 'indigo' }: { id: string; children: ReactNode; tono?: TonoKpi }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-semibold">
      <span aria-hidden="true" className={cn('h-4 w-1 rounded-full', TONOS[tono].barra)} />{children}
    </h2>
  )
}
