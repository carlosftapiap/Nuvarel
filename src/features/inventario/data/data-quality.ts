import type { Unit } from '../types'

export type NivelDato = 'discrepancia' | 'pendiente' | 'referencial'

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

/**
 * El documento de segregación asigna 2,10 m² a la bodega A de los pisos 1 a 5 del Edificio 1.
 * La lista de precios y el plano de planta alta tipo usan 1,98 m².
 */
export const BODEGA_SEGUN_SEGREGACION: Record<string, number> = { '1101': 2.1, '1201': 2.1, '1301': 2.1, '1401': 2.1, '1501': 2.1 }

const coma = (v: number) => v.toFixed(2).replace('.', ',')

export function dataFlags(u: Unit): DataFlag[] {
  const flags: DataFlag[] = []
  if (u.estado === 'por_confirmar') {
    flags.push({ campo: 'Estado', nivel: 'pendiente', mensaje: 'Disponibilidad no confirmada: aún no se recibe el estado comercial oficial.' })
  }
  const docBod = BODEGA_SEGUN_SEGREGACION[u.dpt]
  if (docBod !== undefined && Math.abs(docBod - u.bodegaM2) > 0.001) {
    flags.push({
      campo: 'Bodega',
      nivel: 'discrepancia',
      mensaje: `La segregación de bodegas indica ${coma(docBod)} m²; la lista de precios y el plano usan ${coma(u.bodegaM2)} m². Se mantiene el valor de la lista hasta confirmar.`,
    })
  }
  flags.push({ campo: 'Precio', nivel: 'referencial', mensaje: 'Precio referencial de la lista base del 28/10/2026, sujeto a aprobación.' })
  if (u.patioM2 > 0) {
    flags.push({ campo: 'Patio', nivel: 'referencial', mensaje: 'Superficie de patio tomada del simulador (planos DWG, 28/10/2026); el PDF de planos no muestra la cota.' })
  }
  if (!u.parqueo) flags.push({ campo: 'Parqueo', nivel: 'pendiente', mensaje: 'Sin asignación de parqueo en los documentos recibidos.' })
  if (!u.planoPath) flags.push({ campo: 'Plano', nivel: 'pendiente', mensaje: 'Plano individual pendiente de cargar en el almacenamiento privado.' })
  if (u.imagenes.length === 0) flags.push({ campo: 'Imágenes', nivel: 'pendiente', mensaje: 'Sin imágenes ni renders cargados.' })
  return flags
}

export const tieneDiscrepancia = (u: Unit) => dataFlags(u).some((f) => f.nivel === 'discrepancia')
