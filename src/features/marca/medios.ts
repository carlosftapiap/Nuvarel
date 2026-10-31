/**
 * Fotografías y videos del proyecto tal como los muestra la app.
 * MEDIOS_BASE es el material incluido en public/media: la migración lo registra como versión 1,
 * y se muestra tal cual mientras la biblioteca no esté activa en la base de datos.
 */
export interface Medio {
  id: string
  tipo: 'imagen' | 'video'
  titulo: string
  descripcion: string
  src: string
  /** Solo video: versión para teléfonos en vertical. */
  srcVertical: string | null
  /** Miniatura de la imagen o portada del video. */
  miniatura: string
  ancho: number | null
  alto: number | null
  duracion: number | null
  enDashboard: boolean
  enVenta: boolean
  destacado: boolean
}

export type UbicacionMedio = 'dashboard' | 'venta'

export const NOTA_VISUALIZACION = 'Visualización conceptual'

const base = (m: Pick<Medio, 'id' | 'tipo' | 'titulo' | 'descripcion' | 'src' | 'miniatura' | 'ancho' | 'alto'> & Partial<Medio>): Medio =>
  ({ srcVertical: null, duracion: null, enDashboard: true, enVenta: true, destacado: false, ...m })

export const MEDIOS_BASE: Medio[] = [
  base({ id: 'a1000000-0000-4000-8000-000000000001', tipo: 'video', titulo: 'Video promocional de AMURA', descripcion: 'Presentación del proyecto en 24 segundos.', src: '/media/video-horizontal.mp4', srcVertical: '/media/video-vertical.mp4', miniatura: '/media/portada-horizontal.webp', ancho: 1920, alto: 1080, duracion: 24 }),
  base({ id: 'a1000000-0000-4000-8000-000000000002', tipo: 'imagen', titulo: 'Torres AMURA', descripcion: 'Dos torres de seis niveles: 30 apartamentos en el Edificio 1 y 42 en el Edificio 2.', src: '/media/torres.webp', miniatura: '/media/miniaturas/torres.webp', ancho: 941, alto: 1672, destacado: true }),
  base({ id: 'a1000000-0000-4000-8000-000000000003', tipo: 'imagen', titulo: 'Sala y comedor', descripcion: 'Sala y comedor de un departamento, con balcón.', src: '/media/sala.webp', miniatura: '/media/miniaturas/sala.webp', ancho: 1122, alto: 1402 }),
  base({ id: 'a1000000-0000-4000-8000-000000000004', tipo: 'imagen', titulo: 'Dormitorio', descripcion: 'Dormitorio de un departamento, con ventana amplia.', src: '/media/dormitorio.webp', miniatura: '/media/miniaturas/dormitorio.webp', ancho: 1122, alto: 1402 }),
  base({ id: 'a1000000-0000-4000-8000-000000000005', tipo: 'imagen', titulo: 'Piso Edificio 1', descripcion: 'Distribución de un piso del Edificio 1 en vista tridimensional.', src: '/media/piso.webp', miniatura: '/media/miniaturas/piso.webp', ancho: 1122, alto: 1402 }),
]

export const paraUbicacion = (medios: Medio[], donde: UbicacionMedio) => medios.filter((m) => (donde === 'dashboard' ? m.enDashboard : m.enVenta))

/** El contenido elegido para el banner; sin elección, la primera imagen publicada. */
export const medioBanner = (medios: Medio[]) => medios.find((m) => m.destacado) ?? medios.find((m) => m.tipo === 'imagen') ?? null

export const fmtDuracion = (s: number | null) => (s === null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)
