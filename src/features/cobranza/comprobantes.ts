import { jsPDF } from 'jspdf'
import { modoRemoto } from '@/app/auth'
import type { Datos } from '@/features/conexion/datos'
import { almacenContratosSupabase, nombreSeguro, type AlmacenContratos } from '@/features/contratos/almacen'
import { fmtFechaCorta } from '@/features/financiamiento/plan'

/**
 * Comprobantes de pago y recibos. El archivo va al bucket privado; en las tablas solo queda su ruta.
 * Registrar no confirma nada; el recibo se emite únicamente al confirmar, en el servidor.
 */
export const BUCKET_COMPROBANTES = 'comprobantes-pagos'
export const MIME_COMPROBANTE = ['application/pdf', 'image/jpeg', 'image/png']
export const MAX_COMPROBANTE = 10 * 1024 * 1024
export const AVISO_RECIBO = 'Este recibo no sustituye una factura ni otro comprobante tributario exigible por el SRI.'

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export interface DatosPago { monto: number; fecha: string; banco: string; referencia: string; archivo: File }

export interface Comprobante {
  id: string; reservaId: string | null; pagoId: string | null; monto: number; fecha: string; banco: string; referencia: string
  ruta: string | null; archivoNombre: string | null; archivoMime: string | null; estado: 'reportado' | 'confirmado' | 'rechazado'
  cargadoPor: string; cargadoEn: string; motivoRevision: string | null
}

export interface Recibo {
  id: string; numero: string; reservaId: string | null; pagoId: string | null; emisor: string; emisorRuc: string | null; emisorDireccion: string | null; comprobanteId: string | null; cliente: string; documento: string
  departamento: string; codigoUnidad: string; concepto: string; monto: number; fechaPago: string; referencia: string; banco: string | null
  aprobadoNombre: string; emitidoEn: string; pdfRuta: string | null; anuladoEn: string | null; motivoAnulacion: string | null
}

export const aComprobante = (e: Fila): Comprobante => ({
  id: String(e.id), reservaId: s(e.reservation_id), pagoId: s(e.payment_id), monto: Number(e.monto), fecha: String(e.fecha).slice(0, 10), banco: String(e.banco), referencia: String(e.referencia),
  ruta: s(e.ruta), archivoNombre: s(e.archivo_nombre), archivoMime: s(e.archivo_mime), estado: e.estado as Comprobante['estado'], cargadoPor: String(e.cargado_por), cargadoEn: String(e.cargado_en), motivoRevision: s(e.motivo_revision),
})

export const aRecibo = (v: Fila): Recibo => ({
  id: String(v.id), numero: String(v.numero), reservaId: s(v.reservation_id), pagoId: s(v.payment_id), emisor: String(v.emisor), emisorRuc: s(v.emisor_ruc), emisorDireccion: s(v.emisor_direccion), comprobanteId: s(v.comprobante_id), cliente: String(v.cliente), documento: String(v.documento ?? ''),
  departamento: String(v.departamento), codigoUnidad: String(v.codigo_unidad), concepto: String(v.concepto), monto: Number(v.monto), fechaPago: String(v.fecha_pago).slice(0, 10), referencia: String(v.referencia), banco: s(v.banco),
  aprobadoNombre: String(v.aprobado_nombre), emitidoEn: String(v.emitido_en), pdfRuta: s(v.pdf_ruta), anuladoEn: s(v.anulado_en), motivoAnulacion: s(v.motivo_anulacion),
})

/** Sin la migración, Cobranzas sigue funcionando sin comprobantes ni recibos. */
export const cargarComprobantes = (d: Datos) => d.select<Fila>('comprobantes_pago', { orden: [{ columna: 'cargado_en', asc: false }, { columna: 'id' }] }).then((f) => f.map(aComprobante)).catch(() => [] as Comprobante[])
export const cargarRecibos = (d: Datos) => d.select<Fila>('recibos_pago', { orden: [{ columna: 'emitido_en', asc: false }, { columna: 'id' }] }).then((f) => f.map(aRecibo)).catch(() => [] as Recibo[])

/** En pruebas no hay Storage real: se usa el que entregue la conexión. */
export const almacenPagos = (conexion: { almacen?: AlmacenContratos }): AlmacenContratos | null => conexion.almacen ?? (modoRemoto ? almacenContratosSupabase : null)

export function errorArchivo(f: File | null): string | null {
  if (!f) return null
  if (!MIME_COMPROBANTE.includes(f.type)) return `«${f.name}»: el comprobante debe ser una foto (JPG o PNG) o un PDF.`
  if (f.size === 0) return `«${f.name}» está vacío.`
  if (f.size > MAX_COMPROBANTE) return `«${f.name}» supera el máximo de 10 MB.`
  return null
}

export const huella = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')
export const leerArchivo = (f: Blob) => new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(new Error('No se pudo leer el archivo.')); r.readAsArrayBuffer(f) })

async function subirComprobante(almacen: AlmacenContratos | null, prefijo: string, archivo: File | null) {
  if (!archivo) throw new Error('Adjunta la foto o el PDF del comprobante bancario.')
  const error = errorArchivo(archivo)
  if (error) throw new Error(error)
  if (!almacen) throw new Error('El almacenamiento de comprobantes no está disponible.')
  const hash = await huella(await leerArchivo(archivo))
  const ruta = `${prefijo}${crypto.randomUUID()}-${nombreSeguro(archivo.name)}`
  await almacen.subir(BUCKET_COMPROBANTES, ruta, archivo, archivo.type)
  return { ruta, nombre: archivo.name, mime: archivo.type, tamano: archivo.size, hash }
}

/** Si el servidor rechaza el registro, el archivo no queda huérfano. La política de Storage impide quitar lo que ya esté vinculado. */
async function conLimpieza<T>(almacen: AlmacenContratos | null, ruta: string, registrar: () => Promise<T>): Promise<T> {
  try {
    return await registrar()
  } catch (e) {
    await almacen?.quitar?.(BUCKET_COMPROBANTES, ruta).catch(() => {})
    throw e
  }
}

export async function reportarPagoReserva(d: Datos, almacen: AlmacenContratos | null, reservaId: string, p: DatosPago) {
  const archivo = await subirComprobante(almacen, `reservas/${reservaId}/`, p.archivo)
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('reservas_reportar_pago', { p_id: reservaId, p_monto: p.monto, p_fecha: p.fecha, p_banco: p.banco, p_referencia: p.referencia, p_archivo: archivo }))
}

export async function reportarPagoContrato(d: Datos, almacen: AlmacenContratos | null, contratoId: string, p: DatosPago) {
  const archivo = await subirComprobante(almacen, `contratos/${contratoId}/`, p.archivo)
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('cobranzas_reportar_pago', { p_contract: contratoId, p_monto: p.monto, p_fecha: p.fecha, p_banco: p.banco, p_referencia: p.referencia, p_archivo: archivo }))
}

/* ------------------------------- devoluciones y retenciones de reservas anuladas */

export interface Movimiento {
  id: string; reservaId: string; tipo: 'devolucion' | 'retencion'; monto: number; fecha: string; referencia: string; motivo: string
  ruta: string; archivoNombre: string | null; archivoMime: string | null; estado: 'solicitado' | 'autorizado' | 'rechazado'; registradoPor: string; motivoResolucion: string | null
}

const aMovimiento = (m: Fila): Movimiento => ({
  id: String(m.id), reservaId: String(m.reservation_id), tipo: m.tipo as Movimiento['tipo'], monto: Number(m.monto), fecha: String(m.fecha).slice(0, 10), referencia: String(m.referencia), motivo: String(m.motivo),
  ruta: String(m.ruta), archivoNombre: s(m.archivo_nombre), archivoMime: s(m.archivo_mime), estado: m.estado as Movimiento['estado'], registradoPor: String(m.registrado_por), motivoResolucion: s(m.motivo_resolucion),
})

export const cargarMovimientos = (d: Datos) => d.select<Fila>('reserva_movimientos', { orden: [{ columna: 'registrado_en', asc: false }, { columna: 'id' }] }).then((f) => f.map(aMovimiento)).catch(() => [] as Movimiento[])

export async function registrarMovimiento(d: Datos, almacen: AlmacenContratos | null, reservaId: string, m: { tipo: Movimiento['tipo']; monto: number; fecha: string; referencia: string; motivo: string; archivo: File }) {
  const archivo = await subirComprobante(almacen, `movimientos/${reservaId}/`, m.archivo)
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('reservas_movimiento_registrar', { p_reserva: reservaId, p_tipo: m.tipo, p_monto: m.monto, p_fecha: m.fecha, p_referencia: m.referencia, p_motivo: m.motivo, p_archivo: archivo }))
}
export const resolverMovimiento = (d: Datos, id: string, autorizar: boolean, motivo: string) => d.rpc('reservas_movimiento_resolver', { p_id: id, p_autorizar: autorizar, p_motivo: motivo })
export async function archivoMovimiento(almacen: AlmacenContratos | null, m: Movimiento): Promise<Blob> {
  if (!almacen) throw new Error('El almacenamiento no está disponible.')
  return new Blob([await almacen.descargar(BUCKET_COMPROBANTES, m.ruta)], { type: m.archivoMime ?? 'application/octet-stream' })
}

export const rechazarPagoReserva = (d: Datos, id: string, motivo: string) => d.rpc('reservas_rechazar_pago', { p_id: id, p_motivo: motivo })
export const rechazarPagoContrato = (d: Datos, id: string, motivo: string) => d.rpc('cobranzas_rechazar_pago', { p_payment: id, p_motivo: motivo })

/** Abre o descarga el comprobante. Quién puede leerlo lo deciden las políticas de Storage. */
export async function archivoComprobante(almacen: AlmacenContratos | null, c: Comprobante): Promise<Blob> {
  if (!almacen || !c.ruta) throw new Error('Este pago no tiene archivo adjunto.')
  return new Blob([await almacen.descargar(BUCKET_COMPROBANTES, c.ruta)], { type: c.archivoMime ?? 'application/octet-stream' })
}

/* ----------------------------------------------------------------- recibo */

const usd = (v: number) => `USD ${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function construirReciboPdf(r: Recibo, comprobante?: string | null) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `Recibo ${r.numero}`, subject: `Recibo de pago · ${r.emisor}` })
  const W = doc.internal.pageSize.getWidth()
  const M = 20
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(40, 40, 40).text(r.emisor, M, 26)
  doc.setFontSize(13).setTextColor(88, 69, 54).text('RECIBO DE PAGO', W - M, 26, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(101, 117, 125).text(r.numero, W - M, 32, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(101, 117, 125)
  if (r.emisorRuc) doc.text(`RUC ${r.emisorRuc}`, M, 32)
  const direccion = r.emisorDireccion ? doc.splitTextToSize(r.emisorDireccion, W - 2 * M - 50) as string[] : []
  if (direccion.length) doc.text(direccion, M, 36.5)
  const linea = 38 + Math.max(0, direccion.length - 1) * 3.6 + (direccion.length ? 2 : 0)
  doc.setDrawColor(218, 211, 193).setLineWidth(0.4).line(M, linea, W - M, linea)
  let y = linea + 10
  const filas: [string, string][] = [
    ['Recibí de', r.documento ? `${r.cliente} · ${r.documento}` : r.cliente],
    ['Departamento', `${r.departamento} (${r.codigoUnidad})`],
    ['Concepto', r.concepto],
    ['Fecha del pago', fmtFechaCorta(r.fechaPago)],
    ...(r.banco ? [['Banco', r.banco] as [string, string]] : []),
    ['Referencia', r.referencia],
    ...(comprobante ? [['Comprobante bancario', comprobante] as [string, string]] : []),
    ['Aprobado por', r.aprobadoNombre],
    ['Emitido el', new Date(r.emitidoEn).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })],
  ]
  for (const [t, v] of filas) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(101, 117, 125).text(t, M, y)
    const lineas = doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(40, 40, 40).splitTextToSize(v, W - 2 * M - 42)
    doc.text(lineas, M + 42, y)
    y += 5 * lineas.length + 3
  }
  y += 4
  doc.setFillColor(247, 244, 237).setDrawColor(218, 211, 193).roundedRect(M, y, W - 2 * M, 18, 2, 2, 'FD')
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(101, 117, 125).text('Monto recibido', M + 5, y + 11)
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(88, 69, 54).text(usd(r.monto), W - M - 5, y + 11.5, { align: 'right' })
  y += 28
  if (r.anuladoEn) {
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(190, 40, 60).text(`RECIBO ANULADO${r.motivoAnulacion ? `: ${r.motivoAnulacion}` : ''}`, M, y, { maxWidth: W - 2 * M })
    y += 10
  }
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(101, 117, 125).text(AVISO_RECIBO, M, y, { maxWidth: W - 2 * M })
  return doc
}

/** Guarda el PDF una sola vez. Si otra persona ya lo guardó, no hace nada. */
export async function guardarPdfRecibo(d: Datos, almacen: AlmacenContratos | null, r: Recibo, comprobante?: string | null) {
  if (!almacen || r.pdfRuta) return
  const bytes = construirReciboPdf(r, comprobante).output('arraybuffer')
  const hash = await huella(bytes)
  // La huella en la ruta hace única cada carga: nunca se reutiliza un archivo que ya estuviera en el bucket.
  const ruta = `recibos/${r.numero}-${hash.slice(0, 12)}.pdf`
  await almacen.subir(BUCKET_COMPROBANTES, ruta, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
  await conLimpieza(almacen, ruta, () => d.rpc('recibos_registrar_pdf', { p_id: r.id, p_ruta: ruta, p_hash: hash }))
}

/** Después de confirmar: el recibo ya existe en la base; si el PDF falla, se puede generar al descargarlo. */
export async function completarRecibo(d: Datos, almacen: AlmacenContratos | null, reciboId: string | null): Promise<Recibo | null> {
  if (!reciboId) return null
  const [f] = await d.select<Fila>('recibos_pago', { filtros: { id: reciboId } })
  if (!f) return null
  const r = aRecibo(f)
  const [c] = r.comprobanteId ? await d.select<Fila>('comprobantes_pago', { filtros: { id: r.comprobanteId } }).catch(() => [] as Fila[]) : []
  await guardarPdfRecibo(d, almacen, r, c ? s(c.archivo_nombre) : null).catch(() => {})
  return r
}

export async function descargarRecibo(almacen: AlmacenContratos | null, r: Recibo, comprobante?: string | null) {
  let blob: Blob
  // Anulado se muestra con su leyenda; el archivo guardado no se reemplaza.
  if (r.pdfRuta && almacen && !r.anuladoEn) blob = new Blob([await almacen.descargar(BUCKET_COMPROBANTES, r.pdfRuta)], { type: 'application/pdf' })
  else blob = new Blob([construirReciboPdf(r, comprobante).output('arraybuffer')], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${r.numero}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface EventoHistorial { accion: string; motivo: string | null; usuario: string; fecha: string }
export const cargarHistorial = (d: Datos, reservaId: string | null, pagoId: string | null) => d.rpc<EventoHistorial[]>('pagos_historial', { p_reserva: reservaId, p_pago: pagoId })
