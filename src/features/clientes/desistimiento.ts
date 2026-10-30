import type { Datos } from '@/features/conexion/datos'

/** Desistimiento del comprador. Lo ejecuta el servidor en una sola transacción; la pantalla solo pide los datos y muestra qué pasará. */
type Fila = Record<string, unknown>

export type MotivoDesistimiento = 'cambio_decision' | 'sin_financiamiento' | 'precio' | 'compro_otro' | 'personal' | 'otro'
export const MOTIVOS_DESISTIMIENTO: Record<MotivoDesistimiento, string> = {
  cambio_decision: 'Cambió de decisión', sin_financiamiento: 'No obtuvo financiamiento', precio: 'Precio o condiciones',
  compro_otro: 'Compró en otro proyecto', personal: 'Motivos personales', otro: 'Otro motivo',
}

export interface Desistimiento {
  id: string
  clienteId: string
  codigoUnidad: string | null
  motivo: MotivoDesistimiento
  observaciones: string
  unidadDetalle: string
  montoRecibido: number | null
  revision: 'no_aplica' | 'pendiente' | 'revisada'
  revisionNota: string | null
  registradoPor: string
  registradoEn: string
}

export interface Previsualizacion {
  bloqueo: string | null
  unidad: string | null
  unidad_estado: string | null
  unidad_destino: string | null
  reserva: string | null
  reserva_estado: string | null
  comprobante: string | null
  monto_recibido: number | null
}

export const aDesistimiento = (d: Fila): Desistimiento => ({
  id: String(d.id), clienteId: String(d.client_id), codigoUnidad: d.codigo_unidad ? String(d.codigo_unidad) : null, motivo: d.motivo as MotivoDesistimiento,
  observaciones: String(d.observaciones ?? ''), unidadDetalle: String(d.unidad_detalle ?? ''), montoRecibido: d.monto_recibido === null || d.monto_recibido === undefined ? null : Number(d.monto_recibido),
  revision: d.revision_financiera as Desistimiento['revision'], revisionNota: d.revision_nota ? String(d.revision_nota) : null, registradoPor: String(d.registrado_nombre), registradoEn: String(d.registrado_en),
})

export const previsualizar = (d: Datos, cliente: string, oportunidad: string | null) => d.rpc<Previsualizacion>('desistimientos_previsualizar', { p_client: cliente, p_oportunidad: oportunidad })
export const registrar = (d: Datos, cliente: string, oportunidad: string | null, motivo: MotivoDesistimiento, observaciones: string) =>
  d.rpc<string>('desistimientos_registrar', { p_client: cliente, p_oportunidad: oportunidad, p_motivo: motivo, p_observaciones: observaciones })
export const marcarRevisado = (d: Datos, id: string, nota: string) => d.rpc('desistimientos_marcar_revisado', { p_id: id, p_nota: nota })
