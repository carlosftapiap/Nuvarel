import type { Datos } from '@/features/conexion/datos'

/** Desistimiento del comprador. Lo decide y lo ejecuta el servidor en una sola transacción; la pantalla pide los datos y muestra qué pasará. */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export type MotivoDesistimiento = 'cambio_decision' | 'sin_financiamiento' | 'precio' | 'compro_otro' | 'personal' | 'otro'
export const MOTIVOS_DESISTIMIENTO: Record<MotivoDesistimiento, string> = {
  cambio_decision: 'Cambió de decisión', sin_financiamiento: 'No obtuvo financiamiento', precio: 'Precio o condiciones',
  compro_otro: 'Compró en otro proyecto', personal: 'Motivos personales', otro: 'Otro motivo',
}

export type NivelDesistimiento = 'directo' | 'supervisor_o_gerencia' | 'gerencia_y_finanzas'
export type EstadoDesistimiento = 'pendiente' | 'aplicado' | 'rechazado'

export const ESTADO_DESISTIMIENTO: Record<EstadoDesistimiento, { label: string; tono: string }> = {
  pendiente: { label: 'Pendiente de autorización', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aplicado: { label: 'Aplicado', tono: 'bg-slate-100 text-slate-700 ring-slate-200' },
  rechazado: { label: 'Rechazado', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export interface Desistimiento {
  id: string
  clienteId: string
  oportunidadId: string | null
  reservaId: string | null
  codigoUnidad: string | null
  motivo: MotivoDesistimiento
  observaciones: string
  nivel: NivelDesistimiento
  estado: EstadoDesistimiento
  registradoPorId: string
  registradoPor: string
  registradoEn: string
  autorizadoPorId: string | null
  autorizadoPor: string | null
  autorizacionNota: string | null
  montoRecibido: number | null
  revisadoPorId: string | null
  revisadoPor: string | null
  revisionNota: string | null
  rechazadoPor: string | null
  motivoRechazo: string | null
  unidadDetalle: string
}

export interface Previsualizacion {
  bloqueo: string | null
  nivel: NivelDesistimiento
  unidad: string | null
  unidad_estado: string | null
  unidad_destino: string | null
  reserva: string | null
  reserva_estado: string | null
  comprobante: string | null
  monto_recibido: number | null
}

export const aDesistimiento = (d: Fila): Desistimiento => ({
  id: String(d.id), clienteId: String(d.client_id), oportunidadId: s(d.opportunity_id), reservaId: s(d.reservation_id), codigoUnidad: s(d.codigo_unidad),
  motivo: d.motivo as MotivoDesistimiento, observaciones: String(d.observaciones ?? ''), nivel: d.nivel as NivelDesistimiento, estado: d.estado as EstadoDesistimiento,
  registradoPorId: String(d.registrado_por), registradoPor: String(d.registrado_nombre), registradoEn: String(d.registrado_en),
  autorizadoPorId: s(d.autorizado_por), autorizadoPor: s(d.autorizado_nombre), autorizacionNota: s(d.autorizacion_nota),
  montoRecibido: d.monto_recibido === null || d.monto_recibido === undefined ? null : Number(d.monto_recibido),
  revisadoPorId: s(d.revisada_por), revisadoPor: s(d.revisada_nombre), revisionNota: s(d.revision_nota),
  rechazadoPor: s(d.rechazado_nombre), motivoRechazo: s(d.motivo_rechazo), unidadDetalle: String(d.unidad_detalle ?? ''),
})

export const previsualizar = (d: Datos, cliente: string, oportunidad: string | null) => d.rpc<Previsualizacion>('desistimientos_previsualizar', { p_client: cliente, p_oportunidad: oportunidad })
export const registrar = (d: Datos, cliente: string, oportunidad: string | null, motivo: MotivoDesistimiento, observaciones: string) =>
  d.rpc<string>('desistimientos_registrar', { p_client: cliente, p_oportunidad: oportunidad, p_motivo: motivo, p_observaciones: observaciones })
export const autorizar = (d: Datos, id: string, nota: string) => d.rpc<string>('desistimientos_autorizar', { p_id: id, p_nota: nota })
export const revisarFinanzas = (d: Datos, id: string, nota: string) => d.rpc<string>('desistimientos_revisar_finanzas', { p_id: id, p_nota: nota })
export const rechazar = (d: Datos, id: string, motivo: string) => d.rpc('desistimientos_rechazar', { p_id: id, p_motivo: motivo })

/** Qué falta para que una solicitud pendiente se aplique, en palabras del usuario. */
export function faltaPara(x: Desistimiento) {
  if (x.nivel === 'supervisor_o_gerencia') return 'Falta la autorización de un supervisor o de Gerencia'
  const falta = [!x.autorizadoPorId && 'la autorización de Gerencia', !x.revisadoPorId && 'la revisión de Finanzas'].filter(Boolean)
  return `Falta ${falta.join(' y ')}`
}
