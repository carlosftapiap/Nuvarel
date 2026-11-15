import type { Datos } from '@/features/conexion/datos'
import { armarCronograma, type CuotaExtraordinaria, type PlanFinanciamiento } from '@/features/financiamiento/plan'
import type { Unit } from '@/features/inventario/types'
import type { Cotizacion, DatosPersona } from './cotizacion'

/**
 * Cotizaciones desde Supabase. El precio y las condiciones los calcula la base de datos (cotizaciones_emitir);
 * cada cotización pertenece a una negociación del cliente. Lectura con RLS.
 */
type Fila = Record<string, unknown>
const diasEntre = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000)

/** El servidor guarda las condiciones; el cronograma del PDF se arma con ellas, sin recalcular precios. */
const planDesdeServidor = (p: Omit<PlanFinanciamiento, 'cronograma'>, fecha: string): PlanFinanciamiento => ({ ...p, cronograma: armarCronograma(p, fecha) })

export function aCotizacion(q: Fila, units: Unit[]): Cotizacion | null {
  const snapshot = q.unidad_snapshot as Cotizacion['unidad'] | null | undefined
  const u = snapshot ?? units.find((x) => x.codigo === q.codigo)
  if (!u) return null
  const fechaIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10)
  const fecha = fechaIso(q.fecha)
  const validaHasta = fechaIso(q.valida_hasta)
  return {
    id: String(q.id), numero: String(q.numero), fecha, validaHasta, vigenciaDias: diasEntre(fecha, validaHasta),
    unidad: { codigo: u.codigo, dpt: u.dpt, edificio: u.edificio, edificioNombre: snapshot?.edificioNombre, piso: u.piso, ubicacion: u.ubicacion, tipologia: u.tipologia, areaM2: u.areaM2, bodegaCodigo: u.bodegaCodigo, bodegaM2: u.bodegaM2, patioM2: u.patioM2, parqueo: u.parqueo, usdM2: u.usdM2, estado: u.estado },
    documentoDisponible: !!snapshot,
    plan: planDesdeServidor(q.plan as Omit<PlanFinanciamiento, 'cronograma'>, fecha),
    cliente: q.cliente as DatosPersona, asesor: q.asesor as DatosPersona, observaciones: String(q.observaciones ?? ''),
    clienteId: q.client_id ? String(q.client_id) : undefined,
    creadaPor: { id: String(q.created_by), nombre: (q.asesor as DatosPersona).nombre, rol: '' },
    creadaEn: String(q.created_at), estado: q.estado as Cotizacion['estado'], version: Number(q.version ?? 1),
  }
}

export async function cargarCotizaciones(datos: Datos, units: Unit[]): Promise<Cotizacion[]> {
  const filas = await datos.select<Fila>('quotes', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] })
  return filas.map((q) => aCotizacion(q, units)).filter((c): c is Cotizacion => !!c)
}

export interface EmitirInput {
  clienteId: string
  codigo: string
  descuentoPct: number
  vigenciaDias: number
  observaciones: string
  extraordinarias?: CuotaExtraordinaria[]
}

/** Usa la negociación abierta del cliente por esa unidad, o la abre: nunca la duplica. */
export async function emitirCotizacion(datos: Datos, input: EmitirInput, units: Unit[]): Promise<Cotizacion> {
  const oportunidad = await datos.rpc<string>('oportunidades_crear', { p_client: input.clienteId, p_unidad: input.codigo, p_tipologia: null })
  const condiciones = { p_opportunity: oportunidad, p_descuento_pct: input.descuentoPct, p_vigencia_dias: input.vigenciaDias, p_observaciones: input.observaciones }
  const id = input.extraordinarias?.length
    ? await datos.rpc<string>('cotizaciones_emitir_extraordinarias', { ...condiciones, p_extraordinarias: input.extraordinarias })
    : await datos.rpc<string>('cotizaciones_emitir', condiciones)
  const [fila] = await datos.select<Fila>('quotes', { filtros: { id } })
  const c = fila ? aCotizacion(fila, units) : null
  if (!c) throw new Error('La cotización se emitió, pero no se pudo leer. Recarga la página.')
  return c
}
