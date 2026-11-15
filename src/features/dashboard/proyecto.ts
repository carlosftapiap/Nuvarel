import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { estadoPrecio, resumenInventario } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'
import { useDatosPanel } from './datos'
import { calcularPanel, type EdificioFiltro } from './panel'
import { edificioTecnico } from '@/features/inventario/nomenclatura'

/** Datos del proyecto que comparten los inicios: inventario por edificio, panel comercial y financiero. */
export function usePanelProyecto() {
  const { state } = useInventory()
  const { can } = useSession()
  const { datos } = useConexion()
  const [params, setParams] = useSearchParams()
  const filtro: EdificioFiltro = edificioTecnico(params.get('edificio')) ?? 'todos'
  const entrada = useDatosPanel(datos, can)
  const hoy = hoyGuayaquil()
  const unidades = useMemo(() => (filtro === 'todos' ? state.units : state.units.filter((u) => u.edificio === filtro)), [state.units, filtro])
  const inv = useMemo(() => resumenInventario({ ...state, units: unidades }), [state, unidades])
  const referenciales = useMemo(() => unidades.filter((u) => estadoPrecio(state.priceHistory, u.codigo).tipo === 'referencial').length, [unidades, state.priceHistory])
  const panel = useMemo(() => (entrada ? calcularPanel(entrada, filtro, hoy) : null), [entrada, filtro, hoy])
  const fijarFiltro = (param: string) => setParams((p) => { if (param === 'todos') p.delete('edificio'); else p.set('edificio', param); return p }, { replace: true })
  return { state, filtro, fijarFiltro, entrada, unidades, inv, referenciales, panel, q: filtro === 'todos' ? '' : `?edificio=${filtro}` }
}

export type DatosProyecto = ReturnType<typeof usePanelProyecto>
