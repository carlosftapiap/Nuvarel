import type { Rol } from '@/features/inventario/types'

/** solicitada: el asesor la pide con la cotización. confirmada: pago verificado y unidad bloqueada. anulada: liberada. */
export type EstadoReserva = 'solicitada' | 'confirmada' | 'anulada'

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
  confirmada: { label: 'Confirmada', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulada: { label: 'Anulada', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
