import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck, UserCheck, UserPlus, UserX } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

interface Rol { id: string; nombre: string; descripcion: string }

/** Operaciones de Supabase Auth que no pasan por la base de datos (inyectables para pruebas). */
export interface AccionesCuenta {
  enviarRecuperacion: (email: string) => Promise<void>
  invitar: (p: { nombre: string; email: string; rolId: string; motivo: string }) => Promise<void>
}

const ESTADO: Record<CuentaFila['estado'], { label: string; tono: string }> = {
  activo: { label: 'Activo', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  invitado: { label: 'Pendiente de activación', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  inactivo: { label: 'Desactivado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
  sin_perfil: { label: 'Sin perfil (sin acceso)', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

type Dialogo =
  | { tipo: 'rol'; c: CuentaFila }
  | { tipo: 'estado'; c: CuentaFila; estado: 'activo' | 'inactivo' }
  | { tipo: 'habilitar'; c: CuentaFila }
  | { tipo: 'invitar' }

/**
 * Usuarios reales de Supabase. Cada cambio pasa por una función del servidor que verifica el permiso,
 * impide modificarse a uno mismo y conceder permisos que no se tienen, y deja auditoría con motivo.
 */
export default function UsuariosRemoto({ datos, acciones }: { datos: Datos; acciones: AccionesCuenta }) {
  const { actor } = useSession()
  const [cuentas, setCuentas] = useState<CuentaFila[] | null>(null)
  const [roles, setRoles] = useState<Rol[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([datos.rpc<CuentaFila[]>('config_listar_cuentas'), datos.select<Rol>('roles', { orden: [{ columna: 'nombre' }] })])
      setCuentas(c); setRoles(r)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null); setAviso(null)
    try { await fn(); setAviso(ok); return true } catch (e) { setError((e as Error).message); return false } finally { await cargar() }
  }
  const actualizar = (c: CuentaFila, rol: string, estado: string, motivo: string) => datos.rpc('config_actualizar_usuario', {
    p_id: c.id, p_rol: rol, p_alcance: c.alcance, p_supervisor: c.supervisor_id, p_equipo: c.equipo_id, p_proyectos: c.proyectos, p_estado: estado, p_motivo: motivo,
  })

  if (!cuentas) return error ? <FieldError>{error}</FieldError> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Cargando usuarios…</p>
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted-foreground">{cuentas.length} cuentas en Supabase Authentication. El registro público está deshabilitado: las altas las hace un administrador.</p>
        <Button size="sm" variant="outline" onClick={() => void cargar()}><RefreshCw />Actualizar</Button>
        <Button size="sm" onClick={() => setDialogo({ tipo: 'invitar' })}><UserPlus />Invitar usuario</Button>
      </div>
      {aviso && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      <FieldError>{error}</FieldError>
      <div className="dashboard-card !p-0 overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-muted text-[11px] text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Usuario</th><th className="px-2 py-2 text-left font-medium">Rol</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2 text-left font-medium">Correo confirmado</th><th className="px-2 py-2 text-left font-medium">Último acceso</th><th className="px-4 py-2 text-right font-medium">Acciones</th></tr>
          </thead>
          <tbody>
            {cuentas.map((c) => {
              const yo = c.id === actor.id
              return (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-4 py-2"><div className="font-medium">{c.nombre}{yo && <span className="ml-1 text-[10px] text-muted-foreground">(tú)</span>}</div><div className="text-muted-foreground">{c.email}</div></td>
                  <td className="px-2 py-2">{c.rol_nombre ?? <i className="text-muted-foreground">—</i>}</td>
                  <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', ESTADO[c.estado].tono)}>{ESTADO[c.estado].label}</span></td>
                  <td className="px-2 py-2">{c.confirmado ? 'Sí' : 'No'}</td>
                  <td className="px-2 py-2 tabular-nums">{c.ultimo_acceso ? new Date(c.ultimo_acceso).toLocaleString('es-EC') : 'Nunca'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {!c.tiene_perfil && <Button size="sm" onClick={() => setDialogo({ tipo: 'habilitar', c })}><ShieldCheck />Habilitar</Button>}
                      {c.tiene_perfil && !yo && <Button size="sm" variant="outline" onClick={() => setDialogo({ tipo: 'rol', c })}>Cambiar rol</Button>}
                      {c.tiene_perfil && !yo && c.estado !== 'activo' && <Button size="sm" variant="outline" onClick={() => setDialogo({ tipo: 'estado', c, estado: 'activo' })}><UserCheck />Activar</Button>}
                      {c.tiene_perfil && !yo && c.estado === 'activo' && <Button size="sm" variant="outline" onClick={() => setDialogo({ tipo: 'estado', c, estado: 'inactivo' })}><UserX />Desactivar</Button>}
                      <Button size="sm" variant="ghost" title="Enviar correo de recuperación de contraseña"
                        onClick={() => void ejecutar(() => acciones.enviarRecuperacion(c.email), `Se envió el enlace de recuperación a ${c.email}`)}><KeyRound />Recuperar clave</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Desactivar quita todo acceso a los datos de inmediato (la base de datos deja de reconocer sus permisos) y conserva su historial. Nadie puede cambiar su propio rol ni estado.</p>

      {dialogo && <DialogoCuenta d={dialogo} roles={roles} onClose={() => setDialogo(null)} onConfirm={async (rol, motivo, nombre, email) => {
        const ok = dialogo.tipo === 'rol' ? await ejecutar(() => actualizar(dialogo.c, rol, dialogo.c.estado, motivo), `Rol de ${dialogo.c.nombre} actualizado`)
          : dialogo.tipo === 'estado' ? await ejecutar(() => actualizar(dialogo.c, dialogo.c.rol_id!, dialogo.estado, motivo), `${dialogo.c.nombre}: acceso ${dialogo.estado === 'activo' ? 'activado' : 'desactivado'}`)
            : dialogo.tipo === 'habilitar' ? await ejecutar(() => datos.rpc('config_habilitar_cuenta', { p_user: dialogo.c.id, p_nombre: nombre, p_rol: rol, p_motivo: motivo }), `Cuenta ${dialogo.c.email} habilitada`)
              : await ejecutar(() => acciones.invitar({ nombre, email, rolId: rol, motivo }), `Invitación enviada a ${email}`)
        if (ok) setDialogo(null)
      }} />}
    </div>
  )
}

function DialogoCuenta({ d, roles, onClose, onConfirm }: { d: Dialogo; roles: Rol[]; onClose: () => void; onConfirm: (rol: string, motivo: string, nombre: string, email: string) => Promise<void> }) {
  const c = d.tipo === 'invitar' ? null : d.c
  const [rol, setRol] = useState(c?.rol_id ?? 'asesor')
  const [motivo, setMotivo] = useState('')
  const [nombre, setNombre] = useState(c?.tiene_perfil ? c.nombre : '')
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const titulo = d.tipo === 'rol' ? `Cambiar rol de ${c!.nombre}` : d.tipo === 'estado' ? `${d.estado === 'activo' ? 'Activar' : 'Desactivar'} a ${c!.nombre}` : d.tipo === 'habilitar' ? `Habilitar ${c!.email}` : 'Invitar usuario'
  const valido = motivo.trim().length >= 5 && (d.tipo === 'rol' || d.tipo === 'estado' || nombre.trim().length >= 3) && (d.tipo !== 'invitar' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {d.tipo === 'estado' && d.estado === 'inactivo' && 'La persona perderá el acceso a los datos. Su historial se conserva.'}
            {d.tipo === 'habilitar' && 'La cuenta ya existe en Supabase Authentication; se crea su perfil activo con el rol elegido.'}
            {d.tipo === 'invitar' && 'Supabase envía un correo para que la persona defina su propia contraseña. Requiere la función del servidor invitar-usuario desplegada.'}
            {d.tipo === 'rol' && 'Solo puedes conceder roles cuyos permisos ya tienes.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {(d.tipo === 'habilitar' || d.tipo === 'invitar') && <div className="grid gap-1.5"><Label htmlFor="cu-nombre" className="text-xs">Nombre visible</Label><Input id="cu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>}
          {d.tipo === 'invitar' && <div className="grid gap-1.5"><Label htmlFor="cu-email" className="text-xs">Correo</Label><Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>}
          {d.tipo !== 'estado' && (
            <div className="grid gap-1.5">
              <Label htmlFor="cu-rol" className="text-xs">Rol</Label>
              <select id="cu-rol" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={rol} onChange={(e) => setRol(e.target.value)}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="grid gap-1.5"><Label htmlFor="cu-motivo" className="text-xs">Motivo *</Label><Textarea id="cu-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} variant={d.tipo === 'estado' && d.estado === 'inactivo' ? 'destructive' : 'default'}
            onClick={async () => { setEnviando(true); await onConfirm(rol, motivo, nombre, email); setEnviando(false) }}>{enviando && <Loader2 className="animate-spin" />}Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Auditoría real: cambios de acceso y operaciones registradas en la base de datos. */
export function AuditoriaRemota({ datos }: { datos: Datos }) {
  const [filas, setFilas] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    datos.select('audit_log', { orden: [{ columna: 'fecha', asc: false }], limite: 200 }).then(setFilas).catch((e: Error) => setError(e.message))
  }, [datos])
  if (error) return <FieldError>{error}</FieldError>
  if (!filas) return <p className="text-sm text-muted-foreground">Cargando…</p>
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <table className="w-full min-w-[720px] text-xs">
        <thead className="bg-muted text-[11px] text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Fecha</th><th className="px-2 py-2 text-left font-medium">Acción</th><th className="px-2 py-2 text-left font-medium">Entidad</th><th className="px-4 py-2 text-left font-medium">Motivo</th></tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={String(f.id)} className="border-t border-border align-top">
              <td className="whitespace-nowrap px-4 py-2 tabular-nums">{new Date(String(f.fecha)).toLocaleString('es-EC')}</td>
              <td className="px-2 py-2 font-medium">{String(f.accion)}</td>
              <td className="px-2 py-2 text-muted-foreground">{String(f.entidad)}</td>
              <td className="px-4 py-2">{String(f.motivo)}</td>
            </tr>
          ))}
          {!filas.length && <tr><td colSpan={4} className="px-4 py-3 text-muted-foreground">Sin registros.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
