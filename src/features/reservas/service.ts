import { assertCan, puedeVerDe } from '@/app/permissions'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { marcarClienteReserva, liberarClienteReserva } from '@/features/clientes/service'
import type { ClientesState } from '@/features/clientes/model'
import { ESTADOS } from '@/features/inventario/estados'
import { liberarReserva, marcarReservada, puedeReservarse } from '@/features/inventario/service'
import type { Actor, InventoryState } from '@/features/inventario/types'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Reserva, ReservasState } from './model'

export class ReservaError extends Error {
  constructor(m: string) {
    super(m)
    this.name = 'ReservaError'
  }
}

/** Estado conjunto: una operación cambia inventario, clientes y reservas a la vez o no cambia nada. */
export interface Estado {
  inv: InventoryState
  res: ReservasState
  clientes: ClientesState
}

export interface ConfirmarInput {
  comprobante: string
  montoRecibido: number
}

let seq = 0
const nowIso = () => new Date().toISOString()
const newId = () => `res-${Date.now().toString(36)}-${(seq++).toString(36)}`
const usd = (v: number) => v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const activa = (r: Reserva) => r.estado !== 'anulada'
const hist = (actor: Actor, texto: string) => ({ fecha: nowIso(), usuario: actor.nombre, rol: actor.rol, texto })

export const estadoInicialReservas = (): ReservasState => ({ version: 1, reservas: [] })

/** Cada usuario ve las reservas de su alcance: las que creó o las de clientes que le corresponden. */
export function reservasVisibles(reservas: Reserva[], actor: Actor) {
  return reservas.filter((r) => puedeVerDe(actor, [r.creadaPor.id, r.asesorId]))
}

export function siguienteCodigo(reservas: Reserva[], fecha: string) {
  const prefijo = `RES-${fecha.slice(0, 4)}-`
  const max = reservas
    .filter((r) => r.codigo.startsWith(prefijo))
    .reduce((m, r) => Math.max(m, Number(r.codigo.slice(prefijo.length)) || 0), 0)
  return `${prefijo}${String(max + 1).padStart(4, '0')}`
}

function buscar(res: ReservasState, id: string) {
  const r = res.reservas.find((x) => x.id === id)
  if (!r) throw new ReservaError('La reserva no existe.')
  return r
}

/** Solicitud: no bloquea la unidad. Valida que la cotización esté vigente y la unidad sea reservable. */
export function solicitarReserva(e: Estado, cot: Cotizacion, actor: Actor): Estado {
  assertCan(actor, 'reservas.solicitar')
  if (!cot.clienteId) throw new ReservaError('La cotización no está vinculada a un cliente registrado. Vincúlala desde Cotizaciones.')
  const hoy = hoyGuayaquil()
  if (cot.validaHasta < hoy) throw new ReservaError(`La cotización ${cot.numero} venció el ${cot.validaHasta}. Emite una nueva cotización.`)
  const u = e.inv.units.find((x) => x.codigo === cot.unidad.codigo)
  if (!u) throw new ReservaError('La unidad de la cotización ya no existe en el inventario.')
  if (u.estado === 'por_confirmar') throw new ReservaError(`La unidad ${u.dpt} aún no tiene disponibilidad confirmada. Confírmala en Inventario antes de reservar.`)
  if (!puedeReservarse(u)) throw new ReservaError(`La unidad ${u.dpt} está ${ESTADOS[u.estado].label.toLowerCase()} y no puede reservarse.`)
  const activas = e.res.reservas.filter((r) => r.unidad === u.codigo && activa(r))
  if (activas.length) throw new ReservaError(`La unidad ${u.dpt} ya tiene la reserva ${activas[0].codigo} (${activas[0].estado}).`)

  const cliente = e.clientes.clientes.find((c) => c.id === cot.clienteId)
  const r: Reserva = {
    id: newId(),
    codigo: siguienteCodigo(e.res.reservas, hoy),
    clienteId: cot.clienteId,
    clienteNombre: cliente?.nombre ?? cot.cliente.nombre,
    asesorId: cliente?.asesorId ?? cot.creadaPor.id,
    unidad: u.codigo,
    cotizacionId: cot.id,
    cotizacionNumero: cot.numero,
    vigenciaHasta: cot.validaHasta,
    precioAcordado: cot.plan.precioFinal,
    descuentoPct: cot.plan.descuentoPct,
    reservaPct: cot.plan.reservaPct,
    montoReserva: cot.plan.reserva,
    meses: cot.plan.meses,
    cuotaMensual: cot.plan.cuotaMensual,
    estado: 'solicitada',
    comprobante: null,
    montoRecibido: null,
    fechaConfirmacion: null,
    motivoAnulacion: '',
    creadaPor: { id: actor.id, nombre: actor.nombre, rol: actor.rol },
    creadaEn: nowIso(),
    historial: [hist(actor, `Solicitud desde ${cot.numero} · reserva USD ${usd(cot.plan.reserva)} · precio USD ${usd(cot.plan.precioFinal)}`)],
  }
  return { ...e, res: { ...e.res, reservas: [r, ...e.res.reservas] } }
}

/**
 * Confirmación: verifica pago, vigencia y disponibilidad; bloquea la unidad y avanza al cliente a Reserva.
 * Todo ocurre en una sola operación: si algo falla, no cambia nada.
 */
export function confirmarReserva(e: Estado, id: string, input: ConfirmarInput, actor: Actor): Estado {
  // Verificar el pago y confirmar son permisos separados; ambos son necesarios.
  assertCan(actor, 'reservas.verificar_pago')
  assertCan(actor, 'reservas.confirmar')
  const r = buscar(e.res, id)
  if (r.estado !== 'solicitada') throw new ReservaError(`La reserva ${r.codigo} ya está ${r.estado}.`)
  const comprobante = input.comprobante.trim()
  if (comprobante.length < 3) throw new ReservaError('Registra el comprobante de pago (número de transferencia o recibo).')
  if (!Number.isFinite(input.montoRecibido) || input.montoRecibido + 0.005 < r.montoReserva) {
    throw new ReservaError(`El monto recibido (USD ${usd(Number.isFinite(input.montoRecibido) ? input.montoRecibido : 0)}) es menor a la reserva acordada (USD ${usd(r.montoReserva)}).`)
  }
  const hoy = hoyGuayaquil()
  if (r.vigenciaHasta < hoy) throw new ReservaError(`La cotización ${r.cotizacionNumero} venció el ${r.vigenciaHasta}. No se puede confirmar.`)
  const otra = e.res.reservas.find((x) => x.id !== id && x.unidad === r.unidad && x.estado === 'confirmada')
  if (otra) throw new ReservaError(`La unidad ya está reservada con ${otra.codigo}.`)

  const inv = marcarReservada(e.inv, r.unidad, r.codigo, actor)
  const clientes = marcarClienteReserva(e.clientes, r.clienteId, r.codigo, actor)
  const reservas = e.res.reservas.map((x) => (x.id !== id ? x : {
    ...x,
    estado: 'confirmada' as const,
    comprobante,
    montoRecibido: input.montoRecibido,
    fechaConfirmacion: hoy,
    historial: [hist(actor, `Reserva confirmada · comprobante ${comprobante} · recibido USD ${usd(input.montoRecibido)}`), ...x.historial],
  }))
  return { inv, clientes, res: { ...e.res, reservas } }
}

/** Anulación: una solicitud solo se cierra; una confirmada libera la unidad y devuelve al cliente a Negociación. */
export function anularReserva(e: Estado, id: string, motivo: string, actor: Actor): Estado {
  assertCan(actor, 'reservas.anular')
  const r = buscar(e.res, id)
  if (r.estado === 'anulada') throw new ReservaError(`La reserva ${r.codigo} ya está anulada.`)
  if (motivo.trim().length < 5) throw new ReservaError('Indica el motivo de la anulación (mínimo 5 caracteres).')
  let inv = e.inv
  let clientes = e.clientes
  if (r.estado === 'confirmada') {
    inv = liberarReserva(e.inv, r.unidad, r.codigo, `Reserva ${r.codigo} anulada: ${motivo.trim()}`, actor)
    clientes = liberarClienteReserva(e.clientes, r.clienteId, r.codigo, actor)
  }
  const reservas = e.res.reservas.map((x) => (x.id !== id ? x : {
    ...x,
    estado: 'anulada' as const,
    motivoAnulacion: motivo.trim(),
    historial: [hist(actor, `Anulada: ${motivo.trim()}`), ...x.historial],
  }))
  return { inv, clientes, res: { ...e.res, reservas } }
}
