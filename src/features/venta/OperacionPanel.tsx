import { CheckCircle2, Download, FileCheck2, FileText, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { descargarConstanciaReserva, descargarRecibo } from '@/features/cobranza/comprobantes'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { errorMontoReserva } from './operacion'
import RegistrarPagoDialog from '@/features/reservas/components/RegistrarPagoDialog'
import { ESTADO_RESERVA } from '@/features/reservas/model'
import DocumentosVenta from './DocumentosVenta'
import GuiaVenta, { Destacado } from './GuiaVenta'
import type { Operacion } from './useOperacion'


/** Estado de la operación y próximos pasos. Cada acción la ejecuta el módulo responsable; aquí solo se dispara. */
export default function OperacionPanel({ op }: { op: Operacion }) {
  const { cotizacion, reserva, recibo, paso, can, calc, firma, ocupado, erroresEmision, bloqueoCalculo, montoNuevo, setMontoNuevo, error, aviso, errorCarga, almacen, pagoAbierto, setPagoAbierto } = op
  const errorMonto = calc.plan ? errorMontoReserva(calc.reserva, calc.plan.reserva) : null

  return (
    <section aria-labelledby="ve-op" className="dashboard-card p-5">
      <h2 id="ve-op" className="text-sm font-semibold">Operación</h2>
      <div className="mt-3"><GuiaVenta paso={paso} clienteId={op.clienteId} compacta /></div>

      <dl className="mt-3 grid gap-1.5 text-xs">
        {cotizacion && <Fila t="Cotización" v={`${cotizacion.numero} · vence ${fmtFechaCorta(cotizacion.validaHasta)}`} />}
        {cotizacion && <Fila t="Plan" v={cotizacion.plan ? `${fmtUsd2(cotizacion.plan.precioFinal)} · ${cotizacion.plan.meses} meses` : '—'} />}
        {reserva && <Fila t="Reserva" v={`${reserva.codigo} · ${ESTADO_RESERVA[reserva.estado].label}`} />}
        {reserva && <Fila t="Monto acordado" v={fmtUsd2(reserva.montoReserva)} />}
        {reserva && <Fila t="Monto pagado" v={reserva.montoRecibido !== null ? fmtUsd2(reserva.montoRecibido) : reserva.comprobante ? 'Por verificar' : 'Sin pago'} />}
        {reserva?.comprobante && <Fila t="Referencia" v={reserva.comprobante} />}
      </dl>

      {calc.plan && firma && (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{firma.excedente > 0 ? `Reserva ${fmtUsd2(firma.base)}: cubre el ${calc.plan.reservaPct} %` : `Reserva ${fmtUsd2(firma.base)} + ${fmtUsd2(firma.restanteFirma)} a la firma`}</div>
          {firma.proyectado ? 'La reserva, cuando se pague, se acredita al ' : 'La reserva pagada se acredita al '}{calc.plan.reservaPct} %: no se cobra dos veces.
          {firma.excedente > 0 && ` El excedente de ${fmtUsd2(firma.excedente)} se aplica a la siguiente cuota.`}
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {!cotizacion && <Destacado activo={paso.accion === 'emitir' && erroresEmision.length === 0}><Button disabled={ocupado || erroresEmision.length > 0} onClick={() => void op.emitirYDescargar()}><FileText />{ocupado ? 'Emitiendo…' : 'Emitir cotización y descargar PDF'}</Button></Destacado>}
        {!cotizacion && op.cliente && op.unit && erroresEmision.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{erroresEmision.filter((e) => e !== bloqueoCalculo).map((e) => <li key={e}>{e}</li>)}</ul>}
        {cotizacion && !reserva && can('reservas.solicitar') && (
          <>
            <Destacado activo={paso.accion === 'solicitar' && !errorMonto && !bloqueoCalculo}><Button disabled={ocupado || paso.accion !== 'solicitar' || !!errorMonto || !!bloqueoCalculo} onClick={() => void op.solicitar()}><CheckCircle2 />{ocupado ? 'Solicitando…' : 'Solicitar reserva'}</Button></Destacado>
            {paso.accion === 'solicitar' && errorMonto && <p className="text-xs text-rose-700">Para solicitar la reserva, corrige el monto acordado en «Condiciones del plan»: {errorMonto}</p>}
            {paso.accion === 'solicitar' && <p className="text-xs text-muted-foreground">Registra que el cliente aceptó esta cotización. No registra un pago: la unidad se reserva cuando Finanzas verifica el ingreso.</p>}
          </>
        )}
        {reserva?.estado === 'solicitada' && !reserva.comprobante && can('reservas.solicitar') && <Destacado activo={paso.accion === 'registrar_pago'}><Button variant="outline" disabled={ocupado} onClick={() => setPagoAbierto(true)}><FileCheck2 />{op.rechazoPago ? 'Registrar un comprobante nuevo' : 'Registrar pago'}</Button></Destacado>}
        {reserva?.estado === 'solicitada' && can('reservas.solicitar') && (
          montoNuevo === null
            ? <Button size="sm" variant="ghost" onClick={() => setMontoNuevo(String(reserva.montoReserva))}><Pencil />Cambiar monto acordado</Button>
            : (
              <div className="flex items-end gap-2">
                <div className="grid flex-1 gap-1"><Label htmlFor="ve-monto-nuevo" className="text-xs">Nuevo monto acordado</Label><Input id="ve-monto-nuevo" inputMode="decimal" className="h-8" value={montoNuevo} onChange={(e) => setMontoNuevo(e.target.value)} /></div>
                <Button size="sm" disabled={ocupado || !!errorMontoReserva(leerMonto(montoNuevo), calc.plan?.reserva ?? 0)} onClick={() => void op.guardarMonto()}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setMontoNuevo(null)}>Cancelar</Button>
              </div>
            )
        )}
        {reserva?.estado === 'solicitada' && reserva.comprobante && op.datos && <Button variant="outline" onClick={() => void descargarConstanciaReserva(op.datos!, reserva.id).catch((e: Error) => op.setError(e.message))}><Download />Descargar constancia provisional</Button>}
        {recibo && <Button variant="outline" onClick={() => void descargarRecibo(almacen, recibo, null, op.datos).catch((e: Error) => op.setError(e.message))}><Download />Descargar recibo {recibo.numero}</Button>}
        {cotizacion && !reserva && can('cotizaciones.crear') && <Destacado activo={paso.accion === 'reemitir' || paso.accion === 'anulada'}><Button variant={paso.accion === 'reemitir' || paso.accion === 'anulada' ? 'default' : 'ghost'} size="sm" onClick={() => op.cambiarCondiciones()}><RotateCcw />Cambiar condiciones y emitir nueva versión</Button></Destacado>}
      </div>
      {cotizacion && <DocumentosVenta cotizacion={cotizacion} datos={op.datos} onError={op.setError} className="mt-4"/>}
      <div className="mt-3 empty:hidden"><FieldError>{error ?? errorCarga}</FieldError></div>
      {aviso && <p role="status" className="mt-3 flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />{aviso}</p>}

      <RegistrarPagoDialog reserva={pagoAbierto ? reserva : null} onClose={() => setPagoAbierto(false)}
        onConfirm={(pago) => { setPagoAbierto(false); void op.registrarPago(pago) }} />
    </section>
  )
}

function Fila({ t, v }: { t: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t}</dt><dd className="text-right font-medium tabular-nums">{v}</dd></div>
}
