import { useCallback, useMemo, useState } from 'react'
import { bloqueoVerificacion } from '@/features/reservas/model'
import { Link } from 'react-router-dom'
import { CheckCircle2, CloudOff, Download, FileCheck2, Loader2, Lock, Plus, RefreshCw, Search, X } from 'lucide-react'
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
import type { Recibo } from '@/features/cobranza/comprobantes'
import { ESTADO_FILA, filaReserva, indicadoresReservas, type FilaReserva } from '@/features/cobranza/reservas'
import { useRefresco } from '@/features/conexion/refresco'
import MovimientosReserva from '@/features/cobranza/components/MovimientosReserva'
import ExcedenteEntrega from '@/features/cobranza/components/ExcedenteEntrega'
import RegistrarPagoCuota from '@/features/cobranza/components/RegistrarPagoCuota'
import RevisionPago, { type PagoEnRevision } from '@/features/cobranza/components/RevisionPago'
import { almacenPagos, descargarRecibo, reportarPagoContrato, reportarPagoReserva, type DatosPago } from '@/features/cobranza/comprobantes'
import RegistrarPagoDialog from '@/features/reservas/components/RegistrarPagoDialog'
import type { Reserva } from '@/features/reservas/model'
import { descargarEstadoCuenta } from '@/features/cobranza/estadoCuenta'
import { calcularTablero, esProxima, filasCuotas, SITUACION, TRAMOS_MORA, type FiltroCuotas, type ResumenContrato } from '@/features/cobranza/tablero'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'
import { numeroAnterior, numeroComercial } from '@/features/inventario/nomenclatura'

const ESTADO_PAGO: Record<string, { label: string; tono: string }> = {
  registrado: { label: 'Por verificar', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  verificado: { label: 'Confirmado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rechazado: { label: 'Rechazado', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
  anulado: { label: 'Anulado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
const ESTADO_ALERTA: Record<string, string> = { pendiente: 'Pendiente de envío', enviada: 'Enviada', fallida: 'Fallida', cancelada: 'Cancelada' }

function Pastilla({ texto, tono }: { texto: string; tono: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tono)}>{texto}</span>
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
  const [filtro, setFiltro] = useState<FiltroCuotas>('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const [verTodas, setVerTodas] = useState(false)
  const [registrar, setRegistrar] = useState<{ contrato: string | null } | null>(null)
  const [revisar, setRevisar] = useState<string | null>(null)
  const { can, actor } = useSession()
  const conexion = useConexion()
  const hoy = hoyGuayaquil()

  const cargar = useCallback(async () => {
    // La recarga no borra el mensaje de la última acción: el usuario debe ver por qué no se guardó.
    try { setD(await api.cargarCobranza(datos)) } catch (e) { setError((e as Error).message) }
  }, [datos])
  // Al volver a la pestaña y cada minuto también se releen: otra persona pudo registrar o confirmar un pago.
  useRefresco(cargar)

  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setError(null); setAviso(null)
    try { await fn(); setAviso(ok); await cargar(); return true } catch (e) { setError((e as Error).message); await cargar(); return false }
  }, [cargar])

  const tablero = useMemo(() => (d ? calcularTablero(d.contratos, d.cuotas, d.pagos, hoy, d.aplicaciones) : null), [d, hoy])
  const filasReservas = useMemo(() => (d?.reservas ?? []).map((r) => filaReserva(r, d!.reservasConContrato, hoy)), [d, hoy])
  const indicadores = useMemo(() => (d ? indicadoresReservas(filasReservas, d.pagos, d.contratosVigentes, d.movimientos) : null), [d, filasReservas])
  if (!d || !tablero || !indicadores) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando cobranza…</p>

  const elegido = tablero.contratos.find((r) => r.contrato.id === seleccion) ?? null
  const departamento = (unidad: string) => d.departamentos.get(unidad) ?? numeroComercial(unidad)
  const firmados = tablero.contratos.filter((r) => r.contrato.estado === 'firmado')
  const entradas = firmados.flatMap((r) => r.cuotas.filter((q) => q.esEntrada))
  const vencidas = entradas.filter((q) => q.situacion === 'vencida').length
  const proximas = entradas.filter(esProxima).length
  const q = busqueda.trim().toLowerCase()
  const filas = filasCuotas(tablero.contratos, filtro).filter(({ r }) => !q || `${r.contrato.cliente} ${departamento(r.contrato.unidad)} ${numeroAnterior(r.contrato.unidad) ?? ''} ${r.contrato.unidad} ${r.contrato.responsable}`.toLowerCase().includes(q))
  const visibles = verTodas ? filas : filas.slice(0, 100)
  const porVerificar = d.pagos.filter((p) => p.estado === 'registrado' && d.contratosVigentes.has(p.contratoId))
  const nombreDe = (contratoId: string) => tablero.contratos.find((r) => r.contrato.id === contratoId)?.contrato
  const pagoRevisado = revisar ? d.pagos.find((p) => p.id === revisar) ?? null : null
  // El pago copiado de la reserva conserva el recibo que se emitió al confirmarla.
  const reciboDe = (p: { id: string; contratoId: string; referencia: string }) => d.recibos.find((v) => v.pagoId === p.id)
    ?? d.recibos.find((v) => v.reservaId !== null && v.reservaId === d.reservaDeContrato.get(p.contratoId) && v.referencia === p.referencia) ?? null
  const guardarPago = async (contratoId: string, pago: DatosPago) => {
    await reportarPagoContrato(datos, almacenPagos(conexion), contratoId, pago)
    setError(null); setAviso('Pago registrado: queda por verificar')
    await cargar()
  }
  const elegir = (f: FiltroCuotas) => { setFiltro(f); setVerTodas(false) }

  return (
    <>
      <PageHeader eyebrow="Finanzas · Cobranzas" title="Cobranzas"
        subtitle={`Entrada del 20 %. Fecha de corte ${fmtFechaCorta(hoy)}. Las reservas y el crédito bancario del 80 % se llevan aparte.`}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => { setError(null); setAviso(null); void cargar() }}><RefreshCw />Actualizar</Button>
          {can('cobranzas.registrar') && <Button size="sm" onClick={() => { setError(null); setAviso(null); setRegistrar({ contrato: null }) }}><Plus />Registrar pago</Button>}
        </>} />
      {aviso && !elegido && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      {!elegido && <div className="mb-3"><FieldError>{error}</FieldError></div>}
      {d.receptor !== undefined && d.receptor !== 'NUVAREL' && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">No se pueden confirmar pagos: el receptor configurado es {d.receptor ?? 'ninguno'} y el recibo se emite a nombre de NUVAREL. Debe resolverse en Configuración.</p>}
      {indicadores.vencidas > 0 && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{indicadores.vencidas === 1 ? 'Hay 1 reserva vencida' : `Hay ${indicadores.vencidas} reservas vencidas`} sin resolver. No se anulan automáticamente y siguen bloqueando su unidad.</p>}

      <Tabs defaultValue="cuotas" className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="cuotas">Cuotas</TabsTrigger>
          {d.reservas && <TabsTrigger value="reservas">Reservas ({filasReservas.filter((f) => f.estado !== 'anulada').length})</TabsTrigger>}
          <TabsTrigger value="alertas">Alertas ({d.alertas.filter((a) => a.estado === 'pendiente').length})</TabsTrigger>
          <TabsTrigger value="indicadores">Indicadores</TabsTrigger>
        </TabsList>

        <TabsContent value="cuotas" className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" role="group" aria-label="Resumen de cobranzas">
            <Kpi t="Total cobrado" v={fmtUsd2(tablero.cobrado)} d="Solo pagos confirmados" />
            <Kpi t="Saldo pendiente" v={fmtUsd2(tablero.saldo)} d="Incluye lo vencido y lo próximo" destacado onClick={() => elegir('pendientes')} activo={filtro === 'pendientes'} />
            <Kpi t="Valores vencidos" v={fmtUsd2(tablero.vencido)} d={vencidas === 1 ? '1 cuota vencida' : `${vencidas} cuotas vencidas`} tone={tablero.vencido ? 'text-rose-700' : undefined} onClick={() => elegir('vencidas')} activo={filtro === 'vencidas'} />
            <Kpi t="Próximos vencimientos" v={fmtUsd2(Math.round((tablero.venceHoy + tablero.porVencer) * 100) / 100)} d={`${proximas === 1 ? '1 cuota' : `${proximas} cuotas`} en los próximos 7 días`} tone={proximas ? 'text-amber-700' : undefined} onClick={() => elegir('proximas')} activo={filtro === 'proximas'} />
          </div>

          {porVerificar.length > 0 && (
            <section aria-labelledby="co-verificar" className="dashboard-card p-4">
              <h2 id="co-verificar" className="text-sm font-semibold">Pagos por verificar ({porVerificar.length})</h2>
              <p className="text-xs text-muted-foreground">Aún no cuentan como cobrados. Los confirma una persona distinta de quien los registró.</p>
              <ul className="mt-2 grid gap-1.5 text-xs">
                {porVerificar.map((p) => {
                  const k = nombreDe(p.contratoId)
                  const propio = p.registradoPor === actor.id
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <span className="min-w-0 flex-1"><b>{k?.cliente}</b> · Dpto. {k ? departamento(k.unidad) : ''} · {fmtUsd2(p.monto)} · {fmtFechaCorta(p.fecha)}</span>
                      {propio && <span className="text-xs text-muted-foreground">Lo verifica otra persona</span>}
                      {(can('cobranzas.verificar') || propio) && <Button size="xs" variant={propio ? 'outline' : 'default'} onClick={() => { setError(null); setAviso(null); setRevisar(p.id) }}>{propio ? 'Ver pago' : 'Revisar pago'}</Button>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-56 flex-1 sm:max-w-sm">
              <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Buscar cliente o departamento" className="h-8 pl-8" placeholder="Buscar cliente o departamento" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
            <select aria-label="Mostrar" className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={filtro} onChange={(e) => elegir(e.target.value as FiltroCuotas)}>
              <option value="pendientes">Pendientes</option><option value="vencidas">Vencidas</option><option value="proximas">Próximas a vencer</option><option value="pagadas">Pagadas</option><option value="todas">Todas</option>
            </select>
          </div>

          {filas.length === 0 ? <div className="module-empty"><p className="text-sm text-muted-foreground">{tablero.contratos.length ? 'No hay cuotas con este filtro.' : 'Todavía no hay contratos en tu alcance.'}</p></div> : (
            <div className="dashboard-card !p-0 overflow-x-auto">
              <table className="w-full min-w-[820px] text-xs">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Departamento</th><th className="px-2 py-2 text-left font-medium">Cuota</th><th className="px-2 py-2 text-left font-medium">Vencimiento</th><th className="px-2 py-2 text-right font-medium">Valor</th><th className="px-2 py-2 text-right font-medium">Pagado</th><th className="px-2 py-2 text-right font-medium">Saldo</th><th className="px-4 py-2 text-left font-medium">Estado</th></tr>
                </thead>
                <tbody>
                  {visibles.map(({ r, q: c }) => (
                    <tr key={`${r.contrato.id}-${c.numero}`} className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => { setError(null); setAviso(null); setSeleccion(r.contrato.id) }}>
                      <td className="px-4 py-2"><button type="button" className="font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setError(null); setAviso(null); setSeleccion(r.contrato.id) }}>{r.contrato.cliente}</button></td>
                      <td className="px-2 py-2">{departamento(r.contrato.unidad)}</td>
                      <td className="px-2 py-2">{c.concepto}</td>
                      <td className="px-2 py-2 tabular-nums">{fmtFechaCorta(c.vencimiento)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(c.monto)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(c.pagado)}</td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums">{fmtUsd2(c.saldo)}</td>
                      <td className="px-4 py-2">
                        <Pastilla texto={r.contrato.estado === 'firmado' ? SITUACION[c.situacion].label : c.situacion === 'pagada' ? 'Pagada' : 'No exigible'} tono={r.contrato.estado === 'firmado' ? SITUACION[c.situacion].tono : 'bg-slate-50 text-slate-600 ring-slate-200'} />
                        {c.parcial && <span className="ml-1"><Pastilla texto="Abono parcial" tono="bg-sky-50 text-sky-800 ring-sky-200" /></span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filas.length > visibles.length && <div className="border-t border-border p-2 text-center"><Button size="sm" variant="ghost" onClick={() => setVerTodas(true)}>Ver las {filas.length} cuotas</Button></div>}
            </div>
          )}
        </TabsContent>

        <TabsContent value="indicadores" className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Reservas y recaudación">
            {d.reservas && <Kpi t="Reservas pendientes de pago" v={String(indicadores.pendientes.cantidad)} d={`${fmtUsd2(indicadores.pendientes.acordado)} acordados · aún no es ingreso`} tone={indicadores.pendientes.cantidad ? 'text-amber-700' : undefined} />}
            <Kpi t="Pagos pendientes de verificación" v={String(indicadores.porVerificar.cantidad)} d={`${fmtUsd2(indicadores.porVerificar.monto)} reportados · Finanzas no los ha confirmado`} tone={indicadores.porVerificar.cantidad ? 'text-amber-700' : undefined} />
            <Kpi t="Total recaudado" v={fmtUsd2(indicadores.recaudado)} d={indicadores.devuelto || indicadores.retenido ? `Neto. Bruto ${fmtUsd2(indicadores.bruto)} · devuelto ${fmtUsd2(indicadores.devuelto)} · retenido ${fmtUsd2(indicadores.retenido)}` : 'Solo pagos confirmados por Finanzas'} destacado />
          </div>
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
              <thead className="bg-muted text-xs text-muted-foreground"><tr>{TRAMOS_MORA.map((t) => <th key={t.id} className="px-4 py-2 text-right font-medium">{t.label}</th>)}</tr></thead>
              <tbody><tr>{TRAMOS_MORA.map((t) => <td key={t.id} className="px-4 py-2 text-right tabular-nums">{fmtUsd2(tablero.mora[t.id])}</td>)}</tr></tbody>
            </table>
            <p className="px-4 py-2 text-xs text-muted-foreground">Los tramos dividen el saldo vencido; su suma es el vencido, no una deuda adicional.</p>
          </section>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="dashboard-card !p-4 text-xs">
              <div className="text-xs text-muted-foreground">Desembolso bancario esperado (80%)</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fmtUsd2(tablero.desembolsoEsperado)}</div>
              <p className="mt-1 text-muted-foreground">Saldo contra entrega que normalmente paga el banco del comprador. No es cartera de Nuvarel ni genera alertas de cobro.</p>
            </div>
            <div className="dashboard-card !p-4 text-xs">
              <div className="text-xs text-muted-foreground">Reservas recibidas antes de la firma</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{fmtUsd2(tablero.reservasPreFirma)}</div>
              <p className="mt-1 text-muted-foreground">{tablero.contratosPreFirma} contrato(s) en borrador. Su cronograma se vuelve exigible al firmar.</p>
            </div>
          </div>
        </TabsContent>

        {d.reservas && (
          <TabsContent value="reservas">
            <ReservasCobranza filas={filasReservas} d={d} datos={datos} ejecutar={ejecutar} />
          </TabsContent>
        )}

        <TabsContent value="alertas">
          <Alertas alertas={d.alertas} />
        </TabsContent>
      </Tabs>

      {elegido && <Detalle r={elegido} d={d} datos={datos} ejecutar={ejecutar} error={error} aviso={aviso} departamento={departamento(elegido.contrato.unidad)} reciboDe={reciboDe} onRevisar={setRevisar} onRegistrar={() => { setError(null); setAviso(null); setRegistrar({ contrato: elegido.contrato.id }) }} onClose={() => setSeleccion(null)} />}
      {registrar && <RegistrarPagoCuota contratos={tablero.contratos} inicial={registrar.contrato} departamento={departamento} onGuardar={guardarPago} onClose={() => setRegistrar(null)} />}
      {pagoRevisado && (
        <RevisionPago pago={{ tipo: 'pago', id: pagoRevisado.id, titulo: `Pago ${pagoRevisado.referencia} · ${nombreDe(pagoRevisado.contratoId)?.cliente ?? ''}`, monto: pagoRevisado.monto, referencia: pagoRevisado.referencia, fecha: pagoRevisado.fecha, pendiente: pagoRevisado.estado === 'registrado', propio: pagoRevisado.registradoPor === actor.id }}
          comprobantes={d.comprobantes.filter((k) => k.pagoId === pagoRevisado.id)} recibo={reciboDe(pagoRevisado)} datos={datos} almacen={almacenPagos(conexion)} ejecutar={ejecutar} onClose={() => setRevisar(null)} />
      )}
    </>
  )
}

/** Solicitudes y reservas desde que se crean. Lo acordado no es un ingreso; solo se confirma con la verificación de Finanzas. */
function ReservasCobranza({ filas, d, datos, ejecutar }: { filas: FilaReserva[]; d: api.DatosCobranza; datos: Datos; ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const { can, actor } = useSession()
  const conexion = useConexion()
  const [revision, setRevision] = useState<Reserva | null>(null)
  const [verAnuladas, setVerAnuladas] = useState(false)
  const [pago, setPago] = useState<Reserva | null>(null)
  const anuladas = filas.filter((f) => f.estado === 'anulada').length
  const [movimientos, setMovimientos] = useState<Reserva | null>(null)
  // Una anulada con dinero recibido siempre se ve: falta definir qué pasa con ese dinero.
  const lista = verAnuladas ? filas : filas.filter((f) => f.estado !== 'anulada' || f.pagado > 0)
  const destino = (r: Reserva) => (can('cotizaciones.crear') ? `/venta?cotizacion=${r.cotizacionId}` : `/reservas?codigo=${r.codigo}`)
  return (
    <div className="grid gap-3">
      {anuladas > 0 && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} />Mostrar anuladas ({anuladas})</label>}
      {lista.length === 0 ? <div className="module-empty"><p className="text-sm text-muted-foreground">No hay solicitudes de reserva en tu alcance.</p></div> : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Cliente</th>
                <th className="px-2 py-2 text-left font-medium">Departamento</th>
                <th className="px-2 py-2 text-left font-medium">Código</th>
                <th className="px-2 py-2 text-right font-medium">Acordado</th>
                <th className="px-2 py-2 text-right font-medium">Pagado</th>
                <th className="px-2 py-2 text-right font-medium">Saldo pendiente</th>
                <th className="px-2 py-2 text-left font-medium">Estado</th>
                <th className="px-4 py-2 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <tr key={f.reserva.id} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium">{f.reserva.clienteNombre}</td>
                  <td className="px-2 py-2">{d.departamentos.get(f.reserva.unidad) ?? numeroComercial(f.reserva.unidad)}</td>
                  <td className="px-2 py-2">{f.reserva.codigo}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.acordado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.pagado)}{f.estado === 'por_verificar' && <div className="text-xs text-muted-foreground">reportado, sin confirmar</div>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.saldo)}</td>
                  <td className="px-2 py-2"><Pastilla texto={ESTADO_FILA[f.estado].label} tono={ESTADO_FILA[f.estado].tono} />{f.vencida && <span className="ml-1"><Pastilla texto="Vencida" tono="bg-rose-50 text-rose-700 ring-rose-200" /></span>}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1.5">
                      {f.estado === 'pendiente_pago' && (can('reservas.solicitar') || can('cobranzas.registrar')) && <Button size="xs" variant="outline" onClick={() => setPago(f.reserva)}><FileCheck2 />Registrar pago</Button>}
                      {(f.estado !== 'pendiente_pago' || d.comprobantes.some((c) => c.reservaId === f.reserva.id)) && (f.estado !== 'anulada' || d.comprobantes.some((c) => c.reservaId === f.reserva.id)) && <Button size="xs" variant={f.estado === 'por_verificar' ? 'default' : 'outline'} onClick={() => setRevision(f.reserva)}>{f.estado === 'por_verificar' ? 'Revisar pago' : 'Ver pago'}</Button>}
                      {f.estado === 'anulada' && f.pagado > 0 && (can('cobranzas.registrar') || can('ventas.desistimiento_con_dinero') || d.movimientos.some((m) => m.reservaId === f.reserva.id)) && <Button size="xs" variant="outline" onClick={() => setMovimientos(f.reserva)}>Devolución o retención</Button>}
                      <Button size="xs" variant="outline" asChild><Link to={destino(f.reserva)} aria-label={`Ver reserva ${f.reserva.codigo}`}>Ver reserva</Link></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Una solicitud no es un ingreso ni una cuenta por cobrar contractual: el cronograma se vuelve exigible al firmar el contrato. Registrar un pago no lo confirma; Finanzas verifica el ingreso.</p>
      <RegistrarPagoDialog reserva={pago} onClose={() => setPago(null)}
        onConfirm={(p) => { const r = pago!; setPago(null); void ejecutar(() => reportarPagoReserva(datos, almacenPagos(conexion), r.id, p), `Pago de ${r.codigo} registrado · pendiente de verificación de Finanzas`) }} />
      {movimientos && <MovimientosReserva reserva={movimientos} movimientos={d.movimientos.filter((m) => m.reservaId === movimientos.id)} datos={datos} almacen={almacenPagos(conexion)} ejecutar={ejecutar} onClose={() => setMovimientos(null)} />}
      {revision && (() => {
        const propios = d.comprobantes.filter((c) => c.reservaId === revision.id)
        const reportado = propios.find((c) => c.estado === 'reportado')
        const enRevision: PagoEnRevision = {
          tipo: 'reserva', id: revision.id, titulo: `Pago de ${revision.codigo} · ${revision.clienteNombre}`, monto: revision.montoRecibido ?? revision.montoReserva, referencia: revision.comprobante ?? '', fecha: hoyGuayaquil(),
          pendiente: revision.estado === 'solicitada' && !!revision.comprobante, propio: revision.creadaPor.id === actor.id || reportado?.cargadoPor === actor.id, bloqueo: bloqueoVerificacion(revision),
        }
        return <RevisionPago pago={enRevision} comprobantes={propios} recibo={d.recibos.find((v) => v.reservaId === revision.id) ?? null} datos={datos} almacen={almacenPagos(conexion)} ejecutar={ejecutar} onClose={() => setRevision(null)} />
      })()}
    </div>
  )
}

function Alertas({ alertas }: { alertas: api.Alerta[] }) {
  if (!alertas.length) return <div className="module-empty"><p className="text-sm text-muted-foreground">Sin alertas generadas. Las crea la tarea diaria del servidor (08:00, hora de Ecuador).</p></div>
  return (
    <div className="dashboard-card !p-0 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Creada</th><th className="px-2 py-2 text-left font-medium">Asunto</th><th className="px-2 py-2 text-left font-medium">Destinatario</th><th className="px-4 py-2 text-left font-medium">Estado</th></tr></thead>
        <tbody>
          {alertas.map((a) => (
            <tr key={a.id} className="border-t border-border align-top">
              <td className="px-4 py-2 tabular-nums">{new Date(a.creadaEn).toLocaleString('es-EC')}</td>
              <td className="px-2 py-2">{a.asunto}</td>
              <td className="px-2 py-2">{a.destinatario}</td>
              <td className="px-4 py-2">{ESTADO_ALERTA[a.estado] ?? a.estado}{a.error && <div className="text-xs text-muted-foreground">{a.error}</div>}{a.intentos > 0 && <div className="text-xs text-muted-foreground">{a.intentos} intento(s)</div>}</td>
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

function Detalle({ r, d, datos, ejecutar, error, aviso, departamento, reciboDe, onRevisar, onRegistrar, onClose }: { r: ResumenContrato; d: api.DatosCobranza; datos: Datos; ejecutar: Ejecutar; error: string | null; aviso: string | null; departamento: string; reciboDe: (p: { id: string; contratoId: string; referencia: string }) => Recibo | null; onRevisar: (id: string) => void; onRegistrar: () => void; onClose: () => void }) {
  const { can, actor } = useSession()
  const conexion = useConexion()
  const c = r.contrato
  const pagos = d.pagos.filter((p) => p.contratoId === c.id)
  const gestiones = d.gestiones.filter((g) => g.contratoId === c.id)
  const compromisos = d.compromisos.filter((k) => k.contratoId === c.id)
  const [pedir, setPedir] = useState<Pedir | null>(null)
  const [gestion, setGestion] = useState({ tipo: 'llamada', descripcion: '', numero: '' })
  const [comp, setComp] = useState({ monto: '', fecha: '', numero: '', motivo: '' })
  const [repro, setRepro] = useState({ numero: '', fecha: '', motivo: '' })
  const num = (s: string) => Number(s.replace(',', '.'))
  const [generando, setGenerando] = useState(false)
  const estadoCuenta = async () => {
    setGenerando(true)
    try { await descargarEstadoCuenta(datos, r, d, hoyGuayaquil()) } catch (e) { void ejecutar(() => Promise.reject(e), '') }
    setGenerando(false)
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">{c.cliente} · Dpto. {departamento}</SheetTitle>
              <SheetDescription>{c.codigo} · {c.estado === 'firmado' ? 'Firmado: cronograma exigible' : 'Borrador: aún no exigible'} · Responsable {c.responsable}</SheetDescription>
            </div>
            <Button size="sm" variant="outline" disabled={generando} onClick={() => void estadoCuenta()}>{generando ? <Loader2 className="animate-spin" /> : <Download />}Estado de cuenta</Button>
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
            <Kpi t="Saldo a favor" v={fmtUsd2(r.saldoAFavor)} d="Excedente sin aplicar al 80 %" />
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold">Cronograma de la entrada del 20 %</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium">Cuota</th><th className="px-2 py-1.5 text-left font-medium">Vencimiento</th><th className="px-2 py-1.5 text-right font-medium">Monto</th><th className="px-2 py-1.5 text-right font-medium">Aplicado</th><th className="px-2 py-1.5 text-right font-medium">Saldo</th><th className="px-3 py-1.5 text-left font-medium">Estado</th></tr></thead>
                <tbody>
                  {r.cuotas.filter((q) => q.esEntrada).map((q) => (
                    <tr key={q.numero} className="border-t border-border">
                      <td className="px-3 py-1.5">{q.concepto} <span className="text-muted-foreground">(nº {q.numero})</span></td>
                      <td className="px-2 py-1.5 tabular-nums">{fmtFechaCorta(q.vencimiento)}{q.vencimientoOriginal && <div className="text-xs text-muted-foreground">Original {fmtFechaCorta(q.vencimientoOriginal)}</div>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.monto)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.pagado)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(q.saldo)}</td>
                      <td className="px-3 py-1.5">
                        <Pastilla texto={c.estado === 'firmado' ? SITUACION[q.situacion].label : q.situacion === 'pagada' ? 'Pagada' : 'No exigible'} tono={c.estado === 'firmado' ? SITUACION[q.situacion].tono : 'bg-slate-50 text-slate-600 ring-slate-200'} />
                        {q.parcial && <span className="ml-1"><Pastilla texto="Abono parcial" tono="bg-sky-50 text-sky-800 ring-sky-200" /></span>}
                        {q.situacion === 'vencida' && c.estado === 'firmado' && <span className="ml-1 text-xs text-rose-700">{q.atrasoDias} d</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <ExcedenteEntrega r={r} datos={datos} almacen={almacenPagos(conexion)} nombres={d.nombres} ejecutar={ejecutar} />

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold">Pagos</h3>
              {can('cobranzas.registrar') && <Button size="sm" onClick={onRegistrar}><Plus />Registrar pago</Button>}
            </div>
            {pagos.length === 0 ? <p className="text-xs text-muted-foreground">Sin pagos registrados.</p> : (
              <ul className="grid gap-1.5 text-xs">
                {pagos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <span className="font-medium tabular-nums">{fmtUsd2(p.monto)}</span>
                    <span className="text-muted-foreground">{fmtFechaCorta(p.fecha)} · ref. {p.referencia}</span>
                    <Pastilla texto={ESTADO_PAGO[p.estado].label} tono={ESTADO_PAGO[p.estado].tono} />
                    {p.motivo && <span className="text-xs text-muted-foreground">{p.motivo}</span>}
                    <span className="ml-auto flex gap-1.5">
                      {reciboDe(p) && p.estado === 'verificado' && <Button size="sm" variant="outline" onClick={() => void descargarRecibo(almacenPagos(conexion), reciboDe(p)!, null, datos).catch(() => {})}><Download />Recibo {reciboDe(p)!.numero}</Button>}
                      {(p.estado === 'registrado' ? can('cobranzas.verificar') || p.registradoPor === actor.id : !!reciboDe(p) || d.comprobantes.some((k) => k.pagoId === p.id)) &&
                        <Button size="sm" variant={p.estado === 'registrado' && p.registradoPor !== actor.id ? 'default' : 'outline'} onClick={() => onRevisar(p.id)}>{p.estado === 'registrado' ? 'Revisar pago' : 'Ver pago'}</Button>}
                      {p.estado === 'registrado' && p.registradoPor === actor.id && <span className="text-xs text-muted-foreground">Lo verifica otra persona</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="rounded-lg border border-border px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold">Seguimiento y correcciones</summary>
            <div className="mt-3 grid gap-5">
          {can('cobranzas.verificar') && pagos.some((p) => p.estado === 'registrado' || p.estado === 'verificado') && (
            <section>
              <h3 className="mb-2 text-xs font-semibold">Anular un pago</h3>
              <ul className="grid gap-1.5 text-xs">
                {pagos.filter((p) => p.estado === 'registrado' || p.estado === 'verificado').map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
                    <span className="min-w-0 flex-1 tabular-nums">{fmtUsd2(p.monto)} · ref. {p.referencia}</span>
                    <Button size="sm" variant="ghost" onClick={() => setPedir({ titulo: `Anular el pago ${p.referencia}`, boton: 'Anular pago', destructivo: true, ok: 'Pago anulado', accion: (m) => api.anularPago(datos, p.id, m) })}>Anular</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
              <p className="mt-1 text-xs text-muted-foreground">Conserva la fecha original y los pagos; queda en auditoría con tu usuario y motivo.</p>
            </section>
          )}
            </div>
          </details>
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

function Kpi({ t, v, d, tone, destacado, onClick, activo }: { t: string; v: string; d: string; tone?: string; destacado?: boolean; onClick?: () => void; activo?: boolean }) {
  const contenido = <><div className="text-xs text-muted-foreground">{t}</div><div className={cn('mt-1 text-lg font-semibold tabular-nums tracking-tight', tone, destacado && 'text-primary')}>{v}</div><div className="mt-0.5 text-xs text-muted-foreground">{d}</div></>
  if (onClick) return <button type="button" aria-pressed={activo} onClick={onClick} className={cn('dashboard-card !p-4 text-left hover:bg-muted/30', activo && 'ring-2 ring-primary/50')}>{contenido}</button>
  return (
    <div className={cn('dashboard-card !p-4', destacado && 'ring-1 ring-primary/30')}>
      <div className="text-xs text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums tracking-tight', tone, destacado && 'text-primary')}>{v}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{d}</div>
    </div>
  )
}
