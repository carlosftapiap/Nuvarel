import { supabase } from '@/lib/supabase'

/** Almacenamiento privado de evidencias. Las rutas empiezan por el identificador del frente; la base decide quién sube y quién ve. */
export interface Almacen {
  subir(ruta: string, archivo: Blob, tipoMime: string): Promise<void>
  urlFirmada(ruta: string): Promise<string>
}

const BUCKET = 'obra-evidencias'

export const almacenSupabase: Almacen = {
  async subir(ruta, archivo, tipoMime) {
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: tipoMime, upsert: false })
    if (error) throw new Error(/row-level security|not authorized/i.test(error.message) ? 'No tienes permiso para cargar archivos.' : `No se pudo cargar el archivo: ${error.message}`)
  },
  async urlFirmada(ruta) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 300)
    if (error || !data) throw new Error('No se pudo abrir el archivo. Puede haber sido retirado o no tienes permiso.')
    return data.signedUrl
  },
}

/** Nombre apto para la ruta: sin acentos ni símbolos. */
export const nombreSeguro = (nombre: string) =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-80) || 'archivo'

export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const
export const TAMANO_MAXIMO = 25 * 1024 * 1024
