import { useContext, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { puedeVerDe } from '@/app/permissions'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { FieldError } from '@/features/inventario/components/shared'
import { useInventory } from '@/features/inventario/store'
import { FORMAS_PAGO, nombreCompleto, ORIGENES, PROPOSITOS, type Cliente, type FormaPago, type Origen, type Proposito } from '../model'
import { actualizarCliente, crearCliente, type ClienteInput } from '../service'
import { useClientes } from '../store'
import { DirectorioContext } from '@/features/config/store'
import { asignables } from '@/features/config/service'

const vacio = (asesorId: string, asesor: string): ClienteInput => ({
  nombre: '', primerNombre: '', segundoNombre: '', primerApellido: '', segundoApellido: '', telefono: '', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [],
  presupuesto: null, proposito: null, formaPago: null, asesorId, asesor,
})

export default function ClienteFormDialog({ open, onOpenChange, cliente, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cliente?: Cliente
  onSaved: (id: string, mensaje: string) => void
}) {
  const { state: inv } = useInventory()
  const { guardar: guardarCliente, remoto, asignables: remotos, corredores } = useClientes()
  const { actor, can } = useSession()
  const dir = useContext(DirectorioContext)
  // Personas a las que se puede asignar: dentro del alcance del usuario (y siempre él mismo).
  const opciones = remoto ? remotos.filter((p) => puedeVerDe(actor, [p.id])) : dir ? asignables(dir.state, actor) : []
  const personas = opciones.some((u) => u.id === actor.id) ? opciones : [{ id: actor.id, nombre: actor.nombre }, ...opciones]
  const [f, setF] = useState<ClienteInput>(() => vacio(actor.id, actor.nombre))
  const [presupuesto, setPresupuesto] = useState('')
  const [unidad, setUnidad] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const reasigna = !!cliente && f.asesorId !== cliente.asesorId

  useEffect(() => {
    if (!open) return
    const base = cliente ? { ...cliente } : vacio(actor.id, actor.nombre)
    setF({
      nombre: base.nombre, primerNombre: base.primerNombre ?? '', segundoNombre: base.segundoNombre ?? '', primerApellido: base.primerApellido ?? '', segundoApellido: base.segundoApellido ?? '',
      documento: base.documento ?? '', corredorOrigenId: base.corredorOrigenId ?? null, telefono: base.telefono, email: base.email, origen: base.origen, origenDetalle: base.origenDetalle,
      unidadesInteres: [...base.unidadesInteres], presupuesto: base.presupuesto, proposito: base.proposito, formaPago: base.formaPago,
      asesorId: base.asesorId, asesor: base.asesor, motivoAsignacion: '', mantenerAcceso: false,
    })
    setPresupuesto(base.presupuesto ? String(base.presupuesto) : '')
    setUnidad(''); setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setF((x) => ({ ...x, [k]: v }))

  async function guardar() {
    setError(null); setEnviando(true)
    const p = presupuesto.trim() ? Number(presupuesto.replace(/\./g, '').replace(',', '.')) : null
    const input = { ...f, presupuesto: p }
    try {
      if (cliente) {
        await guardarCliente((s) => actualizarCliente(s, cliente.id, input, actor, inv))
        onSaved(cliente.id, `Datos de ${nombreCompleto(input) || input.nombre} actualizados`)
      } else {
        let id = ''
        await guardarCliente((s) => { const r = crearCliente(s, input, actor, inv); id = r.cliente.id; return r.state })
        onSaved(id, `Cliente ${nombreCompleto(input)} registrado`)
      }
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
          <DialogDescription>Los datos del cliente son confidenciales y solo los ve el equipo comercial autorizado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {cliente && !cliente.primerNombre && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Nombre registrado: <b>{cliente.nombre}</b>. Separa aquí nombres y apellidos para los documentos legales. Hasta completarlos, se conserva tal como está.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="cf-primer-nombre" label="Primer nombre *" value={f.primerNombre ?? ''} onChange={(v) => set('primerNombre', v)} />
            <Campo id="cf-segundo-nombre" label="Segundo nombre" value={f.segundoNombre ?? ''} onChange={(v) => set('segundoNombre', v)} />
            <Campo id="cf-primer-apellido" label="Primer apellido *" value={f.primerApellido ?? ''} onChange={(v) => set('primerApellido', v)} />
            <Campo id="cf-segundo-apellido" label="Segundo apellido" value={f.segundoApellido ?? ''} onChange={(v) => set('segundoApellido', v)} />
            {nombreCompleto(f) && <p className="text-[11px] text-muted-foreground sm:col-span-2">Nombre completo: <b className="text-foreground">{nombreCompleto(f)}</b></p>}
            <Campo id="cf-doc" label="Cédula o RUC" value={f.documento ?? ''} onChange={(v) => set('documento', v)} />
            <Campo id="cf-tel" label="Teléfono" value={f.telefono} onChange={(v) => set('telefono', v)} />
            <Campo id="cf-email" label="Correo" type="email" value={f.email} onChange={(v) => set('email', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Sel id="cf-origen" label="Origen *" value={f.origen} disabled={!!cliente} items={Object.entries(ORIGENES)}
              onChange={(v) => setF((x) => ({ ...x, origen: v as Origen, corredorOrigenId: null, origenDetalle: v === 'corredor' && actor.rol === 'corredor' ? actor.nombre : '' }))} />
            {f.origen === 'corredor' && !cliente && corredores.length > 0 && can('clientes.asignar') && (
              <Sel id="cf-corredor" label="Corredor registrado" value={f.corredorOrigenId ?? 'ninguno'} items={[['ninguno', 'No está registrado'], ...corredores.map((p) => [p.id, p.nombre] as [string, string])]}
                onChange={(v) => setF((x) => ({ ...x, corredorOrigenId: v === 'ninguno' ? null : v, origenDetalle: corredores.find((p) => p.id === v)?.nombre ?? '' }))} />
            )}
            {(f.origen === 'referido' || f.origen === 'corredor') && (
              <Campo id="cf-origen-det" label={f.origen === 'referido' ? 'Referido por *' : 'Corredor *'} value={f.origenDetalle} disabled={!!cliente || !!f.corredorOrigenId} onChange={(v) => set('origenDetalle', v)} />
            )}
            {cliente && <p className="text-[11px] text-muted-foreground sm:col-span-2">El origen define la comisión y no se cambia después. Si hay un error, pide la corrección a administración.</p>}
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Interés</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo id="cf-presupuesto" label="Presupuesto (USD)" value={presupuesto} onChange={setPresupuesto} inputMode="numeric" />
              <Sel id="cf-proposito" label="Compra para" value={f.proposito ?? 'ninguno'} onChange={(v) => set('proposito', v === 'ninguno' ? null : (v as Proposito))} items={[['ninguno', 'Sin definir'], ...Object.entries(PROPOSITOS)]} />
              <Sel id="cf-pago" label="Forma de pago" value={f.formaPago ?? 'ninguno'} onChange={(v) => set('formaPago', v === 'ninguno' ? null : (v as FormaPago))} items={[['ninguno', 'Sin definir'], ...Object.entries(FORMAS_PAGO)]} />
            </div>
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
              <UnitPicker id="cf-unidad" label="Departamento de interés" units={inv.units} params={inv.params} value={unidad} onChange={setUnidad} />
              <Button type="button" variant="outline" disabled={!unidad || f.unidadesInteres.includes(unidad)} onClick={() => { set('unidadesInteres', [...f.unidadesInteres, unidad]); setUnidad('') }}>Agregar</Button>
            </div>
            {f.unidadesInteres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.unidadesInteres.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                    {inv.units.find((u) => u.codigo === c)?.dpt ?? c}
                    <button type="button" aria-label={`Quitar ${c}`} onClick={() => set('unidadesInteres', f.unidadesInteres.filter((x) => x !== c))}><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </fieldset>
          {can('clientes.asignar') ? (
            <Sel id="cf-asesor" label="Asesor responsable *" value={f.asesorId} items={[...(personas.some((p) => p.id === f.asesorId) ? [] : [[f.asesorId, f.asesor || 'Sin asignar'] as [string, string]]), ...personas.map((p) => [p.id, p.nombre] as [string, string])]}
              onChange={(v) => setF((x) => ({ ...x, asesorId: v, asesor: personas.find((p) => p.id === v)?.nombre ?? x.asesor }))} />
          ) : (
            <p className="text-xs text-muted-foreground">Asesor responsable: <b>{f.asesor}</b>. Solo quien tiene permiso de asignación puede cambiarlo.</p>
          )}
          {reasigna && (
            <div className="grid gap-1.5">
              <Label htmlFor="cf-motivo-asig" className="text-xs">Motivo de la reasignación *</Label>
              <Textarea id="cf-motivo-asig" rows={2} value={f.motivoAsignacion ?? ''} onChange={(e) => set('motivoAsignacion', e.target.value)} />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!f.mantenerAcceso} onChange={(e) => set('mantenerAcceso', e.target.checked)} />Autorizar a {cliente?.asesor} a conservar el acceso</label>
              <p className="text-[11px] text-muted-foreground">El nuevo asesor recibe el expediente y sus negociaciones abiertas; el anterior deja de verlo salvo que lo autorices. Quién captó al cliente, para comisiones, no cambia.</p>
            </div>
          )}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={enviando} onClick={() => void guardar()}>{enviando ? 'Guardando…' : cliente ? 'Guardar cambios' : 'Registrar cliente'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Campo({ id, label, value, onChange, type = 'text', inputMode, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: 'numeric'; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9" />
    </div>
  )
}

function Sel({ id, label, value, onChange, items, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; items: [string, string][]; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}
