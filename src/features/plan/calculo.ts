import type { Actividad, Dependencia, Frente } from './model'

/* ------------------------------------------------------------------ fechas */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** Días desde 1970-01-01 de una fecha aaaa-mm-dd, en UTC para evitar desplazamientos por zona horaria. */
export function diaNumero(iso: string): number {
  const m = ISO.exec(iso)
  if (!m) throw new Error(`Fecha inválida: ${iso}`)
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`Fecha inválida: ${iso}`)
  return Math.round(t / 86_400_000)
}

export function esFechaValida(iso: string | null | undefined) {
  if (!iso) return false
  try { diaNumero(iso); return true } catch { return false }
}

export function sumarDias(iso: string, dias: number) {
  return new Date((diaNumero(iso) + dias) * 86_400_000).toISOString().slice(0, 10)
}

/** Duración en días calendario inclusivos: una actividad de un solo día dura 1. */
export function duracion(inicio: string | null, fin: string | null): number | null {
  if (!inicio || !fin) return null
  return diaNumero(fin) - diaNumero(inicio) + 1
}

/* ------------------------------------------------------------------ avance */

export interface Faltante {
  codigo: string
  motivo: 'sin peso' | 'sin avance' | 'peso no válido' | 'sin actividades'
}

export interface ResultadoAvance {
  /** Porcentaje 0–100 con precisión completa; null cuando el cálculo está incompleto. */
  valor: number | null
  completo: boolean
  /** Actividades (código) que intervienen en el cálculo. */
  incluidas: string[]
  faltantes: Faltante[]
}

/** Índice de hijas por actividad superior. */
export function indiceHijas(acts: Actividad[]) {
  const m = new Map<string, Actividad[]>()
  for (const a of acts) {
    if (!a.parentId) continue
    const l = m.get(a.parentId) ?? []
    l.push(a)
    m.set(a.parentId, l)
  }
  return m
}

/** Una cancelada sigue en el cálculo salvo que el alcance se haya modificado de forma autorizada. */
const cuenta = (a: Actividad) => !a.excluidaAlcance

/** Suma ponderada de un grupo: Σ(peso × avance) / Σ(pesos). Si falta un peso o un avance, el resultado es incompleto. */
function ponderar(items: { codigo: string; peso: number | null; avance: ResultadoAvance }[]): ResultadoAvance {
  const faltantes: Faltante[] = []
  const incluidas: string[] = []
  let num = 0
  let den = 0
  if (!items.length) return { valor: null, completo: false, incluidas, faltantes: [{ codigo: '', motivo: 'sin actividades' }] }
  for (const it of items) {
    incluidas.push(...(it.avance.incluidas.length ? it.avance.incluidas : [it.codigo]))
    if (it.peso === null) faltantes.push({ codigo: it.codigo, motivo: 'sin peso' })
    else if (!(it.peso > 0) || !Number.isFinite(it.peso)) faltantes.push({ codigo: it.codigo, motivo: 'peso no válido' })
    faltantes.push(...it.avance.faltantes)
    if (it.peso !== null && it.peso > 0 && it.avance.valor !== null) {
      num += it.peso * it.avance.valor
      den += it.peso
    }
  }
  const completo = faltantes.length === 0 && den > 0
  return { valor: completo ? num / den : null, completo, incluidas, faltantes }
}

/**
 * Avance de una actividad. Una actividad de último nivel usa su avance registrado;
 * una superior resume a sus hijas (ponderadas por su peso) y no se cuenta otra vez.
 */
export function avanceActividad(a: Actividad, hijas: Map<string, Actividad[]>): ResultadoAvance {
  const h = (hijas.get(a.id) ?? []).filter(cuenta)
  if (!h.length) {
    if (a.avance === null) return { valor: null, completo: false, incluidas: [a.codigo], faltantes: [{ codigo: a.codigo, motivo: 'sin avance' }] }
    return { valor: a.avance, completo: true, incluidas: [a.codigo], faltantes: [] }
  }
  return ponderar(h.map((x) => ({ codigo: x.codigo, peso: x.peso, avance: avanceActividad(x, hijas) })))
}

/** Avance de un frente: actividades de primer nivel del frente, cada una con su avance resumido. */
export function avanceFrente(frenteId: string, acts: Actividad[]): ResultadoAvance {
  const hijas = indiceHijas(acts)
  const ids = new Set(acts.map((a) => a.id))
  // Primer nivel dentro del frente: sin superior, o cuya superior no está en el conjunto (por alcance).
  const raices = acts.filter((a) => a.frenteId === frenteId && cuenta(a) && (!a.parentId || !ids.has(a.parentId)))
  return ponderar(raices.map((a) => ({ codigo: a.codigo, peso: a.peso, avance: avanceActividad(a, hijas) })))
}

export interface ResultadoConsolidado extends ResultadoAvance {
  frentes: { frente: Frente; avance: ResultadoAvance }[]
  /** Motivos por los que el consolidado no se habilita. */
  bloqueos: string[]
}

/**
 * Avance general = Σ(peso del frente × avance del frente) / Σ(pesos).
 * Solo se habilita si todos los frentes incluidos tienen peso validado y avance calculable.
 */
export function avanceConsolidado(frentes: Frente[], acts: Actividad[]): ResultadoConsolidado {
  const incluidos = frentes.filter((f) => f.incluido)
  const detalle = incluidos.map((f) => ({ frente: f, avance: avanceFrente(f.id, acts) }))
  const bloqueos: string[] = []
  if (!incluidos.length) bloqueos.push('No hay frentes incluidos en el consolidado.')
  for (const { frente, avance } of detalle) {
    if (frente.peso === null) bloqueos.push(`${frente.nombre}: peso pendiente de definir.`)
    else if (!frente.pesoValidado) bloqueos.push(`${frente.nombre}: peso sin validar.`)
    if (!avance.completo) bloqueos.push(`${frente.nombre}: avance incompleto.`)
  }
  if (bloqueos.length) {
    return { valor: null, completo: false, incluidas: detalle.flatMap((d) => d.avance.incluidas), faltantes: detalle.flatMap((d) => d.avance.faltantes), frentes: detalle, bloqueos }
  }
  const den = detalle.reduce((t, d) => t + d.frente.peso!, 0)
  const num = detalle.reduce((t, d) => t + d.frente.peso! * d.avance.valor!, 0)
  return { valor: num / den, completo: true, incluidas: detalle.flatMap((d) => d.avance.incluidas), faltantes: [], frentes: detalle, bloqueos }
}

/** Redondeo solo para mostrar. */
export function fmtAvance(r: { valor: number | null; completo: boolean }) {
  if (r.valor === null || !r.completo) return 'Incompleto'
  return `${r.valor.toLocaleString('es-EC', { maximumFractionDigits: 1 })}%`
}

/* --------------------------------------------------- estados y condiciones */

/** Actividades operativas: las de último nivel (las superiores solo resumen). */
export function operativas(acts: Actividad[]) {
  const padres = new Set(acts.map((a) => a.parentId).filter(Boolean))
  return acts.filter((a) => !padres.has(a.id))
}

const abierta = (a: Actividad) => a.estado !== 'completada' && a.estado !== 'cancelada'

/** Atrasada: no completada ni cancelada y con fin vigente anterior a la fecha de corte. */
export function atrasada(a: Actividad, corte: string) {
  return abierta(a) && !!a.planFin && a.planFin < corte
}

/** Días de retraso del fin vigente respecto de la línea base (positivo = más tarde). Una reprogramación no lo borra. */
export function retrasoBase(a: Actividad): number | null {
  if (!a.baseFin || !a.planFin) return null
  return diaNumero(a.planFin) - diaNumero(a.baseFin)
}

/** Finalización tardía: completada después del fin de la línea base. */
export function finalizacionTardia(a: Actividad): number | null {
  if (a.estado !== 'completada' || !a.realFin || !a.baseFin) return null
  const d = diaNumero(a.realFin) - diaNumero(a.baseFin)
  return d > 0 ? d : 0
}

export type Color = 'rojo' | 'ambar' | 'verde' | 'gris'

export interface Semaforo {
  color: Color
  texto: string
}

/** Información mínima para evaluar plazos: fechas vigentes y responsable. */
export function informacionFaltante(a: Actividad): string[] {
  const f: string[] = []
  if (!a.planInicio || !a.planFin) f.push('fechas')
  if (!a.responsableId) f.push('responsable')
  if (a.avance === null) f.push('avance')
  return f
}

/** El color siempre va acompañado de texto; verde no significa completada. */
export function semaforo(a: Actividad, corte: string, alertaDias: number): Semaforo {
  if (a.estado === 'cancelada') return { color: 'gris', texto: 'Cancelada' }
  if (a.estado === 'completada') return { color: 'verde', texto: 'Completada' }
  if (a.planFin && a.planFin < corte) return { color: 'rojo', texto: `Vencida hace ${diaNumero(corte) - diaNumero(a.planFin)} d` }
  const falta = informacionFaltante(a)
  if (falta.length) return { color: 'gris', texto: `Información insuficiente: ${falta.join(', ')}` }
  const dias = diaNumero(a.planFin!) - diaNumero(corte)
  if (dias <= alertaDias) return { color: 'ambar', texto: dias === 0 ? 'Vence hoy' : `Vence en ${dias} d` }
  return { color: 'verde', texto: 'En plazo' }
}

export interface Indicadores {
  operativas: number
  pendientes: number
  enEjecucion: number
  completadas: number
  canceladas: number
  /** Condiciones adicionales: no son categorías excluyentes de los estados anteriores. */
  atrasadas: number
  bloqueadas: number
  proximas: number
  sinResponsable: number
  sinInformacion: number
}

export function indicadores(acts: Actividad[], corte: string, alertaDias: number): Indicadores {
  const ops = operativas(acts)
  const r: Indicadores = { operativas: ops.length, pendientes: 0, enEjecucion: 0, completadas: 0, canceladas: 0, atrasadas: 0, bloqueadas: 0, proximas: 0, sinResponsable: 0, sinInformacion: 0 }
  for (const a of ops) {
    if (a.estado === 'pendiente') r.pendientes++
    else if (a.estado === 'en_ejecucion') r.enEjecucion++
    else if (a.estado === 'completada') r.completadas++
    else r.canceladas++
    if (atrasada(a, corte)) r.atrasadas++
    if (a.bloqueada && abierta(a)) r.bloqueadas++
    if (semaforo(a, corte, alertaDias).color === 'ambar') r.proximas++
    if (!a.responsableId && abierta(a)) r.sinResponsable++
    if (informacionFaltante(a).length && abierta(a)) r.sinInformacion++
  }
  return r
}

/* ------------------------------------------------------------ dependencias */

export interface ProblemaDependencia {
  tipo: 'autorreferencia' | 'inexistente' | 'ciclo' | 'fechas'
  sucesora: string
  predecesora: string
  texto: string
}

/** Rechaza autorreferencias, dependencias inexistentes y ciclos; señala incoherencias de fechas (fin a inicio). */
export function validarDependencias(acts: Actividad[], deps: Dependencia[]): ProblemaDependencia[] {
  const porId = new Map(acts.map((a) => [a.id, a]))
  const cod = (id: string) => porId.get(id)?.codigo ?? id
  const p: ProblemaDependencia[] = []
  const grafo = new Map<string, string[]>()
  for (const d of deps) {
    if (d.predecesoraId === d.sucesoraId) { p.push({ tipo: 'autorreferencia', sucesora: cod(d.sucesoraId), predecesora: cod(d.predecesoraId), texto: `${cod(d.sucesoraId)} depende de sí misma.` }); continue }
    const pre = porId.get(d.predecesoraId)
    const suc = porId.get(d.sucesoraId)
    if (!pre || !suc) { p.push({ tipo: 'inexistente', sucesora: cod(d.sucesoraId), predecesora: cod(d.predecesoraId), texto: `La dependencia ${cod(d.predecesoraId)} → ${cod(d.sucesoraId)} apunta a una actividad inexistente.` }); continue }
    grafo.set(pre.id, [...(grafo.get(pre.id) ?? []), suc.id])
    if (pre.planFin && suc.planInicio && suc.planInicio <= pre.planFin) {
      p.push({ tipo: 'fechas', sucesora: suc.codigo, predecesora: pre.codigo, texto: `${suc.codigo} empieza el ${suc.planInicio}, antes de que termine ${pre.codigo} (${pre.planFin}).` })
    }
  }
  for (const ciclo of ciclos(grafo)) {
    p.push({ tipo: 'ciclo', sucesora: cod(ciclo[0]), predecesora: cod(ciclo[ciclo.length - 1]), texto: `Ciclo: ${ciclo.map(cod).join(' → ')} → ${cod(ciclo[0])}.` })
  }
  return p
}

/** Ciclos de un grafo dirigido (búsqueda en profundidad). */
export function ciclos(grafo: Map<string, string[]>): string[][] {
  const estado = new Map<string, 1 | 2>()
  const pila: string[] = []
  const res: string[][] = []
  const visitar = (n: string) => {
    estado.set(n, 1)
    pila.push(n)
    for (const m of grafo.get(n) ?? []) {
      if (estado.get(m) === 1) res.push(pila.slice(pila.indexOf(m)))
      else if (!estado.has(m)) visitar(m)
    }
    pila.pop()
    estado.set(n, 2)
  }
  for (const n of grafo.keys()) if (!estado.has(n)) visitar(n)
  return res
}

/** Sucesoras directas que quedarían en conflicto si la actividad termina en `nuevoFin`. No se mueven automáticamente. */
export function impactoReprogramacion(id: string, nuevoFin: string, acts: Actividad[], deps: Dependencia[]) {
  const porId = new Map(acts.map((a) => [a.id, a]))
  return deps
    .filter((d) => d.predecesoraId === id)
    .map((d) => porId.get(d.sucesoraId))
    .filter((s): s is Actividad => !!s && !!s.planInicio && s.planInicio <= nuevoFin)
}
