import type { Rol } from '@/features/inventario/types'

/**
 * solicitada: la pide el vendedor. confirmada: Finanzas verificó el ingreso y, con condiciones normales, la reserva se confirma sola y la unidad queda reservada.
 * pago_verificado: ingreso verificado, pero con una excepción (descuento, precio distinto del oficial, condiciones especiales) que autoriza Gerencia. anulada: liberada.
 */
export type EstadoReserva = 'solicitada' | 'pago_verificado' | 'confirmada' | 'anulada'

export interface HistorialReserva {
  fecha: string
  usuario: string
  rol: Rol
  texto: string
}

export interface Reserva {
  id: string
  codigo: string
  clienteId: string
  clienteNombre: string
  /** Cédula, pasaporte o RUC del cliente (si el perfil puede verlo): prellena al pagador titular. */
  clienteDocumento?: string | null
  /** Con Supabase: negociación de la que salió la reserva. */
  oportunidadId?: string | null
  /** Responsable del cliente al solicitar (identificador de usuario). */
  asesorId: string
  unidad: string
  cotizacionId: string
  cotizacionNumero: string
  /** Hasta cuándo la cotización (y por tanto el precio) es válida. yyyy-mm-dd */
  vigenciaHasta: string
  /** Condiciones copiadas de la cotización aceptada; no cambian si el inventario se modifica después. */
  precioAcordado: number
  descuentoPct: number
  reservaPct: number
  montoReserva: number
  meses: number
  cuotaMensual: number
  /** Día de pago elegido en la cotización; lo usa el contrato. */
  diaPago?: string | null
  estado: EstadoReserva
  comprobante: string | null
  montoRecibido: number | null
  /** Finanzas: quien verificó el ingreso real. No puede ser quien aprueba. */
  verificadaPor: { id: string; nombre: string } | null
  fechaVerificacion: string | null
  /** Gerencia: quien aprobó la reserva. */
  aprobadaPor: { id: string; nombre: string } | null
  fechaConfirmacion: string | null
  motivoAnulacion: string
  creadaPor: { id: string; nombre: string; rol: Rol }
  creadaEn: string
  historial: HistorialReserva[]
  /** Revisión de Cumplimiento de la operación (Supabase). Sin ella Finanzas no verifica el pago. null: reserva anterior a la regla. */
  cumplimiento?: EstadoCumplimientoReserva | null
  /** Hasta cuándo la unidad queda apartada mientras Cumplimiento revisa. */
  apartadoHasta?: string | null
  prorrogas?: number
  /** Quién hizo el pago. Finanzas lo exige para verificar. */
  pagador?: Pagador | null
}

export type EstadoCumplimientoReserva = 'pendiente' | 'observado' | 'aprobado' | 'rechazado'
export type RelacionPagador = 'titular' | 'conyuge' | 'familiar' | 'empresa' | 'tercero'
export interface Pagador { nombre: string; identificacion: string; relacion: RelacionPagador; referencia: string | null }

export const RELACION_PAGADOR: Record<RelacionPagador, string> = {
  titular: 'El mismo comprador', conyuge: 'Cónyuge o conviviente', familiar: 'Familiar', empresa: 'Empresa del comprador', tercero: 'Otra persona',
}

export const ESTADO_CUMPLIMIENTO_RESERVA: Record<EstadoCumplimientoReserva, { label: string; tone: string }> = {
  pendiente: { label: 'Cumplimiento por revisar', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  observado: { label: 'Cumplimiento observó', tone: 'bg-orange-50 text-orange-800 ring-orange-200' },
  aprobado: { label: 'Cumplimiento aprobó', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazado: { label: 'Cumplimiento rechazó', tone: 'bg-red-50 text-red-700 ring-red-200' },
}

/** Motivo por el que Finanzas todavía no puede verificar el pago de esta reserva; null si puede. */
export function bloqueoVerificacion(r: Pick<Reserva, 'cumplimiento' | 'pagador'>): string | null {
  if (r.cumplimiento === undefined) return null
  if (r.cumplimiento !== 'aprobado') return 'Cumplimiento todavía no aprueba esta operación. Finanzas verifica el pago después de esa aprobación.'
  if (!r.pagador) return 'Falta registrar quién hizo el pago (nombre, identificación y relación con el comprador).'
  return null
}

export interface ReservasState {
  version: 1
  reservas: Reserva[]
}

export const ESTADO_RESERVA: Record<EstadoReserva, { label: string; tone: string }> = {
  solicitada: { label: 'Solicitada', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  pago_verificado: { label: 'Excepción por autorizar', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  confirmada: { label: 'Confirmada', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulada: { label: 'Anulada', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
