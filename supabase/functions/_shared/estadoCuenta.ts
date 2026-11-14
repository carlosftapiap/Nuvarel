/**
 * Estado de cuenta de un contrato: mismas reglas que installment_status y contract_balances.
 * Sin APIs de Deno ni del navegador: lo usan la app (PDF) y, más adelante, el correo al comprador.
 */
import { aplicarPagos, estadoCuota, type Situacion } from './cobranza.ts'

const cent = (n: number) => Math.round(n * 100) / 100

export interface EntradaEstadoCuenta {
  hoy: string
  contrato: { codigo: string; estado: 'borrador' | 'firmado' | 'anulado'; precio: number }
  cuotas: { numero: number; concepto: string; vencimiento: string | null; monto: number }[]
  pagos: { id: string; fecha: string; referencia: string; monto: number; estado: 'registrado' | 'verificado' | 'rechazado' | 'anulado'; recibo: string | null; concepto: string | null }[]
  /** Autorizaciones de Finanzas, también las anuladas: solo cuentan las vigentes. */
  aplicaciones: { monto: number; autorizadoEn: string; motivo: string; anulada: boolean }[]
}

export interface FilaCuotaEstado { numero: number; concepto: string; vencimiento: string | null; monto: number; pagado: number; saldo: number; situacion: Situacion }

export interface EstadoCuenta {
  hoy: string
  entrada: { pactado: number; pagado: number; saldo: number; vencido: number; cuotas: FilaCuotaEstado[] }
  pagosConfirmados: EntradaEstadoCuenta['pagos']
  /** Reportados y aún sin verificar: se muestran aparte y no se suman. */
  pagosPendientes: EntradaEstadoCuenta['pagos']
  totalConfirmado: number
  saldoAFavor: number
  financiamiento: { monto: number; aplicado: number; saldo: number; aplicaciones: EntradaEstadoCuenta['aplicaciones'] }
}

export function calcularEstadoCuenta(e: EntradaEstadoCuenta): EstadoCuenta {
  const confirmados = e.pagos.filter((p) => p.estado === 'verificado').sort((a, b) => a.fecha.localeCompare(b.fecha))
  const totalConfirmado = cent(confirmados.reduce((t, p) => t + p.monto, 0))
  const vigentes = e.aplicaciones.filter((a) => !a.anulada)
  const { pagado, excedente } = aplicarPagos(e.cuotas, totalConfirmado, vigentes.reduce((t, a) => t + a.monto, 0))
  const filas = [...e.cuotas].sort((a, b) => a.numero - b.numero).map((q) => {
    const est = estadoCuota({ monto: q.monto, pagado: pagado.get(q.numero) ?? 0, vencimiento: q.vencimiento }, e.hoy)
    return { ...q, pagado: est.pagado, saldo: est.saldo, situacion: est.situacion }
  })
  const entrada = filas.filter((q) => q.vencimiento !== null)
  const fin = filas.filter((q) => q.vencimiento === null)
  const suma = (xs: FilaCuotaEstado[], f: (q: FilaCuotaEstado) => number) => cent(xs.reduce((t, q) => t + f(q), 0))
  return {
    hoy: e.hoy,
    entrada: {
      pactado: suma(entrada, (q) => q.monto), pagado: suma(entrada, (q) => q.pagado), saldo: suma(entrada, (q) => q.saldo),
      vencido: e.contrato.estado === 'firmado' ? suma(entrada.filter((q) => q.situacion === 'vencida'), (q) => q.saldo) : 0,
      cuotas: entrada,
    },
    pagosConfirmados: confirmados,
    pagosPendientes: e.pagos.filter((p) => p.estado === 'registrado'),
    totalConfirmado,
    saldoAFavor: cent(excedente),
    financiamiento: { monto: suma(fin, (q) => q.monto), aplicado: suma(fin, (q) => q.pagado), saldo: suma(fin, (q) => q.saldo), aplicaciones: vigentes },
  }
}
