import { round2 } from '@/features/inventario/pricing'
import type { Reserva } from '@/features/reservas/model'
import type { Movimiento } from './comprobantes'
import type { PagoFila } from './tablero'

/**
 * Reservas dentro de Cobranzas. Una solicitud no es un ingreso ni una cuenta por cobrar contractual: solo se muestra lo acordado.
 * Recaudado es únicamente lo que Finanzas confirmó.
 */
export interface FilaReserva {
  reserva: Reserva
  acordado: number
  /** Confirmado por Finanzas; lo reportado aún no cuenta. */
  pagado: number
  saldo: number
  estado: 'pendiente_pago' | 'por_verificar' | 'por_aprobar' | 'aprobada' | 'en_contrato' | 'anulada'
  /** Sigue activa con la vigencia cumplida. No se anula sola. */
  vencida: boolean
}

export const ESTADO_FILA: Record<FilaReserva['estado'], { label: string; tono: string }> = {
  pendiente_pago: { label: 'Pendiente de pago', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  por_verificar: { label: 'Pago por verificar', tono: 'bg-yellow-100 text-yellow-800 ring-yellow-300' },
  por_aprobar: { label: 'Pago verificado · por aprobar', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  aprobada: { label: 'Aprobada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  en_contrato: { label: 'Con contrato', tono: 'bg-violet-50 text-violet-700 ring-violet-200' },
  anulada: { label: 'Anulada', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

export function filaReserva(r: Reserva, conContrato: Set<string>, hoy = ''): FilaReserva {
  const pagado = r.montoRecibido ?? 0
  const anulada = r.estado === 'anulada'
  const estado: FilaReserva['estado'] = anulada ? 'anulada'
    : conContrato.has(r.id) ? 'en_contrato'
      : r.estado === 'confirmada' ? 'aprobada'
        : r.estado === 'pago_verificado' ? 'por_aprobar'
          : r.comprobante ? 'por_verificar' : 'pendiente_pago'
  return { reserva: r, acordado: r.montoReserva, pagado, saldo: anulada ? 0 : round2(Math.max(0, r.montoReserva - pagado)), estado, vencida: !anulada && estado !== 'en_contrato' && !!hoy && !!r.vigenciaHasta && r.vigenciaHasta < hoy }
}

const suma = (xs: number[]) => round2(xs.reduce((t, x) => t + x, 0))

export interface IndicadoresReservas {
  pendientes: { cantidad: number; acordado: number }
  porVerificar: { cantidad: number; deReservas: number; monto: number }
  /** Neto: bruto menos devoluciones autorizadas. Lo retenido sigue en poder del receptor. */
  recaudado: number
  bruto: number
  devuelto: number
  retenido: number
  vencidas: number
}

/**
 * `contratosVigentes`: un contrato copia el pago de su reserva como primer pago verificado, así que esa reserva no se suma otra vez.
 * Si el contrato se anula, el ingreso vuelve a contarse por su reserva.
 */
export function indicadoresReservas(filas: FilaReserva[], pagos: PagoFila[], contratosVigentes: Set<string>, movimientos: Pick<Movimiento, 'tipo' | 'monto' | 'estado'>[] = []): IndicadoresReservas {
  const pendientes = filas.filter((f) => f.estado === 'pendiente_pago')
  const reportadas = filas.filter((f) => f.estado === 'por_verificar')
  const vigentes = pagos.filter((p) => contratosVigentes.has(p.contratoId))
  const reportados = vigentes.filter((p) => p.estado === 'registrado')
  // Un pago confirmado de una reserva anulada sigue en el historial; lo que salga después es otro movimiento.
  const bruto = suma([
    ...vigentes.filter((p) => p.estado === 'verificado').map((p) => p.monto),
    ...filas.filter((f) => f.estado === 'por_aprobar' || f.estado === 'aprobada' || f.estado === 'anulada').map((f) => f.pagado),
  ])
  const autorizados = movimientos.filter((m) => m.estado === 'autorizado')
  const devuelto = suma(autorizados.filter((m) => m.tipo === 'devolucion').map((m) => m.monto))
  return {
    pendientes: { cantidad: pendientes.length, acordado: suma(pendientes.map((f) => f.acordado)) },
    porVerificar: { cantidad: reportadas.length + reportados.length, deReservas: reportadas.length, monto: suma([...reportadas.map((f) => f.acordado), ...reportados.map((p) => p.monto)]) },
    recaudado: round2(bruto - devuelto),
    bruto,
    devuelto,
    retenido: suma(autorizados.filter((m) => m.tipo === 'retencion').map((m) => m.monto)),
    vencidas: filas.filter((f) => f.vencida).length,
  }
}
