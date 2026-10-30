import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cargarLogo, type LogoPdf } from '@/features/cotizaciones/pdf'
import type { EntradaCalculada } from '@/features/cobranza/entrada'
import { fmtFechaCorta } from './plan'
import type { Simulacion } from './hipoteca'

// Paleta del manual de marca AMURA (la misma de la cotización).
const INK: [number, number, number] = [40, 40, 40]
const BROWN: [number, number, number] = [88, 69, 54]
const SLATE: [number, number, number] = [101, 117, 125]
const GRAY: [number, number, number] = [162, 164, 161]
const SAND: [number, number, number] = [218, 211, 193]
const IVORY: [number, number, number] = [247, 244, 237]

const num = (v: number, dec = 2) => v.toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const usd = (v: number) => `USD ${num(v)}`
const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
const plazoTxt = (m: number) => `${Math.floor(m / 12)} años${m % 12 ? ` y ${m % 12} meses` : ''} (${m} meses)`

export interface CotizacionIntegral {
  /** Número de la simulación guardada (SIM-AAAA-0001) o "Borrador" si no se guardó. */
  numero: string
  fecha: string
  cliente: string
  asesor: string
  unidad: { codigo: string; dpt: string; edificio: number; tipologia: string }
  precioFinal: number
  fechaFirma: string
  entrada: EntradaCalculada
  credito: Simulacion
}

export function construirPdfIntegral(c: CotizacionIntegral, logo?: LogoPdf) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Cotización integral ${c.numero} · AMURA`, subject: `Departamento ${c.unidad.dpt}`, author: c.asesor, creator: 'AMURA · Nuvarel' })
  const W = doc.internal.pageSize.getWidth()
  const M = 16

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
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...BROWN).text('COTIZACIÓN INTEGRAL', W - M, 16, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK).text(c.numero, W - M, 22, { align: 'right' })
  doc.setTextColor(...SLATE).text(`Fecha: ${fmtFechaCorta(c.fecha)}`, W - M, 27, { align: 'right' })
  let y = 46

  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY).text('CLIENTE', M, y).text('ASESOR COMERCIAL', W / 2 + 4, y)
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...INK).text(c.cliente, M, y + 6).text(c.asesor, W / 2 + 4, y + 6)
  y += 16
  doc.setDrawColor(...SAND).setLineWidth(0.4).line(M, y, W - M, y)
  y += 8
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK).text(`Departamento ${c.unidad.dpt}`, M, y)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE).text(`${c.unidad.codigo} · Edificio ${c.unidad.edificio} · ${c.unidad.tipologia}`, W - M, y, { align: 'right' })
  y += 7
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...BROWN).text(`Precio final: ${usd(c.precioFinal)}`, M, y)
  y += 6

  const tabla = (titulo: string, body: (string | number)[][]) => {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK).text(titulo, M, y + 4)
    autoTable(doc, {
      startY: y + 6, margin: { left: M, right: M }, theme: 'plain',
      styles: { fontSize: 9, cellPadding: { top: 1.4, bottom: 1.4, left: 0, right: 2 }, textColor: INK },
      columnStyles: { 0: { textColor: SLATE, cellWidth: 80 }, 1: { fontStyle: 'bold', halign: 'right' } },
      body: body.map((r) => r.map(String)),
    })
    y = lastY(doc) + 4
  }

  const e = c.entrada
  tabla('1. Entrada del 20% (a favor de Nuvarel)', [
    ['Entrada total (20%)', usd(e.entradaTotal)],
    ['Reserva (se acredita al 6%)', usd(e.partidas[0].monto)],
    [`Pago adicional a la firma (completa el 6%) · ${fmtFechaCorta(c.fechaFirma)}`, usd(e.pagoFirma)],
    [`Saldo de entrada en ${e.partidas.filter((p) => p.tipo === 'cuota').length} cuotas mensuales`, usd(e.saldoCuotas)],
    ['Cuota mensual de entrada', e.cuotaMensual === e.ultimaCuota ? usd(e.cuotaMensual) : `${usd(e.cuotaMensual)} (última ${usd(e.ultimaCuota)})`],
    ['Saldo contra entrega (80%)', usd(e.saldoEntrega)],
  ])

  const s = c.credito
  tabla(`2. Crédito hipotecario del comprador (simulación ${s.escenario === 'manual' ? 'manual' : 'con catálogo'})`, [
    ['Entidad y producto', `${s.entidad} · ${s.producto}`],
    ['Monto solicitado (saldo contra entrega)', usd(s.montoSolicitado)],
    ['Monto financiado estimado', usd(s.montoFinanciado)],
    ...(s.aporteAdicional > 0 ? [['Aporte propio adicional requerido', usd(s.aporteAdicional)]] : []),
    ['Tasa nominal / efectiva anual', `${num(s.tasaNominal, 2)}% / ${num(s.tasaEfectiva, 2)}% (${s.tipoTasa})`],
    ['Plazo', plazoTxt(s.plazoMeses)],
    ['Sistema de amortización', s.amortizacion === 'francesa' ? 'Francés (cuota fija)' : 'Alemán (capital fijo)'],
    ['Cuota estimada', s.amortizacion === 'francesa' ? usd(s.primeraCuota) : `${usd(s.primeraCuota)} a ${usd(s.ultimaCuota)}`],
    ['Intereses totales estimados', usd(s.totalIntereses)],
    ['Costo total estimado', usd(s.costoTotal)],
    ...(s.fuente ? [['Fuente de la tasa', `${s.fuente} · ${fmtFechaCorta(s.fechaFuente)} · versión ${s.version}`]] : [['Fuente de la tasa', 'Escenario manual ingresado por el asesor']]),
  ])
  if (s.faltantes.length) {
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...SLATE)
    const l = doc.splitTextToSize(`No incluidos por falta de dato (no son gratuitos): ${s.faltantes.join(', ')}.`, W - 2 * M)
    doc.text(l, M, y)
    y += l.length * 3.8 + 3
  }

  const condiciones = [
    'Simulación referencial sujeta a aprobación bancaria. No constituye una oferta de crédito ni una aprobación.',
    'Las tasas y condiciones bancarias pueden cambiar; no se garantiza que la tasa actual siga vigente a la entrega.',
    'El crédito hipotecario es una obligación del comprador con la entidad financiera; sus cuotas no son cobradas por Nuvarel.',
    'La reserva se acredita al 6% pagado a la firma. La deuda de la entrada se activa al firmar la promesa de compraventa.',
    'Precio y disponibilidad sujetos a confirmación al momento de la reserva.',
  ]
  if (y + condiciones.length * 9 + 10 > doc.internal.pageSize.getHeight() - 20) { doc.addPage(); y = 20 }
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK).text('Condiciones', M, y)
  y += 5
  doc.setFont('helvetica', 'normal').setFontSize(7.8).setTextColor(...SLATE)
  for (const t of condiciones) {
    const l = doc.splitTextToSize(`• ${t}`, W - 2 * M)
    doc.text(l, M, y)
    y += l.length * 3.6 + 1
  }

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

export async function descargarPdfIntegral(c: CotizacionIntegral) {
  construirPdfIntegral(c, await cargarLogo()).save(`${c.numero}_AMURA_${c.unidad.dpt}_integral.pdf`)
}
