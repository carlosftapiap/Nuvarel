import { calcularTablero, TRAMOS_MORA, type ContratoFila, type CuotaFila, type PagoFila } from '@/features/cobranza/tablero'

/**
 * Cálculos del panel gerencial. Reciben lo que la base entregó con RLS: `null` significa «sin acceso», no cero.
 * No guardan nada ni inventan cifras: solo cuentan y suman lo que ya existe.
 */
export type EdificioFiltro = 'todos' | 1 | 2

export interface ContratoPanel extends ContratoFila { reservaId: string | null; fechaFirma: string | null }
export interface ReservaFila { id: string; unidad: string; estado: string; vigenciaHasta: string | null }
export interface CotizacionFila { unidad: string; estado: string }
export interface OportunidadFila { clienteId: string; unidad: string | null }
export interface FrenteObra { codigo: string; nombre: string; pesosAprobados: boolean; avance: number | null; actividadesConAvance: number }

export interface EntradaPanel {
  clientes: { id: string }[] | null
  oportunidades: OportunidadFila[] | null
  cotizaciones: CotizacionFila[] | null
  reservas: ReservaFila[] | null
  contratos: ContratoPanel[] | null
  cuotas: CuotaFila[] | null
  pagos: PagoFila[] | null
  plantillasPendientes: number | null
  desistimientosPendientes: number | null
  obra: FrenteObra[] | null
}

export const edificioDe = (unidad: string): 1 | 2 => (unidad.startsWith('E2') ? 2 : 1)
const enFiltro = (unidad: string | null, f: EdificioFiltro) => f === 'todos' || (unidad !== null && edificioDe(unidad) === f)
const suma = (xs: number[]) => Math.round((xs.reduce((t, x) => t + x, 0) + Number.EPSILON) * 100) / 100
const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)

export interface PuntoMes { mes: string; ventas: number; cobros: number }

export interface Panel {
  clientes: number | null
  reservasActivas: number | null
  contratosFirmados: number | null
  ventasFirmadas: number | null
  cobrosConfirmados: number | null
  saldoPendiente: number | null
  embudo: { clave: string; etiqueta: string; valor: number | null }[]
  meses: PuntoMes[]
  cuotasVencidas: { cuotas: number; contratos: number; monto: number } | null
  /** `dias` negativo: ya venció y la reserva sigue abierta. */
  reservasPorVencer: { id: string; unidad: string; dias: number }[] | null
  contratosPendientesFirma: number | null
  comprobantesPendientes: number | null
  /** Cartera de contratos firmados: lo pactado en cuotas de entrada, lo cobrado y lo que falta. */
  cartera: { pactado: number; cobrado: number; porVencer: number; vencido: number; saldo: number } | null
  /** Saldo vencido por tramo de días de atraso (el mismo criterio que Cobranza). */
  mora: { id: string; etiqueta: string; monto: number }[] | null
  /** Reservas abiertas por estado. */
  reservasPorEstado: { estado: string; cantidad: number }[] | null
}

/** Una reserva sigue abierta mientras no esté anulada ni haya pasado a contrato vigente. */
export function reservasAbiertas(reservas: ReservaFila[], contratos: ContratoPanel[] | null) {
  const contratadas = new Set((contratos ?? []).filter((c) => c.estado !== 'anulado').map((c) => c.reservaId))
  return reservas.filter((r) => r.estado !== 'anulada' && !contratadas.has(r.id))
}

export function calcularPanel(e: EntradaPanel, filtro: EdificioFiltro, hoy: string): Panel {
  const contratos = e.contratos?.filter((c) => enFiltro(c.unidad, filtro)) ?? null
  const ids = new Set(contratos?.map((c) => c.id))
  const cuotas = e.cuotas?.filter((q) => ids.has(q.contratoId)) ?? null
  const pagos = e.pagos?.filter((p) => ids.has(p.contratoId)) ?? null
  const tablero = contratos && cuotas && pagos ? calcularTablero(contratos, cuotas, pagos, hoy) : null
  const firmados = contratos?.filter((c) => c.estado === 'firmado') ?? null
  const reservas = e.reservas ? reservasAbiertas(e.reservas.filter((r) => enFiltro(r.unidad, filtro)), e.contratos) : null
  const cotizaciones = e.cotizaciones?.filter((q) => q.estado !== 'anulada' && enFiltro(q.unidad, filtro)) ?? null

  // Clientes: el total real; con un edificio elegido, quienes tienen una oportunidad en él.
  const clientes = e.clientes === null ? null
    : filtro === 'todos' ? e.clientes.length
      : e.oportunidades === null ? null
        : new Set(e.oportunidades.filter((o) => enFiltro(o.unidad, filtro)).map((o) => o.clienteId)).size

  const vigentes = new Set(contratos?.filter((c) => c.estado !== 'anulado').map((c) => c.id))
  const cobrados = pagos?.filter((p) => p.estado === 'verificado' && vigentes.has(p.contratoId)) ?? null

  const porMes = new Map<string, PuntoMes>()
  const punto = (m: string) => { const v = porMes.get(m) ?? { mes: m, ventas: 0, cobros: 0 }; porMes.set(m, v); return v }
  for (const c of firmados ?? []) if (c.fechaFirma) punto(c.fechaFirma.slice(0, 7)).ventas += c.precio
  for (const p of cobrados ?? []) punto(p.fecha.slice(0, 7)).cobros += p.monto

  const firmadosRes = tablero?.contratos.filter((r) => r.contrato.estado === 'firmado') ?? []
  const porEstado = new Map<string, number>()
  for (const r of reservas ?? []) porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1)
  return {
    cartera: tablero ? { pactado: tablero.pactado, cobrado: tablero.cobrado, porVencer: tablero.porVencer + tablero.venceHoy, vencido: tablero.vencido, saldo: tablero.saldo } : null,
    mora: tablero ? TRAMOS_MORA.map((t) => ({ id: t.id, etiqueta: t.label, monto: tablero.mora[t.id] })) : null,
    reservasPorEstado: reservas ? [...porEstado].map(([estado, cantidad]) => ({ estado, cantidad })) : null,
    clientes,
    reservasActivas: reservas ? reservas.length : null,
    contratosFirmados: firmados ? firmados.length : null,
    ventasFirmadas: firmados ? suma(firmados.map((c) => c.precio)) : null,
    cobrosConfirmados: cobrados ? suma(cobrados.map((p) => p.monto)) : null,
    saldoPendiente: tablero ? tablero.saldo : null,
    embudo: [
      { clave: 'clientes', etiqueta: 'Clientes', valor: clientes },
      { clave: 'cotizaciones', etiqueta: 'Cotizaciones', valor: cotizaciones ? cotizaciones.length : null },
      { clave: 'reservas', etiqueta: 'Reservas', valor: reservas ? reservas.length : null },
      { clave: 'ventas', etiqueta: 'Ventas firmadas', valor: firmados ? firmados.length : null },
    ],
    meses: [...porMes.values()].map((m) => ({ mes: m.mes, ventas: suma([m.ventas]), cobros: suma([m.cobros]) })).sort((a, b) => (a.mes < b.mes ? -1 : 1)),
    cuotasVencidas: tablero ? {
      cuotas: firmadosRes.reduce((t, r) => t + r.cuotas.filter((q) => q.esEntrada && q.situacion === 'vencida').length, 0),
      contratos: firmadosRes.filter((r) => r.vencido > 0).length,
      monto: tablero.vencido,
    } : null,
    reservasPorVencer: reservas ? reservas
      .filter((r) => r.vigenciaHasta)
      .map((r) => ({ id: r.id, unidad: r.unidad, dias: dias(r.vigenciaHasta!, hoy) }))
      .filter((r) => r.dias <= 3)
      .sort((a, b) => a.dias - b.dias) : null,
    contratosPendientesFirma: contratos ? contratos.filter((c) => c.estado === 'borrador').length : null,
    comprobantesPendientes: tablero ? tablero.comprobantesPendientes : null,
  }
}
