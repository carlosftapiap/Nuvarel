import type { Datos } from '@/features/conexion/datos'
import { nombreSeguro, TAMANO_MAXIMO, TIPOS_PERMITIDOS, type Almacen } from './almacen'
import type { TipoEvidencia } from './model'
import { registrarEvidencia } from './remoto'

/** Fotografías de campo → «foto»; PDF → «informe»; el resto → «otro». El usuario puede elegir otro tipo al cargar. */
export const tipoPorMime = (mime: string): TipoEvidencia => (mime.startsWith('image/') ? 'foto' : mime === 'application/pdf' ? 'informe' : 'otro')

/** Devuelve el motivo por el que un archivo no se puede cargar, o null si es válido. */
export function validarArchivo(f: { name: string; type: string; size: number }): string | null {
  if (!(TIPOS_PERMITIDOS as readonly string[]).includes(f.type)) return `«${f.name}»: solo se admiten fotografías (JPG, PNG, WebP), PDF, Word y Excel.`
  if (f.size === 0) return `«${f.name}» está vacío.`
  if (f.size > TAMANO_MAXIMO) return `«${f.name}» supera el máximo de 25 MB.`
  return null
}

export interface CargaEvidencia {
  frenteId: string
  actividadId: string | null
  avanceId: string | null
  tipo: TipoEvidencia
  descripcion: string
  fecha: string
  archivo: File
}

/** Sube el archivo al almacenamiento privado y lo registra. Si el registro falla, el archivo subido queda sin referencia y no se muestra a nadie. */
export async function cargarEvidencia(d: { datos: Datos; almacen: Almacen }, c: CargaEvidencia): Promise<void> {
  const error = validarArchivo(c.archivo)
  if (error) throw new Error(error)
  const ruta = `${c.frenteId}/${c.actividadId ?? 'general'}/${crypto.randomUUID()}-${nombreSeguro(c.archivo.name)}`
  await d.almacen.subir(ruta, c.archivo, c.archivo.type)
  await registrarEvidencia(d.datos, {
    frenteId: c.frenteId, actividadId: c.actividadId, avanceId: c.avanceId, tipo: c.tipo, nombre: c.archivo.name, descripcion: c.descripcion, ruta,
    mime: c.archivo.type, tamano: c.archivo.size, fecha: c.fecha,
  })
}

export const tamanoTxt = (b: number | null) => (b === null ? '' : b >= 1_048_576 ? `${(b / 1_048_576).toLocaleString('es-EC', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
