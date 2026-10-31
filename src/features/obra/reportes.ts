import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { avanceActualFrente, avanceFrenteAl, cobertura, desviacion, dia, finesDeMes, planificadoFrente, retrasos, ultimoCorte, type Retraso } from './calculos'
import type { DatosObra, Frente } from './model'

/** Reporte de avance: planificado frente a ejecutado y retrasos. Todo sale de registros. */

export interface FilaReporte {
  frente: Frente
  planificado: number | null
  actual: number | null
  desviacion: number | null
  actividades: number
  conAvance: number
  retrasadas: Retraso[]
  ultimoCorte: string | null
  cronogramaVersion: number | null
}

export function filasReporte(d: DatosObra, fecha: string): FilaReporte[] {
  return d.frentes.map((frente) => {
    const acts = d.actividades.filter((a) => a.frenteId === frente.id)
    const cron = d.cronogramas.find((c) => c.frenteId === frente.id && c.estado === 'aprobado') ?? null
    const planificado = cron && frente.pesosAprobados ? planificadoFrente(cron.actividades, fecha) : null
    const actual = avanceActualFrente(frente, acts)
    const cob = cobertura(acts)
    return {
      frente, planificado, actual, desviacion: desviacion(actual, planificado),
      actividades: cob.hojas, conAvance: cob.conAvanceValidado, retrasadas: retrasos(acts, fecha),
      ultimoCorte: ultimoCorte(acts), cronogramaVersion: cron?.version ?? null,
    }
  })
}

export interface PuntoHistorial { fecha: string; valores: Record<string, number | null> }

/** Avance a fin de cada mes, por frente. */
export function historialMensual(d: DatosObra, hoy: string, limite = 12): PuntoHistorial[] {
  const cortes = d.avances.filter((r) => r.estado === 'validado').map((r) => r.fechaCorte).sort()
  if (!cortes.length) return []
  return finesDeMes(cortes[0], hoy, limite).map((fecha) => ({
    fecha, valores: Object.fromEntries(d.frentes.map((f) => [f.id, avanceFrenteAl(f, d.actividades, d.avances, fecha)])),
  }))
}

const fmt = (v: number | null) => (v === null ? '' : v)
const texto = (v: number | null, pendiente = 'Pendiente de configurar') => (v === null ? pendiente : `${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`)
const fechaTxt = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')
const dias = (r: Retraso) => (r.tipo === 'fin' ? `Fin previsto vencido hace ${r.dias} día(s)` : `Inicio previsto vencido hace ${r.dias} día(s)`)
const serial = (iso: string | null) => (iso ? dia(iso) + 25569 : null)

export function libroReporte(filas: FilaReporte[], historial: PuntoHistorial[], frentes: Frente[], fecha: string, usuario: string): XLSX.WorkBook {
  const resumen = XLSX.utils.aoa_to_sheet([
    [`AMURA · Avance de obra · corte al ${fechaTxt(fecha)}`],
    [`Generado por ${usuario}. Avance actual según lo registrado por los responsables autorizados.`],
    [],
    ['Frente', 'Planificado %', 'Avance actual %', 'Desviación (puntos)', 'Actividades', 'Con avance', 'Retrasadas', 'Último registro', 'Cálculo'],
    ...filas.map((f) => [f.frente.nombre, fmt(f.planificado), fmt(f.actual), fmt(f.desviacion), f.actividades, f.conAvance, f.retrasadas.length,
      serial(f.ultimoCorte), f.frente.pesosAprobados ? 'Ponderado' : 'Promedio simple de etapas']),
  ])
  for (let r = 4; r < 4 + filas.length; r++) {
    const c = resumen[XLSX.utils.encode_cell({ r, c: 7 })]
    if (c && typeof c.v === 'number') c.z = 'dd/mm/yyyy'
  }
  resumen['!cols'] = [28, 14, 14, 18, 12, 12, 12, 16, 26].map((wch) => ({ wch }))
  const detalleRetrasos = XLSX.utils.aoa_to_sheet([
    ['Frente', 'Código', 'Actividad', 'Situación', 'Fin previsto', 'Estado', 'Avance actual %'],
    ...filas.flatMap((f) => f.retrasadas.map((r) => [f.frente.nombre, r.actividad.codigo, r.actividad.nombre, dias(r), serial(r.actividad.planFin), r.actividad.estado, fmt(r.actividad.avanceValidado)])),
  ])
  detalleRetrasos['!cols'] = [26, 12, 40, 36, 14, 16, 18].map((wch) => ({ wch }))
  const hist = XLSX.utils.aoa_to_sheet([
    ['Corte', ...frentes.map((f) => `${f.nombre} (%)`)],
    ...historial.map((p) => [serial(p.fecha), ...frentes.map((f) => fmt(p.valores[f.id] ?? null))]),
  ])
  for (let r = 1; r <= historial.length; r++) {
    const c = hist[XLSX.utils.encode_cell({ r, c: 0 })]
    if (c && typeof c.v === 'number') c.z = 'dd/mm/yyyy'
  }
  hist['!cols'] = [14, ...frentes.map(() => 24)].map((wch) => ({ wch }))
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, resumen, 'Resumen')
  XLSX.utils.book_append_sheet(libro, detalleRetrasos, 'Retrasos')
  XLSX.utils.book_append_sheet(libro, hist, 'Historial mensual')
  return libro
}

const INK: [number, number, number] = [40, 40, 40]
const BROWN: [number, number, number] = [88, 69, 54]
const SLATE: [number, number, number] = [101, 117, 125]
const IVORY: [number, number, number] = [247, 244, 237]
const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

export function construirPdfReporte(filas: FilaReporte[], historial: PuntoHistorial[], frentes: Frente[], fecha: string, usuario: string): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  doc.setProperties({ title: `Avance de obra · ${fechaTxt(fecha)} · AMURA`, author: usuario, creator: 'AMURA · Nuvarel' })
  const W = doc.internal.pageSize.getWidth()
  const M = 14
  doc.setFillColor(...IVORY).rect(0, 0, W, 26, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...BROWN).text('AVANCE DE OBRA', M, 14)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...SLATE).text(`AMURA Apartments · corte al ${fechaTxt(fecha)} · generado por ${usuario}`, M, 20)
  doc.setFontSize(8).text('Avance según lo registrado por los responsables autorizados.', W - M, 20, { align: 'right' })

  autoTable(doc, {
    startY: 32, margin: { left: M, right: M }, theme: 'grid',
    styles: { fontSize: 8, textColor: INK, cellPadding: 2 }, headStyles: { fillColor: BROWN, textColor: 255 },
    head: [['Frente', 'Planificado', 'Avance actual', 'Desviación', 'Actividades', 'Retrasadas', 'Último registro']],
    body: filas.map((f) => [
      f.frente.nombre, texto(f.planificado, 'Sin cronograma aprobado'), texto(f.actual),
      f.desviacion === null ? '—' : `${f.desviacion > 0 ? '+' : ''}${f.desviacion.toLocaleString('es-EC')} pts`, `${f.conAvance} de ${f.actividades} con avance`, String(f.retrasadas.length), fechaTxt(f.ultimoCorte),
    ]),
  })
  const retrasadas = filas.flatMap((f) => f.retrasadas.map((r) => [f.frente.nombre, r.actividad.codigo, r.actividad.nombre, dias(r), fechaTxt(r.actividad.planFin)]))
  let y = lastY(doc) + 8
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BROWN).text('Actividades con retraso', M, y)
  autoTable(doc, {
    startY: y + 2, margin: { left: M, right: M }, theme: 'striped', styles: { fontSize: 8, textColor: INK }, headStyles: { fillColor: BROWN, textColor: 255 },
    head: [['Frente', 'Código', 'Actividad', 'Situación', 'Fin previsto']], body: retrasadas.length ? retrasadas : [['Sin actividades con retraso', '', '', '', '']],
  })
  if (historial.length) {
    y = lastY(doc) + 8
    if (y > 170) { doc.addPage(); y = 20 }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...BROWN).text('Avance a fin de cada mes', M, y)
    autoTable(doc, {
      startY: y + 2, margin: { left: M, right: M }, theme: 'striped', styles: { fontSize: 8, textColor: INK }, headStyles: { fillColor: BROWN, textColor: 255 },
      head: [['Corte', ...frentes.map((f) => f.nombre)]], body: historial.map((p) => [fechaTxt(p.fecha), ...frentes.map((f) => texto(p.valores[f.id] ?? null, '—'))]),
    })
  }
  return doc
}

export { fechaTxt, texto }
