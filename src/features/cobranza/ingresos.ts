import { round2 } from '@/features/inventario/pricing'
import type { Reserva } from '@/features/reservas/model'
import type { Movimiento } from './comprobantes'
import type { ContratoFila, PagoFila } from './tablero'

/**
 * Dinero efectivamente recibido, sin duplicar: cada pago verificado cuenta una sola vez.
 * - Reservas: el ingreso verificado de cada reserva (montoRecibido). Sigue contando aunque la reserva se anule:
 *   lo que salga después es una devolución, que se muestra aparte.
 * - Cuotas: pagos verificados de contratos, excepto el pago que el contrato copia de su reserva al crearse
 *   (mismo contrato → reserva y motivo «Reserva RES-…»). Ese ya está en «Reservas».
 * - Operaciones de prueba: las de clientes identificados como prueba se informan aparte y no entran en lo comercial.
 */
export interface Monto { total: number; comercial: number; prueba: number }
export interface Ingresos {
  reservas: Monto
  cuotas: Monto
  recibido: Monto
  devuelto: number
  pendienteDevolucion: number
  /** Pagos de contrato que son copia de su reserva: se excluyen para no contarlos dos veces. */
  copiasExcluidas: number
}

/** Cliente de prueba: su nombre lo indica («PRUEBA», «prueba QA», «Cliente prueba»…). */
export const esClienteDePrueba = (nombre: string | null | undefined) => /\bprueba\b|\bqa\b|\btest\b/i.test(nombre ?? '')

const sumar = (xs: { monto: number; prueba: boolean }[]): Monto => {
  const total = round2(xs.reduce((t, x) => t + x.monto, 0))
  const prueba = round2(xs.filter((x) => x.prueba).reduce((t, x) => t + x.monto, 0))
  return { total, prueba, comercial: round2(total - prueba) }
}

/** Pago de un contrato que es la copia del ingreso de su reserva. */
export function esCopiaDeReserva(p: Pick<PagoFila, 'contratoId' | 'motivo'>, reservaDeContrato: Map<string, string>, reservas: Pick<Reserva, 'id' | 'codigo'>[]) {
  const reservaId = reservaDeContrato.get(p.contratoId)
  if (!reservaId) return false
  const r = reservas.find((x) => x.id === reservaId)
  return !!r && (p.motivo ?? '').trim() === `Reserva ${r.codigo}`
}

export function calcularIngresos(d: {
  reservas: Pick<Reserva, 'id' | 'codigo' | 'estado' | 'montoRecibido' | 'clienteNombre'>[] | null
  pagos: PagoFila[]
  contratos: Pick<ContratoFila, 'id' | 'cliente'>[]
  movimientos: Pick<Movimiento, 'tipo' | 'monto' | 'estado' | 'reservaId'>[]
  reservaDeContrato: Map<string, string>
}): Ingresos {
  const reservas = d.reservas ?? []
  const pruebaReserva = new Map(reservas.map((r) => [r.id, esClienteDePrueba(r.clienteNombre)]))
  const pruebaContrato = new Map(d.contratos.map((c) => [c.id, esClienteDePrueba(c.cliente)]))

  const deReservas = reservas
    .filter((r) => (r.montoRecibido ?? 0) > 0 && (r.estado === 'pago_verificado' || r.estado === 'confirmada' || r.estado === 'anulada'))
    .map((r) => ({ monto: Number(r.montoRecibido), prueba: pruebaReserva.get(r.id) ?? false }))

  const verificados = d.pagos.filter((p) => p.estado === 'verificado')
  const copias = verificados.filter((p) => esCopiaDeReserva(p, d.reservaDeContrato, reservas))
  const deCuotas = verificados.filter((p) => !copias.includes(p)).map((p) => ({ monto: p.monto, prueba: pruebaContrato.get(p.contratoId) ?? false }))

  const r = sumar(deReservas)
  const c = sumar(deCuotas)
  const devoluciones = d.movimientos.filter((m) => m.tipo === 'devolucion')
  return {
    reservas: r,
    cuotas: c,
    recibido: { total: round2(r.total + c.total), comercial: round2(r.comercial + c.comercial), prueba: round2(r.prueba + c.prueba) },
    devuelto: round2(devoluciones.filter((m) => m.estado === 'autorizado').reduce((t, m) => t + m.monto, 0)),
    pendienteDevolucion: round2(devoluciones.filter((m) => m.estado === 'solicitado').reduce((t, m) => t + m.monto, 0)),
    copiasExcluidas: copias.length,
  }
}
