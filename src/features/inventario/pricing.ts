import type { Edificio, PricingParams, Unit, UnitSeed } from './types'

/**
 * Parámetros de la lista base del 28/10/2026 (simulador AMURA, hoja "Parametros").
 * Forma de pago: 6% reserva + 14% en cuotas (30 meses E1 / 42 meses E2) + 80% contra entrega.
 */
export const DEFAULT_PARAMS: PricingParams = {
  patioUsdM2: 230,
  reservaPct: 6,
  cuotasPct: 14,
  meses: { 1: 30, 2: 42 },
}

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export interface PriceBreakdown {
  areaVendibleM2: number
  usdM2: number
  precioAreaBodega: number
  valorPatio: number
  precioVenta: number
  usdM2Efectivo: number
  reserva: number
  cuotasTotal: number
  meses: number
  cuotaMensual: number
  contraEntrega: number
  contraEntregaPct: number
}

type PricedUnit = Pick<UnitSeed, 'areaM2' | 'bodegaM2' | 'patioM2' | 'usdM2' | 'edificio'>

/**
 * Regla del simulador: precio = redondeo(USD/m² × (área + bodega)) + patio × USD/m² de patio.
 * El contra entrega se obtiene por diferencia para que el plan sume exactamente el precio.
 */
export function calcularPrecio(u: PricedUnit, p: PricingParams): PriceBreakdown {
  const areaVendibleM2 = round2(u.areaM2 + u.bodegaM2)
  const precioAreaBodega = Math.round(u.usdM2 * areaVendibleM2)
  const valorPatio = round2(u.patioM2 * p.patioUsdM2)
  const precioVenta = round2(precioAreaBodega + valorPatio)
  const reserva = round2((precioVenta * p.reservaPct) / 100)
  const cuotasTotal = round2((precioVenta * p.cuotasPct) / 100)
  const meses = p.meses[u.edificio as Edificio]
  return {
    areaVendibleM2,
    usdM2: u.usdM2,
    precioAreaBodega,
    valorPatio,
    precioVenta,
    usdM2Efectivo: areaVendibleM2 ? round2(precioAreaBodega / areaVendibleM2) : 0,
    reserva,
    cuotasTotal,
    meses,
    cuotaMensual: meses > 0 ? round2(cuotasTotal / meses) : 0,
    contraEntrega: round2(precioVenta - reserva - cuotasTotal),
    contraEntregaPct: round2(100 - p.reservaPct - p.cuotasPct),
  }
}

export function aplicarPorcentaje(usdM2: number, pct: number) {
  return round2(usdM2 * (1 + pct / 100))
}

export function totalVenta(units: Unit[], p: PricingParams) {
  return round2(units.reduce((t, u) => t + calcularPrecio(u, p).precioVenta, 0))
}

const usdFmt = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2Fmt = new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const m2Fmt = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtUsd = (v: number) => usdFmt.format(Math.round(v))
export const fmtUsd2 = (v: number) => usd2Fmt.format(v)
export const fmtM2 = (v: number) => `${m2Fmt.format(v)} m²`
export const fmtNum = (v: number) => m2Fmt.format(v)
export const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('es-EC', { maximumFractionDigits: 2 })}%`
export const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(new Date(iso))
