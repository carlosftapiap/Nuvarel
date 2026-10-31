import type { EstadoComercial, Unit } from './types'

export const ESTADOS: Record<EstadoComercial, { label: string; descripcion: string; tone: string; color: string }> = {
  por_confirmar: { label: 'Disponibilidad pendiente de validar', descripcion: 'Tiene precio y metraje cargados, pero su disponibilidad aún no se valida oficialmente', tone: 'bg-amber-50 text-amber-800 ring-amber-200', color: '#e4a23a' },
  disponible: { label: 'Disponible', descripcion: 'Puede cotizarse y reservarse', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', color: '#12a88b' },
  bloqueado: { label: 'Bloqueado', descripcion: 'Retenido temporalmente por gerencia', tone: 'bg-slate-100 text-slate-700 ring-slate-200', color: '#7b89a1' },
  reservado: { label: 'Reservado', descripcion: 'Con reserva vigente', tone: 'bg-violet-50 text-violet-700 ring-violet-200', color: '#8b5cf6' },
  promesa: { label: 'Prometido', descripcion: 'Promesa de compraventa firmada', tone: 'bg-sky-50 text-sky-700 ring-sky-200', color: '#24a6da' },
  vendido: { label: 'Vendido', descripcion: 'Venta cerrada', tone: 'bg-blue-50 text-blue-800 ring-blue-200', color: '#3563f3' },
  no_disponible: { label: 'No disponible', descripcion: 'Fuera de comercialización', tone: 'bg-rose-50 text-rose-700 ring-rose-200', color: '#d34259' },
}

export const ESTADO_ORDEN: EstadoComercial[] = ['por_confirmar', 'disponible', 'bloqueado', 'reservado', 'promesa', 'vendido', 'no_disponible']

/** Lo que se muestra: el estado guardado, salvo que una solicitud activa impida ofrecer la unidad como libre. */
export type EstadoEfectivo = EstadoComercial | 'en_proceso_reserva'

export const ESTADOS_EFECTIVOS: Record<EstadoEfectivo, { label: string; descripcion: string; tone: string; color: string }> = {
  ...ESTADOS,
  en_proceso_reserva: { label: 'En proceso de reserva', descripcion: 'Tiene una solicitud activa pendiente de pago, validación o aprobación', tone: 'bg-yellow-100 text-yellow-800 ring-yellow-300', color: '#eab308' },
}

export const ESTADO_EFECTIVO_ORDEN: EstadoEfectivo[] = ['por_confirmar', 'disponible', 'en_proceso_reserva', 'bloqueado', 'reservado', 'promesa', 'vendido', 'no_disponible']

/** Reservado, prometido, vendido y no disponible ya dicen más que la solicitud: se respetan. */
export function estadoEfectivo(u: Pick<Unit, 'estado' | 'solicitud'>): EstadoEfectivo {
  return u.solicitud && (u.estado === 'disponible' || u.estado === 'bloqueado' || u.estado === 'por_confirmar') ? 'en_proceso_reserva' : u.estado
}

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

/**
 * Lo que una persona puede cambiar a mano. Reservado, prometido y vendido con compromiso los fijan Reservas y Contratos:
 * así no se libera una unidad con una operación vigente. Quitar un bloqueo sí es una decisión manual de Gerencia.
 */
export const TRANSICIONES_MANUALES: Record<EstadoComercial, EstadoComercial[]> = {
  por_confirmar: ['disponible', 'bloqueado', 'vendido', 'no_disponible'],
  disponible: ['bloqueado', 'no_disponible'],
  bloqueado: ['disponible', 'no_disponible'],
  reservado: [],
  promesa: [],
  vendido: [],
  no_disponible: ['disponible', 'bloqueado'],
}

export function puedeCambiarManual(de: EstadoComercial, a: EstadoComercial) {
  return TRANSICIONES_MANUALES[de].includes(a)
}

/** Por qué un estado no admite cambio manual, para explicarlo en pantalla. */
export const MOTIVO_SIN_CAMBIO: Partial<Record<EstadoComercial, string>> = {
  reservado: 'Tiene una reserva vigente: se libera solo anulándola con su autorización, en Reservas.',
  promesa: 'Tiene un contrato vigente: cambia desde Ventas y contratos.',
  vendido: 'Venta cerrada: estado final.',
}

const norm = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function esEstado(v: string): v is EstadoComercial {
  return Object.prototype.hasOwnProperty.call(ESTADOS, v)
}

/** Acepta etiquetas legibles ("Disponibilidad pendiente de validar", "No disponible"), el nombre anterior "Por confirmar" o claves internas. */
export function parseEstado(v: unknown): EstadoComercial | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const key = norm(v).replace(/\s+/g, '_')
  if (esEstado(key)) return key
  return ESTADO_ORDEN.find((k) => norm(ESTADOS[k].label) === norm(v)) ?? null
}
