import type { DatosCobranza } from './api'
import type { Comprobante } from './comprobantes'
import type { Tablero } from './tablero'

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
}

export function porVerificar(d: DatosCobranza, tablero: Tablero, actorId: string): FilaPorVerificar[] {
  const dpt = (codigo: string) => {
    const n = d.departamentos.get(codigo)
    return n ? `AMURA · Dpto. ${n} (${codigo})` : `AMURA · ${codigo}`
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
      })
    }
  }
  // Los que más esperan, primero.
  return filas.sort((a, b) => a.cargadoEn.localeCompare(b.cargadoEn))
}
