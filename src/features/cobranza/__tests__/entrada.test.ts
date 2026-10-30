import { describe, expect, it } from 'vitest'
import { calcularEntrada } from '../entrada'

describe('entrada del 20% a favor de Nuvarel', () => {
  it('ejemplo acordado: USD 170.000 con reserva de 1.000', () => {
    const e = calcularEntrada({ precioFinal: 170000, reserva: 1000, meses: 30 })
    expect(e.entradaTotal).toBe(34000)
    expect(e.acumuladoFirma).toBe(10200)
    expect(e.pagoFirma).toBe(9200)
    expect(e.saldoCuotas).toBe(23800)
    expect(e.saldoEntrega).toBe(136000)
  })

  it('la reserva se acredita al 6%: la suma de reserva y firma nunca supera el acumulado', () => {
    const e = calcularEntrada({ precioFinal: 170000, reserva: 1000, meses: 30 })
    expect(e.partidas[0].monto + e.partidas[1].monto).toBe(e.acumuladoFirma)
  })

  it('la última cuota absorbe los centavos y el total cuadra con el precio', () => {
    const e = calcularEntrada({ precioFinal: 170001.37, reserva: 1000, meses: 42 })
    const total = e.partidas.reduce((t, p) => t + p.monto, 0)
    expect(Math.round(total * 100) / 100).toBe(170001.37)
    expect(e.partidas.filter((p) => p.tipo === 'cuota')).toHaveLength(42)
  })

  it('rechaza una reserva mayor al 6% y datos inválidos', () => {
    expect(() => calcularEntrada({ precioFinal: 170000, reserva: 11000, meses: 30 })).toThrow(/no puede superar el 6%/)
    expect(() => calcularEntrada({ precioFinal: 170000, reserva: 0, meses: 30 })).toThrow(/mayor a cero/)
    expect(() => calcularEntrada({ precioFinal: 0, reserva: 1000, meses: 30 })).toThrow(/precio final/)
    expect(() => calcularEntrada({ precioFinal: 170000, reserva: 1000, meses: 0 })).toThrow(/meses/)
  })

  it('una reserva igual al 6% deja pago a la firma en cero', () => {
    const e = calcularEntrada({ precioFinal: 170000, reserva: 10200, meses: 30 })
    expect(e.pagoFirma).toBe(0)
  })
})
