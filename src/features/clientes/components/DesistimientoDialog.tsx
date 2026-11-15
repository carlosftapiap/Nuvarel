import { useEffect, useState } from 'react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { ESTADOS } from '@/features/inventario/estados'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import type { EstadoComercial } from '@/features/inventario/types'
import { MOTIVOS_DESISTIMIENTO, previsualizar, registrar, type MotivoDesistimiento, type Previsualizacion } from '../desistimiento'
import { ETAPAS_OPORTUNIDAD } from '../model'
import ReglasAnulacion from './ReglasAnulacion'
import { clientesVisibles } from '../service'
import { useClientes } from '../store'
import { numeroComercial } from '@/features/inventario/nomenclatura'

const SIN_OPERACION = 'sin_operacion'

/** Sin cliente indicado permite elegirlo. El servidor valida todo otra vez y decide qué le ocurre a la unidad. */
export default function DesistimientoDialog({ clienteId, oportunidadId, onClose, onDone }: {
  clienteId?: string
  oportunidadId?: string
  onClose: () => void
  onDone: (mensaje: string) => void | Promise<void>
}) {
  const { datos, state, oportunidades, recargar } = useClientes()
  const { state: inv, recargar: recargarInventario } = useInventory()
  const { actor } = useSession()
  const [cliente, setCliente] = useState(clienteId ?? '')
  const abiertas = oportunidades.filter((o) => o.clienteId === cliente && o.etapa !== 'perdida')
  const [operacion, setOperacion] = useState(oportunidadId ?? '')
  const [motivo, setMotivo] = useState<MotivoDesistimiento | ''>('')
  const [observaciones, setObservaciones] = useState('')
  const [vista, setVista] = useState<Previsualizacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const candidatos = clientesVisibles(state.clientes, actor).filter((c) => c.etapa !== 'perdido' || oportunidades.some((o) => o.clienteId === c.id && o.etapa !== 'perdida'))
  // Con una sola negociación se elige sola; sin ninguna, el desistimiento es del cliente.
  const elegida = operacion || (abiertas.length === 1 ? abiertas[0].id : abiertas.length === 0 && cliente ? SIN_OPERACION : '')
  const oportunidad = elegida && elegida !== SIN_OPERACION ? elegida : null
  const dpt = (codigo: string | null | undefined) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? numeroComercial(codigo ?? '')

  useEffect(() => {
    if (!datos || !cliente || !elegida) { setVista(null); return }
    let vivo = true
    setVista(null); setError(null)
    previsualizar(datos, cliente, oportunidad).then((v) => { if (vivo) setVista(v) }).catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [datos, cliente, elegida, oportunidad])

  const obsOk = motivo !== 'otro' || observaciones.trim().length >= 5
  const listo = !!cliente && !!elegida && !!motivo && obsOk && !!vista && !vista.bloqueo && !enviando

  const confirmar = async () => {
    if (!datos || !motivo) return
    setError(null); setEnviando(true)
    try {
      await registrar(datos, cliente, oportunidad, motivo, observaciones.trim())
      await Promise.all([recargar(), recargarInventario()])
      await onDone(vista?.nivel === 'directo' ? 'Desistimiento registrado' : 'Solicitud enviada: nada cambia hasta que se autorice')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const efectoUnidad = !vista?.unidad ? null
    : !vista.reserva ? `${dpt(vista.unidad)}: no cambia, porque esta operación no tiene reserva.`
    : vista.unidad_destino ? `${dpt(vista.unidad)} pasa a ${ESTADOS[vista.unidad_destino as EstadoComercial]?.label.toLowerCase() ?? vista.unidad_destino}.`
    : `${dpt(vista.unidad)} sigue ${ESTADOS[vista.unidad_estado as EstadoComercial]?.label.toLowerCase() ?? vista.unidad_estado}: esta operación no la tenía retenida o hay otro compromiso.`

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar desistimiento</DialogTitle>
          <DialogDescription>Según el caso se aplica en el momento o queda pendiente de autorización. Nada se borra.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!clienteId && (
            <div className="grid gap-1.5">
              <Label htmlFor="de-cliente" className="text-xs">Cliente *</Label>
              <Select value={cliente} onValueChange={(v) => { setCliente(v); setOperacion('') }}>
                <SelectTrigger id="de-cliente" className="h-9 w-full"><SelectValue placeholder="Elige el cliente" /></SelectTrigger>
                <SelectContent>{candidatos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {cliente && abiertas.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="de-operacion" className="text-xs">Operación *</Label>
              <Select value={elegida} onValueChange={setOperacion}>
                <SelectTrigger id="de-operacion" className="h-9 w-full"><SelectValue placeholder="Elige la operación" /></SelectTrigger>
                <SelectContent>{abiertas.map((o) => <SelectItem key={o.id} value={o.id}>{o.codigoUnidad ? dpt(o.codigoUnidad) : `Tipología ${o.tipologia}`} · {ETAPAS_OPORTUNIDAD[o.etapa]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {cliente && abiertas.length === 0 && <p className="text-xs text-muted-foreground">Este cliente no tiene negociaciones abiertas: pasará a Perdido.</p>}
          <div className="grid gap-1.5">
            <Label htmlFor="de-motivo" className="text-xs">Motivo *</Label>
            <Select value={motivo} onValueChange={(v) => setMotivo(v as MotivoDesistimiento)}>
              <SelectTrigger id="de-motivo" className="h-9 w-full"><SelectValue placeholder="Elige el motivo" /></SelectTrigger>
              <SelectContent>{Object.entries(MOTIVOS_DESISTIMIENTO).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="de-obs" className="text-xs">Observaciones{motivo === 'otro' ? ' *' : ''}</Label>
            <Textarea id="de-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>
          {vista?.bloqueo && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{vista.bloqueo}</p>}
          {vista && !vista.bloqueo && (
            <div className="grid gap-1 rounded-lg bg-muted/60 px-3 py-2 text-xs" aria-label="Qué ocurrirá">
              {vista.nivel !== 'directo' && (
                <p className="font-medium text-amber-900">
                  {vista.nivel === 'gerencia_y_finanzas' ? 'Requiere la autorización de Gerencia y la revisión de Finanzas.' : 'Requiere la autorización de un supervisor o de Gerencia.'} Por ahora solo se envía la solicitud: nada cambia.
                </p>
              )}
              <b>{vista.nivel === 'directo' ? 'Al confirmar:' : 'Cuando se autorice:'}</b>
              {vista.reserva && <span>La reserva {vista.reserva} se anula.</span>}
              {oportunidad && <span>La negociación se cierra como perdida por desistimiento.</span>}
              {efectoUnidad && <span>{efectoUnidad}</span>}
              {(vista.monto_recibido || vista.comprobante) && (
                <span>{vista.monto_recibido ? `Hay ${fmtUsd2(vista.monto_recibido)} recibidos` : `Hay un comprobante registrado (${vista.comprobante})`}. No se devuelve nada automáticamente.</span>
              )}
            </div>
          )}
          {cliente && elegida && <ReglasAnulacion actual={vista?.bloqueo?.includes('contrato') ? 'contrato' : vista && !vista.reserva ? 'sin_reserva' : vista?.nivel} />}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant="destructive" disabled={!listo} onClick={() => void confirmar()}>{enviando ? 'Registrando…' : vista && vista.nivel !== 'directo' ? 'Enviar solicitud' : 'Confirmar desistimiento'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
