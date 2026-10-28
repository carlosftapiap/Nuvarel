import { calcularPrecio, round2 } from '@/features/inventario/pricing'
import type { PricingParams, Unit } from '@/features/inventario/types'

export interface PagoCronograma {
  n: number
  tipo: 'reserva' | 'cuota' | 'entrega'
  concepto: string
  /** ISO yyyy-mm-dd; null cuando la fecha depende de la entrega (aún no definida). */
  fecha: string | null
  monto: number
  saldo: number
}

export interface PlanFinanciamiento {
  precioLista: number
  descuentoPct: number
  descuentoMonto: number
  precioFinal: number
  areaVendibleM2: number
  usdM2Final: number
  reservaPct: number
  cuotasPct: number
  entregaPct: number
  reserva: number
  cuotasTotal: number
  meses: number
  cuotaMensual: number
  ultimaCuota: number
  contraEntrega: number
  cronograma: PagoCronograma[]
}

export const DESCUENTO_MAX = 50

export function hoyGuayaquil() {
  // en-CA devuelve yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
}

function parseFecha(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error('Fecha inválida. Usa el formato aaaa-mm-dd.')
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const diasMes = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (mo < 1 || mo > 12 || d < 1 || d > diasMes) throw new Error('Fecha inválida.')
  return { y, mo, d }
}

/** Suma meses conservando el día; si el mes no lo tiene, usa el último día del mes. */
export function sumarMeses(iso: string, meses: number) {
  const { y, mo, d } = parseFecha(iso)
  const total = mo - 1 + meses
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  const ult = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, ult)).padStart(2, '0')}`
}

export function fmtFechaCorta(iso: string | null) {
  if (!iso) return 'A la entrega'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Plan de pagos de AMURA: reserva (6%), cuotas mensuales (14% en 30 meses E1 / 42 meses E2) y saldo contra entrega (80%).
 * Los porcentajes y plazos vienen de los parámetros vigentes del inventario.
 */
export function generarPlan(unit: Unit, params: PricingParams, opts: { descuentoPct?: number; fechaReserva: string }): PlanFinanciamiento {
  const descuentoPct = opts.descuentoPct ?? 0
  if (!Number.isFinite(descuentoPct) || descuentoPct < 0 || descuentoPct > DESCUENTO_MAX) {
    throw new Error(`El descuento debe estar entre 0% y ${DESCUENTO_MAX}%.`)
  }
  parseFecha(opts.fechaReserva)
  const base = calcularPrecio(unit, params)
  const precioLista = base.precioVenta
  const descuentoMonto = round2((precioLista * descuentoPct) / 100)
  const precioFinal = round2(precioLista - descuentoMonto)
  const reserva = round2((precioFinal * params.reservaPct) / 100)
  const cuotasTotal = round2((precioFinal * params.cuotasPct) / 100)
  const meses = params.meses[unit.edificio]
  const cuotaMensual = meses > 0 ? round2(cuotasTotal / meses) : 0
  // La última cuota absorbe los centavos para que el total sea exacto.
  const ultimaCuota = meses > 0 ? round2(cuotasTotal - cuotaMensual * (meses - 1)) : 0
  const contraEntrega = round2(precioFinal - reserva - cuotasTotal)

  const cronograma: PagoCronograma[] = []
  let saldo = round2(precioFinal - reserva)
  cronograma.push({ n: 0, tipo: 'reserva', concepto: `Reserva ${params.reservaPct}%`, fecha: opts.fechaReserva, monto: reserva, saldo })
  for (let i = 1; i <= meses; i++) {
    const monto = i === meses ? ultimaCuota : cuotaMensual
    saldo = round2(saldo - monto)
    cronograma.push({ n: i, tipo: 'cuota', concepto: `Cuota ${i} de ${meses}`, fecha: sumarMeses(opts.fechaReserva, i), monto, saldo })
  }
  cronograma.push({ n: meses + 1, tipo: 'entrega', concepto: `Saldo contra entrega ${round2(100 - params.reservaPct - params.cuotasPct)}%`, fecha: null, monto: contraEntrega, saldo: round2(saldo - contraEntrega) })

  return {
    precioLista, descuentoPct, descuentoMonto, precioFinal,
    areaVendibleM2: base.areaVendibleM2,
    usdM2Final: base.areaVendibleM2 ? round2((precioFinal - base.valorPatio) / base.areaVendibleM2) : 0,
    reservaPct: params.reservaPct, cuotasPct: params.cuotasPct, entregaPct: round2(100 - params.reservaPct - params.cuotasPct),
    reserva, cuotasTotal, meses, cuotaMensual, ultimaCuota, contraEntrega, cronograma,
  }
}
