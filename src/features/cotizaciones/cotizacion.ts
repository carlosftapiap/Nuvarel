import { assertCan, can } from '@/app/permissions'
import { generarPlan, type CuotaExtraordinaria, type PlanFinanciamiento } from '@/features/financiamiento/plan'
import { ESTADOS } from '@/features/inventario/estados'
import type { Actor, EstadoComercial, InventoryState, Unit } from '@/features/inventario/types'
import { nombreEdificio } from '@/features/inventario/nomenclatura'

/** Solo se cotizan unidades sin compromiso con otro cliente. */
export const ESTADOS_COTIZABLES: EstadoComercial[] = ['disponible']

export interface DatosPersona {
  nombre: string
  documento?: string
  email: string
  telefono: string
}

export interface CotizacionInput {
  codigo: string
  cliente: DatosPersona
  asesor: DatosPersona
  descuentoPct: number
  vigenciaDias: number
  fecha: string
  observaciones: string
  /** Cliente registrado al que se vincula la cotización. */
  clienteId?: string
  extraordinarias?: CuotaExtraordinaria[]
}

export interface Cotizacion {
  id: string
  numero: string
  fecha: string
  validaHasta: string
  vigenciaDias: number
  unidad: Pick<Unit, 'codigo' | 'dpt' | 'edificio' | 'piso' | 'ubicacion' | 'tipologia' | 'areaM2' | 'bodegaCodigo' | 'bodegaM2' | 'patioM2' | 'parqueo' | 'usdM2' | 'estado'> & { edificioNombre?: string }
  /** false: registro remoto anterior a las instantáneas. No reconstruir su documento desde Inventario. */
  documentoDisponible?: boolean
  plan: PlanFinanciamiento
  cliente: DatosPersona
  asesor: DatosPersona
  observaciones: string
  clienteId?: string
  creadaPor: Actor
  creadaEn: string
  /** Con Supabase: estado en la base de datos. */
  estado?: 'emitida' | 'aceptada' | 'reemplazada' | 'anulada'
  version?: number
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function validarCotizacion(input: CotizacionInput, unit: Unit | undefined, actor: Actor): string[] {
  const e: string[] = []
  if (!unit) return ['Selecciona un departamento.']
  if (!ESTADOS_COTIZABLES.includes(unit.estado)) e.push(`La unidad ${unit.dpt} está ${ESTADOS[unit.estado].label.toLowerCase()} y no puede cotizarse.`)
  if (unit.solicitud) e.push(`La unidad ${unit.dpt} está en proceso de reserva (${unit.solicitud.codigo}).`)
  if (input.cliente.nombre.trim().length < 3) e.push('Ingresa el nombre del cliente.')
  if (input.cliente.email.trim() && !EMAIL.test(input.cliente.email.trim())) e.push('El correo del cliente no es válido.')
  if (input.asesor.nombre.trim().length < 3) e.push('Ingresa el nombre del asesor.')
  if (!input.asesor.email.trim() && !input.asesor.telefono.trim()) e.push('Ingresa el correo o teléfono del asesor.')
  if (input.asesor.email.trim() && !EMAIL.test(input.asesor.email.trim())) e.push('El correo del asesor no es válido.')
  if (!Number.isInteger(input.vigenciaDias) || input.vigenciaDias < 1 || input.vigenciaDias > 90) e.push('La vigencia debe ser de 1 a 90 días.')
  if (input.descuentoPct > 0 && !canDescuento(actor)) e.push('Tu rol no puede aplicar descuentos; solicítalo a gerencia.')
  if (input.observaciones.length > 600) e.push('Las observaciones superan 600 caracteres.')
  return e
}

const canDescuento = (actor: Actor) => can(actor, 'cotizaciones.descuento')

export function siguienteNumero(existentes: Cotizacion[], fecha: string) {
  const anio = fecha.slice(0, 4)
  const prefijo = `COT-${anio}-`
  const max = existentes.filter((c) => c.numero.startsWith(prefijo)).reduce((m, c) => Math.max(m, Number(c.numero.slice(prefijo.length)) || 0), 0)
  return `${prefijo}${String(max + 1).padStart(4, '0')}`
}

export function crearCotizacion(state: InventoryState, input: CotizacionInput, actor: Actor, existentes: Cotizacion[]): Cotizacion {
  assertCan(actor, 'cotizaciones.crear')
  if (input.descuentoPct > 0) assertCan(actor, 'cotizaciones.descuento')
  const unit = state.units.find((u) => u.codigo === input.codigo)
  const errores = validarCotizacion(input, unit, actor)
  if (errores.length) throw new Error(errores.join(' '))
  const u = unit!
  const plan = generarPlan(u, state.params, { descuentoPct: input.descuentoPct, fechaReserva: input.fecha, extraordinarias: input.extraordinarias })
  const limpio = (p: DatosPersona): DatosPersona => ({ nombre: p.nombre.trim(), documento: p.documento?.trim() || undefined, email: p.email.trim(), telefono: p.telefono.trim() })
  return {
    id: `cot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    numero: siguienteNumero(existentes, input.fecha),
    fecha: input.fecha,
    vigenciaDias: input.vigenciaDias,
    validaHasta: sumarDias(input.fecha, input.vigenciaDias),
    unidad: {
      codigo: u.codigo, dpt: u.dpt, edificio: u.edificio, edificioNombre: nombreEdificio(u.edificio), piso: u.piso, ubicacion: u.ubicacion, tipologia: u.tipologia,
      areaM2: u.areaM2, bodegaCodigo: u.bodegaCodigo, bodegaM2: u.bodegaM2, patioM2: u.patioM2, parqueo: u.parqueo, usdM2: u.usdM2, estado: u.estado,
    },
    plan,
    cliente: limpio(input.cliente),
    asesor: limpio(input.asesor),
    observaciones: input.observaciones.trim(),
    clienteId: input.clienteId,
    creadaPor: actor,
    creadaEn: new Date().toISOString(),
  }
}

export function sumarDias(iso: string, dias: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + dias))
  return t.toISOString().slice(0, 10)
}
