import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { listarPlanos, planoDeUnidad, tituloPlano, verPlano, type Plano } from './planos'

/** Plano del departamento cotizado: el individual si está publicado; si no, el de planta de su piso, rotulado como tal. */
export default function PlanoCotizacion({ cotizacion, datos, onError }: { cotizacion: Cotizacion; datos: Datos | null; onError: (m: string) => void }) {
  const [plano, setPlano] = useState<Plano | null | undefined>(undefined)
  const [abriendo, setAbriendo] = useState(false)
  const u = cotizacion.unidad

  useEffect(() => {
    if (!datos) { setPlano(null); return }
    listarPlanos(datos).then((l) => setPlano(planoDeUnidad(l, u))).catch(() => setPlano(null))
  }, [datos, u.codigo, u.edificio, u.piso]) // eslint-disable-line react-hooks/exhaustive-deps

  if (plano === undefined) return <p className="text-xs text-muted-foreground">Buscando plano…</p>
  if (!plano) return <p className="text-xs text-muted-foreground">No hay un plano publicado para este departamento ni para su piso.</p>

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-slate-900">{tituloPlano(plano, u.dpt)}</p>
      {plano.tipo === 'piso' && <p className="text-xs text-muted-foreground">Muestra todo el piso. No es un plano exclusivo del departamento {u.dpt}.</p>}
      <Button className="h-10 w-full sm:w-auto" disabled={abriendo}
        onClick={() => { setAbriendo(true); verPlano(plano).catch((e: Error) => onError(e.message)).finally(() => setAbriendo(false)) }}>
        Ver plano
      </Button>
    </div>
  )
}
