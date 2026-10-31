import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react'
import { ACCION_PERMISO, ACCIONES, ALCANCES, CATALOGO, type AccionPermiso, type Permiso, type TipoAlcance } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'

interface RolFila { id: string; nombre: string; descripcion: string; alcance: TipoAlcance; sistema: boolean; disponible: boolean }
interface Borrador { id: string | null; nombre: string; descripcion: string; alcance: TipoAlcance; permisos: string[] }

/** Roles reales de la base. El servidor impide conceder lo que no se tiene y dejar el sistema sin administrador. */
export default function RolesRemoto({ datos }: { datos: Datos }) {
  const [roles, setRoles] = useState<RolFila[] | null>(null)
  const [permisos, setPermisos] = useState<Record<string, string[]>>(() => Object.create(null))
  const [uso, setUso] = useState<Record<string, number>>(() => Object.create(null))
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Borrador | null>(null)
  const [motivo, setMotivo] = useState('')
  const [eliminar, setEliminar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [r, rp, cuentas] = await Promise.all([
        datos.select<RolFila>('roles', { orden: [{ columna: 'nombre' }] }),
        datos.select<{ role_id: string; permiso: string }>('role_permissions'),
        datos.rpc<{ rol_id: string | null }[]>('config_listar_cuentas').catch(() => []),
      ])
      setRoles(r)
      // Sin prototipo: el identificador «constructor» chocaría con Object.prototype.constructor.
      const m: Record<string, string[]> = Object.create(null)
      rp.forEach((x) => { (m[x.role_id] ??= []).push(x.permiso) })
      setPermisos(m)
      const u: Record<string, number> = Object.create(null)
      cuentas.forEach((c) => { if (c.rol_id) u[c.rol_id] = (u[c.rol_id] ?? 0) + 1 })
      setUso(u)
      setSel((s) => s ?? r[0]?.id ?? null)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const rol = roles?.find((r) => r.id === sel) ?? null
  const editar = (r: RolFila | null) => {
    setError(null); setAviso(null); setMotivo('')
    setDraft(r ? { id: r.id, nombre: r.nombre, descripcion: r.descripcion, alcance: r.alcance, permisos: permisos[r.id] ?? [] } : { id: null, nombre: '', descripcion: '', alcance: 'propio', permisos: [] })
  }
  async function guardar() {
    if (!draft) return
    setError(null)
    try {
      const id = await datos.rpc<string>('config_guardar_rol', { p_id: draft.id, p_nombre: draft.nombre, p_descripcion: draft.descripcion, p_alcance: draft.alcance, p_permisos: draft.permisos, p_motivo: motivo })
      setAviso(`Rol ${draft.nombre} guardado`); setSel(id); setDraft(null); await cargar()
    } catch (e) { setError((e as Error).message) }
  }

  if (!roles) return error ? <FieldError>{error}</FieldError> : <p className="text-sm text-muted-foreground">Cargando roles…</p>
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <section className="dashboard-card self-start p-3">
        <ul className="grid gap-1">
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" aria-pressed={sel === r.id} onClick={() => { setSel(r.id); setDraft(null); setError(null) }}
                className={cn('w-full rounded-lg px-3 py-2 text-left text-xs', sel === r.id ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted')}>
                <div className="font-semibold">{r.nombre}</div>
                <div className="text-[11px] text-muted-foreground">{uso[r.id] ?? 0} usuarios{r.disponible ? '' : ' · no disponible para cuentas nuevas'}</div>
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => editar(null)}><Plus />Nuevo rol</Button>
      </section>

      <section className="dashboard-card min-w-0 p-5">
        {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
        {draft ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label htmlFor="rol-nombre" className="text-xs">Nombre *</Label><Input id="rol-nombre" value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rol-desc" className="text-xs">Descripción</Label><Input id="rol-desc" value={draft.descripcion} onChange={(e) => setDraft({ ...draft, descripcion: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="rol-alcance" className="text-xs">Alcance de datos</Label>
                <select id="rol-alcance" className="h-9 rounded-md border border-border bg-white px-2 text-xs" value={draft.alcance} onChange={(e) => setDraft({ ...draft, alcance: e.target.value as TipoAlcance })}>
                  {Object.entries(ALCANCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <MatrizAcciones seleccion={draft.permisos} onChange={(p) => setDraft({ ...draft, permisos: p })} />
            <div className="grid gap-1.5"><Label htmlFor="rol-motivo" className="text-xs">Motivo del cambio *</Label><Textarea id="rol-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <FieldError>{error}</FieldError>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button disabled={motivo.trim().length < 5 || draft.nombre.trim().length < 3} onClick={() => void guardar()}>Guardar rol</Button>
            </div>
          </div>
        ) : rol && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1"><h2 className="text-base font-semibold">{rol.nombre}</h2><p className="text-xs text-muted-foreground">{rol.descripcion} · Alcance: {ALCANCES[rol.alcance]}</p></div>
              <Button size="sm" variant="outline" onClick={() => editar(rol)}><Pencil />Editar</Button>
              {!rol.sistema && <Button size="sm" variant="outline" onClick={() => { setMotivo(''); setError(null); setEliminar(true) }}><Trash2 />Eliminar</Button>}
            </div>
            <FieldError>{!eliminar && error}</FieldError>
            <MatrizAcciones seleccion={permisos[rol.id] ?? []} />
          </div>
        )}
      </section>

      {eliminar && rol && (
        <Dialog open onOpenChange={(o) => { if (!o) setEliminar(false) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Eliminar el rol {rol.nombre}</DialogTitle><DialogDescription>Solo se puede eliminar si no tiene usuarios asignados.</DialogDescription></DialogHeader>
            <div className="grid gap-1.5"><Label htmlFor="rol-el-motivo" className="text-xs">Motivo *</Label><Textarea id="rol-el-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <FieldError>{error}</FieldError>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEliminar(false)}>Cancelar</Button>
              <Button variant="destructive" disabled={motivo.trim().length < 5} onClick={() => void (async () => {
                setError(null)
                try { await datos.rpc('config_eliminar_rol', { p_id: rol.id, p_motivo: motivo }); setAviso(`Rol ${rol.nombre} eliminado`); setSel(null); setEliminar(false); await cargar() } catch (e) { setError((e as Error).message) }
              })()}>Eliminar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** Permisos por módulo y acción: Ver, Crear y editar, Aprobar, Anular y Otras. Solo aparecen las operaciones reales de cada módulo. */
export function MatrizAcciones({ seleccion, onChange }: { seleccion: string[]; onChange?: (p: string[]) => void }) {
  const set = useMemo(() => new Set(seleccion), [seleccion])
  const toggle = (p: string) => onChange?.(set.has(p) ? seleccion.filter((x) => x !== p) : [...seleccion, p])
  const columnas = Object.keys(ACCIONES) as AccionPermiso[]
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[820px] text-xs" aria-label="Permisos por módulo y acción">
        <thead className="bg-muted text-[11px] text-muted-foreground">
          <tr><th className="px-3 py-2 text-left font-medium">Módulo</th>{columnas.map((c) => <th key={c} className="px-3 py-2 text-left font-medium">{ACCIONES[c]}</th>)}</tr>
        </thead>
        <tbody>
          {CATALOGO.map((m) => (
            <tr key={m.modulo} className="border-t border-border align-top">
              <th scope="row" className="px-3 py-2 text-left font-semibold">{m.modulo}</th>
              {columnas.map((c) => (
                <td key={c} className="px-3 py-2">
                  <div className="grid gap-1">
                    {m.permisos.filter(([p]) => ACCION_PERMISO[p as Permiso] === c).map(([p, label]) => (
                      <label key={p} className="flex items-start gap-1.5">
                        <input type="checkbox" className="mt-0.5" checked={set.has(p)} disabled={!onChange} onChange={() => toggle(p)} /><span>{label}</span>
                      </label>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
