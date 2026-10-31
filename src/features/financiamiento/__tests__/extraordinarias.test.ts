import { describe, expect, it } from 'vitest'
import { calcularEntrada } from '@/features/cobranza/entrada'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import { round2 } from '@/features/inventario/pricing'
import { filasAParam, filasDeParam, leerFilas } from '../components/CuotasExtraordinarias'
import { armarCronograma, cronogramaPorMes, generarPlan, repartirCuotas } from '../plan'

const s = createInitialState()
const e1 = s.units.find((u) => u.edificio === 1)!
const e2 = s.units.find((u) => u.edificio === 2)!
const suma = (xs: number[]) => round2(xs.reduce((t, x) => t + x, 0))

describe('cuotas extraordinarias', () => {
  it('sin extraordinarias, el plan no cambia', () => {
    const p = generarPlan(e1, s.params, { fechaReserva: '2026-11-10' })
    expect(p.extraordinarias).toBeUndefined()
    expect(p.cronograma.filter((c) => c.tipo === 'cuota')).toHaveLength(30)
    expect(p.cronograma.at(-1)!.n).toBe(31)
    expect(p.cronograma.at(-1)!.saldo).toBe(0)
  })

  it('recalcula las mensuales para sumar exactamente el 14 %, con los mismos plazos', () => {
    for (const [u, meses] of [[e1, 30], [e2, 42]] as const) {
      const base = generarPlan(u, s.params, { fechaReserva: '2026-11-10' })
      const p = generarPlan(u, s.params, { fechaReserva: '2026-11-10', extraordinarias: [{ mes: 12, monto: 1000.37 }, { mes: 6, monto: 2500 }] })
      expect(p.meses).toBe(meses)
      expect(p.cuotaMensual).toBeLessThan(base.cuotaMensual)
      expect(p.cuotasTotal).toBe(base.cuotasTotal)
      expect(p.reserva).toBe(base.reserva)
      expect(p.contraEntrega).toBe(base.contraEntrega)
      const entrada = p.cronograma.filter((c) => c.tipo === 'cuota' || c.tipo === 'extraordinaria')
      expect(suma(entrada.map((c) => c.monto))).toBe(p.cuotasTotal)
      expect(suma(p.cronograma.map((c) => c.monto))).toBe(p.precioFinal)
      expect(p.cronograma.at(-1)!.saldo).toBe(0)
      expect(p.extraordinarias!.map((x) => x.mes)).toEqual([6, 12])
    }
  })

  it('el cronograma muestra fecha, mensual, extraordinaria y total por mes', () => {
    const p = generarPlan(e1, s.params, { fechaReserva: '2026-01-31', extraordinarias: [{ mes: 2, monto: 1000 }, { mes: 2, monto: 500 }] })
    const filas = cronogramaPorMes(p, '2026-01-31')
    expect(filas).toHaveLength(30)
    expect(filas[1]).toEqual({ mes: 2, fecha: '2026-03-31', cuota: p.cuotaMensual, extraordinaria: 1500, total: round2(p.cuotaMensual + 1500) })
    expect(filas[0].extraordinaria).toBe(0)
    expect(suma(filas.map((f) => f.total))).toBe(p.cuotasTotal)
    expect(armarCronograma(p, '2026-01-31').filter((c) => c.tipo === 'extraordinaria')).toHaveLength(2)
  })

  it('rechaza negativos, ceros, meses fuera de plazo y montos que excedan el saldo del 14 %', () => {
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: -5 }])).toThrow(/mayor a cero/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: 0 }])).toThrow(/mayor a cero/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: 10.555 }])).toThrow(/dos decimales/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 31, monto: 5 }])).toThrow(/entre 1 y 30/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 0, monto: 5 }])).toThrow(/entre 1 y 30/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1.5, monto: 5 }])).toThrow(/entre 1 y 30/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: 10000 }])).toThrow(/dejar saldo/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: 6000 }, { mes: 2, monto: 5000 }])).toThrow(/dejar saldo/)
    expect(() => repartirCuotas(10000, 30, [{ mes: 1, monto: 9999.84 }])).toThrow(/dejar saldo/)
  })

  it('el redondeo cierra exacto con cualquier reparto, y la última cuota absorbe los centavos', () => {
    for (const monto of [1, 0.01, 333.33, 1234.56, 7777.77, 9000]) {
      const r = repartirCuotas(10000.01, 42, [{ mes: 7, monto }])
      expect(round2(r.cuotaMensual * 41 + r.ultimaCuota + monto)).toBe(10000.01)
      expect(r.ultimaCuota).toBeGreaterThan(0)
    }
  })

  it('el simulador y la cotización calculan lo mismo', () => {
    const extraordinarias = [{ mes: 6, monto: 2500 }]
    const p = generarPlan(e1, s.params, { fechaReserva: '2026-11-10', extraordinarias })
    const e = calcularEntrada({ precioFinal: p.precioFinal, reserva: 500, meses: p.meses, extraordinarias })
    expect(e).toMatchObject({ cuotaMensual: p.cuotaMensual, ultimaCuota: p.ultimaCuota, saldoCuotas: p.cuotasTotal, saldoEntrega: p.contraEntrega })
    expect(e.partidas.filter((x) => x.tipo === 'extraordinaria')).toEqual([{ tipo: 'extraordinaria', concepto: 'Cuota extraordinaria', monto: 2500, mes: 6 }])
  })

  it('las condiciones pasan de pantalla sin cambiar; lo ilegible no se acepta', () => {
    const filas = filasDeParam(filasAParam([{ mes: '6', monto: '2.500,50' }, { mes: '12', monto: '1000' }]))
    expect(leerFilas(filas)).toEqual([{ mes: 6, monto: 2500.5 }, { mes: 12, monto: 1000 }])
    expect(() => repartirCuotas(10000, 30, leerFilas([{ mes: '', monto: '100' }]))).toThrow(/entre 1 y 30/)
    expect(() => repartirCuotas(10000, 30, leerFilas([{ mes: '2', monto: 'abc' }]))).toThrow(/mayor a cero/)
  })
})
