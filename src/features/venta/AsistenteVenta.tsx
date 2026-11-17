import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COLOR_ETAPA, ICONO_ETAPA } from './colores'
import { PASOS_VENTA, pasoActual, type Paso } from './operacion'

/** La barra lleva los colores de las etapas recorridas, hasta la que está en curso. */
const barra = (actual: number) => {
  const c = PASOS_VENTA.slice(0, actual + 1).map((p) => COLOR_ETAPA[p.clave].hex)
  return c.length > 1 ? `linear-gradient(90deg, ${c.join(', ')})` : c[0]
}

/** Asistente visual de la venta: cinco etapas con su color, cuál está en curso y cuánto falta. Solo orienta. */
export default function AsistenteVenta({ paso }: { paso: Paso }) {
  const actual = pasoActual(paso.accion)
  const final = paso.accion === 'cobranza'
  const hechas = final ? PASOS_VENTA.length : actual
  const progreso = Math.round((hechas / PASOS_VENTA.length) * 100)
  const enCurso = PASOS_VENTA[actual]

  return (
    <section aria-labelledby="asistente-tit" className="dashboard-card mb-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="asistente-tit" className="text-sm font-semibold">Proceso de venta</h2>
        <span className="text-xs font-medium text-muted-foreground">{final ? 'Venta formalizada' : <>Etapa {actual + 1} de {PASOS_VENTA.length} · <span className={COLOR_ETAPA[enCurso.clave].texto}>{enCurso.titulo}</span></>}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Avance de la venta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progreso}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${final ? 100 : ((actual + 0.5) / PASOS_VENTA.length) * 100}%`, background: barra(actual) }} />
      </div>
      <ol aria-label="Pasos de la venta" className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-3">
        {PASOS_VENTA.map((x, i) => {
          const hecho = i < actual || final
          const activo = i === actual && !final
          const c = COLOR_ETAPA[x.clave]
          const Icono = ICONO_ETAPA[x.clave]
          return (
            <li key={x.clave} aria-current={activo ? 'step' : undefined}
              className={cn('flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center sm:flex-row sm:gap-2.5 sm:px-2.5 sm:text-left',
                activo && cn(c.suave, 'ring-2', c.anillo))}>
              <span className={cn('relative grid size-9 shrink-0 place-items-center rounded-full sm:size-10', hecho || activo ? c.solido : 'bg-slate-100 text-slate-400')}>
                <Icono className="size-[18px]" aria-hidden="true" />
                {hecho && <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-emerald-600 text-white ring-2 ring-white"><Check className="size-2.5" aria-hidden="true" /></span>}
              </span>
              <span className="w-full min-w-0">
                <span className={cn('block truncate text-xs font-semibold leading-tight sm:text-sm', activo ? c.texto : hecho ? 'text-foreground' : 'text-slate-500')}>{x.titulo}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:block">{hecho ? 'Completado' : activo ? 'En curso' : x.quien}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
