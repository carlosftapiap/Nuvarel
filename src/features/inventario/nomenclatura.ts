/**
 * Nomenclatura comercial de AMURA: Edificio A y Edificio B; departamentos A001–A505 y B001–B507 (letra, piso y posición).
 * El código interno (E1-PB-A1) no cambia: es la clave de reservas, cotizaciones y contratos y no se muestra en pantallas comerciales.
 * El número comercial vigente viene de la base (Unit.dpt); estas funciones sirven donde solo se conoce el código interno.
 */
const PATRON = /^E([12])-(?:PB|P([1-5]))-A([1-9])$/

export const letraEdificio = (edificio: number | string) => (Number(edificio) === 1 ? 'A' : Number(edificio) === 2 ? 'B' : String(edificio))
export const nombreEdificio = (edificio: number | string) => `Edificio ${letraEdificio(edificio)}`

function partes(codigo: string) {
  const m = PATRON.exec(codigo.trim().toUpperCase())
  return m ? { edificio: Number(m[1]), piso: m[2] ?? '0', posicion: m[3].padStart(2, '0') } : null
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
export const textoBusquedaUnidad = (u: { codigo: string; dpt: string }) => `${u.dpt} ${numeroAnterior(u.codigo) ?? ''}`
