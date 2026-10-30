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
  if (!u.planoPath) flags.push({ campo: 'Plano', nivel: 'pendiente', mensaje: 'Plano individual pendiente de cargar en el almacenamiento privado.' })
  if (u.imagenes.length === 0) flags.push({ campo: 'Imágenes', nivel: 'pendiente', mensaje: 'Sin imágenes ni renders cargados.' })
  return flags
}
