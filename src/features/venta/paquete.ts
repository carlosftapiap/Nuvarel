import { jsPDF } from 'jspdf'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { cargarLogo, pieDocumento, pintarCotizacion, type LogoPdf } from '@/features/cotizaciones/pdf'
import type { Datos } from '@/features/conexion/datos'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { cargarChecklist, mostrarPdf, pintarChecklist, type DatosChecklist } from './checklist'
import { construirPdfFicha, ESPECIFICACIONES_APROBADAS, pintarFicha } from './ficha'

/**
 * Paquete completo: cotización, checklist del tipo de comprador y, solo si está aprobada, la ficha técnica.
 * Un documento pendiente no entra: se informa en `faltantes`.
 */
export function construirPaquete(c: Cotizacion, datos: DatosChecklist, logo?: LogoPdf) {
  if (c.documentoDisponible === false) throw new Error('El documento original de esta cotización no está disponible.')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Paquete de documentos · ${c.numero} · AMURA`, subject: `Departamento ${c.unidad.dpt}`, author: c.asesor.nombre, creator: 'AMURA · Nuvarel' })
  const incluidos = ['Cotización', `Checklist de documentos (${datos.tipoPersona === 'juridica' ? 'persona jurídica' : 'persona natural'})`]
  const faltantes: string[] = []
  pintarCotizacion(doc, c, logo)
  doc.addPage()
  pintarChecklist(doc, c, datos, logo)
  if (ESPECIFICACIONES_APROBADAS) {
    doc.addPage()
    pintarFicha(doc, logo, { borrador: false })
    incluidos.push('Especificaciones técnicas aprobadas')
  } else {
    faltantes.push('Especificaciones técnicas: pendiente de aprobación')
  }
  pieDocumento(doc, `Paquete ${c.numero}`)
  return { doc, incluidos, faltantes }
}

/** Descarga el paquete del tipo de comprador elegido. Devuelve lo que contiene y lo que falta. */
export async function descargarPaquete(d: Datos, c: Cotizacion, tipoPersona?: TipoPersona) {
  const datos = await cargarChecklist(d, c.clienteId, tipoPersona)
  const { doc, incluidos, faltantes } = construirPaquete(c, datos, await cargarLogo())
  doc.save(`Paquete_${c.numero}_AMURA_${c.unidad.dpt}.pdf`)
  return { incluidos, faltantes }
}

/** Ficha técnica aprobada, en vista previa o para imprimir. */
export async function verFicha(imprimir = false) {
  const ventana = window.open('', '_blank')
  try {
    const doc = construirPdfFicha(await cargarLogo())
    mostrarPdf(doc, 'Especificaciones_tecnicas_AMURA.pdf', imprimir, ventana)
  } catch (e) {
    ventana?.close()
    throw e
  }
}
