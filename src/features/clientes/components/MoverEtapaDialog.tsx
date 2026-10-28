import { useEffect, useState } from 'react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { ETAPAS, type Etapa } from '../model'
import { moverEtapa } from '../service'
import { useClientes } from '../store'

/** Pide los datos obligatorios para Perdido (motivo) y Seguimiento futuro (fecha). */
export default function MoverEtapaDialog({ pedido, onClose, onDone }: {
  pedido: { id: string; nombre: string; etapa: Etapa } | null
  onClose: () => void
  onDone: (m: string) => void
}) {
  const { update } = useClientes()
  const { actor } = useSession()
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setMotivo(''); setFecha(''); setError(null) }, [pedido])
  if (!pedido) return null
  const perdido = pedido.etapa === 'perdido'

  function confirmar() {
    setError(null)
    try {
      update((s) => moverEtapa(s, pedido!.id, pedido!.etapa, actor, perdido ? { motivo } : { fechaRetomar: fecha }))
      onDone(`${pedido!.nombre} → ${ETAPAS[pedido!.etapa].label}`)
      onClose()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{perdido ? 'Marcar como perdido' : 'Seguimiento futuro'}</DialogTitle>
          <DialogDescription>{pedido.nombre}</DialogDescription>
        </DialogHeader>
        {perdido ? (
          <div className="grid gap-1.5">
            <Label htmlFor="me-motivo" className="text-xs">Motivo *</Label>
            <Textarea id="me-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Compró en otro proyecto, sin crédito aprobado, precio fuera de presupuesto…" />
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="me-fecha" className="text-xs">Retomar el contacto el *</Label>
            <Input id="me-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        )}
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
