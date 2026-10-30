/**
 * Entrada de AMURA a favor de Nuvarel: reserva, pago acumulado a la firma, cuotas y saldo contra entrega.
 * Todo se calcula desde el precio final de la cotización aceptada. Una simulación no crea deuda: solo al firmar.
 */

export const PCT_ACUMULADO_FIRMA = 6
export const PCT_ENTRADA_TOTAL = 20
export const PCT_CUOTAS_ENTRADA = PCT_ENTRADA_TOTAL - PCT_ACUMULADO_FIRMA

const cent = (n: number) => Math.round(n * 100) / 100

export interface EntradaInput {
  precioFinal: number
  /** Monto configurable que el cliente paga al reservar (p. ej. 500, 600 o 1.000). */
  reserva: number
  /** Meses de cuotas de la entrada: referencia 30 en edificio 1 y 42 en edificio 2. */
  meses: number
}

export interface Partida {
  tipo: 'reserva' | 'firma' | 'cuota' | 'entrega'
  concepto: string
  monto: number
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
  partidas: Partida[]
}

/** Calcula la entrada. Lanza error si la reserva supera el 6% o los datos no son válidos. */
export function calcularEntrada(p: EntradaInput): EntradaCalculada {
  if (!(p.precioFinal > 0)) throw new Error('El precio final debe ser mayor a cero.')
  if (!Number.isInteger(p.meses) || p.meses < 1 || p.meses > 120) throw new Error('Los meses de cuotas deben estar entre 1 y 120.')
  const entradaTotal = cent((p.precioFinal * PCT_ENTRADA_TOTAL) / 100)
  const acumuladoFirma = cent((p.precioFinal * PCT_ACUMULADO_FIRMA) / 100)
  if (!(p.reserva > 0)) throw new Error('La reserva debe ser mayor a cero.')
  if (p.reserva > acumuladoFirma) throw new Error('La reserva no puede superar el 6% acumulado a la firma.')
  const pagoFirma = cent(acumuladoFirma - p.reserva)
  const saldoCuotas = cent(entradaTotal - acumuladoFirma)
  const cuotaMensual = cent(saldoCuotas / p.meses)
  // La última cuota absorbe los centavos para que el total sea exacto.
  const ultimaCuota = cent(saldoCuotas - cuotaMensual * (p.meses - 1))
  const saldoEntrega = cent(p.precioFinal - entradaTotal)

  const partidas: Partida[] = [
    { tipo: 'reserva', concepto: 'Reserva (se acredita al 6%)', monto: p.reserva },
    { tipo: 'firma', concepto: 'Pago a la firma (completa el 6%)', monto: pagoFirma },
  ]
  for (let i = 1; i <= p.meses; i++) {
    partidas.push({ tipo: 'cuota', concepto: `Cuota ${i} de ${p.meses}`, monto: i === p.meses ? ultimaCuota : cuotaMensual })
  }
  partidas.push({ tipo: 'entrega', concepto: 'Saldo contra entrega (80%)', monto: saldoEntrega })

  const suma = cent(partidas.reduce((t, x) => t + x.monto, 0))
  if (Math.abs(suma - p.precioFinal) > 0.005) throw new Error(`El cronograma suma ${suma} y el precio es ${p.precioFinal}.`)

  return { entradaTotal, acumuladoFirma, pagoFirma, saldoCuotas, cuotaMensual, ultimaCuota, saldoEntrega, partidas }
}
