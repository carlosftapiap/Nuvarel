import type { EstadoComercial } from './types'

export const ESTADOS: Record<EstadoComercial, { label: string; descripcion: string; tone: string; color: string }> = {
  por_confirmar: { label: 'Por confirmar', descripcion: 'Disponibilidad no confirmada oficialmente', tone: 'bg-amber-50 text-amber-800 ring-amber-200', color: '#e4a23a' },
  disponible: { label: 'Disponible', descripcion: 'Puede cotizarse y reservarse', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', color: '#12a88b' },
  bloqueado: { label: 'Bloqueado', descripcion: 'Retenido temporalmente por gerencia', tone: 'bg-slate-100 text-slate-700 ring-slate-200', color: '#7b89a1' },
  reservado: { label: 'Reservado', descripcion: 'Con reserva vigente', tone: 'bg-violet-50 text-violet-700 ring-violet-200', color: '#8b5cf6' },
  promesa: { label: 'Prometido', descripcion: 'Promesa de compraventa firmada', tone: 'bg-sky-50 text-sky-700 ring-sky-200', color: '#24a6da' },
  vendido: { label: 'Vendido', descripcion: 'Venta cerrada', tone: 'bg-blue-50 text-blue-800 ring-blue-200', color: '#3563f3' },
  no_disponible: { label: 'No disponible', descripcion: 'Fuera de comercialización', tone: 'bg-rose-50 text-rose-700 ring-rose-200', color: '#d34259' },
}

export const ESTADO_ORDEN: EstadoComercial[] = ['por_confirmar', 'disponible', 'bloqueado', 'reservado', 'promesa', 'vendido', 'no_disponible']

/** Transiciones manuales permitidas. "por_confirmar" sirve para conciliar el estado real inicial. */
export const TRANSICIONES: Record<EstadoComercial, EstadoComercial[]> = {
  por_confirmar: ['disponible', 'bloqueado', 'reservado', 'promesa', 'vendido', 'no_disponible'],
  disponible: ['bloqueado', 'reservado', 'no_disponible'],
  bloqueado: ['disponible', 'reservado', 'no_disponible'],
  reservado: ['disponible', 'promesa'],
  promesa: ['vendido', 'disponible'],
  vendido: [],
  no_disponible: ['disponible', 'bloqueado'],
}

/** Estados en los que el precio queda congelado porque ya existe un compromiso con un cliente. */
export const ESTADOS_PRECIO_BLOQUEADO: EstadoComercial[] = ['reservado', 'promesa', 'vendido']

/** Estados que normalmente fijará el flujo de Reservas / Ventas. */
export const ESTADOS_DE_FLUJO: EstadoComercial[] = ['reservado', 'promesa', 'vendido']

export function puedeTransicionar(de: EstadoComercial, a: EstadoComercial) {
  return TRANSICIONES[de].includes(a)
}

const norm = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function esEstado(v: string): v is EstadoComercial {
  return Object.prototype.hasOwnProperty.call(ESTADOS, v)
}

/** Acepta etiquetas legibles ("Por confirmar", "No disponible") o claves internas. */
export function parseEstado(v: unknown): EstadoComercial | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const key = norm(v).replace(/\s+/g, '_')
  if (esEstado(key)) return key
  return ESTADO_ORDEN.find((k) => norm(ESTADOS[k].label) === norm(v)) ?? null
}
