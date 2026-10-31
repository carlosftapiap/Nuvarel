import type { Datos } from '@/features/conexion/datos'
import { huella, leerArchivo } from '@/features/cobranza/comprobantes'
import { nombreSeguro, type AlmacenContratos } from '@/features/contratos/almacen'
import type { Medio } from './medios'
import { prepararMedio, type Preparado } from './procesar'

/**
 * Biblioteca multimedia en Supabase. La base decide quién lee y quién modifica (RLS, funciones y políticas de Storage);
 * este archivo solo traduce. Bucket propio: nunca el de comprobantes.
 */
export const BUCKET_MULTIMEDIA = 'multimedia-proyecto'
export const MAX_IMAGEN = 15 * 1024 * 1024
export const MAX_VIDEO = 50 * 1024 * 1024
export const ACEPTA_MEDIOS = 'image/jpeg,image/png,image/webp,video/mp4,video/webm'
export const LIMITES_MEDIOS = 'Fotografías JPG, PNG o WebP hasta 15 MB. Videos MP4 o WebM hasta 50 MB.'
/** Las direcciones firmadas duran más que el intervalo con que la app las renueva. */
export const FIRMA_SEGUNDOS = 4 * 60 * 60
export const RENOVAR_MS = 3 * 60 * 60 * 1000

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/* ---------------------------------------------------- validación del archivo */

/** Formato por el contenido del archivo, no por su nombre ni por lo que declara el navegador. */
export function formatoReal(b: Uint8Array): string | null {
  const texto = (desde: number, hasta: number) => String.fromCharCode(...b.slice(desde, hasta))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && texto(1, 4) === 'PNG') return 'image/png'
  if (texto(0, 4) === 'RIFF' && texto(8, 12) === 'WEBP') return 'image/webp'
  if (texto(4, 8) === 'ftyp') return 'video/mp4'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  return null
}

export async function revisarArchivo(f: File): Promise<{ mime: string; tipo: Medio['tipo'] }> {
  if (f.size === 0) throw new Error(`«${f.name}» está vacío.`)
  const mime = formatoReal(new Uint8Array(await leerArchivo(f.slice(0, 16))))
  if (!mime) throw new Error(`«${f.name}» no es una fotografía ni un video admitido. ${LIMITES_MEDIOS}`)
  const tipo = mime.startsWith('video/') ? 'video' : 'imagen'
  if (f.size > (tipo === 'video' ? MAX_VIDEO : MAX_IMAGEN)) throw new Error(`«${f.name}» supera el máximo de ${tipo === 'video' ? '50' : '15'} MB.`)
  return { mime, tipo }
}

/* --------------------------------------------------------------- lectura */

export interface VersionMedio {
  id: string; numero: number; ruta: string; rutaVertical: string | null; miniaturaRuta: string; mime: string; tamano: number | null
  ancho: number | null; alto: number | null; duracion: number | null; archivoNombre: string | null; cargadoPor: string | null; cargadoEn: string
}

export interface MedioAdmin {
  id: string; tipo: Medio['tipo']; titulo: string; descripcion: string; enDashboard: boolean; enVenta: boolean; destacado: boolean; orden: number
  activo: boolean; versionVigente: string | null; eliminadoEn: string | null; actualizadoEn: string; actualizadoPor: string | null; versiones: VersionMedio[]
}

const aVersion = (v: Fila): VersionMedio => ({
  id: String(v.id), numero: Number(v.numero), ruta: String(v.ruta), rutaVertical: s(v.ruta_vertical), miniaturaRuta: String(v.miniatura_ruta), mime: String(v.mime), tamano: n(v.tamano),
  ancho: n(v.ancho), alto: n(v.alto), duracion: n(v.duracion), archivoNombre: s(v.archivo_nombre), cargadoPor: s(v.cargado_por), cargadoEn: String(v.cargado_en),
})

/** Lo que la base deja ver a este usuario: un vendedor recibe solo lo publicado y su versión vigente. */
export async function cargarBiblioteca(d: Datos): Promise<MedioAdmin[]> {
  const [medios, versiones] = await Promise.all([
    d.select<Fila>('medios_proyecto', { orden: [{ columna: 'orden' }, { columna: 'id' }] }),
    d.select<Fila>('medio_versiones', { orden: [{ columna: 'numero', asc: false }] }),
  ])
  const todas = versiones.map((v) => ({ medio: String(v.medio_id), v: aVersion(v) }))
  return medios.map((m) => ({
    id: String(m.id), tipo: m.tipo as Medio['tipo'], titulo: String(m.titulo), descripcion: String(m.descripcion ?? ''), enDashboard: !!m.en_dashboard, enVenta: !!m.en_venta, destacado: !!m.destacado, orden: Number(m.orden),
    activo: !!m.activo, versionVigente: s(m.version_vigente), eliminadoEn: s(m.eliminado_en), actualizadoEn: String(m.actualizado_en), actualizadoPor: s(m.actualizado_por),
    versiones: todas.filter((x) => x.medio === String(m.id)).map((x) => x.v),
  }))
}

export const vigente = (m: MedioAdmin) => m.versiones.find((v) => v.id === m.versionVigente) ?? null

/** Rutas con «/» inicial: material incluido en la app. El resto se firma para el bucket privado. */
export const esIncluido = (ruta: string) => ruta.startsWith('/')

export async function firmarRutas(almacen: AlmacenContratos | null, rutas: string[]): Promise<Record<string, string>> {
  const salida: Record<string, string> = {}
  const privadas = [...new Set(rutas)].filter((r) => { if (esIncluido(r)) salida[r] = r; return !esIncluido(r) })
  if (privadas.length && almacen?.urlFirmadas) Object.assign(salida, await almacen.urlFirmadas(BUCKET_MULTIMEDIA, privadas, FIRMA_SEGUNDOS))
  return salida
}

/** Medio listo para mostrar. Sin dirección para el archivo devuelve null: nunca un enlace roto. */
export function aMedio(m: MedioAdmin, v: VersionMedio | null, urls: Record<string, string>): Medio | null {
  if (!v) return null
  const src = urls[v.ruta]
  const miniatura = urls[v.miniaturaRuta]
  if (!src || !miniatura) return null
  return {
    id: m.id, tipo: m.tipo, titulo: m.titulo, descripcion: m.descripcion, src, srcVertical: v.rutaVertical ? urls[v.rutaVertical] ?? null : null, miniatura,
    ancho: v.ancho, alto: v.alto, duracion: v.duracion, enDashboard: m.enDashboard, enVenta: m.enVenta, destacado: m.destacado,
  }
}

export const rutasDe = (v: VersionMedio) => [v.ruta, v.miniaturaRuta, ...(v.rutaVertical ? [v.rutaVertical] : [])]

/** Lo publicado. Un administrador recibe todo desde la base: aquí se dejan fuera lo oculto y lo eliminado. */
export async function cargarPublicados(d: Datos, almacen: AlmacenContratos | null): Promise<Medio[]> {
  const publicados = (await cargarBiblioteca(d)).filter((m) => m.activo && !m.eliminadoEn && (m.enDashboard || m.enVenta))
  const urls = await firmarRutas(almacen, publicados.flatMap((m) => { const v = vigente(m); return v ? rutasDe(v) : [] }))
  return publicados.map((m) => aMedio(m, vigente(m), urls)).filter((m): m is Medio => m !== null)
}

/* --------------------------------------------------------- administración */

interface Carga { ruta: string; ruta_vertical: string | null; miniatura_ruta: string; mime: string; tamano: number; ancho: number | null; alto: number | null; duracion: number | null; hash: string; nombre: string }

const rutaNueva = (nombre: string) => `archivos/${crypto.randomUUID()}-${nombreSeguro(nombre)}`

async function subirArchivos(almacen: AlmacenContratos | null, p: Preparado, vertical: { archivo: File; mime: string } | null): Promise<Carga> {
  if (!almacen) throw new Error('El almacenamiento de archivos no está disponible.')
  const hash = await huella(await leerArchivo(p.archivo))
  const carga: Carga = {
    ruta: rutaNueva(p.nombre), ruta_vertical: vertical ? rutaNueva(vertical.archivo.name) : null, miniatura_ruta: rutaNueva(p.nombreMiniatura), mime: p.mime, tamano: p.archivo.size,
    ancho: p.ancho, alto: p.alto, duracion: p.duracion, hash, nombre: p.nombreOriginal,
  }
  const subidos: string[] = []
  try {
    await almacen.subir(BUCKET_MULTIMEDIA, carga.ruta, p.archivo, p.mime); subidos.push(carga.ruta)
    await almacen.subir(BUCKET_MULTIMEDIA, carga.miniatura_ruta, p.miniatura, p.miniatura.type); subidos.push(carga.miniatura_ruta)
    if (vertical && carga.ruta_vertical) { await almacen.subir(BUCKET_MULTIMEDIA, carga.ruta_vertical, vertical.archivo, vertical.mime); subidos.push(carga.ruta_vertical) }
  } catch (e) {
    await quitarTodos(almacen, subidos)
    throw e
  }
  return carga
}

const quitarTodos = (almacen: AlmacenContratos | null, rutas: string[]) => Promise.all(rutas.map((r) => almacen?.quitar?.(BUCKET_MULTIMEDIA, r).catch(() => {})))

/** Si el servidor rechaza el registro, los archivos no quedan huérfanos. Lo vinculado lo protege la política de Storage. */
async function registrar<T>(almacen: AlmacenContratos | null, c: Carga, fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (e) {
    await quitarTodos(almacen, [c.ruta, c.miniatura_ruta, ...(c.ruta_vertical ? [c.ruta_vertical] : [])])
    throw e
  }
}

async function preparar(archivo: File, tipoEsperado: Medio['tipo'] | null, vertical: File | null) {
  const revisado = await revisarArchivo(archivo)
  if (tipoEsperado && revisado.tipo !== tipoEsperado) throw new Error(tipoEsperado === 'video' ? 'Este contenido es un video: reemplázalo con otro video.' : 'Este contenido es una fotografía: reemplázalo con otra fotografía.')
  const vert = vertical ? await revisarArchivo(vertical) : null
  if (vert && vert.tipo !== 'video') throw new Error('La versión vertical debe ser un video.')
  if (vert && revisado.tipo !== 'video') throw new Error('Solo un video tiene versión vertical.')
  return { p: await prepararMedio(archivo, revisado.mime), tipo: revisado.tipo, vertical: vert && vertical ? { archivo: vertical, mime: vert.mime } : null }
}

export interface DatosMedio { titulo: string; descripcion: string; enDashboard: boolean; enVenta: boolean }

export async function crearMedio(d: Datos, almacen: AlmacenContratos | null, datos: DatosMedio, archivo: File, vertical: File | null = null) {
  const { p, tipo, vertical: vert } = await preparar(archivo, null, vertical)
  const carga = await subirArchivos(almacen, p, vert)
  return registrar(almacen, carga, () => d.rpc<string>('medio_crear', { p_tipo: tipo, p_titulo: datos.titulo, p_descripcion: datos.descripcion, p_en_dashboard: datos.enDashboard, p_en_venta: datos.enVenta, p_archivo: carga }))
}

export async function reemplazarMedio(d: Datos, almacen: AlmacenContratos | null, medio: MedioAdmin, archivo: File, vertical: File | null = null) {
  const { p, vertical: vert } = await preparar(archivo, medio.tipo, vertical)
  const carga = await subirArchivos(almacen, p, vert)
  return registrar(almacen, carga, () => d.rpc<string>('medio_reemplazar', { p_id: medio.id, p_archivo: carga }))
}

export const actualizarMedio = (d: Datos, m: MedioAdmin, cambios: Partial<DatosMedio & { activo: boolean }>) => {
  const f = { titulo: m.titulo, descripcion: m.descripcion, enDashboard: m.enDashboard, enVenta: m.enVenta, activo: m.activo, ...cambios }
  return d.rpc('medio_actualizar', { p_id: m.id, p_titulo: f.titulo, p_descripcion: f.descripcion, p_en_dashboard: f.enDashboard, p_en_venta: f.enVenta, p_activo: f.activo })
}
export const destacarMedio = (d: Datos, id: string | null) => d.rpc('medio_destacar', { p_id: id })
export const reordenarMedios = (d: Datos, ids: string[]) => d.rpc('medio_reordenar', { p_ids: ids })
export const restaurarVersion = (d: Datos, id: string, version: string) => d.rpc('medio_restaurar_version', { p_id: id, p_version: version })
export const eliminarMedio = (d: Datos, id: string) => d.rpc('medio_eliminar', { p_id: id })
export const recuperarMedio = (d: Datos, id: string) => d.rpc('medio_recuperar', { p_id: id })
