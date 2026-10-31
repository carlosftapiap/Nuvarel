import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Clock, FileCheck2, Lock, ShieldCheck, XCircle } from 'lucide-react'
import DatosLocalesAviso from '@/components/DatosLocalesAviso'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd, fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { ESTADO_RESERVA, type EstadoReserva, type Reserva } from '@/features/reservas/model'
import { reservasVisibles } from '@/features/reservas/service'
import { useReservaFlujo } from '@/features/reservas/flujo'
import RegistrarPagoDialog from '@/features/reservas/components/RegistrarPagoDialog'
import DesistimientoDialog from '@/features/clientes/components/DesistimientoDialog'
import ReglasAnulacion from '@/features/clientes/components/ReglasAnulacion'
import SolicitudesAnulacion from '@/features/clientes/components/SolicitudesAnulacion'
import { useClientes } from '@/features/clientes/store'
import { cn } from '@/lib/utils'

type Filtro = 'todas' | EstadoReserva

export default function ReservasPage() {
  const flujo = useReservaFlujo()
  const { actor, can } = useSession()
  const { state: inv } = useInventory()
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<Reserva | null>(null)
  const [anular, setAnular] = useState<Reserva | null>(null)
  const [aprobar, setAprobar] = useState<Reserva | null>(null)
  const [comprobante, setComprobante] = useState<Reserva | null>(null)
  const [rechazo, setRechazo] = useState<Reserva | null>(null)
  const [desiste, setDesiste] = useState<Reserva | null>(null)
  const { desistimientos, hayDesistimientos } = useClientes()
  const pendiente = (r: Reserva) => desistimientos.some((d) => d.reservaId === r.id && d.estado === 'pendiente')
  // Anular directo solo vale para una solicitud sin pago ni comprobante; el servidor lo vuelve a comprobar.
  const anulableDirecto = (r: Reserva) => r.estado === 'solicitada' && !r.comprobante && r.montoRecibido === null

  const visibles = useMemo(() => reservasVisibles(flujo.res.reservas, actor), [flujo.res.reservas, actor])
  // Desde Cobranzas se abre una reserva con ?codigo=.
  const [params, setParams] = useSearchParams()
  const codigo = params.get('codigo')
  const lista = visibles.filter((r) => (codigo ? r.codigo === codigo : filtro === 'todas' || r.estado === filtro))
  const confirmadas = visibles.filter((r) => r.estado === 'confirmada')
  const solicitadas = visibles.filter((r) => r.estado === 'solicitada')
  const porAprobar = visibles.filter((r) => r.estado === 'pago_verificado')
  const totalReservado = confirmadas.reduce((t, r) => t + r.montoRecibido!, 0)
  const bloqueadas = inv.units.filter((u) => u.estado === 'reservado').length

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null)
    try { await fn(); setAviso(ok) } catch (e) { setError((e as Error).message) }
  }

  return (
    <>
      <PageHeader eyebrow="Seguimiento · Reservas" title="Reservas"
        subtitle="Una solicitud no bloquea la unidad. Finanzas verifica el ingreso y, cuando Gerencia aprueba, el departamento queda reservado." />
      <DatosLocalesAviso solo="amura.reservas.v1" />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi t="Solicitudes por verificar" v={solicitadas.length} d="Esperan comprobante de pago" tone={solicitadas.length ? 'text-amber-700' : undefined} />
        <Kpi t="Pagos verificados" v={porAprobar.length} d="Esperan aprobación de gerencia" tone={porAprobar.length ? 'text-sky-700' : undefined} />
        <Kpi t="Reservas confirmadas" v={confirmadas.length} d="Unidades bloqueadas" />
        <Kpi t="Recibido en reservas" v={fmtUsd(totalReservado)} d="Suma de comprobantes verificados" />
        <Kpi t="Unidades reservadas" v={bloqueadas} d="Según el inventario" />
      </div>

      {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      <div className="mb-3"><FieldError>{error}</FieldError></div>

      {flujo.remoto && hayDesistimientos && (
        <>
          <SolicitudesAnulacion onDone={async (m) => { await flujo.recargar(); setAviso(m) }} />
          <details className="dashboard-card mb-4 p-4">
            <summary className="cursor-pointer text-xs font-semibold">¿Quién aprueba la anulación de una reserva y cómo funciona?</summary>
            <div className="mt-3"><ReglasAnulacion /></div>
          </details>
        </>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
        {(['todas', 'solicitada', 'pago_verificado', 'confirmada', 'anulada'] as Filtro[]).map((f) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
            className={cn('rounded-full border px-3 py-1 text-xs transition-colors', filtro === f ? 'border-primary bg-secondary text-secondary-foreground' : 'border-border hover:bg-muted')}>
            {f === 'todas' ? 'Todas' : ESTADO_RESERVA[f].label}
          </button>
        ))}
      </div>

      {codigo && <p className="mb-3 flex items-center gap-2 text-xs">Mostrando {codigo}. <button type="button" className="text-primary hover:underline" onClick={() => setParams({}, { replace: true })}>Ver todas</button></p>}

      {visibles.length === 0 ? (
        <div className="module-empty">
          <h2 className="text-lg font-semibold">Sin reservas todavía</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Atiende al cliente, emite la cotización y solicita la reserva desde una sola pantalla.</p>
          <Button asChild className="mt-6"><Link to="/venta">Atender cliente</Link></Button>
        </div>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-[11px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Reserva</th>
                <th className="px-2 py-2 text-left font-medium">Cliente</th>
                <th className="px-2 py-2 text-left font-medium">Unidad</th>
                <th className="px-2 py-2 text-right font-medium">Precio</th>
                <th className="px-2 py-2 text-right font-medium">Reserva</th>
                <th className="px-2 py-2 text-left font-medium">Vigencia</th>
                <th className="px-2 py-2 text-left font-medium">Estado</th>
                <th className="px-4 py-2 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((r) => {
                const u = inv.units.find((x) => x.codigo === r.unidad)
                const vencida = r.estado === 'solicitada' && r.vigenciaHasta < new Date().toISOString().slice(0, 10)
                return (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-4 py-2"><div className="font-semibold">{r.codigo}</div><div className="text-[11px] text-muted-foreground">{r.cotizacionNumero}</div></td>
                    <td className="px-2 py-2">{r.clienteNombre}</td>
                    <td className="px-2 py-2">{u?.dpt ?? r.unidad}<div className="text-[11px] text-muted-foreground">{u?.tipologia}</div></td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUsd(r.precioAcordado)}{r.descuentoPct > 0 && <div className="text-[11px] text-muted-foreground">−{r.descuentoPct}%</div>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(r.montoReserva)}<div className="text-[11px] text-muted-foreground">{r.montoRecibido !== null ? `pagado ${fmtUsd2(r.montoRecibido)}` : r.estado === 'solicitada' ? 'acordado · por verificar' : 'acordado'}</div></td>
                    <td className={cn('px-2 py-2', vencida && 'font-medium text-rose-700')}>{fmtFechaCorta(r.vigenciaHasta)}{vencida && <div className="text-[11px]">Cotización vencida</div>}</td>
                    <td className="px-2 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', ESTADO_RESERVA[r.estado].tone)}>{ESTADO_RESERVA[r.estado].label}</span></td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {flujo.remoto && r.estado === 'solicitada' && !r.comprobante && can('reservas.solicitar') && <Button size="sm" variant="outline" onClick={() => setComprobante(r)}><FileCheck2 />Registrar pago</Button>}
                        {flujo.remoto && r.estado === 'solicitada' && !r.comprobante && can('reservas.verificar_pago') && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="size-3" />Falta el comprobante</span>}
                        {r.estado === 'solicitada' && can('reservas.verificar_pago') && (!flujo.remoto || !!r.comprobante) && <Button size="sm" onClick={() => setConfirmar(r)}><CheckCircle2 />Verificar pago</Button>}
                        {flujo.remoto && r.estado === 'solicitada' && !!r.comprobante && can('reservas.verificar_pago') && <Button size="sm" variant="outline" onClick={() => setRechazo(r)}>Rechazar pago</Button>}
                        {r.estado === 'pago_verificado' && can('reservas.confirmar') && <Button size="sm" onClick={() => setAprobar(r)}><ShieldCheck />Aprobar</Button>}
                        {pendiente(r) && <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800"><Clock className="size-3" />Anulación por autorizar</span>}
                        {flujo.remoto && hayDesistimientos && r.estado !== 'anulada' && !pendiente(r) && can('ventas.desistimiento') && <Button size="sm" variant="outline" className="text-rose-700" onClick={() => setDesiste(r)}>Desistimiento</Button>}
                        {r.estado !== 'anulada' && can('reservas.anular') && (!flujo.remoto || anulableDirecto(r)) && !pendiente(r) && <Button size="sm" variant="outline" onClick={() => setAnular(r)}><XCircle />Anular</Button>}
                        {r.estado === 'solicitada' && !can('reservas.verificar_pago') && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock className="size-3" />Pendiente de verificación</span>}
                        {r.estado === 'confirmada' && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Lock className="size-3" />Unidad bloqueada</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmarDialog reserva={confirmar} onClose={() => setConfirmar(null)}
        onConfirm={(input) => { void run(() => flujo.verificarPago(confirmar!.id, input), `Ingreso de ${confirmar!.codigo} verificado · pendiente de aprobación de gerencia`); setConfirmar(null) }} />
      {desiste && (
        <DesistimientoDialog clienteId={desiste.clienteId} oportunidadId={desiste.oportunidadId ?? undefined} onClose={() => setDesiste(null)}
          onDone={async (m) => { await flujo.recargar(); setAviso(m) }} />
      )}
      <RegistrarPagoDialog reserva={comprobante} onClose={() => setComprobante(null)}
        onConfirm={(pago) => { void run(() => flujo.registrarPago(comprobante!, pago), `Pago de ${comprobante!.codigo} registrado · pendiente de verificación de Finanzas`); setComprobante(null) }} />
      <RechazarPagoDialog reserva={rechazo} onClose={() => setRechazo(null)}
        onConfirm={(motivo) => { void run(() => flujo.rechazarPago(rechazo!.id, motivo), `Pago de ${rechazo!.codigo} rechazado · la reserva vuelve a esperar el pago`); setRechazo(null) }} />
      <AprobarDialog reserva={aprobar} onClose={() => setAprobar(null)}
        onConfirm={(motivo) => { void run(() => flujo.aprobar(aprobar!.id, motivo), `Reserva ${aprobar!.codigo} aprobada · unidad bloqueada`); setAprobar(null) }} />
      <AnularDialog reserva={anular} onClose={() => setAnular(null)}
        onConfirm={(motivo) => { void run(() => flujo.anular(anular!.id, motivo), `Reserva ${anular!.codigo} anulada`); setAnular(null) }} />
    </>
  )
}

function ConfirmarDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (i: { comprobante: string; montoRecibido: number; verificadoBanco: boolean }) => void }) {
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

function RechazarPagoDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
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

function AprobarDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  if (!reserva) return null
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setMotivo(''); onClose() } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aprobar la reserva {reserva.codigo}</DialogTitle>
          <DialogDescription>Al aprobar, la unidad queda reservada y {reserva.clienteNombre} pasa a Reserva. Finanzas ya verificó el ingreso de {fmtUsd2(reserva.montoRecibido ?? 0)}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="ap-motivo" className="text-xs">Motivo de la aprobación *</Label>
          <Textarea id="ap-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button disabled={motivo.trim().length < 5} onClick={() => { onConfirm(motivo); setMotivo('') }}>Aprobar reserva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnularDialog({ reserva, onClose, onConfirm }: { reserva: Reserva | null; onClose: () => void; onConfirm: (motivo: string) => void }) {
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

function Kpi({ t, v, d, tone }: { t: string; v: number | string; d: string; tone?: string }) {
  return (
    <div className="dashboard-card !p-4">
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-xl font-semibold tabular-nums tracking-tight', tone)}>{v}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{d}</div>
    </div>
  )
}
