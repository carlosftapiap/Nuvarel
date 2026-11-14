import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { errorArchivo, MEDIOS_PAGO, type DatosPago, type MedioPago } from '../comprobantes'
import { aplicacionPago, type ResumenContrato } from '../tablero'

/** Registra un pago de la entrada. Queda por verificar: no cuenta como cobrado hasta que otra persona lo confirme. */
export default function RegistrarPagoCuota({ contratos, inicial, departamento, onGuardar, onClose }: {
  contratos: ResumenContrato[]
  inicial: string | null
  departamento: (unidad: string) => string
  onGuardar: (contratoId: string, pago: DatosPago) => Promise<void>
  onClose: () => void
}) {
  const [contratoId, setContratoId] = useState(inicial ?? (contratos.length === 1 ? contratos[0].contrato.id : ''))
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyGuayaquil())
  const [banco, setBanco] = useState('')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [medio, setMedio] = useState<MedioPago>('transferencia')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const r = contratos.find((x) => x.contrato.id === contratoId) ?? null
  const proxima = r?.cuotas.find((q) => q.esEntrada && q.saldo > 0) ?? null
  const valor = monto === '' ? (proxima?.saldo ?? null) : leerMonto(monto)
  const reparto = r && valor && valor > 0 ? aplicacionPago(r, valor) : null
  const adjunto = errorArchivo(archivo)
  const listo = !!r && !!valor && valor > 0 && !!fecha && banco.trim().length >= 2 && referencia.trim().length >= 3 && !!archivo && !adjunto && !enviando

  async function guardar() {
    setEnviando(true); setError(null)
    try {
      await onGuardar(contratoId, { monto: valor!, fecha, banco: banco.trim(), referencia: referencia.trim(), archivo: archivo!, medio })
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>Otra persona autorizada debe confirmarlo. Hasta entonces no cuenta como cobrado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="rc-cliente" className="text-xs">Cliente *</Label>
            <select id="rc-cliente" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={contratoId} onChange={(e) => { setContratoId(e.target.value); setMonto('') }}>
              <option value="">Elige un cliente</option>
              {contratos.map((x) => <option key={x.contrato.id} value={x.contrato.id}>{x.contrato.cliente} · Dpto. {departamento(x.contrato.unidad)}</option>)}
            </select>
          </div>
          {r && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs" aria-label="Cuota">
              {proxima ? <><b>Cuota:</b> {proxima.concepto} · vence {fmtFechaCorta(proxima.vencimiento)} · saldo {fmtUsd2(proxima.saldo)}</> : 'La entrada de este contrato ya está pagada.'}
              {reparto && reparto.cuotas.length > 1 && <span className="mt-0.5 block text-xs text-muted-foreground">Este valor cubre {reparto.cuotas.length} cuotas, en orden.</span>}
              {reparto && reparto.parcial && <span className="mt-0.5 block text-xs text-muted-foreground">Pago parcial: la cuota quedará con saldo {fmtUsd2(reparto.parcial)}.</span>}
              {reparto && reparto.excedente > 0 && <span className="mt-0.5 block text-xs text-amber-800">Supera el saldo de la entrada en {fmtUsd2(reparto.excedente)}. Revisa el valor.</span>}
              {r.comprobantesPendientes > 0 && <span className="mt-0.5 block text-xs text-amber-800">Este cliente ya tiene {r.comprobantesPendientes === 1 ? '1 pago' : `${r.comprobantesPendientes} pagos`} por verificar. Comprueba que no sea el mismo.</span>}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="rc-monto" className="text-xs">Valor pagado (USD) *</Label>
              <Input id="rc-monto" inputMode="decimal" value={monto} placeholder={proxima ? String(proxima.saldo) : ''} onChange={(e) => setMonto(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-fecha" className="text-xs">Fecha *</Label>
              <Input id="rc-fecha" type="date" max={hoyGuayaquil()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="rc-medio" className="text-xs">Medio de pago *</Label>
              <select id="rc-medio" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={medio} onChange={(e) => setMedio(e.target.value as MedioPago)}>
                {Object.entries(MEDIOS_PAGO).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-banco" className="text-xs">{MEDIOS_PAGO[medio].banco} *</Label>
              <Input id="rc-banco" value={banco} onChange={(e) => setBanco(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rc-ref" className="text-xs">{MEDIOS_PAGO[medio].referencia} *</Label>
              <Input id="rc-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rc-archivo" className="text-xs">Comprobante: foto o PDF * (máximo 10 MB)</Label>
            <Input id="rc-archivo" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          <FieldError>{adjunto ?? error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} onClick={() => void guardar()}>{enviando && <Loader2 className="animate-spin" />}Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
