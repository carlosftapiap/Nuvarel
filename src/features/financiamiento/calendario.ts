/**
 * Calendario fijo de cuotas por edificio y día de pago del comprador (misma regla que la migración 0018:
 * public.cuotas_calendario y public.cuota_vencimiento).
 * Edificio A: dic 2026 a nov 2029 (36 meses). Torre B: dic 2026 a may 2030 (42 meses).
 * Cuotas que quedan = meses desde el mes de firma (incluido) hasta el mes final; firma anterior al inicio: todas.
 * El plazo no se reinicia con cada comprador. Sin inicio configurado, el plazo cuenta desde la firma (regla anterior).
 */
const indice = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1
const mes = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
const diasDelMes = (yyyymm: string) => new Date(Date.UTC(Number(yyyymm.slice(0, 4)), Number(yyyymm.slice(5, 7)), 0)).getUTCDate()

/** Día del mes elegido para pagar: 1 a 31 o el último día del mes (predeterminado). */
export type DiaPago = 'ultimo' | `${number}`
export const DIA_PAGO_PREDETERMINADO: DiaPago = 'ultimo'
export const DIAS_PAGO: DiaPago[] = ['ultimo', ...Array.from({ length: 31 }, (_, i) => String(i + 1) as DiaPago)]
export const esDiaPago = (v: unknown): v is DiaPago => typeof v === 'string' && /^(ultimo|[1-9]|[12][0-9]|3[01])$/.test(v)
export const etiquetaDiaPago = (d: DiaPago) => (d === 'ultimo' ? 'Último día del mes' : `Día ${d} de cada mes${Number(d) > 28 ? ' (o el último día, si el mes es más corto)' : ''}`)

/** Último día del mes (yyyy-mm-dd) de una fecha o un mes (yyyy-mm). */
export const finDeMes = (iso: string) => `${iso.slice(0, 7)}-${String(diasDelMes(iso)).padStart(2, '0')}`

export interface CalendarioCuotas {
  /** Cuotas mensuales que quedan para quien firma en esa fecha. */
  meses: number
  /** Mes (yyyy-mm) de la cuota 1 y de la última; null sin calendario fijo. */
  mesInicial: string | null
  mesFinal: string | null
}

export function calendarioCuotas(fechaFirma: string, mesesEdificio: number, inicio?: string | null): CalendarioCuotas {
  if (!inicio) return { meses: mesesEdificio, mesInicial: null, mesFinal: null }
  const ini = indice(inicio), fin = ini + mesesEdificio - 1, desde = Math.max(indice(fechaFirma), ini)
  const meses = fin - desde + 1
  if (meses < 1) throw new Error(`El calendario de cuotas de este edificio terminó en ${mes(fin).slice(5)}/${mes(fin).slice(0, 4)}: no quedan cuotas para el 14 %.`)
  return { meses, mesInicial: mes(desde), mesFinal: mes(fin) }
}

/** Vencimiento de la cuota n: el día elegido (o el último día si el mes es más corto), nunca antes de la firma. */
export function vencimiento(mesInicial: string, n: number, dia: DiaPago, fechaFirma: string) {
  const m = mes(indice(mesInicial) + n - 1)
  const d = dia === 'ultimo' ? diasDelMes(m) : Math.min(Number(dia), diasDelMes(m))
  const fecha = `${m}-${String(d).padStart(2, '0')}`
  return fecha < fechaFirma ? fechaFirma : fecha
}

export const vencimientos = (c: CalendarioCuotas, dia: DiaPago, fechaFirma: string) =>
  c.mesInicial ? Array.from({ length: c.meses }, (_, k) => vencimiento(c.mesInicial!, k + 1, dia, fechaFirma)) : null

/** Hoy en Ecuador (yyyy-mm-dd). */
export const hoyEcuador = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
