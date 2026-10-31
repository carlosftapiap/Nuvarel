import type { Datos } from '@/features/conexion/datos'
import type {
  CampoCatalogo, Comprador, EntidadVendedora, EstadoCivil, EventoDocumento, EventoPlantilla, Faltante, InstantaneaDocumento, Plantilla, VariablePlantilla, VersionDocumento,
} from './model'

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null)

const aPlantilla = (f: Fila): Plantilla => ({
  id: String(f.id), familiaId: String(f.familia_id), version: Number(f.version), nombre: String(f.nombre), tipoDocumento: f.tipo_documento as Plantilla['tipoDocumento'],
  tipoOperacion: f.tipo_operacion as Plantilla['tipoOperacion'], formato: f.formato as Plantilla['formato'], cuerpo: s(f.cuerpo), archivoRuta: s(f.archivo_ruta),
  archivoNombre: s(f.archivo_nombre), archivoHash: s(f.archivo_hash), archivoTamano: n(f.archivo_tamano), variables: (f.variables as VariablePlantilla[] | null) ?? [], notas: t(f.notas),
  estado: f.estado as Plantilla['estado'], creadaNombre: String(f.creada_nombre), creadaEn: String(f.creada_en), aprobadaNombre: s(f.aprobada_nombre), aprobadaEn: s(f.aprobada_en),
  retiradaNombre: s(f.retirada_nombre), retiradaEn: s(f.retirada_en), retiradaMotivo: s(f.retirada_motivo),
})

const aVersion = (f: Fila): VersionDocumento => ({
  id: String(f.id), contratoId: String(f.contract_id), plantillaId: String(f.plantilla_id), plantillaNombre: String(f.plantilla_nombre), plantillaVersion: Number(f.plantilla_version),
  tipoDocumento: String(f.tipo_documento), numero: Number(f.numero), estado: f.estado as VersionDocumento['estado'], pdfRuta: String(f.pdf_ruta), pdfHash: String(f.pdf_hash),
  pdfTamano: n(f.pdf_tamano), docxRuta: s(f.docx_ruta), docxHash: s(f.docx_hash), docxTamano: n(f.docx_tamano), generadoNombre: String(f.generado_nombre), generadoEn: String(f.generado_en),
  generadoMotivo: String(f.generado_motivo), emitidoNombre: s(f.emitido_nombre), emitidoEn: s(f.emitido_en), firmadoRuta: s(f.firmado_ruta), firmadoNombre: s(f.firmado_nombre),
  firmadoHash: s(f.firmado_hash), firmadoFecha: dia(f.firmado_fecha), firmadoCargadoNombre: s(f.firmado_cargado_nombre), firmadoCargadoEn: s(f.firmado_cargado_en),
  firmaValidadaNombre: s(f.firma_validada_nombre), firmaValidadaEn: s(f.firma_validada_en), anuladoNombre: s(f.anulado_nombre), anuladoEn: s(f.anulado_en), anuladoMotivo: s(f.anulado_motivo),
})

const aComprador = (f: Fila): Comprador => ({
  id: String(f.id), rol: f.rol as Comprador['rol'], nombre: String(f.nombre), documento: t(f.documento), nacionalidad: t(f.nacionalidad), estadoCivil: (s(f.estado_civil) as EstadoCivil | null),
  domicilio: t(f.domicilio), ciudad: t(f.ciudad), telefono: t(f.telefono), email: t(f.email), representaA: s(f.representa_a), poderDetalle: t(f.poder_detalle), porcentaje: n(f.porcentaje), retiradoEn: s(f.retirado_en),
})

/* ------------------------------------------------------------------ lectura */

export async function cargarPlantillas(d: Datos): Promise<Plantilla[]> {
  return (await d.select<Fila>('contract_templates', { orden: [{ columna: 'creada_en', asc: false }] })).map(aPlantilla)
}
export async function cargarEventosPlantilla(d: Datos, plantillaId: string): Promise<EventoPlantilla[]> {
  const filas = await d.select<Fila>('contract_template_events', { filtros: { plantilla_id: plantillaId }, orden: [{ columna: 'fecha', asc: false }] })
  return filas.map((f) => ({ id: String(f.id), plantillaId, accion: String(f.accion), usuario: String(f.usuario), motivo: String(f.motivo), fecha: String(f.fecha) }))
}
export async function cargarCampos(d: Datos): Promise<CampoCatalogo[]> {
  const filas = await d.select<Fila>('contract_fields', { orden: [{ columna: 'grupo' }, { columna: 'clave' }] })
  return filas.map((f) => ({ clave: String(f.clave), grupo: String(f.grupo), etiqueta: String(f.etiqueta), tipo: f.tipo as CampoCatalogo['tipo'], derivaDe: s(f.deriva_de), descripcion: t(f.descripcion) }))
}
export async function cargarEntidad(d: Datos): Promise<EntidadVendedora | null> {
  const [f] = await d.select<Fila>('entidad_vendedora', { filtros: { id: 1 } })
  if (!f) return null
  return {
    razonSocial: t(f.razon_social), ruc: t(f.ruc), domicilio: t(f.domicilio), representanteNombre: t(f.representante_nombre), representanteCargo: t(f.representante_cargo),
    representanteDocumento: t(f.representante_documento), email: t(f.email), telefono: t(f.telefono), actualizadoNombre: s(f.actualizado_nombre), actualizadoEn: s(f.actualizado_en),
  }
}
export async function cargarVersiones(d: Datos, contratoId: string): Promise<VersionDocumento[]> {
  return (await d.select<Fila>('contract_document_versions', { filtros: { contract_id: contratoId }, orden: [{ columna: 'numero', asc: false }] })).map(aVersion)
}
export async function cargarEventosDocumento(d: Datos, contratoId: string): Promise<EventoDocumento[]> {
  const filas = await d.select<Fila>('contract_document_events', { filtros: { contract_id: contratoId }, orden: [{ columna: 'fecha', asc: false }] })
  return filas.map((f) => ({ id: String(f.id), versionId: s(f.version_id), accion: String(f.accion), usuario: String(f.usuario), motivo: t(f.motivo), fecha: String(f.fecha) }))
}
export async function cargarCompradores(d: Datos, contratoId: string): Promise<Comprador[]> {
  return (await d.select<Fila>('contract_buyers', { filtros: { contract_id: contratoId }, orden: [{ columna: 'orden' }] })).map(aComprador)
}

/* ---------------------------------------------------------------- acciones */

export interface DatosPlantilla {
  nombre: string
  tipo_documento: string
  tipo_operacion: string
  formato: 'docx' | 'texto'
  cuerpo?: string | null
  archivo_ruta?: string | null
  archivo_nombre?: string | null
  archivo_hash?: string | null
  archivo_tamano?: number | null
  variables: VariablePlantilla[]
  notas: string
}
export const guardarPlantilla = (d: Datos, id: string | null, familiaId: string | null, datos: DatosPlantilla, motivo: string) =>
  d.rpc<string>('contratos_plantilla_guardar', { p_id: id, p_familia: familiaId, p_datos: datos, p_motivo: motivo })
export const aprobarPlantilla = (d: Datos, id: string, motivo: string) => d.rpc('contratos_plantilla_aprobar', { p_id: id, p_motivo: motivo })
export const retirarPlantilla = (d: Datos, id: string, motivo: string) => d.rpc('contratos_plantilla_retirar', { p_id: id, p_motivo: motivo })

export const guardarEntidad = (d: Datos, e: Omit<EntidadVendedora, 'actualizadoNombre' | 'actualizadoEn'>, motivo: string) =>
  d.rpc('contratos_entidad_guardar', {
    p_datos: { razon_social: e.razonSocial, ruc: e.ruc, domicilio: e.domicilio, representante_nombre: e.representanteNombre, representante_cargo: e.representanteCargo,
      representante_documento: e.representanteDocumento, email: e.email, telefono: e.telefono },
    p_motivo: motivo,
  })

export interface DatosComprador {
  rol: 'comprador' | 'apoderado'
  nombre: string
  documento: string
  nacionalidad: string
  estado_civil: string | null
  domicilio: string
  ciudad: string
  telefono: string
  email: string
  representa_a: string | null
  poder_detalle: string
  porcentaje: number | null
}
export const guardarComprador = (d: Datos, contratoId: string, id: string | null, datos: DatosComprador, motivo: string) =>
  d.rpc<string>('contratos_comprador_guardar', { p_contract: contratoId, p_id: id, p_datos: datos, p_motivo: motivo })
export const retirarComprador = (d: Datos, id: string, motivo: string) => d.rpc('contratos_comprador_retirar', { p_id: id, p_motivo: motivo })
export const guardarPrincipal = (d: Datos, contratoId: string, datos: { documento: string; domicilio: string; ciudad: string; estado_civil: string | null; nacionalidad: string }, motivo: string) =>
  d.rpc('contratos_comprador_principal_guardar', { p_contract: contratoId, p_datos: datos, p_motivo: motivo })

export const datosDocumento = (d: Datos, contratoId: string, manuales: Record<string, string>) =>
  d.rpc<InstantaneaDocumento>('contratos_datos_documento', { p_contract: contratoId, p_manuales: manuales })
export const faltantes = async (d: Datos, plantillaId: string, datos: InstantaneaDocumento) =>
  (await d.rpc<Faltante[] | null>('contratos_faltantes', { p_plantilla: plantillaId, p_datos: datos })) ?? []

export interface ArchivoRegistrado { ruta: string; hash: string; tamano: number }
export const registrarDocumento = (d: Datos, contratoId: string, plantillaId: string, manuales: Record<string, string>, datos: InstantaneaDocumento, pdf: ArchivoRegistrado, docx: ArchivoRegistrado | null, motivo: string) =>
  d.rpc<string>('contratos_documento_registrar', { p_contract: contratoId, p_plantilla: plantillaId, p_manuales: manuales, p_datos: datos, p_pdf: pdf, p_docx: docx, p_motivo: motivo })
export const emitirDocumento = (d: Datos, versionId: string, motivo: string) => d.rpc('contratos_documento_emitir', { p_id: versionId, p_motivo: motivo })
export const adjuntarFirmado = (d: Datos, versionId: string, archivo: ArchivoRegistrado & { nombre: string; mime: string }, fechaFirma: string, motivo: string) =>
  d.rpc('contratos_documento_adjuntar_firmado', { p_id: versionId, p_archivo: archivo, p_fecha_firma: fechaFirma, p_motivo: motivo })
export const validarFirma = (d: Datos, versionId: string, motivo: string) => d.rpc('contratos_documento_validar_firma', { p_id: versionId, p_motivo: motivo })
export const anularDocumento = (d: Datos, versionId: string, motivo: string) => d.rpc('contratos_documento_anular', { p_id: versionId, p_motivo: motivo })

/** Todas las versiones de documentos que la persona puede ver (la base filtra por permiso y alcance). */
export async function cargarTodasVersiones(d: Datos): Promise<VersionDocumento[]> {
  return (await d.select<Fila>('contract_document_versions', { orden: [{ columna: 'generado_en', asc: false }] })).map(aVersion)
}
