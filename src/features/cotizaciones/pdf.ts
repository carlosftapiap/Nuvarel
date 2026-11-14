import { etiquetaPagoFirma, NOTA_RESERVA } from '@/features/inventario/pricing'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cronogramaPorMes, fmtFechaCorta } from '@/features/financiamiento/plan'
import { ESTADOS } from '@/features/inventario/estados'
import type { Cotizacion } from './cotizacion'

// Paleta del manual de marca AMURA.
const INK: [number, number, number] = [40, 40, 40]
const BROWN: [number, number, number] = [88, 69, 54]
const SLATE: [number, number, number] = [101, 117, 125]
const GRAY: [number, number, number] = [162, 164, 161]
const SAND: [number, number, number] = [218, 211, 193]
const IVORY: [number, number, number] = [247, 244, 237]

export interface LogoPdf { dataUrl: string; width: number; height: number }

const num = (v: number, dec = 2) => v.toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const usd = (v: number) => `USD ${num(v)}`
const m2 = (v: number) => `${num(v)} m²`
const pisoTxt = (p: string) => (p === 'PB' ? 'Planta baja' : `Piso ${p}`)
const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

export function construirPdfCotizacion(c: Cotizacion, logo?: LogoPdf) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Cotización ${c.numero} · AMURA`, subject: `Departamento ${c.unidad.dpt}`, author: c.asesor.nombre, creator: 'AMURA · Nuvarel' })
  const W = doc.internal.pageSize.getWidth()
  const M = 16
  let y = 14

  // Encabezado
  doc.setFillColor(...IVORY)
  doc.rect(0, 0, W, 38, 'F')
  if (logo) {
    const ratio = logo.width / logo.height
    const w = Math.min(64, ratio * 18)
    doc.addImage(logo.dataUrl, 'PNG', M, 10, w, w / ratio, undefined, 'FAST')
  } else {
    doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK).text('AMURA', M, 22)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...SLATE).text('APARTMENTS', M, 27)
  }
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...BROWN).text('COTIZACIÓN', W - M, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK)
  doc.text(c.numero, W - M, 22, { align: 'right' })
  doc.setTextColor(...SLATE)
  doc.text(`Fecha: ${fmtFechaCorta(c.fecha)}`, W - M, 27, { align: 'right' })
  doc.text(`Válida hasta: ${fmtFechaCorta(c.validaHasta)} (${c.vigenciaDias} días)`, W - M, 32, { align: 'right' })
  y = 46

  // Cliente y asesor
  const bloque = (titulo: string, x: number, lineas: string[]) => {
    doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY).text(titulo.toUpperCase(), x, y)
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK)
    lineas.filter(Boolean).forEach((l, i) => doc.text(l, x, y + 6 + i * 5))
  }
  bloque('Cliente', M, [c.cliente.nombre, c.cliente.documento ? `Documento: ${c.cliente.documento}` : '', c.cliente.email, c.cliente.telefono])
  bloque('Asesor comercial', W / 2 + 4, [c.asesor.nombre, c.asesor.email, c.asesor.telefono, 'Nuvarel · Comercialización'])
  y += 30

  // Departamento
  doc.setDrawColor(...SAND).setLineWidth(0.4).line(M, y, W - M, y)
  y += 8
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK).text(`Departamento ${c.unidad.dpt}`, M, y)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE).text(`${c.unidad.codigo} · Edificio ${c.unidad.edificio} · ${pisoTxt(c.unidad.piso)}`, W - M, y, { align: 'right' })
  y += 4
  const u = c.unidad
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 1.6, bottom: 1.6, left: 0, right: 2 }, textColor: INK },
    columnStyles: { 0: { textColor: SLATE, cellWidth: 38 }, 1: { fontStyle: 'bold', cellWidth: 52 }, 2: { textColor: SLATE, cellWidth: 38 }, 3: { fontStyle: 'bold' } },
    body: [
      ['Tipología', u.tipologia, 'Ubicación', u.ubicacion],
      ['Área departamento', m2(u.areaM2), 'Bodega', u.bodegaCodigo ? `${u.bodegaCodigo} · ${m2(u.bodegaM2)}` : 'Sin bodega'],
      ['Área + bodega', m2(c.plan.areaVendibleM2), 'Patio', u.patioM2 ? m2(u.patioM2) : 'Sin patio'],
      ['Parqueo', u.parqueo ?? 'Sin asignar', 'Estado', ESTADOS[u.estado].label],
    ],
  })
  y = lastY(doc) + 6

  // Precio
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text('Precio', M, y)
  autoTable(doc, {
    startY: y + 2,
    margin: { left: M, right: M },
    theme: 'plain',
    styles: { fontSize: 9.5, cellPadding: { top: 1.8, bottom: 1.8, left: 0, right: 0 }, textColor: INK },
    columnStyles: { 1: { halign: 'right' } },
    body: [
      ['Precio de lista', usd(c.plan.precioLista)],
      ...(c.plan.descuentoPct > 0 ? [[`Descuento autorizado (${num(c.plan.descuentoPct)}%)`, `- ${usd(c.plan.descuentoMonto)}`]] : []),
      [{ content: 'Precio final', styles: { fontStyle: 'bold' } }, { content: usd(c.plan.precioFinal), styles: { fontStyle: 'bold', fontSize: 12, textColor: BROWN } }],
    ],
  })
  y = lastY(doc) + 5

  // Forma de pago
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text('Forma de pago', M, y)
  y += 3
  const extras = c.plan.extraordinarias ?? []
  const sumaExtras = extras.reduce((t, e) => t + e.monto, 0)
  const cajas = [
    [etiquetaPagoFirma(c.plan.reservaPct), usd(c.plan.reserva), 'Incluye la reserva'],
    [`Cuotas ${num(c.plan.cuotasPct, 0)}%`, `${c.plan.meses} × ${usd(c.plan.cuotaMensual)}`, c.plan.ultimaCuota === c.plan.cuotaMensual ? `Total ${usd(c.plan.cuotasTotal)}` : extras.length ? `Última ${usd(c.plan.ultimaCuota)}` : `Última ${usd(c.plan.ultimaCuota)} · total ${usd(c.plan.cuotasTotal)}`],
    ...(extras.length ? [[`Cuotas extraordinarias`, `${extras.length} · ${usd(sumaExtras)}`, 'Dentro de las cuotas del 14 %']] : []),
    [`Contra entrega ${num(c.plan.entregaPct, 0)}%`, usd(c.plan.contraEntrega), 'A la entrega del inmueble'],
  ]
  const cw = (W - 2 * M - 4 * (cajas.length - 1)) / cajas.length
  cajas.forEach(([t, v, h], i) => {
    const x = M + i * (cw + 4)
    doc.setFillColor(...IVORY).setDrawColor(...SAND).roundedRect(x, y, cw, 20, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...SLATE).text(t, x + 4, y + 6)
    doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...INK).text(v, x + 4, y + 12)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY).text(h, x + 4, y + 17)
  })
  y += 27

  // Cronograma
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text('Cronograma de pagos', M, y)
  autoTable(doc, {
    startY: y + 2,
    margin: { left: M, right: M, bottom: 20 },
    head: [['N.º', 'Concepto', 'Fecha', 'Monto', 'Saldo']],
    body: c.plan.cronograma.map((p) => [String(p.n), p.concepto, fmtFechaCorta(p.fecha), usd(p.monto), usd(p.saldo)]),
    didParseCell: (d) => {
      if ((d.section === 'head' || d.section === 'foot') && d.column.index >= 3) d.cell.styles.halign = 'right'
      if (d.section === 'body' && c.plan.cronograma[d.row.index]?.tipo === 'extraordinaria') { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = SAND }
    },
    styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: SAND, lineWidth: 0.1 },
    headStyles: { fillColor: BROWN, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: IVORY },
    columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 2: { cellWidth: 28 }, 3: { halign: 'right', cellWidth: 34 }, 4: { halign: 'right', cellWidth: 34 } },
    foot: [['', 'Total', '', usd(c.plan.precioFinal), '']],
    showFoot: 'lastPage',
    footStyles: { fillColor: SAND, textColor: INK, fontStyle: 'bold' },
  })
  y = lastY(doc) + 7

  // Por mes: cuota mensual, extraordinaria y total
  if (extras.length) {
    if (y + 30 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text('Meses con cuota extraordinaria', M, y)
    autoTable(doc, {
      startY: y + 2,
      margin: { left: M, right: M, bottom: 20 },
      head: [['Mes', 'Fecha', 'Cuota mensual', 'Extraordinaria', 'Total del mes']],
      body: cronogramaPorMes(c.plan, c.fecha).filter((f) => f.extraordinaria > 0).map((f) => [String(f.mes), fmtFechaCorta(f.fecha), usd(f.cuota), usd(f.extraordinaria), usd(f.total)]),
      styles: { fontSize: 8.5, cellPadding: 1.6, textColor: INK, lineColor: SAND, lineWidth: 0.1 },
      headStyles: { fillColor: BROWN, textColor: [255, 255, 255], fontStyle: 'bold' },
    })
    y = lastY(doc) + 7
  }

  // Observaciones y condiciones
  const condiciones = [
    'Precios referenciales en dólares de los Estados Unidos, sujetos a cambio sin previo aviso y a aprobación de la gerencia.',
    'Esta cotización no constituye reserva ni promesa de compraventa; la unidad se separa únicamente con la reserva confirmada.',
    `El pago a la firma y las cuotas forman la entrada del ${num(c.plan.reservaPct + c.plan.cuotasPct, 0)} %. ${NOTA_RESERVA}`,
    extras.length ? 'Las cuotas extraordinarias son pagos programados dentro de las cuotas del 14 %; no constituyen pagos recibidos.' : '',
    'Las fechas de este cronograma son referenciales: en el contrato, las cuotas se cuentan desde la firma; el saldo se paga a la entrega del inmueble.',
    'Superficies según planos y lista de precios del proyecto; pueden tener variaciones menores en obra.',
  ].filter(Boolean)
  const necesita = (c.observaciones ? 14 : 0) + condiciones.length * 9 + 10
  if (y + necesita > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20 }
  if (c.observaciones) {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text('Observaciones', M, y)
    const lines = doc.setFont('helvetica', 'normal').setFontSize(8.5).splitTextToSize(c.observaciones, W - 2 * M)
    doc.text(lines, M, y + 5)
    y += 7 + lines.length * 4
  }
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text('Condiciones', M, y)
  y += 5
  doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...SLATE)
  condiciones.forEach((t) => {
    const lines = doc.splitTextToSize(`• ${t}`, W - 2 * M)
    doc.text(lines, M, y)
    y += lines.length * 3.6 + 1
  })

  // Pie de página
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    const H = doc.internal.pageSize.getHeight()
    doc.setDrawColor(...SAND).setLineWidth(0.3).line(M, H - 14, W - M, H - 14)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GRAY)
    doc.text('AMURA Apartments · Desarrolla Inmobiliaria Jarval · Comercializa Nuvarel', M, H - 9)
    doc.text(`${c.numero} · Página ${i} de ${total}`, W - M, H - 9, { align: 'right' })
  }
  return doc
}

/** Carga el logo horizontal de AMURA desde /brand para incrustarlo en el PDF. */
export async function cargarLogo(src = '/brand/logo-amura-alt.png'): Promise<LogoPdf | undefined> {
  try {
    const blob = await (await fetch(src)).blob()
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob) })
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl })
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    return undefined
  }
}

export async function descargarCotizacionPdf(c: Cotizacion) {
  const doc = construirPdfCotizacion(c, await cargarLogo())
  doc.save(`${c.numero}_AMURA_${c.unidad.dpt}.pdf`)
}
