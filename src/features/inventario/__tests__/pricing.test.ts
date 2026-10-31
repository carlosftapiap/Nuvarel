import { describe, expect, it } from 'vitest'
import { aplicarPorcentaje, calcularPrecio, totalVenta } from '../pricing'
import LISTA_PDF from './fixtures/lista-precios-base-2026-10-28.json'
import { AMURA_UNITS_SEED } from '@/features/inventario/__tests__/datos/amura-units'
import { DEFAULT_PARAMS } from '@/features/inventario/__tests__/fixtures'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

type FilaPdf = { areaM2: number; bodegaM2: number; patioM2: number; usdM2Mostrado: number; precioVenta: number; reserva: number; cuota: number; contraEntrega: number }
const PDF = LISTA_PDF as Record<string, FilaPdf>

describe('inventario semilla', () => {
  it('contiene los 72 departamentos: 30 en Edificio 1 y 42 en Edificio 2', () => {
    expect(AMURA_UNITS_SEED).toHaveLength(72)
    expect(AMURA_UNITS_SEED.filter((u) => u.edificio === 1)).toHaveLength(30)
    expect(AMURA_UNITS_SEED.filter((u) => u.edificio === 2)).toHaveLength(42)
    expect(new Set(AMURA_UNITS_SEED.map((u) => u.codigo)).size).toBe(72)
    expect(new Set(AMURA_UNITS_SEED.map((u) => u.dpt)).size).toBe(72)
  })

  it('numera 1001-1505 y 2001-2507', () => {
    const e1 = AMURA_UNITS_SEED.filter((u) => u.edificio === 1).map((u) => u.dpt)
    const e2 = AMURA_UNITS_SEED.filter((u) => u.edificio === 2).map((u) => u.dpt)
    expect(e1[0]).toBe('1001'); expect(e1.at(-1)).toBe('1505')
    expect(e2[0]).toBe('2001'); expect(e2.at(-1)).toBe('2507')
  })

  it('las superficies coinciden con la lista PDF para las 72 unidades', () => {
    for (const u of AMURA_UNITS_SEED) {
      const p = PDF[u.codigo]
      expect(p, u.codigo).toBeDefined()
      expect(u.areaM2, `${u.codigo} área`).toBeCloseTo(p.areaM2, 2)
      expect(u.bodegaM2, `${u.codigo} bodega`).toBeCloseTo(p.bodegaM2, 2)
      expect(u.patioM2, `${u.codigo} patio`).toBeCloseTo(p.patioM2, 2)
      expect(Math.round(u.usdM2), `${u.codigo} USD/m²`).toBe(p.usdM2Mostrado)
    }
  })

  it('arranca con todas las unidades disponibles', () => {
    expect(createInitialState().units.every((u) => u.estado === 'disponible')).toBe(true)
  })
})

describe('cálculo de precios contra la lista base del 28/10/2026', () => {
  it.each(AMURA_UNITS_SEED.map((u) => [u.codigo, u] as const))('%s: precio y plan de pagos', (codigo, u) => {
    const r = calcularPrecio(u, DEFAULT_PARAMS)
    const p = PDF[codigo]
    expect(Math.round(r.precioVenta)).toBe(p.precioVenta)
    expect(Math.round(r.reserva)).toBe(p.reserva)
    expect(Math.round(r.cuotaMensual)).toBe(p.cuota)
    expect(Math.round(r.contraEntrega)).toBe(p.contraEntrega)
    expect(r.precioVenta).toBeCloseTo(u.precioReferencia, 2)
    // El plan siempre suma exactamente el precio.
    expect(r.reserva + r.cuotasTotal + r.contraEntrega).toBeCloseTo(r.precioVenta, 2)
  })

  it('totales por edificio y del proyecto', () => {
    const e1 = createInitialState().units.filter((u) => u.edificio === 1)
    const e2 = createInitialState().units.filter((u) => u.edificio === 2)
    expect(Math.round(totalVenta(e1, DEFAULT_PARAMS))).toBe(4_752_650)
    expect(Math.round(totalVenta(e2, DEFAULT_PARAMS))).toBe(6_444_695)
    expect(Math.round(totalVenta(createInitialState().units, DEFAULT_PARAMS))).toBe(11_197_345)
  })

  it('desglose de E1-PB-A2 (con patio)', () => {
    const u = AMURA_UNITS_SEED.find((x) => x.codigo === 'E1-PB-A2')!
    const r = calcularPrecio(u, DEFAULT_PARAMS)
    expect(r.areaVendibleM2).toBe(72.53)
    expect(r.precioAreaBodega).toBe(161_742)
    expect(r.valorPatio).toBe(10_405.2)
    expect(r.precioVenta).toBe(172_147.2)
    expect(r.meses).toBe(30)
  })

  it('E2 usa 42 meses de cuotas', () => {
    const u = AMURA_UNITS_SEED.find((x) => x.codigo === 'E2-PB-A1')!
    expect(calcularPrecio(u, DEFAULT_PARAMS).meses).toBe(42)
  })

  it('el valor del m² de patio afecta sólo a unidades con patio', () => {
    const conPatio = AMURA_UNITS_SEED.find((x) => x.codigo === 'E1-PB-A3')!
    const sinPatio = AMURA_UNITS_SEED.find((x) => x.codigo === 'E1-PB-A1')!
    const p2 = { ...DEFAULT_PARAMS, patioUsdM2: 300 }
    expect(calcularPrecio(conPatio, p2).precioVenta - calcularPrecio(conPatio, DEFAULT_PARAMS).precioVenta).toBeCloseTo(38.35 * 70, 2)
    expect(calcularPrecio(sinPatio, p2).precioVenta).toBe(calcularPrecio(sinPatio, DEFAULT_PARAMS).precioVenta)
  })

  it('aplicarPorcentaje redondea a centavos', () => {
    expect(aplicarPorcentaje(2230, 3)).toBe(2296.9)
    expect(aplicarPorcentaje(2361.7, -2)).toBe(2314.47)
  })
})
