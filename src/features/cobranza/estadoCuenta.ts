import { jsPDF } from 'jspdf'
import type { Datos } from '@/features/conexion/datos'
import { fechaGuayaquil, fmtFechaCorta } from '@/features/financiamiento/plan'
import { calcularEstadoCuenta, type EstadoCuenta } from '../../../supabase/functions/_shared/estadoCuenta'
import { SITUACION, type ResumenContrato } from './tablero'
import type { DatosCobranza } from './api'
import { cargarUnidadDocumento, descargarPdf, filasUnidad, type UnidadDocumento } from './comprobantes'

export const AVISO_ESTADO_CUENTA = 'Documento informativo con los pagos verificados por Finanzas a la fecha de corte. No es una factura ni un comprobante tributario. Los pagos pendientes de verificación no se suman.'

type Fila = Record<string, unknown>
const usd = (v: number) => `USD ${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface CabeceraEstadoCuenta {
  emisor: string; emisorRuc: string | null; emisorDireccion: string | null
  cliente: string; documento: string; departamento: string; codigoUnidad: string; codigoContrato: string; precio: number; estado: string
}

/** Arma el estado de cuenta del contrato con lo que ya cargó Cobranzas. */
export function estadoCuentaDe(r: ResumenContrato, d: Pick<DatosCobranza, 'pagos' | 'recibos' | 'reservaDeContrato'>, hoy: string): EstadoCuenta {
  const reserva = d.reservaDeContrato.get(r.contrato.id)
  const recibo = (p: { id: string; referencia: string }) => d.recibos.find((v) => v.pagoId === p.id)
    ?? d.recibos.find((v) => v.reservaId !== null && v.reservaId === reserva && v.referencia === p.referencia) ?? null
  return calcularEstadoCuenta({
    hoy,
    contrato: { codigo: r.contrato.codigo, estado: r.contrato.estado, precio: r.contrato.precio },
    cuotas: r.cuotas.map((q) => ({ numero: q.numero, concepto: q.concepto, vencimiento: q.vencimiento, monto: q.monto })),
    pagos: d.pagos.filter((p) => p.contratoId === r.contrato.id).map((p) => {
      const v = recibo(p)
      return { id: p.id, fecha: p.fecha, referencia: p.referencia, monto: p.monto, estado: p.estado, recibo: v?.numero ?? null, concepto: v?.concepto ?? null }
    }),
    aplicaciones: r.aplicaciones.map((a) => ({ monto: a.monto, autorizadoEn: a.autorizadoEn, motivo: a.motivo, anulada: !!a.anuladoEn })),
  })
}

export function construirEstadoCuentaPdf(e: EstadoCuenta, x: CabeceraEstadoCuenta, unidad?: UnidadDocumento | null) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Estado de cuenta ${x.codigoContrato}`, subject: `Estado de cuenta · ${x.emisor}` })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 18
  let y = 0
  const gris = () => doc.setTextColor(101, 117, 125)
  const oscuro = () => doc.setTextColor(40, 40, 40)
  const espacio = (alto: number) => { if (y + alto > H - 18) { doc.addPage(); y = 20 } }

  doc.setFont('helvetica', 'bold').setFontSize(15); oscuro(); doc.text(x.emisor, M, 24)
  doc.setFontSize(13).setTextColor(88, 69, 54).text('ESTADO DE CUENTA', W - M, 24, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(9.5); gris(); doc.text(`Corte al ${fmtFechaCorta(e.hoy)}`, W - M, 30, { align: 'right' })
  doc.setFontSize(8.5)
  if (x.emisorRuc) doc.text(`RUC ${x.emisorRuc}`, M, 30)
  if (x.emisorDireccion) doc.text(doc.splitTextToSize(x.emisorDireccion, W - 2 * M - 60) as string[], M, 34.5)
  doc.setDrawColor(218, 211, 193).setLineWidth(0.4).line(M, 40, W - M, 40)
  y = 47

  const datos: [string, string][] = [
    ['Comprador', x.documento ? `${x.cliente} · ${x.documento}` : x.cliente],
    ['Contrato', `${x.codigoContrato} · ${x.estado}`],
    ['Departamento', x.departamento],
    ...filasUnidad(unidad),
    ['Precio', usd(x.precio)],
  ]
  for (const [t, v] of datos) {
    doc.setFont('helvetica', 'normal').setFontSize(9); gris(); doc.text(t, M, y)
    doc.setFont('helvetica', 'bold'); oscuro(); doc.text(v, M + 36, y)
    y += 5.5
  }

  const recuadros = (items: [string, string][]) => {
    y += 3
    espacio(20)
    const ancho = (W - 2 * M - 3 * (items.length - 1)) / items.length
    items.forEach(([t, v], i) => {
      const xi = M + i * (ancho + 3)
      doc.setFillColor(247, 244, 237).setDrawColor(218, 211, 193).roundedRect(xi, y, ancho, 15, 1.5, 1.5, 'FD')
      doc.setFont('helvetica', 'normal').setFontSize(8); gris(); doc.text(t, xi + 3, y + 5.5)
      doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(88, 69, 54).text(v, xi + 3, y + 11.5)
    })
    y += 21
  }
  const titulo = (t: string) => { espacio(14); doc.setFont('helvetica', 'bold').setFontSize(11); oscuro(); doc.text(t, M, y); y += 6 }
  // Columnas: [texto, ancho en mm, alineación].
  const tabla = (cols: [string, number, 'left' | 'right'][], filas: string[][]) => {
    const encabezado = () => {
      doc.setFillColor(240, 237, 230).rect(M, y - 4, W - 2 * M, 6, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(8); gris()
      let xi = M + 1.5
      for (const [t, w, a] of cols) { doc.text(t, a === 'right' ? xi + w - 3 : xi, y, { align: a }); xi += w }
      y += 5.5
    }
    espacio(12); encabezado()
    for (const f of filas) {
      if (y > H - 20) { doc.addPage(); y = 20; encabezado() }
      doc.setFont('helvetica', 'normal').setFontSize(8.5); oscuro()
      let xi = M + 1.5
      f.forEach((v, i) => { const [, w, a] = cols[i]; doc.text(v, a === 'right' ? xi + w - 3 : xi, y, { align: a }); xi += w })
      y += 5
    }
    y += 3
  }

  titulo('Entrada (20 %)')
  recuadros([['Pactado', usd(e.entrada.pactado)], ['Pagado', usd(e.entrada.pagado)], ['Saldo pendiente', usd(e.entrada.saldo)], ['Vencido', usd(e.entrada.vencido)]])
  tabla([['Cuota', 66, 'left'], ['Vence', 24, 'left'], ['Monto', 28, 'right'], ['Pagado', 28, 'right'], ['Saldo', 28, 'right']],
    e.entrada.cuotas.map((q) => [`${q.concepto} (nº ${q.numero})`, fmtFechaCorta(q.vencimiento), usd(q.monto), usd(q.pagado), q.saldo > 0 ? usd(q.saldo) : SITUACION[q.situacion].label]))

  titulo('Pagos confirmados')
  if (e.pagosConfirmados.length) {
    tabla([['Fecha', 24, 'left'], ['Concepto', 62, 'left'], ['Referencia', 34, 'left'], ['Recibo', 26, 'left'], ['Monto', 28, 'right']],
      e.pagosConfirmados.map((p) => [fmtFechaCorta(p.fecha), (p.concepto ?? 'Pago').slice(0, 40), p.referencia.slice(0, 22), p.recibo ?? '—', usd(p.monto)]))
  } else { doc.setFont('helvetica', 'normal').setFontSize(9); gris(); doc.text('Sin pagos confirmados.', M, y); y += 7 }
  doc.setFont('helvetica', 'bold').setFontSize(9); oscuro(); doc.text(`Total confirmado: ${usd(e.totalConfirmado)}`, W - M, y - 1, { align: 'right' }); y += 5

  if (e.pagosPendientes.length) {
    titulo('Pagos pendientes de verificación (no se suman)')
    tabla([['Fecha', 24, 'left'], ['Referencia', 96, 'left'], ['Monto', 54, 'right']], e.pagosPendientes.map((p) => [fmtFechaCorta(p.fecha), p.referencia, usd(p.monto)]))
  }

  titulo('Saldo contra entrega (80 %)')
  recuadros([['Monto', usd(e.financiamiento.monto)], ['Aplicado con autorización', usd(e.financiamiento.aplicado)], ['Saldo pendiente', usd(e.financiamiento.saldo)], ['Saldo a favor sin aplicar', usd(e.saldoAFavor)]])
  if (e.financiamiento.aplicaciones.length) {
    tabla([['Autorizado el', 30, 'left'], ['Motivo', 116, 'left'], ['Monto', 28, 'right']],
      e.financiamiento.aplicaciones.map((a) => [fmtFechaCorta(fechaGuayaquil(a.autorizadoEn)), a.motivo.slice(0, 70), usd(a.monto)]))
  }

  espacio(14)
  doc.setFont('helvetica', 'normal').setFontSize(8); gris()
  doc.text(doc.splitTextToSize(AVISO_ESTADO_CUENTA, W - 2 * M) as string[], M, y + 2)
  return doc
}

/** Se genera al pedirlo con los datos vigentes: no se guarda una copia. */
export async function descargarEstadoCuenta(datos: Datos, r: ResumenContrato, d: DatosCobranza, hoy: string) {
  const uno = async (tabla: string, id: string | number) => (await datos.select<Fila>(tabla, { filtros: { id } }).catch(() => [] as Fila[]))[0] ?? null
  const [cliente, emisor, unidad] = await Promise.all([uno('clients', r.contrato.clientId), uno('emisor_recibos', 1), cargarUnidadDocumento(datos, r.contrato.unidad)])
  const txt = (v: unknown) => (v === null || v === undefined ? null : String(v))
  const e = estadoCuentaDe(r, d, hoy)
  const doc = construirEstadoCuentaPdf(e, {
    emisor: txt(emisor?.razon_social) ?? 'NUVAREL S.A.S.', emisorRuc: txt(emisor?.ruc), emisorDireccion: txt(emisor?.direccion),
    cliente: r.contrato.cliente, documento: txt(cliente?.documento) ?? '', departamento: d.departamentos.get(r.contrato.unidad) ?? r.contrato.unidad, codigoUnidad: r.contrato.unidad,
    codigoContrato: r.contrato.codigo, precio: r.contrato.precio, estado: r.contrato.estado === 'firmado' ? 'Firmado' : r.contrato.estado === 'borrador' ? 'Borrador' : 'Anulado',
  }, unidad)
  descargarPdf(doc.output('arraybuffer'), `Estado-de-cuenta-${r.contrato.codigo}-${hoy}.pdf`)
}
