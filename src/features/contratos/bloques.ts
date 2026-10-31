import PizZip from 'pizzip'

/**
 * Lee el Word ya lleno tal como está definido: estilos, numeración automática, negritas parciales, sangrías, tablas,
 * encabezados, pies, imágenes y tamaño de página. Alimenta la vista previa y el PDF. Lo que no se puede conservar se informa en `avisos`.
 */

export type Alinear = 'izq' | 'centro' | 'der' | 'justificado'
export type FuentePdf = 'helvetica' | 'times' | 'courier'
export type Rgb = [number, number, number]

export interface ImagenDoc {
  dataUrl: string
  formato: 'PNG' | 'JPEG'
  ancho: number
  alto: number
  /** Imagen flotante: se coloca en su posición sin mover el texto. */
  flotante?: { x: number; y: number; relX: string; relY: string; alinearX?: string }
}

export interface Tramo {
  texto: string
  negrita: boolean
  cursiva: boolean
  subrayado: boolean
  tachado: boolean
  /** Tamaño en puntos. */
  tamano: number
  fuente: FuentePdf
  /** Ancho relativo de la fuente original frente a la del PDF. */
  escala: number
  /** Alto de línea de la fuente original, en múltiplos del tamaño. */
  interlinea: number
  color: Rgb | null
  fondo: Rgb | null
  posicion: 'normal' | 'super' | 'sub'
  campo?: 'PAGE' | 'NUMPAGES'
  imagen?: ImagenDoc
}

export interface BordeDoc { ancho: number; color: Rgb }
export interface TabDoc { pos: number; tipo: 'izq' | 'centro' | 'der'; relleno: 'punto' | 'linea' | null }

export interface Parrafo {
  tipo: 'parrafo'
  /** Texto del párrafo sin la numeración automática. */
  texto: string
  negrita: boolean
  alinear: Alinear
  nivel: 0 | 1 | 2
  lista: boolean
  etiqueta: Tramo | null
  sufijo: 'tab' | 'espacio' | 'nada'
  tramos: Tramo[]
  /** Formato de la marca de párrafo: da el alto a un párrafo vacío. */
  marca: Tramo
  izq: number
  der: number
  primera: number
  antes: number
  despues: number
  linea: { modo: 'auto' | 'exacto' | 'minimo'; valor: number }
  tabs: TabDoc[]
  tabDefecto: number
  conservarSiguiente: boolean
  conservarLineas: boolean
  contextual: boolean
  huerfanas: boolean
  estilo: string
  bordeArriba: BordeDoc | null
  bordeAbajo: BordeDoc | null
  fondo: Rgb | null
}

export interface CeldaDoc {
  bloques: Bloque[]
  columna: number
  span: number
  vmerge: 'inicio' | 'sigue' | null
  fondo: Rgb | null
  bordes: { arriba: BordeDoc | null; abajo: BordeDoc | null; izq: BordeDoc | null; der: BordeDoc | null }
  margenes: { arriba: number; abajo: number; izq: number; der: number }
  vAlign: 'arriba' | 'centro' | 'abajo'
}
export interface FilaDoc { celdas: CeldaDoc[]; altoRegla: { modo: 'exacto' | 'minimo'; valor: number } | null; cabecera: boolean; sinDividir: boolean }

export type Bloque =
  | Parrafo
  | { tipo: 'tabla'; filas: string[][]; columnas: number[]; sangria: number; alinear: 'izq' | 'centro' | 'der'; detalle: FilaDoc[] }
  | { tipo: 'salto'; siNoVacia?: boolean }

export interface PaginaDoc { ancho: number; alto: number; arriba: number; abajo: number; izq: number; der: number; encabezado: number; pie: number }
export type Variantes = { default?: Bloque[]; first?: Bloque[]; even?: Bloque[] }
export interface SeccionDoc { pagina: PaginaDoc; primeraDistinta: boolean; encabezados: Variantes; pies: Variantes; continua: boolean; bloques: Bloque[] }
export interface DocumentoWord { secciones: SeccionDoc[]; parImpares: boolean; bloques: Bloque[]; avisos: string[] }

const hijos = (el: Element) => Array.from(el.children)
const buscar = (el: Element | undefined | null, nombre: string) => (el ? hijos(el).find((x) => x.nodeName === nombre) : undefined)
const valor = (el: Element | undefined | null, attr = 'w:val') => el?.getAttribute(attr) ?? null
const activo = (el: Element | undefined) => !!el && !['0', 'false', 'off'].includes(valor(el) ?? '1')
const numero = (v: string | null) => { const n = v === null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined }
const twips = (v: string | null) => { const n = numero(v); return n === undefined ? undefined : n / 20 }
const color = (v: string | null): Rgb | undefined => (v && /^[0-9a-f]{6}$/i.test(v) ? [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)] : undefined)
const sinUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>

/** Las tres familias de un PDF estándar tienen las mismas medidas que Arial, Times New Roman y Courier New; el resto se aproxima ajustando el ancho. */
const FUENTES: [RegExp, FuentePdf, number, number, boolean][] = [
  [/^(arial|helvetica|liberation sans)/i, 'helvetica', 1, 1.15, true],
  [/^(times|liberation serif|tinos)/i, 'times', 1, 1.15, true],
  [/^(courier|liberation mono)/i, 'courier', 1, 1.133, true],
  [/^(calibri|carlito)/i, 'helvetica', 0.9, 1.22, false],
  [/^(cambria|caladea)/i, 'times', 1.03, 1.172, false],
  [/^georgia/i, 'times', 1.1, 1.136, false],
  [/^garamond/i, 'times', 0.93, 1.125, false],
  [/^(book antiqua|palatino)/i, 'times', 1.07, 1.2, false],
  [/^(verdana)/i, 'helvetica', 1.16, 1.215, false],
  [/^(tahoma|segoe|aptos)/i, 'helvetica', 0.98, 1.21, false],
  [/^(consolas|lucida console)/i, 'courier', 0.92, 1.17, false],
]
const SIMBOLOS = /^(symbol|wingdings|webdings)/i
const fuenteDe = (nombre: string) => {
  const f = FUENTES.find(([re]) => re.test(nombre))
  return f ? { fuente: f[1], escala: f[2], interlinea: f[3], exacta: f[4] } : { fuente: 'helvetica' as const, escala: 1, interlinea: 1.15, exacta: false }
}

interface Rpr { negrita?: boolean; cursiva?: boolean; subrayado?: boolean; tachado?: boolean; tamano?: number; fuenteNombre?: string; color?: Rgb; fondo?: Rgb; posicion?: Tramo['posicion']; mayus?: boolean; oculto?: boolean }
interface Ppr {
  jc?: Alinear; izq?: number; der?: number; primera?: number; antes?: number; despues?: number; linea?: Parrafo['linea']; tabs?: (TabDoc & { quitar?: boolean })[]
  numId?: string; ilvl?: number; conservarSiguiente?: boolean; conservarLineas?: boolean; contextual?: boolean; saltoAntes?: boolean; huerfanas?: boolean
  bordeArriba?: BordeDoc; bordeAbajo?: BordeDoc; fondo?: Rgb
}

const borde = (el: Element | undefined): BordeDoc | null | undefined => {
  if (!el) return undefined
  const v = valor(el)
  if (!v || v === 'nil' || v === 'none') return null
  return { ancho: Math.max((numero(valor(el, 'w:sz')) ?? 4) / 8, 0.25), color: color(valor(el, 'w:color')) ?? [0, 0, 0] }
}

const JC: Record<string, Alinear> = { center: 'centro', right: 'der', end: 'der', both: 'justificado', distribute: 'justificado', left: 'izq', start: 'izq' }

function leerPpr(ppr: Element | undefined): Ppr {
  if (!ppr) return {}
  const ind = buscar(ppr, 'w:ind')
  const sp = buscar(ppr, 'w:spacing')
  const num = buscar(ppr, 'w:numPr')
  const bdr = buscar(ppr, 'w:pBdr')
  const tabs = buscar(ppr, 'w:tabs')
  const shd = buscar(ppr, 'w:shd')
  const jc = valor(buscar(ppr, 'w:jc'))
  const h = twips(valor(ind, 'w:hanging'))
  const fl = twips(valor(ind, 'w:firstLine'))
  const line = numero(valor(sp, 'w:line'))
  const regla = valor(sp, 'w:lineRule')
  const flag = (n: string) => { const e = buscar(ppr, n); return e ? activo(e) : undefined }
  return sinUndefined<Ppr>({
    jc: jc ? JC[jc] : undefined,
    izq: twips(valor(ind, 'w:left') ?? valor(ind, 'w:start')),
    der: twips(valor(ind, 'w:right') ?? valor(ind, 'w:end')),
    primera: h !== undefined ? -h : fl,
    antes: valor(sp, 'w:beforeAutospacing') === '1' ? 14 : twips(valor(sp, 'w:before')),
    despues: valor(sp, 'w:afterAutospacing') === '1' ? 14 : twips(valor(sp, 'w:after')),
    linea: line === undefined ? undefined : regla === 'exact' ? { modo: 'exacto', valor: line / 20 } : regla === 'atLeast' ? { modo: 'minimo', valor: line / 20 } : { modo: 'auto', valor: line / 240 },
    tabs: tabs ? hijos(tabs).filter((t) => t.nodeName === 'w:tab').map((t) => {
      const v = valor(t)
      const rel = valor(t, 'w:leader')
      return { pos: twips(valor(t, 'w:pos')) ?? 0, tipo: v === 'right' || v === 'end' ? 'der' as const : v === 'center' ? 'centro' as const : 'izq' as const, relleno: rel === 'dot' || rel === 'middleDot' ? 'punto' as const : rel === 'underscore' || rel === 'hyphen' || rel === 'heavy' ? 'linea' as const : null, quitar: v === 'clear' }
    }) : undefined,
    numId: num ? valor(buscar(num, 'w:numId')) ?? undefined : undefined,
    ilvl: num ? numero(valor(buscar(num, 'w:ilvl'))) : undefined,
    conservarSiguiente: flag('w:keepNext'), conservarLineas: flag('w:keepLines'), contextual: flag('w:contextualSpacing'), saltoAntes: flag('w:pageBreakBefore'), huerfanas: flag('w:widowControl'),
    bordeArriba: borde(buscar(bdr ?? undefined, 'w:top')) ?? undefined, bordeAbajo: borde(buscar(bdr ?? undefined, 'w:bottom')) ?? undefined,
    fondo: color(valor(shd, 'w:fill')),
  })
}

const unirPpr = (a: Ppr, b: Ppr): Ppr => {
  const r = { ...a, ...b }
  if (a.tabs && b.tabs) {
    const m = new Map(a.tabs.map((t) => [t.pos, t]))
    for (const t of b.tabs) { if (t.quitar) m.delete(t.pos); else m.set(t.pos, t) }
    r.tabs = [...m.values()]
  }
  return r
}

/** Cifras en texto como las escribe Word en español. */
const ORDINALES = ['Primero', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo', 'Undécimo', 'Duodécimo', 'Decimotercero', 'Decimocuarto', 'Decimoquinto', 'Decimosexto', 'Decimoséptimo', 'Decimoctavo', 'Decimonoveno', 'Vigésimo']
const CARDINALES = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis', 'Siete', 'Ocho', 'Nueve', 'Diez', 'Once', 'Doce', 'Trece', 'Catorce', 'Quince', 'Dieciséis', 'Diecisiete', 'Dieciocho', 'Diecinueve', 'Veinte']
const romano = (n: number) => {
  let s = ''
  let v = n
  for (const [r, k] of [['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90], ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]] as [string, number][]) while (v >= k) { s += r; v -= k }
  return s
}
const letra = (n: number) => String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.floor((n - 1) / 26) + 1)
export function formatoNumero(n: number, f: string): string {
  switch (f) {
    case 'lowerLetter': return letra(n)
    case 'upperLetter': return letra(n).toUpperCase()
    case 'lowerRoman': return romano(n).toLowerCase()
    case 'upperRoman': return romano(n)
    case 'ordinal': return `${n}.º`
    case 'ordinalText': return ORDINALES[n - 1] ?? `${n}.º`
    case 'cardinalText': return CARDINALES[n - 1] ?? String(n)
    case 'decimalZero': return n < 10 ? `0${n}` : String(n)
    case 'none': return ''
    default: return String(n)
  }
}

/** Solo estos caracteres existen en las fuentes de un PDF estándar. */
const WIN_ANSI = /[^\t\n -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g
const SUSTITUTOS: Record<string, string> = { '‐': '-', '‑': '-', '‒': '-', '―': '—', '−': '-', '•': '•', '●': '•', '▪': '•', '→': '->', '≥': '>=', '≤': '<=' }

export function documentoDeDocx(contenido: ArrayBuffer | Uint8Array): DocumentoWord {
  const zip = new PizZip(contenido)
  const xml = (ruta: string) => { const f = zip.file(ruta); return f ? new DOMParser().parseFromString(f.asText(), 'application/xml') : null }
  const principal = xml('word/document.xml')
  if (!principal) throw new Error('El archivo no es un documento de Word válido.')
  const cuerpo = principal.getElementsByTagName('w:body')[0]
  if (!cuerpo) throw new Error('El documento no tiene contenido.')

  const avisos = new Set<string>()

  // Fuentes del tema («Títulos» y «Cuerpo» de Word).
  const tema = xml('word/theme/theme1.xml')
  const fuenteTema = (grupo: string) => { const g = tema?.getElementsByTagName(grupo)[0]; return g ? valor(buscar(g, 'a:latin'), 'typeface') ?? undefined : undefined }
  const menor = fuenteTema('a:minorFont')
  const mayor = fuenteTema('a:majorFont')

  const leerRpr = (rpr: Element | undefined): Rpr => {
    if (!rpr) return {}
    const f = buscar(rpr, 'w:rFonts')
    const t = valor(f, 'w:asciiTheme')
    const u = buscar(rpr, 'w:u')
    const flag = (n: string) => { const e = buscar(rpr, n); return e ? activo(e) : undefined }
    const va = valor(buscar(rpr, 'w:vertAlign'))
    const caps = buscar(rpr, 'w:caps') ?? buscar(rpr, 'w:smallCaps')
    return sinUndefined<Rpr>({
      negrita: flag('w:b'), cursiva: flag('w:i'), subrayado: u ? valor(u) !== 'none' : undefined, tachado: flag('w:strike'),
      tamano: (() => { const v = numero(valor(buscar(rpr, 'w:sz'))); return v === undefined ? undefined : v / 2 })(),
      fuenteNombre: (t ? (t.startsWith('major') ? mayor : menor) : undefined) ?? valor(f, 'w:ascii') ?? valor(f, 'w:hAnsi') ?? undefined,
      color: color(valor(buscar(rpr, 'w:color'))), fondo: color(valor(buscar(rpr, 'w:shd'), 'w:fill')),
      posicion: va === 'superscript' ? 'super' : va === 'subscript' ? 'sub' : undefined,
      mayus: caps ? activo(caps) : undefined, oculto: flag('w:vanish'),
    })
  }

  // Estilos, con su herencia.
  const stylesDoc = xml('word/styles.xml')
  const estilos = new Map<string, Element>()
  let porDefecto: { p?: string; t?: string } = {}
  for (const s of Array.from(stylesDoc?.getElementsByTagName('w:style') ?? [])) {
    const id = valor(s, 'w:styleId')
    if (!id) continue
    estilos.set(id, s)
    if (activo(s.getAttributeNode('w:default') ? s : undefined) && valor(s, 'w:default') === '1') {
      const tipo = valor(s, 'w:type')
      if (tipo === 'paragraph') porDefecto = { ...porDefecto, p: id }
      if (tipo === 'table') porDefecto = { ...porDefecto, t: id }
    }
  }
  const cadena = (id: string | null | undefined): Element[] => {
    const out: Element[] = []
    const vistos = new Set<string>()
    let actual = id ?? null
    while (actual && !vistos.has(actual)) {
      vistos.add(actual)
      const s = estilos.get(actual)
      if (!s) break
      out.unshift(s)
      actual = valor(buscar(s, 'w:basedOn'))
    }
    return out
  }
  const defectos = stylesDoc?.getElementsByTagName('w:docDefaults')[0]
  const rprDefecto = leerRpr(buscar(buscar(defectos, 'w:rPrDefault'), 'w:rPr'))
  const pprDefecto = leerPpr(buscar(buscar(defectos, 'w:pPrDefault'), 'w:pPr'))
  const rprDeEstilos = (ids: (string | null | undefined)[]) => ids.flatMap(cadena).reduce<Rpr>((acc, s) => ({ ...acc, ...leerRpr(buscar(s, 'w:rPr')) }), {})
  const pprDeEstilos = (ids: (string | null | undefined)[]) => ids.flatMap(cadena).reduce<Ppr>((acc, s) => unirPpr(acc, leerPpr(buscar(s, 'w:pPr'))), {})

  const ajustes = xml('word/settings.xml')
  const parImpares = !!ajustes?.getElementsByTagName('w:evenAndOddHeaders')[0]
  const tabDefecto = twips(valor(ajustes?.getElementsByTagName('w:defaultTabStop')[0])) ?? 36
  const modoCompat = (() => {
    for (const c of Array.from(ajustes?.getElementsByTagName('w:compatSetting') ?? [])) if (valor(c, 'w:name') === 'compatibilityMode') return numero(valor(c)) ?? 12
    return ajustes?.getElementsByTagName('w:compat')[0] ? 12 : 15
  })()

  // Numeración automática.
  const numeracionDoc = xml('word/numbering.xml')
  const abstractos = new Map<string, Element>()
  const nums = new Map<string, Element>()
  if (numeracionDoc?.documentElement) {
    for (const n of hijos(numeracionDoc.documentElement)) {
      if (n.nodeName === 'w:abstractNum') abstractos.set(valor(n, 'w:abstractNumId') ?? '', n)
      if (n.nodeName === 'w:num') nums.set(valor(n, 'w:numId') ?? '', n)
    }
  }
  const abstractoDe = (numId: string) => {
    const a = abstractos.get(valor(buscar(nums.get(numId), 'w:abstractNumId')) ?? '')
    const ligado = valor(buscar(a, 'w:numStyleLink'))
    if (!ligado) return a
    const ppr = buscar(estilos.get(ligado), 'w:pPr')
    const num = valor(buscar(buscar(ppr, 'w:numPr'), 'w:numId'))
    return num ? abstractos.get(valor(buscar(nums.get(num), 'w:abstractNumId')) ?? '') : a
  }
  const nivelDe = (numId: string, ilvl: number) => {
    const over = hijos(nums.get(numId) ?? cuerpo).find((o) => o.nodeName === 'w:lvlOverride' && valor(o, 'w:ilvl') === String(ilvl))
    const propio = buscar(over, 'w:lvl')
    if (propio) return propio
    return hijos(abstractoDe(numId) ?? cuerpo).find((l) => l.nodeName === 'w:lvl' && valor(l, 'w:ilvl') === String(ilvl))
  }
  const nuevaNumeracion = () => {
    const contadores = new Map<Element, Map<number, number>>()
    const iniciados = new Set<string>()
    return (numId: string, ilvl: number): string | null => {
      const abs = abstractoDe(numId)
      const lvl = nivelDe(numId, ilvl)
      if (!abs || !lvl) return null
      const c = contadores.get(abs) ?? new Map<number, number>()
      contadores.set(abs, c)
      const inicioDe = (l: number) => numero(valor(buscar(nivelDe(numId, l), 'w:start'))) ?? 1
      for (const o of hijos(nums.get(numId) ?? cuerpo)) {
        if (o.nodeName !== 'w:lvlOverride') continue
        const l = numero(valor(o, 'w:ilvl')) ?? 0
        const inicio = numero(valor(buscar(o, 'w:startOverride')))
        const clave = `${numId}:${l}`
        if (inicio !== undefined && !iniciados.has(clave)) { iniciados.add(clave); c.set(l, inicio - 1); if (l !== ilvl) c.delete(l) }
      }
      c.set(ilvl, c.has(ilvl) ? c.get(ilvl)! + 1 : inicioDe(ilvl))
      for (let l = ilvl + 1; l < 9; l++) {
        const reinicio = numero(valor(buscar(nivelDe(numId, l), 'w:lvlRestart')))
        if (reinicio === 0) continue
        if (reinicio === undefined || ilvl < reinicio) c.delete(l)
      }
      const legal = !!buscar(lvl, 'w:isLgl')
      return (valor(buscar(lvl, 'w:lvlText')) ?? '').replace(/%([1-9])/g, (_, d: string) => {
        const l = Number(d) - 1
        const f = valor(buscar(nivelDe(numId, l), 'w:numFmt')) ?? 'decimal'
        return formatoNumero(c.get(l) ?? inicioDe(l), legal && f !== 'bullet' ? 'decimal' : f)
      })
    }
  }

  const limpiarTexto = (t: string) => t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‍﻿­]/g, '').replace(WIN_ANSI, (c) => {
    if (SUSTITUTOS[c]) return SUSTITUTOS[c]
    if (/[-]/.test(c)) return '•'
    avisos.add(`El carácter «${c}» no existe en las fuentes del PDF: revisa ese punto en el Word.`)
    return '?'
  })

  const tramoDe = (r: Rpr, texto: string): Tramo => {
    const nombre = r.fuenteNombre ?? 'Times New Roman'
    const simbolo = SIMBOLOS.test(nombre)
    const f = fuenteDe(simbolo ? 'Arial' : nombre)
    if (!f.exacta && !simbolo) avisos.add(`La fuente «${nombre}» se reemplaza en el PDF por una de medidas ajustadas: los saltos de línea pueden variar. El Word la conserva.`)
    return {
      texto: r.mayus ? texto.toLocaleUpperCase('es') : texto, negrita: !!r.negrita, cursiva: !!r.cursiva, subrayado: !!r.subrayado, tachado: !!r.tachado,
      tamano: r.tamano ?? 10, fuente: f.fuente, escala: f.escala, interlinea: f.interlinea, color: r.color ?? null, fondo: r.fondo ?? null, posicion: r.posicion ?? 'normal',
    }
  }

  const relaciones = (ruta: string) => {
    const carpeta = ruta.slice(0, ruta.lastIndexOf('/') + 1)
    const nombre = ruta.slice(ruta.lastIndexOf('/') + 1)
    const d = xml(`${carpeta}_rels/${nombre}.rels`)
    const m = new Map<string, string>()
    for (const r of Array.from(d?.getElementsByTagName('Relationship') ?? [])) {
      const t = r.getAttribute('Target') ?? ''
      const destino = t.startsWith('/') ? t.slice(1) : (() => {
        const partes = `${carpeta}${t}`.split('/')
        const salida: string[] = []
        for (const p of partes) { if (p === '..') salida.pop(); else if (p !== '.') salida.push(p) }
        return salida.join('/')
      })()
      m.set(r.getAttribute('Id') ?? '', destino)
    }
    return m
  }

  const imagenDe = (destino: string | undefined, ancho: number, alto: number, flotante?: ImagenDoc['flotante']): ImagenDoc | null => {
    if (!destino) return null
    const f = zip.file(destino)
    const ext = destino.split('.').pop()?.toLowerCase() ?? ''
    const formato = ext === 'png' ? 'PNG' as const : ext === 'jpg' || ext === 'jpeg' ? 'JPEG' as const : null
    if (!f || !formato) { avisos.add(`Una imagen en formato ${ext || 'desconocido'} no se puede pasar al PDF: guárdala en el Word como PNG o JPG.`); return null }
    const bytes = f.asUint8Array()
    let bin = ''
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return { dataUrl: `data:image/${formato === 'PNG' ? 'png' : 'jpeg'};base64,${btoa(bin)}`, formato, ancho, alto, flotante }
  }

  interface Parte { rels: Map<string, string>; numerar: (numId: string, ilvl: number) => string | null; campo: { fase: 'instr' | 'resultado'; instr: string; omitir: boolean } | null }

  const parrafoDe = (p: Element, parte: Parte, estiloTabla: string | null): Bloque[] => {
    const ppr = buscar(p, 'w:pPr')
    const estilo = valor(buscar(ppr, 'w:pStyle')) ?? porDefecto.p ?? null
    const directo = leerPpr(ppr)
    const delEstilo = pprDeEstilos([estiloTabla, estilo])
    let numId = directo.numId ?? delEstilo.numId
    const ilvlBase = directo.ilvl ?? delEstilo.ilvl
    if (numId === '0' || !numId || !nums.has(numId)) numId = undefined
    let ilvl = ilvlBase ?? 0
    if (numId && ilvlBase === undefined && estilo) {
      const enlazado = hijos(abstractoDe(numId) ?? cuerpo).find((l) => l.nodeName === 'w:lvl' && valor(buscar(l, 'w:pStyle')) === estilo)
      if (enlazado) ilvl = numero(valor(enlazado, 'w:ilvl')) ?? 0
    }
    const lvl = numId ? nivelDe(numId, ilvl) : undefined
    const pp = unirPpr(unirPpr(unirPpr(pprDefecto, delEstilo), leerPpr(buscar(lvl, 'w:pPr'))), directo)

    const rprEstilos = { ...rprDefecto, ...rprDeEstilos([estiloTabla, estilo]) }
    const rprMarca = { ...rprEstilos, ...leerRpr(buscar(ppr, 'w:rPr')) }
    const marca = tramoDe(rprMarca, '')

    const segmentos: Tramo[][] = [[]]
    const extras: Bloque[] = []
    const emitir = (t: Tramo) => { segmentos.at(-1)!.push(t) }

    const visitarRun = (r: Element) => {
      const rpr = buscar(r, 'w:rPr')
      const rs = { ...rprEstilos, ...rprDeEstilos([valor(buscar(rpr, 'w:rStyle'))]), ...leerRpr(rpr) }
      if (rs.oculto) return
      const texto = (s: string) => { if (s) emitir(tramoDe(rs, limpiarTexto(s))) }
      const dibujo = (el: Element) => {
        const blip = el.getElementsByTagName('a:blip')[0]
        const cajas = Array.from(el.getElementsByTagName('w:txbxContent'))
        if (cajas.length) { for (const c of cajas) visitar(hijos(c), extras, parte, estiloTabla); return }
        if (!blip) { avisos.add('El Word tiene una forma o dibujo que no se pasa al PDF.'); return }
        const anc = buscar(el, 'wp:anchor')
        const ext = buscar(anc ?? buscar(el, 'wp:inline'), 'wp:extent')
        const w = (numero(valor(ext, 'cx')) ?? 0) / 12700
        const h = (numero(valor(ext, 'cy')) ?? 0) / 12700
        const pos = (n: string) => { const e = buscar(anc, n); return { rel: valor(e, 'relativeFrom') ?? 'margin', off: (numero(buscar(e, 'wp:posOffset')?.textContent ?? null) ?? 0) / 12700, al: buscar(e, 'wp:align')?.textContent ?? undefined } }
        const ph = pos('wp:positionH')
        const pv = pos('wp:positionV')
        const img = imagenDe(parte.rels.get(valor(blip, 'r:embed') ?? ''), w, h, anc ? { x: ph.off, y: pv.off, relX: ph.rel, relY: pv.rel, alinearX: ph.al } : undefined)
        if (img) emitir({ ...tramoDe(rs, ''), imagen: img })
      }
      for (const c of hijos(r)) {
        const n = c.nodeName
        if (n === 'w:fldChar') {
          const t = valor(c, 'w:fldCharType')
          if (t === 'begin') parte.campo = { fase: 'instr', instr: '', omitir: false }
          else if (parte.campo && (t === 'separate' || t === 'end')) {
            if (parte.campo.fase === 'instr') {
              const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(parte.campo.instr)
              if (m) { emitir({ ...tramoDe(rs, ''), campo: m[1].toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES' }); parte.campo.omitir = true }
            }
            parte.campo.fase = 'resultado'
            if (t === 'end') parte.campo = null
          }
          continue
        }
        if (n === 'w:instrText') { if (parte.campo?.fase === 'instr') parte.campo.instr += c.textContent ?? ''; continue }
        if (parte.campo && (parte.campo.fase === 'instr' || parte.campo.omitir)) continue
        if (n === 'w:t') texto(c.textContent ?? '')
        else if (n === 'w:tab' || n === 'w:ptab') texto('\t')
        else if (n === 'w:noBreakHyphen') texto('-')
        else if (n === 'w:cr') texto('\n')
        else if (n === 'w:sym') { texto('•'); avisos.add('El Word tiene símbolos especiales que el PDF muestra como una viñeta.') }
        else if (n === 'w:br') {
          if (valor(c, 'w:type') === 'page') segmentos.push([])
          else if (valor(c, 'w:type') !== 'column') texto('\n')
        }
        else if (n === 'w:drawing') dibujo(c)
        else if (n === 'mc:AlternateContent') { const a = buscar(c, 'mc:Choice') ?? buscar(c, 'mc:Fallback'); if (a) for (const d of hijos(a)) { if (d.nodeName === 'w:drawing') dibujo(d); else if (d.nodeName === 'w:pict') pict(d) } }
        else if (n === 'w:pict') pict(c)
        else if (n === 'w:object') avisos.add('El Word tiene un objeto incrustado que no se pasa al PDF.')
        else if (n === 'w:footnoteReference' || n === 'w:endnoteReference') avisos.add('El Word tiene notas al pie: el PDF no las incluye. Pásalas al texto si deben constar.')
      }
    }
    const pict = (el: Element) => {
      const cajas = Array.from(el.getElementsByTagName('w:txbxContent'))
      if (cajas.length) { for (const c of cajas) visitar(hijos(c), extras, parte, estiloTabla); return }
      avisos.add('El Word tiene una imagen o forma antigua que no se pasa al PDF.')
    }
    const recorrer = (el: Element) => {
      for (const c of hijos(el)) {
        const n = c.nodeName
        if (n === 'w:r') visitarRun(c)
        else if (n === 'w:hyperlink' || n === 'w:ins' || n === 'w:smartTag' || n === 'w:customXml' || n === 'w:moveTo') recorrer(c)
        else if (n === 'w:sdt') { const s = buscar(c, 'w:sdtContent'); if (s) recorrer(s) }
        else if (n === 'w:fldSimple') {
          const m = /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(valor(c, 'w:instr') ?? '')
          if (m) emitir({ ...tramoDe(rprEstilos, ''), campo: m[1].toUpperCase() === 'PAGE' ? 'PAGE' : 'NUMPAGES' })
          else recorrer(c)
        }
      }
    }
    recorrer(p)

    const textoLvl = numId ? parte.numerar(numId, ilvl) : null
    const rprLvl = leerRpr(buscar(lvl, 'w:rPr'))
    const formatoLvl = valor(buscar(lvl, 'w:numFmt'))
    const etiqueta = textoLvl !== null && textoLvl !== '' ? tramoDe({ ...rprMarca, ...rprLvl }, formatoLvl === 'bullet' ? limpiarTexto(textoLvl).replace(/^[^\s•\-o–—*>]+$/, '•') : limpiarTexto(textoLvl)) : null
    const suf = valor(buscar(lvl, 'w:suff'))

    const nombreEstilo = estilo ? valor(buscar(estilos.get(estilo), 'w:name')) ?? estilo : ''
    const nivelM = /^(?:Heading|T[ií]tulo|Ttulo)\s*(\d)/i.exec(estilo ?? '') ?? /^(?:heading|t[ií]tulo)\s*(\d)/i.exec(nombreEstilo)
    const nivel: 0 | 1 | 2 = /^(Title|T[ií]tulo)$/i.test(estilo ?? '') ? 1 : nivelM ? (Number(nivelM[1]) <= 1 ? 1 : 2) : 0

    const crear = (tramos: Tramo[], primero: boolean): Parrafo => {
      const conTexto = tramos.filter((t) => t.texto.trim())
      return {
        tipo: 'parrafo', texto: tramos.map((t) => t.texto.replace(/\t/g, '    ')).join(''), negrita: conTexto.length > 0 && conTexto.every((t) => t.negrita),
        alinear: pp.jc ?? 'izq', nivel, lista: !!etiqueta && primero, etiqueta: primero ? etiqueta : null, sufijo: suf === 'space' ? 'espacio' : suf === 'nothing' ? 'nada' : 'tab',
        tramos, marca, izq: pp.izq ?? 0, der: pp.der ?? 0, primera: primero ? pp.primera ?? 0 : 0, antes: pp.antes ?? 0, despues: pp.despues ?? 0,
        linea: pp.linea ?? { modo: 'auto', valor: 1 }, tabs: (pp.tabs ?? []).filter((t) => !t.quitar).map(({ pos, tipo, relleno }) => ({ pos, tipo, relleno })).sort((a, b) => a.pos - b.pos), tabDefecto,
        conservarSiguiente: !!pp.conservarSiguiente, conservarLineas: !!pp.conservarLineas, contextual: !!pp.contextual, huerfanas: pp.huerfanas !== false, estilo: estilo ?? '',
        bordeArriba: pp.bordeArriba ?? null, bordeAbajo: pp.bordeAbajo ?? null, fondo: pp.fondo ?? null,
      }
    }

    const salida: Bloque[] = []
    if (pp.saltoAntes) salida.push({ tipo: 'salto', siNoVacia: true })
    segmentos.forEach((s, i) => {
      if (i > 0) salida.push({ tipo: 'salto' })
      // Un salto de página al final del párrafo no deja un renglón vacío en la hoja siguiente.
      if (i === 0 || s.length || i < segmentos.length - 1) salida.push(crear(s, i === 0))
    })
    salida.push(...extras)
    return salida
  }

  const tablaDe = (t: Element, parte: Parte): Bloque => {
    const tblPr = buscar(t, 'w:tblPr')
    const estiloTabla = valor(buscar(tblPr, 'w:tblStyle')) ?? porDefecto.t ?? null
    const prs = [...cadena(estiloTabla).map((s) => buscar(s, 'w:tblPr')), tblPr].filter((e): e is Element => !!e)
    const bordesTabla: Record<string, BordeDoc | null> = {}
    const mar = { arriba: 0, abajo: 0, izq: 0, der: 0 }
    for (const pr of prs) {
      for (const b of hijos(buscar(pr, 'w:tblBorders') ?? cuerpo)) { if (b.nodeName.startsWith('w:')) { const v = borde(b); if (v !== undefined) bordesTabla[b.nodeName.slice(2)] = v } }
      const m = buscar(pr, 'w:tblCellMar')
      if (m) {
        const lee = (n: string, alt?: string) => twips(valor(buscar(m, n) ?? (alt ? buscar(m, alt) : undefined), 'w:w'))
        mar.arriba = lee('w:top') ?? mar.arriba; mar.abajo = lee('w:bottom') ?? mar.abajo
        mar.izq = lee('w:left', 'w:start') ?? mar.izq; mar.der = lee('w:right', 'w:end') ?? mar.der
      }
    }
    const columnas = hijos(buscar(t, 'w:tblGrid') ?? cuerpo).filter((c) => c.nodeName === 'w:gridCol').map((c) => twips(valor(c, 'w:w')) ?? 0)
    const trs = hijos(t).filter((x) => x.nodeName === 'w:tr')
    const totalCols = columnas.length || Math.max(1, ...trs.map((tr) => hijos(tr).filter((c) => c.nodeName === 'w:tc').reduce((s, c) => s + (numero(valor(buscar(buscar(c, 'w:tcPr'), 'w:gridSpan'))) ?? 1), 0)))
    const detalle: FilaDoc[] = trs.map((tr, ir) => {
      const trPr = buscar(tr, 'w:trPr')
      let col = numero(valor(buscar(trPr, 'w:gridBefore'))) ?? 0
      const tcs = hijos(tr).filter((c) => c.nodeName === 'w:tc')
      const celdas = tcs.map((tc): CeldaDoc => {
        const pr = buscar(tc, 'w:tcPr')
        const span = numero(valor(buscar(pr, 'w:gridSpan'))) ?? 1
        const vm = buscar(pr, 'w:vMerge')
        const bd = buscar(pr, 'w:tcBorders')
        const lado = (n: string, alt: string | null, interior: string, enBorde: boolean) => {
          const propio = borde(buscar(bd, n) ?? (alt ? buscar(bd, alt) : undefined))
          if (propio !== undefined) return propio
          return bordesTabla[enBorde ? n.slice(2) : interior] ?? (enBorde && alt ? bordesTabla[alt.slice(2)] : undefined) ?? null
        }
        const tm = buscar(pr, 'w:tcMar')
        const leeM = (n: string, alt?: string) => twips(valor(buscar(tm, n) ?? (alt ? buscar(tm, alt) : undefined), 'w:w'))
        const va = valor(buscar(pr, 'w:vAlign'))
        const c: CeldaDoc = {
          bloques: [], columna: col, span, vmerge: vm ? (valor(vm) === 'restart' ? 'inicio' : 'sigue') : null,
          fondo: color(valor(buscar(pr, 'w:shd'), 'w:fill')) ?? null,
          bordes: {
            arriba: lado('w:top', null, 'insideH', ir === 0), abajo: lado('w:bottom', null, 'insideH', ir === trs.length - 1),
            izq: lado('w:left', 'w:start', 'insideV', col === 0), der: lado('w:right', 'w:end', 'insideV', col + span >= totalCols),
          },
          margenes: { arriba: leeM('w:top') ?? mar.arriba, abajo: leeM('w:bottom') ?? mar.abajo, izq: leeM('w:left', 'w:start') ?? mar.izq, der: leeM('w:right', 'w:end') ?? mar.der },
          vAlign: va === 'center' ? 'centro' : va === 'bottom' ? 'abajo' : 'arriba',
        }
        visitar(hijos(tc), c.bloques, parte, estiloTabla)
        col += span
        return c
      })
      const h = buscar(trPr, 'w:trHeight')
      const hv = twips(valor(h))
      return { celdas, altoRegla: hv ? { modo: valor(h, 'w:hRule') === 'exact' ? 'exacto' : 'minimo', valor: hv } : null, cabecera: !!buscar(trPr, 'w:tblHeader'), sinDividir: !!buscar(trPr, 'w:cantSplit') }
    })
    const textoCelda = (c: CeldaDoc) => c.bloques.flatMap((b) => (b.tipo === 'parrafo' ? [`${b.etiqueta ? `${b.etiqueta.texto} ` : ''}${b.texto}`] : [])).filter((x) => x.trim()).join('\n')
    const filas = detalle.map((f) => f.celdas.map(textoCelda)).filter((f) => f.some((c) => c.trim()))
    const jc = valor(buscar(tblPr, 'w:jc'))
    return {
      tipo: 'tabla', filas, columnas, detalle,
      sangria: (twips(valor(buscar(tblPr, 'w:tblInd'), 'w:w')) ?? 0) - (modoCompat < 15 ? mar.izq : 0),
      alinear: jc === 'center' ? 'centro' : jc === 'right' || jc === 'end' ? 'der' : 'izq',
    }
  }

  const visitar = (nodos: Element[], salida: Bloque[], parte: Parte, estiloTabla: string | null, alFinalSeccion?: (sect: Element) => void) => {
    for (const n of nodos) {
      if (n.nodeName === 'w:p') {
        salida.push(...parrafoDe(n, parte, estiloTabla))
        const sect = buscar(buscar(n, 'w:pPr'), 'w:sectPr')
        if (sect && alFinalSeccion) alFinalSeccion(sect)
      } else if (n.nodeName === 'w:tbl') salida.push(tablaDe(n, parte))
      else if (n.nodeName === 'w:sdt' || n.nodeName === 'w:customXml') { const c = n.nodeName === 'w:sdt' ? buscar(n, 'w:sdtContent') : n; if (c) visitar(hijos(c), salida, parte, estiloTabla, alFinalSeccion) }
    }
  }

  // Encabezados y pies.
  const relsCuerpo = relaciones('word/document.xml')
  const cacheParte = new Map<string, Bloque[]>()
  const parteExterna = (id: string | null, raiz: string): Bloque[] | undefined => {
    const destino = relsCuerpo.get(id ?? '')
    if (!destino) return undefined
    const hecho = cacheParte.get(destino)
    if (hecho) return hecho
    const d = xml(destino)
    const r = d?.getElementsByTagName(raiz)[0]
    if (!r) return undefined
    const salida: Bloque[] = []
    visitar(hijos(r), salida, { rels: relaciones(destino), numerar: nuevaNumeracion(), campo: null }, null)
    cacheParte.set(destino, salida)
    return salida
  }

  const secciones: SeccionDoc[] = []
  let previoEnc: Variantes = {}
  let previoPie: Variantes = {}
  const cerrarSeccion = (sect: Element | undefined, bloques: Bloque[]) => {
    const sz = buscar(sect, 'w:pgSz')
    const mg = buscar(sect, 'w:pgMar')
    const leer = (n: string, d: number) => { const v = twips(valor(mg, n)); return v === undefined ? d : Math.abs(v) }
    const pagina: PaginaDoc = {
      ancho: twips(valor(sz, 'w:w')) ?? 595.3, alto: twips(valor(sz, 'w:h')) ?? 841.9,
      arriba: leer('w:top', 72), abajo: leer('w:bottom', 72), izq: leer('w:left', 72) + (twips(valor(mg, 'w:gutter')) ?? 0), der: leer('w:right', 72),
      encabezado: leer('w:header', 36), pie: leer('w:footer', 36),
    }
    const enc: Variantes = { ...previoEnc }
    const pie: Variantes = { ...previoPie }
    for (const c of hijos(sect ?? cuerpo)) {
      const v = valor(c, 'w:type') as keyof Variantes | null
      if (!v) continue
      if (c.nodeName === 'w:headerReference') enc[v] = parteExterna(valor(c, 'r:id'), 'w:hdr')
      if (c.nodeName === 'w:footerReference') pie[v] = parteExterna(valor(c, 'r:id'), 'w:ftr')
    }
    previoEnc = enc
    previoPie = pie
    if (Number(valor(buscar(sect, 'w:cols'), 'w:num') ?? 1) > 1) avisos.add('El Word usa varias columnas: el PDF las muestra en una sola.')
    secciones.push({ pagina, primeraDistinta: !!buscar(sect, 'w:titlePg'), encabezados: enc, pies: pie, continua: valor(buscar(sect, 'w:type')) === 'continuous', bloques })
  }

  const parteCuerpo: Parte = { rels: relsCuerpo, numerar: nuevaNumeracion(), campo: null }
  let actual: Bloque[] = []
  visitar(hijos(cuerpo), actual, parteCuerpo, null, (sect) => { cerrarSeccion(sect, actual); actual = [] })
  cerrarSeccion(buscar(cuerpo, 'w:sectPr'), actual)

  return { secciones, parImpares, bloques: secciones.flatMap((s) => s.bloques), avisos: [...avisos] }
}

export const bloquesDeDocx = (contenido: ArrayBuffer | Uint8Array): Bloque[] => documentoDeDocx(contenido).bloques
