import { useState } from 'react'
import { Play } from 'lucide-react'
import { medioBanner, NOTA_VISUALIZACION, type Medio } from './medios'
import VisorMedios from './VisorMedios'

const accion = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#dad3c1]'

/** Banner discreto del Dashboard, con la pieza que eligió el administrador. Un video solo se descarga al pulsar «Ver video». */
export default function BannerBienvenida({ medios }: { medios: Medio[] | null }) {
  const [video, setVideo] = useState<number | null>(null)
  const lista = medios ?? []
  const pieza = medioBanner(lista)
  const iVideo = pieza?.tipo === 'video' ? lista.indexOf(pieza) : lista.findIndex((m) => m.tipo === 'video')
  const verGaleria = () => document.getElementById('conoce-amura')?.scrollIntoView({ behavior: 'smooth' })
  return (
    <section aria-label="Bienvenida a AMURA" className="grid overflow-hidden rounded-2xl bg-[#282828] text-[#f7f4ed] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-center gap-1.5 px-5 py-4 md:px-7">
        <img src="/media/logo-horizontal-crema.webp" alt="AMURA Apartments" width={600} height={163} className="h-8 w-auto" />
        <p className="marca-clave mt-1 text-[#dad3c1]">Rumbo propio</p>
        <h2 className="marca-titulo text-xl leading-tight md:text-2xl">Un lugar para vivir, compartir y crecer.</h2>
        {lista.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button type="button" onClick={verGaleria} className={`${accion} bg-[#dad3c1] text-[#282828] hover:bg-[#e6e0d0]`}>Conoce AMURA</button>
            {iVideo >= 0 && <button type="button" onClick={() => setVideo(iVideo)} className={`${accion} border border-[#dad3c1] text-[#dad3c1] hover:bg-white/10`}><Play className="size-4" aria-hidden="true" />Ver video</button>}
          </div>
        )}
      </div>
      {pieza && (
        <div className="relative hidden md:block">
          <img src={pieza.tipo === 'video' ? pieza.miniatura : pieza.src} srcSet={pieza.tipo === 'imagen' && pieza.ancho ? `${pieza.miniatura} 480w, ${pieza.src} ${pieza.ancho}w` : undefined} sizes="(max-width: 768px) 100vw, 640px"
            alt={pieza.titulo} decoding="async" className="absolute inset-0 size-full object-cover object-[50%_42%]" />
          <small className="absolute bottom-2 right-2 rounded-full bg-[#282828]/70 px-2 py-0.5 text-xs text-white">{NOTA_VISUALIZACION}</small>
        </div>
      )}
      {video !== null && <VisorMedios medios={lista} inicio={video} onCerrar={() => setVideo(null)} />}
    </section>
  )
}
