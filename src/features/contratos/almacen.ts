import { supabase } from '@/lib/supabase'

/** Almacenamiento privado de plantillas y documentos contractuales. La base decide quién sube y quién descarga (políticas de Storage). */
export interface AlmacenContratos {
  subir(bucket: string, ruta: string, archivo: Blob, mime: string): Promise<void>
  descargar(bucket: string, ruta: string): Promise<ArrayBuffer>
  /** Quita un archivo aún no vinculado. Lo vinculado lo protegen las políticas de Storage. */
  quitar?(bucket: string, ruta: string): Promise<void>
  /** Direcciones temporales para mostrar archivos privados, por ruta. Las rutas sin permiso no aparecen. */
  urlFirmadas?(bucket: string, rutas: string[], segundos: number): Promise<Record<string, string>>
}

const traducir = (mensaje: string) =>
  /row-level security|not authorized|Unauthorized/i.test(mensaje) ? 'No tienes permiso para este archivo.' : /not found|does not exist|Object not found/i.test(mensaje) ? 'El archivo no se encontró en el almacenamiento.' : mensaje

export const almacenContratosSupabase: AlmacenContratos = {
  async subir(bucket, ruta, archivo, mime) {
    const { error } = await supabase.storage.from(bucket).upload(ruta, archivo, { contentType: mime, upsert: false })
    if (error) throw new Error(`No se pudo guardar el archivo: ${traducir(error.message)}`)
  },
  async descargar(bucket, ruta) {
    const { data, error } = await supabase.storage.from(bucket).download(ruta)
    if (error || !data) throw new Error(`No se pudo abrir el archivo: ${traducir(error?.message ?? 'sin contenido')}`)
    return data.arrayBuffer()
  },
  async quitar(bucket, ruta) {
    const { error } = await supabase.storage.from(bucket).remove([ruta])
    if (error) throw new Error(traducir(error.message))
  },
  async urlFirmadas(bucket, rutas, segundos) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(rutas, segundos)
    if (error) throw new Error(traducir(error.message))
    const salida: Record<string, string> = {}
    for (const f of data ?? []) if (f.signedUrl && f.path && !f.error) salida[f.path] = f.signedUrl
    return salida
  },
}

/** Nombre apto para una ruta de almacenamiento: sin acentos ni símbolos. */
export const nombreSeguro = (nombre: string) =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-80) || 'archivo'

export const TAMANO_MAXIMO = 25 * 1024 * 1024
export const MIME_FIRMADO = ['application/pdf', 'image/jpeg', 'image/png'] as const
