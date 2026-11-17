import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { edificioDocumento } from '@/features/inventario/nomenclatura'

/**
 * Orden de contrato AMURA: documento de gestión comercial de una sola página (A4).
 * Los datos salen de la cotización registrada y del cliente (Clientes). Lo que no consta se muestra como «No registrado»; nunca se inventa.
 * No modifica la cotización ni reemplaza los formularios maestros del expediente.
 */

/** Datos del comprador que viven en Clientes (migración 0020 agrega el representante legal). */
export interface DatosClienteOrden {
  domicilio: string | null
  /** Etiqueta legible (p. ej. «Casado(a)»). Null si no está registrado. */
  estadoCivil: string | null
  /** Etiqueta legible del medio de captación (p. ej. «Instagram»). */
  medioCaptacion: string | null
  representante: { nombre: string; documento: string | null; calidad: string | null } | null
}

export interface DatosOrden {
  numeroCotizacion: string
  fechaEmision: string
  asesor: string
  cliente: { nombre: string; tipo: TipoPersona; documento: string | null; telefono: string | null; email: string | null; direccion: string | null; estadoCivil: string | null; medioCaptacion: string | null; representante: DatosClienteOrden['representante'] }
  inmueble: { proyecto: string; edificio: string; departamento: string; tipologia: string; areaM2: number; bodegaM2: number; patioM2: number; parqueo: string | null }
  financiero: {
    precioLista: number; descuentoPct: number; descuentoUsd: number; precioFinal: number
    reservaPct: number; reserva: number
    cuotasPct: number; cuotasTotal: number; meses: number; cuotaMensual: number; ultimaCuota: number
    entregaPct: number; contraEntrega: number
    primeraCuota: string | null; diaPago: string | null
  }
  observaciones: string
}

/** Errores que impiden generar la orden. Una lista vacía significa que se puede generar. */
export function validarOrden(d: DatosOrden): string[] {
  const e: string[] = []
  if (!d.cliente.nombre.trim()) e.push('Falta el nombre del comprador.')
  if (!d.cliente.documento) e.push('Falta la cédula o RUC del comprador.')
  if (d.cliente.tipo === 'juridica') {
    if (!d.cliente.representante?.nombre?.trim()) e.push('Falta el representante legal de la persona jurídica.')
    if (!d.cliente.representante?.documento?.trim()) e.push('Falta la cédula del representante legal.')
  }
  if (!d.inmueble.departamento) e.push('Falta el departamento.')
  const f = d.financiero
  if (!(f.precioFinal > 0)) e.push('El precio final debe ser mayor que cero.')
  const suma = Math.round((f.reserva + f.cuotasTotal + f.contraEntrega) * 100) / 100
  if (Math.abs(suma - f.precioFinal) > 0.01) e.push(`Los componentes del financiamiento suman ${suma.toFixed(2)} y el precio final es ${f.precioFinal.toFixed(2)}.`)
  if (Math.abs(f.precioLista - f.descuentoUsd - f.precioFinal) > 0.01) e.push('El precio de lista menos el descuento no coincide con el precio final.')
  if (f.meses < 1) e.push('El número de cuotas no es válido.')
  return e
}

/** Datos de la orden a partir de la cotización y del cliente. El tipo de comprador lo confirma el vendedor antes de generar. */
export function datosOrden(c: Cotizacion, tipo: TipoPersona, fechaEmision: string, cliente: DatosClienteOrden): DatosOrden {
  const p = c.plan
  return {
    numeroCotizacion: c.numero,
    fechaEmision,
    asesor: c.asesor.nombre,
    cliente: {
      nombre: c.cliente.nombre,
      tipo,
      documento: c.cliente.documento ?? null,
      telefono: c.cliente.telefono || null,
      email: c.cliente.email || null,
      direccion: cliente.domicilio,
      estadoCivil: cliente.estadoCivil,
      medioCaptacion: cliente.medioCaptacion,
      representante: tipo === 'juridica' ? cliente.representante : null,
    },
    inmueble: {
      proyecto: 'AMURA Apartments',
      edificio: edificioDocumento(c.unidad),
      departamento: c.unidad.dpt,
      tipologia: c.unidad.tipologia,
      areaM2: c.unidad.areaM2,
      bodegaM2: c.unidad.bodegaM2 ?? 0,
      patioM2: c.unidad.patioM2 ?? 0,
      parqueo: c.unidad.parqueo ?? null,
    },
    financiero: {
      precioLista: p.precioLista,
      descuentoPct: p.descuentoPct,
      descuentoUsd: p.descuentoMonto,
      precioFinal: p.precioFinal,
      reservaPct: p.reservaPct,
      reserva: p.reserva,
      cuotasPct: p.cuotasPct,
      cuotasTotal: p.cuotasTotal,
      meses: p.meses,
      cuotaMensual: p.cuotaMensual,
      ultimaCuota: p.ultimaCuota,
      entregaPct: p.entregaPct,
      contraEntrega: p.contraEntrega,
      primeraCuota: p.vencimientos?.[0] ?? null,
      diaPago: p.diaPago ? (p.diaPago === 'ultimo' ? 'último día del mes' : `día ${p.diaPago}`) : null,
    },
    observaciones: c.observaciones,
  }
}

const NR = 'No registrado'
const txt = (v: string | null | undefined) => (v && v.trim() ? v.trim() : NR)
const usd = (v: number) => `USD ${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (v: number) => `${v.toLocaleString('es-EC', { maximumFractionDigits: 2 })} %`
const m2 = (v: number) => `${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`
const fecha = (iso: string | null) => {
  if (!iso) return NR
  const [y, mo, d] = iso.split('-')
  return y && mo && d ? `${d}/${mo}/${y}` : iso
}

const NAVY = rgb(0.09, 0.2, 0.29)
const GOLD = rgb(0.79, 0.65, 0.42)
const INK = rgb(0.13, 0.15, 0.18)
const GRIS = rgb(0.42, 0.46, 0.5)
const LINEA = rgb(0.82, 0.85, 0.87)
const FONDO = rgb(0.95, 0.96, 0.96)
const W = 595.28
const H = 841.89
const M = 40

/** Genera la orden de contrato en PDF (A4, una sola página). Lanza error si los datos no son válidos o si no cabe en una página. */
export async function construirOrdenContrato(d: DatosOrden): Promise<Uint8Array> {
  const errores = validarOrden(d)
  if (errores.length) throw new Error(`La orden de contrato no puede generarse: ${errores.join(' ')}`)

  const doc = await PDFDocument.create()
  doc.setTitle(`Orden de contrato · ${d.numeroCotizacion} · AMURA`)
  doc.setCreator('AMURA Apartments')
  const pag = doc.addPage([W, H])
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  // Encabezado
  pag.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: NAVY })
  pag.drawText('AMURA', { x: M, y: H - 52, size: 26, font: bold, color: rgb(1, 1, 1) })
  pag.drawText('A P A R T M E N T S', { x: M, y: H - 68, size: 7.5, font: bold, color: GOLD })
  const titulo = 'ORDEN DE CONTRATO'
  pag.drawText(titulo, { x: W - M - bold.widthOfTextAtSize(titulo, 17), y: H - 50, size: 17, font: bold, color: rgb(1, 1, 1) })
  const sub = 'Documento de gestión comercial'
  pag.drawText(sub, { x: W - M - sans.widthOfTextAtSize(sub, 9), y: H - 66, size: 9, font: sans, color: rgb(0.85, 0.88, 0.9) })

  let y = H - 118
  pag.drawText('N.º de orden: ____________________', { x: M, y, size: 9, font: sans, color: INK })
  const emi = `Fecha de emisión: ${fecha(d.fechaEmision)}   ·   Cotización: ${d.numeroCotizacion}`
  pag.drawText(emi, { x: W - M - sans.widthOfTextAtSize(emi, 9), y, size: 9, font: sans, color: INK })
  y -= 22

  const seccion = (t: string) => {
    y -= 6
    pag.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: NAVY })
    pag.drawText(t.toUpperCase(), { x: M + 8, y: y + 1, size: 8.5, font: bold, color: rgb(1, 1, 1) })
    y -= 24
  }

  /** Campo: etiqueta pequeña, valor en una o dos líneas, línea de firma. Ocupa `ancho` puntos desde `x`. */
  const campo = (x: number, ancho: number, etiqueta: string, valor: string) => {
    pag.drawText(etiqueta.toUpperCase(), { x, y, size: 6.5, font: bold, color: GRIS })
    const lineas = envolver(valor, sans, 8.8, ancho - 6, 2)
    lineas.forEach((l, i) => pag.drawText(l, { x, y: y - 12 - i * 9.5, size: 8.8, font: sans, color: INK }))
    pag.drawLine({ start: { x, y: y - 27 }, end: { x: x + ancho - 8, y: y - 27 }, thickness: 0.5, color: LINEA })
  }
  const fila = (campos: [string, string][], altura = 32) => {
    const ancho = (W - 2 * M) / campos.length
    campos.forEach(([e, v], i) => campo(M + i * ancho, ancho, e, v))
    y -= altura
  }

  const c = d.cliente
  const i = d.inmueble
  const f = d.financiero
  const juridica = c.tipo === 'juridica'

  seccion('Gestión comercial')
  fila([['Asesor / ejecutivo', d.asesor], ['Medio de captación', txt(c.medioCaptacion)]])

  seccion('Datos del comprador')
  fila([[juridica ? 'Razón social' : 'Nombre completo', txt(c.nombre)]])
  fila([[juridica ? 'RUC' : 'Cédula / pasaporte', txt(c.documento)], ['Estado civil / tipo de comprador', `${juridica ? 'Persona jurídica' : 'Persona natural'} · ${juridica ? 'no aplica' : txt(c.estadoCivil)}`]])
  fila([['Teléfono', txt(c.telefono)], ['Correo electrónico', txt(c.email)]])
  fila([['Dirección', txt(c.direccion)]])

  seccion('Representante o apoderado (si aplica)')
  fila(juridica
    ? [['Nombre completo', txt(c.representante?.nombre)], ['Identificación / calidad', [txt(c.representante?.documento), c.representante?.calidad?.trim() || null].filter(Boolean).join(' · ')]]
    : [['Nombre completo', 'No aplica'], ['Identificación / calidad', 'No aplica']])

  seccion('Información del inmueble')
  fila([['Proyecto', i.proyecto], ['Edificio / torre', i.edificio], ['Departamento', i.departamento]])
  fila([['Tipología / dormitorios', i.tipologia], ['Área', m2(i.areaM2)], ['Bodega / patio (si aplica)', [i.bodegaM2 > 0 ? `Bodega ${m2(i.bodegaM2)}` : null, i.patioM2 > 0 ? `Patio ${m2(i.patioM2)}` : null, i.parqueo ? `Parqueo ${i.parqueo}` : null].filter(Boolean).join(' · ') || 'No aplica']])

  seccion('Precio y condiciones de financiamiento')
  fila([['Precio de lista', usd(f.precioLista)], ['Descuento', `${usd(f.descuentoUsd)} (${pct(f.descuentoPct)})`], ['Precio final', usd(f.precioFinal)]])
  fila([['Reserva (incluida en el pago a la firma)', usd(f.reserva)], [`Entrada total ${pct(f.reservaPct + f.cuotasPct)} (${pct(f.reservaPct)} firma + ${pct(f.cuotasPct)} cuotas)`, usd(f.reserva + f.cuotasTotal)], [`Saldo a financiar mediante crédito hipotecario (${pct(f.entregaPct)})`, `${usd(f.contraEntrega)} · sujeto a aprobación de la entidad financiera`]])
  fila([['Pago a la firma', `${usd(f.reserva)} · ${pct(f.reservaPct)}`], ['Cuotas de entrada', `${f.meses} de ${usd(f.cuotaMensual)}; última ${usd(f.ultimaCuota)}`], ['Plazo / inicio de cuotas', `${f.meses} meses · desde ${fecha(f.primeraCuota)}${f.diaPago ? ` · pago el ${f.diaPago}` : ''}`]])

  seccion('Observaciones y validaciones')
  const obs = d.observaciones.trim() ? d.observaciones.trim() : 'Sin observaciones registradas.'
  const lineasObs = envolver(obs, sans, 8.8, W - 2 * M - 16, 3)
  pag.drawRectangle({ x: M, y: y - 14 - lineasObs.length * 11 - 8, width: W - 2 * M, height: lineasObs.length * 11 + 22, color: FONDO })
  lineasObs.forEach((l, k) => pag.drawText(l, { x: M + 8, y: y - 10 - k * 11, size: 8.8, font: sans, color: INK }))
  y -= 14 + lineasObs.length * 11 + 12
  const avisos = [
    'Documento preparatorio. No sustituye promesa de compraventa ni aprobación de crédito.',
    'Revisar condiciones, identidad y autorización antes de emitir el contrato.',
  ]
  avisos.forEach((a, k) => pag.drawText(a, { x: M + 8, y: y - k * 11, size: 8, font: sans, color: GRIS }))
  y -= 11 * avisos.length + 6

  pag.drawText('AMURA Apartments · Empresa contratante: verificar en documentación legal.', { x: M, y: 26, size: 7.5, font: sans, color: GRIS })

  if (y < 40) throw new Error('La orden de contrato no cabe en una página. Revisa el contenido de observaciones.')
  doc.setSubject(`Departamento ${d.inmueble.departamento}`)
  return doc.save()
}

/** Nombre de descarga: AMURA_Orden_<Cliente>_<Departamento>_<fecha>.pdf */
export function nombreOrden(cliente: string, departamento: string, fechaIso: string) {
  const limpio = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return `AMURA_Orden_${limpio(cliente) || 'Cliente'}_${limpio(departamento)}_${fechaIso}.pdf`
}

/** Parte un texto en líneas que caben en `ancho`, con como máximo `maxLineas`. El sobrante se corta con «…». */
function envolver(texto: string, font: PDFFont, size: number, ancho: number, maxLineas: number): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const lineas: string[] = []
  let actual = ''
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p
    if (font.widthOfTextAtSize(prueba, size) <= ancho) { actual = prueba; continue }
    if (actual) lineas.push(actual)
    actual = p
    if (lineas.length === maxLineas) break
  }
  if (lineas.length < maxLineas && actual) lineas.push(actual)
  if (lineas.length === maxLineas && palabras.join(' ') !== lineas.join(' ')) {
    let ultima = lineas[maxLineas - 1]
    while (ultima.length > 1 && font.widthOfTextAtSize(`${ultima}…`, size) > ancho) ultima = ultima.slice(0, -1)
    lineas[maxLineas - 1] = `${ultima}…`
  }
  return lineas.length ? lineas : ['']
}
