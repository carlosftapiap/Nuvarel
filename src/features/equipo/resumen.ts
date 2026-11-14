import type { Datos } from '@/features/conexion/datos'
import type { EtapaOportunidad } from '@/features/clientes/model'

/**
 * Gestión del equipo comercial. Lee con las mismas reglas de acceso de la base: un Supervisor solo recibe
 * a los vendedores de sus equipos y lo que ellos atienden; los demás registros no llegan a la app.
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export type Periodo = 'mes' | 'todo'
// El Supervisor también vende: para Gerencia aparece con sus ventas propias junto a los vendedores.
export const ROLES_COMERCIALES = ['asesor', 'corredor', 'supervisor']

export interface Vendedor { id: string; nombre: string; rol: string; equipo: string | null }
export interface DatosEquipo {
  /** Quien mira, con sus ventas propias aparte; vendedores no lo incluye, así nada se cuenta dos veces. */
  yo: string; propio: Vendedor; vendedores: Vendedor[]
  clientes: Fila[]; cotizaciones: Fila[]; reservas: Fila[]; contratos: Fila[]; oportunidades: Fila[]; actividades: Fila[]
}
export interface Indicadores {
  clientes: number; nuevos: number; cotizaciones: number; reservasSolicitadas: number; reservasAprobadas: number; reservasRechazadas: number
  ventas: number; montoVendido: number; actividades: number; seguimientosVencidos: number; oportunidadesAbiertas: number
}

export async function cargarEquipo(d: Datos, yo: string): Promise<DatosEquipo> {
  const opcional = (t: string) => d.select<Fila>(t).catch(() => [] as Fila[])
  const [perfiles, equipos, clientes, cotizaciones, reservas, contratos, oportunidades, actividades] = await Promise.all([
    d.select<Fila>('profiles', { orden: [{ columna: 'nombre' }] }), opcional('teams'),
    opcional('clients'), opcional('quotes'), opcional('reservations'), opcional('contracts'), opcional('opportunities'), opcional('client_activities'),
  ])
  const equipo = new Map(equipos.map((e) => [String(e.id), String(e.nombre)]))
  const vendedor = (p: Fila): Vendedor => ({ id: String(p.id), nombre: String(p.nombre), rol: String(p.rol_id), equipo: p.equipo_id ? (equipo.get(String(p.equipo_id)) ?? null) : null })
  const vendedores = perfiles
    .filter((p) => p.id !== yo && p.estado === 'activo' && ROLES_COMERCIALES.includes(String(p.rol_id)))
    .map(vendedor)
  const mio = perfiles.find((p) => p.id === yo)
  const propio = mio ? vendedor(mio) : { id: yo, nombre: 'Yo', rol: '', equipo: null }
  return { yo, propio, vendedores, clientes, cotizaciones, reservas, contratos, oportunidades, actividades }
}

const mesActual = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }).slice(0, 7)
const enPeriodo = (v: unknown, p: Periodo) => p === 'todo' || (!!v && String(v).slice(0, 7) === mesActual())

/**
 * Cotizaciones y reservas cuentan para el vendedor dueño del cliente, aunque las haya registrado otra persona
 * (Gerencia o el administrador). Así coinciden con la etapa de sus oportunidades.
 */
const dueno = (d: DatosEquipo, f: Fila) => d.clientes.find((c) => c.id === f.client_id)?.asesor_id ?? f.created_by
export const cotizacionesDe = (d: DatosEquipo, vendedor: string) => d.cotizaciones.filter((q) => dueno(d, q) === vendedor)
export const reservasDe = (d: DatosEquipo, vendedor: string) => d.reservas.filter((r) => dueno(d, r) === vendedor)

export const RESERVA_APROBADA = ['confirmada']
export const RESERVA_RECHAZADA = ['rechazada', 'anulada']

export function indicadores(d: DatosEquipo, vendedor: string, p: Periodo): Indicadores {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' })
  const clientes = d.clientes.filter((c) => c.asesor_id === vendedor)
  const reservas = reservasDe(d, vendedor).filter((r) => enPeriodo(r.created_at, p))
  const ventas = d.contratos.filter((k) => k.asesor_id === vendedor && k.estado === 'firmado' && enPeriodo(k.firmado_en ?? k.fecha_contrato, p))
  return {
    clientes: clientes.length,
    nuevos: d.clientes.filter((c) => c.created_by === vendedor && enPeriodo(c.created_at, p)).length,
    cotizaciones: cotizacionesDe(d, vendedor).filter((q) => enPeriodo(q.fecha ?? q.created_at, p)).length,
    reservasSolicitadas: reservas.length,
    reservasAprobadas: reservas.filter((r) => RESERVA_APROBADA.includes(String(r.estado))).length,
    reservasRechazadas: reservas.filter((r) => RESERVA_RECHAZADA.includes(String(r.estado))).length,
    ventas: ventas.length,
    montoVendido: ventas.reduce((t, k) => t + Number(k.precio ?? 0), 0),
    actividades: d.actividades.filter((a) => a.user_id === vendedor && enPeriodo(a.fecha, p)).length,
    seguimientosVencidos: clientes.filter((c) => c.proxima_fecha && String(c.proxima_fecha).slice(0, 10) < hoy && !['perdido', 'reserva'].includes(String(c.etapa))).length,
    oportunidadesAbiertas: d.oportunidades.filter((o) => o.responsable_id === vendedor && o.etapa !== 'perdida').length,
  }
}

export function totales(filas: Indicadores[]): Indicadores {
  const t = { clientes: 0, nuevos: 0, cotizaciones: 0, reservasSolicitadas: 0, reservasAprobadas: 0, reservasRechazadas: 0, ventas: 0, montoVendido: 0, actividades: 0, seguimientosVencidos: 0, oportunidadesAbiertas: 0 }
  for (const f of filas) for (const k of Object.keys(t) as (keyof Indicadores)[]) t[k] += f[k]
  return t
}

export function oportunidadesPorEtapa(d: DatosEquipo, vendedor: string) {
  const m = new Map<EtapaOportunidad, number>()
  for (const o of d.oportunidades) if (o.responsable_id === vendedor) m.set(o.etapa as EtapaOportunidad, (m.get(o.etapa as EtapaOportunidad) ?? 0) + 1)
  return m
}

/** Nombre del cliente si la persona puede verlo. */
export const nombreCliente = (d: DatosEquipo, id: unknown) => s(d.clientes.find((c) => c.id === id)?.nombre) ?? 'Cliente'
