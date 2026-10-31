import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { ESTADOS_CIVILES, type Comprador, type EstadoCivil } from '../model'
import * as api from '../remoto'

const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'
const civiles = Object.keys(ESTADOS_CIVILES) as EstadoCivil[]

type Edicion = { id: string | null; rol: 'comprador' | 'apoderado' }
const vacio = { nombre: '', documento: '', nacionalidad: '', estado_civil: '', domicilio: '', ciudad: '', telefono: '', email: '', representa_a: '', poder_detalle: '', porcentaje: '' }

/** Datos legales del comprador principal y alta de compradores adicionales y apoderados. Todo se guarda en Supabase con su motivo. */
export default function CompradoresDialog({ datos, contratoId, codigo, puedeEditar, onCambio, onClose }: {
  datos: Datos; contratoId: string; codigo: string; puedeEditar: boolean; onCambio: () => Promise<void>; onClose: () => void
}) {
  const [principal, setPrincipal] = useState({ nombre: '', documento: '', nacionalidad: '', estado_civil: '', domicilio: '', ciudad: '' })
  const [lista, setLista] = useState<Comprador[]>([])
  const [cargado, setCargado] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [f, setF] = useState(vacio)

  const cargar = useCallback(async () => {
    try {
      const [snap, personas] = await Promise.all([api.datosDocumento(datos, contratoId, {}), api.cargarCompradores(datos, contratoId)])
      const p = snap.comprador
      setPrincipal({ nombre: p.nombre, documento: p.documento, nacionalidad: p.nacionalidad, estado_civil: p.estado_civil, domicilio: p.domicilio, ciudad: p.ciudad })
      setLista(personas.filter((x) => !x.retiradoEn))
      setCargado(true)
    } catch (e) { setError((e as Error).message) }
  }, [datos, contratoId])
  useEffect(() => { void cargar() }, [cargar])

  const motivoOk = motivo.trim().length >= 5
  async function ejecutar(fn: () => Promise<unknown>, ok: string) {
    setError(null); setAviso(null); setOcupado(true)
    try { await fn(); await cargar(); await onCambio(); setAviso(ok) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  const empezar = (rol: Edicion['rol'], p?: Comprador) => {
    setEdicion({ id: p?.id ?? null, rol })
    setF(p ? { nombre: p.nombre, documento: p.documento, nacionalidad: p.nacionalidad, estado_civil: p.estadoCivil ?? '', domicilio: p.domicilio, ciudad: p.ciudad, telefono: p.telefono, email: p.email,
      representa_a: p.representaA ?? '', poder_detalle: p.poderDetalle, porcentaje: p.porcentaje === null ? '' : String(p.porcentaje) } : vacio)
  }
  const adicionales = lista.filter((x) => x.rol === 'comprador')
  const nombreDe = (id: string | null) => (id ? adicionales.find((x) => x.id === id)?.nombre ?? '' : principal.nombre)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compradores y apoderados · {codigo}</DialogTitle>
          <DialogDescription>Los datos del comprador vienen de Clientes. Aquí se completan los datos legales que exige el contrato; cada cambio queda con su motivo en el historial.</DialogDescription>
        </DialogHeader>
        {!cargado && !error && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
        {cargado && (
          <div className="grid gap-4 text-xs">
            <fieldset className="grid gap-2 rounded-lg border border-border p-3" disabled={!puedeEditar}>
              <legend className="px-1 text-xs font-semibold">Comprador principal: {principal.nombre}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1"><Label htmlFor="cp-doc" className="text-[11px]">Cédula o RUC</Label><Input id="cp-doc" value={principal.documento} onChange={(e) => setPrincipal({ ...principal, documento: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="cp-nac" className="text-[11px]">Nacionalidad</Label><Input id="cp-nac" value={principal.nacionalidad} onChange={(e) => setPrincipal({ ...principal, nacionalidad: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="cp-civil" className="text-[11px]">Estado civil</Label>
                  <select id="cp-civil" className={campo} value={principal.estado_civil} onChange={(e) => setPrincipal({ ...principal, estado_civil: e.target.value })}><option value="">Sin indicar</option>{civiles.map((c) => <option key={c} value={c}>{ESTADOS_CIVILES[c]}</option>)}</select></div>
                <div className="grid gap-1 sm:col-span-2"><Label htmlFor="cp-dom" className="text-[11px]">Domicilio</Label><Input id="cp-dom" value={principal.domicilio} onChange={(e) => setPrincipal({ ...principal, domicilio: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="cp-ciu" className="text-[11px]">Ciudad</Label><Input id="cp-ciu" value={principal.ciudad} onChange={(e) => setPrincipal({ ...principal, ciudad: e.target.value })} /></div>
              </div>
              {puedeEditar && <div><Button size="sm" disabled={!motivoOk || ocupado} onClick={() => void ejecutar(() => api.guardarPrincipal(datos, contratoId, { documento: principal.documento, domicilio: principal.domicilio, ciudad: principal.ciudad, estado_civil: principal.estado_civil || null, nacionalidad: principal.nacionalidad }, motivo.trim()), 'Datos del comprador principal guardados.')}>Guardar datos del principal</Button></div>}
            </fieldset>

            <section className="grid gap-2 rounded-lg border border-border p-3" aria-label="Compradores adicionales y apoderados">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold">Compradores adicionales y apoderados</h3>
                {puedeEditar && <div className="flex gap-2"><Button size="xs" variant="outline" onClick={() => empezar('comprador')}><Plus />Comprador adicional</Button><Button size="xs" variant="outline" onClick={() => empezar('apoderado')}><Plus />Apoderado</Button></div>}
              </div>
              {lista.length === 0 && !edicion && <p className="text-muted-foreground">Este contrato solo tiene el comprador principal.</p>}
              <ul className="divide-y divide-border">
                {lista.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><b>{p.nombre}</b> <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{p.rol === 'apoderado' ? 'Apoderado' : 'Comprador adicional'}</span>
                      <span className="block text-muted-foreground">{p.documento || 'Sin documento'}{p.rol === 'apoderado' ? ` · representa a ${nombreDe(p.representaA)}${p.poderDetalle ? ` · ${p.poderDetalle}` : ''}` : p.porcentaje ? ` · ${p.porcentaje} %` : ''}</span></span>
                    {puedeEditar && <span className="flex gap-1"><Button size="icon-xs" variant="ghost" aria-label={`Editar ${p.nombre}`} onClick={() => empezar(p.rol, p)}><Pencil /></Button><Button size="icon-xs" variant="ghost" aria-label={`Retirar ${p.nombre}`} disabled={!motivoOk || ocupado} onClick={() => void ejecutar(() => api.retirarComprador(datos, p.id, motivo.trim()), `${p.nombre} retirado del contrato.`)}><Trash2 /></Button></span>}
                  </li>
                ))}
              </ul>
              {edicion && (
                <form className="grid gap-2 rounded-lg bg-muted/40 p-3" aria-label={edicion.rol === 'apoderado' ? 'Datos del apoderado' : 'Datos del comprador adicional'}
                  onSubmit={(e) => { e.preventDefault(); void ejecutar(async () => {
                    await api.guardarComprador(datos, contratoId, edicion.id, { rol: edicion.rol, nombre: f.nombre.trim(), documento: f.documento.trim(), nacionalidad: f.nacionalidad.trim(), estado_civil: f.estado_civil || null,
                      domicilio: f.domicilio.trim(), ciudad: f.ciudad.trim(), telefono: f.telefono.trim(), email: f.email.trim(), representa_a: edicion.rol === 'apoderado' ? f.representa_a || null : null,
                      poder_detalle: f.poder_detalle.trim(), porcentaje: f.porcentaje === '' ? null : Number(f.porcentaje) }, motivo.trim())
                    setEdicion(null)
                  }, 'Datos guardados.') }}>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="grid gap-1 sm:col-span-2"><Label htmlFor="cb-nombre" className="text-[11px]">Nombres y apellidos completos *</Label><Input id="cb-nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
                    <div className="grid gap-1"><Label htmlFor="cb-doc" className="text-[11px]">Cédula o RUC</Label><Input id="cb-doc" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
                    <div className="grid gap-1"><Label htmlFor="cb-nac" className="text-[11px]">Nacionalidad</Label><Input id="cb-nac" value={f.nacionalidad} onChange={(e) => setF({ ...f, nacionalidad: e.target.value })} /></div>
                    <div className="grid gap-1"><Label htmlFor="cb-civil" className="text-[11px]">Estado civil</Label>
                      <select id="cb-civil" className={campo} value={f.estado_civil} onChange={(e) => setF({ ...f, estado_civil: e.target.value })}><option value="">Sin indicar</option>{civiles.map((c) => <option key={c} value={c}>{ESTADOS_CIVILES[c]}</option>)}</select></div>
                    <div className="grid gap-1"><Label htmlFor="cb-ciu" className="text-[11px]">Ciudad</Label><Input id="cb-ciu" value={f.ciudad} onChange={(e) => setF({ ...f, ciudad: e.target.value })} /></div>
                    <div className="grid gap-1 sm:col-span-3"><Label htmlFor="cb-dom" className="text-[11px]">Domicilio</Label><Input id="cb-dom" value={f.domicilio} onChange={(e) => setF({ ...f, domicilio: e.target.value })} /></div>
                    <div className="grid gap-1"><Label htmlFor="cb-tel" className="text-[11px]">Teléfono</Label><Input id="cb-tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
                    <div className="grid gap-1"><Label htmlFor="cb-mail" className="text-[11px]">Correo</Label><Input id="cb-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
                    {edicion.rol === 'comprador'
                      ? <div className="grid gap-1"><Label htmlFor="cb-pct" className="text-[11px]">Participación (%)</Label><Input id="cb-pct" type="number" min="0" max="100" step="0.01" value={f.porcentaje} onChange={(e) => setF({ ...f, porcentaje: e.target.value })} /></div>
                      : <div className="grid gap-1"><Label htmlFor="cb-rep" className="text-[11px]">Representa a</Label>
                          <select id="cb-rep" className={campo} value={f.representa_a} onChange={(e) => setF({ ...f, representa_a: e.target.value })}><option value="">{principal.nombre} (principal)</option>{adicionales.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></div>}
                    {edicion.rol === 'apoderado' && <div className="grid gap-1 sm:col-span-3"><Label htmlFor="cb-poder" className="text-[11px]">Detalle del poder (notaría, fecha, número)</Label><Input id="cb-poder" value={f.poder_detalle} onChange={(e) => setF({ ...f, poder_detalle: e.target.value })} /></div>}
                  </div>
                  <div className="flex gap-2"><Button type="submit" size="sm" disabled={ocupado || !motivoOk || f.nombre.trim().length < 3}>Guardar</Button><Button type="button" size="sm" variant="outline" onClick={() => setEdicion(null)}>Cancelar</Button></div>
                </form>
              )}
            </section>

            {puedeEditar && <div className="grid gap-1"><Label htmlFor="cb-motivo" className="text-[11px]">Motivo de los cambios *</Label><Input id="cb-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: datos según la cédula presentada" /></div>}
            {!puedeEditar && <p className="text-muted-foreground">Tu perfil consulta estos datos; los completa Legal o Administración.</p>}
          </div>
        )}
        <div className="grid gap-2"><FieldError>{error}</FieldError>{aviso && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{aviso}</p>}</div>
      </DialogContent>
    </Dialog>
  )
}
