import { calcularPrecio, etiquetaPagoFirma, round2 } from '@/features/inventario/pricing'
import type { PricingParams, Unit } from '@/features/inventario/types'
import { calendarioCuotas, DIA_PAGO_PREDETERMINADO, vencimientos, type DiaPago } from './calendario'

export interface PagoCronograma {
  n: number
  tipo: 'reserva' | 'cuota' | 'extraordinaria' | 'entrega'
  concepto: string
  /** ISO yyyy-mm-dd; null cuando la fecha depende de la entrega (aún no definida). */
  fecha: string | null
  monto: number
  saldo: number
}

/** Pago programado dentro del 14 %, en un mes del plan. No es un pago recibido. */
export interface CuotaExtraordinaria {
  mes: number
  monto: number
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
  /** Solo si el plan las tiene, ordenadas por mes. */
  extraordinarias?: CuotaExtraordinaria[]
  /** Día del mes elegido por el comprador para pagar sus cuotas. */
  diaPago?: DiaPago
  /** Fecha de firma con la que se calcularon las cuotas que quedan y sus vencimientos. */
  fechaFirma?: string
  /** Vencimiento de cada cuota mensual (calendario fijo). Sin calendario: un mes después de la firma cada una. */
  vencimientos?: string[]
  /** Vencimiento de la última cuota: el mismo mes final para todos los compradores del edificio. */
  ultimaFecha?: string
  /** La cuota 1 vence el día de la firma porque el día elegido ya pasó ese mes. */
  cuotaEnFirma?: boolean
  /** El comprador aceptó expresamente el calendario (solo en cotizaciones emitidas). */
  calendarioAceptado?: boolean
  cronograma: PagoCronograma[]
}

export const DESCUENTO_MAX = 50

export function hoyGuayaquil() {
  return fechaGuayaquil(new Date())
}

/** Fecha (yyyy-mm-dd) de un instante en Ecuador: un registro de las 20:00 no pasa al día siguiente. */
export function fechaGuayaquil(instante: Date | string) {
  // en-CA devuelve yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date(instante))
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

/** La cuota 1 vence el día de la firma porque el día elegido ya pasó ese mes. */
export const cuotaEnFirma = (fechas: string[], dia: DiaPago, fechaFirma: string) =>
  dia !== 'ultimo' && fechas[0] === fechaFirma && Number(dia) < Number(fechaFirma.slice(8))

/** Vencimiento de la cuota mensual n (1 = primera): el del calendario guardado o, sin él, n meses después de la firma. */
export const fechaCuota = (p: { vencimientos?: string[] | null }, fechaFirma: string, n: number) => p.vencimientos?.[n - 1] ?? sumarMeses(fechaFirma, n)

export function fmtFechaCorta(iso: string | null) {
  if (!iso) return 'A la entrega'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Reparte el total de cuotas entre extraordinarias y mensuales para que sumen exactamente lo pactado.
 * La última mensual absorbe los centavos. Misma regla que cuotas_con_extraordinarias en la base de datos.
 */
export function repartirCuotas(total: number, meses: number, extras: CuotaExtraordinaria[] = []) {
  for (const e of extras) {
    if (!Number.isInteger(e.mes) || e.mes < 1 || e.mes > meses) throw new Error(`El mes de cada cuota extraordinaria debe estar entre 1 y ${meses}.`)
    if (!Number.isFinite(e.monto) || e.monto <= 0 || round2(e.monto) !== e.monto) throw new Error('El monto de cada cuota extraordinaria debe ser mayor a cero, con hasta dos decimales.')
  }
  const resto = round2(total - extras.reduce((t, e) => t + e.monto, 0))
  const cuotaMensual = meses > 0 ? round2(resto / meses) : 0
  const ultimaCuota = meses > 0 ? round2(resto - cuotaMensual * (meses - 1)) : 0
  if (extras.length && (resto <= 0 || cuotaMensual <= 0 || ultimaCuota <= 0)) throw new Error(`Las cuotas extraordinarias deben dejar saldo para las cuotas mensuales: el 14 % es USD ${total}.`)
  return { cuotaMensual, ultimaCuota, extraordinarias: [...extras].sort((a, b) => a.mes - b.mes) }
}

/** Cronograma a partir de las condiciones: lo usan el simulador y las cotizaciones guardadas, sin recalcular precios. */
export function armarCronograma(p: Omit<PlanFinanciamiento, 'cronograma'>, fecha: string): PagoCronograma[] {
  const cronograma: PagoCronograma[] = []
  let saldo = round2(p.precioFinal - p.reserva)
  let n = 1
  const extras = p.extraordinarias ?? []
  cronograma.push({ n: 0, tipo: 'reserva', concepto: etiquetaPagoFirma(p.reservaPct), fecha, monto: p.reserva, saldo })
  for (let i = 1; i <= p.meses; i++) {
    const monto = i === p.meses ? p.ultimaCuota : p.cuotaMensual
    saldo = round2(saldo - monto)
    cronograma.push({ n: n++, tipo: 'cuota', concepto: `Cuota ${i} de ${p.meses}`, fecha: fechaCuota(p, fecha, i), monto, saldo })
    for (const e of extras.filter((x) => x.mes === i)) {
      saldo = round2(saldo - e.monto)
      cronograma.push({ n: n++, tipo: 'extraordinaria', concepto: 'Cuota extraordinaria', fecha: fechaCuota(p, fecha, i), monto: e.monto, saldo })
    }
  }
  cronograma.push({ n, tipo: 'entrega', concepto: `Saldo contra entrega ${p.entregaPct}%`, fecha: null, monto: p.contraEntrega, saldo: round2(saldo - p.contraEntrega) })
  return cronograma
}

export interface CronogramaMes { mes: number; fecha: string; cuota: number; extraordinaria: number; total: number }

/** Una fila por mes: cuota mensual, extraordinaria y total. */
export function cronogramaPorMes(p: Pick<PlanFinanciamiento, 'meses' | 'cuotaMensual' | 'ultimaCuota' | 'extraordinarias' | 'vencimientos'>, fecha: string): CronogramaMes[] {
  return Array.from({ length: p.meses }, (_, k) => {
    const mes = k + 1
    const cuota = mes === p.meses ? p.ultimaCuota : p.cuotaMensual
    const extraordinaria = round2((p.extraordinarias ?? []).filter((e) => e.mes === mes).reduce((t, e) => t + e.monto, 0))
    return { mes, fecha: fechaCuota(p, fecha, mes), cuota, extraordinaria, total: round2(cuota + extraordinaria) }
  })
}

/**
 * Plan de pagos de AMURA: 6 % a la firma, 14 % en las cuotas que quedan del calendario fijo del edificio y 80 % contra entrega.
 * Calendario: Edificio A dic 2026 a nov 2029; Torre B dic 2026 a may 2030. La cuota vence el día que elige el comprador.
 * `fechaReserva` es la fecha de firma prevista.
 */
export function generarPlan(unit: Unit, params: PricingParams, opts: { descuentoPct?: number; fechaReserva: string; extraordinarias?: CuotaExtraordinaria[]; diaPago?: DiaPago }): PlanFinanciamiento {
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
  const calendario = calendarioCuotas(opts.fechaReserva, params.meses[unit.edificio], params.inicioCuotas)
  const meses = calendario.meses
  const { cuotaMensual, ultimaCuota, extraordinarias } = repartirCuotas(cuotasTotal, meses, opts.extraordinarias)
  const contraEntrega = round2(precioFinal - reserva - cuotasTotal)

  const dia = opts.diaPago ?? DIA_PAGO_PREDETERMINADO
  const fechas = vencimientos(calendario, dia, opts.fechaReserva)
  const plan: Omit<PlanFinanciamiento, 'cronograma'> = {
    precioLista, descuentoPct, descuentoMonto, precioFinal,
    areaVendibleM2: base.areaVendibleM2,
    usdM2Final: base.areaVendibleM2 ? round2((precioFinal - base.valorPatio) / base.areaVendibleM2) : 0,
    reservaPct: params.reservaPct, cuotasPct: params.cuotasPct, entregaPct: round2(100 - params.reservaPct - params.cuotasPct),
    reserva, cuotasTotal, meses, cuotaMensual, ultimaCuota, contraEntrega,
    ...(extraordinarias.length ? { extraordinarias } : {}),
    diaPago: dia, fechaFirma: opts.fechaReserva,
    ...(fechas ? { vencimientos: fechas, ultimaFecha: fechas[fechas.length - 1], cuotaEnFirma: cuotaEnFirma(fechas, dia, opts.fechaReserva) } : {}),
  }
  return { ...plan, cronograma: armarCronograma(plan, opts.fechaReserva) }
}
