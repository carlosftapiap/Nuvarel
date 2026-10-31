import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Circle, Download, FileCheck2, FileText, Pencil, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { descargarRecibo } from '@/features/cobranza/comprobantes'
import { descargarCotizacionPdf } from '@/features/cotizaciones/pdf'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { errorMontoReserva } from './operacion'
import RegistrarPagoDialog from '@/features/reservas/components/RegistrarPagoDialog'
import { ESTADO_RESERVA } from '@/features/reservas/model'
import { cn } from '@/lib/utils'
import type { Operacion } from './useOperacion'

const NOMBRES_PASOS = ['Cotización', 'Solicitud', 'Pago registrado', 'Pago verificado', 'Aprobada', 'Documentos']

/** Estado de la operación y próximos pasos. Cada acción la ejecuta el módulo responsable; aquí solo se dispara. */
export default function OperacionPanel({ op }: { op: Operacion }) {
  const { cotizacion, reserva, contrato, recibo, paso, can, calc, firma, ocupado, erroresEmision, bloqueoCalculo, montoNuevo, setMontoNuevo, error, aviso, errorCarga, almacen, pagoAbierto, setPagoAbierto } = op
  const pasosHechos = [
    !!cotizacion, !!reserva, !!reserva?.comprobante,
    reserva?.estado === 'pago_verificado' || reserva?.estado === 'confirmada',
    reserva?.estado === 'confirmada', !!contrato,
  ]
  const errorMonto = calc.plan ? errorMontoReserva(calc.reserva, calc.plan.reserva) : null

  return (
    <section aria-labelledby="ve-op" className="dashboard-card p-5">
      <h2 id="ve-op" className="text-sm font-semibold">Operación</h2>
      <ol className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1.5 text-[11px]" aria-label="Estado de la operación">
        {NOMBRES_PASOS.map((n, i) => (
          <li key={n} className={cn('flex items-center gap-1', pasosHechos[i] ? 'font-medium text-emerald-700' : 'text-muted-foreground')}>
            {pasosHechos[i] ? <CheckCircle2 className="size-3 shrink-0" /> : <Circle className="size-3 shrink-0" />}{n}
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-lg border border-primary/30 bg-secondary px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ArrowRight className="size-3" />Siguiente paso · {paso.responsable}</div>
        <div className="mt-0.5 text-sm font-semibold">{paso.titulo}</div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{paso.detalle}</p>
      </div>

      <dl className="mt-3 grid gap-1.5 text-xs">
        {cotizacion && <Fila t="Cotización" v={`${cotizacion.numero} · vence ${fmtFechaCorta(cotizacion.validaHasta)}`} />}
        {cotizacion && <Fila t="Plan" v={cotizacion.plan ? `${fmtUsd2(cotizacion.plan.precioFinal)} · ${cotizacion.plan.meses} meses` : '—'} />}
        {reserva && <Fila t="Reserva" v={`${reserva.codigo} · ${ESTADO_RESERVA[reserva.estado].label}`} />}
        {reserva && <Fila t="Monto acordado" v={fmtUsd2(reserva.montoReserva)} />}
        {reserva && <Fila t="Monto pagado" v={reserva.montoRecibido !== null ? fmtUsd2(reserva.montoRecibido) : reserva.comprobante ? 'Por verificar' : 'Sin pago'} />}
        {reserva?.comprobante && <Fila t="Referencia" v={reserva.comprobante} />}
      </dl>

      {calc.plan && firma && (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground">{firma.excedente > 0 ? `Reserva ${fmtUsd2(firma.base)}: cubre el ${calc.plan.reservaPct} %` : `Reserva ${fmtUsd2(firma.base)} + ${fmtUsd2(firma.restanteFirma)} a la firma`}</div>
          {firma.proyectado ? 'La reserva, cuando se pague, se acredita al ' : 'La reserva pagada se acredita al '}{calc.plan.reservaPct} %: no se cobra dos veces.
          {firma.excedente > 0 && ` El excedente de ${fmtUsd2(firma.excedente)} se aplica a la siguiente cuota.`}
        </div>
      )}

      <div className="mt-4 grid gap-2">
        {!cotizacion && <Button disabled={ocupado || erroresEmision.length > 0} onClick={() => void op.emitirYDescargar()}><FileText />{ocupado ? 'Emitiendo…' : 'Emitir cotización y descargar PDF'}</Button>}
        {!cotizacion && op.cliente && op.unit && erroresEmision.length > 0 && <ul className="list-disc pl-4 text-[11px] text-muted-foreground">{erroresEmision.filter((e) => e !== bloqueoCalculo).map((e) => <li key={e}>{e}</li>)}</ul>}
        {cotizacion && !reserva && can('reservas.solicitar') && (
          <>
            <Button disabled={ocupado || paso.accion !== 'solicitar' || !!errorMonto || !!bloqueoCalculo} onClick={() => void op.solicitar()}><CheckCircle2 />{ocupado ? 'Solicitando…' : 'Solicitar reserva'}</Button>
            {paso.accion === 'solicitar' && <p className="text-[11px] text-muted-foreground">Registra que el cliente aceptó esta cotización. No aprueba la reserva, no bloquea la unidad y no registra un pago.</p>}
          </>
        )}
        {reserva?.estado === 'solicitada' && !reserva.comprobante && can('reservas.solicitar') && <Button variant="outline" disabled={ocupado} onClick={() => setPagoAbierto(true)}><FileCheck2 />Registrar pago</Button>}
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
        {cotizacion && <Button variant="outline" onClick={() => void descargarCotizacionPdf(cotizacion)}><Download />Descargar PDF</Button>}
        {recibo && <Button variant="outline" onClick={() => void descargarRecibo(almacen, recibo).catch((e: Error) => op.setError(e.message))}><Download />Descargar recibo {recibo.numero}</Button>}
        {cotizacion && !reserva && can('cotizaciones.crear') && <Button variant="ghost" size="sm" onClick={() => op.cambiarCondiciones()}><RotateCcw />Cambiar condiciones y emitir nueva versión</Button>}
        {(paso.accion === 'verificar' && can('reservas.verificar_pago')) || (paso.accion === 'aprobar' && can('reservas.confirmar')) ? <Button asChild variant="outline"><Link to="/reservas">Ir a Reservas</Link></Button> : null}
        {(paso.accion === 'contrato' || paso.accion === 'firma') && can('ventas.preparar') && <Button asChild variant="outline"><Link to="/ventas">Ir a Ventas y contratos</Link></Button>}
      </div>
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
