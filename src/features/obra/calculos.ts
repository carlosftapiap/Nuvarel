import type { Actividad, EstadoActividad, Frente, ItemCronograma, ModoAvance, RegistroAvance } from './model'

/** Todo lo que aquí se calcula sale de registros. Sin dato no se inventa una cifra: se devuelve null. */

const MS_DIA = 86_400_000
export const dia = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_DIA
}
export const hoyIso = () => new Date().toISOString().slice(0, 10)
export const fechaLocalIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const redondear = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export function duracionDias(inicio: string | null, fin: string | null): number | null {
  if (!inicio || !fin) return null
  const n = dia(fin) - dia(inicio) + 1
  return n > 0 ? n : null
}

const activa = (a: { estado: string }) => a.estado !== 'cancelada'
const porOrden = (a: { orden: number; codigo: string }, b: { orden: number; codigo: string }) => a.orden - b.orden || a.codigo.localeCompare(b.codigo, 'es', { numeric: true })

/** Actividades vigentes (no canceladas) agrupadas por su superior. */
export function indexar(acts: Actividad[]): Map<string | null, Actividad[]> {
  const m = new Map<string | null, Actividad[]>()
  for (const a of acts.filter(activa)) m.set(a.parentId, [...(m.get(a.parentId) ?? []), a])
  for (const lista of m.values()) lista.sort(porOrden)
  return m
}

type Indice = Map<string | null, Actividad[]>

/** Las actividades con subactividades se calculan con ellas; las hojas usan su registro (sin registro cuenta como 0). Null si falta una ponderación. */
export function avanceNodo(idx: Indice, a: Actividad, modo: ModoAvance): number | null {
  const hijos = idx.get(a.id) ?? []
  if (!hijos.length) return (modo === 'validado' ? a.avanceValidado : a.avanceRegistrado) ?? 0
  let suma = 0, pesos = 0
  for (const h of hijos) {
    if (h.peso === null) return null
    const v = avanceNodo(idx, h, modo)
    if (v === null) return null
    suma += h.peso * v; pesos += h.peso
  }
  return suma / pesos
}

/** Avance global de un frente. Null mientras no haya ponderaciones aprobadas y completas: «pendiente de configurar». */
export function avanceFrente(frente: Pick<Frente, 'pesosAprobados' | 'id'>, acts: Actividad[], modo: ModoAvance): number | null {
  if (!frente.pesosAprobados) return null
  const idx = indexar(acts.filter((a) => a.frenteId === frente.id))
  const raiz = idx.get(null) ?? []
  if (!raiz.length) return null
  let suma = 0, pesos = 0
  for (const a of raiz) {
    if (a.peso === null) return null
    const v = avanceNodo(idx, a, modo)
    if (v === null) return null
    suma += a.peso * v; pesos += a.peso
  }
  return redondear(suma / pesos)
}

/* ------------------------------------------------------------ avance actual */

/** Promedio simple: cada actividad pesa igual, a cada nivel. Sin registro cuenta como 0. Misma regla que obra_avance_simple en la base. */
export function avanceSimple(idx: Indice, a: Actividad): number {
  const hijos = idx.get(a.id) ?? []
  if (!hijos.length) return a.avanceValidado ?? 0
  return hijos.reduce((t, h) => t + avanceSimple(idx, h), 0) / hijos.length
}

/** Con ponderaciones aprobadas usa el cálculo ponderado; sin ellas, el promedio simple. */
export const avanceEtapa = (frente: Pick<Frente, 'pesosAprobados'>, idx: Indice, a: Actividad): number =>
  (frente.pesosAprobados ? avanceNodo(idx, a, 'validado') : null) ?? avanceSimple(idx, a)

/** El único porcentaje de un frente. Null solo si no tiene etapas. */
export function avanceActualFrente(frente: Pick<Frente, 'pesosAprobados' | 'id'>, acts: Actividad[]): number | null {
  const ponderado = avanceFrente(frente, acts, 'validado')
  if (ponderado !== null) return ponderado
  const idx = indexar(acts.filter((a) => a.frenteId === frente.id))
  const raiz = idx.get(null) ?? []
  return raiz.length ? redondear(raiz.reduce((t, a) => t + avanceSimple(idx, a), 0) / raiz.length) : null
}

/** 0 % Sin iniciar, 1–99 % En ejecución y 100 % Completada. Pausada y cancelada son decisiones técnicas: se respetan. */
export function estadoPorAvance(a: Pick<Actividad, 'estado'>, avance: number): EstadoActividad {
  if (a.estado === 'pausada' || a.estado === 'cancelada') return a.estado
  return avance >= 100 ? 'completada' : avance > 0 ? 'en_ejecucion' : 'por_programar'
}

export function cobertura(acts: Actividad[]) {
  const idx = indexar(acts)
  const hojas = acts.filter((a) => activa(a) && !(idx.get(a.id) ?? []).length)
  return { hojas: hojas.length, conAvanceValidado: hojas.filter((a) => a.avanceValidado !== null).length }
}

/* ------------------------------------------------------------- planificado */

/** Avance previsto de una actividad en una fecha, repartido en partes iguales entre sus días. Null sin fechas. */
export function planificadoHoja(inicio: string | null, fin: string | null, fecha: string): number | null {
  const dur = duracionDias(inicio, fin)
  if (!inicio || !dur) return null
  const transcurridos = dia(fecha) - dia(inicio) + 1
  if (transcurridos <= 0) return 0
  if (transcurridos >= dur) return 100
  return (transcurridos / dur) * 100
}

/** Avance planificado de un frente según su cronograma aprobado. Null si falta una fecha o una ponderación del cronograma. */
export function planificadoFrente(snapshot: ItemCronograma[], fecha: string): number | null {
  const idx = new Map<string | null, ItemCronograma[]>()
  for (const i of snapshot) idx.set(i.parentId, [...(idx.get(i.parentId) ?? []), i])
  const nodo = (i: ItemCronograma): number | null => {
    const hijos = idx.get(i.id) ?? []
    if (!hijos.length) return planificadoHoja(i.planInicio, i.planFin, fecha)
    let suma = 0, pesos = 0
    for (const h of hijos) {
      if (h.peso === null) return null
      const v = nodo(h)
      if (v === null) return null
      suma += h.peso * v; pesos += h.peso
    }
    return suma / pesos
  }
  const raiz = idx.get(null) ?? []
  if (!raiz.length) return null
  let suma = 0, pesos = 0
  for (const i of raiz) {
    if (i.peso === null) return null
    const v = nodo(i)
    if (v === null) return null
    suma += i.peso * v; pesos += i.peso
  }
  return redondear(suma / pesos)
}

/** Diferencia entre lo ejecutado y lo planificado, en puntos. Negativa = atraso. Null si falta alguno. */
export const desviacion = (ejecutado: number | null, planificado: number | null) => (ejecutado === null || planificado === null ? null : redondear(ejecutado - planificado))

/* ----------------------------------------------------------------- alertas */

export interface Retraso { actividad: Actividad; tipo: 'fin' | 'inicio'; dias: number }

/** Actividades hoja con retraso: fin previsto vencido sin completarse, o inicio previsto vencido sin arrancar. */
export function retrasos(acts: Actividad[], hoy: string): Retraso[] {
  const idx = indexar(acts)
  const salida: Retraso[] = []
  for (const a of acts.filter(activa)) {
    if ((idx.get(a.id) ?? []).length) continue
    if (a.estado === 'completada' || (a.avanceValidado ?? 0) >= 100) continue
    if (a.planFin && a.planFin < hoy) salida.push({ actividad: a, tipo: 'fin', dias: dia(hoy) - dia(a.planFin) })
    else if (a.planInicio && a.planInicio < hoy && !a.realInicio && (a.avanceRegistrado ?? 0) === 0 && (a.estado === 'por_programar' || a.estado === 'programada')) {
      salida.push({ actividad: a, tipo: 'inicio', dias: dia(hoy) - dia(a.planInicio) })
    }
  }
  return salida.sort((x, y) => y.dias - x.dias)
}

/* ----------------------------------------------------------- ponderaciones */

export interface GrupoPesos { parentId: string | null; actividades: number; conPeso: number; suma: number; completo: boolean }

/** Cada nivel (las actividades de un mismo superior) debe sumar 100 %. */
export function gruposPesos(acts: Actividad[]): GrupoPesos[] {
  const idx = indexar(acts)
  const vigentes = new Set(acts.filter(activa).map((a) => a.id))
  const grupos: GrupoPesos[] = []
  for (const [parentId, lista] of idx) {
    if (parentId !== null && !vigentes.has(parentId)) continue
    const conPeso = lista.filter((a) => a.peso !== null).length
    const suma = Math.round(lista.reduce((t, a) => t + (a.peso ?? 0), 0) * 10000) / 10000
    grupos.push({ parentId, actividades: lista.length, conPeso, suma, completo: conPeso === lista.length && Math.abs(suma - 100) <= 0.0001 })
  }
  return grupos
}

export const pesosCompletos = (acts: Actividad[]) => acts.some(activa) && gruposPesos(acts).every((g) => g.completo)

/* ------------------------------------------------------------------ árbol */

export interface NodoArbol { actividad: Actividad; nivel: number; tieneHijos: boolean }

/** Lista en orden de lectura (cada actividad seguida de sus subactividades). Las canceladas van al final de su nivel. */
export function aplanar(acts: Actividad[], ocultas: ReadonlySet<string> = new Set()): NodoArbol[] {
  const porPadre = new Map<string | null, Actividad[]>()
  for (const a of acts) porPadre.set(a.parentId, [...(porPadre.get(a.parentId) ?? []), a])
  for (const l of porPadre.values()) l.sort((x, y) => Number(x.estado === 'cancelada') - Number(y.estado === 'cancelada') || porOrden(x, y))
  const salida: NodoArbol[] = []
  const visitar = (padre: string | null, nivel: number) => {
    for (const a of porPadre.get(padre) ?? []) {
      const tieneHijos = (porPadre.get(a.id) ?? []).length > 0
      salida.push({ actividad: a, nivel, tieneHijos })
      if (tieneHijos && !ocultas.has(a.id)) visitar(a.id, nivel + 1)
    }
  }
  visitar(null, 0)
  return salida
}

/** Cambios de fecha o ponderación respecto al cronograma aprobado vigente. */
export function modificadaDesdeAprobacion(a: Actividad, snapshot: ItemCronograma[] | null): boolean {
  if (!snapshot) return false
  const s = snapshot.find((i) => i.id === a.id)
  if (!s) return true
  return s.planInicio !== a.planInicio || s.planFin !== a.planFin || s.peso !== a.peso
}

/* ---------------------------------------------------------------- historial */

/** Las actividades tal como estaban validadas en una fecha: el último avance validado con corte hasta ese día. */
export function actividadesAl(acts: Actividad[], avances: RegistroAvance[], fecha: string): Actividad[] {
  const ultimo = new Map<string, RegistroAvance>()
  for (const r of avances) {
    if (r.estado !== 'validado' || r.fechaCorte > fecha) continue
    const previo = ultimo.get(r.actividadId)
    if (!previo || r.fechaCorte > previo.fechaCorte || (r.fechaCorte === previo.fechaCorte && r.registradoEn > previo.registradoEn)) ultimo.set(r.actividadId, r)
  }
  return acts.map((a) => ({ ...a, avanceValidado: ultimo.get(a.id)?.avance ?? null, avanceRegistrado: ultimo.get(a.id)?.avance ?? null }))
}

/** Avance validado de un frente en una fecha pasada, con las ponderaciones vigentes. Null si no hay cifra. */
export function avanceFrenteAl(frente: Pick<Frente, 'pesosAprobados' | 'id'>, acts: Actividad[], avances: RegistroAvance[], fecha: string): number | null {
  return avanceActualFrente(frente, actividadesAl(acts.filter((a) => a.frenteId === frente.id), avances, fecha))
}

/** Último día de cada mes entre dos fechas (el mes en curso termina hoy). Máximo `limite` meses, los más recientes. */
export function finesDeMes(desde: string, hasta: string, limite = 12): string[] {
  const salida: string[] = []
  let [y, m] = desde.split('-').map(Number)
  const [yh, mh] = hasta.split('-').map(Number)
  while (y < yh || (y === yh && m <= mh)) {
    const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    salida.push(fin > hasta ? hasta : fin)
    m++; if (m > 12) { m = 1; y++ }
  }
  return salida.slice(-limite)
}

/** Fecha del último corte validado de un conjunto de actividades. */
export const ultimoCorte = (acts: Actividad[]) => acts.reduce<string | null>((m, a) => (a.ultimoCorteValidado && (!m || a.ultimoCorteValidado > m) ? a.ultimoCorteValidado : m), null)
