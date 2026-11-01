import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ALCANCES } from '@/app/permissions'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'

export interface CuentaFila {
  id: string
  email: string
  nombre: string
  estado: 'activo' | 'invitado' | 'inactivo' | 'sin_perfil'
  rol_id: string | null
  rol_nombre: string | null
  alcance: string | null
  supervisor_id: string | null
  equipo_id: string | null
  proyectos: string[]
  tiene_perfil: boolean
  confirmado: boolean
  ultimo_acceso: string | null
  creado: string | null
}

interface Rol { id: string; nombre: string; descripcion: string; disponible?: boolean }
interface Equipo { id: string; nombre: string }

export interface NuevaCuenta { nombre: string; email: string; rolId: string }
const CLAVE_MINIMA = 8

/** Operaciones de Supabase Auth que no pasan por la base de datos (inyectables para pruebas). */
export interface AccionesCuenta {
  enviarRecuperacion: (email: string) => Promise<void>
  crearUsuario: (p: NuevaCuenta) => Promise<void>
  cambiarClave: (p: { usuarioId: string; password: string; motivo: string }) => Promise<void>
}

const ESTADO: Record<CuentaFila['estado'], { label: string; tono: string }> = {
  activo: { label: 'Activo', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  invitado: { label: 'Pendiente de activar', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  inactivo: { label: 'Desactivado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
  sin_perfil: { label: 'Sin perfil (sin acceso)', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

type Dialogo =
  | { tipo: 'rol'; c: CuentaFila }
  | { tipo: 'estado'; c: CuentaFila; estado: 'activo' | 'inactivo' }
  | { tipo: 'habilitar'; c: CuentaFila }
  | { tipo: 'crear' }
  | { tipo: 'clave'; c: CuentaFila }

/**
 * Usuarios reales de Supabase. Cada cambio pasa por una función del servidor que verifica el permiso,
 * impide modificarse a uno mismo y conceder permisos que no se tienen, y deja auditoría con usuario, fecha y cambio.
 */
export default function UsuariosRemoto({ datos, acciones, version = 0 }: { datos: Datos; acciones: AccionesCuenta; version?: number }) {
  const { actor } = useSession()
  const [cuentas, setCuentas] = useState<CuentaFila[] | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [equipos, setEquipos] = useState<Equipo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [c, r, e] = await Promise.all([datos.rpc<CuentaFila[]>('config_listar_cuentas'), datos.select<Rol>('roles', { orden: [{ columna: 'nombre' }] }), datos.select<Equipo>('teams', { orden: [{ columna: 'nombre' }] })])
      setCuentas(c); setRoles(r); setEquipos(e)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar, version])

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null); setAviso(null)
    try { await fn(); setAviso(ok); return true } catch (e) { setError((e as Error).message); return false } finally { await cargar() }
  }
  const actualizar = (c: CuentaFila, rol: string, estado: string, motivo: string, alcance = c.alcance, equipo = c.equipo_id) => datos.rpc('config_actualizar_usuario', {
    p_id: c.id, p_rol: rol, p_alcance: alcance, p_supervisor: c.supervisor_id, p_equipo: equipo, p_proyectos: c.proyectos, p_estado: estado, p_motivo: motivo,
  })
  const nombreRol = (id: string) => roles.find((r) => r.id === id)?.nombre ?? id
  // Crear la cuenta y enviar el enlace son dos pasos: si falla el correo, la cuenta ya existe y el enlace se puede reenviar.
  const crear = (nombre: string, email: string, rolId: string) => ejecutar(async () => {
    await acciones.crearUsuario({ nombre, email, rolId })
    try {
      await acciones.enviarRecuperacion(email)
    } catch {
      throw new Error(`Usuario ${email} creado, pero no se pudo enviar el enlace. Usa «Enviar enlace de contraseña» en la lista.`)
    }
  }, `Usuario ${email} creado. Se envió el enlace para crear su contraseña.`)

  if (!cuentas) return error ? <FieldError>{error}</FieldError> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando usuarios…</p>
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">{cuentas.length} usuarios</h2>
        <Button size="sm" variant="outline" onClick={() => void cargar()}><RefreshCw />Actualizar</Button>
        <Button size="sm" onClick={() => { setError(null); setDialogo({ tipo: 'crear' }) }}><UserPlus />Crear usuario</Button>
      </div>
      {aviso && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      {!dialogo && <FieldError>{error}</FieldError>}
      <div className="dashboard-card !p-0 overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-muted text-[11px] text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Usuario</th><th className="px-2 py-2 text-left font-medium">Rol</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2 text-left font-medium">Último acceso</th><th className="px-4 py-2 text-right font-medium">Acciones</th></tr>
          </thead>
          <tbody>
            {cuentas.map((c) => {
              const yo = c.id === actor.id
              return (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-4 py-2"><div className="font-medium">{c.nombre}{yo && <span className="ml-1 text-[10px] text-muted-foreground">(tú)</span>}</div><div className="text-muted-foreground">{c.email}</div></td>
                  <td className="px-2 py-2">{c.rol_nombre ?? <i className="text-muted-foreground">—</i>}</td>
                  <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', ESTADO[c.estado].tono)}>{ESTADO[c.estado].label}</span></td>
                  <td className="px-2 py-2 tabular-nums">{c.ultimo_acceso ? new Date(c.ultimo_acceso).toLocaleDateString('es-EC') : 'Nunca'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {!c.tiene_perfil && <Button size="sm" onClick={() => { setError(null); setDialogo({ tipo: 'habilitar', c }) }}><ShieldCheck />Habilitar</Button>}
                      {c.tiene_perfil && !yo && <Button size="sm" variant="outline" onClick={() => { setError(null); setDialogo({ tipo: 'rol', c }) }}>Cambiar rol</Button>}
                      {c.tiene_perfil && !yo && c.estado !== 'activo' && <Button size="sm" variant="outline" onClick={() => { setError(null); setDialogo({ tipo: 'estado', c, estado: 'activo' }) }}><UserCheck />Activar</Button>}
                      {c.tiene_perfil && !yo && c.estado === 'activo' && <Button size="sm" variant="outline" onClick={() => { setError(null); setDialogo({ tipo: 'estado', c, estado: 'inactivo' }) }}><UserX />Desactivar</Button>}
                      <Button size="sm" variant="ghost" onClick={() => void ejecutar(() => acciones.enviarRecuperacion(c.email), `Se envió a ${c.email} el enlace para establecer su contraseña`)}><KeyRound />Enviar enlace de contraseña</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Desactivar quita el acceso de inmediato y conserva su historial. Nadie puede cambiar su propio rol ni estado. Cada cambio queda en la auditoría.</p>

      {dialogo && <DialogoCuenta d={dialogo} roles={roles} equipos={equipos} error={error} onClose={() => { setError(null); setDialogo(null) }} onClave={(c) => { setError(null); setDialogo({ tipo: 'clave', c }) }} onConfirm={async ({ rol, nombre, email, password, alcance, equipo }) => {
        const ok = dialogo.tipo === 'rol' ? await ejecutar(() => actualizar(dialogo.c, rol, dialogo.c.estado, `Cambio de acceso: rol ${nombreRol(rol)}`, alcance, equipo), `Acceso de ${dialogo.c.nombre} actualizado`)
          : dialogo.tipo === 'clave' ? await ejecutar(() => acciones.cambiarClave({ usuarioId: dialogo.c.id, password, motivo: 'Contraseña asignada por un administrador' }), `Contraseña de ${dialogo.c.nombre} actualizada`)
          : dialogo.tipo === 'estado' ? await ejecutar(() => actualizar(dialogo.c, dialogo.c.rol_id!, dialogo.estado, dialogo.estado === 'activo' ? 'Usuario activado' : 'Usuario desactivado'), `${dialogo.c.nombre}: acceso ${dialogo.estado === 'activo' ? 'activado' : 'desactivado'}`)
            : dialogo.tipo === 'habilitar' ? await ejecutar(() => datos.rpc('config_habilitar_cuenta', { p_user: dialogo.c.id, p_nombre: nombre, p_rol: rol, p_motivo: 'Cuenta habilitada por un administrador' }), `Cuenta ${dialogo.c.email} habilitada`)
              : await crear(nombre, email, rol)
        if (ok) setDialogo(null)
      }} />}
    </div>
  )
}

interface DatosDialogo { rol: string; nombre: string; email: string; password: string; alcance: string | null; equipo: string | null }

function DialogoCuenta({ d, roles, equipos, error, onClose, onClave, onConfirm }: { d: Dialogo; roles: Rol[]; equipos: Equipo[]; error: string | null; onClose: () => void; onClave: (c: CuentaFila) => void; onConfirm: (x: DatosDialogo) => Promise<void> }) {
  const c = d.tipo === 'crear' ? null : d.c
  const [rol, setRol] = useState(c?.rol_id ?? 'asesor')
  const [alcance, setAlcance] = useState(c?.alcance ?? '')
  const [equipo, setEquipo] = useState(c?.equipo_id ?? '')
  const [nombre, setNombre] = useState(c?.tiene_perfil ? c.nombre : '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const titulo = d.tipo === 'rol' ? `Cambiar rol de ${c!.nombre}` : d.tipo === 'estado' ? `${d.estado === 'activo' ? 'Activar' : 'Desactivar'} a ${c!.nombre}` : d.tipo === 'habilitar' ? `Habilitar ${c!.email}` : d.tipo === 'clave' ? `Asignar contraseña a ${c!.nombre}` : 'Crear usuario'
  // Un rol retirado no se ofrece, salvo que la persona ya lo tenga.
  const opciones = roles.filter((r) => r.disponible !== false || r.id === c?.rol_id)
  const pideNombre = d.tipo === 'habilitar' || d.tipo === 'crear'
  const valido = (!pideNombre || nombre.trim().length >= 3) && (d.tipo !== 'crear' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) && (d.tipo !== 'clave' || password.length >= CLAVE_MINIMA)
  const boton = d.tipo === 'crear' ? 'Crear y enviar enlace' : d.tipo === 'rol' ? 'Guardar' : d.tipo === 'estado' ? (d.estado === 'activo' ? 'Activar' : 'Desactivar') : 'Confirmar'
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {d.tipo === 'estado' && d.estado === 'inactivo' && 'La persona perderá el acceso de inmediato. Su historial se conserva.'}
            {d.tipo === 'estado' && d.estado === 'activo' && 'La persona recuperará el acceso con su rol actual.'}
            {d.tipo === 'habilitar' && 'La cuenta ya existe; se le da acceso con el rol elegido.'}
            {d.tipo === 'crear' && 'Recibirá un correo con un enlace para crear su contraseña.'}
            {d.tipo === 'clave' && 'Úsalo solo si la persona no puede recibir el enlace por correo. La contraseña no se guarda en AMURA.'}
            {d.tipo === 'rol' && 'Solo puedes conceder roles cuyos permisos ya tienes.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {pideNombre && <div className="grid gap-1.5"><Label htmlFor="cu-nombre" className="text-xs">Nombre</Label><Input id="cu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>}
          {d.tipo === 'crear' && <div className="grid gap-1.5"><Label htmlFor="cu-email" className="text-xs">Correo</Label><Input id="cu-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
          {d.tipo === 'clave' && <div className="grid gap-1.5"><Label htmlFor="cu-clave" className="text-xs">Nueva contraseña (mínimo {CLAVE_MINIMA} caracteres)</Label><Input id="cu-clave" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>}
          {d.tipo !== 'estado' && d.tipo !== 'clave' && (
            <div className="grid gap-1.5">
              <Label htmlFor="cu-rol" className="text-xs">Rol</Label>
              <select id="cu-rol" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={rol} onChange={(e) => setRol(e.target.value)}>
                {opciones.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </div>
          )}
          {d.tipo === 'rol' && (
            <details className="rounded-lg border border-border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium">Opciones avanzadas</summary>
              <div className="mt-2 grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cu-alcance" className="text-xs">Alcance de datos</Label>
                  <select id="cu-alcance" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={alcance} onChange={(e) => setAlcance(e.target.value)}>
                    <option value="">El del rol</option>{Object.entries(ALCANCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cu-equipo" className="text-xs">Equipo</Label>
                  <select id="cu-equipo" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={equipo} onChange={(e) => setEquipo(e.target.value)}>
                    <option value="">Sin equipo</option>{equipos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                </div>
                <Button size="sm" variant="outline" onClick={() => onClave(d.c)}>Asignar contraseña manualmente</Button>
              </div>
            </details>
          )}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} variant={d.tipo === 'estado' && d.estado === 'inactivo' ? 'destructive' : 'default'}
            onClick={async () => { setEnviando(true); await onConfirm({ rol, nombre, email: email.trim().toLowerCase(), password, alcance: alcance || null, equipo: equipo || null }); setEnviando(false) }}>{enviando && <Loader2 className="animate-spin" />}{boton}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Auditoría real: cambios de acceso y operaciones registradas en la base de datos. */
export function AuditoriaRemota({ datos }: { datos: Datos }) {
  const [filas, setFilas] = useState<Record<string, unknown>[] | null>(null)
  const [personas, setPersonas] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([
      datos.select<Record<string, unknown>>('audit_log', { orden: [{ columna: 'fecha', asc: false }], limite: 200 }),
      datos.select<{ id: string; nombre: string }>('profiles'),
    ]).then(([a, p]) => { setFilas(a); setPersonas(Object.fromEntries(p.map((x) => [x.id, x.nombre]))) }).catch((e: Error) => setError(e.message))
  }, [datos])
  if (error) return <FieldError>{error}</FieldError>
  if (!filas) return <p className="text-sm text-muted-foreground">Cargando…</p>
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <table className="w-full min-w-[760px] text-xs">
        <thead className="bg-muted text-[11px] text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Fecha</th><th className="px-2 py-2 text-left font-medium">Quién</th><th className="px-2 py-2 text-left font-medium">Acción</th><th className="px-2 py-2 text-left font-medium">Entidad</th><th className="px-4 py-2 text-left font-medium">Motivo y cambio</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={String(f.id)} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{new Date(String(f.fecha)).toLocaleString('es-EC')}</td>
              <td className="px-2 py-2">{personas[String(f.actor_id)] ?? 'Sistema'}</td>
              <td className="px-2 py-2 font-medium">{String(f.accion)}</td>
              <td className="px-2 py-2 text-muted-foreground">{String(f.entidad)}</td>
              <td className="px-4 py-2">{String(f.motivo)}
                {(f.antes != null || f.despues != null) && (
                  <details className="mt-1 text-[11px] text-muted-foreground"><summary className="cursor-pointer">Ver cambio</summary>
                    {f.antes != null && <pre className="mt-1 whitespace-pre-wrap break-all">Antes: {JSON.stringify(f.antes)}</pre>}
                    {f.despues != null && <pre className="mt-1 whitespace-pre-wrap break-all">Después: {JSON.stringify(f.despues)}</pre>}
                  </details>
                )}
              </td>
            </tr>
          ))}
          {!filas.length && <tr><td colSpan={5} className="px-4 py-3 text-muted-foreground">Sin registros.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
