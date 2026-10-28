import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { FieldError } from '@/features/inventario/components/shared'
import { useInventory } from '@/features/inventario/store'
import { FORMAS_PAGO, ORIGENES, PROPOSITOS, type Cliente, type FormaPago, type Origen, type Proposito } from '../model'
import { actualizarCliente, crearCliente, type ClienteInput } from '../service'
import { useClientes } from '../store'

const vacio = (asesor: string): ClienteInput => ({
  nombre: '', telefono: '', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [],
  presupuesto: null, proposito: null, formaPago: null, asesor,
})

export default function ClienteFormDialog({ open, onOpenChange, cliente, onSaved }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  cliente?: Cliente
  onSaved: (id: string, mensaje: string) => void
}) {
  const { state: inv } = useInventory()
  const { update } = useClientes()
  const { actor, can } = useSession()
  const [f, setF] = useState<ClienteInput>(() => vacio(actor.nombre))
  const [presupuesto, setPresupuesto] = useState('')
  const [unidad, setUnidad] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const base = cliente ? { ...cliente } : vacio(actor.nombre)
    setF({
      nombre: base.nombre, telefono: base.telefono, email: base.email, origen: base.origen, origenDetalle: base.origenDetalle,
      unidadesInteres: [...base.unidadesInteres], presupuesto: base.presupuesto, proposito: base.proposito, formaPago: base.formaPago, asesor: base.asesor,
    })
    setPresupuesto(base.presupuesto ? String(base.presupuesto) : '')
    setUnidad(''); setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setF((x) => ({ ...x, [k]: v }))

  function guardar() {
    setError(null)
    const p = presupuesto.trim() ? Number(presupuesto.replace(/\./g, '').replace(',', '.')) : null
    const input = { ...f, presupuesto: p }
    try {
      if (cliente) {
        update((s) => actualizarCliente(s, cliente.id, input, actor, inv))
        onSaved(cliente.id, `Datos de ${input.nombre} actualizados`)
      } else {
        let id = ''
        update((s) => { const r = crearCliente(s, input, actor, inv); id = r.cliente.id; return r.state })
        onSaved(id, `Cliente ${input.nombre.trim()} registrado`)
      }
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
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
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo id="cf-nombre" label="Nombre *" value={f.nombre} onChange={(v) => set('nombre', v)} />
            <Campo id="cf-tel" label="Teléfono" value={f.telefono} onChange={(v) => set('telefono', v)} />
            <Campo id="cf-email" label="Correo" type="email" value={f.email} onChange={(v) => set('email', v)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Sel id="cf-origen" label="Origen *" value={f.origen} onChange={(v) => set('origen', v as Origen)} items={Object.entries(ORIGENES)} />
            {(f.origen === 'referido' || f.origen === 'corredor') && (
              <Campo id="cf-origen-det" label={f.origen === 'referido' ? 'Referido por *' : 'Corredor *'} value={f.origenDetalle} onChange={(v) => set('origenDetalle', v)} />
            )}
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
          <Campo id="cf-asesor" label={can('clientes.asignar') ? 'Asesor responsable *' : 'Asesor responsable (solo gerencia lo reasigna)'} value={f.asesor} onChange={(v) => set('asesor', v)} disabled={!can('clientes.asignar')} />
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={guardar}>{cliente ? 'Guardar cambios' : 'Registrar cliente'}</Button>
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
