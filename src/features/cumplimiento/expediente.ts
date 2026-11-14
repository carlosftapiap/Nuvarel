import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { nombreSeguro } from '@/features/contratos/almacen'
import { errorArchivo, huella, leerArchivo } from '@/features/cobranza/comprobantes'

/**
 * Expediente del cliente y revisión de Cumplimiento (fase 3). Los archivos van al bucket privado expediente-clientes;
 * abrirlos pasa por el servidor, que deja la descarga en auditoría.
 */
export const BUCKET_EXPEDIENTE = 'expediente-clientes'

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export type TipoPersona = 'natural' | 'juridica'
export type EstadoDocumento = 'falta' | 'cargado' | 'observado' | 'aprobado' | 'rechazado' | 'vencido'
export type EstadoRevision = 'pendiente' | 'observado' | 'aprobado' | 'rechazado'
export interface Persona { clientId: string | null; buyerId: string | null }

export const ESTADO_DOCUMENTO: Record<EstadoDocumento, { label: string; tono: string }> = {
  falta: { label: 'Falta', tono: 'bg-slate-50 text-slate-600 ring-slate-200' },
  cargado: { label: 'Por revisar', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  observado: { label: 'Observado', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aprobado: { label: 'Aprobado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazado: { label: 'Rechazado', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
  vencido: { label: 'Vencido', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}
export const ESTADO_REVISION: Record<EstadoRevision | 'sin_enviar', { label: string; tono: string }> = {
  sin_enviar: { label: 'Sin enviar a Cumplimiento', tono: 'bg-slate-50 text-slate-600 ring-slate-200' },
  pendiente: { label: 'En revisión de Cumplimiento', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  observado: { label: 'Observado por Cumplimiento', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aprobado: { label: 'Aprobado por Cumplimiento', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazado: { label: 'Rechazado por Cumplimiento', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export interface Requisito {
  persona: Persona; nombrePersona: string; tipoPersona: TipoPersona; tipo: string; nombre: string; estado: EstadoDocumento
  documento: string | null; archivoNombre: string | null; observacion: string | null; cargadoPor: string | null; cargadoEn: string | null; vigenciaHasta: string | null
}
export interface Revision { id: string; estado: EstadoRevision; observaciones: string | null; registradoPor: string; registradoNombre: string; registradoEn: string }

const aRequisito = (r: Fila): Requisito => ({
  persona: { clientId: s(r.client_id), buyerId: s(r.buyer_id) }, nombrePersona: String(r.persona), tipoPersona: r.tipo_persona as TipoPersona,
  tipo: String(r.tipo), nombre: String(r.nombre), estado: r.estado as EstadoDocumento, documento: s(r.documento), archivoNombre: s(r.archivo_nombre),
  observacion: s(r.observacion), cargadoPor: s(r.cargado_por), cargadoEn: s(r.cargado_en), vigenciaHasta: s(r.vigencia_hasta)?.slice(0, 10) ?? null,
})

/** Documentos obligatorios de cada comprador del contrato con el estado de su versión vigente. Sin la migración: lista vacía. */
export const cargarRequisitos = (d: Datos, contrato: string) =>
  d.rpc<Fila[]>('cumplimiento_requisitos', { p_contract: contrato }).then((r) => (r ?? []).map(aRequisito)).catch(() => null)

export const cargarRevisiones = (d: Datos, contrato: string): Promise<Revision[]> =>
  d.select<Fila>('cumplimiento_revisiones', { filtros: { contract_id: contrato }, orden: [{ columna: 'registrado_en' }] })
    .then((f) => f.map((r) => ({ id: String(r.id), estado: r.estado as EstadoRevision, observaciones: s(r.observaciones), registradoPor: String(r.registrado_por), registradoNombre: s(r.registrado_nombre) ?? 'Usuario', registradoEn: String(r.registrado_en) })))
    .catch(() => [])

/** Documentos de una sola persona (ficha del cliente), con el mismo cálculo que el servidor. */
export async function requisitosCliente(d: Datos, clientId: string, nombre: string, tipoPersona: TipoPersona): Promise<Requisito[] | null> {
  try {
    const [tipos, docs] = await Promise.all([
      d.select<Fila>('expediente_tipos', { filtros: { tipo_persona: tipoPersona, activo: true, obligatorio: true }, orden: [{ columna: 'orden' }] }),
      d.select<Fila>('expediente_documentos', { filtros: { client_id: clientId }, orden: [{ columna: 'cargado_en', asc: false }] }),
    ])
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' })
    return tipos.map((t) => {
      const v = docs.find((x) => x.tipo === t.clave && x.estado !== 'reemplazado')
      const vig = s(v?.vigencia_hasta)?.slice(0, 10) ?? null
      const estado: EstadoDocumento = !v ? 'falta' : v.estado === 'aprobado' && vig && vig < hoy ? 'vencido' : (v.estado as EstadoDocumento)
      return aRequisito({ client_id: clientId, buyer_id: null, persona: nombre, tipo_persona: tipoPersona, tipo: t.clave, nombre: t.nombre, estado,
        documento: v?.id ?? null, archivo_nombre: v?.archivo_nombre, observacion: v?.observacion, cargado_por: v?.cargado_por, cargado_en: v?.cargado_en, vigencia_hasta: vig })
    })
  } catch {
    return null
  }
}

export async function cargarDocumento(d: Datos, almacen: AlmacenContratos | null, p: Persona, tipo: string, archivo: File | null, vigencia: string | null) {
  if (!archivo) throw new Error('Adjunta el documento.')
  const error = errorArchivo(archivo)
  if (error) throw new Error(error.replace('el comprobante debe ser', 'el documento debe ser'))
  if (!almacen) throw new Error('El almacenamiento de documentos no está disponible.')
  const carpeta = p.clientId ? `clientes/${p.clientId}` : `compradores/${p.buyerId}`
  const ruta = `${carpeta}/${crypto.randomUUID()}-${nombreSeguro(archivo.name)}`
  const hash = await huella(await leerArchivo(archivo))
  await almacen.subir(BUCKET_EXPEDIENTE, ruta, archivo, archivo.type)
  try {
    return await d.rpc<string>('expediente_cargar', {
      p_client: p.clientId, p_buyer: p.buyerId, p_tipo: tipo, p_archivo: { ruta, nombre: archivo.name, mime: archivo.type, tamano: archivo.size, hash }, p_vigencia: vigencia || null,
    })
  } catch (e) {
    await almacen.quitar?.(BUCKET_EXPEDIENTE, ruta).catch(() => {})
    throw e
  }
}

export const revisarDocumento = (d: Datos, id: string, estado: 'observado' | 'aprobado' | 'rechazado', observacion: string) =>
  d.rpc('expediente_revisar', { p_id: id, p_estado: estado, p_observacion: observacion || null })
export const definirTipoPersona = (d: Datos, p: Persona, tipo: TipoPersona) =>
  d.rpc('expediente_definir_tipo_persona', { p_client: p.clientId, p_buyer: p.buyerId, p_tipo: tipo })
export const enviarACumplimiento = (d: Datos, contrato: string, nota: string) => d.rpc('cumplimiento_enviar', { p_contract: contrato, p_nota: nota || null })
export const resolverCumplimiento = (d: Datos, contrato: string, estado: 'observado' | 'aprobado' | 'rechazado', observaciones: string) =>
  d.rpc('cumplimiento_resolver', { p_contract: contrato, p_estado: estado, p_observaciones: observaciones || null })

function guardar(bytes: ArrayBuffer, nombre: string) {
  const url = URL.createObjectURL(new Blob([bytes]))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** El servidor registra cada descarga y solo devuelve lo que esa persona puede abrir; Storage vuelve a comprobarlo. */
export async function descargarDocumentos(d: Datos, almacen: AlmacenContratos | null, ids: string[]) {
  if (!almacen) throw new Error('El almacenamiento de documentos no está disponible.')
  const filas = await d.rpc<Fila[]>('expediente_registrar_descarga', { p_ids: ids })
  for (const f of filas ?? []) guardar(await almacen.descargar(BUCKET_EXPEDIENTE, String(f.ruta)), String(f.archivo_nombre ?? 'documento'))
  return (filas ?? []).length
}

/** Versión vigente de la lista de documentos obligatorios (provisional hasta la definitiva de Jarval). */
export const cargarCatalogo = (d: Datos) =>
  d.select<Fila>('expediente_catalogo', { orden: [{ columna: 'version', asc: false }], limite: 1 })
    .then(([f]) => (f ? { version: Number(f.version), provisional: Boolean(f.provisional) } : null)).catch(() => null)
export const etiquetaCatalogo = (c: { version: number; provisional: boolean } | null) => (c ? `Lista ${c.provisional ? 'provisional' : 'definitiva'} de documentos · versión ${c.version}` : null)
