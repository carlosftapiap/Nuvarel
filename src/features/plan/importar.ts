import * as XLSX from 'xlsx'
import { ciclos, esFechaValida } from './calculo'
import type { Actividad, Dependencia, EstadoActividad, Fase } from './model'

/**
 * Importación del cronograma desde Excel. Solo se leen valores de celdas: no se ejecutan macros ni fórmulas
 * (de una fórmula se toma el último valor calculado que guarda el archivo).
 */
export const CAMPOS = {
  codigo: 'Código', nombre: 'Actividad', estado: 'Estado', responsable: 'Responsable', avance: 'Avance', inicio: 'Inicio', fin: 'Fin',
  descripcion: 'Descripción', resultado: 'Resultado esperado', aprobador: 'Aprueba / valida', observaciones: 'Comentarios', evidencia: 'Evidencia / vínculo',
  fase: 'Fase (grupo)', predecesora: 'Predecesora', tipo: 'Tipo', fuente: 'Fuente', bloqueaLanzamiento: 'Bloquea lanzamiento',
} as const
export type Campo = keyof typeof CAMPOS

export interface OpcionesImportacion {
  hoja: string
  /** Fila del encabezado (1 = primera fila). Los datos empiezan en la siguiente. */
  filaEncabezado: number
  /** Campo → letra de columna. Un campo sin columna no se importa ni se modifica. */
  mapeo: Partial<Record<Campo, string>>
  /** Cómo se interpreta el avance: fracción 0–1 (formato % de Excel) o número 0–100. */
  avanceComo: 'fraccion' | 'porcentaje'
  /** Texto del archivo → estado de la app. Un texto sin correspondencia es un error. */
  estados: Record<string, EstadoActividad>
  /** Texto del responsable → identificador de usuario. Sin correspondencia queda pendiente (no se crean usuarios). */
  responsables: Record<string, string | null>
  /** Texto del grupo → código de fase del plan. */
  fases: Record<string, string>
  /** Si es false (recomendado), una celda vacía no borra el dato existente. */
  vaciarConCeldasVacias: boolean
}

export interface ErrorImportacion {
  hoja: string
  fila: number
  columna: string
  mensaje: string
}

/** Fila lista para la función del servidor plan_importar. Solo contiene los campos a escribir. */
export interface FilaImportacion {
  fila: number
  codigo: string
  [campo: string]: unknown
}

export type Clase = 'nueva' | 'actualizada' | 'sin_cambios' | 'error'

export interface FilaClasificada {
  fila: number
  codigo: string
  clase: Clase
  cambios: { campo: string; antes: unknown; despues: unknown }[]
  errores: ErrorImportacion[]
  advertencias: string[]
  datos: FilaImportacion
}

/* ------------------------------------------------- correspondencia sugerida */

/** Columnas de la hoja "1 TRABAJAR AQUI" de Gantt_AMURA.xlsx (encabezado en la fila 14). Las columnas AUTO no se importan. */
export function mapeoGanttAmura(): Pick<OpcionesImportacion, 'hoja' | 'filaEncabezado' | 'mapeo' | 'avanceComo'> {
  return {
    hoja: '1 TRABAJAR AQUI',
    filaEncabezado: 14,
    avanceComo: 'fraccion',
    mapeo: {
      codigo: 'A', nombre: 'B', estado: 'C', responsable: 'D', avance: 'E', inicio: 'F', fin: 'G', descripcion: 'H', resultado: 'I',
      aprobador: 'J', observaciones: 'K', evidencia: 'L', fase: 'M', predecesora: 'O', tipo: 'Q', fuente: 'R', bloqueaLanzamiento: 'V',
    },
  }
}

/** Correspondencia de estados del archivo. "Completado" no cierra: cerrar exige fecha real de fin y evidencias en la app. */
export const ESTADOS_SUGERIDOS: Record<string, EstadoActividad> = {
  Pendiente: 'pendiente',
  'En proceso': 'en_ejecucion',
  Completado: 'en_ejecucion',
  'Por validar': 'en_ejecucion',
  Cancelado: 'cancelada',
}

/* ----------------------------------------------------------------- lectura */

export interface FilaArchivo {
  fila: number
  celdas: Partial<Record<Campo, unknown>>
}

export function leerFilas(wb: XLSX.WorkBook, op: Pick<OpcionesImportacion, 'hoja' | 'filaEncabezado' | 'mapeo'>): FilaArchivo[] {
  const ws = wb.Sheets[op.hoja]
  if (!ws) throw new Error(`La hoja "${op.hoja}" no existe en el archivo.`)
  const ref = ws['!ref']
  if (!ref) return []
  const rango = XLSX.utils.decode_range(ref)
  const filas: FilaArchivo[] = []
  for (let r = op.filaEncabezado; r <= rango.e.r; r++) {
    const celdas: FilaArchivo['celdas'] = {}
    let algo = false
    for (const [campo, col] of Object.entries(op.mapeo) as [Campo, string][]) {
      const c = ws[`${col}${r + 1}`] as XLSX.CellObject | undefined
      const v = c?.v
      if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) continue
      celdas[campo] = typeof v === 'string' ? v.trim() : v
      algo = true
    }
    if (algo) filas.push({ fila: r + 1, celdas })
  }
  return filas
}

/** Fecha de Excel (número de serie, Date o texto dd/mm/aaaa o aaaa-mm-dd) → aaaa-mm-dd sin pasar por la zona horaria. */
export function fechaExcel(v: unknown): string | null {
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (typeof v === 'number' && Number.isFinite(v)) {
    const p = XLSX.SSF.parse_date_code(v)
    return p ? iso(p.y, p.m, p.d) : null
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate())
  if (typeof v === 'string') {
    const s = v.trim()
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    if (m) return esFechaValida(s) ? s : null
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
    if (m) { const r = iso(Number(m[3]), Number(m[2]), Number(m[1])); return esFechaValida(r) ? r : null }
  }
  return null
}

/** Avance del archivo → 0–100 según la interpretación elegida. Devuelve null si no es válido. */
export function avanceExcel(v: unknown, como: OpcionesImportacion['avanceComo']): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (t.endsWith('%')) { n = Number(t.slice(0, -1)); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null }
    n = Number(t)
  } else return null
  if (!Number.isFinite(n)) return null
  const pct = como === 'fraccion' ? n * 100 : n
  return pct >= -1e-9 && pct <= 100 + 1e-9 ? Math.round(pct * 100) / 100 : null
}

const CODIGO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/

/* ---------------------------------------------------------- normalización */

export function normalizar(archivo: FilaArchivo[], op: OpcionesImportacion): { filas: FilaImportacion[]; errores: ErrorImportacion[]; advertencias: Map<number, string[]> } {
  const errores: ErrorImportacion[] = []
  const advertencias = new Map<number, string[]>()
  const adv = (f: number, t: string) => advertencias.set(f, [...(advertencias.get(f) ?? []), t])
  const err = (f: number, campo: Campo, mensaje: string) => errores.push({ hoja: op.hoja, fila: f, columna: op.mapeo[campo] ?? '', mensaje })
  const filas: FilaImportacion[] = []
  const vistos = new Map<string, number>()

  for (const { fila, celdas } of archivo) {
    const codigo = String(celdas.codigo ?? '').trim()
    if (!codigo) { err(fila, 'codigo', 'Falta el código.'); continue }
    if (!CODIGO.test(codigo)) err(fila, 'codigo', `Código no válido: "${codigo}".`)
    if (vistos.has(codigo)) err(fila, 'codigo', `Código duplicado (también en la fila ${vistos.get(codigo)}).`)
    vistos.set(codigo, fila)
    const out: FilaImportacion = { fila, codigo }
    const texto = (campo: Campo, clave: string) => {
      if (!op.mapeo[campo]) return
      const v = celdas[campo]
      if (v === undefined) { if (op.vaciarConCeldasVacias) out[clave] = null; return }
      out[clave] = String(v)
    }

    if (op.mapeo.nombre) {
      const nombre = String(celdas.nombre ?? '').trim()
      if (nombre.length < 3) err(fila, 'nombre', 'El nombre de la actividad es obligatorio (mínimo 3 caracteres).')
      else out.nombre = nombre
    }
    texto('descripcion', 'descripcion')
    texto('resultado', 'resultado_esperado')
    texto('aprobador', 'aprobador_texto')
    texto('observaciones', 'observaciones')
    texto('fuente', 'fuente')
    if (op.mapeo.evidencia && celdas.evidencia !== undefined) out.evidencia = String(celdas.evidencia)

    if (op.mapeo.tipo && celdas.tipo !== undefined) {
      const t = String(celdas.tipo).toLowerCase()
      if (t === 'actividad' || t === 'hito') out.tipo = t
      else err(fila, 'tipo', `Tipo no reconocido: "${celdas.tipo}" (Actividad o Hito).`)
    }

    if (op.mapeo.estado) {
      if (celdas.estado === undefined) { if (op.vaciarConCeldasVacias) err(fila, 'estado', 'El estado no puede quedar vacío.') }
      else {
        const e = op.estados[String(celdas.estado)]
        if (!e) err(fila, 'estado', `Estado sin correspondencia: "${celdas.estado}".`)
        else {
          out.estado = e
          if (String(celdas.estado) === 'Completado') adv(fila, 'Marcada "Completado" en el archivo: se importa en ejecución; ciérrala en la app con fecha real de fin y evidencias.')
          if (String(celdas.estado) === 'Por validar') adv(fila, '"Por validar" se importa en ejecución, pendiente de validación.')
        }
      }
    }

    if (op.mapeo.avance) {
      if (celdas.avance === undefined) { if (op.vaciarConCeldasVacias) out.avance = null }
      else {
        const a = avanceExcel(celdas.avance, op.avanceComo)
        if (a === null) err(fila, 'avance', `Avance no válido: "${String(celdas.avance)}" (${op.avanceComo === 'fraccion' ? 'se espera 0 a 1 o 0% a 100%' : 'se espera 0 a 100'}).`)
        else out.avance = a
      }
    }

    for (const [campo, clave] of [['inicio', 'plan_inicio'], ['fin', 'plan_fin']] as const) {
      if (!op.mapeo[campo]) continue
      if (celdas[campo] === undefined) { if (op.vaciarConCeldasVacias) out[clave] = null; continue }
      const f = fechaExcel(celdas[campo])
      if (!f) err(fila, campo, `Fecha no válida: "${String(celdas[campo])}".`)
      else out[clave] = f
    }
    if (typeof out.plan_inicio === 'string' && typeof out.plan_fin === 'string' && out.plan_fin < out.plan_inicio) {
      err(fila, 'fin', 'La fecha de fin es anterior al inicio.')
    }
    if (op.mapeo.inicio && op.mapeo.fin && (celdas.inicio === undefined || celdas.fin === undefined)) adv(fila, 'Sin fechas: queda pendiente de programar.')

    if (op.mapeo.responsable && celdas.responsable !== undefined) {
      const t = String(celdas.responsable)
      out.responsable_texto = t
      const id = op.responsables[t]
      if (id) out.responsable_id = id
      else adv(fila, `Responsable "${t}" sin vincular a un usuario: queda pendiente de asignar.`)
    }

    if (op.mapeo.fase && celdas.fase !== undefined) {
      const c = op.fases[String(celdas.fase)]
      if (!c) err(fila, 'fase', `Fase sin correspondencia: "${celdas.fase}".`)
      else out.fase_codigo = c
    }

    if (op.mapeo.bloqueaLanzamiento && celdas.bloqueaLanzamiento !== undefined) {
      const b = String(celdas.bloqueaLanzamiento).toLowerCase()
      if (['sí', 'si', 'true', '1'].includes(b)) out.bloquea_lanzamiento = true
      else if (['no', 'false', '0'].includes(b)) out.bloquea_lanzamiento = false
      else err(fila, 'bloqueaLanzamiento', `Valor no reconocido: "${celdas.bloqueaLanzamiento}" (Sí o No).`)
    }

    if (op.mapeo.predecesora && celdas.predecesora !== undefined) {
      const p = String(celdas.predecesora).trim()
      if (/[,;]/.test(p)) err(fila, 'predecesora', 'Solo se admite una predecesora por fila en esta versión.')
      else if (p === codigo) err(fila, 'predecesora', 'Una actividad no puede depender de sí misma.')
      else out.predecesora = p
    }
    filas.push(out)
  }
  return { filas, errores, advertencias }
}

/* ----------------------------------------------------------- clasificación */

const CAMPO_ACTIVIDAD: Record<string, keyof Actividad> = {
  nombre: 'nombre', descripcion: 'descripcion', resultado_esperado: 'resultadoEsperado', tipo: 'tipo', responsable_id: 'responsableId',
  responsable_texto: 'responsableTexto', aprobador_texto: 'aprobadorTexto', plan_inicio: 'planInicio', plan_fin: 'planFin', avance: 'avance',
  estado: 'estado', bloquea_lanzamiento: 'bloqueaLanzamiento', observaciones: 'observaciones', fuente: 'fuente',
}

const igual = (a: unknown, b: unknown) => {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === ''
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return a === b
}

/**
 * Compara con lo que ya existe (clave: código dentro del plan). No marca para borrar actividades ausentes del archivo.
 * Valida predecesoras contra el archivo y el plan, y detecta ciclos con las dependencias ya registradas.
 */
export function clasificar(
  norm: ReturnType<typeof normalizar>, existentes: Actividad[], fases: Fase[], deps: Dependencia[], hoja: string, columnaPredecesora = '',
): FilaClasificada[] {
  const porCodigo = new Map(existentes.map((a) => [a.codigo, a]))
  const porId = new Map(existentes.map((a) => [a.id, a]))
  const faseCodigo = new Map(fases.map((f) => [f.id, f.codigo]))
  const codigosArchivo = new Set(norm.filas.map((f) => f.codigo))
  const errPorFila = new Map<number, ErrorImportacion[]>()
  for (const e of norm.errores) errPorFila.set(e.fila, [...(errPorFila.get(e.fila) ?? []), e])
  const addErr = (fila: number, mensaje: string) => errPorFila.set(fila, [...(errPorFila.get(fila) ?? []), { hoja, fila, columna: columnaPredecesora, mensaje }])

  // Grafo combinado (por código) para detectar ciclos.
  const grafo = new Map<string, string[]>()
  const arista = (p: string, s: string) => grafo.set(p, [...(grafo.get(p) ?? []), s])
  for (const d of deps) {
    const p = porId.get(d.predecesoraId)?.codigo
    const s = porId.get(d.sucesoraId)?.codigo
    if (p && s) arista(p, s)
  }
  for (const f of norm.filas) {
    if (typeof f.predecesora !== 'string') continue
    if (!codigosArchivo.has(f.predecesora) && !porCodigo.has(f.predecesora)) addErr(f.fila, `La predecesora ${f.predecesora} no existe en el archivo ni en el plan.`)
    else arista(f.predecesora, f.codigo)
  }
  const filaDe = new Map(norm.filas.map((f) => [f.codigo, f.fila]))
  for (const c of ciclos(grafo)) for (const cod of c) { const fila = filaDe.get(cod); if (fila) addErr(fila, `Dependencias en ciclo: ${c.join(' → ')}.`) }

  return norm.filas.map((f) => {
    const errores = errPorFila.get(f.fila) ?? []
    const advertencias = norm.advertencias.get(f.fila) ?? []
    const actual = porCodigo.get(f.codigo)
    if (errores.length) return { fila: f.fila, codigo: f.codigo, clase: 'error' as const, cambios: [], errores, advertencias, datos: f }
    if (!actual) return { fila: f.fila, codigo: f.codigo, clase: 'nueva' as const, cambios: [], errores, advertencias, datos: f }
    const cambios: FilaClasificada['cambios'] = []
    for (const [clave, valor] of Object.entries(f)) {
      if (['fila', 'codigo', 'evidencia', 'predecesora', 'fase_codigo'].includes(clave)) continue
      const campo = CAMPO_ACTIVIDAD[clave]
      if (campo && !igual(actual[campo], valor)) cambios.push({ campo: clave, antes: actual[campo], despues: valor })
    }
    if ('fase_codigo' in f && (actual.faseId ? faseCodigo.get(actual.faseId) : null) !== f.fase_codigo) {
      cambios.push({ campo: 'fase', antes: actual.faseId ? faseCodigo.get(actual.faseId) : null, despues: f.fase_codigo })
    }
    if (typeof f.predecesora === 'string') {
      const pre = porCodigo.get(f.predecesora)
      if (!pre || !deps.some((d) => d.predecesoraId === pre.id && d.sucesoraId === actual.id)) cambios.push({ campo: 'predecesora', antes: null, despues: f.predecesora })
    }
    if (actual.estado === 'completada' && f.estado && f.estado !== 'completada') {
      return { fila: f.fila, codigo: f.codigo, clase: 'error' as const, cambios, errores: [{ hoja, fila: f.fila, columna: '', mensaje: 'La actividad está cerrada en la app; reábrela con motivo antes de cambiar su estado.' }], advertencias, datos: f }
    }
    return { fila: f.fila, codigo: f.codigo, clase: cambios.length ? 'actualizada' as const : 'sin_cambios' as const, cambios, errores, advertencias, datos: f }
  })
}

/** Grupos de la columna de fase ("01 Dirección y expediente" → código 01). */
export function fasesDelArchivo(archivo: FilaArchivo[]): { texto: string; codigo: string; nombre: string }[] {
  const vistos = new Map<string, { texto: string; codigo: string; nombre: string }>()
  for (const { celdas } of archivo) {
    if (celdas.fase === undefined) continue
    const texto = String(celdas.fase)
    if (vistos.has(texto)) continue
    const m = /^(\d{1,3})\s+(.+)$/.exec(texto)
    vistos.set(texto, m ? { texto, codigo: m[1].padStart(2, '0'), nombre: m[2] } : { texto, codigo: texto.slice(0, 20).toUpperCase().replace(/[^A-Z0-9]+/g, '-'), nombre: texto })
  }
  return [...vistos.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))
}

/** Textos distintos de responsables en el archivo, para vincularlos explícitamente a usuarios. */
export function responsablesDelArchivo(archivo: FilaArchivo[]) {
  const m = new Map<string, number>()
  for (const { celdas } of archivo) if (celdas.responsable !== undefined) m.set(String(celdas.responsable), (m.get(String(celdas.responsable)) ?? 0) + 1)
  return [...m.entries()].map(([texto, filas]) => ({ texto, filas })).sort((a, b) => b.filas - a.filas)
}
