import { assertCan, can } from '@/app/permissions'
import { ESTADOS, ESTADOS_EFECTIVOS, ESTADOS_PRECIO_BLOQUEADO, estadoEfectivo, MOTIVO_SIN_CAMBIO, puedeCambiarManual, puedeTransicionar, type EstadoEfectivo } from './estados'
import { aplicarPorcentaje, calcularPrecio, round2, totalVenta } from './pricing'
import type {
  Actor, Edificio, EstadoComercial, InventoryState, Piso, PriceChange, PriceHistoryEntry,
  PriceProposal, PricingParams, StatusHistoryEntry, Tipologia, Unit,
} from './types'
import { nombreEdificio } from './nomenclatura'

export class InventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryError'
  }
}

let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`
const nowIso = () => new Date().toISOString()

/** Estado a partir de lo que entrega la base. Aquí no se inventa ningún dato. */
export function estadoDesde(units: Unit[], params: PricingParams, listaBase: PricingParams): InventoryState {
  return { version: 1, units, params, listaBase, priceHistory: [], statusHistory: [], propuestas: [] }
}

/** Sin conexión con Supabase no hay inventario: el estado vacío no trae unidades ni precios. */
export function estadoSinDatos(): InventoryState {
  const cero: PricingParams = { patioUsdM2: 0, reservaPct: 0, cuotasPct: 0, meses: { 1: 0, 2: 0 } }
  return estadoDesde([], cero, cero)
}

/* ------------------------------------------------------------------ alcance */

export interface Alcance {
  codigos?: string[]
  edificio?: Edificio
  piso?: Piso
  tipologia?: Tipologia
}

export function unidadesEnAlcance(units: Unit[], a: Alcance) {
  return units.filter(
    (u) =>
      (!a.codigos || a.codigos.includes(u.codigo)) &&
      (!a.edificio || u.edificio === a.edificio) &&
      (!a.piso || u.piso === a.piso) &&
      (!a.tipologia || u.tipologia === a.tipologia),
  )
}

export function describirAlcance(a: Alcance) {
  const partes: string[] = []
  if (a.codigos) partes.push(a.codigos.length === 1 ? a.codigos[0] : `${a.codigos.length} unidades seleccionadas`)
  if (a.edificio) partes.push(nombreEdificio(a.edificio))
  if (a.piso) partes.push(a.piso === 'PB' ? 'Planta baja' : `Piso ${a.piso}`)
  if (a.tipologia) partes.push(a.tipologia)
  return partes.length ? partes.join(' · ') : 'Todo el proyecto'
}

/* ------------------------------------------------------------------ precios */

export type ModoPrecio = 'fijar' | 'porcentaje'

export interface CambioPrecioInput {
  alcance: Alcance
  modo: ModoPrecio
  /** USD/m² cuando modo = fijar; porcentaje (ej. 3 o -2) cuando modo = porcentaje. */
  valor: number
  motivo: string
}

export interface PreviewCambioPrecio {
  cambios: PriceChange[]
  omitidas: { codigo: string; razon: string }[]
  totalAntes: number
  totalDespues: number
}

const LIMITE_USD_M2 = { min: 500, max: 10000 }
const LIMITE_PCT = 50

export function previsualizarCambioPrecio(state: InventoryState, input: CambioPrecioInput): PreviewCambioPrecio {
  if (!Number.isFinite(input.valor)) throw new InventoryError('Ingresa un valor numérico.')
  if (input.modo === 'fijar' && (input.valor < LIMITE_USD_M2.min || input.valor > LIMITE_USD_M2.max)) {
    throw new InventoryError(`El precio por m² debe estar entre ${LIMITE_USD_M2.min} y ${LIMITE_USD_M2.max} USD.`)
  }
  if (input.modo === 'porcentaje' && (input.valor === 0 || Math.abs(input.valor) > LIMITE_PCT)) {
    throw new InventoryError(`El porcentaje debe ser distinto de 0 y no superar ±${LIMITE_PCT}%.`)
  }
  const objetivo = unidadesEnAlcance(state.units, input.alcance)
  if (!objetivo.length) throw new InventoryError('El alcance seleccionado no contiene unidades.')
  const cambios: PriceChange[] = []
  const omitidas: PreviewCambioPrecio['omitidas'] = []
  for (const u of objetivo) {
    if (ESTADOS_PRECIO_BLOQUEADO.includes(u.estado)) {
      omitidas.push({ codigo: u.codigo, razon: `Precio congelado: unidad ${ESTADOS[u.estado].label.toLowerCase()}` })
      continue
    }
    const despuesUsdM2 = input.modo === 'fijar' ? round2(input.valor) : aplicarPorcentaje(u.usdM2, input.valor)
    if (despuesUsdM2 === u.usdM2) continue
    cambios.push({
      codigo: u.codigo,
      antesUsdM2: u.usdM2,
      despuesUsdM2,
      antesPrecio: calcularPrecio(u, state.params).precioVenta,
      despuesPrecio: calcularPrecio({ ...u, usdM2: despuesUsdM2 }, state.params).precioVenta,
    })
  }
  return {
    cambios,
    omitidas,
    totalAntes: round2(cambios.reduce((t, c) => t + c.antesPrecio, 0)),
    totalDespues: round2(cambios.reduce((t, c) => t + c.despuesPrecio, 0)),
  }
}

function requireMotivo(motivo: string) {
  if (motivo.trim().length < 5) throw new InventoryError('Indica el motivo del cambio (mínimo 5 caracteres).')
}

/** Aplica un cambio oficial de precio. Sólo quien aprueba precios puede hacerlo. */
export function aplicarCambioPrecio(state: InventoryState, input: CambioPrecioInput, actor: Actor): InventoryState {
  assertCan(actor, 'precios.aprobar')
  requireMotivo(input.motivo)
  const preview = previsualizarCambioPrecio(state, input)
  if (!preview.cambios.length) throw new InventoryError('El cambio no modifica ningún precio.')
  const porCodigo = new Map(preview.cambios.map((c) => [c.codigo, c.despuesUsdM2]))
  const entry: PriceHistoryEntry = {
    id: newId('px'),
    fecha: nowIso(),
    usuario: actor.nombre,
    rol: actor.rol,
    tipo: input.modo === 'fijar' ? 'precio_m2' : 'porcentaje',
    alcance: describirAlcance(input.alcance),
    motivo: input.motivo.trim(),
    detalle: input.modo === 'fijar' ? `Precio por m² fijado en USD ${round2(input.valor)}` : `Ajuste de ${input.valor > 0 ? '+' : ''}${input.valor}% sobre el precio por m²`,
    cambios: preview.cambios,
    totalAntes: preview.totalAntes,
    totalDespues: preview.totalDespues,
  }
  return {
    ...state,
    units: state.units.map((u) => (porCodigo.has(u.codigo) ? { ...u, usdM2: porCodigo.get(u.codigo)! } : u)),
    priceHistory: [entry, ...state.priceHistory],
  }
}

/** Un solo criterio en Inventario y Precios: quien aprueba aplica; los demás envían una propuesta. */
export function guardarCambioPrecio(state: InventoryState, input: CambioPrecioInput, actor: Actor): InventoryState {
  return can(actor, 'precios.aprobar') ? aplicarCambioPrecio(state, input, actor) : crearPropuesta(state, input, actor)
}

export interface TrazaAjuste {
  /** Null si se aplicó sin propuesta previa. */
  propuso: { usuario: string; fecha: string } | null
  /** Null si el cambio no pasa por aprobación (importación o restablecimiento). */
  aprobo: { usuario: string; fecha: string; comentario: string } | null
  registro: { usuario: string; fecha: string }
}

/** Quién propuso y quién aprobó un ajuste. La propuesta aprobada y su ajuste comparten motivo y momento: se aplican juntos. */
export function trazaAjuste(h: PriceHistoryEntry, propuestas: PriceProposal[]): TrazaAjuste {
  const registro = { usuario: h.usuario, fecha: h.fecha }
  if (h.tipo !== 'precio_m2' && h.tipo !== 'porcentaje') return { propuso: null, aprobo: null, registro }
  const p = propuestas.find((x) => x.estado === 'aprobada' && x.resolucion && h.motivo.startsWith(x.motivo) && Math.abs(Date.parse(x.resolucion.fecha) - Date.parse(h.fecha)) < 60_000)
  if (!p?.resolucion) return { propuso: null, aprobo: { usuario: h.usuario, fecha: h.fecha, comentario: '' }, registro }
  return { propuso: { usuario: p.usuario, fecha: p.fecha }, aprobo: { usuario: p.resolucion.usuario, fecha: p.resolucion.fecha, comentario: p.resolucion.comentario }, registro }
}

export const unidadesTxt = (n: number) => (n === 1 ? '1 unidad' : `${n} unidades`)

export const FECHA_LISTA_BASE = '2026-10-28'

/** Aprobado si su último cambio lo aplicó quien aprueba precios; si no, sigue siendo referencial. */
export function estadoPrecio(historial: PriceHistoryEntry[], codigo: string): { tipo: 'aprobado' | 'referencial'; fecha: string } {
  const ultimo = historial
    .filter((h) => h.tipo !== 'parametros' && h.cambios.some((c) => c.codigo === codigo))
    .reduce<PriceHistoryEntry | null>((a, h) => (!a || h.fecha > a.fecha ? h : a), null)
  if (!ultimo) return { tipo: 'referencial', fecha: FECHA_LISTA_BASE }
  return { tipo: ultimo.tipo === 'precio_m2' || ultimo.tipo === 'porcentaje' ? 'aprobado' : 'referencial', fecha: ultimo.fecha.slice(0, 10) }
}

/* ------------------------------------------------- propuestas de precio */

/** Registra una propuesta sin tocar los precios oficiales. */
export function crearPropuesta(state: InventoryState, input: CambioPrecioInput, actor: Actor): InventoryState {
  assertCan(actor, 'precios.proponer')
  requireMotivo(input.motivo)
  const preview = previsualizarCambioPrecio(state, input)
  if (!preview.cambios.length) throw new InventoryError('La propuesta no modifica ningún precio.')
  const propuesta: PriceProposal = {
    id: newId('pp'),
    fecha: nowIso(),
    usuario: actor.nombre,
    rol: actor.rol,
    alcance: { ...input.alcance },
    modo: input.modo,
    valor: input.valor,
    motivo: input.motivo.trim(),
    descripcion: `${describirAlcance(input.alcance)} · ${input.modo === 'fijar' ? `USD ${round2(input.valor)}/m²` : `${input.valor > 0 ? '+' : ''}${input.valor}%`}`,
    cambios: preview.cambios,
    totalAntes: preview.totalAntes,
    totalDespues: preview.totalDespues,
    estado: 'pendiente',
    resolucion: null,
  }
  return { ...state, propuestas: [propuesta, ...state.propuestas] }
}

function buscarPendiente(state: InventoryState, id: string) {
  const p = state.propuestas.find((x) => x.id === id)
  if (!p) throw new InventoryError('La propuesta no existe.')
  if (p.estado !== 'pendiente') throw new InventoryError('La propuesta ya fue resuelta.')
  return p
}

/** Aprueba la propuesta: el cambio se recalcula sobre los precios vigentes y pasa a ser oficial. */
export function aprobarPropuesta(state: InventoryState, id: string, comentario: string, actor: Actor): InventoryState {
  assertCan(actor, 'precios.aprobar')
  const p = buscarPendiente(state, id)
  const aplicado = aplicarCambioPrecio(
    state,
    { alcance: p.alcance, modo: p.modo, valor: p.valor, motivo: `${p.motivo} (propuesta de ${p.usuario}, aprobada${comentario.trim() ? `: ${comentario.trim()}` : ''})` },
    actor,
  )
  return {
    ...aplicado,
    propuestas: aplicado.propuestas.map((x) => (x.id === id ? { ...x, estado: 'aprobada', resolucion: { usuario: actor.nombre, rol: actor.rol, fecha: nowIso(), comentario: comentario.trim() } } : x)),
  }
}

export function rechazarPropuesta(state: InventoryState, id: string, comentario: string, actor: Actor): InventoryState {
  assertCan(actor, 'precios.aprobar')
  buscarPendiente(state, id)
  if (comentario.trim().length < 5) throw new InventoryError('Indica el motivo del rechazo (mínimo 5 caracteres).')
  return {
    ...state,
    propuestas: state.propuestas.map((x) => (x.id === id ? { ...x, estado: 'rechazada', resolucion: { usuario: actor.nombre, rol: actor.rol, fecha: nowIso(), comentario: comentario.trim() } } : x)),
  }
}

/* ---------------------------------------------------------------- parámetros */

export function validarParametros(p: PricingParams) {
  const errores: string[] = []
  if (!(p.patioUsdM2 >= 0 && p.patioUsdM2 <= 5000)) errores.push('El valor del m² de patio debe estar entre 0 y 5000 USD.')
  if (!(p.reservaPct >= 0 && p.reservaPct <= 100)) errores.push('La reserva debe estar entre 0% y 100%.')
  if (!(p.cuotasPct >= 0 && p.cuotasPct <= 100)) errores.push('Las cuotas deben estar entre 0% y 100%.')
  if (p.reservaPct + p.cuotasPct > 100) errores.push('Reserva + cuotas no puede superar el 100%.')
  for (const ed of [1, 2] as Edificio[]) {
    if (!(Number.isInteger(p.meses[ed]) && p.meses[ed] >= 1 && p.meses[ed] <= 120)) errores.push(`Los meses del ${nombreEdificio(ed)} deben ser un entero entre 1 y 120.`)
  }
  return errores
}

export function actualizarParametros(state: InventoryState, params: PricingParams, motivo: string, actor: Actor): InventoryState {
  assertCan(actor, 'inventario.parametros')
  requireMotivo(motivo)
  const errores = validarParametros(params)
  if (errores.length) throw new InventoryError(errores.join(' '))
  const antes = state.params
  const cambiosTexto = [
    antes.patioUsdM2 !== params.patioUsdM2 && `Patio USD/m² ${antes.patioUsdM2} → ${params.patioUsdM2}`,
    antes.reservaPct !== params.reservaPct && `Pago a la firma ${antes.reservaPct}% → ${params.reservaPct}%`,
    antes.cuotasPct !== params.cuotasPct && `Cuotas ${antes.cuotasPct}% → ${params.cuotasPct}%`,
    antes.meses[1] !== params.meses[1] && `Meses E1 ${antes.meses[1]} → ${params.meses[1]}`,
    antes.meses[2] !== params.meses[2] && `Meses E2 ${antes.meses[2]} → ${params.meses[2]}`,
  ].filter(Boolean) as string[]
  if (!cambiosTexto.length) throw new InventoryError('No hay cambios en los parámetros.')
  const cambios: PriceChange[] = state.units
    .map((u) => ({ codigo: u.codigo, antesUsdM2: u.usdM2, despuesUsdM2: u.usdM2, antesPrecio: calcularPrecio(u, antes).precioVenta, despuesPrecio: calcularPrecio(u, params).precioVenta }))
    .filter((c) => c.antesPrecio !== c.despuesPrecio)
  const entry: PriceHistoryEntry = {
    id: newId('pp'), fecha: nowIso(), usuario: actor.nombre, rol: actor.rol, tipo: 'parametros',
    alcance: 'Todo el proyecto', motivo: motivo.trim(), detalle: cambiosTexto.join(' · '), cambios,
    totalAntes: totalVenta(state.units, antes), totalDespues: totalVenta(state.units, params),
  }
  return { ...state, params: { ...params, meses: { ...params.meses } }, priceHistory: [entry, ...state.priceHistory] }
}

/** Vuelve todos los precios por m² a la lista base guardada en la base, con sus parámetros. */
export function restablecerListaBase(state: InventoryState, motivo: string, actor: Actor): InventoryState {
  assertCan(actor, 'inventario.parametros')
  requireMotivo(motivo)
  const base = state.listaBase
  const cambios: PriceChange[] = state.units
    .filter((u) => u.usdM2 !== u.usdM2Lista && !ESTADOS_PRECIO_BLOQUEADO.includes(u.estado))
    .map((u) => ({
      codigo: u.codigo, antesUsdM2: u.usdM2, despuesUsdM2: u.usdM2Lista,
      antesPrecio: calcularPrecio(u, state.params).precioVenta,
      despuesPrecio: calcularPrecio({ ...u, usdM2: u.usdM2Lista }, base).precioVenta,
    }))
  const units = state.units.map((u) => (cambios.some((c) => c.codigo === u.codigo) ? { ...u, usdM2: u.usdM2Lista } : u))
  const entry: PriceHistoryEntry = {
    id: newId('pr'), fecha: nowIso(), usuario: actor.nombre, rol: actor.rol, tipo: 'restablecer',
    alcance: 'Todo el proyecto', motivo: motivo.trim(), detalle: 'Restablecida la lista base y sus parámetros',
    cambios, totalAntes: totalVenta(state.units, state.params), totalDespues: totalVenta(units, base),
  }
  return { ...state, units, params: base, priceHistory: [entry, ...state.priceHistory] }
}

/* ------------------------------------------------------------------- estados */

export function cambiarEstado(
  state: InventoryState,
  codigo: string,
  estado: EstadoComercial,
  motivo: string,
  actor: Actor,
  opts: { reservaId?: string | null; sistema?: boolean } = {},
): InventoryState {
  if (!opts.sistema) assertCan(actor, 'inventario.cambiar_estado')
  requireMotivo(motivo)
  const u = state.units.find((x) => x.codigo === codigo)
  if (!u) throw new InventoryError(`No existe la unidad ${codigo}.`)
  if (u.estado === estado) throw new InventoryError('La unidad ya tiene ese estado.')
  // Una persona solo hace los cambios manuales; los compromisos los registran Reservas y Contratos.
  if (!opts.sistema && !puedeCambiarManual(u.estado, estado)) {
    throw new InventoryError(MOTIVO_SIN_CAMBIO[u.estado] ?? `No se permite pasar de "${ESTADOS[u.estado].label}" a "${ESTADOS[estado].label}".`)
  }
  if (!puedeTransicionar(u.estado, estado)) {
    throw new InventoryError(`No se permite pasar de "${ESTADOS[u.estado].label}" a "${ESTADOS[estado].label}".`)
  }
  const reservaId = estado === 'disponible' ? null : opts.reservaId ?? u.reservaId
  const entry: StatusHistoryEntry = {
    id: newId('st'), fecha: nowIso(), usuario: actor.nombre, rol: actor.rol, codigo, de: u.estado, a: estado, motivo: motivo.trim(), reservaId,
  }
  return {
    ...state,
    units: state.units.map((x) => (x.codigo === codigo ? { ...x, estado, reservaId } : x)),
    statusHistory: [entry, ...state.statusHistory],
  }
}

/* -------------------------------------------- puerto para el módulo de Reservas */

export function puedeReservarse(u: Unit) {
  return u.estado === 'disponible'
}

/** Llamado por Reservas al aprobar una reserva. Congela el precio vigente. */
export function marcarReservada(state: InventoryState, codigo: string, reservaId: string, actor: Actor) {
  const u = state.units.find((x) => x.codigo === codigo)
  if (!u) throw new InventoryError(`No existe la unidad ${codigo}.`)
  if (!puedeReservarse(u)) throw new InventoryError(`La unidad ${u.dpt} no está disponible para reservar (${ESTADOS[u.estado].label}).`)
  return cambiarEstado(state, codigo, 'reservado', `Reserva ${reservaId} aprobada`, actor, { reservaId, sistema: true })
}

/** Llamado por Reservas al anular o vencer una reserva. */
export function liberarReserva(state: InventoryState, codigo: string, reservaId: string, motivo: string, actor: Actor) {
  const u = state.units.find((x) => x.codigo === codigo)
  if (!u) throw new InventoryError(`No existe la unidad ${codigo}.`)
  if (u.estado !== 'reservado' || u.reservaId !== reservaId) throw new InventoryError(`La unidad ${u.dpt} no tiene la reserva ${reservaId}.`)
  return cambiarEstado(state, codigo, 'disponible', motivo, actor, { sistema: true })
}

/* ---------------------------------------------------------------- resúmenes */

export function resumenInventario(state: InventoryState) {
  const precios = state.units.map((u) => ({ u, p: calcularPrecio(u, state.params) }))
  const total = round2(precios.reduce((t, x) => t + x.p.precioVenta, 0))
  const area = precios.reduce((t, x) => t + x.p.areaVendibleM2, 0)
  const areaBodegaTotal = precios.reduce((t, x) => t + x.p.precioAreaBodega, 0)
  const porEstado = Object.fromEntries(Object.keys(ESTADOS_EFECTIVOS).map((k) => [k, 0])) as Record<EstadoEfectivo, number>
  state.units.forEach((u) => porEstado[estadoEfectivo(u)]++)
  return {
    unidades: state.units.length,
    porEdificio: { 1: state.units.filter((u) => u.edificio === 1).length, 2: state.units.filter((u) => u.edificio === 2).length },
    total,
    promedio: state.units.length ? total / state.units.length : 0,
    usdM2Promedio: area ? areaBodegaTotal / area : 0,
    porEstado,
  }
}
