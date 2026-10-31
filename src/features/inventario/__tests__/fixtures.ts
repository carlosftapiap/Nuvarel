import { estadoDesde } from '../service'
import type { InventoryState, PricingParams, Unit } from '../types'
import { AMURA_UNITS_SEED } from './datos/amura-units'

export { AMURA_UNITS_SEED }

/** Lista base del 28/10/2026, solo para pruebas. La aplicación la lee de la base. */
export const DEFAULT_PARAMS: PricingParams = { patioUsdM2: 230, reservaPct: 6, cuotasPct: 14, meses: { 1: 30, 2: 42 } }

/** Estado de prueba: las unidades de la lista base, disponibles, con su lista base y parámetros. */
export function createInitialState(): InventoryState {
  const units: Unit[] = AMURA_UNITS_SEED.map((s) => ({
    ...s, usdM2Lista: s.usdM2, estado: 'disponible', reservaId: null, notas: '', parqueo: null, planoPath: null, imagenes: [],
  }))
  const params = (): PricingParams => ({ ...DEFAULT_PARAMS, meses: { ...DEFAULT_PARAMS.meses } })
  return estadoDesde(units, params(), params())
}
