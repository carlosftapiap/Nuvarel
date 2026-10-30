import { describe, expect, it } from 'vitest'
import { efectivaDesdeNominal, nominalDesdeEfectiva, simularHipoteca, tasaDelProducto, type ProductoHipotecario } from '../hipoteca'

// Producto de prueba: valores ficticios solo para verificar las fórmulas, no son tasas reales.
const producto = (o: Partial<ProductoHipotecario> = {}): ProductoHipotecario => ({
  id: 'p1', clave: 'PRUEBA', version: 1, entidad: 'Banco de prueba', producto: 'Hipotecario', tipoTasa: 'fija',
  tasaNominal: 10, tramos: [], plazoMinMeses: 12, plazoMaxMeses: 300, financiamientoMaxPct: null, montoMax: null,
  desgravamenPctMensual: null, incendioPctAnual: null, gastosFijos: null, avaluo: null, fuente: 'Prueba unitaria', fechaFuente: '2026-10-29', ...o,
})
const manual = { tasa: 10, tasaEs: 'nominal' as const, tipoTasa: 'fija' as const, desgravamenPctMensual: null, incendioPctAnual: null, gastosFijos: null, avaluo: null }

describe('tasas', () => {
  it('convierte nominal y efectiva anual', () => {
    expect(efectivaDesdeNominal(10)).toBeCloseTo(10.4713, 4)
    expect(nominalDesdeEfectiva(10.4713)).toBeCloseTo(10, 3)
  })

  it('elige la tasa por tramo de monto y plazo, y no inventa una tasa si ninguna aplica', () => {
    const p = producto({ tasaNominal: null, tramos: [
      { montoMin: null, montoMax: 100000, plazoMinMeses: null, plazoMaxMeses: 240, tasaNominal: 6 },
      { montoMin: 100000.01, montoMax: null, plazoMinMeses: null, plazoMaxMeses: 240, tasaNominal: 8 },
    ] })
    expect(tasaDelProducto(p, 90000, 240)).toBe(6)
    expect(tasaDelProducto(p, 136000, 240)).toBe(8)
    expect(() => tasaDelProducto(p, 90000, 300)).toThrow(/no hay una tasa registrada/)
  })
})

describe('amortización', () => {
  it('francesa: cuota constante conocida (100.000 al 10% en 240 meses = 965,02)', () => {
    const s = simularHipoteca({ precio: 125000, entrada: 25000, plazoMeses: 240, amortizacion: 'francesa', producto: producto() })
    expect(s.montoFinanciado).toBe(100000)
    expect(s.primeraCuota).toBeCloseTo(965.02, 2)
    expect(s.tabla.at(-1)!.saldo).toBe(0)
    expect(s.totalCapital).toBe(100000)
  })

  it('alemana: capital constante y primera cuota mayor', () => {
    const s = simularHipoteca({ precio: 125000, entrada: 25000, plazoMeses: 240, amortizacion: 'alemana', producto: producto() })
    expect(s.tabla[0].capital).toBeCloseTo(416.67, 2)
    expect(s.primeraCuota).toBeCloseTo(1250, 2)
    expect(s.ultimaCuota).toBeLessThan(s.primeraCuota)
    expect(s.tabla.at(-1)!.saldo).toBe(0)
  })

  it('cambiar tasa o plazo recalcula la cuota', () => {
    const a = simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 240, amortizacion: 'francesa', manual })
    const b = simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 180, amortizacion: 'francesa', manual })
    const c = simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 240, amortizacion: 'francesa', manual: { ...manual, tasa: 8 } })
    expect(b.primeraCuota).toBeGreaterThan(a.primeraCuota)
    expect(c.primeraCuota).toBeLessThan(a.primeraCuota)
    expect(a.escenario).toBe('manual')
  })

  it('tasa manual efectiva se convierte a nominal antes de calcular', () => {
    const s = simularHipoteca({ precio: 125000, entrada: 25000, plazoMeses: 240, amortizacion: 'francesa', manual: { ...manual, tasa: 10.4713, tasaEs: 'efectiva' } })
    expect(s.tasaNominal).toBeCloseTo(10, 3)
    expect(s.primeraCuota).toBeCloseTo(965.02, 1)
  })
})

describe('cobertura, seguros y gastos', () => {
  it('si el producto financia menos que el saldo, muestra el aporte propio adicional', () => {
    const s = simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 240, amortizacion: 'francesa', producto: producto({ financiamientoMaxPct: 70 }) })
    expect(s.montoSolicitado).toBe(136000)
    expect(s.montoFinanciado).toBe(119000)
    expect(s.aporteAdicional).toBe(17000)
  })

  it('seguros y gastos desconocidos se marcan como faltantes, no como gratuitos', () => {
    const s = simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 240, amortizacion: 'francesa', producto: producto() })
    expect(s.faltantes).toEqual(['Seguro de desgravamen', 'Seguro de incendio', 'Gastos legales y de trámite', 'Avalúo'])
    expect(s.tabla[0].desgravamen).toBeNull()
  })

  it('seguros conocidos se suman a la cuota y al costo total', () => {
    const s = simularHipoteca({ precio: 125000, entrada: 25000, plazoMeses: 240, amortizacion: 'francesa',
      producto: producto({ desgravamenPctMensual: 0.05, incendioPctAnual: 0.12, gastosFijos: 1500, avaluo: 300 }) })
    expect(s.tabla[0].desgravamen).toBe(50)
    expect(s.tabla[0].incendio).toBe(12.5)
    expect(s.primeraCuota).toBeCloseTo(965.02 + 50 + 12.5, 2)
    expect(s.faltantes).toEqual([])
    expect(s.costoTotal).toBeCloseTo(s.totalCapital + s.totalIntereses + s.totalSeguros + 1800, 2)
  })

  it('valida el plazo del producto', () => {
    expect(() => simularHipoteca({ precio: 170000, entrada: 34000, plazoMeses: 360, amortizacion: 'francesa', producto: producto() })).toThrow(/plazo debe estar entre 12 y 300/)
  })
})
