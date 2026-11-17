import { BadgeCheck, Building2, CalendarCheck, FileText, Users, type LucideIcon } from 'lucide-react'
import type { ClavePaso } from './operacion'

/** Un color por etapa, el mismo en el asistente, en las tarjetas y en el resumen. */
export const COLOR_ETAPA: Record<ClavePaso, { solido: string; texto: string; suave: string; borde: string; anillo: string; hex: string }> = {
  cliente: { solido: 'bg-indigo-600 text-white', texto: 'text-indigo-700', suave: 'bg-indigo-50', borde: 'border-indigo-200', anillo: 'ring-indigo-500', hex: '#4f46e5' },
  unidad: { solido: 'bg-teal-600 text-white', texto: 'text-teal-700', suave: 'bg-teal-50', borde: 'border-teal-200', anillo: 'ring-teal-500', hex: '#0d9488' },
  cotizacion: { solido: 'bg-violet-600 text-white', texto: 'text-violet-700', suave: 'bg-violet-50', borde: 'border-violet-200', anillo: 'ring-violet-500', hex: '#7c3aed' },
  reserva: { solido: 'bg-amber-400 text-amber-950', texto: 'text-amber-800', suave: 'bg-amber-50', borde: 'border-amber-200', anillo: 'ring-amber-400', hex: '#f59e0b' },
  venta: { solido: 'bg-emerald-600 text-white', texto: 'text-emerald-700', suave: 'bg-emerald-50', borde: 'border-emerald-200', anillo: 'ring-emerald-500', hex: '#059669' },
}

export const ICONO_ETAPA: Record<ClavePaso, LucideIcon> = { cliente: Users, unidad: Building2, cotizacion: FileText, reserva: CalendarCheck, venta: BadgeCheck }
