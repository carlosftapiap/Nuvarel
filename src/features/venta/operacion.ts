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

export type Accion = 'cliente' | 'unidad' | 'plan' | 'emitir' | 'reemitir' | 'unidad_ocupada' | 'solicitar' | 'identificacion' | 'registrar_pago' | 'verificar' | 'aprobar' | 'contrato' | 'enviar_cumplimiento' | 'cumplimiento' | 'expediente' | 'firma' | 'cobranza' | 'anulada'

/** Revisión de Cumplimiento del contrato: la última registrada. */
export type EstadoCumplimiento = 'pendiente' | 'observado' | 'aprobado' | 'rechazado'

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
  /** Plan de pagos confirmado en Financiamiento, antes de emitir. */
  planConfirmado?: boolean
  cumplimiento?: EstadoCumplimiento | null
  /** Último comprobante de la reserva rechazado por Finanzas. */
  rechazoPago?: { motivo: string; fecha: string | null } | null
  /** Motivos por los que la reserva necesita autorización de Gerencia (descuento, precio distinto del oficial, etc.). */
  excepciones?: string[]
  /** Cédula, pasaporte o RUC válido: sin ella, el cliente es prospecto y no puede reservar. */
  identificacionCompleta?: boolean
}

export function siguientePaso(c: ContextoOperacion): Paso {
  const r = c.reserva
  if (r && r.estado !== 'anulada') {
    if (r.estado === 'solicitada' && !r.comprobante && c.rechazoPago) {
      return { accion: 'registrar_pago', titulo: 'Finanzas rechazó el pago: registra un comprobante nuevo', detalle: `Motivo: ${c.rechazoPago.motivo}. Corrige lo indicado y usa «Registrar pago» con el comprobante correcto; vuelve a Finanzas para su revisión.`, responsable: 'Vendedor' }
    }
    if (r.estado === 'solicitada' && !r.comprobante) {
      return { accion: 'registrar_pago', titulo: 'Esperar el pago de la reserva', detalle: `Cuando el cliente pague ${fmtMonto(r.montoReserva)} u otro valor acordado, usa «Registrar pago». La solicitud no registra ningún pago.`, responsable: 'Vendedor' }
    }
    if (r.estado === 'solicitada') {
      return {
        accion: 'verificar', titulo: 'Finanzas verifica el pago',
        detalle: c.receptorDefinido === false ? 'Pago registrado. Antes, Configuración debe definir quién recibe los pagos: sin ese dato Finanzas no puede verificar.' : 'Pago registrado. Finanzas confirma el ingreso en el banco; con condiciones normales, la reserva queda confirmada en ese momento.',
        responsable: 'Finanzas',
      }
    }
    if (r.estado === 'pago_verificado') return { accion: 'aprobar', titulo: 'Gerencia autoriza la excepción', detalle: `Pago verificado. ${c.excepciones?.length ? `Motivo: ${c.excepciones.join('; ')}.` : 'La reserva tiene condiciones especiales.'} Al autorizarla, la unidad queda reservada.`, responsable: 'Gerencia' }
    if (c.estadoContrato === 'firmado') return { accion: 'cobranza', titulo: 'Venta formalizada', detalle: 'La unidad quedó vendida. Finanzas sigue las cuotas en Cobranzas y tu comisión aparece en Comisiones.', responsable: 'Finanzas' }
    if (c.estadoContrato === 'borrador') {
      if (c.cumplimiento === 'aprobado') return { accion: 'firma', titulo: 'Legal formaliza la firma', detalle: 'Cumplimiento aprobó el expediente. Al firmarse el contrato, la unidad queda vendida.', responsable: 'Legal' }
      if (c.cumplimiento === 'observado') return { accion: 'expediente', titulo: 'Cumplimiento pidió correcciones', detalle: 'Abre la ficha del cliente, revisa las observaciones en «Documentos del expediente» y reemplaza los documentos observados.', responsable: 'Vendedor' }
      if (c.cumplimiento === 'pendiente') return { accion: 'cumplimiento', titulo: 'Cumplimiento revisa el expediente', detalle: 'Si pide correcciones, aquí verás qué documentos completar.', responsable: 'Cumplimiento' }
      if (c.cumplimiento === 'rechazado') return { accion: 'cumplimiento', titulo: 'Cumplimiento rechazó el expediente', detalle: 'Legal y Gerencia definen cómo continuar. No se puede firmar.', responsable: 'Cumplimiento' }
      return { accion: 'enviar_cumplimiento', titulo: 'Legal envía el expediente a Cumplimiento', detalle: 'Mientras tanto, carga los documentos del cliente en su ficha («Documentos del expediente»).', responsable: 'Legal' }
    }
    return { accion: 'contrato', titulo: 'Legal genera el contrato', detalle: 'La reserva está aprobada y la unidad, reservada. Ten listos los documentos del cliente en su ficha.', responsable: 'Legal' }
  }
  if (!c.clienteId) return { accion: 'cliente', titulo: 'Elige o registra al cliente', detalle: 'Busca por nombre, teléfono, cédula o correo.', responsable: 'Vendedor' }
  if (!c.codigo) return { accion: 'unidad', titulo: 'Elige el departamento', detalle: 'Verás su precio, características y forma de pago.', responsable: 'Vendedor' }
  if (!c.cotizacion && c.planConfirmado === false) return { accion: 'plan', titulo: 'Configura el plan de pagos', detalle: 'Revisa reserva, cuotas y descuento, y pulsa «Usar este plan y continuar cotización».', responsable: 'Vendedor' }
  if (!c.cotizacion) return { accion: 'emitir', titulo: 'Emite la cotización', detalle: 'Revisa las condiciones y descarga el PDF para el cliente.', responsable: 'Vendedor' }
  if (r?.estado === 'anulada') return { accion: 'anulada', titulo: `La reserva ${r.codigo} se anuló`, detalle: 'Emite una cotización nueva para retomar la venta.', responsable: 'Vendedor' }
  if (c.cotizacion.estado === 'reemplazada' || c.cotizacion.estado === 'anulada') return { accion: 'reemitir', titulo: 'Esta versión ya no está vigente', detalle: 'Emite una versión nueva para solicitar la reserva.', responsable: 'Vendedor' }
  if (c.cotizacion.validaHasta < c.hoy) return { accion: 'reemitir', titulo: 'La cotización venció', detalle: 'Emite una nueva versión para solicitar la reserva.', responsable: 'Vendedor' }
  if (c.otraReserva) return { accion: 'unidad_ocupada', titulo: 'La unidad ya tiene una solicitud', detalle: `Está en trámite con ${c.otraReserva.codigo}. Elige otro departamento.`, responsable: 'Vendedor' }
  if (c.estadoUnidad && c.estadoUnidad !== 'disponible') return { accion: 'unidad_ocupada', titulo: 'La unidad ya no está disponible', detalle: 'Elige otro departamento.', responsable: 'Vendedor' }
  if (c.identificacionCompleta === false) return { accion: 'identificacion', titulo: 'Completa la identificación del cliente', detalle: 'Para solicitar la reserva hace falta su cédula, pasaporte o RUC. Agrégalo en su ficha; la cotización se conserva.', responsable: 'Vendedor' }
  return { accion: 'solicitar', titulo: 'Solicita la reserva', detalle: 'Confirma el monto acordado. La unidad se reserva cuando Finanzas verifica el pago.', responsable: 'Vendedor' }
}

/**
 * Las cinco etapas que ve el vendedor. Verificación, autorizaciones, contrato, Cumplimiento, firma y cobranza siguen ocurriendo
 * dentro de Reserva y Venta, cada una en la bandeja de su responsable; la guía solo dice a quién se espera.
 */
export const PASOS_VENTA = [
  { clave: 'cliente', titulo: 'Cliente', quien: 'Elegir o registrar' },
  { clave: 'unidad', titulo: 'Departamento', quien: 'Uno disponible' },
  { clave: 'cotizacion', titulo: 'Cotización', quien: 'Plan de pagos y PDF' },
  { clave: 'reserva', titulo: 'Reserva', quien: 'Solicitud y pago' },
  { clave: 'venta', titulo: 'Venta', quien: 'Contrato y cierre' },
] as const

export type ClavePaso = (typeof PASOS_VENTA)[number]['clave']

const PASO_DE_ACCION: Record<Accion, ClavePaso> = {
  cliente: 'cliente', unidad: 'unidad', unidad_ocupada: 'unidad', plan: 'cotizacion', emitir: 'cotizacion', reemitir: 'cotizacion', anulada: 'cotizacion',
  solicitar: 'reserva', identificacion: 'reserva', registrar_pago: 'reserva', verificar: 'reserva', aprobar: 'reserva',
  contrato: 'venta', enviar_cumplimiento: 'venta', cumplimiento: 'venta', expediente: 'venta', firma: 'venta', cobranza: 'venta',
}

/** Índice del paso en curso: los anteriores están terminados y los siguientes, pendientes. */
export const pasoActual = (accion: Accion) => PASOS_VENTA.findIndex((p) => p.clave === PASO_DE_ACCION[accion])

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
      const paso = reserva.estado === 'solicitada' ? (reserva.comprobante ? 'Pago por verificar' : 'Esperando el pago') : reserva.estado === 'pago_verificado' ? 'Excepción por autorizar' : 'Reserva confirmada'
      salida.push({ cotizacion: q, reserva, paso })
      continue
    }
    if (vistas.has(clave) || !q.clienteId || q.validaHasta < hoy || !(q.estado === 'emitida' || q.estado === 'aceptada')) continue
    vistas.add(clave)
    salida.push({ cotizacion: q, reserva: null, paso: 'Por solicitar reserva' })
  }
  return salida
}
