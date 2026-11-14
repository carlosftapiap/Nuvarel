import { useEffect, useState } from 'react'
import { useConexion } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import type { Reserva } from '../model'

/** Diálogos de las acciones sobre una reserva: verificar, rechazar, autorizar y anular. */
export function ConfirmarDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (i: { comprobante: string; montoRecibido: number; verificadoBanco: boolean }) => void }) {
  const [verificado, setVerificado] = useState(false)
  const [comprobante, setComprobante] = useState('')
  const [monto, setMonto] = useState('')
  const [error, setError] = useState<string | null>(null)
  // El comprobante que registró el vendedor es solo una referencia: Finanzas confirma la del banco.
  useEffect(() => { if (reserva?.comprobante) setComprobante(reserva.comprobante) }, [reserva])
  if (!reserva) return null
  const montoNum = leerMonto(monto) ?? NaN
  const listo = comprobante.trim().length >= 3 && Number.isFinite(montoNum) && montoNum > 0 && verificado
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setComprobante(''); setMonto(''); setError(null); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verificar pago de la reserva {reserva.codigo}</DialogTitle>
          <DialogDescription>{reserva.clienteNombre} · Reserva acordada {fmtUsd2(reserva.montoReserva)}, que se acredita al pago a la firma del {reserva.reservaPct} %. La unidad se bloquea cuando Gerencia apruebe la reserva.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rc-comp" className="text-xs">Comprobante *</Label>
            <Input id="rc-comp" value={comprobante} onChange={(e) => setComprobante(e.target.value)} placeholder="Nº de transferencia o recibo" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-monto" className="text-xs">Monto recibido (USD) *</Label>
            <Input id="rc-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={String(reserva.montoReserva)} />
          </div>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} />Verifiqué el ingreso en la cuenta bancaria correspondiente</label>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} onClick={() => { try { onConfirm({ comprobante, montoRecibido: montoNum, verificadoBanco: verificado }); setComprobante(''); setMonto(''); setVerificado(false) } catch (e) { setError((e as Error).message) } }}>Verificar ingreso</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RechazarPagoDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  if (!reserva) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar el pago de {reserva.codigo}</DialogTitle>
          <DialogDescription>{reserva.clienteNombre}. El comprobante se conserva con el motivo y la reserva vuelve a esperar el pago.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="rp-motivo" className="text-xs">Motivo del rechazo *</Label>
          <Textarea id="rp-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant="destructive" disabled={motivo.trim().length < 5} onClick={() => { onConfirm(motivo.trim()); setMotivo('') }}>Rechazar pago</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AprobarDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  const { datos } = useConexion()
  const [excepciones, setExcepciones] = useState<string[] | null>(null)
  const id = reserva?.id
  useEffect(() => {
    setExcepciones(null)
    if (!id || !datos) return
    void datos.rpc<string[] | null>('reservas_excepciones', { p_id: id }).then((v) => setExcepciones(v ?? [])).catch(() => setExcepciones([]))
  }, [id, datos])
  if (!reserva) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Autorizar la reserva {reserva.codigo}</DialogTitle>
          <DialogDescription>Finanzas ya verificó el ingreso de {fmtUsd2(reserva.montoRecibido ?? 0)}. No se confirmó sola por una excepción. Al autorizarla, la unidad queda reservada y {reserva.clienteNombre} pasa a Reserva.</DialogDescription>
        </DialogHeader>
        {excepciones && excepciones.length > 0 && (
          <ul aria-label="Excepciones" className="list-disc rounded-md bg-sky-50 py-2 pl-7 pr-3 text-xs text-sky-900">{excepciones.map((x) => <li key={x}>{x}</li>)}</ul>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ap-motivo" className="text-xs">Motivo de la autorización *</Label>
          <Textarea id="ap-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button disabled={motivo.trim().length < 5} onClick={() => { onConfirm(motivo); setMotivo('') }}>Autorizar reserva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AnularDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  if (!reserva) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular la reserva {reserva.codigo}</DialogTitle>
          <DialogDescription>{reserva.estado === 'confirmada' ? 'La unidad volverá a estar disponible y el cliente pasará a Negociación.' : 'La solicitud se cerrará; la unidad no cambia.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="ra-motivo" className="text-xs">Motivo *</Label>
          <Textarea id="ra-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant="destructive" disabled={motivo.trim().length < 5} onClick={() => { onConfirm(motivo); setMotivo('') }}>Anular</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
