import { useState } from 'react'
import { NOTA_VISUALIZACION, type Medio } from './medios'
import VisorMedios, { TarjetaMedio } from './VisorMedios'

/** Galería del Dashboard. Va después de los indicadores, para no desplazarlos. */
export default function ConoceAmura({ medios }: { medios: Medio[] | null }) {
  const [abierto, setAbierto] = useState<number | null>(null)
  if (medios === null) return null
  return (
    <section id="conoce-amura" aria-labelledby="conoce-titulo" className="dashboard-card scroll-mt-4 p-5">
      <p className="marca-clave text-[#584536]">Rumbo propio</p>
      <h2 id="conoce-titulo" className="marca-titulo mt-0.5 text-2xl">Conoce AMURA</h2>
      {medios.length === 0
        ? <p className="mt-2 text-xs text-muted-foreground">Todavía no hay material publicado para esta pantalla.</p>
        : (
          <>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{NOTA_VISUALIZACION}.</p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {medios.map((m, i) => <li key={m.id}><TarjetaMedio medio={m} onAbrir={() => setAbierto(i)} className="aspect-[4/5]" /></li>)}
            </ul>
          </>
        )}
      {abierto !== null && <VisorMedios medios={medios} inicio={abierto} onCerrar={() => setAbierto(null)} />}
    </section>
  )
}
