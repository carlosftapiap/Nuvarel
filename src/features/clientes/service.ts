import { assertCan, can, puedeVerDe } from '@/app/permissions'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor, InventoryState } from '@/features/inventario/types'
import { ETAPAS, ETAPAS_EMBUDO, TIPOS_ACTIVIDAD, type Actividad, type Cliente, type ClientesState, type Etapa, type FormaPago, type Origen, type ProximaActividad, type Proposito, type TipoActividad } from './model'

export class ClienteError extends Error {
  constructor(m: string) { super(m); this.name = 'ClienteError' }
}

/** Identificador generado en el navegador; también funciona fuera de https, donde no existe crypto.randomUUID. */
function newId() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const nowIso = () => new Date().toISOString()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export const estadoInicialClientes = (): ClientesState => ({ version: 1, clientes: [] })

/* ------------------------------------------------------------- visibilidad */

/** Cada usuario ve los clientes de su alcance (propio, equipo o empresa), comparando identificadores. */
export function clientesVisibles(clientes: Cliente[], actor: Actor) {
  if (!can(actor, 'clientes.ver')) return []
  // Registrar a un cliente no da acceso permanente: lo tiene su asesor actual. Con Supabase, la base ya filtró (también negociaciones y accesos autorizados).
  return clientes.filter((c) => c.deLaBase || puedeVerDe(actor, [c.asesorId]))
}

function buscar(state: ClientesState, id: string, actor: Actor) {
  const c = state.clientes.find((x) => x.id === id)
  if (!c || !clientesVisibles([c], actor).length) throw new ClienteError('El cliente no existe o no tienes acceso.')
  return c
}

function reemplazar(state: ClientesState, c: Cliente): ClientesState {
  return { ...state, clientes: state.clientes.map((x) => (x.id === c.id ? { ...c, actualizadoEn: nowIso() } : x)) }
}

function actividad(tipo: TipoActividad, descripcion: string, actor: Actor, fecha = hoyGuayaquil()): Actividad {
  return { id: newId(), tipo, fecha, descripcion, usuario: actor.nombre, registradaEn: nowIso() }
}

/** Registro que también escribe el servidor al ejecutar la acción. */
const automatica = (tipo: TipoActividad, descripcion: string, actor: Actor, extra: Partial<Actividad> = {}): Actividad => ({ ...actividad(tipo, descripcion, actor), automatica: true, ...extra })

/* ------------------------------------------------------------------- datos */

export interface ClienteInput {
  nombre: string
  telefono: string
  email: string
  origen: Origen
  origenDetalle: string
  unidadesInteres: string[]
  presupuesto: number | null
  proposito: Proposito | null
  formaPago: FormaPago | null
  /** Responsable: identificador de usuario y nombre mostrado. */
  asesorId: string
  asesor: string
  /** Obligatorio al cambiar de asesor a un cliente existente. */
  motivoAsignacion?: string
  /** Al reasignar: el asesor anterior conserva acceso por autorización expresa. */
  mantenerAcceso?: boolean
  documento?: string
  corredorOrigenId?: string | null
}

export function validarCliente(input: ClienteInput, inventario?: InventoryState): string[] {
  const e: string[] = []
  if (input.nombre.trim().length < 3) e.push('Ingresa el nombre del cliente.')
  if (!input.telefono.trim() && !input.email.trim()) e.push('Ingresa al menos un teléfono o un correo.')
  if (input.telefono.trim() && !/^[+\d][\d\s-]{6,19}$/.test(input.telefono.trim())) e.push('El teléfono no es válido.')
  if (input.email.trim() && !EMAIL.test(input.email.trim())) e.push('El correo no es válido.')
  if ((input.origen === 'referido' || input.origen === 'corredor') && !input.origenDetalle.trim()) {
    e.push(input.origen === 'referido' ? 'Indica quién lo refirió.' : 'Indica el corredor que lo trajo.')
  }
  if (input.presupuesto !== null && (!Number.isFinite(input.presupuesto) || input.presupuesto <= 0)) e.push('El presupuesto debe ser un valor positivo.')
  if (!input.asesorId || !input.asesor.trim()) e.push('Asigna un asesor responsable.')
  if (inventario) {
    const desconocidas = input.unidadesInteres.filter((c) => !inventario.units.some((u) => u.codigo === c))
    if (desconocidas.length) e.push(`Unidades inexistentes: ${desconocidas.join(', ')}.`)
  }
  return e
}

/** Normaliza el teléfono para detectar duplicados (solo dígitos, últimos 9). */
const telKey = (t: string) => t.replace(/\D/g, '').slice(-9)

export function buscarDuplicado(state: ClientesState, input: Pick<ClienteInput, 'telefono' | 'email'>, excluirId?: string) {
  return state.clientes.find((c) => c.id !== excluirId && (
    (input.telefono.trim() && telKey(c.telefono) && telKey(c.telefono) === telKey(input.telefono)) ||
    (input.email.trim() && c.email.toLowerCase() === input.email.trim().toLowerCase())
  ))
}

/** Asignar a otra persona exige permiso y que el destino esté dentro del alcance del actor. */
function verificarAsignacion(asesorId: string, actor: Actor) {
  if (asesorId === actor.id) return
  if (!can(actor, 'clientes.asignar')) throw new ClienteError('No tienes permiso para asignar clientes a otro asesor.')
  if (!puedeVerDe(actor, [asesorId])) throw new ClienteError('Solo puedes asignar clientes a personas de tu equipo.')
}

/** El aviso de duplicado no revela datos de clientes fuera del alcance del actor. */
function avisarDuplicado(state: ClientesState, input: Pick<ClienteInput, 'telefono' | 'email'>, actor: Actor, excluirId?: string) {
  const dup = buscarDuplicado(state, input, excluirId)
  if (!dup) return
  if (clientesVisibles([dup], actor).length) throw new ClienteError(`Ya existe un cliente con ese teléfono o correo: ${dup.nombre} (asesor ${dup.asesor}).`)
  throw new ClienteError('Ese teléfono o correo ya está registrado por otro equipo. Solicita a tu supervisor o a gerencia que revise el caso.')
}

function limpiar(input: ClienteInput) {
  return {
    nombre: input.nombre.trim(), documento: input.documento?.trim() ?? '', corredorOrigenId: input.corredorOrigenId ?? null, telefono: input.telefono.trim(), email: input.email.trim().toLowerCase(),
    origen: input.origen, origenDetalle: input.origenDetalle.trim(), unidadesInteres: [...new Set(input.unidadesInteres)],
    presupuesto: input.presupuesto, proposito: input.proposito, formaPago: input.formaPago, asesorId: input.asesorId, asesor: input.asesor.trim(),
  }
}

export function crearCliente(state: ClientesState, input: ClienteInput, actor: Actor, inventario?: InventoryState): { state: ClientesState; cliente: Cliente } {
  assertCan(actor, 'clientes.editar')
  verificarAsignacion(input.asesorId, actor)
  const errores = validarCliente(input, inventario)
  if (errores.length) throw new ClienteError(errores.join(' '))
  avisarDuplicado(state, input, actor)
  const ahora = nowIso()
  const cliente: Cliente = {
    id: newId(), ...limpiar(input), etapa: 'nuevo', motivoPerdida: '', fechaRetomar: null, proxima: null,
    atribucion: { usuarioId: actor.id, nombre: actor.nombre, fecha: hoyGuayaquil() },
    actividades: [automatica('nota', `Cliente registrado · origen ${input.origen}`, actor)], cotizaciones: [],
    creadoPor: { id: actor.id, nombre: actor.nombre, rol: actor.rol }, creadoEn: ahora, actualizadoEn: ahora,
  }
  return { state: { ...state, clientes: [cliente, ...state.clientes] }, cliente }
}

export function actualizarCliente(state: ClientesState, id: string, input: ClienteInput, actor: Actor, inventario?: InventoryState): ClientesState {
  assertCan(actor, 'clientes.editar')
  const c = buscar(state, id, actor)
  const reasigna = input.asesorId !== c.asesorId
  if (reasigna) {
    verificarAsignacion(input.asesorId, actor)
    if ((input.motivoAsignacion ?? '').trim().length < 5) throw new ClienteError('Indica el motivo de la reasignación.')
  }
  const errores = validarCliente(input, inventario)
  if (errores.length) throw new ClienteError(errores.join(' '))
  avisarDuplicado(state, input, actor, id)
  const cambios: Actividad[] = []
  // La atribución de origen se conserva; solo cambia el responsable actual y queda en el historial.
  if (reasigna) {
    const motivo = input.motivoAsignacion!.trim()
    cambios.push(automatica('nota', `Asesor reasignado: ${c.asesor} → ${input.asesor.trim()} · motivo: ${motivo}`, actor, { motivo, mantenerAcceso: !!input.mantenerAcceso }))
  }
  const unidadesNuevas = input.unidadesInteres.filter((u) => !c.unidadesInteres.includes(u))
  if (unidadesNuevas.length) cambios.push(automatica('nota', `Interés en ${unidadesNuevas.join(', ')}`, actor))
  return reemplazar(state, { ...c, ...limpiar(input), actividades: [...cambios, ...c.actividades] })
}

/* ------------------------------------------------------------------ etapas */

export interface MoverOpciones {
  motivo?: string
  fechaRetomar?: string
}

export function moverEtapa(state: ClientesState, id: string, etapa: Etapa, actor: Actor, opts: MoverOpciones = {}): ClientesState {
  assertCan(actor, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (c.etapa === etapa) return state
  if (etapa === 'reserva') throw new ClienteError('La etapa Reserva se activa al confirmar una reserva en el módulo Reservas (con pago verificado).')
  if (c.etapa === 'reserva') throw new ClienteError('Este cliente tiene una reserva confirmada: su etapa solo cambia al anularla en el módulo Reservas.')
  let detalle = ''
  if (etapa === 'perdido') {
    if ((opts.motivo ?? '').trim().length < 5) throw new ClienteError('Indica el motivo por el que se perdió el cliente.')
    detalle = ` · motivo: ${opts.motivo!.trim()}`
  }
  if (etapa === 'seguimiento') {
    if (!opts.fechaRetomar || !FECHA.test(opts.fechaRetomar) || opts.fechaRetomar <= hoyGuayaquil()) throw new ClienteError('Indica una fecha futura para retomar el contacto.')
    detalle = ` · retomar el ${opts.fechaRetomar.split('-').reverse().join('/')}`
  }
  if ((etapa === 'cotizacion' || etapa === 'negociacion') && !c.unidadesInteres.length) {
    throw new ClienteError(`Para pasar a "${ETAPAS[etapa].label}" registra primero el departamento de interés.`)
  }
  return reemplazar(state, {
    ...c,
    etapa,
    motivoPerdida: etapa === 'perdido' ? opts.motivo!.trim() : '',
    fechaRetomar: etapa === 'seguimiento' ? opts.fechaRetomar! : null,
    proxima: etapa === 'perdido' ? null : etapa === 'seguimiento' ? { tipo: 'llamada', descripcion: 'Retomar contacto', fecha: opts.fechaRetomar! } : c.proxima,
    actividades: [automatica('etapa', `${ETAPAS[c.etapa].label} → ${ETAPAS[etapa].label}${detalle}`, actor), ...c.actividades],
  })
}

/* -------------------------------------------------------------- actividades */

export function registrarActividad(state: ClientesState, id: string, input: { tipo: Exclude<TipoActividad, 'etapa' | 'cotizacion'>; descripcion: string; fecha: string }, actor: Actor): ClientesState {
  assertCan(actor, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (input.descripcion.trim().length < 3) throw new ClienteError('Describe la actividad.')
  if (!FECHA.test(input.fecha) || input.fecha > hoyGuayaquil()) throw new ClienteError('La fecha de una actividad realizada no puede ser futura.')
  // Una llamada o mensaje con un cliente nuevo lo pasa a "Contactado".
  const avanza = c.etapa === 'nuevo' && ['llamada', 'mensaje', 'visita'].includes(input.tipo)
  let next: Cliente = { ...c, actividades: [actividad(input.tipo, input.descripcion.trim(), actor, input.fecha), ...c.actividades] }
  if (avanza) next = { ...next, etapa: 'contactado', actividades: [automatica('etapa', `${ETAPAS.nuevo.label} → ${ETAPAS.contactado.label} · primer contacto`, actor), ...next.actividades] }
  return reemplazar(state, next)
}

export function programarProxima(state: ClientesState, id: string, proxima: ProximaActividad | null, actor: Actor): ClientesState {
  assertCan(actor, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (proxima) {
    if (proxima.descripcion.trim().length < 3) throw new ClienteError('Describe la próxima actividad.')
    if (!FECHA.test(proxima.fecha)) throw new ClienteError('Indica la fecha de la próxima actividad.')
    if (c.etapa === 'perdido') throw new ClienteError('Un cliente perdido no tiene próximas actividades; muévelo de etapa primero.')
  }
  return reemplazar(state, { ...c, proxima: proxima ? { ...proxima, descripcion: proxima.descripcion.trim() } : null })
}

/** Marca como hecha la próxima actividad: queda en el historial y se limpia. */
export function completarProxima(state: ClientesState, id: string, resultado: string, actor: Actor): ClientesState {
  const c = buscar(state, id, actor)
  if (!c.proxima) throw new ClienteError('No hay una próxima actividad pendiente.')
  const s = registrarActividad(state, id, {
    tipo: c.proxima.tipo,
    descripcion: `${c.proxima.descripcion}${resultado.trim() ? ` · resultado: ${resultado.trim()}` : ''}`,
    fecha: hoyGuayaquil(),
  }, actor)
  return programarProxima(s, id, null, actor)
}

/* -------------------------------------------------------------- cotizaciones */

/** Vincula una cotización emitida al cliente y lo avanza a "Cotización" si estaba en una etapa anterior. */
export function vincularCotizacion(state: ClientesState, id: string, cot: { numero: string; codigo: string; precioFinal: number }, actor: Actor): ClientesState {
  const c = buscar(state, id, actor)
  const idx = ETAPAS_EMBUDO.indexOf(c.etapa)
  const avanzar = c.etapa === 'seguimiento' || (idx >= 0 && idx < ETAPAS_EMBUDO.indexOf('cotizacion'))
  const acts: Actividad[] = [{ ...actividad('cotizacion', `${cot.numero} · ${cot.codigo} · USD ${Math.round(cot.precioFinal).toLocaleString('es-EC')}`, actor), referencia: cot.numero }]
  if (avanzar) acts.unshift(automatica('etapa', `${ETAPAS[c.etapa].label} → ${ETAPAS.cotizacion.label} · cotización emitida`, actor))
  return reemplazar(state, {
    ...c,
    etapa: avanzar ? 'cotizacion' : c.etapa,
    fechaRetomar: avanzar ? null : c.fechaRetomar,
    unidadesInteres: c.unidadesInteres.includes(cot.codigo) ? c.unidadesInteres : [...c.unidadesInteres, cot.codigo],
    cotizaciones: [cot.numero, ...c.cotizaciones],
    actividades: [...acts, ...c.actividades],
  })
}

/* ------------------------------------------------------------------ agenda */

export type Urgencia = 'vencida' | 'hoy' | 'semana' | 'despues' | 'sin_actividad'

export function urgencia(c: Cliente, hoy = hoyGuayaquil()): Urgencia {
  if (!c.proxima) return 'sin_actividad'
  if (c.proxima.fecha < hoy) return 'vencida'
  if (c.proxima.fecha === hoy) return 'hoy'
  const [y, m, d] = hoy.split('-').map(Number)
  const semana = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10)
  return c.proxima.fecha <= semana ? 'semana' : 'despues'
}

export function resumenClientes(clientes: Cliente[], hoy = hoyGuayaquil()) {
  const porEtapa = Object.fromEntries(Object.keys(ETAPAS).map((k) => [k, 0])) as Record<Etapa, number>
  clientes.forEach((c) => porEtapa[c.etapa]++)
  const activos = clientes.filter((c) => c.etapa !== 'perdido' && c.etapa !== 'seguimiento')
  return {
    total: clientes.length,
    activos: activos.length,
    porEtapa,
    vencidas: activos.filter((c) => urgencia(c, hoy) === 'vencida').length,
    hoy: activos.filter((c) => urgencia(c, hoy) === 'hoy').length,
    sinActividad: activos.filter((c) => urgencia(c, hoy) === 'sin_actividad').length,
  }
}

export const etiquetaActividad = (t: TipoActividad) => TIPOS_ACTIVIDAD[t]

/** Lo llama Reservas al confirmar: el cliente pasa a Reserva junto con la unidad bloqueada. */
export function marcarClienteReserva(state: ClientesState, clienteId: string, codigo: string, actor: Actor): ClientesState {
  const c = state.clientes.find((x) => x.id === clienteId)
  if (!c) throw new ClienteError('El cliente de la reserva ya no existe.')
  if (c.etapa === 'reserva') return state
  return reemplazar(state, {
    ...c,
    etapa: 'reserva',
    fechaRetomar: null,
    actividades: [automatica('etapa', `${ETAPAS[c.etapa].label} → Reserva · ${codigo} confirmada`, actor), ...c.actividades],
  })
}

/** Lo llama Reservas al anular una reserva confirmada: el cliente vuelve a Negociación. */
export function liberarClienteReserva(state: ClientesState, clienteId: string, codigo: string, actor: Actor): ClientesState {
  const c = state.clientes.find((x) => x.id === clienteId)
  if (!c || c.etapa !== 'reserva') return state
  return reemplazar(state, {
    ...c,
    etapa: 'negociacion',
    actividades: [automatica('etapa', `Reserva → Negociación · ${codigo} anulada`, actor), ...c.actividades],
  })
}
