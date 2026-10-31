import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'

interface Equipo { id: string; nombre: string; supervisor_id: string | null }
interface Persona { id: string; nombre: string; estado: string; equipo_id: string | null }
interface Borrador { id: string | null; nombre: string; supervisorId: string; gerentes: string[] }

/** Equipos reales: un usuario con alcance «Equipo asignado» ve a los integrantes de los equipos que supervisa o gerencia. */
export default function EquiposRemoto({ datos, version = 0, onCambio }: { datos: Datos; version?: number; onCambio?: () => void }) {
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [gerentes, setGerentes] = useState<{ team_id: string; user_id: string }[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [draft, setDraft] = useState<Borrador | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [e, g, p] = await Promise.all([
        datos.select<Equipo>('teams', { orden: [{ columna: 'nombre' }] }),
        datos.select<{ team_id: string; user_id: string }>('team_managers'),
        datos.select<Persona>('profiles', { orden: [{ columna: 'nombre' }] }),
      ])
      setEquipos(e); setGerentes(g); setPersonas(p)
    } catch (err) { setError((err as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar, version])

  const activos = personas.filter((p) => p.estado === 'activo')
  const nombre = (id: string | null) => personas.find((p) => p.id === id)?.nombre ?? 'Sin asignar'

  async function guardar() {
    if (!draft) return
    setError(null)
    try {
      await datos.rpc('config_guardar_equipo', { p_id: draft.id, p_nombre: draft.nombre, p_supervisor: draft.supervisorId || null, p_gerentes: draft.gerentes, p_motivo: motivo })
      setAviso(`Equipo ${draft.nombre} guardado`); setDraft(null); await cargar(); onCambio?.()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <section aria-labelledby="eq-tit" className="dashboard-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="eq-tit" className="text-sm font-semibold">Equipos ({equipos.length})</h2>
        <Button size="sm" variant="outline" onClick={() => { setDraft({ id: null, nombre: '', supervisorId: '', gerentes: [] }); setMotivo(''); setError(null); setAviso(null) }}><Plus />Nuevo equipo</Button>
      </div>
      {aviso && <p role="status" className="m-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      {!draft && <div className="px-3 pt-2 empty:hidden"><FieldError>{error}</FieldError></div>}
      {equipos.length === 0
        ? <p className="p-6 text-center text-xs text-muted-foreground">Crea equipos para agrupar vendedores y corredores bajo un supervisor.</p>
        : (
          <ul className="divide-y divide-border">
            {equipos.map((e) => {
              const miembros = personas.filter((p) => p.equipo_id === e.id)
              const ger = gerentes.filter((g) => g.team_id === e.id).map((g) => g.user_id)
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-2 px-4 py-3 text-xs">
                  <div className="flex-1">
                    <div className="font-semibold">{e.nombre}</div>
                    <div className="text-muted-foreground">Supervisor: {nombre(e.supervisor_id)} · Gerencia: {ger.map(nombre).join(', ') || 'Sin asignar'}</div>
                    <div className="mt-1">{miembros.length ? miembros.map((m) => m.nombre).join(', ') : <span className="text-muted-foreground">Sin integrantes: asígnalos en cada usuario.</span>}</div>
                  </div>
                  <Button size="xs" variant="ghost" aria-label={`Editar equipo ${e.nombre}`} onClick={() => { setDraft({ id: e.id, nombre: e.nombre, supervisorId: e.supervisor_id ?? '', gerentes: ger }); setMotivo(''); setError(null); setAviso(null) }}><Pencil />Editar</Button>
                </li>
              )
            })}
          </ul>
        )}

      {draft && (
        <Dialog open onOpenChange={(o) => { if (!o) setDraft(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{draft.id ? `Editar ${draft.nombre}` : 'Nuevo equipo'}</DialogTitle><DialogDescription>Los integrantes se asignan desde cada usuario.</DialogDescription></DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5"><Label htmlFor="eq-nombre" className="text-xs">Nombre *</Label><Input id="eq-nombre" value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="eq-sup" className="text-xs">Supervisor</Label>
                <select id="eq-sup" className="h-9 rounded-md border border-border bg-white px-2 text-xs" value={draft.supervisorId} onChange={(e) => setDraft({ ...draft, supervisorId: e.target.value })}>
                  <option value="">Sin asignar</option>{activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </div>
              <fieldset className="grid gap-1 text-xs"><legend className="mb-1 font-medium">Gerencia del equipo</legend>
                <div className="grid max-h-32 gap-1 overflow-y-auto">
                  {activos.map((p) => (
                    <label key={p.id} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.gerentes.includes(p.id)} onChange={() => setDraft({ ...draft, gerentes: draft.gerentes.includes(p.id) ? draft.gerentes.filter((x) => x !== p.id) : [...draft.gerentes, p.id] })} />{p.nombre}</label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-1.5"><Label htmlFor="eq-motivo" className="text-xs">Motivo *</Label><Textarea id="eq-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
              <FieldError>{error}</FieldError>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button disabled={draft.nombre.trim().length < 3 || motivo.trim().length < 5} onClick={() => void guardar()}>Guardar equipo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
