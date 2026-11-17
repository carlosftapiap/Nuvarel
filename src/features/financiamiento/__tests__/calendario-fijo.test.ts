import { describe, expect, it } from 'vitest'
import { calendarioCuotas, vencimiento, type DiaPago } from '../calendario'
import { generarPlan, sumarMeses } from '../plan'
import type { PricingParams, Unit } from '@/features/inventario/types'

// A103: 53,69 m² a USD 2.140/m² → precio 114.897, 14 % = 16.085,58. Torre B de ejemplo: USD 2.270/m² → 121.876, 14 % = 17.062,64.
const unidad = (edificio: 1 | 2, usd: number) => ({ edificio, areaM2: 53.69, bodegaM2: 0, patioM2: 0, usdM2: usd, codigo: 'X', dpt: 'X' }) as unknown as Unit
const params: PricingParams = { patioUsdM2: 230, reservaPct: 6, cuotasPct: 14, meses: { 1: 36, 2: 42 }, inicioCuotas: '2026-12-01' }
const plan = (edificio: 1 | 2, firma: string, dia: DiaPago) => generarPlan(unidad(edificio, edificio === 1 ? 2140 : 2270), params, { fechaReserva: firma, diaPago: dia })
const cuotas = (p: ReturnType<typeof plan>) => p.cronograma.filter((x) => x.tipo === 'cuota')
const r2 = (v: number) => Math.round(v * 100) / 100

describe('calendario fijo: el plazo no se reinicia con cada comprador', () => {
  it('Edificio A termina en noviembre 2029: 36, 35 y 34 cuotas para firmas en dic, ene y feb', () => {
    expect(calendarioCuotas('2026-11-16', 36, '2026-12-01')).toEqual({ meses: 36, mesInicial: '2026-12', mesFinal: '2029-11' })
    expect(calendarioCuotas('2026-12-15', 36, '2026-12-01').meses).toBe(36)
    expect(calendarioCuotas('2027-01-20', 36, '2026-12-01').meses).toBe(35)
    expect(calendarioCuotas('2027-02-10', 36, '2026-12-01').meses).toBe(34)
    expect(calendarioCuotas('2029-11-05', 36, '2026-12-01').meses).toBe(1)
    expect(() => calendarioCuotas('2029-12-01', 36, '2026-12-01')).toThrow(/terminó en 11\/2029/)
  })

  it('Torre B termina en mayo 2030: 42, 41 y 40 cuotas', () => {
    expect(calendarioCuotas('2026-12-15', 42, '2026-12-01')).toEqual({ meses: 42, mesInicial: '2026-12', mesFinal: '2030-05' })
    expect(calendarioCuotas('2027-01-20', 42, '2026-12-01').meses).toBe(41)
    expect(calendarioCuotas('2027-02-10', 42, '2026-12-01').meses).toBe(40)
  })

  it('sin inicio configurado conserva la regla anterior (plazo desde la firma, un mes después)', () => {
    const p = generarPlan(unidad(1, 2140), { ...params, inicioCuotas: null }, { fechaReserva: '2027-01-31' })
    expect(p.meses).toBe(36)
    expect(cuotas(p)[1].fecha).toBe(sumarMeses('2027-01-31', 2))
  })
})

describe('día de pago elegido por el comprador', () => {
  it('casos especiales: día 31 en mes de 30, día 30 en febrero y último día', () => {
    expect(vencimiento('2027-04', 1, '31', '2027-01-05')).toBe('2027-04-30')
    expect(vencimiento('2027-02', 1, '30', '2027-02-10')).toBe('2027-02-28')
    expect(vencimiento('2028-02', 1, '30', '2027-02-10')).toBe('2028-02-29')
    expect(vencimiento('2027-02', 1, 'ultimo', '2027-01-05')).toBe('2027-02-28')
  })

  it('si el día elegido ya pasó en el mes de firma, la cuota 1 vence el día de la firma; nunca antes', () => {
    expect(vencimiento('2027-01', 1, '10', '2027-01-20')).toBe('2027-01-20')
    expect(vencimiento('2027-01', 2, '10', '2027-01-20')).toBe('2027-02-10')
  })

  const escenarios: [1 | 2, string, DiaPago, number, string, string, string][] = [
    // edificio, firma, día, cuotas, cuota 1, cuota 2, última
    [1, '2026-12-15', 'ultimo', 36, '2026-12-31', '2027-01-31', '2029-11-30'],
    [1, '2026-12-15', '10', 36, '2026-12-15', '2027-01-10', '2029-11-10'],
    [1, '2026-12-15', '30', 36, '2026-12-30', '2027-01-30', '2029-11-30'],
    [1, '2027-01-20', '10', 35, '2027-01-20', '2027-02-10', '2029-11-10'],
    [1, '2027-01-05', '31', 35, '2027-01-31', '2027-02-28', '2029-11-30'],
    [1, '2027-01-20', 'ultimo', 35, '2027-01-31', '2027-02-28', '2029-11-30'],
    [1, '2027-02-10', '30', 34, '2027-02-28', '2027-03-30', '2029-11-30'],
    [1, '2027-02-10', '31', 34, '2027-02-28', '2027-03-31', '2029-11-30'],
    [1, '2027-02-10', '10', 34, '2027-02-10', '2027-03-10', '2029-11-10'],
    [2, '2026-12-15', 'ultimo', 42, '2026-12-31', '2027-01-31', '2030-05-31'],
    [2, '2027-01-20', '10', 41, '2027-01-20', '2027-02-10', '2030-05-10'],
    [2, '2027-02-10', '30', 40, '2027-02-28', '2027-03-30', '2030-05-30'],
    [2, '2027-02-10', '31', 40, '2027-02-28', '2027-03-31', '2030-05-31'],
  ]
  it.each(escenarios)('Edificio %s, firma %s, día %s: %s cuotas (%s, %s … %s)', (ed, firma, dia, n, c1, c2, ultima) => {
    const p = plan(ed, firma, dia)
    const cs = cuotas(p)
    expect(p.meses).toBe(n)
    expect(cs).toHaveLength(n)
    expect([cs[0].fecha, cs[1].fecha, cs[n - 1].fecha]).toEqual([c1, c2, ultima])
    expect(p.ultimaFecha).toBe(ultima)
    expect(p.diaPago).toBe(dia)
    // Ninguna cuota vence antes de la firma, las fechas no se repiten y el 14 % cuadra al centavo.
    expect(cs.every((x) => x.fecha! >= firma)).toBe(true)
    expect(new Set(cs.map((x) => x.fecha)).size).toBe(n)
    expect(r2(cs.reduce((t, x) => t + x.monto, 0))).toBe(p.cuotasTotal)
    expect(r2(p.reserva + p.cuotasTotal + p.contraEntrega)).toBe(p.precioFinal)
    // Aviso solo cuando el día elegido ya pasó en el mes de firma.
    expect(p.cuotaEnFirma).toBe(dia !== 'ultimo' && cs[0].fecha === firma && Number(dia) < Number(firma.slice(8)))
  })

  it('montos de los ejemplos aprobados', () => {
    const m = (p: ReturnType<typeof plan>) => [p.meses, p.cuotaMensual, p.ultimaCuota, p.reserva, p.contraEntrega]
    expect(m(plan(1, '2026-12-15', 'ultimo'))).toEqual([36, 446.82, 446.88, 6893.82, 91917.6])
    expect(m(plan(1, '2027-01-20', '10'))).toEqual([35, 459.59, 459.52, 6893.82, 91917.6])
    expect(m(plan(1, '2027-02-10', '30'))).toEqual([34, 473.11, 472.95, 6893.82, 91917.6])
    expect(m(plan(2, '2026-12-15', 'ultimo'))).toEqual([42, 406.25, 406.39, 7312.56, 97500.8])
    expect(m(plan(2, '2027-01-20', '10'))).toEqual([41, 416.16, 416.24, 7312.56, 97500.8])
    expect(m(plan(2, '2027-02-10', '30'))).toEqual([40, 426.57, 426.41, 7312.56, 97500.8])
  })
})
