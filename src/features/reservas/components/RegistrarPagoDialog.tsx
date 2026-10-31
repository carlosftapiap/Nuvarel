import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorArchivo, type DatosPago } from '@/features/cobranza/comprobantes'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto, NOTA_RESERVA } from '@/features/inventario/pricing'
import type { Reserva } from '../model'

/** Solo cuando el cliente ya pagó. Registra la evidencia, no confirma nada: Finanzas verifica el ingreso. */
export default function RegistrarPagoDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (p: DatosPago) => void }) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyGuayaquil())
  const [banco, setBanco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  if (!reserva) return null
  const limpiar = () => { setMonto(''); setFecha(hoyGuayaquil()); setBanco(''); setReferencia(''); setArchivo(null) }
  const cerrar = () => { limpiar(); onClose() }
  const montoNum = leerMonto(monto) ?? reserva.montoReserva
  const errorAdjunto = errorArchivo(archivo)
  const listo = referencia.trim().length >= 3 && banco.trim().length >= 2 && !!fecha && Number.isFinite(montoNum) && montoNum > 0 && !!archivo && !errorAdjunto
  return (
    <Dialog open onOpenChange={(o) => { if (!o) cerrar() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago de {reserva.codigo}</DialogTitle>
          <DialogDescription>{reserva.clienteNombre}. Úsalo solo si el cliente ya pagó. Finanzas verificará el ingreso en el banco; este registro no confirma el pago.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rq-monto" className="text-xs">Monto pagado (USD) *</Label>
              <Input id="rq-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder={String(reserva.montoReserva)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-fecha" className="text-xs">Fecha del pago *</Label>
              <Input id="rq-fecha" type="date" max={hoyGuayaquil()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-banco" className="text-xs">Banco *</Label>
              <Input id="rq-banco" value={banco} onChange={(e) => setBanco(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-ref" className="text-xs">Número de transferencia o depósito *</Label>
              <Input id="rq-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rq-archivo" className="text-xs">Foto o PDF del comprobante * (máximo 10 MB)</Label>
            <Input id="rq-archivo" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          <FieldError>{errorAdjunto}</FieldError>
          <p className="text-[11px] text-muted-foreground">Monto acordado: {fmtUsd2(reserva.montoReserva)}. {NOTA_RESERVA}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cerrar}>Cancelar</Button>
          <Button disabled={!listo} onClick={() => { onConfirm({ monto: montoNum, fecha, banco: banco.trim(), referencia: referencia.trim(), archivo: archivo! }); limpiar() }}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
