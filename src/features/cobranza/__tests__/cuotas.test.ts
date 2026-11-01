import { describe, expect, it } from 'vitest'
import { aplicacionPago, calcularTablero, filasCuotas, type ContratoFila, type CuotaFila, type PagoFila } from '../tablero'

const c = (id: string, estado: ContratoFila['estado'] = 'firmado'): ContratoFila => ({ id, codigo: `CON-${id}`, clientId: id, cliente: `Cliente ${id}`, unidad: 'E1-PB-A1', edificio: 1, responsable: 'Asesor', estado, precio: 10000 })
const q = (contratoId: string, numero: number, concepto: string, vencimiento: string | null, monto: number): CuotaFila => ({ contratoId, numero, concepto, vencimiento, vencimientoOriginal: null, monto })
const p = (contratoId: string, monto: number, estado: PagoFila['estado']): PagoFila => ({ id: `${contratoId}-${monto}`, contratoId, monto, fecha: '2026-10-01', referencia: `R${monto}`, estado, registradoPor: 'u', registradoEn: '2026-10-01', comprobante: null, motivo: null })

const HOY = '2026-11-01'
const CUOTAS = [
  q('a', 0, 'Reserva', '2026-09-01', 500), q('a', 1, 'Pago a la firma', '2026-09-15', 100), q('a', 2, 'Cuota 1 de 2', '2026-10-15', 700),
  q('a', 3, 'Cuota extraordinaria', '2026-10-15', 300), q('a', 4, 'Cuota 2 de 2', '2026-11-05', 400), q('a', 5, 'Saldo contra entrega 80%', null, 8000),
]

describe('tabla de cuotas', () => {
  const t = calcularTablero([c('a'), c('b', 'borrador'), c('z', 'anulado')], [...CUOTAS, q('b', 1, 'Pago a la firma', '2026-10-01', 100), q('z', 1, 'Pago a la firma', '2026-10-01', 100)], [p('a', 600, 'verificado')], HOY)

  it('incluye ordinarias y extraordinarias, nunca el 80 % bancario', () => {
    const conceptos = filasCuotas(t.contratos, 'todas').filter((f) => f.r.contrato.id === 'a').map((f) => f.q.concepto)
    expect(conceptos).toContain('Cuota extraordinaria')
    expect(conceptos).not.toContain('Saldo contra entrega 80%')
  })

  it('un contrato en borrador solo se ve al pedir todas; el anulado, nunca', () => {
    expect(filasCuotas(t.contratos, 'pendientes').every((f) => f.r.contrato.id === 'a')).toBe(true)
    expect(filasCuotas(t.contratos, 'todas').some((f) => f.r.contrato.id === 'b')).toBe(true)
    expect(filasCuotas(t.contratos, 'todas').some((f) => f.r.contrato.id === 'z')).toBe(false)
  })

  it('filtra vencidas, próximas y pagadas, con los totales del resumen', () => {
    expect(filasCuotas(t.contratos, 'vencidas').map((f) => f.q.concepto)).toEqual(['Cuota 1 de 2', 'Cuota extraordinaria'])
    expect(filasCuotas(t.contratos, 'proximas').map((f) => f.q.concepto)).toEqual(['Cuota 2 de 2'])
    expect(filasCuotas(t.contratos, 'pagadas').map((f) => f.q.concepto)).toEqual(['Reserva', 'Pago a la firma'])
    expect(t.vencido).toBe(1000)
    expect(t.porVencer).toBe(400)
    expect(t.saldo).toBe(1400)
  })

  it('un pago por verificar no cuenta como cobrado; uno anulado o rechazado tampoco', () => {
    const conPendiente = calcularTablero([c('a')], CUOTAS, [p('a', 600, 'verificado'), p('a', 300, 'registrado'), p('a', 200, 'anulado'), p('a', 100, 'rechazado')], HOY)
    expect(conPendiente.cobrado).toBe(600)
    expect(conPendiente.saldo).toBe(1400)
    expect(conPendiente.comprobantesPendientes).toBe(1)
  })
})

describe('reparto de un pago', () => {
  const r = calcularTablero([c('a')], CUOTAS, [p('a', 600, 'verificado')], HOY).contratos[0]

  it('un pago parcial deja saldo en la cuota', () => {
    const a = aplicacionPago(r, 250)
    expect(a.cuotas.map((x) => x.concepto)).toEqual(['Cuota 1 de 2'])
    expect(a.parcial).toBe(450)
    expect(a.excedente).toBe(0)
  })

  it('un pago mayor cubre varias cuotas en orden', () => {
    const a = aplicacionPago(r, 1000)
    expect(a.cuotas.map((x) => x.concepto)).toEqual(['Cuota 1 de 2', 'Cuota extraordinaria'])
    expect(a.parcial).toBe(0)
  })

  it('avisa si supera el saldo de la entrada; no lo manda al 80 %', () => {
    const a = aplicacionPago(r, 1500)
    expect(a.excedente).toBe(100)
    expect(a.cuotas.some((x) => x.concepto.includes('80%'))).toBe(false)
  })
})
