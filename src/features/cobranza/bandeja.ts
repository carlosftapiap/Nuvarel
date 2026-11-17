import type { DatosCobranza } from './api'
import type { Comprobante } from './comprobantes'
import type { Tablero } from './tablero'
import { numeroComercial } from '@/features/inventario/nomenclatura'
import { bloqueoVerificacion } from '@/features/reservas/model'

/**
 * Bandeja de Finanzas: comprobantes reportados que esperan verificación, de reservas y de cuotas.
 * Reportado no es confirmado: el monto reportado se muestra aparte de lo ya confirmado y del saldo.
 */
export interface FilaPorVerificar {
  comprobante: Comprobante
  tipo: 'reserva' | 'pago'
  /** Reserva o pago del contrato que se revisa. */
  id: string
  cliente: string
  unidad: string
  /** Código de la reserva o del contrato. */
  numero: string
  reportado: number
  confirmado: number
  saldo: number
  fecha: string
  cargadoEn: string
  /** Quien lo registró o solicitó: no puede decidirlo. */
  propio: boolean
  /** Reserva: motivo por el que Finanzas todavía no puede confirmarla; null si puede. */
  bloqueo: string | null
  /** Otros comprobantes no rechazados con el mismo monto, fecha y banco: posible pago registrado dos veces. */
  posiblesDuplicados: number
}

/** Comprobantes no rechazados que coinciden en monto, fecha y banco (la referencia repetida ya la impide la base). */
export function posiblesDuplicados(todos: Comprobante[], c: Comprobante): number {
  const banco = c.banco.trim().toLowerCase()
  return todos.filter((k) => k.id !== c.id && k.estado !== 'rechazado' && Math.abs(k.monto - c.monto) < 0.005 && k.fecha === c.fecha && k.banco.trim().toLowerCase() === banco).length
}

export function porVerificar(d: DatosCobranza, tablero: Tablero, actorId: string): FilaPorVerificar[] {
  const dpt = (codigo: string) => {
    const n = d.departamentos.get(codigo)
    return n ? `AMURA · Dpto. ${n}` : `AMURA · Dpto. ${numeroComercial(codigo)}`
  }
  const filas: FilaPorVerificar[] = []
  for (const c of d.comprobantes.filter((k) => k.estado === 'reportado')) {
    if (c.reservaId) {
      const r = d.reservas?.find((x) => x.id === c.reservaId)
      if (!r || r.estado !== 'solicitada') continue
      filas.push({
        comprobante: c, tipo: 'reserva', id: r.id, cliente: r.clienteNombre, unidad: dpt(r.unidad), numero: r.codigo,
        reportado: c.monto, confirmado: 0, saldo: r.montoReserva, fecha: c.fecha, cargadoEn: c.cargadoEn,
        propio: c.cargadoPor === actorId || r.creadaPor.id === actorId,
        bloqueo: bloqueoVerificacion(r),
        posiblesDuplicados: posiblesDuplicados(d.comprobantes, c),
      })
    } else if (c.pagoId) {
      const p = d.pagos.find((x) => x.id === c.pagoId)
      if (!p || p.estado !== 'registrado') continue
      const r = tablero.contratos.find((x) => x.contrato.id === p.contratoId)
      if (!r) continue
      filas.push({
        comprobante: c, tipo: 'pago', id: p.id, cliente: r.contrato.cliente, unidad: dpt(r.contrato.unidad), numero: r.contrato.codigo,
        reportado: c.monto, confirmado: r.cobradoEntrada, saldo: r.saldoEntrada, fecha: c.fecha, cargadoEn: c.cargadoEn,
        propio: c.cargadoPor === actorId || p.registradoPor === actorId,
        bloqueo: null,
        posiblesDuplicados: posiblesDuplicados(d.comprobantes, c),
      })
    }
  }
  // Los que más esperan, primero.
  return filas.sort((a, b) => a.cargadoEn.localeCompare(b.cargadoEn))
}
