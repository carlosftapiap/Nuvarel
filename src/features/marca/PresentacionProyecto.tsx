import { useState } from 'react'
import { Maximize, Presentation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NOTA_VISUALIZACION } from './medios'
import { useMedios } from './useMedios'
import VisorMedios, { TarjetaMedio } from './VisorMedios'

/** Herramienta del vendedor en Atender cliente: solo presenta. Se abre encima de la operación, sin perder lo que lleva escrito. */
export default function PresentacionProyecto() {
  const medios = useMedios('venta')
  const [abierto, setAbierto] = useState<{ inicio: number; completa: boolean } | null>(null)
  const lista = medios ?? []
  const iPrincipal = lista.findIndex((m) => m.tipo === 'video')
  const principal = iPrincipal >= 0 ? lista[iPrincipal] : null
  return (
    <section aria-labelledby="pres-tit" className="dashboard-card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f3eee6] text-[#584536]"><Presentation className="size-5" /></span>
        <div className="min-w-52 flex-1">
          <h2 id="pres-tit" className="text-sm font-semibold leading-tight">Presentación del proyecto AMURA</h2>
          <p className="text-xs text-muted-foreground">Video y fotos para mostrar al cliente · {NOTA_VISUALIZACION}.</p>
        </div>
        {lista.length > 0 && <Button size="sm" variant="outline" className="h-9 border-[#d8cbb8] text-[#584536] hover:bg-[#f7f4ed]" onClick={() => setAbierto({ inicio: 0, completa: true })}><Maximize />Presentar en pantalla completa</Button>}
      </div>
      <div id="pres-contenido" className="mt-3">
          {medios !== null && lista.length === 0 && <p className="rounded-lg bg-muted/50 px-3 py-4 text-center text-xs text-muted-foreground">Todavía no hay material publicado para presentar. Un administrador puede publicarlo en Configuración.</p>}
          {lista.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
              {principal && (
                <div className="grid content-start gap-1.5">
                  <TarjetaMedio medio={principal} onAbrir={() => setAbierto({ inicio: iPrincipal, completa: false })} className="aspect-video" />
                  {principal.descripcion && <p className="text-xs text-muted-foreground">{principal.descripcion}</p>}
                </div>
              )}
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {lista.map((m, i) => (m === principal ? null : <li key={m.id}><TarjetaMedio medio={m} onAbrir={() => setAbierto({ inicio: i, completa: false })} className="aspect-[4/5]" /></li>))}
              </ul>
            </div>
          )}
      </div>
      {abierto && <VisorMedios medios={lista} inicio={abierto.inicio} pantallaCompleta={abierto.completa} onCerrar={() => setAbierto(null)} />}
    </section>
  )
}
