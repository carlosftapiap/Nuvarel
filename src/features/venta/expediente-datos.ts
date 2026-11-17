import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { almacenContratosSupabase, nombreSeguro, type AlmacenContratos } from '@/features/contratos/almacen'
import { edificioDocumento } from '@/features/inventario/nomenclatura'
import { construirCaratula, construirExpediente, MAESTROS, nombreExpediente, validarMaestro, type DatosCaratula, type TipoMaestro } from './expediente'
import { ESPECIFICACIONES_APROBADAS } from './ficha'

/** Bucket privado de los formularios oficiales (migración 0019). */
export const BUCKET_MAESTROS = 'maestros-amura'
const rutaMaestro = (clave: TipoMaestro) => `${clave}/${nombreSeguro(MAESTROS[clave].nombre)}`
export const ETIQUETA_MAESTRO: Record<TipoMaestro, string> = {
  natural: 'Formularios de persona natural (AMURA-01)',
  juridica: 'Formularios de persona jurídica (AMURA-02)',
  ficha: 'Especificaciones técnicas (AMURA-03)',
}
const ESTADO_COTIZACION: Record<NonNullable<Cotizacion['estado']>, string> = {
  emitida: 'Cotización emitida',
  aceptada: 'Cotización aceptada',
  reemplazada: 'Cotización reemplazada',
  anulada: 'Cotización anulada',
}

/** Datos de la carátula tomados de la cotización registrada. Lo que no consta queda vacío y se muestra como «No registrado». */
export function datosCaratula(c: Cotizacion, tipo: TipoPersona): DatosCaratula {
  const p = c.plan
  return {
    cliente: {
      nombre: c.cliente.nombre,
      tipo,
      documento: c.cliente.documento ?? null,
      representante: null,
      telefono: c.cliente.telefono || null,
      email: c.cliente.email || null,
    },
    inmueble: {
      proyecto: 'AMURA',
      edificio: edificioDocumento(c.unidad),
      piso: c.unidad.piso === 'PB' ? 'Planta baja' : `Piso ${c.unidad.piso}`,
      departamento: c.unidad.dpt,
      areaM2: c.unidad.areaM2,
      bodegaM2: c.unidad.bodegaM2 ?? 0,
      patioM2: c.unidad.patioM2 ?? 0,
      parqueo: c.unidad.parqueo ?? null,
    },
    comercial: {
      documento: c.numero,
      fecha: c.fecha,
      estado: c.estado ? ESTADO_COTIZACION[c.estado] : 'Cotización sin emitir',
      precioAcordado: p.precioFinal,
      reservaPct: p.reservaPct,
      cuotasPct: p.cuotasPct,
      cuotas: p.meses,
      cuotaMensual: p.cuotaMensual,
      ultimaCuota: p.ultimaCuota,
      primeraCuota: p.vencimientos?.[0] ?? null,
      ultimaFecha: p.ultimaFecha ?? null,
      diaPago: p.diaPago ? (p.diaPago === 'ultimo' ? 'Último día del mes' : `Día ${p.diaPago}`) : null,
      entregaPct: p.entregaPct,
      contraEntrega: p.contraEntrega,
      asesor: c.asesor.nombre,
    },
  }
}

/** Lee un maestro del bucket. Devuelve null si no está cargado; lanza error si el archivo no es el correcto. */
export async function leerMaestro(clave: TipoMaestro, almacen: AlmacenContratos = almacenContratosSupabase): Promise<Uint8Array | null> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await almacen.descargar(BUCKET_MAESTROS, rutaMaestro(clave)))
  } catch {
    return null
  }
  return validarMaestro(clave, bytes)
}

/** Maestros que faltan en el almacenamiento (la ficha solo se pide cuando está aprobada). */
export async function maestrosFaltantes(almacen: AlmacenContratos = almacenContratosSupabase): Promise<TipoMaestro[]> {
  const claves: TipoMaestro[] = ESPECIFICACIONES_APROBADAS ? ['natural', 'juridica', 'ficha'] : ['natural', 'juridica']
  const faltan: TipoMaestro[] = []
  for (const clave of claves) if ((await leerMaestro(clave, almacen).catch(() => null)) === null) faltan.push(clave)
  return faltan
}

/** Carga o reemplaza un maestro. Valida el número de páginas antes de guardarlo. */
export async function subirMaestro(clave: TipoMaestro, archivo: File, almacen: AlmacenContratos = almacenContratosSupabase) {
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  await validarMaestro(clave, bytes)
  if (almacen.quitar) await almacen.quitar(BUCKET_MAESTROS, rutaMaestro(clave)).catch(() => undefined)
  await almacen.subir(BUCKET_MAESTROS, rutaMaestro(clave), new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'application/pdf')
}

/** Expediente completo de la operación: carátula + formulario del tipo elegido (+ ficha solo si está aprobada). */
export async function construirExpedienteCotizacion(c: Cotizacion, tipo: TipoPersona, almacen: AlmacenContratos = almacenContratosSupabase) {
  const clave: TipoMaestro = tipo === 'juridica' ? 'juridica' : 'natural'
  const claves: TipoMaestro[] = ESPECIFICACIONES_APROBADAS ? [clave, 'ficha'] : [clave]
  const cargados: Partial<Record<TipoMaestro, Uint8Array>> = {}
  const faltan: string[] = []
  for (const k of claves) {
    const bytes = await leerMaestro(k, almacen)
    if (bytes) cargados[k] = bytes
    else faltan.push(ETIQUETA_MAESTRO[k])
  }
  if (faltan.length) throw new Error(`Expediente pendiente: falta cargar ${faltan.join(' y ')}. Un administrador lo sube desde Cotizaciones > Documentos.`)
  const caratula = await construirCaratula(datosCaratula(c, tipo))
  const { bytes, paginas } = await construirExpediente(caratula, cargados[clave]!, cargados.ficha)
  return { bytes, paginas, nombre: nombreExpediente(c.cliente.nombre, c.unidad.dpt, c.fecha) }
}

/** Abre el expediente en otra pestaña (vista previa del navegador, con su propio botón de impresión). */

/** Descarga el expediente con el nombre AMURA_Expediente_<Cliente>_<Departamento>_<fecha>.pdf. */
export async function descargarExpedienteCotizacion(c: Cotizacion, tipo: TipoPersona) {
  const { bytes, paginas, nombre } = await construirExpedienteCotizacion(c, tipo)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { paginas, nombre }
}
