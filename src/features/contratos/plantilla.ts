import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { MIME_DOCX, type CampoCatalogo, type VariablePlantilla } from './model'

/**
 * Llenado de plantillas Word. El archivo de Legal se conserva tal cual (estilos, tablas, numeración, encabezados y pies):
 * solo se reemplazan las etiquetas {campo}. Los bucles se escriben {#pago.cuotas} … {/pago.cuotas}.
 */

type Alcance = Record<string, unknown>

/** Resolución de {a.b.c} y de {.}, buscando primero en el ámbito del bucle y después en los exteriores. */
const analizador = (tag: string) => ({
  get(scope: unknown, contexto?: { scopeList?: unknown[] }) {
    if (tag === '.') return scope
    const camino = tag.split('.')
    const lista = contexto?.scopeList?.length ? contexto.scopeList : [scope]
    for (let i = lista.length - 1; i >= 0; i--) {
      let v: unknown = lista[i]
      let ok = true
      for (const k of camino) {
        if (v !== null && typeof v === 'object' && k in (v as Alcance)) v = (v as Alcance)[k]
        else { ok = false; break }
      }
      if (ok) return v
    }
    return undefined
  },
})

export class ErrorPlantilla extends Error {
  detalles: string[]
  constructor(mensaje: string, detalles: string[] = []) {
    super(mensaje)
    this.name = 'ErrorPlantilla'
    this.detalles = detalles
  }
}

function abrir(contenido: ArrayBuffer | Uint8Array): PizZip {
  try {
    const zip = new PizZip(contenido)
    if (!zip.file('word/document.xml')) throw new Error('sin documento')
    return zip
  } catch {
    throw new ErrorPlantilla('El archivo no es un documento de Word (.docx) válido.')
  }
}

function explicar(e: unknown): ErrorPlantilla {
  const err = e as { properties?: { errors?: { properties?: { explanation?: string; id?: string } }[] }; message?: string }
  const lista = err.properties?.errors?.map((x) => x.properties?.explanation ?? x.properties?.id ?? '').filter(Boolean) ?? []
  return new ErrorPlantilla(lista.length ? 'La plantilla tiene etiquetas mal escritas. Corrígelas en el Word y vuelve a subirlo.' : 'No se pudo completar la plantilla.', lista.length ? lista : [err.message ?? ''])
}

function crear(zip: PizZip) {
  try {
    return new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' }, parser: analizador, nullGetter: () => '' })
  } catch (e) {
    throw explicar(e)
  }
}

export interface Etiquetas { variables: string[]; bucles: string[] }

/** Etiquetas de la plantilla: variables sueltas y bucles (la lista que se repite). Lo que va dentro de un bucle son campos de cada elemento. */
export function extraerEtiquetas(contenido: ArrayBuffer | Uint8Array): Etiquetas {
  const zip = abrir(contenido)
  const doc = crear(zip)
  const archivos = Object.keys(zip.files).filter((n) => n === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(n))
  const variables = new Set<string>()
  const bucles = new Set<string>()
  for (const archivo of archivos) {
    const texto = doc.getFullText(archivo)
    const pila: string[] = []
    for (const m of texto.matchAll(/\{([#^/]?)\s*([^{}\s]+?)\s*\}/g)) {
      const [, marca, nombre] = m
      if (marca === '#' || marca === '^') { if (!pila.length) bucles.add(nombre); pila.push(nombre) }
      else if (marca === '/') { pila.pop() }
      else if (!pila.length) variables.add(nombre)
    }
  }
  return { variables: [...variables], bucles: [...bucles] }
}

/** Variables sugeridas para configurar: las del catálogo quedan vinculadas al CRM; las demás se piden al generar. */
export function variablesSugeridas(et: Etiquetas, catalogo: CampoCatalogo[]): VariablePlantilla[] {
  const claves = new Set(catalogo.map((c) => c.clave))
  const etiqueta = new Map(catalogo.map((c) => [c.clave, c.etiqueta]))
  const todas = [...new Set([...et.variables, ...et.bucles])]
  return todas.map((clave) => ({
    clave, etiqueta: etiqueta.get(clave) ?? clave.replace(/_/g, ' '), origen: claves.has(clave) ? 'catalogo' : 'manual', obligatorio: true,
  }))
}

export interface DocumentoLleno { docx: Uint8Array; texto: string }

/** Rellena el Word con los datos. Lo que falta en los datos queda en blanco: el servidor ya verificó que no falte nada obligatorio. */
export function llenarPlantilla(contenido: ArrayBuffer | Uint8Array, datos: Alcance): DocumentoLleno {
  const zip = abrir(contenido)
  const doc = crear(zip)
  try {
    doc.render(datos)
  } catch (e) {
    throw explicar(e)
  }
  const salida = doc.getZip().generate({ type: 'uint8array', mimeType: MIME_DOCX, compression: 'DEFLATE' }) as Uint8Array
  return { docx: salida, texto: doc.getFullText() }
}

/** Mismo análisis para una plantilla escrita como texto. */
export function etiquetasDeTexto(texto: string): Etiquetas {
  const variables = new Set<string>()
  const bucles = new Set<string>()
  const pila: string[] = []
  for (const m of texto.matchAll(/\{([#^/]?)\s*([^{}\s]+?)\s*\}/g)) {
    const [, marca, nombre] = m
    if (marca === '#' || marca === '^') { if (!pila.length) bucles.add(nombre); pila.push(nombre) }
    else if (marca === '/') pila.pop()
    else if (!pila.length) variables.add(nombre)
  }
  return { variables: [...variables], bucles: [...bucles] }
}
