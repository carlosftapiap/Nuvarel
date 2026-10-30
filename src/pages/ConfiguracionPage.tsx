import { useMemo, useState } from 'react'
import { CheckCircle2, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { ALCANCES, CATALOGO, ETIQUETA_PERMISO, rolLabel, type Excepcion, type Permiso, type TipoAlcance } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ESTADOS_USUARIO, PROYECTOS, type RolDef, type Usuario } from '@/features/config/model'
import {
  actualizarUsuario, cambiarEstadoUsuario, eliminarRol, fijarExcepcion, guardarEquipo, guardarRol, invitarUsuario,
  permisosEfectivos, type UsuarioInput,
} from '@/features/config/service'
import { useDirectorio } from '@/features/config/store'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtFecha } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { useReservas } from '@/features/reservas/store'
import { cn } from '@/lib/utils'
import { useConexion } from '@/app/auth'
import UsuariosRemoto, { AuditoriaRemota, type AccionesCuenta } from '@/features/config/remoto/UsuariosRemoto'
import { supabase } from '@/lib/supabase'

/** Acciones de Supabase Auth: recuperación (cualquier correo, respuesta neutra) e invitación (función del servidor con permisos verificados). */
const accionesSupabase: AccionesCuenta = {
  enviarRecuperacion: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` })
    if (error) throw new Error(error.message)
  },
  invitar: async ({ nombre, email, rolId, motivo }) => {
    const { error } = await supabase.functions.invoke('invitar-usuario', { body: { nombre, email, rolId, alcance: null, supervisorId: null, equipoId: null, proyectos: ['AMURA'], motivo } })
    if (error) throw new Error(`No se pudo invitar: ${error.message}. Verifica que la función invitar-usuario esté desplegada.`)
  },
}

export default function ConfiguracionPage() {
  const { remoto, datos } = useConexion()
  return remoto && datos ? <ConfiguracionRemota /> : <ConfiguracionLocal />
}

/** Con Supabase: usuarios y auditoría reales. Roles, equipos y excepciones individuales aún se editan en modo local. */
function ConfiguracionRemota() {
  const { can } = useSession()
  const { datos } = useConexion()
  return (
    <>
      <PageHeader eyebrow="Sistema · Configuración" title="Configuración" subtitle="Usuarios reales de Supabase y auditoría. Cada cambio de acceso exige motivo y queda registrado." />
      <Tabs defaultValue={can('config.usuarios') ? 'usuarios' : 'auditoria'} className="min-w-0">
        <TabsList className="mb-3">
          {can('config.usuarios') && <TabsTrigger value="usuarios">Usuarios</TabsTrigger>}
          {can('config.auditoria') && <TabsTrigger value="auditoria">Auditoría</TabsTrigger>}
        </TabsList>
        {can('config.usuarios') && <TabsContent value="usuarios"><UsuariosRemoto datos={datos!} acciones={accionesSupabase} /></TabsContent>}
        {can('config.auditoria') && <TabsContent value="auditoria"><AuditoriaRemota datos={datos!} /></TabsContent>}
      </Tabs>
    </>
  )
}

function ConfiguracionLocal() {
  const { can } = useSession()
  const [aviso, setAviso] = useState<string | null>(null)
  const tabs = [
    can('config.usuarios') && 'usuarios',
    can('config.roles') && 'roles',
    can('config.equipos') && 'equipos',
    can('config.auditoria') && 'auditoria',
  ].filter(Boolean) as string[]
  return (
    <>
      <PageHeader eyebrow="Sistema · Configuración" title="Configuración"
        subtitle="Usuarios, roles y permisos, equipos y auditoría. Cada cambio de acceso queda registrado con su motivo." />
      {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Modo local: las invitaciones se registran aquí y la cuenta real se crea al conectar Supabase (función del servidor <code>invitar-usuario</code>), que envía el correo para que cada persona defina su propia contraseña.
      </p>
      <Tabs defaultValue={tabs[0]} className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto">
          {tabs.includes('usuarios') && <TabsTrigger value="usuarios">Usuarios</TabsTrigger>}
          {tabs.includes('roles') && <TabsTrigger value="roles">Roles y permisos</TabsTrigger>}
          {tabs.includes('equipos') && <TabsTrigger value="equipos">Equipos</TabsTrigger>}
          {tabs.includes('auditoria') && <TabsTrigger value="auditoria">Auditoría</TabsTrigger>}
        </TabsList>
        <TabsContent value="usuarios" className="min-w-0"><Usuarios onMessage={setAviso} /></TabsContent>
        <TabsContent value="roles" className="min-w-0"><Roles onMessage={setAviso} /></TabsContent>
        <TabsContent value="equipos" className="min-w-0"><Equipos onMessage={setAviso} /></TabsContent>
        <TabsContent value="auditoria" className="min-w-0"><Auditoria /></TabsContent>
      </Tabs>
    </>
  )
}

/* ------------------------------------------------------------------ usuarios */

function Usuarios({ onMessage }: { onMessage: (m: string) => void }) {
  const { state } = useDirectorio()
  const [form, setForm] = useState<{ open: boolean; id?: string }>({ open: false })
  const [estado, setEstado] = useState<Usuario | null>(null)
  const [permisos, setPermisos] = useState<Usuario | null>(null)
  const nombre = (id: string | null) => state.usuarios.find((u) => u.id === id)?.nombre ?? '—'
  return (
    <section className="dashboard-card !p-0 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{state.usuarios.length} usuarios</h2>
        <Button size="sm" onClick={() => setForm({ open: true })}><UserPlus />Invitar usuario</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted text-[11px] text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Usuario</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2 text-left font-medium">Rol</th><th className="px-2 py-2 text-left font-medium">Equipo · supervisor</th><th className="px-2 py-2 text-left font-medium">Proyectos</th><th className="px-4 py-2 text-right font-medium">Acciones</th></tr>
          </thead>
          <tbody>
            {state.usuarios.map((u) => {
              const exc = Object.keys(u.excepciones).length
              return (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2"><div className="font-semibold">{u.nombre}</div><div className="text-[11px] text-muted-foreground">{u.email || 'sin correo'}</div></td>
                  <td className="px-2 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', ESTADOS_USUARIO[u.estado].tone)}>{ESTADOS_USUARIO[u.estado].label}</span></td>
                  <td className="px-2 py-2">{state.roles.find((r) => r.id === u.rolId)?.nombre ?? rolLabel(u.rolId)}{exc > 0 && <div className="text-[11px] text-amber-700">{exc} excepción(es)</div>}{u.alcance && <div className="text-[11px] text-muted-foreground">Alcance: {u.alcance}</div>}</td>
                  <td className="px-2 py-2">{state.equipos.find((e) => e.id === u.equipoId)?.nombre ?? '—'}<div className="text-[11px] text-muted-foreground">{nombre(u.supervisorId)}</div></td>
                  <td className="px-2 py-2">{u.proyectos.join(', ') || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setForm({ open: true, id: u.id })}><Pencil />Editar</Button>
                      <Button size="xs" variant="ghost" onClick={() => setPermisos(u)}><ShieldCheck />Permisos</Button>
                      <Button size="xs" variant="outline" onClick={() => setEstado(u)}>{u.estado === 'activo' ? 'Desactivar' : 'Activar'}</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <UsuarioDialog open={form.open} id={form.id} onClose={() => setForm({ open: false })} onMessage={onMessage} />
      <EstadoDialog usuario={estado} onClose={() => setEstado(null)} onMessage={onMessage} />
      <PermisosUsuarioDialog usuario={permisos} onClose={() => setPermisos(null)} onMessage={onMessage} />
    </section>
  )
}

function UsuarioDialog({ open, id, onClose, onMessage }: { open: boolean; id?: string; onClose: () => void; onMessage: (m: string) => void }) {
  const { state, update } = useDirectorio()
  const { actor } = useSession()
  const u = id ? state.usuarios.find((x) => x.id === id) : undefined
  const inicial: UsuarioInput = u
    ? { nombre: u.nombre, email: u.email, rolId: u.rolId, alcance: u.alcance, supervisorId: u.supervisorId, equipoId: u.equipoId, proyectos: [...u.proyectos] }
    : { nombre: '', email: '', rolId: 'asesor', alcance: null, supervisorId: null, equipoId: null, proyectos: ['AMURA'] }
  const [f, setF] = useState<UsuarioInput>(inicial)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [abiertoPara, setAbiertoPara] = useState<string | undefined | null>(null)
  if (open && abiertoPara !== (id ?? '')) { setAbiertoPara(id ?? ''); setF(inicial); setMotivo(''); setError(null) }
  if (!open && abiertoPara !== null) setAbiertoPara(null)

  function guardar() {
    setError(null)
    try {
      if (u) { update((s) => actualizarUsuario(s, u.id, f, motivo, actor)); onMessage(`Usuario ${f.nombre} actualizado`) }
      else { update((s) => invitarUsuario(s, f, motivo, actor).dir); onMessage(`Invitación registrada para ${f.email}`) }
      onClose()
    } catch (e) { setError((e as Error).message) }
  }
  const candidatos = state.usuarios.filter((x) => x.id !== id && x.estado !== 'inactivo')
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{u ? 'Editar usuario' : 'Invitar usuario'}</DialogTitle>
          <DialogDescription>{u ? u.email : 'La persona recibirá un correo para crear su propia contraseña. Aquí no se guardan contraseñas.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="us-nombre" label="Nombre *" value={f.nombre} onChange={(v) => setF({ ...f, nombre: v })} />
            <Campo id="us-email" label="Correo *" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Sel id="us-rol" label="Rol base *" value={f.rolId} onChange={(v) => setF({ ...f, rolId: v })} items={state.roles.map((r) => [r.id, r.nombre])} />
            <Sel id="us-alcance" label="Alcance de datos" value={f.alcance ?? 'rol'} onChange={(v) => setF({ ...f, alcance: v === 'rol' ? null : (v as TipoAlcance) })}
              items={[['rol', 'El del rol'], ...Object.entries(ALCANCES)]} />
            <Sel id="us-equipo" label="Equipo" value={f.equipoId ?? 'ninguno'} onChange={(v) => setF({ ...f, equipoId: v === 'ninguno' ? null : v })}
              items={[['ninguno', 'Sin equipo'], ...state.equipos.map((e) => [e.id, e.nombre] as [string, string])]} />
            <Sel id="us-sup" label="Supervisor directo" value={f.supervisorId ?? 'ninguno'} onChange={(v) => setF({ ...f, supervisorId: v === 'ninguno' ? null : v })}
              items={[['ninguno', 'Sin supervisor'], ...candidatos.map((x) => [x.id, x.nombre] as [string, string])]} />
          </div>
          <fieldset className="grid gap-1">
            <legend className="text-xs">Proyectos asignados</legend>
            {PROYECTOS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={f.proyectos.includes(p.id)} onChange={(e) => setF({ ...f, proyectos: e.target.checked ? [...f.proyectos, p.id] : f.proyectos.filter((x) => x !== p.id) })} />{p.nombre}
              </label>
            ))}
          </fieldset>
          <Motivo value={motivo} onChange={setMotivo} id="us-motivo" />
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={guardar} disabled={motivo.trim().length < 5}>{u ? 'Guardar' : 'Registrar invitación'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EstadoDialog({ usuario, onClose, onMessage }: { usuario: Usuario | null; onClose: () => void; onMessage: (m: string) => void }) {
  const { update } = useDirectorio()
  const { actor } = useSession()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!usuario) return null
  const destino = usuario.estado === 'activo' ? 'inactivo' : 'activo'
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); setError(null); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{destino === 'inactivo' ? 'Desactivar' : 'Activar'} a {usuario.nombre}</DialogTitle>
          <DialogDescription>{destino === 'inactivo'
            ? 'Pierde el acceso y deja de recibir asignaciones. Se conservan sus clientes, ventas e historial; reasigna sus pendientes desde Clientes.'
            : usuario.estado === 'invitado' ? 'Úsalo cuando la persona haya aceptado la invitación.' : 'Recupera el acceso con su rol y excepciones.'}</DialogDescription>
        </DialogHeader>
        <Motivo value={motivo} onChange={setMotivo} id="est-motivo" />
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant={destino === 'inactivo' ? 'destructive' : 'default'} disabled={motivo.trim().length < 5}
            onClick={() => { try { update((s) => cambiarEstadoUsuario(s, usuario.id, destino, motivo, actor)); onMessage(`${usuario.nombre}: ${destino}`); setMotivo(''); onClose() } catch (e) { setError((e as Error).message) } }}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermisosUsuarioDialog({ usuario, onClose, onMessage }: { usuario: Usuario | null; onClose: () => void; onMessage: (m: string) => void }) {
  const { state, update } = useDirectorio()
  const { actor, can } = useSession()
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  if (!usuario) return null
  const u = state.usuarios.find((x) => x.id === usuario.id) ?? usuario
  const rol = state.roles.find((r) => r.id === u.rolId)
  const efectivos = new Set(permisosEfectivos(state, { ...u, estado: 'activo' }))
  function fijar(p: Permiso, v: Excepcion | 'heredar') {
    setError(null)
    try { update((s) => fijarExcepcion(s, u.id, p, v, motivo, actor)); onMessage(`${u.nombre}: ${ETIQUETA_PERMISO[p]} → ${v}`) } catch (e) { setError((e as Error).message) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); setError(null); onClose() } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Permisos de {u.nombre}</DialogTitle>
          <DialogDescription>Rol base: {rol?.nombre}. Cada excepción hereda, permite o deniega un permiso solo para esta persona. Denegar prevalece; lo no definido se deniega.</DialogDescription>
        </DialogHeader>
        <Motivo value={motivo} onChange={setMotivo} id="perm-motivo" />
        <FieldError>{error}</FieldError>
        {!can('config.roles') && <FieldError>Tu usuario no puede modificar permisos.</FieldError>}
        <div className="grid gap-3">
          {CATALOGO.map((m) => (
            <div key={m.modulo}>
              <h3 className="mb-1 text-xs font-semibold">{m.modulo}</h3>
              <ul className="grid gap-1">
                {m.permisos.map(([p, label]) => {
                  const exc = u.excepciones[p as Permiso]
                  const delRol = rol?.permisos.includes(p as Permiso) ?? false
                  return (
                    <li key={p} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1 text-xs odd:bg-muted/40">
                      <span>{label} <span className="text-[10px] text-muted-foreground">({delRol ? 'el rol lo incluye' : 'el rol no lo incluye'})</span></span>
                      <span className={cn('text-[10px] font-medium', efectivos.has(p as Permiso) ? 'text-emerald-700' : 'text-muted-foreground')}>{efectivos.has(p as Permiso) ? 'Permitido' : 'Denegado'}</span>
                      <select aria-label={`Excepción para ${label}`} value={exc ?? 'heredar'} disabled={!can('config.roles') || motivo.trim().length < 5}
                        onChange={(e) => fijar(p as Permiso, e.target.value as Excepcion | 'heredar')}
                        className="h-7 rounded-md border border-input bg-background px-1 text-[11px] disabled:opacity-50">
                        <option value="heredar">Heredar</option><option value="permitir">Permitir</option><option value="denegar">Denegar</option>
                      </select>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------- roles */

function Roles({ onMessage }: { onMessage: (m: string) => void }) {
  const { state, update } = useDirectorio()
  const { actor } = useSession()
  const [sel, setSel] = useState<string>(state.roles[0]?.id ?? '')
  const [draft, setDraft] = useState<{ id: string | null; nombre: string; descripcion: string; alcance: TipoAlcance; permisos: Permiso[] } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rol = state.roles.find((r) => r.id === sel)
  const editar = (r: RolDef | null) => {
    setError(null); setMotivo('')
    setDraft(r ? { id: r.id, nombre: r.nombre, descripcion: r.descripcion, alcance: r.alcance, permisos: [...r.permisos] } : { id: null, nombre: '', descripcion: '', alcance: 'propio', permisos: [] })
  }
  function guardar() {
    if (!draft) return
    setError(null)
    try { update((s) => guardarRol(s, draft.id, draft, motivo, actor)); onMessage(`Rol ${draft.nombre} guardado`); setDraft(null) } catch (e) { setError((e as Error).message) }
  }
  const uso = (id: string) => state.usuarios.filter((u) => u.rolId === id).length
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <section className="dashboard-card p-3">
        <ul className="grid gap-1">
          {state.roles.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setSel(r.id); setDraft(null) }} aria-pressed={sel === r.id}
                className={cn('w-full rounded-lg px-3 py-2 text-left text-xs', sel === r.id ? 'bg-secondary text-secondary-foreground' : 'hover:bg-muted')}>
                <div className="font-semibold">{r.nombre}</div>
                <div className="text-[11px] text-muted-foreground">{r.permisos.length} permisos · {uso(r.id)} usuarios</div>
              </button>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => editar(null)}><Plus />Nuevo rol</Button>
      </section>
      <section className="dashboard-card p-5">
        {draft ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo id="rol-nombre" label="Nombre *" value={draft.nombre} onChange={(v) => setDraft({ ...draft, nombre: v })} />
              <Campo id="rol-desc" label="Descripción" value={draft.descripcion} onChange={(v) => setDraft({ ...draft, descripcion: v })} />
              <Sel id="rol-alcance" label="Alcance de datos" value={draft.alcance} onChange={(v) => setDraft({ ...draft, alcance: v as TipoAlcance })} items={Object.entries(ALCANCES)} />
            </div>
            <MatrizPermisos seleccion={draft.permisos} onChange={(p) => setDraft({ ...draft, permisos: p })} />
            <Motivo value={motivo} onChange={setMotivo} id="rol-motivo" />
            <FieldError>{error}</FieldError>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button>
              <Button onClick={guardar} disabled={motivo.trim().length < 5}>Guardar rol</Button>
            </div>
          </div>
        ) : rol ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1"><h2 className="text-base font-semibold">{rol.nombre}</h2><p className="text-xs text-muted-foreground">{rol.descripcion} · Alcance: {ALCANCES[rol.alcance]}</p></div>
              <Button size="sm" variant="outline" onClick={() => editar(rol)}><Pencil />Editar</Button>
              {!rol.sistema && <Button size="sm" variant="outline" onClick={() => {
                const m = window.prompt('Motivo para eliminar el rol')
                if (m) { try { update((s) => eliminarRol(s, rol.id, m, actor)); onMessage(`Rol ${rol.nombre} eliminado`); setSel(state.roles[0].id) } catch (e) { setError((e as Error).message) } }
              }}><Trash2 />Eliminar</Button>}
            </div>
            <FieldError>{error}</FieldError>
            <MatrizPermisos seleccion={rol.permisos} />
          </div>
        ) : null}
      </section>
    </div>
  )
}

function MatrizPermisos({ seleccion, onChange }: { seleccion: Permiso[]; onChange?: (p: Permiso[]) => void }) {
  const set = new Set(seleccion)
  const toggle = (p: Permiso) => onChange?.(set.has(p) ? seleccion.filter((x) => x !== p) : [...seleccion, p])
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CATALOGO.map((m) => (
        <fieldset key={m.modulo} className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">{m.modulo}</legend>
          {m.permisos.map(([p, label]) => (
            <label key={p} className="flex items-center gap-2 py-0.5 text-xs">
              <input type="checkbox" checked={set.has(p as Permiso)} disabled={!onChange} onChange={() => toggle(p as Permiso)} />{label}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ equipos */

function Equipos({ onMessage }: { onMessage: (m: string) => void }) {
  const { state, update } = useDirectorio()
  const { actor } = useSession()
  const [draft, setDraft] = useState<{ id: string | null; nombre: string; supervisorId: string | null; gerenciaIds: string[] } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const personas = state.usuarios.filter((u) => u.estado !== 'inactivo')
  const nombre = (id: string | null) => state.usuarios.find((u) => u.id === id)?.nombre ?? '—'
  function guardar() {
    if (!draft) return
    setError(null)
    try { update((s) => guardarEquipo(s, draft.id, draft, motivo, actor)); onMessage(`Equipo ${draft.nombre} guardado`); setDraft(null); setMotivo('') } catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <section className="dashboard-card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{state.equipos.length} equipos</h2>
          <Button size="sm" onClick={() => { setDraft({ id: null, nombre: '', supervisorId: null, gerenciaIds: [] }); setMotivo(''); setError(null) }}><Plus />Nuevo equipo</Button>
        </div>
        {state.equipos.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">Crea equipos para agrupar vendedores bajo un supervisor y asignarlos a una gerencia.</p> : (
          <ul className="divide-y divide-border">
            {state.equipos.map((e) => {
              const miembros = state.usuarios.filter((u) => u.equipoId === e.id)
              return (
                <li key={e.id} className="flex flex-wrap items-start gap-2 px-4 py-3 text-xs">
                  <div className="flex-1">
                    <div className="font-semibold">{e.nombre}</div>
                    <div className="text-muted-foreground">Supervisor: {nombre(e.supervisorId)} · Gerencia: {e.gerenciaIds.map(nombre).join(', ') || '—'}</div>
                    <div className="mt-1">{miembros.length ? miembros.map((m) => m.nombre).join(', ') : <span className="text-muted-foreground">Sin integrantes (asígnalos desde Usuarios)</span>}</div>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => { setDraft({ id: e.id, nombre: e.nombre, supervisorId: e.supervisorId, gerenciaIds: [...e.gerenciaIds] }); setMotivo(''); setError(null) }}><Pencil />Editar</Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {draft && (
        <section className="dashboard-card grid content-start gap-3 p-5" aria-label="Editar equipo">
          <Campo id="eq-nombre" label="Nombre *" value={draft.nombre} onChange={(v) => setDraft({ ...draft, nombre: v })} />
          <Sel id="eq-sup" label="Supervisor" value={draft.supervisorId ?? 'ninguno'} onChange={(v) => setDraft({ ...draft, supervisorId: v === 'ninguno' ? null : v })}
            items={[['ninguno', 'Sin supervisor'], ...personas.map((u) => [u.id, u.nombre] as [string, string])]} />
          <fieldset className="grid gap-1">
            <legend className="text-xs">Gerencias que supervisan este equipo</legend>
            {personas.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={draft.gerenciaIds.includes(u.id)} onChange={(e) => setDraft({ ...draft, gerenciaIds: e.target.checked ? [...draft.gerenciaIds, u.id] : draft.gerenciaIds.filter((x) => x !== u.id) })} />
                {u.nombre} <span className="text-muted-foreground">· {rolLabel(u.rolId)}</span>
              </label>
            ))}
          </fieldset>
          <Motivo value={motivo} onChange={setMotivo} id="eq-motivo" />
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button><Button onClick={guardar} disabled={motivo.trim().length < 5}>Guardar</Button></div>
        </section>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- auditoría */

function Auditoria() {
  const { state: dir } = useDirectorio()
  const { state: inv } = useInventory()
  const { state: res } = useReservas()
  const [q, setQ] = useState('')
  const filas = useMemo(() => {
    const out: { fecha: string; actor: string; accion: string; motivo: string; detalle: string }[] = []
    dir.auditoria.forEach((a) => out.push({ fecha: a.fecha, actor: a.actorNombre, accion: a.accion, motivo: a.motivo, detalle: `${a.antes} → ${a.despues}` }))
    inv.priceHistory.forEach((h) => out.push({ fecha: h.fecha, actor: h.usuario, accion: `Precio · ${h.tipo}`, motivo: h.motivo, detalle: `${h.alcance} · ${h.detalle}` }))
    inv.statusHistory.forEach((h) => out.push({ fecha: h.fecha, actor: h.usuario, accion: 'Estado de unidad', motivo: h.motivo, detalle: `${h.codigo}: ${h.de} → ${h.a}` }))
    res.reservas.forEach((r) => r.historial.forEach((h) => out.push({ fecha: h.fecha, actor: h.usuario, accion: `Reserva ${r.codigo}`, motivo: '', detalle: h.texto })))
    return out.sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [dir.auditoria, inv.priceHistory, inv.statusHistory, res.reservas])
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const vis = filas.filter((f) => !q.trim() || norm(`${f.actor} ${f.accion} ${f.motivo} ${f.detalle}`).includes(norm(q)))
  return (
    <section className="dashboard-card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Auditoría</h2>
        <span className="text-[11px] text-muted-foreground">Accesos, precios, estados de unidades y reservas</span>
        <Input aria-label="Buscar en auditoría" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por persona, acción o motivo" className="ml-auto h-8 max-w-xs text-xs" />
      </div>
      {vis.length === 0 ? <p className="p-6 text-center text-xs text-muted-foreground">Sin registros.</p> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Fecha</th><th className="px-2 py-2 text-left font-medium">Quién</th><th className="px-2 py-2 text-left font-medium">Acción</th><th className="px-2 py-2 text-left font-medium">Motivo</th><th className="px-4 py-2 text-left font-medium">Antes → después</th></tr></thead>
            <tbody>{vis.map((f, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-muted-foreground">{fmtFecha(f.fecha)}</td>
                <td className="px-2 py-1.5">{f.actor}</td><td className="px-2 py-1.5 font-medium">{f.accion}</td>
                <td className="px-2 py-1.5">{f.motivo || '—'}</td><td className="px-4 py-1.5 text-muted-foreground">{f.detalle}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ comunes */

function Motivo({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">Motivo del cambio * (queda en auditoría)</Label>
      <Textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function Campo({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  )
}

function Sel({ id, label, value, onChange, items }: { id: string; label: string; value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
