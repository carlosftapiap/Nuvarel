import { describe, expect, it } from 'vitest'
import { generarPlan, sumarMeses } from '../plan'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const s = createInitialState()
const unit = (c: string) => s.units.find((u) => u.codigo === c)!

describe('plan de financiamiento', () => {
  it('E1: 6% reserva, 14% en 30 cuotas, 80% contra entrega (E1-PB-A1, lista PDF)', () => {
    const p = generarPlan(unit('E1-PB-A1'), s.params, { fechaReserva: '2026-10-28' })
    expect(p.precioFinal).toBe(161831)
    expect(Math.round(p.reserva)).toBe(9710)
    expect(p.meses).toBe(30)
    expect(Math.round(p.cuotaMensual)).toBe(755)
    expect(Math.round(p.contraEntrega)).toBe(129465)
    expect(p.cronograma).toHaveLength(32) // reserva + 30 cuotas + entrega
  })

  it('E2 usa 42 cuotas', () => {
    const p = generarPlan(unit('E2-PB-A3'), s.params, { fechaReserva: '2026-10-28' })
    expect(p.meses).toBe(42)
    expect(Math.round(p.cuotaMensual)).toBe(455)
    expect(p.cronograma.filter((x) => x.tipo === 'cuota')).toHaveLength(42)
  })

  it('el cronograma suma exactamente el precio y termina con saldo cero', () => {
    for (const u of s.units) {
      const p = generarPlan(u, s.params, { fechaReserva: '2026-01-31', descuentoPct: 2.5 })
      const suma = p.cronograma.reduce((t, x) => t + x.monto, 0)
      expect(suma).toBeCloseTo(p.precioFinal, 2)
      expect(p.cronograma.at(-1)!.saldo).toBeCloseTo(0, 2)
      expect(p.cuotasTotal).toBeCloseTo(p.cuotaMensual * (p.meses - 1) + p.ultimaCuota, 2)
    }
  })

  it('descuento reduce el precio final y todos los pagos', () => {
    const sin = generarPlan(unit('E1-P1-A5'), s.params, { fechaReserva: '2026-10-28' })
    const con = generarPlan(unit('E1-P1-A5'), s.params, { fechaReserva: '2026-10-28', descuentoPct: 3 })
    expect(con.descuentoMonto).toBeCloseTo(179421 * 0.03, 2)
    expect(con.precioFinal).toBeCloseTo(179421 * 0.97, 2)
    expect(con.reserva).toBeLessThan(sin.reserva)
    expect(() => generarPlan(unit('E1-P1-A5'), s.params, { fechaReserva: '2026-10-28', descuentoPct: 60 })).toThrow(/descuento/)
  })

  it('fechas mensuales conservan el día y ajustan fin de mes', () => {
    expect(sumarMeses('2026-10-28', 1)).toBe('2026-11-28')
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(sumarMeses('2026-11-15', 2)).toBe('2027-01-15')
    const p = generarPlan(unit('E1-PB-A1'), s.params, { fechaReserva: '2026-10-28' })
    expect(p.cronograma[1].fecha).toBe('2026-11-28')
    expect(p.cronograma[30].fecha).toBe('2029-04-28')
    expect(p.cronograma.at(-1)!.fecha).toBeNull() // la fecha de entrega no está definida
    expect(() => generarPlan(unit('E1-PB-A1'), s.params, { fechaReserva: '2026-02-30' })).toThrow()
  })
})
