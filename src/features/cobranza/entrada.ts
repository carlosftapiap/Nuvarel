/**
 * Entrada de AMURA a favor de Nuvarel: reserva, pago acumulado a la firma, cuotas y saldo contra entrega.
 * Todo se calcula desde el precio final de la cotización aceptada. Una simulación no crea deuda: solo al firmar.
 */

import { repartirCuotas, type CuotaExtraordinaria } from '@/features/financiamiento/plan'
import { round2 } from '@/features/inventario/pricing'

export const PCT_ACUMULADO_FIRMA = 6
export const PCT_ENTRADA_TOTAL = 20
export const PCT_CUOTAS_ENTRADA = PCT_ENTRADA_TOTAL - PCT_ACUMULADO_FIRMA

// Mismo redondeo y mismas partes que Inventario y Cotizaciones: firma + cuotas + saldo = precio, sin diferencias de un centavo.
const cent = round2

export interface EntradaInput {
  precioFinal: number
  /** Monto configurable que el cliente paga al reservar (p. ej. 500, 600 o 1.000). */
  reserva: number
  /** Meses de cuotas de la entrada: referencia 30 en edificio 1 y 42 en edificio 2. */
  meses: number
  extraordinarias?: CuotaExtraordinaria[]
}

export interface Partida {
  tipo: 'reserva' | 'firma' | 'cuota' | 'extraordinaria' | 'entrega'
  concepto: string
  monto: number
  /** Mes del plan, en cuotas y extraordinarias. */
  mes?: number
}

export interface EntradaCalculada {
  entradaTotal: number
  acumuladoFirma: number
  /** Pago adicional a la firma para completar el 6%. Nunca cobra la reserva dos veces. */
  pagoFirma: number
  saldoCuotas: number
  cuotaMensual: number
  ultimaCuota: number
  saldoEntrega: number
  extraordinarias: CuotaExtraordinaria[]
  partidas: Partida[]
}

/** Calcula la entrada. Lanza error si la reserva supera el 6% o los datos no son válidos. */
export function calcularEntrada(p: EntradaInput): EntradaCalculada {
  if (!(p.precioFinal > 0)) throw new Error('El precio final debe ser mayor a cero.')
  if (!Number.isInteger(p.meses) || p.meses < 1 || p.meses > 120) throw new Error('Los meses de cuotas deben estar entre 1 y 120.')
  const acumuladoFirma = cent((p.precioFinal * PCT_ACUMULADO_FIRMA) / 100)
  const saldoCuotas = cent((p.precioFinal * PCT_CUOTAS_ENTRADA) / 100)
  const entradaTotal = cent(acumuladoFirma + saldoCuotas)
  if (!(p.reserva > 0)) throw new Error('La reserva debe ser mayor a cero.')
  if (p.reserva > acumuladoFirma) throw new Error('La reserva no puede superar el 6% acumulado a la firma.')
  const pagoFirma = cent(acumuladoFirma - p.reserva)
  const { cuotaMensual, ultimaCuota, extraordinarias } = repartirCuotas(saldoCuotas, p.meses, p.extraordinarias)
  const saldoEntrega = cent(p.precioFinal - entradaTotal)

  const partidas: Partida[] = [
    { tipo: 'reserva', concepto: 'Reserva (se acredita al 6%)', monto: p.reserva },
    { tipo: 'firma', concepto: 'Pago a la firma (completa el 6%)', monto: pagoFirma },
  ]
  for (let i = 1; i <= p.meses; i++) {
    partidas.push({ tipo: 'cuota', concepto: `Cuota ${i} de ${p.meses}`, monto: i === p.meses ? ultimaCuota : cuotaMensual, mes: i })
    for (const e of extraordinarias.filter((x) => x.mes === i)) partidas.push({ tipo: 'extraordinaria', concepto: 'Cuota extraordinaria', monto: e.monto, mes: i })
  }
  partidas.push({ tipo: 'entrega', concepto: 'Saldo contra entrega (80%)', monto: saldoEntrega })

  const suma = cent(partidas.reduce((t, x) => t + x.monto, 0))
  if (Math.abs(suma - p.precioFinal) > 0.005) throw new Error(`El cronograma suma ${suma} y el precio es ${p.precioFinal}.`)

  return { entradaTotal, acumuladoFirma, pagoFirma, saldoCuotas, cuotaMensual, ultimaCuota, saldoEntrega, extraordinarias, partidas }
}
