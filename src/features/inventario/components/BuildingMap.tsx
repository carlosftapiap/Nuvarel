import { cn } from '@/lib/utils'
import { ESTADO_EFECTIVO_ORDEN, ESTADOS_EFECTIVOS, estadoEfectivo, type EstadoEfectivo } from '../estados'
import { calcularPrecio, fmtUsd } from '../pricing'
import type { PricingParams, Unit } from '../types'
import { nombreEdificio, textoBusquedaUnidad } from '../nomenclatura'

const PISOS: Unit['piso'][] = ['5', '4', '3', '2', '1', 'PB']

/** Colores vivos por estado. Con texto oscuro cumplen contraste AA y la leyenda usa los mismos colores que las celdas. */
const COLOR_VIVO: Record<EstadoEfectivo, string> ={ disponible: '#22c55e', reservado: '#c084fc', vendido: '#60a5fa' }

/**
 * Alzado de cada edificio: una fila por piso y una celda por departamento, coloreada por estado.
 * `edificios` elige cuáles mostrar; `buscar` atenúa los departamentos que no coinciden con el número o el código.
 */
export default function BuildingMap({ units, params, onOpen, edificios = [1, 2], buscar = '', sinMarco = false }: {
  units: Unit[]; params: PricingParams; onOpen: (c: string) => void; edificios?: (1 | 2)[]; buscar?: string; sinMarco?: boolean
}) {
  const q = buscar.trim().toUpperCase()
  const coincide = (u: Unit) => !q || textoBusquedaUnidad(u).toUpperCase().includes(q)
  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Leyenda de estados" className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-foreground">
        {ESTADO_EFECTIVO_ORDEN.map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: COLOR_VIVO[e] }} />{ESTADOS_EFECTIVOS[e].label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="relative size-3 rounded-sm bg-slate-500"><span className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-400 ring-1 ring-white" /></span>Solicitud en trámite</span>
      </div>
      <div className={cn('grid gap-4', edificios.length > 1 && 'xl:grid-cols-[5fr_7fr]')}>
        {edificios.map((ed) => {
          const del = units.filter((u) => u.edificio === ed)
          const cols = Math.max(1, ...del.map((u) => u.posicion))
          return (
            <section key={ed} className={cn('min-w-0', sinMarco ? 'rounded-xl bg-[#f6f7fb] p-3 sm:p-4' : 'dashboard-card p-5')} aria-labelledby={`mapa-e${ed}`}>
              <div className="section-heading !p-0"><div><h2 id={`mapa-e${ed}`}>{nombreEdificio(ed)}</h2><p>{del.length} departamentos · {cols} por piso</p></div></div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {ESTADO_EFECTIVO_ORDEN.map((e) => {
                  const n = del.filter((u) => estadoEfectivo(u) === e).length
                  return n ? <span key={e}><i className="mr-1 inline-block size-2 rounded-full" style={{ background: COLOR_VIVO[e] }} aria-hidden="true" />{n} {ESTADOS_EFECTIVOS[e].label.toLowerCase()}</span> : null
                })}
              </p>
              {/* En pantallas angostas cada piso se desplaza en horizontal; las celdas nunca se achican más que su texto. */}
              <div className="mt-3 overflow-x-auto pb-1">
                <div className="grid gap-1.5" style={{ minWidth: `${2.5 + cols * 3.625}rem` }}>
                  {PISOS.map((piso) => (
                    <div key={piso} className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: `2.5rem repeat(${cols}, minmax(3.25rem, 1fr))` }}>
                      <span className="flex items-center text-xs font-medium text-muted-foreground">{piso === 'PB' ? 'PB' : `P${piso}`}</span>
                      {del.filter((u) => u.piso === piso).sort((a, b) => a.posicion - b.posicion).map((u) => {
                        const e = estadoEfectivo(u)
                        const precio = calcularPrecio(u, params).precioVenta
                        return (
                          <button key={u.codigo} type="button" onClick={() => onOpen(u.codigo)}
                            className={cn('relative flex min-h-[4.25rem] flex-col items-center justify-center rounded-md px-0.5 py-1.5 text-center text-slate-900 transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring', !coincide(u) && 'opacity-30')}
                            style={{ background: COLOR_VIVO[e] }}
                            title={`${u.dpt} · ${u.tipologia} · ${ESTADOS_EFECTIVOS[e].label}`}
                            aria-label={`${u.dpt}, ${u.tipologia}, ${ESTADOS_EFECTIVOS[e].label}, ${fmtUsd(precio)}${u.solicitud ? ', solicitud en trámite' : ''}`}>
                            <span className="block text-xs font-bold leading-tight">{u.dpt}</span>
                            <span className="block max-w-full truncate text-xs leading-tight">{u.tipologia.replace(' + estudio', '+E')}</span>
                            <span className="block text-xs font-semibold leading-tight tabular-nums">${Math.round(precio / 1000)}k</span>
                            {u.solicitud && <span className="absolute right-1 top-1 size-2 rounded-full bg-amber-400 ring-1 ring-slate-900/70" aria-hidden="true" />}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
