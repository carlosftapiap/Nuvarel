import { describe, expect, it } from 'vitest'
import { calcularTablero, type ContratoFila, type CuotaFila, type PagoFila } from '../tablero'

const HOY = '2026-10-29'
const contrato = (o: Partial<ContratoFila> = {}): ContratoFila => ({ id: 'c1', codigo: 'CON-1', clientId: 'k1', cliente: 'Ana', unidad: 'E1-PB-A2', edificio: 1, responsable: 'Vera', estado: 'firmado', precio: 10000, ...o })
const cuotas = (id = 'c1'): CuotaFila[] => [
  { contratoId: id, numero: 0, concepto: 'Reserva', vencimiento: '2026-08-01', vencimientoOriginal: null, monto: 500 },
  { contratoId: id, numero: 1, concepto: 'Firma', vencimiento: '2026-09-01', vencimientoOriginal: null, monto: 100 },
  { contratoId: id, numero: 2, concepto: 'Cuota 1', vencimiento: '2026-10-01', vencimientoOriginal: null, monto: 700 },
  { contratoId: id, numero: 3, concepto: 'Cuota 2', vencimiento: '2026-11-03', vencimientoOriginal: null, monto: 700 },
  { contratoId: id, numero: 4, concepto: 'Saldo contra entrega (80%)', vencimiento: null, vencimientoOriginal: null, monto: 8000 },
]
const pago = (monto: number, estado: PagoFila['estado'] = 'verificado', id = 'p1'): PagoFila => ({ id, contratoId: 'c1', monto, fecha: '2026-08-01', referencia: id, estado, registradoPor: 'u', registradoEn: '2026-08-01T00:00:00Z', comprobante: null, motivo: null })

describe('tablero de cobranza del 20%', () => {
  it('separa la entrada de Nuvarel del desembolso bancario esperado (80%)', () => {
    const t = calcularTablero([contrato()], cuotas(), [pago(500)], HOY)
    expect(t.pactado).toBe(2000)
    expect(t.cobrado).toBe(500)
    expect(t.saldo).toBe(1500)
    expect(t.desembolsoEsperado).toBe(8000)
  })

  it('por vencer y vencido forman parte del saldo, no se suman como deuda adicional', () => {
    const t = calcularTablero([contrato()], cuotas(), [pago(500)], HOY)
    expect(t.vencido).toBe(800) // firma 100 (58 días) + cuota 1 700 (28 días)
    expect(t.porVencer).toBe(700) // cuota 2 vence en 5 días
    expect(t.vencido + t.porVencer).toBeLessThanOrEqual(t.saldo)
  })

  it('clasifica la mora por antigüedad', () => {
    const t = calcularTablero([contrato()], cuotas(), [pago(500)], HOY)
    expect(t.mora['16-30']).toBe(700)
    expect(t.mora['31-60']).toBe(100)
    expect(t.mora['1-7']).toBe(0)
  })

  it('un pago parcial deja la cuota con saldo y la marca como parcial', () => {
    const t = calcularTablero([contrato()], cuotas(), [pago(900)], HOY)
    const c1 = t.contratos[0].cuotas.find((q) => q.numero === 2)!
    expect(c1).toMatchObject({ pagado: 300, saldo: 400, parcial: true, situacion: 'vencida' })
  })

  it('antes de firmar nada es exigible: solo se informa la reserva recibida', () => {
    const t = calcularTablero([contrato({ estado: 'borrador' })], cuotas(), [pago(500)], HOY)
    expect(t.saldo).toBe(0)
    expect(t.vencido).toBe(0)
    expect(t.reservasPreFirma).toBe(500)
    expect(t.contratosPreFirma).toBe(1)
  })

  it('comprobantes registrados sin verificar no cuentan como cobrado', () => {
    const t = calcularTablero([contrato()], cuotas(), [pago(500), pago(700, 'registrado', 'p2')], HOY)
    expect(t.cobrado).toBe(500)
    expect(t.comprobantesPendientes).toBe(1)
  })
})
