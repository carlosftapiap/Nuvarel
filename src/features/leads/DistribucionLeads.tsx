import { useCallback, useState } from 'react'
import { CheckCircle2, Pencil, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import {
  asignarAhora, asignarManual, cargarDisponibilidad, cargarErrores, cargarLeads, configuracionDe, configurarParticipante, DIAS, ESTADO_PARTICIPANTE, FUENTES,
  procedencia, type ConfigParticipante, type ErrorLead, type Lead, type Participante,
} from './remoto'

const fechaHora = (v: string) => new Date(v).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const diasTexto = (d: number[]) => (d.length === 7 ? 'Todos los días' : d.length === 5 && d.every((x) => x <= 5) ? 'Lun a Vie' : DIAS.filter(([n]) => d.includes(n)).map(([, l]) => l).join(', ') || 'Sin días')

/**
 * Configuración → Distribución de leads. Solo el administrador (config.leads): quién recibe, cuándo, vacaciones y pausa,
 * la bandeja de pendientes y las entradas con error. Nada de esto toca la cuenta ni los clientes de cada persona.
 */
export default function DistribucionLeads({ datos }: { datos: Datos }) {
  const [lista, setLista] = useState<Participante[] | null>(null)
  const [pendientes, setPendientes] = useState<Lead[]>([])
  const [errores, setErrores] = useState<ErrorLead[]>([])
  const [editar, setEditar] = useState<Participante | null>(null)
  const [manual, setManual] = useState<Lead | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [l, p, e] = await Promise.all([cargarDisponibilidad(datos), cargarLeads(datos, { estado: 'pendiente' }), cargarErrores(datos).catch(() => [])])
      setLista(l); setPendientes([...p].reverse()); setErrores(e); setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useRefresco(cargar)

  const ejecutar = async <T,>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    setError(null); setAviso(null)
    try { const r = await fn(); setAviso(typeof ok === 'function' ? ok(r) : ok); await cargar(); return true } catch (e) { setError((e as Error).message); return false }
  }
  const alternar = (p: Participante) => ejecutar(
    () => configurarParticipante(datos, p.userId, { ...configuracionDe(p), activo: !p.activo }, p.activo ? 'Deja de recibir leads' : 'Empieza a recibir leads'),
    p.activo ? `${p.nombre} ya no recibe leads nuevos; conserva sus clientes` : `${p.nombre} recibe leads cuando esté disponible`)
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')

  return (
    <section aria-labelledby="dl-tit" className="dashboard-card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex-1">
          <h2 id="dl-tit" className="text-sm font-semibold">Distribución de leads</h2>
          <p className="text-xs text-muted-foreground">Los prospectos de la página web, Facebook e Instagram se reparten por turnos entre quienes estén disponibles, con el horario de Ecuador.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void ejecutar(() => asignarAhora(datos), (n) => (n ? `${n} ${n === 1 ? 'lead asignado' : 'leads asignados'}` : pendientes.length ? 'No hay vendedores disponibles en este momento' : 'No hay leads pendientes'))}><RefreshCw />Asignar pendientes ahora</Button>
      </div>
      {aviso && <p role="status" className="m-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      {!editar && !manual && <div className="px-3 pt-2 empty:hidden"><FieldError>{error}</FieldError></div>}

      {lista === null ? <p className="p-6 text-center text-xs text-muted-foreground">Cargando…</p> : lista.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">No hay vendedores ni supervisores activos.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-xs text-muted-foreground"><tr>
              {['Vendedor', 'Equipo', 'Recibe leads', 'Horario', 'Disponibilidad', 'Asignados', ''].map((h, k) => <th key={k} className={cn('py-2 text-left font-medium', k === 0 ? 'px-4' : 'px-2')}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map((p) => {
                const e = ESTADO_PARTICIPANTE[p.estado]
                return (
                  <tr key={p.userId} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{p.nombre}<div className="text-xs font-normal text-muted-foreground">{p.rol === 'supervisor' ? 'Supervisor' : 'Vendedor'}</div></td>
                    <td className="px-2 py-2">{p.equipo ?? <span className="text-muted-foreground">Sin equipo</span>}</td>
                    <td className="px-2 py-2"><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={p.activo} aria-label={`Recibe leads: ${p.nombre}`} onChange={() => void alternar(p)} />{p.activo ? 'Sí' : 'No'}</label></td>
                    <td className="px-2 py-2">{diasTexto(p.dias)} · {p.horaInicio}–{p.horaFin}</td>
                    <td className="px-2 py-2">
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', e.tono)}>{e.label}</span>
                      {p.estado === 'vacaciones' && p.vacacionesHasta && <div className="text-xs text-muted-foreground">Hasta el {fmtFechaCorta(p.vacacionesHasta)}</div>}
                      {p.pausado && p.pausaMotivo && <div className="text-xs text-muted-foreground">{p.pausaMotivo}</div>}
                      {p.activo && p.vacacionesDesde && p.estado !== 'vacaciones' && <div className="text-xs text-muted-foreground">Vacaciones: {fmtFechaCorta(p.vacacionesDesde)} al {fmtFechaCorta(p.vacacionesHasta!)}</div>}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{p.leadsAsignados}{p.porContactar > 0 && <span className="text-amber-700"> · {p.porContactar} por contactar</span>}</td>
                    <td className="px-4 py-2 text-right"><Button size="xs" variant="ghost" aria-label={`Editar horario de ${p.nombre}`} onClick={() => { setError(null); setEditar(p) }}><Pencil />Editar</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-3 border-t border-border p-4">
        <h3 className="text-xs font-semibold">Bandeja de pendientes ({pendientes.length})</h3>
        {pendientes.length === 0
          ? <p className="text-xs text-muted-foreground">Sin pendientes: todos los leads tienen vendedor.</p>
          : (
            <ul className="grid gap-1.5">
              {pendientes.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                  <b>{l.nombre}</b><span className="text-muted-foreground">{[FUENTES[l.fuente], procedencia(l)].filter(Boolean).join(' · ')} · recibido {fechaHora(l.recibidoEn)}</span>
                  <Button size="xs" variant="outline" className="ml-auto" onClick={() => { setError(null); setManual(l) }}>Asignar a…</Button>
                </li>
              ))}
            </ul>
          )}
        <p className="text-xs text-muted-foreground">Se asignan solos, por orden de llegada, cuando alguien queda disponible (se revisa cada 5 minutos).</p>
      </div>

      {errores.length > 0 && (
        <div className="grid gap-2 border-t border-border p-4">
          <h3 className="text-xs font-semibold text-rose-700">Entradas que no se pudieron registrar ({errores.length})</h3>
          <ul className="grid gap-1 text-xs">
            {errores.slice(0, 10).map((e) => <li key={e.id} className="rounded border border-rose-200 bg-rose-50/50 px-2 py-1">{fechaHora(e.recibidoEn)} · {e.fuente}{e.externoId ? ` · ${e.externoId}` : ''} · {e.error}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-1 border-t border-border bg-muted/30 p-4 text-xs">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold"><PlugZap className="size-3.5" />Conexiones</h3>
        <p><b>Formulario web:</b> {base ? <code className="break-all">{base}/functions/v1/leads-web</code> : 'Disponible con la base de datos'}. Se habilita al definir el dominio de la página.</p>
        <p><b>Facebook e Instagram (Meta):</b> {base ? <code className="break-all">{base}/functions/v1/leads-meta</code> : 'Disponible con la base de datos'}. Pendiente de conectar con la cuenta de Meta.</p>
      </div>

      {editar && <EditarParticipante p={editar} error={error} onClose={() => setEditar(null)}
        onGuardar={async (cfg, motivo) => { if (await ejecutar(() => configurarParticipante(datos, editar.userId, cfg, motivo), `Disponibilidad de ${editar.nombre} guardada`)) setEditar(null) }} />}
      {manual && lista && <AsignarManual lead={manual} personas={lista} error={error} onClose={() => setManual(null)}
        onAsignar={async (vendedor, motivo) => { if (await ejecutar(() => asignarManual(datos, manual.id, vendedor, motivo), `Lead de ${manual.nombre} asignado`)) setManual(null) }} />}
    </section>
  )
}

function EditarParticipante({ p, error, onClose, onGuardar }: { p: Participante; error: string | null; onClose: () => void; onGuardar: (cfg: ConfigParticipante, motivo: string) => Promise<void> }) {
  const [cfg, setCfg] = useState<ConfigParticipante>(configuracionDe(p))
  const [conVacaciones, setConVacaciones] = useState(!!p.vacacionesDesde)
  const [motivo, setMotivo] = useState('Ajuste de horario y disponibilidad')
  const [enviando, setEnviando] = useState(false)
  const dia = (n: number) => setCfg({ ...cfg, dias: cfg.dias.includes(n) ? cfg.dias.filter((x) => x !== n) : [...cfg.dias, n].sort() })
  const final: ConfigParticipante = { ...cfg, vacaciones_desde: conVacaciones ? cfg.vacaciones_desde : null, vacaciones_hasta: conVacaciones ? cfg.vacaciones_hasta : null, pausa_motivo: cfg.pausado ? cfg.pausa_motivo : null }
  const valido = motivo.trim().length >= 5 && cfg.hora_inicio < cfg.hora_fin && (!cfg.activo || cfg.dias.length > 0)
    && (!conVacaciones || (!!cfg.vacaciones_desde && !!cfg.vacaciones_hasta && cfg.vacaciones_desde <= cfg.vacaciones_hasta))
    && (!cfg.pausado || (cfg.pausa_motivo ?? '').trim().length >= 3)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disponibilidad de {p.nombre}</DialogTitle>
          <DialogDescription>Fuera de su horario, de vacaciones o en pausa no recibe leads nuevos; conserva todos sus clientes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.activo} onChange={(e) => setCfg({ ...cfg, activo: e.target.checked })} />Recibe leads</label>
          <fieldset className="grid gap-1"><legend className="mb-1 font-medium">Días de atención</legend>
            <div className="flex flex-wrap gap-1.5">{DIAS.map(([n, l]) => <label key={n} className="flex items-center gap-1 rounded border border-border px-2 py-1"><input type="checkbox" checked={cfg.dias.includes(n)} onChange={() => dia(n)} />{l}</label>)}</div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1"><Label htmlFor="dl-ini" className="text-xs">Desde</Label><Input id="dl-ini" type="time" value={cfg.hora_inicio} onChange={(e) => setCfg({ ...cfg, hora_inicio: e.target.value })} /></div>
            <div className="grid gap-1"><Label htmlFor="dl-fin" className="text-xs">Hasta</Label><Input id="dl-fin" type="time" value={cfg.hora_fin} onChange={(e) => setCfg({ ...cfg, hora_fin: e.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={conVacaciones} onChange={(e) => setConVacaciones(e.target.checked)} />Vacaciones programadas</label>
          {conVacaciones && (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1"><Label htmlFor="dl-vd" className="text-xs">Del</Label><Input id="dl-vd" type="date" value={cfg.vacaciones_desde ?? ''} onChange={(e) => setCfg({ ...cfg, vacaciones_desde: e.target.value || null })} /></div>
              <div className="grid gap-1"><Label htmlFor="dl-vh" className="text-xs">Al</Label><Input id="dl-vh" type="date" value={cfg.vacaciones_hasta ?? ''} onChange={(e) => setCfg({ ...cfg, vacaciones_hasta: e.target.value || null })} /></div>
            </div>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.pausado} onChange={(e) => setCfg({ ...cfg, pausado: e.target.checked })} />Pausar la recepción (hasta que la reactives)</label>
          {cfg.pausado && <div className="grid gap-1"><Label htmlFor="dl-pm" className="text-xs">Motivo de la pausa *</Label><Input id="dl-pm" value={cfg.pausa_motivo ?? ''} onChange={(e) => setCfg({ ...cfg, pausa_motivo: e.target.value })} /></div>}
          <div className="grid gap-1"><Label htmlFor="dl-mot" className="text-xs">Motivo del cambio *</Label><Textarea id="dl-mot" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} onClick={async () => { setEnviando(true); await onGuardar(final, motivo.trim()); setEnviando(false) }}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AsignarManual({ lead, personas, error, onClose, onAsignar }: { lead: Lead; personas: Participante[]; error: string | null; onClose: () => void; onAsignar: (vendedor: string, motivo: string) => Promise<void> }) {
  const [vendedor, setVendedor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar a {lead.nombre}</DialogTitle>
          <DialogDescription>Solo para un caso puntual (p. ej. nadie de turno). No cambia la rotación.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="grid gap-1"><Label htmlFor="am-v" className="text-xs">Vendedor *</Label>
            <select id="am-v" className="h-9 rounded-md border border-border bg-white px-2 text-xs" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
              <option value="">Elige</option>{personas.map((p) => <option key={p.userId} value={p.userId}>{p.nombre} · {ESTADO_PARTICIPANTE[p.estado].label}</option>)}
            </select>
          </div>
          <div className="grid gap-1"><Label htmlFor="am-m" className="text-xs">Motivo *</Label><Textarea id="am-m" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!vendedor || motivo.trim().length < 5 || enviando} onClick={async () => { setEnviando(true); await onAsignar(vendedor, motivo.trim()); setEnviando(false) }}>Asignar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
