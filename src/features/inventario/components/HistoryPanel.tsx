import { useState } from 'react'
import { ArrowRight, ChevronDown, History } from 'lucide-react'
import { ROLES } from '@/app/permissions'
import { etiquetaEstado } from '../estados'
import { fmtFecha, fmtNum, fmtUsd } from '../pricing'
import { trazaAjuste } from '../service'
import { useInventory } from '../store'
import type { PriceHistoryEntry, PriceProposal } from '../types'

export const TIPO: Record<PriceHistoryEntry['tipo'], string> = {
  precio_m2: 'Precio por m²', porcentaje: 'Ajuste %', importacion: 'Importación Excel', parametros: 'Parámetros de pago', restablecer: 'Lista base restablecida',
}

/** Quien propuso y quien aprobó, cada uno con su fecha. */
export function TrazaTexto({ h, propuestas }: { h: PriceHistoryEntry; propuestas: PriceProposal[] }) {
  const t = trazaAjuste(h, propuestas)
  return (
    <span className="grid basis-full gap-0.5 text-xs">
      {t.aprobo
        ? <>
            <span>{t.propuso ? <>Propuso: <b>{t.propuso.usuario}</b> · {fmtFecha(t.propuso.fecha)}</> : 'Sin propuesta previa'}</span>
            <span>Aprobó: <b>{t.aprobo.usuario}</b> · {fmtFecha(t.aprobo.fecha)}{t.aprobo.comentario ? ` · ${t.aprobo.comentario}` : ''}</span>
          </>
        : <span>Registró: <b>{t.registro.usuario}</b> · {fmtFecha(t.registro.fecha)} · sin aprobación de precio</span>}
    </span>
  )
}

export default function HistoryPanel() {
  const { state } = useInventory()
  const [abierto, setAbierto] = useState<string | null>(null)
  const dpt = (codigo: string) => state.units.find((u) => u.codigo === codigo)?.dpt ?? codigo
  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="hist-precios">
        <div className="section-heading"><div><h2 id="hist-precios">Historial de precios</h2><p>Cada cambio guarda usuario, rol, motivo y valores antes y después.</p></div></div>
        {state.priceHistory.length === 0 ? <Vacio texto="Sin cambios de precio. Rige la lista base del 28/10/2026." /> : (
          <ol className="mt-3 grid gap-2">
            {state.priceHistory.map((h) => {
              const delta = h.totalDespues - h.totalAntes
              const open = abierto === h.id
              return (
                <li key={h.id} className="rounded-lg border border-border">
                  <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left text-xs" aria-expanded={open} onClick={() => setAbierto(open ? null : h.id)}>
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{TIPO[h.tipo]}</span>
                    <span className="font-medium">{h.alcance}</span>
                    <span className="text-muted-foreground">{h.detalle}</span>
                    <span className={`ml-auto tabular-nums ${delta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{delta >= 0 ? '+' : ''}{fmtUsd(delta)}</span>
                    <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    <TrazaTexto h={h} propuestas={state.propuestas} />
                    <span className="basis-full text-xs text-muted-foreground tabular-nums">Total {fmtUsd(h.totalAntes)} → {fmtUsd(h.totalDespues)} · {ROLES[h.rol]?.label ?? h.rol} · “{h.motivo}”</span>
                  </button>
                  {open && (
                    <div className="max-h-64 overflow-auto border-t border-border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="p-2 text-left font-medium">Unidad</th><th className="p-2 text-right font-medium">USD/m²</th><th className="p-2 text-right font-medium">Precio</th></tr></thead>
                        <tbody>
                          {h.cambios.map((c) => (
                            <tr key={c.codigo} className="border-t border-border">
                              <td className="p-2">{dpt(c.codigo)} <span className="text-muted-foreground">{c.codigo}</span></td>
                              <td className="p-2 text-right tabular-nums">{fmtNum(c.antesUsdM2)} <ArrowRight className="inline size-3" /> {fmtNum(c.despuesUsdM2)}</td>
                              <td className="p-2 text-right tabular-nums">{fmtUsd(c.antesPrecio)} <ArrowRight className="inline size-3" /> <b>{fmtUsd(c.despuesPrecio)}</b></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </section>
      <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="hist-estados">
        <div className="section-heading"><div><h2 id="hist-estados">Cambios de estado</h2><p>Base para la integración con Reservas.</p></div></div>
        {state.statusHistory.length === 0 ? <Vacio texto="Sin cambios de estado registrados." /> : (
          <ol className="mt-3 grid gap-2">
            {state.statusHistory.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-3 text-xs">
                <div><b>Departamento {dpt(s.codigo)}</b> <span className="text-muted-foreground">{s.codigo}</span>: {etiquetaEstado(s.de)} <ArrowRight className="inline size-3" /> <b>{etiquetaEstado(s.a)}</b>{s.reservaId ? ` · ${s.reservaId}` : ''}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{fmtFecha(s.fecha)} · {s.usuario} · “{s.motivo}”</div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground"><History className="size-4" />{texto}</p>
}
