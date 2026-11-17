import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'

/**
 * Expediente de venta: carátula personalizada + formularios maestros de AMURA (originales, sin cambios) + ficha técnica
 * solo cuando esté aprobada. Los maestros se guardan una vez en Storage; aquí solo se combinan.
 */
export const MAESTROS = {
  natural: { nombre: 'AMURA-01-Formularios-Personas-Naturales.pdf', paginas: 14 },
  juridica: { nombre: 'AMURA-02-Formularios-Personas-Juridicas.pdf', paginas: 14 },
  ficha: { nombre: 'AMURA-03-Especificaciones-Tecnicas.pdf', paginas: 2 },
} as const

export type TipoMaestro = keyof typeof MAESTROS

/** Comprueba que el archivo es el maestro esperado (número de páginas) antes de usarlo. */
export async function validarMaestro(clave: TipoMaestro, bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false })
  const esperado = MAESTROS[clave].paginas
  if (doc.getPageCount() !== esperado) {
    throw new Error(`El maestro «${MAESTROS[clave].nombre}» tiene ${doc.getPageCount()} páginas; se esperaban ${esperado}. No se usa.`)
  }
  return bytes
}

export interface DatosCaratula {
  cliente: { nombre: string; tipo: 'natural' | 'juridica'; documento: string | null; representante: string | null; telefono: string | null; email: string | null }
  inmueble: { proyecto: string; edificio: string; piso: string; departamento: string; areaM2: number; bodegaM2: number; patioM2: number; parqueo: string | null }
  comercial: {
    documento: string
    fecha: string
    /** Estado tal como consta en el sistema (p. ej. «Cotización emitida»). Nunca se presenta como venta si no lo es. */
    estado: string
    precioAcordado: number
    reservaPct: number
    cuotasPct: number
    cuotas: number
    cuotaMensual: number
    ultimaCuota: number
    primeraCuota: string | null
    ultimaFecha: string | null
    diaPago: string | null
    entregaPct: number
    contraEntrega: number
    asesor: string
  }
}

const usd = (v: number) => `USD ${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number) => `${v.toLocaleString('es-EC', { maximumFractionDigits: 2 })} %`
const txt = (v: string | null | undefined) => (v && v.trim() ? v : 'No registrado')

/** Carátula A4 con los datos de la operación. Solo muestra lo que está registrado. */
export async function construirCaratula(d: DatosCaratula, logoPng?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Carátula · ${d.comercial.documento} · AMURA`)
  doc.setCreator('AMURA · Nuvarel')
  const pag = doc.addPage([595.28, 841.89])
  const { width: W, height: H } = pag.getSize()
  const M = 48
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.16, 0.16, 0.16), marron = rgb(0.345, 0.27, 0.21), gris = rgb(0.4, 0.45, 0.49), arena = rgb(0.85, 0.83, 0.76)

  pag.drawRectangle({ x: 0, y: H - 110, width: W, height: 110, color: rgb(0.97, 0.96, 0.93) })
  if (logoPng) {
    const img = await doc.embedPng(logoPng)
    const w = 150, h = (img.height / img.width) * w
    pag.drawImage(img, { x: M, y: H - 80 - h / 2 + 10, width: w, height: h })
  } else {
    pag.drawText('AMURA', { x: M, y: H - 70, size: 22, font: bold, color: ink })
  }
  pag.drawText('CARÁTULA DE EXPEDIENTE', { x: W - M - bold.widthOfTextAtSize('CARÁTULA DE EXPEDIENTE', 13), y: H - 52, size: 13, font: bold, color: marron })
  const derecha = (t: string, y: number, f: PDFFont = sans, c = gris, s = 9) => pag.drawText(t, { x: W - M - f.widthOfTextAtSize(t, s), y, size: s, font: f, color: c })
  derecha(`${d.comercial.documento} · ${d.comercial.fecha}`, H - 70)
  derecha(`Estado: ${d.comercial.estado}`, H - 84)

  let y = H - 150
  const seccion = (titulo: string) => {
    pag.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: arena })
    pag.drawText(titulo.toUpperCase(), { x: M, y: y - 6, size: 9, font: bold, color: marron })
    y -= 24
  }
  const campo = (etiqueta: string, valor: string) => {
    pag.drawText(etiqueta, { x: M, y, size: 8.5, font: bold, color: gris })
    pag.drawText(valor, { x: M + 150, y, size: 10, font: sans, color: ink })
    y -= 17
  }

  seccion('Datos del cliente')
  campo(d.cliente.tipo === 'juridica' ? 'Razón social' : 'Nombre', txt(d.cliente.nombre))
  campo('Tipo de comprador', d.cliente.tipo === 'juridica' ? 'Persona jurídica' : 'Persona natural')
  campo(d.cliente.tipo === 'juridica' ? 'RUC' : 'Cédula / pasaporte', txt(d.cliente.documento))
  if (d.cliente.tipo === 'juridica') campo('Representante legal', txt(d.cliente.representante))
  campo('Teléfono', txt(d.cliente.telefono))
  campo('Correo electrónico', txt(d.cliente.email))
  y -= 8

  seccion('Inmueble')
  campo('Proyecto', d.inmueble.proyecto)
  campo('Edificio', d.inmueble.edificio)
  campo('Piso', d.inmueble.piso)
  campo('Departamento', d.inmueble.departamento)
  campo('Superficie', `${d.inmueble.areaM2.toLocaleString('es-EC', { minimumFractionDigits: 2 })} m²`)
  if (d.inmueble.bodegaM2 > 0) campo('Bodega', `${d.inmueble.bodegaM2.toLocaleString('es-EC', { minimumFractionDigits: 2 })} m²`)
  if (d.inmueble.patioM2 > 0) campo('Patio', `${d.inmueble.patioM2.toLocaleString('es-EC', { minimumFractionDigits: 2 })} m²`)
  campo('Parqueadero', txt(d.inmueble.parqueo))
  y -= 8

  seccion('Condiciones comerciales')
  campo('Documento', `${d.comercial.documento} · ${d.comercial.fecha}`)
  campo('Precio acordado', usd(d.comercial.precioAcordado))
  campo('Pago a la firma', `${pct(d.comercial.reservaPct)} (incluye la reserva)`)
  campo('Diferido', `${pct(d.comercial.cuotasPct)} en ${d.comercial.cuotas} cuotas de ${usd(d.comercial.cuotaMensual)}; última ${usd(d.comercial.ultimaCuota)}`)
  campo('Día de pago', d.comercial.diaPago ?? 'No registrado')
  campo('Primera / última cuota', d.comercial.primeraCuota && d.comercial.ultimaFecha ? `${d.comercial.primeraCuota} / ${d.comercial.ultimaFecha}` : 'No registrado')
  campo('Contra entrega', `${pct(d.comercial.entregaPct)}: ${usd(d.comercial.contraEntrega)}`)
  campo('Asesor responsable', txt(d.comercial.asesor))
  y -= 10

  pag.drawText('Esta carátula resume la operación registrada en AMURA. Los montos son los acordados; los pagos efectivamente', { x: M, y, size: 8, font: sans, color: gris })
  pag.drawText('recibidos se verifican en el expediente de cobranza. No constituye aprobación documental de Cumplimiento.', { x: M, y: y - 11, size: 8, font: sans, color: gris })
  return doc.save()
}

/** Une carátula + formulario maestro (+ ficha, si está aprobada), sin modificar las páginas originales. */
export async function construirExpediente(caratula: Uint8Array, maestro: Uint8Array, ficha?: Uint8Array): Promise<{ bytes: Uint8Array; paginas: number }> {
  const out = await PDFDocument.create()
  const partes = [caratula, maestro, ...(ficha ? [ficha] : [])]
  for (const parte of partes) {
    const src = await PDFDocument.load(parte)
    const paginas = await out.copyPages(src, src.getPageIndices())
    paginas.forEach((p) => out.addPage(p))
  }
  out.setTitle('Expediente de venta · AMURA')
  out.setCreator('AMURA · Nuvarel')
  const bytes = await out.save()
  return { bytes, paginas: out.getPageCount() }
}

/** Nombre de descarga: AMURA_Expediente_<Cliente>_<Departamento>_<fecha>.pdf */
export function nombreExpediente(cliente: string, departamento: string, fecha: string) {
  const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `AMURA_Expediente_${limpio(cliente) || 'Cliente'}_${limpio(departamento)}_${fecha}.pdf`
}
