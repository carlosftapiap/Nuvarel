import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Avatar } from '@/components/Estado'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { fmtUsd } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'
import { ETAPA_ORDEN, ETAPAS, ORIGENES, TIPOS_ACTIVIDAD, type Cliente, type Etapa } from '../model'
import { ordenarPorUrgencia, urgencia } from '../service'
import AccionesRapidas from './AccionesRapidas'
import { CategoriaBadge } from './ClienteSheet'

/**
 * Pipeline: una columna por etapa comercial, con la próxima gestión y las acciones rápidas en cada tarjeta.
 * Arrastrar una tarjeta a otra columna cambia la etapa con las mismas reglas de la ficha.
 */
export default function TableroPipeline({ clientes, etapas = ETAPA_ORDEN, dpt, onAbrir, onMover, onMessage }: {
  clientes: Cliente[]
  etapas?: Etapa[]
  dpt: (codigo: string) => string
  onAbrir: (id: string) => void
  onMover: (c: Cliente, etapa: Etapa) => void
  onMessage: (m: string) => void
}) {
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  return (
    <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Pipeline comercial">
      {etapas.map((etapa) => {
        const col = ordenarPorUrgencia(clientes.filter((c) => c.etapa === etapa))
        return (
          <section key={etapa} aria-label={`${ETAPAS[etapa].label}: ${col.length} clientes`}
            className={cn('flex w-[272px] shrink-0 flex-col rounded-2xl bg-[#eef1f6] p-2 transition-colors', arrastrando && 'outline-2 outline-dashed outline-[#c7d2fe]')}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const c = clientes.find((x) => x.id === e.dataTransfer.getData('text/plain')); setArrastrando(null); if (c) onMover(c, etapa) }}>
            <header className="flex items-center gap-2 px-2 py-2">
              <span className="size-2 rounded-full" style={{ background: ETAPAS[etapa].color }} aria-hidden="true" />
              <h2 className="text-[13.5px] font-semibold">{ETAPAS[etapa].label}</h2>
              <span className="ml-auto rounded-full bg-white px-2 text-xs font-bold text-slate-700">{col.length}</span>
            </header>
            <div className="grid grid-cols-[minmax(0,1fr)] min-h-24 content-start gap-2">
              {col.length === 0 && <p className="rounded-xl border border-dashed border-[#c9cfda] bg-white/70 px-3 py-4 text-center text-xs text-slate-600">Sin clientes en esta etapa</p>}
              {col.map((c) => {
                const u = urgencia(c)
                return (
                  <article key={c.id} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); setArrastrando(c.id) }} onDragEnd={() => setArrastrando(null)}
                    className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-border bg-white p-3 text-left shadow-[0_1px_2px_#1018280a] transition hover:border-[#c7d2fe]">
                    <button type="button" onClick={() => onAbrir(c.id)} aria-label={`Abrir ficha de ${c.nombre}`} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 text-left">
                      <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{c.nombre} <CategoriaBadge cliente={c} /></span>
                      <span className="text-xs text-slate-600">
                        {c.unidadesInteres.length ? c.unidadesInteres.map(dpt).join(', ') : 'Sin departamento'}{c.presupuesto ? ` · ${fmtUsd(c.presupuesto)}` : ''}
                      </span>
                    </button>
                    {c.proxima ? (
                      <span className={cn('flex items-center gap-1.5 text-xs', u === 'vencida' ? 'font-semibold text-rose-700' : u === 'hoy' ? 'font-semibold text-amber-700' : 'text-slate-600')}>
                        <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{TIPOS_ACTIVIDAD[c.proxima.tipo]} · {c.proxima.descripcion}</span><span className="ml-auto shrink-0">{fmtFechaCorta(c.proxima.fecha)}</span>
                      </span>
                    ) : etapa === 'perdido'
                      ? <span className="line-clamp-2 text-xs text-rose-700">{c.motivoPerdida}</span>
                      : <span className="text-xs font-medium text-amber-700">Sin próxima gestión</span>}
                    <footer className="flex items-center justify-between gap-2 border-t border-border pt-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600" title={`${c.asesor} · ${ORIGENES[c.origen]}`}><Avatar nombre={c.asesor} className="size-6 text-xs" /><span className="truncate">{c.asesor}</span></span>
                      <AccionesRapidas cliente={c} onMessage={onMessage} />
                    </footer>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
