import type { Tono } from '@/components/Estado'
import type { Permiso } from '@/app/permissions'
import type { Reserva } from './model'

/** Acción que la persona puede hacer ahora sobre la reserva, según sus permisos. */
export type AccionReserva = 'registrar_pago' | 'reenviar_pago' | 'verificar_pago' | 'autorizar'

export interface SiguientePaso {
  /** Estado visible de la reserva (el mismo para todos los perfiles). */
  estado: string
  tono: Tono
  /** Qué falta, dicho para quien mira. */
  titulo: string
  detalle: string
  /** Botón principal; null si a esta persona no le toca hacer nada. */
  accion: AccionReserva | null
  boton: string
}

const BOTON: Record<AccionReserva, string> = {
  registrar_pago: 'Registrar pago',
  reenviar_pago: 'Reemplazar comprobante y reenviar',
  verificar_pago: 'Verificar pago',
  autorizar: 'Autorizar excepción',
}

/**
 * Siguiente paso de una reserva. Replica las condiciones de los botones de siempre:
 * el vendedor registra el pago, Finanzas lo verifica y Gerencia solo autoriza excepciones.
 */
export function siguientePaso(r: Reserva, can: (p: Permiso) => boolean, o: { remoto: boolean; rechazada?: boolean }): SiguientePaso {
  const paso = (estado: string, tono: Tono, titulo: string, detalle: string, accion: AccionReserva | null = null): SiguientePaso => ({ estado, tono, titulo, detalle, accion, boton: accion ? BOTON[accion] : '' })
  if (r.estado === 'anulada') return paso('Anulada', 'neutro', 'Reserva anulada', r.motivoAnulacion ? `Motivo: ${r.motivoAnulacion}` : 'La solicitud quedó cerrada con su historial.')
  if (r.estado === 'confirmada') return paso('Confirmada', 'ok', 'Unidad reservada', 'El pago está verificado y la unidad quedó bloqueada. Sigue el contrato en Ventas y contratos.')
  if (r.estado === 'pago_verificado') {
    return can('reservas.confirmar')
      ? paso('Excepción por autorizar', 'info', 'Autorizar la excepción', 'Finanzas ya verificó el ingreso. No se confirmó sola por un descuento, un precio distinto del oficial o condiciones especiales.', 'autorizar')
      : paso('Excepción por autorizar', 'info', 'Gerencia autoriza la excepción', 'El ingreso está verificado. La reserva se confirma cuando Gerencia autorice la excepción.')
  }
  // Solicitada: sin comprobante (con Supabase) el pago todavía no se puede verificar.
  if (o.remoto && !r.comprobante) {
    if (o.rechazada) {
      return can('reservas.solicitar')
        ? paso('Comprobante rechazado', 'peligro', 'Reemplazar el comprobante', 'Finanzas rechazó el comprobante anterior. Adjunta el correcto y se envía de nuevo a revisión.', 'reenviar_pago')
        : paso('Comprobante rechazado', 'peligro', 'Esperando un nuevo comprobante', 'El vendedor debe reemplazar el comprobante rechazado.')
    }
    return can('reservas.solicitar')
      ? paso('Sin comprobante', 'aviso', 'Registrar el pago del cliente', 'Registra el depósito o la transferencia con su comprobante. Finanzas lo verifica después.', 'registrar_pago')
      : paso('Sin comprobante', 'aviso', 'Falta el comprobante', 'El vendedor debe registrar el pago y adjuntar el comprobante; después se puede verificar.')
  }
  return can('reservas.verificar_pago')
    ? paso('Pago por verificar', 'info', 'Verificar el pago recibido', 'Confirma el ingreso en la cuenta bancaria. Si las condiciones son normales, la reserva se confirma y la unidad queda reservada.', 'verificar_pago')
    : paso('Pago por verificar', 'info', 'Pendiente de verificación', 'Finanzas verifica el ingreso en el banco y confirma la reserva.')
}

/** Orden de atención: primero lo que cada quien debe hacer, luego lo que espera a otros, y al final lo cerrado. */
export function prioridad(r: Reserva, p: SiguientePaso) {
  if (p.accion) return 0
  if (r.estado === 'solicitada' || r.estado === 'pago_verificado') return 1
  return r.estado === 'confirmada' ? 2 : 3
}
