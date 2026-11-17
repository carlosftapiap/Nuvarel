import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorArchivo, MEDIOS_PAGO, type DatosPago, type MedioPago } from '@/features/cobranza/comprobantes'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto, NOTA_RESERVA } from '@/features/inventario/pricing'
import { RELACION_PAGADOR, type RelacionPagador, type Reserva } from '../model'

/** Solo cuando el cliente ya pagó. Registra la evidencia, no confirma nada: Finanzas verifica el ingreso. */
export default function RegistrarPagoDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (p: DatosPago) => void }) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyGuayaquil())
  const [banco, setBanco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [medio, setMedio] = useState<MedioPago>('transferencia')
  const [pagNombre, setPagNombre] = useState<string | null>(null)
  const [pagId, setPagId] = useState<string | null>(null)
  const [pagRel, setPagRel] = useState<RelacionPagador | null>(null)
  const [pagRef, setPagRef] = useState('')
  if (!reserva) return null
  // Con la regla de Cumplimiento (la base trae el estado), el pago registra también quién lo hizo.
  const pidePagador = reserva.cumplimiento !== undefined
  const nombrePagador = pagNombre ?? reserva.pagador?.nombre ?? reserva.clienteNombre
  const idPagador = pagId ?? reserva.pagador?.identificacion ?? reserva.clienteDocumento ?? ''
  const relPagador = pagRel ?? reserva.pagador?.relacion ?? 'titular'
  const pagadorListo = !pidePagador || (nombrePagador.trim().length >= 3 && idPagador.trim().length >= 5 && idPagador.trim().length <= 20)
  const limpiar = () => { setMonto(''); setFecha(hoyGuayaquil()); setBanco(''); setReferencia(''); setArchivo(null); setMedio('transferencia'); setPagNombre(null); setPagId(null); setPagRel(null); setPagRef('') }
  const cerrar = () => { limpiar(); onClose() }
  const montoNum = leerMonto(monto) ?? reserva.montoReserva
  const errorAdjunto = errorArchivo(archivo)
  const listo = referencia.trim().length >= 3 && banco.trim().length >= 2 && !!fecha && Number.isFinite(montoNum) && montoNum > 0 && !!archivo && !errorAdjunto && pagadorListo
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
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="rq-medio" className="text-xs">Medio de pago *</Label>
              <select id="rq-medio" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
                {Object.entries(MEDIOS_PAGO).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-banco" className="text-xs">{MEDIOS_PAGO[medio].banco} *</Label>
              <Input id="rq-banco" value={banco} onChange={(e) => setBanco(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rq-ref" className="text-xs">{MEDIOS_PAGO[medio].referencia} *</Label>
              <Input id="rq-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rq-archivo" className="text-xs">Foto o PDF del comprobante * (máximo 10 MB)</Label>
            <Input id="rq-archivo" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          <FieldError>{errorAdjunto}</FieldError>
          {pidePagador && (
            <fieldset className="grid gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-semibold">Quién hizo el pago</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="rq-pag-nombre" className="text-xs">Nombre del pagador *</Label>
                  <Input id="rq-pag-nombre" value={nombrePagador} onChange={(e) => setPagNombre(e.target.value)} maxLength={120} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rq-pag-id" className="text-xs">Cédula, RUC o pasaporte *</Label>
                  <Input id="rq-pag-id" value={idPagador} onChange={(e) => setPagId(e.target.value)} maxLength={20} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rq-pag-rel" className="text-xs">Relación con el comprador *</Label>
                  <select id="rq-pag-rel" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={relPagador} onChange={(e) => setPagRel(e.target.value as RelacionPagador)}>
                    {Object.entries(RELACION_PAGADOR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="rq-pag-ref" className="text-xs">Referencia del pagador (opcional)</Label>
                  <Input id="rq-pag-ref" value={pagRef} onChange={(e) => setPagRef(e.target.value)} maxLength={60} placeholder="Cuenta de origen o nota" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Cumplimiento revisa al pagador. Cambiarlo después de su aprobación exige una nueva revisión.</p>
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">Monto acordado: {fmtUsd2(reserva.montoReserva)}. {NOTA_RESERVA}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cerrar}>Cancelar</Button>
          <Button disabled={!listo} onClick={() => {
            const pagador = pidePagador
              ? { nombre: nombrePagador.trim(), identificacion: idPagador.trim(), relacion: relPagador, referencia: pagRef.trim().length >= 3 ? pagRef.trim() : null }
              : undefined
            onConfirm({ monto: montoNum, fecha, banco: banco.trim(), referencia: referencia.trim(), archivo: archivo!, medio, pagador }); limpiar()
          }}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
