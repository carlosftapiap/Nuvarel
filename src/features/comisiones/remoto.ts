import type { Datos } from '@/features/conexion/datos'

/** Comisiones: del vendedor (una comisión del 100 %, lista para pago con promesa firmada y 6 % verificado) o el esquema anterior por tramos. El servidor decide estados y condiciones con los datos vivos de Contratos y Cobranzas; la pantalla los muestra. */
export type EstadoTramo = 'calculada' | 'pendiente' | 'habilitada' | 'pagada' | 'anulada'
export type EstadoComision = 'calculada' | 'vigente' | 'anulada'
export type TipoMovimiento = 'pago' | 'reverso_pago' | 'ajuste' | 'por_recuperar'
export type Esquema = 'vendedor' | 'dos_tramos'

export const ESTADO_TRAMO: Record<EstadoTramo, { label: string; tono: string }> = {
  calculada: { label: 'Comisión calculada', tono: 'bg-slate-100 text-slate-700 ring-slate-200' },
  pendiente: { label: 'Pendiente de condiciones', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  habilitada: { label: 'Habilitada para liquidación', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  pagada: { label: 'Pagada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulada: { label: 'Anulada', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
export const TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = { pago: 'Pago confirmado', reverso_pago: 'Reverso de pago', ajuste: 'Ajuste', por_recuperar: 'Por recuperar' }

export interface Condicion { texto: string; ok: boolean }
export interface Tramo {
  id: string
  numero: 1 | 2
  porcentaje: number
  monto: number
  estado: EstadoTramo
  condiciones: Condicion[]
  cumple: boolean
  /** Comisión del vendedor con la promesa firmada y el 6 % verificado: Finanzas puede registrar el desembolso. */
  listaParaPago: boolean
  habilitadaPor: string | null
  habilitadaNombre: string | null
  honorario: { monto: number; fecha: string; referencia: string; nombre: string } | null
  pago: { fecha: string; monto: number; beneficiario: string | null; referencia: string | null } | null
}
export interface Movimiento {
  id: string
  tipo: TipoMovimiento
  monto: number
  fecha: string | null
  beneficiario: string | null
  referencia: string | null
  motivo: string
  registradoNombre: string | null
  registradoEn: string
  revertidoEn: string | null
  motivoReverso: string | null
  recuperadoEn: string | null
  recuperadoNombre: string | null
  notaRecuperacion: string | null
}
export interface Comision {
  id: string
  estado: EstadoComision
  porcentaje: number
  precioBase: number
  montoTotal: number
  motivoAnulacion: string | null
  esquema: Esquema
  /** Vendedor responsable de la venta, fijo al formalizarla. */
  beneficiario: string | null
  beneficiarioId: string | null
  umbralPagoPct: number | null
  contrato: string
  contratoEstado: string
  fechaContrato: string
  unidad: string
  cliente: string
  origen: string | null
  asesor: string | null
  corredor: string | null
  ajustes: number
  porRecuperar: number
  tramos: Tramo[]
  movimientos: Movimiento[]
}
export interface Politica { aprobada: boolean; documento: string | null; nombre: string | null; en: string | null }
/** pagosHabilitados: false mientras la política esté pendiente de formalización contractual. */
export interface Parametros { esquema: Esquema; umbralPagoPct: number; pagosHabilitados: boolean }
export interface DatosComisiones { porcentaje: number; parametros: Parametros; politica: Politica; comisiones: Comision[] }

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => Number(v ?? 0)

const aTramo = (t: Fila): Tramo => {
  const h = t.honorario as Fila | null
  const p = t.pago as Fila | null
  return {
    id: String(t.id), numero: n(t.numero) as 1 | 2, porcentaje: n(t.porcentaje), monto: n(t.monto), estado: t.estado as EstadoTramo,
    condiciones: (t.condiciones as Condicion[]) ?? [], cumple: t.cumple === true, listaParaPago: t.lista_para_pago === true, habilitadaPor: s(t.habilitada_por), habilitadaNombre: s(t.habilitada_nombre),
    honorario: h ? { monto: n(h.monto), fecha: String(h.fecha), referencia: String(h.referencia), nombre: String(h.nombre ?? '') } : null,
    pago: p ? { fecha: String(p.fecha), monto: n(p.monto), beneficiario: s(p.beneficiario), referencia: s(p.referencia) } : null,
  }
}
const aMovimiento = (x: Fila): Movimiento => ({
  id: String(x.id), tipo: x.tipo as TipoMovimiento, monto: n(x.monto), fecha: s(x.fecha), beneficiario: s(x.beneficiario), referencia: s(x.referencia), motivo: String(x.motivo),
  registradoNombre: s(x.registrado_nombre), registradoEn: String(x.registrado_en), revertidoEn: s(x.revertido_en), motivoReverso: s(x.motivo_reverso),
  recuperadoEn: s(x.recuperado_en), recuperadoNombre: s(x.recuperado_nombre), notaRecuperacion: s(x.nota_recuperacion),
})

export async function cargarComisiones(d: Datos): Promise<DatosComisiones> {
  const r = await d.rpc<Fila>('comisiones_listar')
  const p = r.politica as Fila
  const q = (r.parametros as Fila | null) ?? {}
  return {
    porcentaje: n(r.porcentaje),
    parametros: { esquema: (q.esquema as Esquema) ?? 'vendedor', umbralPagoPct: n(q.umbral_pago_pct), pagosHabilitados: q.pagos_vendedor_habilitados === true },
    politica: { aprobada: p.aprobada === true, documento: s(p.documento), nombre: s(p.nombre), en: s(p.en) },
    comisiones: ((r.comisiones as Fila[]) ?? []).map((m) => ({
      id: String(m.id), estado: m.estado as EstadoComision, porcentaje: n(m.porcentaje), precioBase: n(m.precio_base), montoTotal: n(m.monto_total), motivoAnulacion: s(m.motivo_anulacion),
      esquema: (m.esquema as Esquema) ?? 'dos_tramos', beneficiario: s(m.beneficiario), beneficiarioId: s(m.beneficiario_id), umbralPagoPct: m.umbral_pago_pct === null || m.umbral_pago_pct === undefined ? null : n(m.umbral_pago_pct),
      contrato: String(m.contrato), contratoEstado: String(m.contrato_estado), fechaContrato: String(m.fecha_contrato), unidad: String(m.unidad), cliente: String(m.cliente), origen: s(m.origen),
      asesor: s(m.asesor), corredor: s(m.corredor), ajustes: n(m.ajustes), porRecuperar: n(m.por_recuperar),
      tramos: ((m.tramos as Fila[]) ?? []).map(aTramo), movimientos: ((m.movimientos as Fila[]) ?? []).map(aMovimiento),
    })),
  }
}

export const definirPorcentaje = (d: Datos, porcentaje: number, motivo: string) => d.rpc<number>('comisiones_definir_porcentaje', { p_porcentaje: porcentaje, p_motivo: motivo })
export const aprobarPolitica = (d: Datos, documento: string, motivo: string) => d.rpc('comisiones_aprobar_politica', { p_documento: documento, p_motivo: motivo })
export const revocarPolitica = (d: Datos, motivo: string) => d.rpc('comisiones_revocar_politica', { p_motivo: motivo })
export const registrarHonorario = (d: Datos, tramo: string, monto: number, fecha: string, referencia: string) => d.rpc('comisiones_registrar_honorario', { p_tramo: tramo, p_monto: monto, p_fecha: fecha, p_referencia: referencia })
export const quitarHonorario = (d: Datos, tramo: string, motivo: string) => d.rpc('comisiones_quitar_honorario', { p_tramo: tramo, p_motivo: motivo })
export const habilitar = (d: Datos, tramo: string, motivo: string) => d.rpc('comisiones_habilitar', { p_tramo: tramo, p_motivo: motivo })
export const deshabilitar = (d: Datos, tramo: string, motivo: string) => d.rpc('comisiones_deshabilitar', { p_tramo: tramo, p_motivo: motivo })
export const confirmarPago = (d: Datos, tramo: string, fecha: string, beneficiario: string, referencia: string, confirmo: boolean) =>
  d.rpc('comisiones_confirmar_pago', { p_tramo: tramo, p_fecha: fecha, p_beneficiario: beneficiario, p_referencia: referencia, p_confirmo: confirmo })
export const reversarPago = (d: Datos, tramo: string, motivo: string) => d.rpc('comisiones_reversar_pago', { p_tramo: tramo, p_motivo: motivo })
export const ajustar = (d: Datos, comision: string, monto: number, motivo: string, evidencia: string) => d.rpc('comisiones_ajustar', { p_comision: comision, p_monto: monto, p_motivo: motivo, p_evidencia: evidencia })
export const registrarRecuperacion = (d: Datos, movimiento: string, nota: string) => d.rpc('comisiones_registrar_recuperacion', { p_movimiento: movimiento, p_nota: nota })

/** Comisión de cada venta, para mostrarla en Ventas. Sin permiso de comisiones, la lista llega vacía. */
export async function comisionesPorContrato(d: Datos): Promise<Map<string, Comision>> {
  try {
    return new Map((await cargarComisiones(d)).comisiones.map((c) => [c.contrato, c]))
  } catch {
    return new Map()
  }
}

/** Totales por estado de los tramos. Lo anulado no cuenta. */
export function resumen(comisiones: Comision[]) {
  const suma = (e: EstadoTramo) => comisiones.flatMap((c) => c.tramos).filter((t) => t.estado === e).reduce((a, t) => a + t.monto, 0)
  return {
    calculada: suma('calculada'), pendiente: suma('pendiente'), habilitada: suma('habilitada'), pagada: suma('pagada'),
    porRecuperar: comisiones.reduce((a, c) => a + c.porRecuperar, 0),
  }
}
