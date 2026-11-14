import type { Datos } from '@/features/conexion/datos'
import type { EstadoRevision } from './expediente'

/**
 * Bandeja del Oficial de Cumplimiento: reúne los documentos y los contratos enviados, separados en
 * por revisar, por corregir y aprobados, más el historial de decisiones. Solo lee; las decisiones
 * se toman en el expediente del cliente o del contrato con las funciones de siempre.
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export type Grupo = 'pendiente' | 'corregir' | 'aprobado'

export interface DocumentoBandeja {
  id: string; tipo: string; nombre: string; estado: 'cargado' | 'observado' | 'aprobado' | 'rechazado'; grupo: Grupo
  persona: string; clientId: string | null; contratoId: string | null; contrato: string | null
  archivoNombre: string | null; observacion: string | null; cargadoEn: string; revisadoEn: string | null
}
export interface ContratoBandeja {
  id: string; codigo: string; cliente: string; unidad: string; estadoContrato: string; estado: EstadoRevision; grupo: Grupo
  observaciones: string | null; enviadoEn: string; ultimaEn: string
}
export interface Decision { id: string; cuando: string; que: string; sobre: string; estado: string; quien: string | null; nota: string | null }
export interface Bandeja { documentos: DocumentoBandeja[]; contratos: ContratoBandeja[]; historial: Decision[] }

const GRUPO_DOC: Record<DocumentoBandeja['estado'], Grupo> = { cargado: 'pendiente', observado: 'corregir', rechazado: 'corregir', aprobado: 'aprobado' }
const GRUPO_REV: Record<EstadoRevision, Grupo> = { pendiente: 'pendiente', observado: 'corregir', rechazado: 'corregir', aprobado: 'aprobado' }
const DECISION: Record<string, string> = { pendiente: 'Enviado a Cumplimiento', observado: 'Observado', aprobado: 'Aprobado', rechazado: 'Rechazado' }

export function armarBandeja(t: { docs: Fila[]; tipos: Fila[]; clientes: Fila[]; compradores: Fila[]; contratos: Fila[]; revisiones: Fila[] }): Bandeja {
  const nombreTipo = new Map(t.tipos.map((x) => [String(x.clave), String(x.nombre)]))
  const cliente = new Map(t.clientes.map((x) => [String(x.id), String(x.nombre)]))
  const comprador = new Map(t.compradores.map((x) => [String(x.id), x]))
  const contrato = new Map(t.contratos.map((x) => [String(x.id), x]))

  const persona = (d: Fila) => (d.client_id ? (cliente.get(String(d.client_id)) ?? 'Cliente') : String(comprador.get(String(d.buyer_id))?.nombre ?? 'Comprador'))
  const documentos = t.docs.filter((d) => d.estado !== 'reemplazado').map((d): DocumentoBandeja => {
    const b = d.buyer_id ? comprador.get(String(d.buyer_id)) : undefined
    // Los documentos del cliente sirven a su contrato vigente, si ya lo tiene.
    const c = b ? contrato.get(String(b.contract_id)) : t.contratos.find((x) => x.client_id === d.client_id && x.estado !== 'anulado')
    const estado = d.estado as DocumentoBandeja['estado']
    return {
      id: String(d.id), tipo: String(d.tipo), nombre: nombreTipo.get(String(d.tipo)) ?? String(d.tipo), estado, grupo: GRUPO_DOC[estado],
      persona: persona(d),
      clientId: s(d.client_id), contratoId: s(c?.id), contrato: s(c?.codigo),
      archivoNombre: s(d.archivo_nombre), observacion: s(d.observacion), cargadoEn: String(d.cargado_en), revisadoEn: s(d.revisado_en),
    }
  }).sort((a, b) => a.cargadoEn.localeCompare(b.cargadoEn))

  const porContrato = new Map<string, Fila[]>()
  for (const r of [...t.revisiones].sort((a, b) => String(a.registrado_en).localeCompare(String(b.registrado_en)))) {
    porContrato.set(String(r.contract_id), [...(porContrato.get(String(r.contract_id)) ?? []), r])
  }
  const contratos = [...porContrato.entries()].flatMap(([id, revs]): ContratoBandeja[] => {
    const c = contrato.get(id)
    if (!c || c.estado === 'anulado') return []
    const ultima = revs.at(-1)!
    const envio = revs.findLast((r) => r.estado === 'pendiente') ?? revs[0]
    const estado = ultima.estado as EstadoRevision
    return [{
      id, codigo: String(c.codigo), cliente: cliente.get(String(c.client_id)) ?? 'Cliente', unidad: String(c.codigo_unidad), estadoContrato: String(c.estado),
      estado, grupo: GRUPO_REV[estado], observaciones: s(ultima.observaciones), enviadoEn: String(envio.registrado_en), ultimaEn: String(ultima.registrado_en),
    }]
  }).sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn))

  // Cada versión revisada de un documento es una decisión; la reemplazada conserva la observación que motivó el cambio.
  const historial: Decision[] = [
    ...t.docs.filter((d) => d.revisado_en).map((d) => ({
      id: `d-${String(d.id)}`, cuando: String(d.revisado_en), que: nombreTipo.get(String(d.tipo)) ?? String(d.tipo), sobre: persona(d),
      estado: d.estado === 'reemplazado' ? 'Observado (luego reemplazado)' : DECISION[String(d.estado)], quien: null, nota: s(d.observacion),
    })),
    ...t.revisiones.map((r) => {
      const c = contrato.get(String(r.contract_id))
      return { id: `r-${String(r.id)}`, cuando: String(r.registrado_en), que: `Contrato ${String(c?.codigo ?? '')}`.trim(), sobre: cliente.get(String(c?.client_id)) ?? 'Cliente',
        estado: DECISION[String(r.estado)] ?? String(r.estado), quien: s(r.registrado_nombre), nota: s(r.observaciones) }
    }),
  ].sort((a, b) => b.cuando.localeCompare(a.cuando))

  return { documentos, contratos, historial }
}

export async function cargarBandeja(d: Datos): Promise<Bandeja> {
  const [docs, tipos, clientes, compradores, contratos, revisiones] = await Promise.all([
    d.select<Fila>('expediente_documentos'),
    d.select<Fila>('expediente_tipos'),
    d.select<Fila>('clients'),
    d.select<Fila>('contract_buyers').catch(() => []),
    d.select<Fila>('contracts').catch(() => []),
    d.select<Fila>('cumplimiento_revisiones').catch(() => []),
  ])
  return armarBandeja({ docs, tipos, clientes, compradores, contratos, revisiones })
}
