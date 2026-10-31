import { useEffect, useMemo, useState } from 'react'
import { useConexion } from '@/app/auth'
import { rangosFratelli, rangoTotalFratelli, type FratelliUnit } from './competencia'

type Fila = Record<string, unknown>

const aFratelli = (f: Fila): FratelliUnit => ({
  torre: String(f.torre), depto: String(f.depto), planta: String(f.planta), modelo: String(f.modelo),
  dptoM2: Number(f.dpto_m2), bodegaM2: Number(f.bodega_m2), patioM2: Number(f.patio_m2),
  precioBase: Number(f.precio_base), precioTotal: Number(f.precio_total), estado: String(f.estado),
  plazoMeses: Number(f.plazo_meses), entregaEstimada: String(f.entrega_estimada), patioBalcon: String(f.patio_balcon),
  fuente: String(f.fuente),
})

/** Lista de competencia FRATELLI guardada en la base. Solo la recibe quien tiene precios.competencia. */
export function useFratelli() {
  const { datos } = useConexion()
  const [lista, setLista] = useState<FratelliUnit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!datos) return
    datos.select<Fila>('competencia_unidades', { orden: [{ columna: 'torre', asc: true }, { columna: 'depto', asc: true }] })
      .then((filas) => setLista(filas.map(aFratelli)))
      .catch((e: Error) => setError(e.message))
  }, [datos])
  return useMemo(() => ({
    lista, error,
    rangos: lista ? rangosFratelli(lista) : null,
    total: lista ? rangoTotalFratelli(lista) : null,
  }), [lista, error])
}
