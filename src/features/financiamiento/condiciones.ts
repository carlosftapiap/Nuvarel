import { calcularEntrada, type EntradaCalculada } from '@/features/cobranza/entrada'
import { errorMontoReserva } from '@/features/venta/operacion'
import { leerMonto, RESERVA_PREDETERMINADA } from '@/features/inventario/pricing'
import type { PricingParams, Unit } from '@/features/inventario/types'
import { leerFilas, type FilaExtra } from './components/CuotasExtraordinarias'
import type { Amortizacion } from './hipoteca'
import { DIA_PAGO_PREDETERMINADO, type DiaPago } from './calendario'
import { generarPlan, repartirCuotas, type PlanFinanciamiento } from './plan'

/**
 * Motor único de Financiamiento. Atender cliente y la pantalla de Financiamiento usan estas mismas funciones:
 * no hay fórmulas ni formularios de cálculo propios en otros módulos.
 */

/** Condiciones del crédito hipotecario 80 %, tal como las escribe el vendedor. */
export interface CreditoCondiciones {
  productoId: string
  anios: string
  meses: string
  amortizacion: Amortizacion
  tasa: string
  tasaEs: 'nominal' | 'efectiva'
  tipoTasa: 'fija' | 'variable'
  desgravamen: string
  incendio: string
  gastos: string
  avaluo: string
}

export const CREDITO_VACIO: CreditoCondiciones = {
  productoId: 'manual', anios: '20', meses: '0', amortizacion: 'francesa', tasa: '', tasaEs: 'nominal', tipoTasa: 'fija',
  desgravamen: '', incendio: '', gastos: '', avaluo: '',
}

/** Lo que define el plan de pagos de una operación o de una simulación. */
export interface CondicionesFinanciamiento {
  /** Fecha de firma: de ella salen las cuotas. */
  fecha: string
  descuento: string
  /** null: se usa la reserva predeterminada. */
  reserva: string | null
  extras: FilaExtra[]
  credito: CreditoCondiciones
  /** Día del mes en que el comprador pagará sus cuotas. Predeterminado: último día del mes. */
  diaPago: DiaPago
  /** El comprador aceptó expresamente el calendario resultante. Se exige para emitir la cotización. */
  calendarioAceptado: boolean
}

export const condicionesIniciales = (fecha: string): CondicionesFinanciamiento => ({ fecha, descuento: '0', reserva: null, extras: [], credito: CREDITO_VACIO, diaPago: DIA_PAGO_PREDETERMINADO, calendarioAceptado: false })

/** Resultado del cálculo. Un error del plan lo bloquea; una cuota extraordinaria inválida solo quita esa cuota y bloquea confirmar. */
export interface Calculo {
  plan: PlanFinanciamiento | null
  entrada: EntradaCalculada | null
  descuentoPct: number
  reserva: number
  predeterminado: number
  error: string | null
  errorExtras: string | null
  errorReserva: string | null
  /** Huella del plan calculado. Permite saber si el plan confirmado sigue siendo el mismo. */
  version: string | null
  /** Cuotas ordinarias sin extraordinarias: para mostrar cuánto bajan con ellas. Null si no hay extraordinarias. */
  sinExtras: { cuotaMensual: number; ultimaCuota: number } | null
}

/** null: se usa la predeterminada. Un texto ilegible queda como NaN para que se rechace con su mensaje. */
export const leerReserva = (s: string | null) => (s === null || s.trim() === '' ? null : leerMonto(s) ?? NaN)

/** Huella corta y estable (FNV-1a) del contenido del plan. Sirve para identificar qué plan se usó. */
export function huella(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `P-${(h >>> 0).toString(16).padStart(8, '0')}`
}

/** Versión del plan: depende solo de sus cifras y cuotas, no de cómo se escribieron. Vale para el plan calculado y para el guardado en la cotización. */
export function versionDelPlan(p: Pick<PlanFinanciamiento, 'precioFinal' | 'reserva' | 'cuotasTotal' | 'meses' | 'cuotaMensual' | 'ultimaCuota'> & { extraordinarias?: { mes: number; monto: number }[] }): string {
  return huella(JSON.stringify({
    precioFinal: p.precioFinal, reserva: p.reserva, cuotasTotal: p.cuotasTotal, meses: p.meses, cuotaMensual: p.cuotaMensual, ultimaCuota: p.ultimaCuota,
    extraordinarias: (p.extraordinarias ?? []).map((e) => ({ mes: e.mes, monto: e.monto })),
  }))
}

export function calcularCondiciones(unit: Unit | undefined, params: PricingParams, c: CondicionesFinanciamiento, puedeDescontar: boolean): Calculo {
  const vacio: Calculo = { plan: null, entrada: null, descuentoPct: 0, reserva: 0, predeterminado: 0, error: null, errorExtras: null, errorReserva: null, version: null, sinExtras: null }
  if (!unit) return vacio
  const descuentoPct = puedeDescontar ? Number(c.descuento.replace(',', '.')) || 0 : 0
  const base = { descuentoPct, fechaReserva: c.fecha, diaPago: c.diaPago ?? DIA_PAGO_PREDETERMINADO }
  const extras = leerFilas(c.extras)
  let plan: PlanFinanciamiento | null = null
  let error: string | null = null
  let errorExtras: string | null = null
  try {
    plan = generarPlan(unit, params, { ...base, extraordinarias: extras })
  } catch (e) {
    if (extras.length) {
      // Una cuota escrita a medias no debe ocultar el plan: se muestra sin ella y se explica.
      try { plan = generarPlan(unit, params, base); errorExtras = (e as Error).message } catch (e2) { error = (e2 as Error).message }
    } else {
      error = (e as Error).message
    }
  }
  if (!plan) return { ...vacio, descuentoPct, error, errorExtras }
  return { ...calculoDePlan(plan, params, leerReserva(c.reserva)), descuentoPct, errorExtras }
}

/** Reserva, entrada y versión de un plan ya calculado: el del simulador o el que guardó una cotización. No recalcula el precio. */
export function calculoDePlan(plan: PlanFinanciamiento, params: PricingParams, montoReserva: number | null): Calculo {
  const predeterminado = Math.min(params.reservaPredeterminada ?? RESERVA_PREDETERMINADA, plan.reserva)
  const reserva = montoReserva ?? predeterminado
  let entrada: EntradaCalculada | null = null
  let error: string | null = null
  try {
    entrada = calcularEntrada({ precioFinal: plan.precioFinal, reserva, meses: plan.meses, extraordinarias: plan.extraordinarias })
  } catch (e) {
    error = (e as Error).message
  }
  return { plan, entrada, descuentoPct: plan.descuentoPct, reserva, predeterminado, error, errorExtras: null, errorReserva: errorMontoReserva(reserva, plan.reserva), version: versionDelPlan(plan),
    sinExtras: plan.extraordinarias?.length ? (({ cuotaMensual, ultimaCuota }) => ({ cuotaMensual, ultimaCuota }))(repartirCuotas(plan.cuotasTotal, plan.meses, [])) : null }
}
