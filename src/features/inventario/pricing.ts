import type { Edificio, PricingParams, Unit, UnitSeed } from './types'

/** El 6 % acumulado a la firma forma parte de la entrada del 20 %. La reserva es otro concepto: un monto configurable que se acredita a él. */
export const etiquetaPagoFirma = (pct: number) => `Pago a la firma ${pct} %`
export const RESERVA_PREDETERMINADA = 500
export const NOTA_RESERVA = 'La reserva es un monto aparte, acordado con el cliente, y se descuenta del pago a la firma: no se cobra dos veces.'

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Lee un monto escrito a mano: 600 · 600,50 · 600.50 · 1.500 · 1,500 · 1.500,50. Vacío: null; ilegible: NaN. */
export function leerMonto(txt: string): number | null {
  const t = txt.replace(/[\s$]/g, '')
  if (!t) return null
  const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.')
  const decimal = coma >= 0 && punto >= 0 ? (coma > punto ? ',' : '.') : null
  let limpio: string
  if (decimal) limpio = t.split(decimal === ',' ? '.' : ',').join('').replace(',', '.')
  else if (/^\d{1,3}([.,]\d{3})+$/.test(t)) limpio = t.replace(/[.,]/g, '')
  else limpio = t.replace(',', '.')
  return /^\d*\.?\d+$/.test(limpio) ? Number(limpio) : NaN
}

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
  /** Absorbe los centavos: (meses − 1) × cuota + última = total de cuotas. */
  ultimaCuota: number
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
  const cuotaMensual = meses > 0 ? round2(cuotasTotal / meses) : 0
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
    cuotaMensual,
    ultimaCuota: meses > 0 ? round2(cuotasTotal - cuotaMensual * (meses - 1)) : 0,
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
/** "30 cuotas de entrada de $754,87", con la última aparte si absorbe centavos. */
export const fmtCuotas = (p: Pick<PriceBreakdown, 'meses' | 'cuotaMensual' | 'ultimaCuota'>) =>
  p.cuotaMensual === p.ultimaCuota
    ? `${p.meses} cuotas de entrada de ${fmtUsd2(p.cuotaMensual)}`
    : `${p.meses - 1} cuotas de entrada de ${fmtUsd2(p.cuotaMensual)} y una última de ${fmtUsd2(p.ultimaCuota)}`
export const fmtM2 = (v: number) => `${m2Fmt.format(v)} m²`
export const fmtNum = (v: number) => m2Fmt.format(v)
export const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toLocaleString('es-EC', { maximumFractionDigits: 2 })}%`
export const fmtFecha = (iso: string) =>
  new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Guayaquil' }).format(new Date(iso))
