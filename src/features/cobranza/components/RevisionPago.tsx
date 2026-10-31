import { useEffect, useState } from 'react'
import { Download, Loader2, Paperclip } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { AVISO_RECIBO, archivoComprobante, cargarHistorial, completarRecibo, descargarRecibo, rechazarPagoContrato, rechazarPagoReserva, type Comprobante, type EventoHistorial, type Recibo } from '../comprobantes'

export interface PagoEnRevision {
  tipo: 'reserva' | 'pago'
  id: string
  titulo: string
  /** Monto sugerido para confirmar. En un pago de contrato no se edita. */
  monto: number
  referencia: string
  fecha: string
  /** Sigue esperando la decisión de Finanzas. */
  pendiente: boolean
  /** Quien lo registró o solicitó: no puede decidirlo. */
  propio: boolean
}

/** Comprobante, datos reportados, historial y decisión. La imagen por sí sola no confirma el pago. */
export default function RevisionPago({ pago, comprobantes, recibo, datos, almacen, ejecutar, onClose }: {
  pago: PagoEnRevision
  comprobantes: Comprobante[]
  recibo: Recibo | null
  datos: Datos
  almacen: AlmacenContratos | null
  ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>
  onClose: () => void
}) {
  const { can } = useSession()
  const esReserva = pago.tipo === 'reserva'
  const puedeDecidir = pago.pendiente && !pago.propio && can(esReserva ? 'reservas.verificar_pago' : 'cobranzas.verificar')
  const actual = comprobantes[0] ?? null
  const [monto, setMonto] = useState(String(actual?.monto ?? pago.monto))
  const [fecha, setFecha] = useState(actual?.fecha ?? pago.fecha ?? hoyGuayaquil())
  const [referencia, setReferencia] = useState(actual?.referencia ?? pago.referencia)
  const [verificado, setVerificado] = useState(false)
  const [nota, setNota] = useState('')
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [historial, setHistorial] = useState<EventoHistorial[]>([])
  const [vista, setVista] = useState<string | null>(null)
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null)

  useEffect(() => {
    cargarHistorial(datos, esReserva ? pago.id : null, esReserva ? null : pago.id).then(setHistorial).catch(() => setHistorial([]))
  }, [datos, esReserva, pago.id])
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista) }, [vista])

  const verArchivo = async (c: Comprobante) => {
    setErrorArchivo(null)
    try { setVista(URL.createObjectURL(await archivoComprobante(almacen, c))) } catch (e) { setErrorArchivo((e as Error).message) }
  }
  const enviar = async (fn: () => Promise<unknown>, ok: string) => {
    setEnviando(true)
    await ejecutar(fn, ok)
    onClose()
  }
  // Sin comprobante con archivo, el servidor no confirma: solo se puede rechazar y volver a registrar.
  const sinArchivo = !comprobantes.some((c) => c.estado === 'reportado' && c.ruta)
  const confirmar = () => enviar(async () => {
    const id = esReserva
      ? await datos.rpc<string | null>('reservas_confirmar_pago', { p_id: pago.id, p_monto: leerMonto(monto), p_fecha: fecha, p_referencia: referencia.trim(), p_verificado_banco: verificado, p_motivo: nota })
      : await datos.rpc<string | null>('cobranzas_confirmar_pago', { p_payment: pago.id, p_verificado_banco: verificado, p_motivo: nota })
    await completarRecibo(datos, almacen, id)
  }, 'Pago confirmado')
  const rechazar = () => enviar(() => (esReserva ? rechazarPagoReserva(datos, pago.id, motivo.trim()) : rechazarPagoContrato(datos, pago.id, motivo.trim())), 'Pago rechazado')

  const montoValido = (leerMonto(monto) ?? 0) > 0
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{pago.titulo}</DialogTitle>
          <DialogDescription>El comprobante por sí solo no confirma el pago: quien confirma debe verificar el ingreso en la cuenta bancaria.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-xs">
          {comprobantes.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">Este pago no tiene comprobante adjunto. Solo se registró la referencia {pago.referencia}.</p>}
          {comprobantes.map((c) => (
            <section key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="tabular-nums">{fmtUsd2(c.monto)} · {fmtFechaCorta(c.fecha)}</b>
                <span className="capitalize text-muted-foreground">{c.estado}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{c.banco} · ref. {c.referencia} · cargado el {new Date(c.cargadoEn).toLocaleString('es-EC')}</p>
              {c.motivoRevision && <p className="mt-1">Revisión: {c.motivoRevision}</p>}
              {c.ruta
                ? <Button size="xs" variant="outline" className="mt-2" onClick={() => void verArchivo(c)}><Paperclip />Ver comprobante · {c.archivoNombre}</Button>
                : <p className="mt-1 text-amber-800">Sin archivo adjunto.</p>}
            </section>
          ))}
          <FieldError>{errorArchivo}</FieldError>
          {vista && (actual?.archivoMime === 'application/pdf'
            ? <iframe title="Comprobante" src={vista} className="h-96 w-full rounded-lg border border-border" />
            : <img alt="Comprobante de pago" src={vista} className="max-h-96 w-full rounded-lg border border-border object-contain" />)}

          {recibo && (
            <section className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
              <span className="min-w-0 flex-1">Recibo {recibo.numero}{recibo.anuladoEn ? ' · anulado' : ''}. <span className="text-[11px]">{AVISO_RECIBO}</span></span>
              <Button size="xs" variant="outline" onClick={() => void descargarRecibo(almacen, recibo, comprobantes.find((c) => c.id === recibo.comprobanteId)?.archivoNombre)}><Download />Descargar recibo</Button>
            </section>
          )}

          {pago.pendiente && pago.propio && <p className="text-muted-foreground">Lo verifica otra persona.</p>}
          {puedeDecidir && sinArchivo && <p className="rounded-md bg-rose-50 px-3 py-2 text-rose-800">No se puede confirmar sin comprobante bancario. Recházalo para registrarlo de nuevo con su foto o PDF.</p>}

          {puedeDecidir && !rechazando && (
            <section className="grid gap-3 rounded-lg border border-border p-3">
              {esReserva && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1"><Label htmlFor="rv-monto" className="text-[11px]">Monto recibido (USD) *</Label><Input id="rv-monto" inputMode="decimal" className="h-8" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
                  <div className="grid gap-1"><Label htmlFor="rv-fecha" className="text-[11px]">Fecha del ingreso *</Label><Input id="rv-fecha" type="date" max={hoyGuayaquil()} className="h-8" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
                  <div className="grid gap-1"><Label htmlFor="rv-ref" className="text-[11px]">Referencia bancaria *</Label><Input id="rv-ref" className="h-8" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
                </div>
              )}
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} />Verifiqué el ingreso en la cuenta bancaria correspondiente</label>
              <div className="grid gap-1"><Label htmlFor="rv-nota" className="text-[11px]">Observación</Label><Textarea id="rv-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
            </section>
          )}
          {puedeDecidir && rechazando && (
            <div className="grid gap-1"><Label htmlFor="rv-motivo" className="text-[11px]">Motivo del rechazo *</Label><Textarea id="rv-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          )}

          {historial.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium">Historial</summary>
              <ul className="mt-2 grid gap-1">
                {historial.map((h, i) => <li key={i} className="rounded-md bg-muted/50 px-2 py-1"><b>{h.accion}</b> · {new Date(h.fecha).toLocaleString('es-EC')} · {h.usuario}{h.motivo ? <div className="text-muted-foreground">{h.motivo}</div> : null}</li>)}
              </ul>
            </details>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          {puedeDecidir && !rechazando && <Button variant="outline" onClick={() => setRechazando(true)}>Rechazar pago</Button>}
          {puedeDecidir && rechazando && <Button variant="outline" onClick={() => setRechazando(false)}>Volver</Button>}
          {puedeDecidir && rechazando && <Button variant="destructive" disabled={enviando || motivo.trim().length < 5} onClick={() => void rechazar()}>{enviando && <Loader2 className="animate-spin" />}Confirmar rechazo</Button>}
          {puedeDecidir && !rechazando && <Button disabled={enviando || sinArchivo || !verificado || (esReserva && (!montoValido || referencia.trim().length < 3))} onClick={() => void confirmar()}>{enviando && <Loader2 className="animate-spin" />}Confirmar pago</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
