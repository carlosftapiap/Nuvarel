import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { round2 } from '@/features/inventario/pricing'
import type { EstadoComercial } from '@/features/inventario/types'
import type { Reserva } from '@/features/reservas/model'

/**
 * Reglas de la pantalla de venta. No guardan nada: el servidor sigue validando cada paso.
 * Monto acordado (reservations.monto_reserva) y monto pagado (monto_recibido, lo fija Finanzas) son datos distintos.
 */
export type EstadoContrato = 'borrador' | 'firmado' | 'anulado'

export const fmtMonto = (v: number) => `USD ${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Mensaje de error del monto acordado, o null si es válido. El tope es el 6 %, como en el servidor. */
export function errorMontoReserva(monto: number | null, tope: number): string | null {
  if (monto === null || !Number.isFinite(monto)) return 'Ingresa el monto acordado de la reserva.'
  if (monto <= 0) return 'El monto acordado debe ser mayor a cero.'
  if (round2(monto) !== monto) return 'El monto admite hasta dos decimales.'
  if (monto > tope) return `El monto acordado no puede superar el 6 % (${fmtMonto(tope)}).`
  return null
}

/**
 * Lo que falta pagar a la firma. La reserva pagada se acredita al 6 %, sin duplicarse.
 * Si aún no hay pago verificado, se calcula con el monto acordado y se indica que es una proyección.
 */
export function acreditacion(pagoFirma: number, acordado: number, pagado: number | null) {
  const base = pagado ?? acordado
  return {
    base,
    proyectado: pagado === null,
    restanteFirma: round2(Math.max(0, pagoFirma - base)),
    excedente: round2(Math.max(0, base - pagoFirma)),
  }
}

export type Accion = 'cliente' | 'unidad' | 'emitir' | 'reemitir' | 'confirmar_unidad' | 'unidad_ocupada' | 'solicitar' | 'registrar_pago' | 'verificar' | 'aprobar' | 'contrato' | 'firma' | 'cobranza' | 'anulada'

export interface Paso {
  accion: Accion
  titulo: string
  detalle: string
  responsable: string
}

export interface ContextoOperacion {
  clienteId: string
  codigo: string
  estadoUnidad?: EstadoComercial
  cotizacion: Cotizacion | null
  reserva: Reserva | null
  /** Reserva activa de la misma unidad en otra cotización. */
  otraReserva: { codigo: string } | null
  estadoContrato: EstadoContrato | null
  receptorDefinido: boolean | null
  hoy: string
}

export function siguientePaso(c: ContextoOperacion): Paso {
  const r = c.reserva
  if (r && r.estado !== 'anulada') {
    if (r.estado === 'solicitada' && !r.comprobante) {
      return { accion: 'registrar_pago', titulo: 'Esperar el pago de la reserva', detalle: `Cuando el cliente pague ${fmtMonto(r.montoReserva)} u otro valor acordado, usa «Registrar pago». La solicitud no registra ningún pago.`, responsable: 'Vendedor' }
    }
    if (r.estado === 'solicitada') {
      return {
        accion: 'verificar', titulo: 'Finanzas verifica el pago',
        detalle: c.receptorDefinido === false ? 'Pago registrado. Antes, Configuración debe definir quién recibe los pagos: sin ese dato Finanzas no puede verificar.' : 'Pago registrado. Finanzas confirma en el banco el monto que realmente ingresó.',
        responsable: 'Finanzas',
      }
    }
    if (r.estado === 'pago_verificado') return { accion: 'aprobar', titulo: 'Gerencia aprueba la reserva', detalle: 'Al aprobar, la unidad queda reservada.', responsable: 'Gerencia' }
    if (c.estadoContrato === 'firmado') return { accion: 'cobranza', titulo: 'Contrato firmado', detalle: 'La operación continúa en Cobranzas.', responsable: 'Finanzas' }
    if (c.estadoContrato === 'borrador') return { accion: 'firma', titulo: 'Legal prepara la firma', detalle: 'El contrato está en borrador en Ventas y contratos.', responsable: 'Legal' }
    return { accion: 'contrato', titulo: 'Legal prepara los documentos', detalle: 'La reserva está aprobada y la unidad, reservada.', responsable: 'Legal' }
  }
  if (!c.clienteId) return { accion: 'cliente', titulo: 'Elige o registra al cliente', detalle: 'Busca por nombre, teléfono, cédula o correo.', responsable: 'Vendedor' }
  if (!c.codigo) return { accion: 'unidad', titulo: 'Elige el departamento', detalle: 'Verás su precio, características y forma de pago.', responsable: 'Vendedor' }
  if (!c.cotizacion) return { accion: 'emitir', titulo: 'Emite la cotización', detalle: 'Revisa las condiciones y descarga el PDF para el cliente.', responsable: 'Vendedor' }
  if (r?.estado === 'anulada') return { accion: 'anulada', titulo: `La reserva ${r.codigo} se anuló`, detalle: 'Emite una cotización nueva para retomar la venta.', responsable: 'Vendedor' }
  if (c.cotizacion.estado === 'reemplazada' || c.cotizacion.estado === 'anulada') return { accion: 'reemitir', titulo: 'Esta versión ya no está vigente', detalle: 'Emite una versión nueva para solicitar la reserva.', responsable: 'Vendedor' }
  if (c.cotizacion.validaHasta < c.hoy) return { accion: 'reemitir', titulo: 'La cotización venció', detalle: 'Emite una nueva versión para solicitar la reserva.', responsable: 'Vendedor' }
  if (c.otraReserva) return { accion: 'unidad_ocupada', titulo: 'La unidad ya tiene una solicitud', detalle: `Está en trámite con ${c.otraReserva.codigo}. Elige otro departamento.`, responsable: 'Vendedor' }
  if (c.estadoUnidad === 'por_confirmar') return { accion: 'confirmar_unidad', titulo: 'Confirmar la disponibilidad', detalle: 'La cotización es válida, pero la reserva exige que la unidad esté confirmada en Inventario.', responsable: 'Gerencia' }
  if (c.estadoUnidad && c.estadoUnidad !== 'disponible' && c.estadoUnidad !== 'bloqueado') return { accion: 'unidad_ocupada', titulo: 'La unidad ya no está disponible', detalle: 'Elige otro departamento.', responsable: 'Vendedor' }
  return { accion: 'solicitar', titulo: 'Solicita la reserva', detalle: 'Confirma el monto acordado. Solicitar no aprueba la reserva ni bloquea la unidad.', responsable: 'Vendedor' }
}

export interface OperacionAbierta {
  cotizacion: Cotizacion
  reserva: Reserva | null
  paso: string
}

/** Ventas por retomar: la última cotización vigente de cada cliente y unidad, y las reservas en curso. */
export function operacionesAbiertas(cotizaciones: Cotizacion[], reservas: Reserva[], firmadas: Set<string>, hoy: string): OperacionAbierta[] {
  const vistas = new Set<string>()
  const salida: OperacionAbierta[] = []
  const ordenadas = [...cotizaciones].sort((a, b) => (a.creadaEn < b.creadaEn ? 1 : -1))
  for (const q of ordenadas) {
    const clave = `${q.clienteId}|${q.unidad.codigo}`
    const reserva = reservas.find((r) => r.cotizacionId === q.id && r.estado !== 'anulada') ?? null
    if (reserva && firmadas.has(reserva.id)) { vistas.add(clave); continue }
    if (reserva) {
      vistas.add(clave)
      const paso = reserva.estado === 'solicitada' ? (reserva.comprobante ? 'Pago por verificar' : 'Esperando el pago') : reserva.estado === 'pago_verificado' ? 'Por aprobar' : 'Reserva aprobada'
      salida.push({ cotizacion: q, reserva, paso })
      continue
    }
    if (vistas.has(clave) || !q.clienteId || q.validaHasta < hoy || !(q.estado === 'emitida' || q.estado === 'aceptada')) continue
    vistas.add(clave)
    salida.push({ cotizacion: q, reserva: null, paso: 'Por solicitar reserva' })
  }
  return salida
}
