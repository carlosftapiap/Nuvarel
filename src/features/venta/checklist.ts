import { jsPDF } from 'jspdf'
import type { Datos } from '@/features/conexion/datos'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { cargarLogo, construirPdfCotizacion, pieDocumento, type LogoPdf } from '@/features/cotizaciones/pdf'
import { cargarCatalogo, etiquetaCatalogo, type TipoPersona } from '@/features/cumplimiento/expediente'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { edificioDocumento } from '@/features/inventario/nomenclatura'
export { ESPECIFICACIONES_APROBADAS } from './ficha'

/**
 * Checklist imprimible de documentos para el comprador. Sale de la lista configurada en Cumplimiento (expediente_tipos):
 * no agrega requisitos. Lo que el PDF de referencia pide y AMURA no tiene configurado va en PROPUESTAS_PENDIENTES, nunca en el documento.
 */
type Fila = Record<string, unknown>

export interface DocumentoConfigurado { clave: string; nombre: string }
export interface DatosChecklist { tipoPersona: TipoPersona; documentos: DocumentoConfigurado[]; version: string | null }

/** Agrupación de las claves configuradas en secciones A–E. Las claves sin sección van a «Otros documentos configurados». */
export const SECCIONES: Record<TipoPersona, { letra: string; titulo: string; claves: string[] }[]> = {
  natural: [
    { letra: 'A', titulo: 'Identificación personal', claves: ['pn_cedula', 'pn_votacion', 'pn_servicio_basico'] },
    { letra: 'B', titulo: 'Formalización de la solicitud de crédito', claves: ['pn_conozca_cliente'] },
    { letra: 'C', titulo: 'Declaración de origen y licitud de fondos', claves: ['pn_origen_fondos'] },
  ],
  juridica: [
    { letra: 'A', titulo: 'Identificación de la compañía', claves: ['pj_ruc', 'pj_constitucion'] },
    { letra: 'B', titulo: 'Representante legal', claves: ['pj_nombramiento', 'pj_cedula_representante'] },
    { letra: 'C', titulo: 'Accionistas y beneficiarios finales', claves: ['pj_accionistas'] },
    { letra: 'D', titulo: 'Origen de fondos', claves: ['pj_origen_fondos'] },
    { letra: 'E', titulo: 'Formalización de la solicitud de crédito', claves: ['pj_conozca_cliente'] },
  ],
}

export interface SeccionChecklist { letra: string; titulo: string; items: string[] }

/** Agrupa los documentos configurados en secciones. Ninguno se pierde: los no clasificados quedan al final. */
export function seccionesChecklist(tipo: TipoPersona, documentos: DocumentoConfigurado[]): SeccionChecklist[] {
  const usados = new Set<string>()
  const secciones = SECCIONES[tipo].map((s) => {
    const items = s.claves.map((k) => documentos.find((d) => d.clave === k)).filter((d): d is DocumentoConfigurado => !!d)
    items.forEach((d) => usados.add(d.clave))
    return { letra: s.letra, titulo: s.titulo, items: items.map((d) => d.nombre) }
  })
  const otros = documentos.filter((d) => !usados.has(d.clave)).map((d) => d.nombre)
  if (otros.length) secciones.push({ letra: String.fromCharCode(65 + secciones.length), titulo: 'Otros documentos configurados', items: otros })
  return secciones.filter((s) => s.items.length > 0)
}

/** Tipo de comprador registrado en el cliente. Puede corregirse al imprimir. */
export async function cargarChecklist(d: Datos, clienteId: string | undefined, tipoPersona?: TipoPersona): Promise<DatosChecklist> {
  const [cliente] = clienteId ? await d.select<Fila>('clients', { filtros: { id: clienteId } }).catch(() => []) : []
  const tipo = tipoPersona ?? (cliente?.tipo_persona as TipoPersona | undefined) ?? 'natural'
  const [tipos, catalogo] = await Promise.all([
    d.select<Fila>('expediente_tipos', { filtros: { tipo_persona: tipo, activo: true, obligatorio: true }, orden: [{ columna: 'orden' }] }),
    cargarCatalogo(d),
  ])
  return { tipoPersona: tipo, documentos: tipos.map((t) => ({ clave: String(t.clave), nombre: String(t.nombre) })), version: etiquetaCatalogo(catalogo) }
}

/** Propuestas del PDF de referencia que AMURA no tiene configuradas. Solo para revisión interna; no salen en el checklist del comprador. */
export const PROPUESTAS_PENDIENTES: { tipo: TipoPersona | 'ambos'; requisito: string; responsable: 'Legal' | 'Cumplimiento' | 'Finanzas' }[] = [
  { tipo: 'ambos', requisito: 'Solicitud de reservación (formulario AMURA)', responsable: 'Legal' },
  { tipo: 'ambos', requisito: 'Cheque de reserva a nombre de NUVAREL S.A.S.', responsable: 'Finanzas' },
  { tipo: 'ambos', requisito: 'Declaración de licitud de fondos (titular y, si aplica, tercero que aporta)', responsable: 'Cumplimiento' },
  { tipo: 'ambos', requisito: 'Declaración de condición PEP', responsable: 'Cumplimiento' },
  { tipo: 'ambos', requisito: 'Autorización de uso de datos personales', responsable: 'Legal' },
  { tipo: 'ambos', requisito: 'Preconvenio de reservación (incompleto: falta la página 2 del modelo)', responsable: 'Legal' },
  { tipo: 'ambos', requisito: 'Revisión inicial de cumplimiento', responsable: 'Cumplimiento' },
  { tipo: 'natural', requisito: 'Copia del RUC del titular (antigüedad máxima 3 meses)', responsable: 'Cumplimiento' },
  { tipo: 'natural', requisito: 'Copia de cédula del cónyuge y certificado de votación', responsable: 'Cumplimiento' },
  { tipo: 'natural', requisito: 'Certificado de registro de la propiedad o predial de bienes declarados', responsable: 'Cumplimiento' },
  { tipo: 'natural', requisito: 'Certificado laboral (cargo, antigüedad, sueldo) y últimos 3 roles de pago', responsable: 'Finanzas' },
  { tipo: 'natural', requisito: 'Historial de aportes al IESS del año en curso', responsable: 'Finanzas' },
  { tipo: 'natural', requisito: 'Carta de actividad económica independiente o profesión', responsable: 'Finanzas' },
  { tipo: 'natural', requisito: 'Declaración de impuesto a la renta (2 años) e IVA (6 meses)', responsable: 'Finanzas' },
  { tipo: 'natural', requisito: 'Certificado de cuentas corrientes, ahorros y tarjetas de crédito', responsable: 'Finanzas' },
  { tipo: 'natural', requisito: 'Matrícula de vehículos declarados y capitulaciones matrimoniales, si aplica', responsable: 'Cumplimiento' },
  { tipo: 'juridica', requisito: 'Declaración PEP del representante, accionistas y administradores', responsable: 'Cumplimiento' },
  { tipo: 'juridica', requisito: 'Certificado de cumplimiento de obligaciones (Superintendencia de Compañías)', responsable: 'Cumplimiento' },
  { tipo: 'juridica', requisito: 'Carta que describa el negocio, años de ejercicio, ventas y principales clientes', responsable: 'Finanzas' },
  { tipo: 'juridica', requisito: 'Certificado de cuentas e inversiones de la cuenta usada para la reserva', responsable: 'Finanzas' },
  { tipo: 'juridica', requisito: 'Declaración de impuesto a la renta (2 años) e IVA (6 meses)', responsable: 'Finanzas' },
  { tipo: 'juridica', requisito: 'Acta de junta general, si los estatutos la exigen', responsable: 'Legal' },
]

const INK: [number, number, number] = [40, 40, 40]
const BROWN: [number, number, number] = [88, 69, 54]
const SLATE: [number, number, number] = [101, 117, 125]
const SAND: [number, number, number] = [218, 211, 193]
const IVORY: [number, number, number] = [247, 244, 237]

export function pintarChecklist(doc: jsPDF, c: Cotizacion, datos: DatosChecklist, logo?: LogoPdf) {
  if (!datos.documentos.length) throw new Error('No hay documentos obligatorios configurados para este tipo de cliente.')
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 18
  doc.setFillColor(...IVORY).rect(0, 0, W, 34, 'F')
  if (logo) {
    const r = logo.width / logo.height
    const w = Math.min(56, r * 16)
    doc.addImage(logo.dataUrl, 'PNG', M, 9, w, w / r, undefined, 'FAST')
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK).text('AMURA', M, 21)
  }
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE).text(`Emitido: ${fmtFechaCorta(hoyGuayaquil())}`, W - M, 22, { align: 'right' })

  let y = 46
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...BROWN).text('Documentos requeridos para compra de departamento', M, y)
  y += 9
  const campo = (t: string, v: string) => {
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...SLATE).text(t.toUpperCase(), M, y)
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...INK).text(v, M + 56, y)
    y += 6.5
  }
  campo('Cliente', c.cliente.nombre)
  campo('Tipo de comprador', datos.tipoPersona === 'juridica' ? 'Persona jurídica' : 'Persona natural')
  campo('Departamento de interés', `${c.unidad.dpt} · ${edificioDocumento(c.unidad)}`)
  campo('Cotización', c.numero)
  campo('Vendedor responsable', c.asesor.nombre)
  y += 2
  doc.setDrawColor(...SAND).setLineWidth(0.4).line(M, y, W - M, y)
  y += 8

  const salto = (alto: number) => {
    if (y + alto > H - 24) { doc.addPage(); y = 22 }
  }
  for (const s of seccionesChecklist(datos.tipoPersona, datos.documentos)) {
    salto(14 + s.items.length * 11)
    doc.setFillColor(...IVORY).rect(M, y - 5, W - 2 * M, 8, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...INK).text(`${s.letra}. ${s.titulo}`, M + 3, y)
    y += 9
    for (const nombre of s.items) {
      salto(11)
      doc.setDrawColor(...SLATE).setLineWidth(0.4).rect(M + 2, y - 4.2, 5, 5)
      const lineas = doc.splitTextToSize(nombre, W - 2 * M - 14)
      doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...INK).text(lineas, M + 11, y)
      y += Math.max(1, lineas.length) * 5 + 4
    }
    y += 3
  }

  salto(48)
  y += 2
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text('Observaciones', M, y)
  y += 3
  doc.setDrawColor(...SAND).setLineWidth(0.3)
  for (let i = 0; i < 4; i++) { y += 8; doc.line(M, y, W - M, y) }
  y += 12
  salto(20)
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...SLATE)
  doc.text('Documentos recibidos por: ____________________________     Fecha: ______________', M, y)
  y += 8
  if (datos.version) doc.text(datos.version, M, y)
  doc.text('Esta guía no constituye aprobación documental: la revisión la realiza el área de Cumplimiento.', M, y + 5)
  return doc
}

/** Checklist de un documento, con pie de página. */
export function construirPdfChecklist(c: Cotizacion, datos: DatosChecklist, logo?: LogoPdf) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Checklist de documentos · ${c.cliente.nombre} · AMURA`, creator: 'AMURA · Nuvarel' })
  pintarChecklist(doc, c, datos, logo)
  pieDocumento(doc, `Checklist ${c.numero}`)
  return doc
}

/** Abre un PDF en una ventana nueva (vista previa). Con `imprimir`, lanza la impresión; si no se puede abrir, lo descarga. */
export function mostrarPdf(doc: jsPDF, nombre: string, imprimir = false, ventana?: Window | null) {
  if (!ventana) { doc.save(nombre); return }
  if (imprimir) doc.autoPrint()
  ventana.location.href = String(doc.output('bloburl'))
}

/** Abre el checklist listo para ver o imprimir. La ventana se abre al hacer clic para que el navegador no la bloquee. */
export async function imprimirChecklist(d: Datos, c: Cotizacion, tipoPersona?: TipoPersona, imprimir = true) {
  const ventana = window.open('', '_blank')
  try {
    const doc = construirPdfChecklist(c, await cargarChecklist(d, c.clienteId, tipoPersona), await cargarLogo())
    mostrarPdf(doc, `Checklist_${c.numero}_AMURA_${c.unidad.dpt}.pdf`, imprimir, ventana)
  } catch (e) {
    ventana?.close()
    throw e
  }
}

/** Cotización en vista previa o para imprimir. */
export async function verCotizacion(c: Cotizacion, imprimir = false) {
  const ventana = window.open('', '_blank')
  try {
    const doc = construirPdfCotizacion(c, await cargarLogo())
    mostrarPdf(doc, `${c.numero}_AMURA_${c.unidad.dpt}.pdf`, imprimir, ventana)
  } catch (e) {
    ventana?.close()
    throw e
  }
}
