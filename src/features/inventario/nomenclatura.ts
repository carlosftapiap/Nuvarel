/**
 * Nomenclatura comercial de AMURA: Edificio A y Edificio B; departamentos A001–A505 y B001–B507 (letra, piso y posición).
 * El código interno (E1-PB-A1) no cambia: es la clave de reservas, cotizaciones y contratos y no se muestra en pantallas comerciales.
 * El número comercial vigente viene de la base (Unit.dpt); estas funciones sirven donde solo se conoce el código interno.
 */
const PATRON = /^E([12])-(?:PB|P([1-5]))-A([1-7])$/

export const letraEdificio = (edificio: number | string) => (Number(edificio) === 1 ? 'A' : Number(edificio) === 2 ? 'B' : String(edificio))
export const nombreEdificio = (edificio: number | string) => `Edificio ${letraEdificio(edificio)}`
export const edificioTecnico = (valor: string | null): 1 | 2 | null =>
  valor === '1' || valor?.toUpperCase() === 'A' ? 1 : valor === '2' || valor?.toUpperCase() === 'B' ? 2 : null

function partes(codigo: string) {
  const m = PATRON.exec(codigo.trim().toUpperCase())
  return m && (m[1] !== '1' || Number(m[3]) <= 5) ? { edificio: Number(m[1]), piso: m[2] ?? '0', posicion: m[3].padStart(2, '0') } : null
}

/** Número comercial a partir del código interno (E1-P1-A5 → A105). Si no es un código de unidad, lo devuelve tal cual. */
export function numeroComercial(codigo: string) {
  const p = partes(codigo)
  return p ? `${letraEdificio(p.edificio)}${p.piso}${p.posicion}` : codigo
}

/** Número anterior a la nomenclatura comercial (E1-P1-A5 → 1105). Se usa solo para buscar y como referencia discreta. */
export function numeroAnterior(codigo: string) {
  const p = partes(codigo)
  return p ? `${p.edificio}${p.piso}${p.posicion}` : null
}

/** Texto de búsqueda de una unidad: número vigente y anterior (sin el código interno, que no se ve en pantalla). */
export const textoBusquedaUnidad = (u: { codigo: string; dpt: string }) => `${u.codigo} ${u.dpt} ${numeroAnterior(u.codigo) ?? ''} ${nombreEdificio(u.codigo.startsWith('E2-') ? 2 : 1)}`

/** Solo resuelve unidades realmente presentes; nunca crea una unidad a partir de texto libre. */
export function resolverUnidad<T extends { codigo: string; dpt: string }>(unidades: readonly T[], valor: string | null | undefined): T | undefined {
  const v = valor?.trim().toUpperCase()
  return v ? unidades.find((u) => u.codigo === v || u.dpt.toUpperCase() === v || numeroAnterior(u.codigo) === v) : undefined
}

/** Una instantánea antigua mantiene el nombre que tenía al emitirla. */
export const edificioDocumento = (u: { dpt: string; edificio: number; edificioNombre?: string }) =>
  u.edificioNombre ?? (/^[12][0-5]0[1-7]$/.test(u.dpt) ? `Edificio ${u.edificio}` : nombreEdificio(u.edificio))

export const ERROR_ORIGINAL_DOCUMENTO = 'Este documento histórico no tiene una instantánea de emisión. Conserva el PDF original; no se puede reconstruir con datos actuales. Para actualizarlo, emite una nueva versión.'
