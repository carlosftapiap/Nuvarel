import { calcularPrecio } from '@/features/inventario/pricing'
import type { Edificio, Piso, PricingParams, Unit } from '@/features/inventario/types'
import { FRATELLI } from './data/fratelli'

export type Posicion = 'bajo' | 'dentro' | 'sobre'

export interface RangoFratelli {
  planta: string
  unidades: number
  m2Min: number
  m2Max: number
  precioMin: number
  precioMax: number
}

/** USD/m² de FRATELLI = precio total / (departamento + bodega), igual que el simulador AMURA. */
const usdM2Fratelli = (f: (typeof FRATELLI)[number]) => f.precioTotal / (f.dptoM2 + f.bodegaM2)

export const RANGOS_FRATELLI: Record<string, RangoFratelli> = Object.fromEntries(
  ['PB', '1', '2', '3'].map((planta) => {
    const del = FRATELLI.filter((f) => f.planta === planta)
    const m2 = del.map(usdM2Fratelli)
    const precios = del.map((f) => f.precioTotal)
    return [planta, { planta, unidades: del.length, m2Min: Math.min(...m2), m2Max: Math.max(...m2), precioMin: Math.min(...precios), precioMax: Math.max(...precios) }]
  }),
)

export const RANGO_FRATELLI_TOTAL = {
  m2Min: Math.min(...FRATELLI.map(usdM2Fratelli)),
  m2Max: Math.max(...FRATELLI.map(usdM2Fratelli)),
  precioMin: Math.min(...FRATELLI.map((f) => f.precioTotal)),
  precioMax: Math.max(...FRATELLI.map((f) => f.precioTotal)),
}

/** FRATELLI llega al piso 3: los pisos 4 y 5 de AMURA se comparan con su piso 3. */
export const rangoParaPiso = (piso: Piso) => RANGOS_FRATELLI[['PB', '1', '2', '3'].includes(piso) ? piso : '3']

export function posicion(usdM2: number, r: RangoFratelli): Posicion {
  // Se compara con el valor redondeado a centavos, como la lista base.
  const v = Math.round(usdM2 * 100) / 100
  if (v < Math.round(r.m2Min * 100) / 100) return 'bajo'
  if (v > Math.round(r.m2Max * 100) / 100) return 'sobre'
  return 'dentro'
}

/** USD/m² comparable de AMURA: precio de área + bodega / (área + bodega), sin patio. */
export function usdM2Comparable(u: Unit, params: PricingParams) {
  const p = calcularPrecio(u, params)
  return p.areaVendibleM2 ? p.precioAreaBodega / p.areaVendibleM2 : 0
}

export function posicionUnidad(u: Unit, params: PricingParams): Posicion {
  return posicion(usdM2Comparable(u, params), rangoParaPiso(u.piso))
}

export interface FilaPiso {
  edificio: Edificio
  piso: Piso
  unidades: number
  amuraM2: number
  rango: RangoFratelli
  posicion: Posicion
}

export function comparacionPorPiso(units: Unit[], params: PricingParams): FilaPiso[] {
  const filas: FilaPiso[] = []
  for (const edificio of [1, 2] as Edificio[]) {
    for (const piso of ['PB', '1', '2', '3', '4', '5'] as Piso[]) {
      const del = units.filter((u) => u.edificio === edificio && u.piso === piso)
      if (!del.length) continue
      const precios = del.map((u) => calcularPrecio(u, params))
      const amuraM2 = precios.reduce((t, p) => t + p.precioAreaBodega, 0) / precios.reduce((t, p) => t + p.areaVendibleM2, 0)
      const rango = rangoParaPiso(piso)
      filas.push({ edificio, piso, unidades: del.length, amuraM2, rango, posicion: posicion(amuraM2, rango) })
    }
  }
  return filas
}

export function conteoPosiciones(units: Unit[], params: PricingParams) {
  const c: Record<Posicion, number> = { bajo: 0, dentro: 0, sobre: 0 }
  units.forEach((u) => c[posicionUnidad(u, params)]++)
  return c
}

export const POSICION_LABEL: Record<Posicion, string> = { bajo: 'Bajo rango', dentro: 'Dentro del rango', sobre: 'Sobre rango' }
