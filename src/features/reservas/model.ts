import type { Rol } from '@/features/inventario/types'

/** solicitada: la pide el vendedor. pago_verificado: Finanzas confirmó el ingreso. confirmada: Gerencia aprobó y la unidad queda bloqueada. anulada: liberada. */
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
}

export interface ReservasState {
  version: 1
  reservas: Reserva[]
}

export const ESTADO_RESERVA: Record<EstadoReserva, { label: string; tone: string }> = {
  solicitada: { label: 'Solicitada', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  pago_verificado: { label: 'Pago verificado', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  confirmada: { label: 'Confirmada', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulada: { label: 'Anulada', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
