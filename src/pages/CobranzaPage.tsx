import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CloudOff, Loader2, Lock, RefreshCw, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import * as api from '@/features/cobranza/api'
import { calcularTablero, SITUACION, TRAMOS_MORA, type ResumenContrato } from '@/features/cobranza/tablero'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'

const ESTADO_PAGO: Record<string, { label: string; tono: string }> = {
  registrado: { label: 'Por verificar', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  verificado: { label: 'Confirmado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazado: { label: 'Rechazado', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
  anulado: { label: 'Anulado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
const ESTADO_ALERTA: Record<string, string> = { pendiente: 'Pendiente de envío', enviada: 'Enviada', fallida: 'Fallida', cancelada: 'Cancelada' }

function Pastilla({ texto, tono }: { texto: string; tono: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap', tono)}>{texto}</span>
}

export default function CobranzaPage() {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  if (!remoto || !datos) {
    return (
      <div className="module-empty">
        <span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span>
        <h2 className="text-xl font-semibold tracking-tight">Cobranza requiere Supabase</h2>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">Los pagos y saldos son datos compartidos y auditados: no se guardan en el navegador. Inicia sesión con Supabase configurado.</p>
      </div>
    )
  }
  if (!can('cobranzas.ver')) {
    return (
      <div className="module-empty">
        <span className="module-empty-icon"><Lock className="size-7" aria-hidden="true" /></span>
        <h2 className="text-xl font-semibold tracking-tight">Sin acceso a Cobranzas</h2>
      </div>
    )
  }
  return <Cobranza datos={datos} />
}

function Cobranza({ datos }: { datos: Datos }) {
  const [d, setD] = useState<api.DatosCobranza | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Desde Ventas se puede abrir un contrato con ?contrato=<id>.
  const [seleccion, setSeleccion] = useState<string | null>(() => new URLSearchParams(window.location.search).get('contrato'))
  const [edificio, setEdificio] = useState('todos')
  const [responsable, setResponsable] = useState('todos')
  const hoy = hoyGuayaquil()

  const cargar = useCallback(async () => {
    // La recarga no borra el mensaje de la última acción: el usuario debe ver por qué no se guardó.
    try { setD(await api.cargarCobranza(datos)) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setError(null); setAviso(null)
    try { await fn(); setAviso(ok); await cargar(); return true } catch (e) { setError((e as Error).message); await cargar(); return false }
  }, [cargar])

  const tablero = useMemo(() => (d ? calcularTablero(d.contratos, d.cuotas, d.pagos, hoy) : null), [d, hoy])
  if (!d || !tablero) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando cobranza…</p>

  const responsables = [...new Set(tablero.contratos.map((r) => r.contrato.responsable))].sort()
  const cartera = tablero.contratos.filter((r) => (edificio === 'todos' || String(r.contrato.edificio) === edificio) && (responsable === 'todos' || r.contrato.responsable === responsable))
  const elegido = tablero.contratos.find((r) => r.contrato.id === seleccion) ?? null

  return (
    <>
      <PageHeader eyebrow="Finanzas · Cobranzas" title="Cobranza de la entrada (20%)"
        subtitle={`Cuentas por cobrar de Nuvarel. Fecha de corte ${fmtFechaCorta(hoy)} (hora de Ecuador). El crédito hipotecario del comprador no es cartera de Nuvarel.`}
        actions={<Button variant="outline" size="sm" onClick={() => { setError(null); setAviso(null); void cargar() }}><RefreshCw />Actualizar</Button>} />
      {aviso && !elegido && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      {!elegido && <div className="mb-3"><FieldError>{error}</FieldError></div>}

      <Tabs defaultValue="tablero" className="min-w-0">
        <TabsList className="mb-3">
          <TabsTrigger value="tablero">Tablero</TabsTrigger>
          <TabsTrigger value="cartera">Cartera ({tablero.contratos.length})</TabsTrigger>
          <TabsTrigger value="alertas">Alertas ({d.alertas.filter((a) => a.estado === 'pendiente').length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tablero" className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <Kpi t="Total pactado (20%)" v={fmtUsd2(tablero.pactado)} d="Contratos firmados" />
            <Kpi t="Cobrado confirmado" v={fmtUsd2(tablero.cobrado)} d="Solo pagos verificados" />
            <Kpi t="Saldo por cobrar" v={fmtUsd2(tablero.saldo)} d="Incluye lo vencido y por vencer" destacado />
          </div>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Kpi t="Vencido" v={fmtUsd2(tablero.vencido)} d="Parte del saldo por cobrar" tone={tablero.vencido ? 'text-rose-700' : undefined} />
            <Kpi t="Vence hoy" v={fmtUsd2(tablero.venceHoy)} d="Parte del saldo por cobrar" />
            <Kpi t="Por vencer (7 días)" v={fmtUsd2(tablero.porVencer)} d="Parte del saldo por cobrar" />
            <Kpi t="Comprobantes por verificar" v={String(tablero.comprobantesPendientes)} d="No cuentan como cobrado" tone={tablero.comprobantesPendientes ? 'text-amber-700' : undefined} />
          </div>
          <section className="dashboard-card !p-0 overflow-x-auto">
            <h2 className="px-4 pt-4 text-sm font-semibold">Antigüedad de la mora</h2>
            <table className="mt-3 w-full text-xs">
              <thead className="bg-muted text-[11px] text-muted-foreground"><tr>{TRAMOS_MORA.map((t) => <th key={t.id} className="px-4 py-2 text-right font-medium">{t.label}</th>)}</tr></thead>
              <tbody><tr>{TRAMOS_MORA.map((t) => <td key={t.id} className="px-4 py-2 text-right tabular-nums">{fmtUsd2(tablero.mora[t.id])}</td>)}</tr></tbody>
            </table>
            <p className="px-4 py-2 text-[11px] text-muted-foreground">Los tramos dividen el saldo vencido; su suma es el vencido, no una deuda adicional.</p>
          </section>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="dashboard-card !p-4 text-xs">
              <div className="text-[11px] text-muted-foreground">Desembolso bancario esperado (80%)</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fmtUsd2(tablero.desembolsoEsperado)}</div>
              <p className="mt-1 text-muted-foreground">Saldo contra entrega que normalmente paga el banco del comprador. No es cartera de Nuvarel ni genera alertas de cobro.</p>
            </div>
            <div className="dashboard-card !p-4 text-xs">
              <div className="text-[11px] text-muted-foreground">Reservas recibidas antes de la firma</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fmtUsd2(tablero.reservasPreFirma)}</div>
              <p className="mt-1 text-muted-foreground">{tablero.contratosPreFirma} contrato(s) en borrador. Su cronograma se vuelve exigible al firmar.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="cartera" className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Edificio" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={edificio} onChange={(e) => setEdificio(e.target.value)}>
              <option value="todos">Todos los edificios</option><option value="1">Edificio 1</option><option value="2">Edificio 2</option>
            </select>
            <select aria-label="Responsable" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="todos">Todos los responsables</option>{responsables.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          {cartera.length === 0 ? <div className="module-empty"><p className="text-sm text-muted-foreground">No hay contratos en tu alcance.</p></div> : (
            <div className="dashboard-card !p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-[11px] text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Unidad</th><th className="px-2 py-2 text-left font-medium">Responsable</th><th className="px-2 py-2 text-left font-medium">Contrato</th><th className="px-2 py-2 text-right font-medium">Saldo entrada</th><th className="px-2 py-2 text-right font-medium">Vencido</th><th className="px-2 py-2 text-left font-medium">Próxima cuota</th><th className="px-4 py-2 text-right font-medium">Atraso</th></tr>
                </thead>
                <tbody>
                  {cartera.map((r) => (
                    <tr key={r.contrato.id} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setSeleccion(r.contrato.id)}>
                      <td className="px-4 py-2 font-medium">{r.contrato.cliente}</td>
                      <td className="px-2 py-2">{r.contrato.unidad}</td>
                      <td className="px-2 py-2">{r.contrato.responsable}</td>
                      <td className="px-2 py-2">{r.contrato.codigo} · {r.contrato.estado === 'firmado' ? 'Firmado' : 'Borrador (no exigible)'}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(r.saldoEntrada)}</td>
                      <td className={cn('px-2 py-2 text-right tabular-nums', r.vencido > 0 && 'font-medium text-rose-700')}>{fmtUsd2(r.vencido)}</td>
                      <td className="px-2 py-2">{r.proxima ? `${r.proxima.concepto} · ${fmtFechaCorta(r.proxima.vencimiento)}` : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.diasAtraso ? `${r.diasAtraso} d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="alertas">
          <Alertas alertas={d.alertas} />
        </TabsContent>
      </Tabs>

      {elegido && <Detalle r={elegido} d={d} datos={datos} ejecutar={ejecutar} error={error} aviso={aviso} onClose={() => setSeleccion(null)} />}
    </>
  )
}

function Alertas({ alertas }: { alertas: api.Alerta[] }) {
  if (!alertas.length) return <div className="module-empty"><p className="text-sm text-muted-foreground">Sin alertas generadas. Las crea la tarea diaria del servidor (08:00, hora de Ecuador).</p></div>
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted text-[11px] text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Creada</th><th className="px-2 py-2 text-left font-medium">Asunto</th><th className="px-2 py-2 text-left font-medium">Destinatario</th><th className="px-4 py-2 text-left font-medium">Estado</th></tr></thead>
        <tbody>
          {alertas.map((a) => (
            <tr key={a.id} className="border-t border-border align-top">
              <td className="px-4 py-2 tabular-nums">{new Date(a.creadaEn).toLocaleString('es-EC')}</td>
              <td className="px-2 py-2">{a.asunto}</td>
              <td className="px-2 py-2">{a.destinatario}</td>
              <td className="px-4 py-2">{ESTADO_ALERTA[a.estado] ?? a.estado}{a.error && <div className="text-[11px] text-muted-foreground">{a.error}</div>}{a.intentos > 0 && <div className="text-[11px] text-muted-foreground">{a.intentos} intento(s)</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------- detalle del contrato */

type Ejecutar = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>
type Pedir = { titulo: string; boton: string; destructivo?: boolean; accion: (motivo: string) => Promise<unknown>; ok: string }

function Detalle({ r, d, datos, ejecutar, error, aviso, onClose }: { r: ResumenContrato; d: api.DatosCobranza; datos: Datos; ejecutar: Ejecutar; error: string | null; aviso: string | null; onClose: () => void }) {
  const { can, actor } = useSession()
  const c = r.contrato
  const pagos = d.pagos.filter((p) => p.contratoId === c.id)
  const gestiones = d.gestiones.filter((g) => g.contratoId === c.id)
  const compromisos = d.compromisos.filter((k) => k.contratoId === c.id)
  const [pedir, setPedir] = useState<Pedir | null>(null)
  const [pago, setPago] = useState({ monto: '', fecha: hoyGuayaquil(), referencia: '', comprobante: '' })
  const [gestion, setGestion] = useState({ tipo: 'llamada', descripcion: '', numero: '' })
  const [comp, setComp] = useState({ monto: '', fecha: '', numero: '', motivo: '' })
  const [repro, setRepro] = useState({ numero: '', fecha: '', motivo: '' })
  const num = (s: string) => Number(s.replace(',', '.'))

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{c.cliente} · {c.unidad}</SheetTitle>
              <SheetDescription>{c.codigo} · {c.estado === 'firmado' ? 'Firmado: cronograma exigible' : 'Borrador: aún no exigible'} · Responsable {c.responsable}</SheetDescription>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
        </SheetHeader>
        <div className="grid gap-5 px-5 py-4">
          {aviso && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
          <FieldError>{error}</FieldError>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi t="Saldo de entrada" v={fmtUsd2(r.saldoEntrada)} d={`Pactado ${fmtUsd2(r.pactadoEntrada)}`} />
            <Kpi t="Cobrado confirmado" v={fmtUsd2(r.cobradoEntrada)} d="Pagos verificados" />
            <Kpi t="Vencido" v={fmtUsd2(r.vencido)} d={r.diasAtraso ? `${r.diasAtraso} días de atraso` : 'Sin atraso'} tone={r.vencido ? 'text-rose-700' : undefined} />
            <Kpi t="Saldo a favor" v={fmtUsd2(r.saldoAFavor)} d="Excedente pendiente de aplicación" />
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold">Cuotas de la entrada</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-[11px] text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium">Cuota</th><th className="px-2 py-1.5 text-left font-medium">Vencimiento</th><th className="px-2 py-1.5 text-right font-medium">Monto</th><th className="px-2 py-1.5 text-right font-medium">Aplicado</th><th className="px-2 py-1.5 text-right font-medium">Saldo</th><th className="px-3 py-1.5 text-left font-medium">Estado</th></tr></thead>
                <tbody>
                  {r.cuotas.filter((q) => q.esEntrada).map((q) => (
                    <tr key={q.numero} className="border-t border-border">
                      <td className="px-3 py-1.5">{q.concepto} <span className="text-muted-foreground">(nº {q.numero})</span></td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtFechaCorta(q.vencimiento)}{q.vencimientoOriginal && <div className="text-[10px] text-muted-foreground">Original {fmtFechaCorta(q.vencimientoOriginal)}</div>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.monto)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.pagado)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.saldo)}</td>
                      <td className="px-3 py-1.5">
                        <Pastilla texto={c.estado === 'firmado' ? SITUACION[q.situacion].label : q.situacion === 'pagada' ? 'Pagada' : 'No exigible'} tono={c.estado === 'firmado' ? SITUACION[q.situacion].tono : 'bg-slate-50 text-slate-600 ring-slate-200'} />
                        {q.parcial && <span className="ml-1"><Pastilla texto="Abono parcial" tono="bg-sky-50 text-sky-800 ring-sky-200" /></span>}
                        {q.situacion === 'vencida' && c.estado === 'firmado' && <span className="ml-1 text-[10px] text-rose-700">{q.atrasoDias} d</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Saldo contra entrega (80%, desembolso bancario esperado): {fmtUsd2(r.saldoEntrega)}. No es cartera de Nuvarel.</p>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold">Pagos</h3>
            {pagos.length === 0 ? <p className="text-xs text-muted-foreground">Sin pagos registrados.</p> : (
              <ul className="grid gap-1.5 text-xs">
                {pagos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="font-medium tabular-nums">{fmtUsd2(p.monto)}</span>
                    <span className="text-muted-foreground">{fmtFechaCorta(p.fecha)} · ref. {p.referencia}</span>
                    <Pastilla texto={ESTADO_PAGO[p.estado].label} tono={ESTADO_PAGO[p.estado].tono} />
                    {p.motivo && <span className="text-[11px] text-muted-foreground">{p.motivo}</span>}
                    <span className="ml-auto flex gap-1.5">
                      {p.estado === 'registrado' && can('cobranzas.verificar') && p.registradoPor !== actor.id && <>
                        <Button size="sm" onClick={() => setPedir({ titulo: `Confirmar el pago ${p.referencia}`, boton: 'Confirmar ingreso', ok: 'Pago confirmado', accion: (m) => api.verificarPago(datos, p.id, true, m) })}>Confirmar</Button>
                        <Button size="sm" variant="outline" onClick={() => setPedir({ titulo: `Rechazar el comprobante ${p.referencia}`, boton: 'Rechazar', destructivo: true, ok: 'Comprobante rechazado', accion: (m) => api.verificarPago(datos, p.id, false, m) })}>Rechazar</Button>
                      </>}
                      {p.estado === 'registrado' && p.registradoPor === actor.id && <span className="text-[11px] text-muted-foreground">Lo verifica otra persona</span>}
                      {(p.estado === 'registrado' || p.estado === 'verificado') && can('cobranzas.verificar') &&
                        <Button size="sm" variant="ghost" onClick={() => setPedir({ titulo: `Anular el pago ${p.referencia}`, boton: 'Anular pago', destructivo: true, ok: 'Pago anulado', accion: (m) => api.anularPago(datos, p.id, m) })}>Anular</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {can('cobranzas.registrar') && (
              <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-5">
                <div className="grid gap-1"><Label htmlFor="pg-monto" className="text-[11px]">Monto (USD)</Label><Input id="pg-monto" className="h-8" inputMode="decimal" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="pg-fecha" className="text-[11px]">Fecha</Label><Input id="pg-fecha" className="h-8" type="date" max={hoyGuayaquil()} value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="pg-ref" className="text-[11px]">Referencia</Label><Input id="pg-ref" className="h-8" value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></div>
                <div className="grid gap-1"><Label htmlFor="pg-comp" className="text-[11px]">Comprobante (enlace)</Label><Input id="pg-comp" className="h-8" value={pago.comprobante} onChange={(e) => setPago({ ...pago, comprobante: e.target.value })} /></div>
                <div className="flex items-end"><Button size="sm" className="w-full" disabled={!(num(pago.monto) > 0) || pago.referencia.trim().length < 3}
                  onClick={() => void ejecutar(() => api.registrarPago(datos, c.id, num(pago.monto), pago.fecha, pago.referencia.trim(), pago.comprobante.trim() || null), 'Pago registrado: queda por verificar')
                    .then((ok) => { if (ok) setPago({ monto: '', fecha: hoyGuayaquil(), referencia: '', comprobante: '' }) })}>Registrar pago</Button></div>
                <p className="text-[11px] text-muted-foreground sm:col-span-5">Un pago se aplica a las cuotas en orden y puede cubrir varias. No cuenta como cobrado hasta que otra persona lo confirme. El excedente queda como saldo a favor.</p>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold">Gestiones</h3>
              <ul className="grid gap-1.5 text-xs">
                {gestiones.map((g) => <li key={g.id} className="rounded-lg bg-muted/50 px-3 py-2"><b className="capitalize">{g.tipo}</b> · {new Date(g.fecha).toLocaleString('es-EC')} · {g.usuario}<div>{g.descripcion}</div></li>)}
                {!gestiones.length && <li className="text-muted-foreground">Sin gestiones.</li>}
              </ul>
              {can('cobranzas.registrar') && (
                <div className="mt-2 grid gap-2">
                  <div className="flex gap-2">
                    <select aria-label="Tipo de gestión" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={gestion.tipo} onChange={(e) => setGestion({ ...gestion, tipo: e.target.value })}>
                      {['llamada', 'mensaje', 'visita', 'correo', 'nota'].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Input aria-label="Cuota de la gestión" className="h-8 w-24" placeholder="Cuota nº" value={gestion.numero} onChange={(e) => setGestion({ ...gestion, numero: e.target.value })} />
                  </div>
                  <Textarea aria-label="Descripción de la gestión" rows={2} value={gestion.descripcion} onChange={(e) => setGestion({ ...gestion, descripcion: e.target.value })} />
                  <Button size="sm" variant="outline" disabled={gestion.descripcion.trim().length < 3}
                    onClick={() => void ejecutar(() => api.registrarGestion(datos, c.id, gestion.numero ? Number(gestion.numero) : null, gestion.tipo, gestion.descripcion.trim()), 'Gestión registrada')
                      .then((ok) => { if (ok) setGestion({ tipo: 'llamada', descripcion: '', numero: '' }) })}>Registrar gestión</Button>
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold">Compromisos de pago</h3>
              <ul className="grid gap-1.5 text-xs">
                {compromisos.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                    {fmtUsd2(k.monto)} para el {fmtFechaCorta(k.fecha)}{k.numero !== null && ` · cuota nº ${k.numero}`}
                    <Pastilla texto={k.estado} tono={k.estado === 'incumplido' ? 'bg-rose-50 text-rose-700 ring-rose-200' : k.estado === 'cumplido' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-700 ring-slate-200'} />
                    {k.estado === 'pendiente' && can('cobranzas.registrar') && (['cumplido', 'incumplido', 'cancelado'] as const).map((e) => (
                      <Button key={e} size="sm" variant="ghost" onClick={() => setPedir({ titulo: `Marcar compromiso como ${e}`, boton: 'Guardar', ok: `Compromiso ${e}`, accion: (m) => api.cerrarCompromiso(datos, k.id, e, m) })}>{e}</Button>
                    ))}
                  </li>
                ))}
                {!compromisos.length && <li className="text-muted-foreground">Sin compromisos.</li>}
              </ul>
              {can('cobranzas.registrar') && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Input aria-label="Monto del compromiso" className="h-8" placeholder="Monto" inputMode="decimal" value={comp.monto} onChange={(e) => setComp({ ...comp, monto: e.target.value })} />
                  <Input aria-label="Fecha del compromiso" className="h-8" type="date" value={comp.fecha} onChange={(e) => setComp({ ...comp, fecha: e.target.value })} />
                  <Input aria-label="Cuota del compromiso" className="h-8" placeholder="Cuota nº" value={comp.numero} onChange={(e) => setComp({ ...comp, numero: e.target.value })} />
                  <Input aria-label="Motivo del compromiso" className="col-span-2 h-8" placeholder="Motivo" value={comp.motivo} onChange={(e) => setComp({ ...comp, motivo: e.target.value })} />
                  <Button size="sm" variant="outline" disabled={!(num(comp.monto) > 0) || !comp.fecha || comp.motivo.trim().length < 5}
                    onClick={() => void ejecutar(() => api.registrarCompromiso(datos, c.id, comp.numero ? Number(comp.numero) : null, num(comp.monto), comp.fecha, comp.motivo.trim()), 'Compromiso registrado')
                      .then((ok) => { if (ok) setComp({ monto: '', fecha: '', numero: '', motivo: '' }) })}>Registrar</Button>
                </div>
              )}
            </div>
          </section>

          {can('cobranzas.verificar') && (
            <section>
              <h3 className="mb-2 text-xs font-semibold">Reprogramar una cuota</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input aria-label="Cuota a reprogramar" className="h-8" placeholder="Cuota nº" value={repro.numero} onChange={(e) => setRepro({ ...repro, numero: e.target.value })} />
                <Input aria-label="Nueva fecha" className="h-8" type="date" value={repro.fecha} onChange={(e) => setRepro({ ...repro, fecha: e.target.value })} />
                <Input aria-label="Motivo de la reprogramación" className="h-8" placeholder="Motivo" value={repro.motivo} onChange={(e) => setRepro({ ...repro, motivo: e.target.value })} />
                <Button size="sm" variant="outline" disabled={repro.numero === '' || !repro.fecha || repro.motivo.trim().length < 5}
                  onClick={() => void ejecutar(() => api.reprogramarCuota(datos, c.id, Number(repro.numero), repro.fecha, repro.motivo.trim()), 'Cuota reprogramada')
                    .then((ok) => { if (ok) setRepro({ numero: '', fecha: '', motivo: '' }) })}>Reprogramar</Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Conserva la fecha original y los pagos; queda en auditoría con tu usuario y motivo.</p>
            </section>
          )}
        </div>
        {pedir && <MotivoDialog p={pedir} onClose={() => setPedir(null)} onEnviar={(m) => ejecutar(() => pedir.accion(m), pedir.ok)} />}
      </SheetContent>
    </Sheet>
  )
}

function MotivoDialog({ p, onClose, onEnviar }: { p: Pedir; onClose: () => void; onEnviar: (motivo: string) => Promise<boolean> }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{p.titulo}</DialogTitle><DialogDescription>Queda registrado con tu usuario, la fecha y el motivo.</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="mot" className="text-xs">Motivo *</Label><Textarea id="mot" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant={p.destructivo ? 'destructive' : 'default'} disabled={motivo.trim().length < 5 || enviando}
            onClick={() => { setEnviando(true); void onEnviar(motivo.trim()).then(() => onClose()) }}>{enviando && <Loader2 className="animate-spin" />}{p.boton}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({ t, v, d, tone, destacado }: { t: string; v: string; d: string; tone?: string; destacado?: boolean }) {
  return (
    <div className={cn('dashboard-card !p-4', destacado && 'ring-1 ring-primary/30')}>
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums tracking-tight', tone, destacado && 'text-primary')}>{v}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{d}</div>
    </div>
  )
}
