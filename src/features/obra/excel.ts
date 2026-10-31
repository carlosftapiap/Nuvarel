import * as XLSX from 'xlsx'
import { aplanar, avanceNodo, dia, duracionDias, indexar } from './calculos'
import { ESTADO_ACTIVIDAD, type Actividad, type EstadoActividad, type FilaImportada, type Frente } from './model'

/**
 * Importación y exportación del cronograma. Solo se leen valores de celdas (sin macros ni fórmulas).
 * El archivo exportado se puede volver a importar tal cual: las actividades se identifican por su código.
 */

export const ENCABEZADOS = [
  'Código', 'Actividad superior (código)', 'Actividad', 'Descripción', 'Ponderación %', 'Inicio previsto', 'Fin previsto', 'Inicio real', 'Fin real',
  'Duración (días)', 'Responsable', 'Estado', 'Observaciones',
] as const
const SOLO_LECTURA = ['Avance actual % (solo lectura)'] as const
export const MAX_FILAS = 2000

const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

type Campo = keyof FilaImportada
const CAMPOS: Record<string, Campo> = {
  codigo: 'codigo', 'actividad superior codigo': 'parent_codigo', 'actividad superior': 'parent_codigo', superior: 'parent_codigo',
  actividad: 'nombre', nombre: 'nombre', descripcion: 'descripcion', ponderacion: 'peso', peso: 'peso',
  'inicio previsto': 'plan_inicio', 'inicio planificado': 'plan_inicio', 'fin previsto': 'plan_fin', 'fin planificado': 'plan_fin',
  'inicio real': 'real_inicio', 'fin real': 'real_fin', 'duracion dias': 'duracion_dias', duracion: 'duracion_dias',
  responsable: 'responsable_texto', estado: 'estado', observaciones: 'observaciones',
}

const ESTADO_POR_TEXTO: Record<string, EstadoActividad> = Object.fromEntries([
  ...Object.entries(ESTADO_ACTIVIDAD).map(([k, v]) => [norm(v.label), k as EstadoActividad]),
  ...Object.keys(ESTADO_ACTIVIDAD).map((k) => [norm(k), k as EstadoActividad]),
])

/** Fecha de Excel (número de serie), texto ISO o dd/mm/aaaa. Devuelve null si está vacía y undefined si no es válida. */
export function leerFecha(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  let y: number, m: number, d: number
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1 || v > 80000) return undefined
    const f = new Date(Math.round((Math.floor(v) - 25569) * 86_400_000))
    y = f.getUTCFullYear(); m = f.getUTCMonth() + 1; d = f.getUTCDate()
  } else {
    const t = String(v).trim()
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t)
    const lat = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)
    if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] } else if (lat) { d = +lat[1]; m = +lat[2]; y = +lat[3] } else return undefined
  }
  const prueba = new Date(Date.UTC(y, m - 1, d))
  if (prueba.getUTCFullYear() !== y || prueba.getUTCMonth() !== m - 1 || prueba.getUTCDate() !== d) return undefined
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const leerNumero = (v: unknown): number | null | undefined => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const n = Number(String(v).trim().replace('%', '').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export interface ErrorFila { fila: number; mensaje: string }
export interface ResultadoLectura { hoja: string; filas: (FilaImportada & { fila: number })[]; errores: ErrorFila[] }

/** Lee y valida el archivo. No guarda nada: devuelve las filas listas y todos los errores con su número de fila. */
export function leerCronograma(contenido: ArrayBuffer, codigosExistentes: ReadonlySet<string> = new Set()): ResultadoLectura {
  let libro: XLSX.WorkBook
  try { libro = XLSX.read(contenido, { type: 'array', cellDates: false }) } catch { throw new Error('No se pudo leer el archivo. Usa un libro de Excel (.xlsx).') }
  const hoja = libro.SheetNames.find((h) => norm(h) === 'cronograma') ?? libro.SheetNames[0]
  const ws = hoja ? libro.Sheets[hoja] : undefined
  if (!ws) throw new Error('El archivo no tiene hojas.')
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null })
  const filaEnc = matriz.slice(0, 15).findIndex((f) => {
    const n = f.map(norm)
    return n.includes('codigo') && (n.includes('actividad') || n.includes('nombre'))
  })
  if (filaEnc < 0) throw new Error('No se encontró el encabezado. La primera fila debe incluir las columnas «Código» y «Actividad».')
  const columnas = new Map<number, Campo>()
  matriz[filaEnc].forEach((h, i) => { const c = CAMPOS[norm(h)]; if (c && ![...columnas.values()].includes(c)) columnas.set(i, c) })
  const filas: (FilaImportada & { fila: number })[] = []
  const errores: ErrorFila[] = []
  const vistos = new Set<string>()
  const datos = matriz.slice(filaEnc + 1)
  if (datos.filter((f) => f.some((c) => c !== null && c !== '')).length > MAX_FILAS) throw new Error(`El archivo tiene más de ${MAX_FILAS} actividades.`)

  datos.forEach((celdas, idx) => {
    if (!celdas.some((c) => c !== null && c !== '')) return
    const fila = filaEnc + 2 + idx
    const err = (mensaje: string) => errores.push({ fila, mensaje })
    const v: Partial<Record<Campo, unknown>> = {}
    columnas.forEach((campo, i) => { v[campo] = celdas[i] ?? null })
    const codigo = String(v.codigo ?? '').trim()
    const nombre = String(v.nombre ?? '').trim()
    if (!codigo) err('Falta el código')
    else if (codigo.length > 40) err('El código supera 40 caracteres')
    else if (vistos.has(codigo)) err(`El código ${codigo} está repetido`)
    vistos.add(codigo)
    if (nombre.length < 3) err('El nombre de la actividad debe tener al menos 3 caracteres')

    let peso = leerNumero(v.peso)
    if (peso === undefined) { err('La ponderación no es un número'); peso = null }
    else if (peso !== null) {
      // Una celda con formato de porcentaje guarda 0,2 para 20 %.
      const col = [...columnas.entries()].find(([, c]) => c === 'peso')?.[0]
      const celda = col === undefined ? undefined : ws[XLSX.utils.encode_cell({ r: filaEnc + 1 + idx, c: col })]
      if (celda && typeof celda.w === 'string' && celda.w.includes('%') && peso <= 1) peso = Math.round(peso * 10000) / 100
      if (peso <= 0 || peso > 100) err('La ponderación debe estar entre 0 y 100')
    }
    const fechas: Record<'plan_inicio' | 'plan_fin' | 'real_inicio' | 'real_fin', string | null> = { plan_inicio: null, plan_fin: null, real_inicio: null, real_fin: null }
    for (const k of Object.keys(fechas) as (keyof typeof fechas)[]) {
      const f = leerFecha(v[k])
      if (f === undefined) err(`La fecha «${String(v[k])}» no es válida (usa dd/mm/aaaa)`)
      else fechas[k] = f
    }
    if (fechas.plan_inicio && fechas.plan_fin && fechas.plan_fin < fechas.plan_inicio) err('El fin previsto es anterior al inicio')
    if (fechas.real_inicio && fechas.real_fin && fechas.real_fin < fechas.real_inicio) err('El fin real es anterior al inicio')
    let duracion = leerNumero(v.duracion_dias)
    if (duracion === undefined || (duracion !== null && (!Number.isInteger(duracion) || duracion <= 0))) { err('La duración debe ser un número entero de días mayor que cero'); duracion = null }
    const textoEstado = String(v.estado ?? '').trim()
    let estado: EstadoActividad = 'por_programar'
    if (textoEstado) {
      const e = ESTADO_POR_TEXTO[norm(textoEstado)]
      if (e) estado = e; else err(`El estado «${textoEstado}» no existe`)
    }
    const responsable = String(v.responsable_texto ?? '').trim()
    if (responsable && responsable.length < 3) err('El responsable debe tener al menos 3 caracteres')
    const superior = String(v.parent_codigo ?? '').trim()
    if (superior && superior === codigo) err('Una actividad no puede ser su propia superior')
    filas.push({
      fila, codigo, parent_codigo: superior, nombre, descripcion: String(v.descripcion ?? '').trim(), peso, ...fechas,
      duracion_dias: fechas.plan_inicio && fechas.plan_fin ? duracionDias(fechas.plan_inicio, fechas.plan_fin) : duracion,
      responsable_texto: responsable, estado, observaciones: String(v.observaciones ?? '').trim(),
    })
  })
  if (!filas.length && !errores.length) throw new Error('El archivo no tiene actividades debajo del encabezado.')
  const conocidos = new Set([...codigosExistentes, ...filas.map((f) => f.codigo)])
  for (const f of filas) if (f.parent_codigo && !conocidos.has(f.parent_codigo)) errores.push({ fila: f.fila, mensaje: `La actividad superior «${f.parent_codigo}» no existe` })
  return { hoja, filas, errores: errores.sort((a, b) => a.fila - b.fila) }
}

export interface Clasificacion { nuevas: number; actualizadas: number; sinCambios: number; detalle: { fila: number; codigo: string; clase: 'nueva' | 'actualizada' | 'sin_cambios'; cambios: string[] }[] }

/** Qué haría la importación con lo que ya hay: crear, actualizar o dejar igual. */
export function clasificar(filas: FilaImportada[], existentes: Actividad[]): Clasificacion {
  const porCodigo = new Map(existentes.map((a) => [a.codigo, a]))
  const codigoDe = new Map(existentes.map((a) => [a.id, a.codigo]))
  const salida: Clasificacion = { nuevas: 0, actualizadas: 0, sinCambios: 0, detalle: [] }
  filas.forEach((f, i) => {
    const a = porCodigo.get(f.codigo)
    const fila = (f as { fila?: number }).fila ?? i + 2
    if (!a) { salida.nuevas++; salida.detalle.push({ fila, codigo: f.codigo, clase: 'nueva', cambios: [] }); return }
    const cambios: string[] = []
    const cmp = (campo: string, antes: unknown, despues: unknown) => { if ((antes ?? '') !== (despues ?? '')) cambios.push(campo) }
    cmp('Actividad', a.nombre, f.nombre); cmp('Descripción', a.descripcion, f.descripcion); cmp('Ponderación', a.peso, f.peso)
    cmp('Inicio previsto', a.planInicio, f.plan_inicio); cmp('Fin previsto', a.planFin, f.plan_fin); cmp('Inicio real', a.realInicio, f.real_inicio); cmp('Fin real', a.realFin, f.real_fin)
    cmp('Duración', a.duracionDias, f.plan_inicio && f.plan_fin ? duracionDias(f.plan_inicio, f.plan_fin) : f.duracion_dias)
    if (!a.responsableId) cmp('Responsable', a.responsableTexto, f.responsable_texto)
    cmp('Estado', a.estado, f.estado); cmp('Observaciones', a.observaciones, f.observaciones)
    cmp('Actividad superior', a.parentId ? codigoDe.get(a.parentId) ?? '' : '', f.parent_codigo)
    if (cambios.length) { salida.actualizadas++; salida.detalle.push({ fila, codigo: f.codigo, clase: 'actualizada', cambios }) }
    else { salida.sinCambios++; salida.detalle.push({ fila, codigo: f.codigo, clase: 'sin_cambios', cambios: [] }) }
  })
  return salida
}

/* ------------------------------------------------------------------ exportar */

const serial = (iso: string | null) => (iso ? dia(iso) + 25569 : null)

/** Libro del cronograma de un frente, en el mismo formato que se importa. */
export function libroCronograma(frente: Frente, acts: Actividad[], personas: { id: string; nombre: string }[]): XLSX.WorkBook {
  const deFrente = acts.filter((a) => a.frenteId === frente.id)
  const idx = indexar(deFrente)
  const porId = new Map(deFrente.map((a) => [a.id, a]))
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  const filas = aplanar(deFrente).map(({ actividad: a }) => [
    a.codigo, a.parentId ? porId.get(a.parentId)?.codigo ?? '' : '', a.nombre, a.descripcion, a.peso, serial(a.planInicio), serial(a.planFin), serial(a.realInicio), serial(a.realFin),
    duracionDias(a.planInicio, a.planFin) ?? a.duracionDias, a.responsableId ? nombre.get(a.responsableId) ?? '' : a.responsableTexto, ESTADO_ACTIVIDAD[a.estado].label, a.observaciones,
    a.estado === 'cancelada' ? null : avanceNodo(idx, a, 'validado'),
  ])
  const ws = XLSX.utils.aoa_to_sheet([[...ENCABEZADOS, ...SOLO_LECTURA], ...filas])
  for (let r = 1; r <= filas.length; r++) {
    for (const c of [5, 6, 7, 8]) {
      const celda = ws[XLSX.utils.encode_cell({ r, c })]
      if (celda && typeof celda.v === 'number') celda.z = 'dd/mm/yyyy'
    }
  }
  ws['!cols'] = [12, 16, 38, 34, 12, 14, 14, 12, 12, 12, 24, 16, 34, 18, 18].map((wch) => ({ wch }))
  ws['!freeze'] = { xSplit: 3, ySplit: 1 }
  const instrucciones = XLSX.utils.aoa_to_sheet([
    [`Cronograma · ${frente.nombre}`],
    ['Las actividades se identifican por su código: al importar, el código existente se actualiza y el nuevo se crea. Nada se duplica ni se borra.'],
    ['Escribe la ponderación como número: 20 significa 20 %. Cada nivel (las actividades de una misma superior) debe sumar 100 %.'],
    ['Las fechas pueden quedar vacías. Usa dd/mm/aaaa. Si hay inicio y fin previstos, la duración se calcula sola.'],
    ['Las columnas «solo lectura» no se importan. El avance se registra en la aplicación y lo valida Gerencia o Administración.'],
    ['Estados válidos: ' + Object.values(ESTADO_ACTIVIDAD).map((e) => e.label).join(', ') + '.'],
  ])
  instrucciones['!cols'] = [{ wch: 120 }]
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, ws, 'Cronograma')
  XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones')
  return libro
}

export const nombreArchivo = (prefijo: string, frente: string, ext: string, fecha: string) =>
  `${prefijo}-${frente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${fecha}.${ext}`

export function descargarLibro(libro: XLSX.WorkBook, archivo: string) {
  XLSX.writeFile(libro, archivo)
}

export const libroABuffer = (libro: XLSX.WorkBook): ArrayBuffer => XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

/** Contenido de un archivo seleccionado. Usa FileReader si el navegador no trae Blob.arrayBuffer. */
export function leerBytes(f: Blob): Promise<ArrayBuffer> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer()
  return new Promise((ok, mal) => {
    const r = new FileReader()
    r.onload = () => ok(r.result as ArrayBuffer)
    r.onerror = () => mal(r.error ?? new Error('No se pudo leer el archivo.'))
    r.readAsArrayBuffer(f)
  })
}
