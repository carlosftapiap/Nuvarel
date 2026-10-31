/**
 * Prepara una carga en el navegador: optimiza la fotografía y genera la miniatura o la portada del video.
 * Si el navegador no logra leer el archivo, no se sube: tampoco se podría mostrar.
 */
export interface Preparado {
  archivo: Blob
  mime: string
  nombre: string
  nombreOriginal: string
  miniatura: Blob
  nombreMiniatura: string
  ancho: number
  alto: number
  duracion: number | null
}

const MAX_LADO = 1920
const ANCHO_MINIATURA = 480
const ANCHO_PORTADA = 1280
const ESPERA_VIDEO_MS = 30_000

function codificar(canvas: HTMLCanvasElement, calidad: number): Promise<Blob> {
  const pedir = (tipo: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, tipo, calidad))
  return pedir('image/webp').then(async (webp) => {
    // Algunos navegadores no generan WebP y entregan PNG: en ese caso, JPEG.
    const b = webp?.type === 'image/webp' ? webp : await pedir('image/jpeg')
    if (!b) throw new Error('No se pudo procesar la imagen.')
    return b
  })
}

function dibujar(fuente: CanvasImageSource, ancho: number, alto: number, anchoFinal: number) {
  const escala = Math.min(1, anchoFinal / ancho)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(ancho * escala))
  canvas.height = Math.max(1, Math.round(alto * escala))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen.')
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
  return canvas
}

const extension = (b: Blob) => (b.type === 'image/webp' ? 'webp' : 'jpg')
const sinExtension = (nombre: string) => nombre.replace(/\.[^.]+$/, '')

async function prepararImagen(f: File, mime: string): Promise<Preparado> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(f) } catch { throw new Error(`«${f.name}» está dañado o el navegador no puede leerlo.`) }
  try {
    const base = sinExtension(f.name)
    const miniatura = await codificar(dibujar(bmp, bmp.width, bmp.height, ANCHO_MINIATURA), 0.8)
    const mayor = Math.max(bmp.width, bmp.height)
    const escala = Math.min(1, MAX_LADO / mayor)
    const optimizada = await codificar(dibujar(bmp, bmp.width, bmp.height, bmp.width * escala), 0.85)
    // Si recomprimir no reduce nada, se conserva el archivo tal como llegó.
    const usar = escala === 1 && optimizada.size >= f.size
    return {
      archivo: usar ? f : optimizada, mime: usar ? mime : optimizada.type, nombre: usar ? f.name : `${base}.${extension(optimizada)}`, nombreOriginal: f.name,
      miniatura, nombreMiniatura: `mini-${base}.${extension(miniatura)}`, ancho: Math.round(bmp.width * (usar ? 1 : escala)), alto: Math.round(bmp.height * (usar ? 1 : escala)), duracion: null,
    }
  } finally { bmp.close() }
}

async function prepararVideo(f: File, mime: string): Promise<Preparado> {
  const url = URL.createObjectURL(f)
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  try {
    await new Promise<void>((res, rej) => {
      const fallo = () => rej(new Error(`El navegador no puede reproducir «${f.name}». Usa un video MP4 (H.264).`))
      const reloj = setTimeout(fallo, ESPERA_VIDEO_MS)
      v.onerror = fallo
      v.onloadeddata = () => {
        // Evita el primer cuadro, que suele ser negro.
        v.onseeked = () => { clearTimeout(reloj); res() }
        v.currentTime = Math.min(1, v.duration / 2 || 0)
      }
      v.src = url
    })
    if (!v.videoWidth) throw new Error(`«${f.name}» no tiene imagen de video.`)
    const miniatura = await codificar(dibujar(v, v.videoWidth, v.videoHeight, ANCHO_PORTADA), 0.82)
    const base = sinExtension(f.name)
    return { archivo: f, mime, nombre: f.name, nombreOriginal: f.name, miniatura, nombreMiniatura: `portada-${base}.${extension(miniatura)}`, ancho: v.videoWidth, alto: v.videoHeight, duracion: Number.isFinite(v.duration) ? v.duration : null }
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

export const prepararMedio = (f: File, mime: string): Promise<Preparado> => (mime.startsWith('video/') ? prepararVideo(f, mime) : prepararImagen(f, mime))
