import { useCallback, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { useRefresco } from '@/features/conexion/refresco'
import { cargarLeads, FUENTES, procedencia, type Lead } from './remoto'

const fechaHora = (v: string) => new Date(v).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const CONTACTO: Record<string, string> = { llamada: 'llamada', mensaje: 'mensaje', visita: 'visita' }

/** Cómo llegó el cliente desde la web o las redes: cada consulta con su origen, campaña, fecha y primer contacto. */
export default function LeadsDelCliente({ clientId }: { clientId: string }) {
  const { remoto, datos } = useConexion()
  const [leads, setLeads] = useState<Lead[]>([])
  const cargar = useCallback(async () => {
    if (!datos) return
    try { setLeads(await cargarLeads(datos, { client_id: clientId })) } catch { setLeads([]) }
  }, [datos, clientId])
  useRefresco(cargar, remoto && !!datos)
  if (!leads.length) return null
  return (
    <section aria-labelledby="cs-leads" className="rounded-xl border border-border p-4">
      <h3 id="cs-leads" className="flex items-center gap-1.5 text-sm font-semibold"><Megaphone className="size-4" />Captación</h3>
      <ul className="mt-2 grid gap-2 text-xs">
        {leads.map((l) => {
          const p = procedencia(l)
          return (
            <li key={l.id} className="grid gap-0.5">
              <span><b>{FUENTES[l.fuente]}</b>{p && ` · ${p}`} · {fechaHora(l.recibidoEn)}{l.estado === 'duplicado' ? ' · nueva consulta' : ''}</span>
              {l.mensaje && <span className="whitespace-pre-line text-muted-foreground">{l.mensaje}</span>}
              <span className={l.primerContactoEn ? 'text-emerald-700' : 'font-medium text-amber-700'}>
                {l.primerContactoEn ? `Primer contacto: ${fechaHora(l.primerContactoEn)} (${CONTACTO[l.primerContactoTipo ?? ''] ?? 'registrado'})` : 'Sin primer contacto todavía'}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
