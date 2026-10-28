import { ESTADO_ORDEN, ESTADOS } from '../estados'
import { calcularPrecio, fmtUsd } from '../pricing'
import type { PricingParams, Unit } from '../types'

const PISOS: Unit['piso'][] = ['5', '4', '3', '2', '1', 'PB']

/** Vista de alzado: cada fila es un piso y cada celda un departamento, coloreado por estado. */
export default function BuildingMap({ units, params, onOpen }: { units: Unit[]; params: PricingParams; onOpen: (c: string) => void }) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground" aria-label="Leyenda de estados">
        {ESTADO_ORDEN.map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: ESTADOS[e].color }} />{ESTADOS[e].label}</span>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[5fr_7fr]">
        {([1, 2] as const).map((ed) => {
          const del = units.filter((u) => u.edificio === ed)
          const cols = Math.max(...del.map((u) => u.posicion))
          return (
            <section key={ed} className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby={`mapa-e${ed}`}>
              <div className="section-heading"><div><h2 id={`mapa-e${ed}`}>Edificio {ed}</h2><p>{del.length} departamentos · {cols} por piso</p></div></div>
              <div className="mt-3 grid gap-1.5">
                {PISOS.map((piso) => (
                  <div key={piso} className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: `2.5rem repeat(${cols}, minmax(0, 1fr))` }}>
                    <span className="flex items-center text-[11px] font-medium text-muted-foreground">{piso === 'PB' ? 'PB' : `P${piso}`}</span>
                    {del.filter((u) => u.piso === piso).sort((a, b) => a.posicion - b.posicion).map((u) => {
                      const c = ESTADOS[u.estado].color
                      return (
                        <button key={u.codigo} type="button" onClick={() => onOpen(u.codigo)}
                          className="group rounded-md border px-1 py-1.5 text-center transition hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
                          style={{ borderColor: `${c}66`, background: `${c}14` }}
                          title={`${u.codigo} · ${u.tipologia} · ${ESTADOS[u.estado].label}`}
                          aria-label={`${u.dpt}, ${u.tipologia}, ${ESTADOS[u.estado].label}, ${fmtUsd(calcularPrecio(u, params).precioVenta)}`}>
                          <span className="block text-[11px] font-semibold text-foreground">{u.dpt}</span>
                          <span className="block truncate text-[9px] text-muted-foreground">{u.tipologia.replace(' + estudio', '+E')}</span>
                          <span className="hidden truncate text-[9px] tabular-nums text-muted-foreground sm:block">${Math.round(calcularPrecio(u, params).precioVenta / 1000)}k</span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
