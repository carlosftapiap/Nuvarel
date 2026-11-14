import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize, Minimize, Play, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fmtDuracion, NOTA_VISUALIZACION, type Medio } from './medios'

const telefonoVertical = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches
const claro = 'border-[#dad3c1] bg-transparent text-[#dad3c1] hover:bg-white/10 hover:text-white'

/**
 * Vista ampliada de fotografías y videos, solo para mirar: no permite modificar nada.
 * El video se pide al abrirlo, empieza sin sonido y el vendedor lo activa desde los controles.
 */
export default function VisorMedios({ medios, inicio, pantallaCompleta = false, onCerrar }: { medios: Medio[]; inicio: number; pantallaCompleta?: boolean; onCerrar: () => void }) {
  const [i, setI] = useState(inicio)
  const [fallo, setFallo] = useState<string | null>(null)
  const [enPantalla, setEnPantalla] = useState(false)
  const marco = useRef<HTMLDivElement>(null)
  const total = medios.length
  const m = medios[i] ?? medios[0]
  const mover = (d: number) => setI((x) => (x + d + total) % total)
  const puedePantalla = typeof document !== 'undefined' && document.fullscreenEnabled === true

  useEffect(() => {
    const cambio = () => setEnPantalla(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', cambio)
    if (pantallaCompleta && puedePantalla) void marco.current?.requestFullscreen().catch(() => {})
    return () => {
      document.removeEventListener('fullscreenchange', cambio)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir.
  }, [])

  const alternar = () => { void (enPantalla ? document.exitFullscreen() : marco.current?.requestFullscreen())?.catch(() => {}) }
  if (!m) return null
  const fuente = m.tipo === 'video' && m.srcVertical && telefonoVertical() ? m.srcVertical : m.src

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar() }}>
      <DialogContent showCloseButton={false} className="h-[96svh] w-[calc(100vw-1rem)] max-w-none gap-0 overflow-hidden bg-[#282828] p-0 text-[#f7f4ed] sm:max-w-none"
        onKeyDown={(e) => { if (total > 1 && e.key === 'ArrowLeft') mover(-1); if (total > 1 && e.key === 'ArrowRight') mover(1) }}>
        <div ref={marco} className="flex size-full min-h-0 flex-col bg-[#282828]">
          <div className="relative min-h-0 flex-1 bg-[#1c1c1c]">
            {fallo === m.id
              ? <p role="alert" className="absolute inset-0 grid place-items-center p-8 text-center text-sm">No se pudo mostrar este contenido. Revisa tu conexión e inténtalo de nuevo.</p>
              : m.tipo === 'video'
                ? <video key={fuente} src={fuente} poster={m.miniatura} controls autoPlay muted playsInline preload="metadata" onError={() => setFallo(m.id)} className="absolute inset-0 size-full bg-black object-contain outline-none" />
                : <img key={fuente} src={fuente} alt={m.titulo} onError={() => setFallo(m.id)} className="absolute inset-0 size-full object-contain" />}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-48 flex-1">
              <DialogTitle className="marca-titulo text-lg font-normal leading-tight">{m.titulo}</DialogTitle>
              <DialogDescription className="text-xs text-[#f7f4ed]/85">{m.descripcion || NOTA_VISUALIZACION}</DialogDescription>
              <small className="text-xs text-[#f7f4ed]/70">{i + 1} de {total} · {NOTA_VISUALIZACION}</small>
            </div>
            <div className="flex items-center gap-1.5">
              {total > 1 && <Button size="sm" variant="outline" className={claro} aria-label="Anterior" onClick={() => mover(-1)}><ChevronLeft /></Button>}
              {total > 1 && <Button size="sm" variant="outline" className={claro} aria-label="Siguiente" onClick={() => mover(1)}><ChevronRight /></Button>}
              {puedePantalla && <Button size="sm" variant="outline" className={claro} onClick={alternar}>{enPantalla ? <Minimize /> : <Maximize />}{enPantalla ? 'Salir' : 'Pantalla completa'}</Button>}
              <Button size="sm" variant="outline" className={claro} aria-label="Cerrar" onClick={onCerrar}><X /></Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Miniatura de fotografía o portada de video. La imagen se descarga cuando llega a la pantalla. */
export function TarjetaMedio({ medio, onAbrir, className }: { medio: Medio; onAbrir: () => void; className?: string }) {
  const video = medio.tipo === 'video'
  return (
    <button type="button" aria-label={video ? `Ver video ${medio.titulo}` : `Ampliar ${medio.titulo}`} onClick={onAbrir}
      className={cn('group relative block w-full overflow-hidden rounded-xl bg-[#dad3c1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#584536]', className)}>
      <img src={medio.miniatura} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
      {video && <span aria-hidden="true" className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-[#282828]/75 text-white transition-transform group-hover:scale-110 motion-reduce:transition-none"><Play className="size-5 translate-x-px" /></span></span>}
      <span className="marca-titulo absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-[#282828]/90 to-transparent px-3 pb-2.5 pt-8 text-left text-base leading-tight text-white">
        <span>{medio.titulo}</span>
        {video && medio.duracion !== null && <small className="font-sans text-xs">{fmtDuracion(medio.duracion)}</small>}
      </span>
    </button>
  )
}
