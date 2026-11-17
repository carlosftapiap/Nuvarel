import type { Datos } from '@/features/conexion/datos'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { ESTADOS_CIVILES, type EstadoCivil } from '@/features/contratos/model'
import { ORIGENES, type Origen } from '@/features/clientes/model'
import { construirOrdenContrato, datosOrden, nombreOrden, type DatosClienteOrden } from './ordenContrato'

/** Campos de Clientes que usa la orden de contrato. */
export interface CamposClienteOrden {
  domicilio: string | null
  estado_civil: string | null
  origen: string | null
  representante_nombre: string | null
  representante_documento: string | null
  representante_calidad: string | null
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Pasa la fila de Clientes a etiquetas para el documento. Lo que no consta queda null («No registrado» en el PDF). */
export function aDatosCliente(f: Partial<Record<keyof CamposClienteOrden, unknown>> | undefined): DatosClienteOrden {
  const civil = texto(f?.estado_civil) as EstadoCivil | null
  const origen = texto(f?.origen) as Origen | null
  const repNombre = texto(f?.representante_nombre)
  return {
    domicilio: texto(f?.domicilio),
    estadoCivil: civil && civil in ESTADOS_CIVILES ? ESTADOS_CIVILES[civil] : null,
    medioCaptacion: origen && origen in ORIGENES ? ORIGENES[origen] : null,
    representante: repNombre ? { nombre: repNombre, documento: texto(f?.representante_documento), calidad: texto(f?.representante_calidad) } : null,
  }
}

/** Campos crudos de Clientes (claves de la base) para editar y para la orden. */
export async function cargarCamposCliente(d: Datos, clienteId: string | undefined): Promise<CamposClienteOrden | undefined> {
  if (!clienteId) return undefined
  const [fila] = await d.select<Record<string, unknown>>('clients', { filtros: { id: clienteId } })
  return fila as unknown as CamposClienteOrden | undefined
}

export async function cargarDatosCliente(d: Datos, clienteId: string | undefined): Promise<DatosClienteOrden> {
  return aDatosCliente(await cargarCamposCliente(d, clienteId))
}

/** Solo para vista previa: no registra nada en el historial. */
export async function construirVistaPrevia(d: Datos, c: Cotizacion, tipo: TipoPersona, fechaEmision = hoyIso()): Promise<Uint8Array> {
  const cliente = await cargarDatosCliente(d, c.clienteId)
  return construirOrdenContrato(datosOrden(c, tipo, fechaEmision, cliente))
}

/** Guarda en Clientes los datos que faltan para la orden. Solo cambia esos campos. */
export async function guardarDatosCliente(d: Datos, clienteId: string, cambios: Partial<CamposClienteOrden>) {
  await d.update('clients', cambios as Record<string, unknown>, { id: clienteId })
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface OrdenEmitida {
  bytes: Uint8Array
  nombre: string
  id: string
  version: number
  emitidaEn: string
  emitidaPor: string | null
}

export const hoyIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Genera la orden y la registra en el historial. Orden de operaciones:
 * 1) valida y genera el PDF (si faltan datos, no se registra nada);
 * 2) registra la versión con su huella SHA-256 (si falla, no se entrega el PDF);
 * 3) devuelve el PDF con su versión. Ver o descargar solo ocurre después.
 */
export async function emitirOrden(d: Datos, c: Cotizacion, tipo: TipoPersona, emisorNombre: string, fechaEmision = hoyIso()): Promise<OrdenEmitida> {
  if (!c.id) throw new Error('La cotización aún no está guardada. Emítela antes de generar la orden.')
  const cliente = await cargarDatosCliente(d, c.clienteId)
  const datos = datosOrden(c, tipo, fechaEmision, cliente)
  const bytes = await construirOrdenContrato(datos)
  const sha256 = await sha256Hex(bytes)
  const r = await d.rpc<{ id: string; version: number; emitidaEn: string; emitidaPor: string | null }>('ordenes_contrato_registrar', {
    p_quote_id: c.id,
    p_datos: datos,
    p_sha256: sha256,
    p_emitida_por_nombre: emisorNombre,
  })
  return { bytes, nombre: nombreOrden(c.cliente.nombre, c.unidad.dpt, fechaEmision), id: r.id, version: r.version, emitidaEn: r.emitidaEn, emitidaPor: r.emitidaPor }
}

/** Historial de órdenes emitidas de una cotización, de la más reciente a la primera. */
export async function listarOrdenes(d: Datos, quoteId: string) {
  return d.select<{ id: string; version: number; emitida_en: string; emitida_por_nombre: string | null; pdf_sha256: string }>('ordenes_contrato', {
    filtros: { quote_id: quoteId },
    orden: [{ columna: 'version', asc: false }],
  })
}
