import { describe, expect, it } from 'vitest'
import { calcularIngresos, esClienteDePrueba } from '../ingresos'
import type { PagoFila } from '../tablero'

type R = { id: string; codigo: string; estado: 'solicitada' | 'pago_verificado' | 'confirmada' | 'anulada'; montoRecibido: number | null; clienteNombre: string }
const reserva = (n: number, o: Partial<R> = {}): R => ({ id: `r${n}`, codigo: `RES-2026-000${n}`, estado: 'confirmada', montoRecibido: 500, clienteNombre: `Cliente ${n}`, ...o })
const pago = (o: Partial<PagoFila>): PagoFila => ({ id: crypto.randomUUID(), contratoId: 'k1', monto: 0, fecha: '2026-11-17', referencia: 'X', estado: 'verificado', registradoPor: 'f', registradoEn: '', comprobante: null, motivo: null, ...o })
const base = { pagos: [] as PagoFila[], contratos: [] as { id: string; cliente: string }[], movimientos: [] as never[], reservaDeContrato: new Map<string, string>() }

describe('dinero recibido sin duplicar', () => {
  it('cuatro reservas confirmadas de USD 500: reservas 2.000, cuotas 0, total 2.000', () => {
    const i = calcularIngresos({ ...base, reservas: [1, 3, 4, 5].map((n) => reserva(n)) })
    expect(i.reservas.total).toBe(2000)
    expect(i.cuotas.total).toBe(0)
    expect(i.recibido.total).toBe(2000)
  })

  it('las solicitadas y las anuladas sin dinero no cuentan', () => {
    const i = calcularIngresos({ ...base, reservas: [reserva(1), reserva(2, { estado: 'anulada', montoRecibido: null }), reserva(6, { estado: 'solicitada', montoRecibido: null })] })
    expect(i.recibido.total).toBe(500)
  })

  it('al pasar a contrato, la copia del pago de la reserva no se cuenta dos veces; las cuotas sí suman', () => {
    const i = calcularIngresos({
      ...base,
      reservas: [reserva(1)],
      contratos: [{ id: 'k1', cliente: 'Cliente 1' }],
      reservaDeContrato: new Map([['k1', 'r1']]),
      pagos: [pago({ monto: 500, motivo: 'Reserva RES-2026-0001' }), pago({ monto: 6683.74, motivo: 'Pago a la firma' }), pago({ monto: 493, motivo: null })],
    })
    expect(i.copiasExcluidas).toBe(1)
    expect(i.reservas.total).toBe(500)
    expect(i.cuotas.total).toBe(7176.74)
    expect(i.recibido.total).toBe(7676.74)
  })

  it('pagos reportados o rechazados no son dinero recibido', () => {
    const i = calcularIngresos({ ...base, reservas: [], contratos: [{ id: 'k1', cliente: 'C' }], pagos: [pago({ monto: 100, estado: 'registrado' }), pago({ monto: 200, estado: 'rechazado' }), pago({ monto: 300 })] })
    expect(i.cuotas.total).toBe(300)
  })

  it('una reserva anulada con dinero sigue como recibido; la devolución se muestra aparte, autorizada o pendiente', () => {
    const i = calcularIngresos({
      ...base,
      reservas: [reserva(1, { estado: 'anulada', montoRecibido: 500 })],
      movimientos: [{ tipo: 'devolucion', monto: 300, estado: 'autorizado', reservaId: 'r1' }, { tipo: 'devolucion', monto: 200, estado: 'solicitado', reservaId: 'r1' }] as never[],
    })
    expect(i.recibido.total).toBe(500)
    expect(i.devuelto).toBe(300)
    expect(i.pendienteDevolucion).toBe(200)
  })

  it('las operaciones de prueba se separan de las comerciales sin cambiar el total', () => {
    const i = calcularIngresos({ ...base, reservas: [reserva(1, { clienteNombre: 'PRUEBA QA VENTAS' }), reserva(2, { clienteNombre: 'Ana Real' })] })
    expect(i.reservas).toEqual({ total: 1000, comercial: 500, prueba: 500 })
    expect(esClienteDePrueba('Cliente prueba A103')).toBe(true)
    expect(esClienteDePrueba('Pruebas Andrade')).toBe(false)
  })
})
