import { jsPDF } from 'jspdf'
import { modoRemoto } from '@/app/auth'
import type { Datos, Filtro } from '@/features/conexion/datos'
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

export const AVISO_CONSTANCIA = 'Este documento no acredita dinero recibido. El pago se acredita solo con el recibo definitivo numerado, una vez verificado por Finanzas.'

export type MedioPago = 'transferencia' | 'deposito' | 'cheque'
export const MEDIOS_PAGO: Record<MedioPago, { label: string; referencia: string; banco: string }> = {
  transferencia: { label: 'Transferencia', referencia: 'Número de transferencia', banco: 'Banco' },
  deposito: { label: 'Depósito', referencia: 'Número de depósito', banco: 'Banco' },
  cheque: { label: 'Cheque', referencia: 'Número de cheque', banco: 'Banco girador' },
}

export interface DatosPago { monto: number; fecha: string; banco: string; referencia: string; archivo: File; medio: MedioPago }

export interface Comprobante {
  id: string; reservaId: string | null; pagoId: string | null; monto: number; fecha: string; banco: string; referencia: string
  ruta: string | null; archivoNombre: string | null; archivoMime: string | null; estado: 'reportado' | 'confirmado' | 'rechazado'
  cargadoPor: string; cargadoEn: string; motivoRevision: string | null; medio: MedioPago; constanciaNumero: string | null
}

export interface Recibo {
  id: string; numero: string; reservaId: string | null; pagoId: string | null; emisor: string; emisorRuc: string | null; emisorDireccion: string | null; comprobanteId: string | null; cliente: string; documento: string
  departamento: string; codigoUnidad: string; concepto: string; monto: number; fechaPago: string; referencia: string; banco: string | null
  aprobadoNombre: string; emitidoEn: string; pdfRuta: string | null; anuladoEn: string | null; motivoAnulacion: string | null
}

export const aComprobante = (e: Fila): Comprobante => ({
  id: String(e.id), reservaId: s(e.reservation_id), pagoId: s(e.payment_id), monto: Number(e.monto), fecha: String(e.fecha).slice(0, 10), banco: String(e.banco), referencia: String(e.referencia),
  ruta: s(e.ruta), archivoNombre: s(e.archivo_nombre), archivoMime: s(e.archivo_mime), estado: e.estado as Comprobante['estado'], cargadoPor: String(e.cargado_por), cargadoEn: String(e.cargado_en), motivoRevision: s(e.motivo_revision),
  medio: (s(e.medio) ?? 'transferencia') as MedioPago, constanciaNumero: s(e.constancia_numero),
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

async function subirComprobante(almacen: AlmacenContratos | null, prefijo: string, archivo: File | null, falta = 'Adjunta la foto o el PDF del comprobante bancario.') {
  if (!archivo) throw new Error(falta)
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
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('reservas_reportar_pago', { p_id: reservaId, p_monto: p.monto, p_fecha: p.fecha, p_banco: p.banco, p_referencia: p.referencia, p_archivo: archivo, p_medio: p.medio }))
}

export async function reportarPagoContrato(d: Datos, almacen: AlmacenContratos | null, contratoId: string, p: DatosPago) {
  const archivo = await subirComprobante(almacen, `contratos/${contratoId}/`, p.archivo)
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('cobranzas_reportar_pago', { p_contract: contratoId, p_monto: p.monto, p_fecha: p.fecha, p_banco: p.banco, p_referencia: p.referencia, p_archivo: archivo, p_medio: p.medio }))
}

/* ------------------------------- excedente aplicado al saldo contra entrega */

/** Finanzas autoriza aplicar parte del saldo a favor al 80 %, con motivo y documento de soporte. No cambia cuotas ni contratos. */
export async function autorizarExcedente(d: Datos, almacen: AlmacenContratos | null, contratoId: string, x: { monto: number; motivo: string; archivo: File | null }) {
  const archivo = await subirComprobante(almacen, `excedentes/${contratoId}/`, x.archivo, 'Adjunta el documento de soporte de la autorización.')
  return conLimpieza(almacen, archivo.ruta, () => d.rpc<string>('cobranzas_autorizar_excedente', { p_contract: contratoId, p_monto: x.monto, p_motivo: x.motivo, p_archivo: archivo }))
}
export const anularAplicacion = (d: Datos, id: string, motivo: string) => d.rpc('cobranzas_anular_aplicacion', { p_id: id, p_motivo: motivo })
export async function archivoSoporte(almacen: AlmacenContratos | null, ruta: string): Promise<Blob> {
  if (!almacen) throw new Error('El almacenamiento no está disponible.')
  return new Blob([await almacen.descargar(BUCKET_COMPROBANTES, ruta)])
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

/** Datos de la unidad tomados de Inventario al generar el documento: no se copian en la base. */
export interface UnidadDocumento {
  dpt: string; edificio: number; piso: string; tipologia: string; areaM2: number; ubicacion: string
  bodegaCodigo: string | null; bodegaM2: number; patioM2: number; parqueo: string | null
}

const m2 = (v: number) => `${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`

/** Sin permiso de Inventario o sin la unidad, el documento sale con el departamento y el código, como antes. */
export async function cargarUnidadDocumento(d: Datos | null, codigo: string): Promise<UnidadDocumento | null> {
  if (!d) return null
  const [f] = await d.select<Fila>('inventory_units', { filtros: { codigo } }).catch(() => [] as Fila[])
  if (!f) return null
  return {
    dpt: String(f.dpt), edificio: Number(f.edificio), piso: String(f.piso), tipologia: String(f.tipologia), areaM2: Number(f.area_m2), ubicacion: String(f.ubicacion ?? ''),
    bodegaCodigo: s(f.bodega_codigo), bodegaM2: Number(f.bodega_m2 ?? 0), patioM2: Number(f.patio_m2 ?? 0), parqueo: s(f.parqueo),
  }
}

export function filasUnidad(u: UnidadDocumento | null | undefined): [string, string][] {
  if (!u) return []
  return [
    ['Edificio y piso', `Edificio ${u.edificio} · ${u.piso === 'PB' ? 'Planta baja' : `Piso ${u.piso}`}${u.ubicacion ? ` · ${u.ubicacion}` : ''}`],
    ['Tipología y área', `${u.tipologia} · ${m2(u.areaM2)}`],
    ...(u.patioM2 > 0 ? [['Patio', m2(u.patioM2)] as [string, string]] : []),
    ...(u.bodegaCodigo ? [['Bodega', `${u.bodegaCodigo}${u.bodegaM2 > 0 ? ` · ${m2(u.bodegaM2)}` : ''}`] as [string, string]] : []),
    ...(u.parqueo ? [['Parqueadero', u.parqueo] as [string, string]] : []),
  ]
}

interface Documento {
  titulo: string; numero: string; emisor: string; emisorRuc: string | null; emisorDireccion: string | null
  filas: [string, string][]; etiquetaMonto: string; monto: number; destacado: string | null; aviso: string
}

/** Formato común del recibo y la constancia: encabezado del emisor, datos, recuadro del monto y aviso. */
function documentoPdf(x: Documento) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  doc.setProperties({ title: `${x.titulo} ${x.numero}`, subject: `${x.titulo} · ${x.emisor}` })
  const W = doc.internal.pageSize.getWidth()
  const M = 20
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(40, 40, 40).text(x.emisor, M, 26)
  doc.setFontSize(x.titulo.length > 20 ? 10.5 : 13).setTextColor(88, 69, 54).text(x.titulo.toUpperCase(), W - M, 26, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(101, 117, 125).text(x.numero, W - M, 32, { align: 'right' })
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(101, 117, 125)
  if (x.emisorRuc) doc.text(`RUC ${x.emisorRuc}`, M, 32)
  const direccion = x.emisorDireccion ? doc.splitTextToSize(x.emisorDireccion, W - 2 * M - 50) as string[] : []
  if (direccion.length) doc.text(direccion, M, 36.5)
  const linea = 38 + Math.max(0, direccion.length - 1) * 3.6 + (direccion.length ? 2 : 0)
  doc.setDrawColor(218, 211, 193).setLineWidth(0.4).line(M, linea, W - M, linea)
  let y = linea + 10
  for (const [t, v] of x.filas) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(101, 117, 125).text(t, M, y)
    const lineas = doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(40, 40, 40).splitTextToSize(v, W - 2 * M - 42)
    doc.text(lineas, M + 42, y)
    y += 5 * lineas.length + 3
  }
  y += 4
  doc.setFillColor(247, 244, 237).setDrawColor(218, 211, 193).roundedRect(M, y, W - 2 * M, 18, 2, 2, 'FD')
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(101, 117, 125).text(x.etiquetaMonto, M + 5, y + 11)
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(88, 69, 54).text(usd(x.monto), W - M - 5, y + 11.5, { align: 'right' })
  y += 28
  if (x.destacado) {
    const lineas = doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(190, 40, 60).splitTextToSize(x.destacado, W - 2 * M)
    doc.text(lineas, M, y)
    y += 5.5 * lineas.length + 4
  }
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(101, 117, 125).text(x.aviso, M, y, { maxWidth: W - 2 * M })
  return doc
}

export function construirReciboPdf(r: Recibo, comprobante?: string | null, unidad?: UnidadDocumento | null) {
  return documentoPdf({
    titulo: 'Recibo de pago', numero: r.numero, emisor: r.emisor, emisorRuc: r.emisorRuc, emisorDireccion: r.emisorDireccion,
    filas: [
      ['Recibí de', r.documento ? `${r.cliente} · ${r.documento}` : r.cliente],
      ['Departamento', `${r.departamento} (${r.codigoUnidad})`],
      ...filasUnidad(unidad),
      ['Concepto', r.concepto],
      ['Fecha del pago', fmtFechaCorta(r.fechaPago)],
      ...(r.banco ? [['Banco', r.banco] as [string, string]] : []),
      ['Referencia', r.referencia],
      ...(comprobante ? [['Comprobante bancario', comprobante] as [string, string]] : []),
      ['Aprobado por', r.aprobadoNombre],
      ['Emitido el', new Date(r.emitidoEn).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })],
    ],
    etiquetaMonto: 'Monto recibido', monto: r.monto,
    destacado: r.anuladoEn ? `RECIBO ANULADO${r.motivoAnulacion ? `: ${r.motivoAnulacion}` : ''}` : null,
    aviso: AVISO_RECIBO,
  })
}

/* ------------------------------------------------------- constancia provisional */

export interface DatosConstancia {
  cliente: string; documento: string; departamento: string; codigoUnidad: string; concepto: string
  emisor: string; emisorRuc: string | null; emisorDireccion: string | null; registradoPor: string
}

const ESTADO_CONSTANCIA: Record<Comprobante['estado'], string | null> = {
  reportado: null,
  confirmado: 'PAGO YA VERIFICADO: el documento válido es el recibo definitivo numerado.',
  rechazado: 'COMPROBANTE RECHAZADO: este pago no fue acreditado.',
}

export function construirConstanciaPdf(c: Comprobante, x: DatosConstancia, unidad?: UnidadDocumento | null) {
  return documentoPdf({
    titulo: 'Constancia provisional de recepción de comprobante', numero: c.constanciaNumero ?? '', emisor: x.emisor, emisorRuc: x.emisorRuc, emisorDireccion: x.emisorDireccion,
    filas: [
      ['Cliente', x.documento ? `${x.cliente} · ${x.documento}` : x.cliente],
      ['Departamento', `${x.departamento} (${x.codigoUnidad})`],
      ...filasUnidad(unidad),
      ['Concepto', x.concepto],
      ['Medio de pago', MEDIOS_PAGO[c.medio].label],
      [MEDIOS_PAGO[c.medio].banco, c.banco],
      [MEDIOS_PAGO[c.medio].referencia, c.referencia],
      ['Fecha declarada', fmtFechaCorta(c.fecha)],
      ['Registrado por', x.registradoPor],
      ['Registrado el', new Date(c.cargadoEn).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })],
      ['Estado', c.estado === 'reportado' ? 'Pendiente de verificación por Finanzas' : c.estado === 'confirmado' ? 'Verificado' : 'Rechazado'],
    ],
    etiquetaMonto: 'Monto declarado (no acreditado)', monto: c.monto,
    destacado: ESTADO_CONSTANCIA[c.estado],
    aviso: AVISO_CONSTANCIA,
  })
}

/** Reúne cliente, unidad y emisor desde las tablas existentes. Lo que no se pueda leer queda como "—". */
async function datosConstancia(d: Datos, c: Comprobante): Promise<DatosConstancia & { unidad: UnidadDocumento | null }> {
  const uno = async (tabla: string, filtros: Filtro) =>(await d.select<Fila>(tabla, { filtros }).catch(() => [] as Fila[]))[0] ?? null
  let origen: Fila | null = null
  let concepto = 'Pago'
  if (c.reservaId) {
    origen = await uno('reservations', { id: c.reservaId })
    concepto = `Reserva ${origen ? String(origen.codigo) : ''}`.trim()
  } else if (c.pagoId) {
    const pago = await uno('payments', { id: c.pagoId })
    origen = pago ? await uno('contracts', { id: String(pago.contract_id) }) : null
    concepto = `Contrato ${origen ? String(origen.codigo) : ''}`.trim()
  }
  const codigo = origen ? String(origen.codigo_unidad) : '—'
  const [cliente, emisor, perfil, unidad] = await Promise.all([
    origen ? uno('clients', { id: String(origen.client_id) }) : null,
    uno('emisor_recibos', { id: 1 }),
    uno('profiles', { id: c.cargadoPor }),
    cargarUnidadDocumento(d, codigo),
  ])
  return {
    cliente: cliente ? String(cliente.nombre) : '—', documento: cliente ? String(cliente.documento ?? '') : '', departamento: unidad?.dpt ?? codigo, codigoUnidad: codigo, concepto,
    emisor: emisor ? String(emisor.razon_social) : 'NUVAREL S.A.S.', emisorRuc: emisor ? s(emisor.ruc) : null, emisorDireccion: emisor ? s(emisor.direccion) : null,
    registradoPor: perfil ? String(perfil.nombre) : 'Usuario', unidad,
  }
}

export function descargarPdf(bytes: ArrayBuffer, nombre: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Se genera al pedirla, con el estado actual del comprobante: no se guarda una copia. */
export async function descargarConstancia(d: Datos, c: Comprobante) {
  if (!c.constanciaNumero) throw new Error('Este comprobante se registró antes de las constancias y no tiene número.')
  const { unidad, ...x } = await datosConstancia(d, c)
  descargarPdf(construirConstanciaPdf(c, x, unidad).output('arraybuffer'), `${c.constanciaNumero}.pdf`)
}

/** La constancia del último comprobante de una reserva, para quien lo registró desde Atender cliente. */
export async function descargarConstanciaReserva(d: Datos, reservaId: string) {
  const filas = await d.select<Fila>('comprobantes_pago', { filtros: { reservation_id: reservaId }, orden: [{ columna: 'cargado_en', asc: false }, { columna: 'id' }] })
  if (!filas[0]) throw new Error('No se encontró el comprobante registrado.')
  await descargarConstancia(d, aComprobante(filas[0]))
}

/** Guarda el PDF una sola vez. Si otra persona ya lo guardó, no hace nada. */
export async function guardarPdfRecibo(d: Datos, almacen: AlmacenContratos | null, r: Recibo, comprobante?: string | null) {
  if (!almacen || r.pdfRuta) return
  const bytes = construirReciboPdf(r, comprobante, await cargarUnidadDocumento(d, r.codigoUnidad)).output('arraybuffer')
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

/** `d` permite completar los datos de la unidad cuando el PDF se genera en ese momento. */
export async function descargarRecibo(almacen: AlmacenContratos | null, r: Recibo, comprobante?: string | null, d: Datos | null = null) {
  // Anulado se muestra con su leyenda; el archivo guardado no se reemplaza.
  const bytes = r.pdfRuta && almacen && !r.anuladoEn
    ? await almacen.descargar(BUCKET_COMPROBANTES, r.pdfRuta)
    : construirReciboPdf(r, comprobante, await cargarUnidadDocumento(d, r.codigoUnidad)).output('arraybuffer')
  descargarPdf(bytes, `${r.numero}.pdf`)
}

export interface EventoHistorial { accion: string; motivo: string | null; usuario: string; fecha: string }
export const cargarHistorial = (d: Datos, reservaId: string | null, pagoId: string | null) => d.rpc<EventoHistorial[]>('pagos_historial', { p_reserva: reservaId, p_pago: pagoId })
