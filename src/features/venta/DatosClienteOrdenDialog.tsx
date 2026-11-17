import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Datos } from '@/features/conexion/datos'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { ESTADOS_CIVILES } from '@/features/contratos/model'
import { ORIGENES } from '@/features/clientes/model'
import { cargarCamposCliente, guardarDatosCliente, type CamposClienteOrden } from './ordenContratoRemoto'

const campo = 'h-9 w-full rounded-md border border-border bg-white px-2 text-sm'

/** Completa en Clientes los datos que la orden de contrato necesita. Solo se guardan los campos de esta pantalla. */
export default function DatosClienteOrdenDialog({ open, onOpenChange, datos, clienteId, tipo, onGuardado }: {
  open: boolean; onOpenChange: (v: boolean) => void; datos: Datos; clienteId: string; tipo: TipoPersona; onGuardado: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    cargarCamposCliente(datos, clienteId).then((c: CamposClienteOrden | undefined) => setF({
      domicilio: c?.domicilio ?? '',
      estado_civil: c?.estado_civil ?? '',
      origen: c?.origen ?? '',
      representante_nombre: c?.representante_nombre ?? '',
      representante_documento: c?.representante_documento ?? '',
      representante_calidad: c?.representante_calidad ?? '',
    })).catch((e: Error) => setError(e.message))
  }, [open, datos, clienteId])

  const juridica = tipo === 'juridica'
  const set = (k: string) => (e: { target: { value: string } }) => setF((prev) => ({ ...prev, [k]: e.target.value }))

  const guardar = async () => {
    if (juridica && (!f.representante_nombre?.trim() || !f.representante_documento?.trim())) {
      setError('Para una persona jurídica falta el nombre y la cédula del representante legal.')
      return
    }
    setGuardando(true); setError(null)
    try {
      const v = (k: string) => (f[k]?.trim() ? f[k].trim() : null)
      await guardarDatosCliente(datos, clienteId, {
        domicilio: v('domicilio'),
        estado_civil: juridica ? null : v('estado_civil'),
        origen: v('origen'),
        representante_nombre: juridica ? v('representante_nombre') : null,
        representante_documento: juridica ? v('representante_documento') : null,
        representante_calidad: juridica ? v('representante_calidad') : null,
      })
      onGuardado()
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Datos del cliente para la orden de contrato</DialogTitle>
          <DialogDescription>Se guardan en la ficha del cliente. Lo que dejes vacío aparece como «No registrado» en la orden.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1 font-semibold">Dirección / domicilio
            <input className={campo} value={f.domicilio ?? ''} onChange={set('domicilio')} maxLength={200} />
          </label>
          {!juridica && (
            <label className="grid gap-1 font-semibold">Estado civil
              <select className={campo} value={f.estado_civil ?? ''} onChange={set('estado_civil')}>
                <option value="">Sin indicar</option>
                {Object.entries(ESTADOS_CIVILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          )}
          <label className="grid gap-1 font-semibold">Medio de captación
            <select className={campo} value={f.origen ?? ''} onChange={set('origen')}>
              <option value="">Sin indicar</option>
              {Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {juridica && (
            <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-700">Representante legal</legend>
              <label className="grid gap-1 font-semibold">Nombre completo
                <input className={campo} value={f.representante_nombre ?? ''} onChange={set('representante_nombre')} maxLength={160} />
              </label>
              <label className="grid gap-1 font-semibold">Cédula
                <input className={campo} value={f.representante_documento ?? ''} onChange={set('representante_documento')} maxLength={20} />
              </label>
              <label className="grid gap-1 font-semibold">Calidad (p. ej. gerente general)
                <input className={campo} value={f.representante_calidad ?? ''} onChange={set('representante_calidad')} maxLength={80} />
              </label>
            </fieldset>
          )}
          {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar datos'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
