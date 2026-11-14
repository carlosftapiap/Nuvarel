import { useState } from 'react'
import { ChevronDown, ChevronUp, Maximize } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NOTA_VISUALIZACION } from './medios'
import { useMedios } from './useMedios'
import VisorMedios, { TarjetaMedio } from './VisorMedios'

const CLAVE_OCULTA = 'amura.venta.presentacion.oculta'

/** Herramienta del vendedor en Atender cliente: solo presenta. Se abre encima de la operación, sin perder lo que lleva escrito. */
export default function PresentacionProyecto() {
  const medios = useMedios('venta')
  const [oculta, setOculta] = useState(() => { try { return localStorage.getItem(CLAVE_OCULTA) === '1' } catch { return false } })
  const [abierto, setAbierto] = useState<{ inicio: number; completa: boolean } | null>(null)
  const alternar = () => { const o = !oculta; setOculta(o); try { localStorage.setItem(CLAVE_OCULTA, o ? '1' : '0') } catch { /* sin almacenamiento: solo en esta visita */ } }
  const lista = medios ?? []
  const iPrincipal = lista.findIndex((m) => m.tipo === 'video')
  const principal = iPrincipal >= 0 ? lista[iPrincipal] : null
  return (
    <section aria-labelledby="pres-tit" className="dashboard-card mb-4 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-52 flex-1">
          <h2 id="pres-tit" className="marca-titulo text-xl leading-tight">Presentación del proyecto AMURA</h2>
          <p className="text-xs text-muted-foreground">Material para mostrar al cliente sin salir de esta pantalla · {NOTA_VISUALIZACION}.</p>
        </div>
        {lista.length > 0 && <Button size="sm" className="bg-[#584536] text-white hover:bg-[#6a5442]" onClick={() => setAbierto({ inicio: 0, completa: true })}><Maximize />Presentar en pantalla completa</Button>}
        <Button size="sm" variant="ghost" aria-expanded={!oculta} aria-controls="pres-contenido" onClick={alternar}>{oculta ? <ChevronDown /> : <ChevronUp />}{oculta ? 'Mostrar' : 'Ocultar'}</Button>
      </div>
      {!oculta && (
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
      )}
      {abierto && <VisorMedios medios={lista} inicio={abierto.inicio} pantallaCompleta={abierto.completa} onCerrar={() => setAbierto(null)} />}
    </section>
  )
}
