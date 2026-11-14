import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import { cargarSolicitudes, cargarTrazabilidad, resolverSolicitud, type Solicitud, type Trazabilidad } from '../duplicados'

const fecha = (x: string | null | undefined) => (x ? fmtFechaCorta(x.slice(0, 10)) : '—')
const ESTADO: Record<Solicitud['estado'], { label: string; tono: string }> = {
  pendiente: { label: 'Pendiente', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aprobada: { label: 'Aprobada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazada: { label: 'Rechazada', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

/** Solicitudes de reasignación: quien la pidió ve su estado; el Supervisor de ambos vendedores o Gerencia la resuelve. */
export function SolicitudesReasignacion({ onCambio }: { onCambio?: () => void }) {
  const { remoto, datos } = useConexion()
  const [lista, setLista] = useState<Solicitud[] | null>(null)
  const [abierta, setAbierta] = useState<Solicitud | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(async () => { if (datos) setLista(await cargarSolicitudes(datos)) }, [datos])
  useEffect(() => { void cargar() }, [cargar])
  if (!remoto || !datos || !lista || lista.length === 0) return null

  return (
    <section aria-labelledby="sol-reasig" className="dashboard-card !p-0 overflow-x-auto">
      <div className="px-4 pt-3 text-xs font-semibold" id="sol-reasig">Solicitudes de reasignación de clientes</div>
      {aviso && <p role="status" className="mx-4 mt-2 text-xs text-emerald-700">{aviso}</p>}
      <table className="w-full text-xs">
        <thead className="text-xs text-muted-foreground"><tr>
          <th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Pide</th><th className="px-2 py-2 text-left font-medium">Vendedor actual</th>
          <th className="px-2 py-2 text-left font-medium">Motivo</th><th className="px-2 py-2 text-left font-medium">Fecha</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-4 py-2" />
        </tr></thead>
        <tbody>
          {lista.map((s) => (
            <tr key={s.id} className="border-t border-border align-top">
              <td className="px-4 py-2 font-medium">{s.cliente}</td>
              <td className="px-2 py-2">{s.solicitante}</td>
              <td className="px-2 py-2">{s.asesorActual}</td>
              <td className="px-2 py-2 text-muted-foreground">{s.motivo}{s.resolucion && <div className="text-xs">Decisión: {s.resolucion}</div>}</td>
              <td className="px-2 py-2 tabular-nums">{fecha(s.creadoEn)}</td>
              <td className="px-2 py-2"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ESTADO[s.estado].tono)}>{ESTADO[s.estado].label}</span></td>
              <td className="px-4 py-2 text-right">{s.puedeResolver && <Button size="xs" onClick={() => setAbierta(s)}>Resolver</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {abierta && <Resolver s={abierta} onClose={() => setAbierta(null)} guardar={async (aprobar, motivo) => {
        await resolverSolicitud(datos, abierta.id, aprobar, motivo)
        setAviso(`Solicitud ${aprobar ? 'aprobada: el cliente pasa a ' + abierta.solicitante : 'rechazada: el cliente sigue con ' + abierta.asesorActual}`)
        await cargar(); onCambio?.()
      }} />}
    </section>
  )
}

function Resolver({ s, onClose, guardar }: { s: Solicitud; onClose: () => void; guardar: (aprobar: boolean, motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decidir = async (aprobar: boolean) => {
    setEnviando(true); setError(null)
    try { await guardar(aprobar, motivo.trim()); onClose() } catch (e) { setError((e as Error).message) } finally { setEnviando(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reasignación de {s.cliente}</DialogTitle>
          <DialogDescription>{s.solicitante} pide atender al cliente de {s.asesorActual}. Las cotizaciones, reservas y comisiones ya generadas no cambian de vendedor.</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Motivo de la solicitud: {s.motivo}</p>
        <div className="grid gap-1.5">
          <Label htmlFor="rs-motivo" className="text-xs">Motivo de la decisión *</Label>
          <Textarea id="rs-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" disabled={enviando || motivo.trim().length < 5} onClick={() => void decidir(false)}>Rechazar</Button>
          <Button disabled={enviando || motivo.trim().length < 5} onClick={() => void decidir(true)}>{enviando && <Loader2 className="animate-spin" />}Aprobar reasignación</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Quién creó al cliente, quién lo atiende, su equipo y supervisor, sus reasignaciones y quién generó cada cotización y reserva. */
export function TrazabilidadCliente({ clientId }: { clientId: string }) {
  const { remoto, datos } = useConexion()
  const [t, setT] = useState<Trazabilidad | null>(null)
  useEffect(() => { if (remoto && datos) void cargarTrazabilidad(datos, clientId).then(setT) }, [remoto, datos, clientId])
  if (!t) return null
  return (
    <section aria-labelledby="cs-traza" className="grid gap-2 rounded-xl border border-border p-4 text-xs">
      <h3 id="cs-traza" className="text-sm font-semibold">Responsable y trazabilidad</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Registrado por</dt><dd>{t.creado_por ?? '—'} · {fecha(t.creado_en)}</dd>
        <dt className="text-muted-foreground">Vendedor responsable</dt><dd className="font-medium">{t.responsable ?? '—'}</dd>
        <dt className="text-muted-foreground">Equipo</dt><dd>{t.equipo ?? 'Sin equipo'}</dd>
        <dt className="text-muted-foreground">Supervisor</dt><dd>{t.supervisor ?? 'Sin supervisor'}</dd>
      </dl>
      <div>
        <div className="font-medium">Reasignaciones</div>
        {t.reasignaciones.length === 0 ? <p className="text-muted-foreground">Ninguna: lo atiende quien lo recibió.</p> : (
          <ol className="grid gap-0.5">{t.reasignaciones.map((r, k) => <li key={k} className="text-muted-foreground">{fecha(r.fecha)} · <b className="text-foreground">{r.anterior ?? '—'} → {r.nuevo ?? '—'}</b> · por {r.por ?? '—'}{r.motivo ? ` · ${r.motivo}` : ''}</li>)}</ol>
        )}
      </div>
      {(t.cotizaciones.length > 0 || t.reservas.length > 0) && (
        <div>
          <div className="font-medium">Quién generó cada operación</div>
          <ul className="grid gap-0.5 text-muted-foreground">
            {t.cotizaciones.map((q) => <li key={q.numero}>Cotización {q.numero} · {fecha(q.fecha)} · {q.vendedor ?? '—'}</li>)}
            {t.reservas.map((r) => <li key={r.codigo}>Reserva {r.codigo} · {fecha(r.fecha)} · {r.vendedor ?? '—'}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
