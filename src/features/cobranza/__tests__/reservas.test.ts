import { describe, expect, it } from 'vitest'
import type { Reserva } from '@/features/reservas/model'
import { filaReserva, indicadoresReservas } from '../reservas'
import type { PagoFila } from '../tablero'

const res = (id: string, estado: Reserva['estado'], extra: Partial<Reserva> = {}) => ({ id, codigo: id, estado, montoReserva: 600, comprobante: null, montoRecibido: null, ...extra }) as Reserva
const pago = (id: string, contratoId: string, monto: number, estado: PagoFila['estado']) => ({ id, contratoId, monto, estado }) as PagoFila
const fila = (r: Reserva, con: string[] = []) => filaReserva(r, new Set(con))

describe('estado de cada reserva en Cobranzas', () => {
  it('distingue pendiente, reportada, verificada, aprobada, con contrato y anulada', () => {
    expect(fila(res('a', 'solicitada'))).toMatchObject({ estado: 'pendiente_pago', acordado: 600, pagado: 0, saldo: 600 })
    expect(fila(res('b', 'solicitada', { comprobante: 'T' }))).toMatchObject({ estado: 'por_verificar', pagado: 0, saldo: 600 })
    expect(fila(res('c', 'pago_verificado', { comprobante: 'T', montoRecibido: 600 }))).toMatchObject({ estado: 'por_aprobar', pagado: 600, saldo: 0 })
    expect(fila(res('d', 'confirmada', { montoRecibido: 700 }))).toMatchObject({ estado: 'aprobada', pagado: 700, saldo: 0 })
    expect(fila(res('e', 'confirmada', { montoRecibido: 600 }), ['e']).estado).toBe('en_contrato')
    expect(fila(res('f', 'anulada'))).toMatchObject({ estado: 'anulada', saldo: 0 })
  })
})

describe('indicadores', () => {
  const filas = [
    fila(res('a', 'solicitada')),
    fila(res('b', 'solicitada', { montoReserva: 500 })),
    fila(res('c', 'solicitada', { comprobante: 'T', montoReserva: 800 })),
    fila(res('d', 'pago_verificado', { comprobante: 'T', montoRecibido: 900 })),
    fila(res('e', 'confirmada', { montoRecibido: 1000 })),
    fila(res('f', 'confirmada', { montoRecibido: 1500 }), ['f']),
    fila(res('g', 'anulada', { montoRecibido: 9999 })),
  ]
  const pagos = [
    pago('p1', 'k1', 1500, 'verificado'), // reserva f, copiada al contrato
    pago('p2', 'k1', 300, 'registrado'),
    pago('p3', 'k1', 111, 'rechazado'),
    pago('p4', 'k1', 222, 'anulado'),
    pago('p5', 'k2', 444, 'verificado'), // contrato anulado
    pago('p6', 'k2', 555, 'registrado'),
  ]
  const r = indicadoresReservas(filas, pagos, new Set(['k1']))

  it('las solicitudes pendientes suman lo acordado', () => {
    expect(r.pendientes).toEqual({ cantidad: 2, acordado: 1100 })
  })
  it('por verificar reúne reservas reportadas y pagos registrados', () => {
    expect(r.porVerificar).toEqual({ cantidad: 2, deReservas: 1, monto: 1100 })
  })
  it('la devolución autorizada reduce el neto; la retención y lo no autorizado, no', () => {
    const c = indicadoresReservas(filas, pagos, new Set(['k1']), [
      { tipo: 'devolucion', monto: 5000, estado: 'autorizado' }, { tipo: 'retencion', monto: 1000, estado: 'autorizado' },
      { tipo: 'devolucion', monto: 77, estado: 'solicitado' }, { tipo: 'devolucion', monto: 88, estado: 'rechazado' },
    ])
    expect(c).toMatchObject({ bruto: 13399, devuelto: 5000, retenido: 1000, recaudado: 8399 })
  })
  it('una vencida se señala, sin cambiar su estado', () => {
    const f = filaReserva(res('z', 'solicitada', { vigenciaHasta: '2026-01-01' }), new Set(), '2026-02-01')
    expect(f).toMatchObject({ vencida: true, estado: 'pendiente_pago' })
    expect(filaReserva(res('z', 'anulada', { vigenciaHasta: '2026-01-01' }), new Set(), '2026-02-01').vencida).toBe(false)
    expect(indicadoresReservas([f], [], new Set()).vencidas).toBe(1)
  })
  it('recaudado cuenta lo confirmado, también de una anulada, sin duplicar la reserva que pasó a contrato', () => {
    expect(r.recaudado).toBe(900 + 1000 + 1500 + 9999)
  })
})
