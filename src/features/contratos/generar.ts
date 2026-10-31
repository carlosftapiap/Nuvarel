import type { Datos } from '@/features/conexion/datos'
import { cargarLogo, type LogoPdf } from '@/features/cotizaciones/pdf'
import { MIME_FIRMADO, nombreSeguro, TAMANO_MAXIMO, type AlmacenContratos } from './almacen'
import { documentoDeDocx, type Bloque } from './bloques'
import { datosParaPlantilla } from './datos'
import { construirDocxDesdeTexto } from './docxTexto'
import { leer, sha256 } from './hash'
import { BUCKET_DOCUMENTOS, BUCKET_PLANTILLAS, MIME_DOCX, TIPOS_DOCUMENTO_CONTRACTUAL, type Faltante, type InstantaneaDocumento, type Plantilla, type VersionDocumento } from './model'
import { construirPdf, pdfABytes } from './pdf'
import { llenarPlantilla } from './plantilla'
import * as api from './remoto'

/** Pasos de generar un documento: tomar los datos reales, verificar que estén completos, llenar la plantilla, armar PDF y Word, guardarlos y registrarlos. */

export interface Preparado {
  snapshot: InstantaneaDocumento
  faltantes: Faltante[]
  docx: Uint8Array | null
  pdf: Uint8Array | null
  bloques: Bloque[] | null
  /** Lo que el PDF no puede conservar de este Word. */
  avisos: string[]
}

const logoABytes = (l: LogoPdf) => {
  const base64 = l.dataUrl.slice(l.dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export const RUTA_LOGO = '/brand/logo-amura.png'

/** Base Word de una plantilla: el archivo de Legal tal cual, o el de una plantilla de texto con encabezado y numeración. */
export async function baseWord(almacen: AlmacenContratos, p: Plantilla, logo?: LogoPdf): Promise<Uint8Array> {
  if (p.formato === 'docx') {
    if (!p.archivoRuta) throw new Error('La plantilla no tiene archivo.')
    const bytes = new Uint8Array(await almacen.descargar(BUCKET_PLANTILLAS, p.archivoRuta))
    if (p.archivoHash && (await sha256(bytes)) !== p.archivoHash) throw new Error('El modelo de Word no coincide con su huella registrada: no se usará. Avisa a Legal.')
    return bytes
  }
  return construirDocxDesdeTexto(p.cuerpo ?? '', { conFirmas: true, logo: logo ? { bytes: logoABytes(logo), ancho: logo.width, alto: logo.height } : undefined })
}

/** Toma los datos reales del contrato. Si faltan datos obligatorios, devuelve cuáles y no arma archivos. */
export async function prepararDocumento(
  d: Datos, almacen: AlmacenContratos, plantilla: Plantilla, contratoId: string, manuales: Record<string, string>, opciones: { numero: number; marca?: string; logo?: LogoPdf | null; permitirFaltantes?: boolean } = { numero: 1 },
): Promise<Preparado> {
  const snapshot = await api.datosDocumento(d, contratoId, manuales)
  const faltan = await api.faltantes(d, plantilla.id, snapshot)
  if (faltan.length && !opciones.permitirFaltantes) return { snapshot, faltantes: faltan, docx: null, pdf: null, bloques: null, avisos: [] }
  const logo = opciones.logo === undefined ? await cargarLogo(RUTA_LOGO) : opciones.logo ?? undefined
  const base = await baseWord(almacen, plantilla, logo)
  const { docx } = llenarPlantilla(base, datosParaPlantilla(snapshot))
  const documento = documentoDeDocx(docx)
  const pdf = pdfABytes(construirPdf(documento, { titulo: TIPOS_DOCUMENTO_CONTRACTUAL[plantilla.tipoDocumento], codigo: snapshot.contrato.codigo, version: opciones.numero, marca: opciones.marca }))
  return { snapshot, faltantes: faltan, docx, pdf, bloques: documento.bloques, avisos: documento.avisos }
}

const idUnico = () => globalThis.crypto.randomUUID()

/** Guarda PDF y Word en el almacenamiento privado y registra la versión. El servidor vuelve a validar plantilla, datos y permisos. */
export async function generarDocumento(
  d: Datos, almacen: AlmacenContratos, plantilla: Plantilla, contratoId: string, manuales: Record<string, string>, p: Preparado, motivo: string,
): Promise<string> {
  if (!p.pdf || !p.docx) throw new Error('Faltan datos obligatorios: completa lo que se indica antes de generar el documento.')
  const carpeta = `${contratoId}/${idUnico()}`
  const pdf = { ruta: `${carpeta}/documento.pdf`, hash: await sha256(p.pdf), tamano: p.pdf.byteLength }
  const docx = { ruta: `${carpeta}/documento.docx`, hash: await sha256(p.docx), tamano: p.docx.byteLength }
  await almacen.subir(BUCKET_DOCUMENTOS, pdf.ruta, new Blob([new Uint8Array(p.pdf)], { type: 'application/pdf' }), 'application/pdf')
  await almacen.subir(BUCKET_DOCUMENTOS, docx.ruta, new Blob([new Uint8Array(p.docx)], { type: MIME_DOCX }), MIME_DOCX)
  return api.registrarDocumento(d, contratoId, plantilla.id, manuales, p.snapshot, pdf, docx, motivo)
}

export type ArchivoVersion = 'pdf' | 'docx' | 'firmado'

/** Descarga un archivo de una versión y comprueba su huella: si no coincide con la registrada al generarlo, no se entrega. */
export async function obtenerArchivo(almacen: AlmacenContratos, v: VersionDocumento, cual: ArchivoVersion): Promise<{ blob: Blob; nombre: string }> {
  const [ruta, hash, ext, mime] = cual === 'pdf' ? [v.pdfRuta, v.pdfHash, 'pdf', 'application/pdf'] : cual === 'docx' ? [v.docxRuta, v.docxHash, 'docx', MIME_DOCX]
    : [v.firmadoRuta, v.firmadoHash, (v.firmadoNombre?.split('.').pop() ?? 'pdf').toLowerCase(), 'application/octet-stream']
  if (!ruta) throw new Error(cual === 'docx' ? 'Esta versión no tiene archivo Word.' : 'Esta versión no tiene ese archivo.')
  const bytes = new Uint8Array(await almacen.descargar(BUCKET_DOCUMENTOS, ruta))
  if (hash && (await sha256(bytes)) !== hash) throw new Error('El archivo no coincide con su huella de integridad registrada. No se descargó; avisa a Legal.')
  const nombre = `${v.plantillaNombre.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-v${v.numero}${cual === 'firmado' ? '-firmado' : ''}.${ext}`
  return { blob: new Blob([bytes], { type: cual === 'firmado' && v.firmadoNombre?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : mime }), nombre }
}

export function validarFirmado(f: { name: string; type: string; size: number }): string | null {
  if (!(MIME_FIRMADO as readonly string[]).includes(f.type)) return `«${f.name}»: el documento firmado debe ser PDF, JPG o PNG.`
  if (f.size === 0) return `«${f.name}» está vacío.`
  if (f.size > TAMANO_MAXIMO) return `«${f.name}» supera el máximo de 25 MB.`
  return null
}

/** Guarda el documento firmado en el almacenamiento privado y lo adjunta a la versión emitida. No la marca como firmada: Legal debe validarla. */
export async function adjuntarDocumentoFirmado(d: Datos, almacen: AlmacenContratos, v: VersionDocumento, archivo: File, fechaFirma: string, motivo: string): Promise<void> {
  const error = validarFirmado(archivo)
  if (error) throw new Error(error)
  const bytes = new Uint8Array(await leer(archivo))
  const hash = await sha256(bytes)
  const ruta = `${v.contratoId}/${v.id}/firmado-${hash.slice(0, 8)}-${nombreSeguro(archivo.name)}`
  await almacen.subir(BUCKET_DOCUMENTOS, ruta, archivo, archivo.type)
  await api.adjuntarFirmado(d, v.id, { ruta, hash, tamano: archivo.size, nombre: archivo.name, mime: archivo.type }, fechaFirma, motivo)
}

export function descargarBlob(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
