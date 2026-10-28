import { assertCan, can } from '@/app/permissions'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor, InventoryState } from '@/features/inventario/types'
import { ETAPAS, ETAPAS_EMBUDO, TIPOS_ACTIVIDAD, type Actividad, type Cliente, type ClientesState, type Etapa, type FormaPago, type Origen, type ProximaActividad, type Proposito, type TipoActividad } from './model'

export class ClienteError extends Error {
  constructor(m: string) { super(m); this.name = 'ClienteError' }
}

let seq = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`
const nowIso = () => new Date().toISOString()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export const estadoInicialClientes = (): ClientesState => ({ version: 1, clientes: [] })

/* ------------------------------------------------------------- visibilidad */

/** Administración, gerencia y asesores ven todos los clientes; un corredor solo los suyos. */
export function clientesVisibles(clientes: Cliente[], actor: Actor) {
  if (can(actor.rol, 'clientes.ver_todos')) return clientes
  return clientes.filter((c) => c.asesor === actor.nombre || c.creadoPor.nombre === actor.nombre)
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
  return { id: newId('act'), tipo, fecha, descripcion, usuario: actor.nombre, registradaEn: nowIso() }
}

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
  asesor: string
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
  if (!input.asesor.trim()) e.push('Asigna un asesor responsable.')
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

function limpiar(input: ClienteInput) {
  return {
    nombre: input.nombre.trim(), telefono: input.telefono.trim(), email: input.email.trim().toLowerCase(),
    origen: input.origen, origenDetalle: input.origenDetalle.trim(), unidadesInteres: [...new Set(input.unidadesInteres)],
    presupuesto: input.presupuesto, proposito: input.proposito, formaPago: input.formaPago, asesor: input.asesor.trim(),
  }
}

export function crearCliente(state: ClientesState, input: ClienteInput, actor: Actor, inventario?: InventoryState): { state: ClientesState; cliente: Cliente } {
  assertCan(actor.rol, 'clientes.editar')
  // Solo gerencia o administración asignan a otra persona.
  if (input.asesor.trim() !== actor.nombre && !can(actor.rol, 'clientes.asignar')) throw new ClienteError('Solo gerencia puede asignar el cliente a otro asesor.')
  const errores = validarCliente(input, inventario)
  if (errores.length) throw new ClienteError(errores.join(' '))
  const dup = buscarDuplicado(state, input)
  if (dup) throw new ClienteError(`Ya existe un cliente con ese teléfono o correo: ${dup.nombre} (asesor ${dup.asesor}).`)
  const ahora = nowIso()
  const cliente: Cliente = {
    id: newId('cli'), ...limpiar(input), etapa: 'nuevo', motivoPerdida: '', fechaRetomar: null, proxima: null,
    actividades: [actividad('nota', `Cliente registrado · origen ${input.origen}`, actor)], cotizaciones: [],
    creadoPor: { nombre: actor.nombre, rol: actor.rol }, creadoEn: ahora, actualizadoEn: ahora,
  }
  return { state: { ...state, clientes: [cliente, ...state.clientes] }, cliente }
}

export function actualizarCliente(state: ClientesState, id: string, input: ClienteInput, actor: Actor, inventario?: InventoryState): ClientesState {
  assertCan(actor.rol, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (input.asesor.trim() !== c.asesor && !can(actor.rol, 'clientes.asignar')) throw new ClienteError('Solo gerencia puede reasignar el asesor.')
  const errores = validarCliente(input, inventario)
  if (errores.length) throw new ClienteError(errores.join(' '))
  const dup = buscarDuplicado(state, input, id)
  if (dup) throw new ClienteError(`Ya existe un cliente con ese teléfono o correo: ${dup.nombre}.`)
  const cambios: string[] = []
  if (input.asesor.trim() !== c.asesor) cambios.push(`Asesor reasignado: ${c.asesor} → ${input.asesor.trim()}`)
  const unidadesNuevas = input.unidadesInteres.filter((u) => !c.unidadesInteres.includes(u))
  if (unidadesNuevas.length) cambios.push(`Interés en ${unidadesNuevas.join(', ')}`)
  return reemplazar(state, {
    ...c, ...limpiar(input),
    actividades: cambios.length ? [actividad('nota', cambios.join(' · '), actor), ...c.actividades] : c.actividades,
  })
}

/* ------------------------------------------------------------------ etapas */

export interface MoverOpciones {
  motivo?: string
  fechaRetomar?: string
}

export function moverEtapa(state: ClientesState, id: string, etapa: Etapa, actor: Actor, opts: MoverOpciones = {}): ClientesState {
  assertCan(actor.rol, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (c.etapa === etapa) return state
  let detalle = ''
  if (etapa === 'perdido') {
    if ((opts.motivo ?? '').trim().length < 5) throw new ClienteError('Indica el motivo por el que se perdió el cliente.')
    detalle = ` · motivo: ${opts.motivo!.trim()}`
  }
  if (etapa === 'seguimiento') {
    if (!opts.fechaRetomar || !FECHA.test(opts.fechaRetomar) || opts.fechaRetomar <= hoyGuayaquil()) throw new ClienteError('Indica una fecha futura para retomar el contacto.')
    detalle = ` · retomar el ${opts.fechaRetomar.split('-').reverse().join('/')}`
  }
  if ((etapa === 'cotizacion' || etapa === 'negociacion' || etapa === 'reserva') && !c.unidadesInteres.length) {
    throw new ClienteError(`Para pasar a "${ETAPAS[etapa].label}" registra primero el departamento de interés.`)
  }
  if (etapa === 'reserva' && !c.cotizaciones.length) throw new ClienteError('Para pasar a "Reserva" el cliente debe tener al menos una cotización.')
  return reemplazar(state, {
    ...c,
    etapa,
    motivoPerdida: etapa === 'perdido' ? opts.motivo!.trim() : '',
    fechaRetomar: etapa === 'seguimiento' ? opts.fechaRetomar! : null,
    proxima: etapa === 'perdido' ? null : etapa === 'seguimiento' ? { tipo: 'llamada', descripcion: 'Retomar contacto', fecha: opts.fechaRetomar! } : c.proxima,
    actividades: [actividad('etapa', `${ETAPAS[c.etapa].label} → ${ETAPAS[etapa].label}${detalle}`, actor), ...c.actividades],
  })
}

/* -------------------------------------------------------------- actividades */

export function registrarActividad(state: ClientesState, id: string, input: { tipo: Exclude<TipoActividad, 'etapa' | 'cotizacion'>; descripcion: string; fecha: string }, actor: Actor): ClientesState {
  assertCan(actor.rol, 'clientes.editar')
  const c = buscar(state, id, actor)
  if (input.descripcion.trim().length < 3) throw new ClienteError('Describe la actividad.')
  if (!FECHA.test(input.fecha) || input.fecha > hoyGuayaquil()) throw new ClienteError('La fecha de una actividad realizada no puede ser futura.')
  // Una llamada o mensaje con un cliente nuevo lo pasa a "Contactado".
  const avanza = c.etapa === 'nuevo' && ['llamada', 'mensaje', 'visita'].includes(input.tipo)
  let next: Cliente = { ...c, actividades: [actividad(input.tipo, input.descripcion.trim(), actor, input.fecha), ...c.actividades] }
  if (avanza) next = { ...next, etapa: 'contactado', actividades: [actividad('etapa', `${ETAPAS.nuevo.label} → ${ETAPAS.contactado.label} · primer contacto`, actor), ...next.actividades] }
  return reemplazar(state, next)
}

export function programarProxima(state: ClientesState, id: string, proxima: ProximaActividad | null, actor: Actor): ClientesState {
  assertCan(actor.rol, 'clientes.editar')
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
  const acts: Actividad[] = [actividad('cotizacion', `${cot.numero} · ${cot.codigo} · USD ${Math.round(cot.precioFinal).toLocaleString('es-EC')}`, actor)]
  if (avanzar) acts.unshift(actividad('etapa', `${ETAPAS[c.etapa].label} → ${ETAPAS.cotizacion.label} · cotización emitida`, actor))
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
