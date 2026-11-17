import { jsPDF } from 'jspdf'
import type { LogoPdf } from '@/features/cotizaciones/pdf'
import { pieDocumento } from '@/features/cotizaciones/pdf'

/**
 * Ficha de especificaciones técnicas de AMURA. Fuente: AMURA-03-Especificaciones-Tecnicas.pdf (documento de trabajo, 14/11/2026).
 * Para publicarla basta cambiar FICHA_TECNICA: estado «aprobada», URL o versión aprobada. Ninguna pantalla cambia.
 * Mientras esté «provisional», solo se ve como borrador interno con marca de agua y sin observaciones resueltas: no se entrega al cliente.
 */
export const FICHA_TECNICA = {
  estado: 'provisional' as 'provisional' | 'aprobada',
  version: 'Documento de trabajo del 14/11/2026',
  aprobadaPor: null as string | null,
  fechaAprobacion: null as string | null,
  /** URL del PDF aprobado publicado; si es null, la ficha se genera desde FICHA_SECCIONES. */
  url: null as string | null,
}

/** Lo que el vendedor puede entregar: solo la versión aprobada. */
export const ESPECIFICACIONES_APROBADAS: { url: string | null; version: string } | null =
  FICHA_TECNICA.estado === 'aprobada' ? { url: FICHA_TECNICA.url, version: FICHA_TECNICA.version } : null

export interface SeccionFicha { titulo: string; items: string[] }

export const FICHA_SECCIONES: SeccionFicha[] = [
  { titulo: 'Estructura y mampostería', items: ['Hormigón armado con muros portantes. Diseño sismo resistente.'] },
  { titulo: 'Cubierta', items: ['Estructura metálica con steel panel o similar. Aislante de polietileno de 3 cm.'] },
  { titulo: 'Instalaciones eléctricas y domotización', items: ['Piezas eléctricas bticino o similar. Incluye tres líneas para domotización.'] },
  { titulo: 'Instalaciones sanitarias', items: ['Infraestructura para agua caliente en duchas, cocina y lavandería. Equipo de bombeo para todo el proyecto.'] },
  { titulo: 'Piezas sanitarias y grifería', items: ['Piezas y griferías importadas.'] },
  { titulo: 'Tumbados', items: ['Gypsum con cortineros en sala y dormitorios, sin desniveles. Altura de 2,60 m en todo el departamento.'] },
  { titulo: 'Carpintería de aluminio', items: ['Perfilería de aluminio negro, vidrio claro y malla antimosquitos.'] },
  { titulo: 'Puertas', items: ['Principal e interiores en RH melamina madera, de 36 mm de espesor. Altura: 2,20 m.'] },
  {
    titulo: 'Muebles de cocina y baños',
    items: [
      'Cocina: muebles bajos en tableros RH con melamina madera, una fila de cajones, puertas y repisas interiores. Anaqueles superiores con puertas y repisas internas. Iluminación LED en muebles altos, según propuesta de la constructora.',
      'Baños máster y niños: tableros RH con melamina madera.',
    ],
  },
  {
    titulo: 'Recubrimientos y pisos',
    items: [
      'Cocina: mesones y salpicaderos biselados de 60 cm de alto, en piedra sintetizada, según propuesta de la constructora.',
      'Baños: piedra sintetizada en mesones. Paredes recubiertas hasta el nivel del tumbado.',
      'Pisos: porcelanato en todo el departamento. Rastreras de 8 cm de alto.',
      'Pasamanos exteriores: metálicos, con pintura anticorrosiva y color de acuerdo con el proyecto.',
    ],
  },
  {
    titulo: 'Generador y sistemas especiales',
    items: [
      'Generador de energía: para ascensores, cuarto de bombas, corredores, garita, punto para nevera, punto para TV, punto para internet e iluminación en un área del departamento.',
      'Detección de incendios: de acuerdo con las disposiciones del Cuerpo de Bomberos.',
      'Tuberías de cobre para MCC: punto 220 V dentro del evaporador.',
      'Sistema de gas: desde red externa. Puntos para cocina, calentador y secadora.',
    ],
  },
  { titulo: 'Áreas sociales interiores', items: ['Salón de eventos amoblado · Gimnasio equipado · Baño para personal de servicio.'] },
  { titulo: 'Áreas sociales exteriores', items: ['Piscina a doble nivel · BBQ · Jardinería con diseño paisajista · Juegos infantiles · Rooftop amoblado · Cancha de pádel · Parque para mascotas.'] },
]

/** Lo que NO está incluido, según el documento fuente. */
export const FICHA_NO_INCLUYE: string[] = [
  'Equipos de climatización: splits, central, cableado, etc., e instalación de esos equipos.',
  'Puertas de closets e interiores. Puertas para duchas.',
  'Instalación de ningún tipo de luminarias.',
  'Mobiliarios. Accesorios de baños y espejos.',
  'Electrodomésticos. Calentador.',
]

/** Notas de venta para el cliente, tomadas del documento fuente. */
export const FICHA_NOTAS: string[] = [
  'Las especificaciones y marcas indicadas pueden sustituirse por otras de calidad equivalente o superior, según disponibilidad y propuesta de la constructora.',
  'Las áreas sociales se describen por su contenido, no por su ubicación dentro del proyecto.',
]

/**
 * Contradicciones del documento fuente que la constructora debe resolver antes de la versión aprobada.
 * Solo aparecen en el borrador interno.
 */
export const FICHA_OBSERVACIONES_BORRADOR: string[] = [
  'Puertas interiores: la sección «Puertas» las incluye en RH melamina madera, pero «No contempla» excluye «Puertas de closets e interiores».',
  'Iluminación: «Muebles de cocina» menciona iluminación LED en muebles altos, pero «No contempla» excluye «instalación de ningún tipo de luminarias».',
  'Mobiliario: el documento incluye muebles de cocina y baños; «No contempla» excluye «mobiliarios» en general. Confirmar el alcance exacto.',
]

const INK: [number, number, number] = [40, 40, 40]
const BROWN: [number, number, number] = [88, 69, 54]
const SLATE: [number, number, number] = [101, 117, 125]
const SAND: [number, number, number] = [218, 211, 193]
const IVORY: [number, number, number] = [247, 244, 237]

/** Dibuja la ficha desde la página actual. Con `borrador`, marca de agua y observaciones internas. */
export function pintarFicha(doc: jsPDF, logo: LogoPdf | undefined, opciones: { borrador: boolean }) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 18
  const marca = () => {
    if (!opciones.borrador) return
    doc.setFont('helvetica', 'bold').setFontSize(44).setTextColor(235, 225, 220)
    doc.text('BORRADOR · NO ENTREGAR', W / 2, H / 2, { align: 'center', angle: 35 })
  }
  marca()
  doc.setFillColor(...IVORY).rect(0, 0, W, 34, 'F')
  if (logo) {
    const r = logo.width / logo.height
    const w = Math.min(56, r * 16)
    doc.addImage(logo.dataUrl, 'PNG', M, 9, w, w / r, undefined, 'FAST')
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK).text('AMURA', M, 21)
  }
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...BROWN).text('FICHA TÉCNICA', W - M, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE).text('72 suites · Urb. Isla Celeste, Samborondón', W - M, 22, { align: 'right' })

  let y = 44
  const salto = (alto: number) => {
    if (y + alto > H - 22) { doc.addPage(); marca(); y = 22 }
  }
  if (opciones.borrador) {
    salto(16)
    doc.setFillColor(253, 240, 215).roundedRect(M, y - 5, W - 2 * M, 12, 2, 2, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(120, 70, 20)
    doc.text(`Versión de revisión comercial · ${FICHA_TECNICA.version}. Pendiente de aprobación; no entregar al cliente.`, M + 3, y + 2)
    y += 16
  }
  for (const s of FICHA_SECCIONES) {
    salto(12 + s.items.length * 6)
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...BROWN).text(s.titulo, M, y)
    y += 5
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
    for (const it of s.items) {
      const lineas = doc.splitTextToSize(it, W - 2 * M - 4)
      salto(lineas.length * 4.6 + 2)
      doc.text(lineas, M + 3, y)
      y += lineas.length * 4.6 + 1.5
    }
    y += 3
  }
  salto(12 + FICHA_NO_INCLUYE.length * 6)
  doc.setDrawColor(...SAND).setLineWidth(0.4).line(M, y, W - M, y)
  y += 7
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...INK).text('No incluido', M, y)
  y += 5
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
  for (const it of FICHA_NO_INCLUYE) {
    const lineas = doc.splitTextToSize(`• ${it}`, W - 2 * M - 4)
    salto(lineas.length * 4.6 + 2)
    doc.text(lineas, M + 3, y)
    y += lineas.length * 4.6 + 1.5
  }
  y += 4
  doc.setFont('helvetica', 'italic').setFontSize(8.5).setTextColor(...SLATE)
  for (const n of FICHA_NOTAS) {
    const lineas = doc.splitTextToSize(n, W - 2 * M)
    salto(lineas.length * 4 + 2)
    doc.text(lineas, M, y)
    y += lineas.length * 4 + 1.5
  }
  if (opciones.borrador) {
    y += 4
    salto(12 + FICHA_OBSERVACIONES_BORRADOR.length * 9)
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(120, 70, 20).text('Observaciones internas para la constructora', M, y)
    y += 5
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK)
    for (const o of FICHA_OBSERVACIONES_BORRADOR) {
      const lineas = doc.splitTextToSize(`• ${o}`, W - 2 * M - 4)
      salto(lineas.length * 4 + 2)
      doc.text(lineas, M + 3, y)
      y += lineas.length * 4 + 1.5
    }
  }
  return doc
}

/** Ficha lista para entregar. Lanza error si la versión aprobada no está publicada. */
export function construirPdfFicha(logo?: LogoPdf) {
  if (!ESPECIFICACIONES_APROBADAS) throw new Error('La ficha técnica aún no está aprobada para entrega.')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: 'Especificaciones técnicas · AMURA', creator: 'AMURA · Nuvarel' })
  pintarFicha(doc, logo, { borrador: false })
  pieDocumento(doc, `Ficha técnica ${ESPECIFICACIONES_APROBADAS.version}`)
  return doc
}

/** Borrador interno para revisión comercial. Nunca se ofrece al cliente. */
export function construirPdfBorradorFicha(logo?: LogoPdf) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: 'Borrador de ficha técnica · AMURA (interno)', creator: 'AMURA · Nuvarel' })
  pintarFicha(doc, logo, { borrador: true })
  pieDocumento(doc, 'Borrador interno de ficha técnica')
  return doc
}
