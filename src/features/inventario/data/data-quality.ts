import type { Unit } from '../types'

export type NivelDato = 'pendiente' | 'referencial'

export interface DataFlag {
  campo: string
  nivel: NivelDato
  mensaje: string
}

export const FUENTES = {
  lista: 'Lista_precios_AMURA_Base.pdf · Escenario Base · 28/10/2026',
  excel: 'AMURA_Edificio1_Precios_vs_Competencia.xlsx (exportado del simulador el 28/10/2026)',
  bodegas: 'SEGREGACIÓN DE BODEGAS.docx',
  planos: 'EDIFICIO 1 - AMURA.pdf y EDIFICIO 2 - AMURA.pdf',
} as const

export type EstadoDocumento = 'pendiente' | 'en_revision' | 'validado'
export const ESTADO_DOCUMENTO: Record<EstadoDocumento, { label: string; tono: string }> = {
  pendiente: { label: 'Pendiente', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  en_revision: { label: 'En revisión', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  validado: { label: 'Validado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
}

/** Tener un archivo no lo valida: sigue en revisión hasta que el proceso de validación lo registre expresamente. */
export function estadoDocumento(cargado: boolean, validado = false): EstadoDocumento {
  if (!cargado) return 'pendiente'
  return validado ? 'validado' : 'en_revision'
}

/** Avisos sobre datos que aún no están confirmados. Las medidas de bodega y patio vienen de los planos. */
export function dataFlags(u: Unit): DataFlag[] {
  const flags: DataFlag[] = []
  if (u.estado === 'por_confirmar') {
    flags.push({ campo: 'Estado', nivel: 'pendiente', mensaje: 'Disponibilidad no confirmada: aún no se recibe el estado comercial oficial.' })
  }
  if (u.patioM2 > 0) {
    flags.push({ campo: 'Patio', nivel: 'referencial', mensaje: 'Superficie de patio tomada del simulador (planos DWG, 28/10/2026); el PDF de planos no muestra la cota.' })
  }
  if (!u.parqueo) flags.push({ campo: 'Parqueo', nivel: 'pendiente', mensaje: 'Sin asignación de parqueo en los documentos recibidos.' })
  flags.push({ campo: 'Plano', nivel: 'pendiente', mensaje: u.planoPath ? 'Plano cargado, en revisión: aún no está validado.' : 'Plano individual pendiente de cargar en el almacenamiento privado.' })
  flags.push({ campo: 'Imágenes', nivel: 'pendiente', mensaje: u.imagenes.length ? 'Imágenes cargadas, en revisión: aún no están validadas.' : 'Sin imágenes ni renders cargados.' })
  return flags
}
