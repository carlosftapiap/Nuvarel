import { useCallback, useEffect, useState } from 'react'
import { CloudOff, KeyRound, Pencil, Plus, UserX, UserCheck } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import * as api from '@/features/corredores/remoto'
import type { Corredor, DatosCorredor } from '@/features/corredores/remoto'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'

export default function CorredoresPage() {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) {
    return (
      <>
        <PageHeader eyebrow="Ventas · Corredores" title="Corredores" subtitle="Corredores externos, su responsable y sus clientes." />
        <div className="module-empty"><CloudOff className="size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Requiere la base de datos</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Los corredores se administran en la base de datos de AMURA.</p></div>
      </>
    )
  }
  return <Corredores datos={datos} />
}

type Modo = { tipo: 'nuevo' } | { tipo: 'editar'; corredor: Corredor } | { tipo: 'acceso'; corredor: Corredor }

function Corredores({ datos }: { datos: Datos }) {
  const { can } = useSession()
  const [lista, setLista] = useState<Corredor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo | null>(null)
  const [responsables, setResponsables] = useState<{ id: string; nombre: string }[]>([])

  const recargar = useCallback(async () => {
    try {
      setLista(await api.cargarCorredores(datos))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [datos])
  useRefresco(recargar)
  useEffect(() => {
    // Quien puede ver a los corredores también ve a sus responsables; el servidor vuelve a comprobarlo.
    datos.select<Record<string, unknown>>('profiles', { filtros: { estado: 'activo' }, orden: [{ columna: 'nombre', asc: true }] })
      .then((f) => setResponsables(f.map((p) => ({ id: String(p.id), nombre: String(p.nombre) }))))
      .catch(() => setResponsables([]))
  }, [datos])

  const gestiona = can('corredores.gestionar')
  const admin = can('config.usuarios')

  return (
    <>
      <PageHeader eyebrow="Ventas · Corredores" title="Corredores" subtitle="Corredores externos y su relación con AMURA. Puedes crear el perfil sin invitación; el acceso a la app se vincula aparte." actions={gestiona ? <Button size="sm" onClick={() => setModo({ tipo: 'nuevo' })}><Plus />Nuevo corredor</Button> : undefined} />

      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}
      {aviso && <p role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{aviso}</p>}

      {lista === null ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando corredores…</p>
      ) : lista.length === 0 ? (
        <div className="module-empty"><h2 className="text-lg font-semibold">Aún no hay corredores</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Registra el primer corredor externo para asignarle clientes.</p>
          {gestiona && <Button className="mt-6" onClick={() => setModo({ tipo: 'nuevo' })}><Plus />Nuevo corredor</Button>}
        </div>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-[11px] text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Corredor</th><th className="px-2 py-2 text-left font-medium">Licencia</th><th className="px-2 py-2 text-left font-medium">Responsable</th><th className="px-2 py-2 text-left font-medium">Acceso a la app</th><th className="px-2 py-2 text-right font-medium">Clientes</th><th className="px-2 py-2 text-right font-medium">Ventas firmadas</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-2"><div className="font-semibold">{c.nombre}</div><div className="text-[11px] text-muted-foreground">{c.documento || 'Sin documento'}{c.telefono ? ` · ${c.telefono}` : ''}</div></td>
                  <td className="px-2 py-2">{c.licencia || '—'}</td>
                  <td className="px-2 py-2">{c.responsable ?? '—'}</td>
                  <td className="px-2 py-2">{c.acceso ? <span className="text-emerald-700">{c.acceso}</span> : <span className="text-muted-foreground">Sin acceso</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.clientes}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{c.ventas}</td>
                  <td className="px-2 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', c.estado === 'activo' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-600 ring-slate-200')}>{c.estado === 'activo' ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="px-2 py-2"><div className="flex flex-wrap justify-end gap-1">
                    {gestiona && <Button size="xs" variant="ghost" onClick={() => setModo({ tipo: 'editar', corredor: c })}><Pencil />Editar</Button>}
                    {gestiona && c.estado === 'activo' && <Button size="xs" variant="ghost" onClick={() => setModo({ tipo: 'editar', corredor: c })}>Desactivar</Button>}
                    {gestiona && c.estado === 'inactivo' && <Button size="xs" variant="ghost" onClick={() => setModo({ tipo: 'editar', corredor: c })}><UserCheck />Reactivar</Button>}
                    {admin && !c.usuarioId && <Button size="xs" variant="outline" onClick={() => setModo({ tipo: 'acceso', corredor: c })}><KeyRound />Vincular acceso</Button>}
                    {admin && c.usuarioId && <Button size="xs" variant="ghost" onClick={() => setModo({ tipo: 'acceso', corredor: c })}><UserX />Quitar acceso</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modo?.tipo === 'nuevo' && <FormCorredor datos={datos} responsables={responsables} onClose={() => setModo(null)} onDone={async () => { await recargar(); setAviso('Corredor registrado') }} />}
      {modo?.tipo === 'editar' && <FormCorredor datos={datos} corredor={modo.corredor} responsables={responsables} onClose={() => setModo(null)} onDone={async () => { await recargar(); setAviso('Datos del corredor actualizados') }} />}
      {modo?.tipo === 'acceso' && <AccesoCorredor datos={datos} corredor={modo.corredor} onClose={() => setModo(null)} onDone={async () => { await recargar(); setAviso('Acceso actualizado') }} />}
    </>
  )
}

function FormCorredor({ datos, corredor, responsables, onClose, onDone }: { datos: Datos; corredor?: Corredor; responsables: { id: string; nombre: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState<DatosCorredor & { motivo: string; estado: 'activo' | 'inactivo' }>({
    nombre: corredor?.nombre ?? '', documento: corredor?.documento ?? '', licencia: corredor?.licencia ?? '', telefono: corredor?.telefono ?? '', email: corredor?.email ?? '',
    responsable_id: corredor?.responsableId ?? null, motivo: corredor ? '' : 'Alta de corredor externo', estado: corredor?.estado ?? 'activo',
  })
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const cambioEstado = !!corredor && f.estado !== corredor.estado
  const valido = f.nombre.trim().length >= 3 && f.motivo.trim().length >= 5

  async function guardar() {
    setError(null); setEnviando(true)
    try {
      const datosNuevos: DatosCorredor = { nombre: f.nombre.trim(), documento: f.documento.trim(), licencia: f.licencia.trim(), telefono: f.telefono.trim(), email: f.email.trim(), responsable_id: f.responsable_id }
      if (!corredor) await api.crearCorredor(datos, datosNuevos, f.motivo.trim())
      else {
        await api.editarCorredor(datos, corredor.id, datosNuevos, f.motivo.trim())
        if (cambioEstado) await api.cambiarEstadoCorredor(datos, corredor.id, f.estado, f.motivo.trim())
      }
      await onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{corredor ? `Editar ${corredor.nombre}` : 'Nuevo corredor'}</DialogTitle>
          <DialogDescription>No necesita cuenta de acceso para existir. Puedes vincularla después, si el corredor va a usar la app.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="cor-nombre" label="Nombre *" value={f.nombre} onChange={(v) => setF({ ...f, nombre: v })} className="sm:col-span-2" />
          <Campo id="cor-doc" label="Cédula o RUC" value={f.documento} onChange={(v) => setF({ ...f, documento: v })} />
          <Campo id="cor-lic" label="Licencia de corredor" value={f.licencia} onChange={(v) => setF({ ...f, licencia: v })} />
          <Campo id="cor-tel" label="Teléfono" value={f.telefono} onChange={(v) => setF({ ...f, telefono: v })} />
          <Campo id="cor-mail" label="Correo" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cor-resp" className="text-xs">Responsable en AMURA</Label>
            <Select value={f.responsable_id ?? 'ninguno'} onValueChange={(v) => setF({ ...f, responsable_id: v === 'ninguno' ? null : v })}>
              <SelectTrigger id="cor-resp" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ninguno">Sin responsable</SelectItem>{responsables.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {corredor && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="cor-estado" className="text-xs">Estado</Label>
              <Select value={f.estado} onValueChange={(v) => setF({ ...f, estado: v as 'activo' | 'inactivo' })}>
                <SelectTrigger id="cor-estado" className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="activo">Activo</SelectItem><SelectItem value="inactivo">Inactivo: no se le asignan clientes nuevos; su historial se conserva</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cor-motivo" className="text-xs">Motivo del cambio *</Label>
            <Textarea id="cor-motivo" rows={2} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
          </div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} onClick={() => void guardar()}>{enviando ? 'Guardando…' : 'Guardar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccesoCorredor({ datos, corredor, onClose, onDone }: { datos: Datos; corredor: Corredor; onClose: () => void; onDone: () => Promise<void> }) {
  const [cuentas, setCuentas] = useState<{ id: string; nombre: string }[]>([])
  const [usuario, setUsuario] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const quitar = !!corredor.usuarioId

  useEffect(() => {
    if (quitar) return
    api.cuentasCorredor(datos).then(setCuentas).catch((e: Error) => setError(e.message))
  }, [datos, quitar])

  async function confirmar() {
    setError(null); setEnviando(true)
    try {
      if (quitar) await api.desvincularAcceso(datos, corredor.id, motivo.trim())
      else await api.vincularAcceso(datos, corredor.id, usuario, motivo.trim())
      await onDone()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const valido = motivo.trim().length >= 5 && (quitar || !!usuario)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{quitar ? `Quitar el acceso de ${corredor.nombre}` : `Vincular acceso a ${corredor.nombre}`}</DialogTitle>
          <DialogDescription>{quitar ? `${corredor.acceso} dejará de entrar a la app como corredor. El perfil y su historial se conservan.` : 'Solo cuentas con rol Corredor y activas. El acceso no cambia los clientes ni las ventas del corredor.'}</DialogDescription>
        </DialogHeader>
        {!quitar && (
          <div className="grid gap-1.5">
            <Label htmlFor="cor-cuenta" className="text-xs">Cuenta de acceso *</Label>
            <Select value={usuario || 'ninguna'} onValueChange={(v) => setUsuario(v === 'ninguna' ? '' : v)}>
              <SelectTrigger id="cor-cuenta" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ninguna">Elige la cuenta</SelectItem>{cuentas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
            </Select>
            {cuentas.length === 0 && <p className="text-[11px] text-muted-foreground">No hay cuentas con rol Corredor disponibles. Crea o activa la cuenta en Configuración.</p>}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="cor-acc-motivo" className="text-xs">Motivo *</Label>
          <Textarea id="cor-acc-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant={quitar ? 'destructive' : 'default'} disabled={!valido || enviando} onClick={() => void confirmar()}>{enviando ? 'Guardando…' : quitar ? 'Quitar acceso' : 'Vincular'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Campo({ id, label, value, onChange, className }: { id: string; label: string; value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
