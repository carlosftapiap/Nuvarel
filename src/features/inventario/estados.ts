import type { EstadoComercial, EstadoHistorico, Unit } from './types'

export const ESTADOS: Record<EstadoComercial, { label: string; descripcion: string; tone: string; color: string }> = {
  disponible: { label: 'Disponible', descripcion: 'Puede cotizarse y reservarse', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', color: '#12a88b' },
  reservado: { label: 'Reservado', descripcion: 'Con reserva vigente: no admite otra reserva', tone: 'bg-violet-50 text-violet-700 ring-violet-200', color: '#8b5cf6' },
  vendido: { label: 'Vendido', descripcion: 'Venta formalizada con el contrato firmado', tone: 'bg-blue-50 text-blue-800 ring-blue-200', color: '#3563f3' },
}

export const ESTADO_ORDEN: EstadoComercial[] = ['disponible', 'reservado', 'vendido']

/** Nombres de los estados anteriores, solo para leer el historial. */
const ESTADOS_ANTERIORES: Record<Exclude<EstadoHistorico, EstadoComercial>, string> = {
  por_confirmar: 'Por confirmar (anterior)',
  bloqueado: 'Bloqueado (anterior)',
  promesa: 'Prometido (anterior)',
  no_disponible: 'No disponible (anterior)',
}

export const etiquetaEstado = (e: EstadoHistorico) => (e in ESTADOS ? ESTADOS[e as EstadoComercial].label : ESTADOS_ANTERIORES[e as keyof typeof ESTADOS_ANTERIORES] ?? e)

/** Lo que se muestra es el estado guardado: una solicitud en trámite no cambia el estado de la unidad. */
export type EstadoEfectivo = EstadoComercial

export const ESTADOS_EFECTIVOS = ESTADOS

export const ESTADO_EFECTIVO_ORDEN = ESTADO_ORDEN

export function estadoEfectivo(u: Pick<Unit, 'estado'>): EstadoEfectivo {
  return u.estado
}

/** Transiciones que fijan Reservas y Contratos: aprobar reserva, anularla, firmar contrato y anularlo. */
export const TRANSICIONES: Record<EstadoComercial, EstadoComercial[]> = {
  disponible: ['reservado'],
  reservado: ['disponible', 'vendido'],
  vendido: ['reservado'],
}

/** Estados en los que el precio queda congelado porque ya existe un compromiso con un cliente. */
export const ESTADOS_PRECIO_BLOQUEADO: EstadoComercial[] = ['reservado', 'vendido']

/** Estados que fija el flujo de Reservas y Contratos. */
export const ESTADOS_DE_FLUJO: EstadoComercial[] = ['reservado', 'vendido']

export function puedeTransicionar(de: EstadoComercial, a: EstadoComercial) {
  return TRANSICIONES[de].includes(a)
}

/** Ningún estado se cambia a mano: los asignan Reservas y Contratos. */
export const TRANSICIONES_MANUALES: Record<EstadoComercial, EstadoComercial[]> = { disponible: [], reservado: [], vendido: [] }

export function puedeCambiarManual(de: EstadoComercial, a: EstadoComercial) {
  return TRANSICIONES_MANUALES[de].includes(a)
}

/** Por qué el estado no se cambia a mano, para explicarlo en pantalla. */
export const MOTIVO_SIN_CAMBIO: Record<EstadoComercial, string> = {
  disponible: 'Pasa a reservado cuando se aprueba una reserva, en Reservas.',
  reservado: 'Tiene una reserva vigente: se libera anulándola en Reservas, o pasa a vendido al firmar el contrato.',
  vendido: 'Venta formalizada: solo cambia si se anula el contrato en Ventas.',
}

const norm = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function esEstado(v: string): v is EstadoComercial {
  return Object.prototype.hasOwnProperty.call(ESTADOS, v)
}

/** Acepta las etiquetas ("Disponible") o las claves internas. Los estados anteriores no se convierten solos. */
export function parseEstado(v: unknown): EstadoComercial | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const key = norm(v).replace(/\s+/g, '_')
  if (esEstado(key)) return key
  return ESTADO_ORDEN.find((k) => norm(ESTADOS[k].label) === norm(v)) ?? null
}
