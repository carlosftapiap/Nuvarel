import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { AlertTriangle, Download, FileText, Landmark, Loader2, Plus, Scale, Trash2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { calcularEntrada, type EntradaCalculada } from '@/features/cobranza/entrada'
import type { Datos } from '@/features/conexion/datos'
import { simularHipoteca, type Amortizacion, type CondicionesManuales, type ProductoHipotecario, type Simulacion, type Tramo } from '@/features/financiamiento/hipoteca'
import { descargarPdfIntegral } from '@/features/financiamiento/pdfIntegral'
import { DESCUENTO_MAX, fmtFechaCorta, generarPlan, hoyGuayaquil, sumarMeses } from '@/features/financiamiento/plan'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { EstadoBadge, FieldError, pisoLabel } from '@/features/inventario/components/shared'
import { fmtM2, fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { cn } from '@/lib/utils'

const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const pct = (v: number) => `${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const plazoTxt = (m: number) => `${Math.floor(m / 12)} a${m % 12 ? ` ${m % 12} m` : ''}`

/** Lee los productos vigentes del catálogo bancario (solo con Supabase). */
function aProducto(r: Record<string, unknown>): ProductoHipotecario {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: String(r.id), clave: String(r.clave), version: Number(r.version), entidad: String(r.entidad), producto: String(r.producto),
    tipoTasa: r.tipo_tasa === 'variable' ? 'variable' : 'fija', tasaNominal: n(r.tasa_nominal), tramos: (r.tramos as Tramo[]) ?? [],
    plazoMinMeses: Number(r.plazo_min_meses), plazoMaxMeses: Number(r.plazo_max_meses), financiamientoMaxPct: n(r.financiamiento_max_pct),
    montoMax: n(r.monto_max), desgravamenPctMensual: n(r.desgravamen_pct_mensual), incendioPctAnual: n(r.incendio_pct_anual),
    gastosFijos: n(r.gastos_fijos), avaluo: n(r.avaluo), fuente: String(r.fuente), fechaFuente: String(r.fecha_fuente).slice(0, 10),
  }
}

export default function FinanciamientoPage() {
  const { state } = useInventory()
  const { can, actor } = useSession()
  const { remoto, datos } = useConexion()
  const [params, setParams] = useSearchParams()
  const codigo = params.get('unidad') ?? ''
  const [fechaFirma, setFechaFirma] = useState(hoyGuayaquil())
  const [descuento, setDescuento] = useState('0')
  const [reservaTxt, setReservaTxt] = useState('')
  const puedeDescontar = can('cotizaciones.descuento')
  const unit = state.units.find((u) => u.codigo === codigo)

  const base = useMemo(() => {
    if (!unit) return { plan: null, error: null }
    try {
      return { plan: generarPlan(unit, state.params, { fechaReserva: fechaFirma, descuentoPct: puedeDescontar ? Number(descuento.replace(',', '.')) || 0 : 0 }), error: null }
    } catch (e) {
      return { plan: null, error: (e as Error).message }
    }
  }, [unit, state.params, fechaFirma, descuento, puedeDescontar])
  const plan = base.plan

  // Sin dato propio, la reserva propuesta es el 6% (el pago a la firma queda en cero); se puede bajar a 500, 600, 1.000…
  const reserva = numero(reservaTxt) ?? plan?.reserva ?? 0
  const entrada = useMemo(() => {
    if (!plan || !unit) return { e: null as EntradaCalculada | null, error: null as string | null }
    try {
      return { e: calcularEntrada({ precioFinal: plan.precioFinal, reserva, meses: state.params.meses[unit.edificio] }), error: null }
    } catch (err) {
      return { e: null, error: (err as Error).message }
    }
  }, [plan, unit, reserva, state.params.meses])

  const [productos, setProductos] = useState<ProductoHipotecario[]>([])
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const cargarCatalogo = useCallback(async () => {
    if (!remoto || !datos) return
    try {
      const rows = await datos.select('bank_products', { filtros: { vigente: true }, orden: [{ columna: 'entidad' }, { columna: 'producto' }] })
      setProductos(rows.map(aProducto))
      setErrorCatalogo(null)
    } catch (e) {
      setErrorCatalogo((e as Error).message)
    }
  }, [remoto, datos])
  useEffect(() => { void cargarCatalogo() }, [cargarCatalogo])

  const [credito, setCredito] = useState<Simulacion | null>(null)

  function exportar() {
    if (!entrada.e || !unit || !plan) return
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entrada.e.partidas.map((p, i) => ({
      'N.º': i, Concepto: p.concepto, Fecha: p.tipo === 'reserva' ? 'Al reservar' : p.tipo === 'firma' ? fmtFechaCorta(fechaFirma) : p.tipo === 'cuota' ? fmtFechaCorta(sumarMeses(fechaFirma, i - 1)) : 'A la entrega',
      'Monto (USD)': p.monto,
    }))), 'Entrada 20%')
    if (credito) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(credito.tabla.map((r) => ({
        'N.º': r.n, Capital: r.capital, Interés: r.interes, Desgravamen: r.desgravamen ?? 'Sin dato', Incendio: r.incendio ?? 'Sin dato', Cuota: r.cuota, Saldo: r.saldo,
      }))), 'Crédito 80%')
    }
    XLSX.writeFile(wb, `AMURA_financiamiento_${unit.dpt}_${fechaFirma}.xlsx`)
  }

  return (
    <>
      <PageHeader eyebrow="Ventas · Financiamiento" title="Simulador de financiamiento"
        subtitle="Entrada del 20% a favor de Nuvarel y crédito hipotecario del 80% del comprador. Una simulación no crea deuda ni es una aprobación bancaria."
        actions={entrada.e && <>
          <Button variant="outline" size="sm" onClick={exportar}><Download />Excel</Button>
          {can('cotizaciones.crear') && <Button size="sm" variant="outline" asChild><Link to={`/cotizaciones?unidad=${encodeURIComponent(codigo)}&fecha=${fechaFirma}`}><FileText />Crear cotización</Link></Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <section className="dashboard-card p-5 grid content-start gap-4" aria-label="Datos de la simulación">
          <UnitPicker id="fin-unidad" units={state.units} params={state.params} value={codigo}
            onChange={(c) => setParams((p) => { p.set('unidad', c); return p }, { replace: true })} />
          <div className="grid gap-1.5">
            <Label htmlFor="fin-firma" className="text-xs">Fecha de firma</Label>
            <Input id="fin-firma" type="date" value={fechaFirma} onChange={(e) => setFechaFirma(e.target.value)} className="h-9" />
            <p className="text-[11px] text-muted-foreground">Las cuotas de entrada se cuentan desde esta fecha.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fin-reserva" className="text-xs">Reserva (USD)</Label>
            <Input id="fin-reserva" inputMode="decimal" value={reservaTxt} placeholder={plan ? String(plan.reserva) : ''} onChange={(e) => setReservaTxt(e.target.value)} className="h-9" />
            <p className="text-[11px] text-muted-foreground">Monto que paga el cliente al reservar. Se acredita al 6% de la firma; no se cobra dos veces.</p>
          </div>
          {puedeDescontar ? (
            <div className="grid gap-1.5">
              <Label htmlFor="fin-desc" className="text-xs">Descuento autorizado (%)</Label>
              <Input id="fin-desc" inputMode="decimal" value={descuento} onChange={(e) => setDescuento(e.target.value)} className="h-9" />
              <p className="text-[11px] text-muted-foreground">Máximo técnico {DESCUENTO_MAX}%. Úsalo solo con autorización.</p>
            </div>
          ) : <p className="rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">Los descuentos los autoriza gerencia.</p>}
          {unit && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <div className="flex items-center justify-between gap-2"><b>Departamento {unit.dpt}</b><EstadoBadge estado={unit.estado} /></div>
              <p className="mt-1 text-muted-foreground">Edificio {unit.edificio} · {pisoLabel(unit.piso)} · {unit.tipologia} · {fmtM2(unit.areaM2 + unit.bodegaM2)}</p>
              {plan && <p className="mt-2 text-sm font-semibold text-primary">Precio final {fmtUsd(plan.precioFinal)}</p>}
            </div>
          )}
          <FieldError>{base.error ?? entrada.error}</FieldError>
        </section>

        {!plan || !entrada.e || !unit ? (
          <div className="module-empty"><h2 className="text-lg font-semibold">Selecciona un departamento</h2><p className="mt-2 text-sm text-muted-foreground">Verás la entrada del 20%, el crédito hipotecario del 80% y podrás generar la cotización integral.</p></div>
        ) : (
          <Tabs defaultValue="entrada" className="min-w-0">
            <TabsList className="mb-3 max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="entrada">1. Entrada del 20%</TabsTrigger>
              <TabsTrigger value="credito">2. Crédito hipotecario 80%</TabsTrigger>
              <TabsTrigger value="pdf">3. Cotización integral</TabsTrigger>
            </TabsList>
            <TabsContent value="entrada" className="min-w-0"><Entrada e={entrada.e} fechaFirma={fechaFirma} /></TabsContent>
            <TabsContent value="credito" className="min-w-0">
              <Credito precio={plan.precioFinal} entrada={entrada.e.entradaTotal} productos={productos} remoto={remoto} errorCatalogo={errorCatalogo}
                puedeCatalogo={can('financiamiento.catalogo')} datos={datos} onCatalogo={cargarCatalogo} onSimulacion={setCredito} />
            </TabsContent>
            <TabsContent value="pdf" className="min-w-0">
              <Integral unit={unit} precio={plan.precioFinal} fechaFirma={fechaFirma} entrada={entrada.e} credito={credito} asesor={actor.nombre}
                datos={remoto ? datos : null} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  )
}

/* ------------------------------------------------------- 1. entrada del 20% */

function Entrada({ e, fechaFirma }: { e: EntradaCalculada; fechaFirma: string }) {
  const cuotas = e.partidas.filter((p) => p.tipo === 'cuota')
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Caja titulo="Entrada total (20%)" valor={fmtUsd2(e.entradaTotal)} detalle="A favor de Nuvarel" destacado />
        <Caja titulo="Pago adicional a la firma" valor={fmtUsd2(e.pagoFirma)} detalle={`Completa el 6% (${fmtUsd2(e.acumuladoFirma)}) · ${fmtFechaCorta(fechaFirma)}`} />
        <Caja titulo={`Cuotas de entrada`} valor={`${cuotas.length} × ${fmtUsd2(e.cuotaMensual)}`} detalle={`Total ${fmtUsd2(e.saldoCuotas)}`} />
        <Caja titulo="Saldo contra entrega (80%)" valor={fmtUsd2(e.saldoEntrega)} detalle="Normalmente con crédito hipotecario" />
      </div>
      <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="crono">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="crono" className="text-sm font-semibold">Cronograma de pagos</h2>
          <span className="text-[11px] text-muted-foreground">Simulación: la deuda se activa al firmar</span>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Concepto</th><th className="px-2 py-2 text-left font-medium">Fecha</th><th className="px-4 py-2 text-right font-medium">Monto</th></tr>
            </thead>
            <tbody>
              {e.partidas.map((p, i) => (
                <tr key={i} className={cn('border-t border-border', p.tipo !== 'cuota' && 'bg-secondary/40 font-medium')}>
                  <td className="px-4 py-1.5">{p.concepto}</td>
                  <td className="px-2 py-1.5 tabular-nums">{p.tipo === 'reserva' ? 'Al reservar' : p.tipo === 'firma' ? fmtFechaCorta(fechaFirma) : p.tipo === 'cuota' ? fmtFechaCorta(sumarMeses(fechaFirma, i - 1)) : 'A la entrega'}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsd2(p.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-[11px] text-muted-foreground">La reserva se acredita al 6% pagado a la firma. La última cuota ajusta los centavos para que el total sea exacto.</p>
    </div>
  )
}

/* ------------------------------------------------- 2. crédito hipotecario 80% */

interface CreditoProps {
  precio: number
  entrada: number
  productos: ProductoHipotecario[]
  remoto: boolean
  errorCatalogo: string | null
  puedeCatalogo: boolean
  datos: Datos | null
  onCatalogo: () => Promise<void>
  onSimulacion: (s: Simulacion | null) => void
}

function Credito({ precio, entrada, productos, remoto, errorCatalogo, puedeCatalogo, datos, onCatalogo, onSimulacion }: CreditoProps) {
  const [productoId, setProductoId] = useState('manual')
  const [anios, setAnios] = useState('20')
  const [meses, setMeses] = useState('0')
  const [amortizacion, setAmortizacion] = useState<Amortizacion>('francesa')
  const [tasa, setTasa] = useState('')
  const [tasaEs, setTasaEs] = useState<'nominal' | 'efectiva'>('nominal')
  const [tipoTasa, setTipoTasa] = useState<'fija' | 'variable'>('fija')
  const [desgravamen, setDesgravamen] = useState('')
  const [incendio, setIncendio] = useState('')
  const [gastos, setGastos] = useState('')
  const [avaluo, setAvaluo] = useState('')
  const [todas, setTodas] = useState(false)
  const [comparar, setComparar] = useState<Simulacion[]>([])
  const [catalogo, setCatalogo] = useState(false)

  const producto = productos.find((p) => p.id === productoId) ?? null
  const plazoMeses = (Number(anios) || 0) * 12 + (Number(meses) || 0)
  const sim = useMemo(() => {
    try {
      const manual: CondicionesManuales | null = producto ? null : (() => {
        const t = numero(tasa)
        if (t === null) throw new Error('Ingresa la tasa del escenario manual o elige un producto del catálogo.')
        return { tasa: t, tasaEs, tipoTasa, desgravamenPctMensual: numero(desgravamen), incendioPctAnual: numero(incendio), gastosFijos: numero(gastos), avaluo: numero(avaluo) }
      })()
      return { s: simularHipoteca({ precio, entrada, plazoMeses, amortizacion, producto, manual }), error: null }
    } catch (e) {
      return { s: null, error: (e as Error).message }
    }
  }, [producto, tasa, tasaEs, tipoTasa, desgravamen, incendio, gastos, avaluo, precio, entrada, plazoMeses, amortizacion])
  useEffect(() => { onSimulacion(sim.s) }, [sim.s, onSimulacion])
  const s = sim.s

  return (
    <div className="grid gap-4">
      <section className="dashboard-card grid gap-4 p-5" aria-label="Condiciones del crédito">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cr-prod" className="text-xs">Banco o BIESS y producto</Label>
            <select id="cr-prod" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={productoId} onChange={(e) => setProductoId(e.target.value)}>
              <option value="manual">Escenario manual (tasa y plazo personalizados)</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.entidad} · {p.producto} (v{p.version})</option>)}
            </select>
            {producto
              ? <p className="text-[11px] text-muted-foreground">Fuente: {producto.fuente} · {fmtFechaCorta(producto.fechaFuente)} · plazo {producto.plazoMinMeses}–{producto.plazoMaxMeses} meses{producto.tramos.length ? ' · tasa por tramos de monto y plazo' : ''}</p>
              : <p className="text-[11px] text-muted-foreground">{remoto ? (productos.length ? 'Escenario manual: se identifica así en la cotización.' : 'El catálogo aún no tiene productos con tasas verificadas.') : 'Sin conexión a Supabase: solo escenario manual.'}</p>}
            {errorCatalogo && <p className="text-[11px] text-rose-700">{errorCatalogo}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="cr-anios" className="text-xs">Plazo (años)</Label><Input id="cr-anios" inputMode="numeric" value={anios} onChange={(e) => setAnios(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-meses" className="text-xs">+ meses</Label><Input id="cr-meses" inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value)} className="h-9" /></div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cr-amort" className="text-xs">Amortización</Label>
            <select id="cr-amort" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={amortizacion} onChange={(e) => setAmortizacion(e.target.value as Amortizacion)}>
              <option value="francesa">Francesa (cuota fija)</option>
              <option value="alemana">Alemana (capital fijo)</option>
            </select>
          </div>
        </div>
        {!producto && (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-3 xl:grid-cols-7">
            <div className="grid gap-1.5"><Label htmlFor="cr-tasa" className="text-xs">Tasa anual (%)</Label><Input id="cr-tasa" inputMode="decimal" value={tasa} onChange={(e) => setTasa(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-tasa-es" className="text-xs">La tasa es</Label>
              <select id="cr-tasa-es" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={tasaEs} onChange={(e) => setTasaEs(e.target.value as 'nominal' | 'efectiva')}><option value="nominal">Nominal</option><option value="efectiva">Efectiva</option></select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-tipo" className="text-xs">Tipo</Label>
              <select id="cr-tipo" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={tipoTasa} onChange={(e) => setTipoTasa(e.target.value as 'fija' | 'variable')}><option value="fija">Fija</option><option value="variable">Variable</option></select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="cr-desg" className="text-xs">Desgravamen % mensual</Label><Input id="cr-desg" inputMode="decimal" placeholder="Sin dato" value={desgravamen} onChange={(e) => setDesgravamen(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-inc" className="text-xs">Incendio % anual</Label><Input id="cr-inc" inputMode="decimal" placeholder="Sin dato" value={incendio} onChange={(e) => setIncendio(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-gastos" className="text-xs">Gastos (USD)</Label><Input id="cr-gastos" inputMode="decimal" placeholder="Sin dato" value={gastos} onChange={(e) => setGastos(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-avaluo" className="text-xs">Avalúo (USD)</Label><Input id="cr-avaluo" inputMode="decimal" placeholder="Sin dato" value={avaluo} onChange={(e) => setAvaluo(e.target.value)} className="h-9" /></div>
          </div>
        )}
        <FieldError>{sim.error}</FieldError>
        {puedeCatalogo && remoto && datos && (
          <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setCatalogo(true)}><Landmark />Catálogo bancario</Button></div>
        )}
      </section>

      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Caja titulo="Cuota mensual estimada" valor={s.amortizacion === 'francesa' ? fmtUsd2(s.primeraCuota) : `${fmtUsd2(s.primeraCuota)} → ${fmtUsd2(s.ultimaCuota)}`}
              detalle={`${s.faltantes.length ? 'Sin seguros desconocidos' : 'Incluye seguros'} · ${plazoTxt(s.plazoMeses)}`} destacado />
            <Caja titulo="Monto financiado" valor={fmtUsd2(s.montoFinanciado)} detalle={`Solicitado ${fmtUsd2(s.montoSolicitado)}`} />
            <Caja titulo="Tasa" valor={`${pct(s.tasaNominal)} nominal`} detalle={`${pct(s.tasaEfectiva)} efectiva anual · ${s.tipoTasa}`} />
            <Caja titulo="Costo total estimado" valor={fmtUsd2(s.costoTotal)} detalle={`Intereses ${fmtUsd2(s.totalIntereses)}`} />
          </div>
          {s.aporteAdicional > 0 && (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              El financiamiento disponible no cubre el saldo: el comprador necesita un <b>aporte propio adicional de {fmtUsd2(s.aporteAdicional)}</b>.
            </p>
          )}
          {s.faltantes.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Sin dato de: {s.faltantes.join(', ')}. No están incluidos en la cuota ni en el costo total; no son gratuitos.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Simulación referencial sujeta a aprobación bancaria. {s.escenario === 'manual' ? 'Escenario manual ingresado por el asesor.' : `Fuente ${s.fuente} del ${fmtFechaCorta(s.fechaFuente)} (versión ${s.version}).`} No se garantiza que la tasa siga vigente a la entrega.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={comparar.length >= 3} onClick={() => setComparar([...comparar, s])}><Scale />Agregar al comparador ({comparar.length}/3)</Button>
          </div>

          {comparar.length > 0 && (
            <section className="dashboard-card !p-0 overflow-x-auto" aria-label="Comparador">
              <h2 className="px-4 pt-4 text-sm font-semibold">Comparación de escenarios</h2>
              <table className="mt-3 w-full text-xs">
                <thead className="bg-muted text-[11px] text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left font-medium">Escenario</th><th className="px-2 py-2 text-right font-medium">Cuota</th><th className="px-2 py-2 text-right font-medium">Plazo</th><th className="px-2 py-2 text-right font-medium">Tasa</th><th className="px-2 py-2 text-right font-medium">Intereses</th><th className="px-2 py-2 text-right font-medium">Costo total</th><th /></tr>
                </thead>
                <tbody>
                  {comparar.map((c, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-4 py-2">{c.entidad} · {c.producto} · {c.amortizacion}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(c.primeraCuota)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{plazoTxt(c.plazoMeses)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{pct(c.tasaNominal)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(c.totalIntereses)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(c.costoTotal)}{c.faltantes.length ? ' *' : ''}</td>
                      <td className="px-2 py-2 text-right"><button type="button" aria-label="Quitar del comparador" onClick={() => setComparar(comparar.filter((_, j) => j !== i))}><Trash2 className="size-3.5 text-muted-foreground" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-[11px] text-muted-foreground">* Sin seguros o gastos conocidos: el costo real será mayor.</p>
            </section>
          )}

          <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="amort">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="amort" className="text-sm font-semibold">Tabla de amortización</h2>
              <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => setTodas(!todas)}>{todas ? 'Ver primeras 12' : `Ver las ${s.tabla.length} cuotas`}</button>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
                  <tr><th className="px-4 py-2 text-left font-medium">N.º</th><th className="px-2 py-2 text-right font-medium">Capital</th><th className="px-2 py-2 text-right font-medium">Interés</th><th className="px-2 py-2 text-right font-medium">Seguros</th><th className="px-2 py-2 text-right font-medium">Cuota</th><th className="px-4 py-2 text-right font-medium">Saldo</th></tr>
                </thead>
                <tbody>
                  {(todas ? s.tabla : s.tabla.slice(0, 12)).map((r) => (
                    <tr key={r.n} className="border-t border-border">
                      <td className="px-4 py-1.5 tabular-nums text-muted-foreground">{r.n}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(r.capital)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtUsd2(r.interes)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.desgravamen === null && r.incendio === null ? 'Sin dato' : fmtUsd2((r.desgravamen ?? 0) + (r.incendio ?? 0))}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{fmtUsd2(r.cuota)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{fmtUsd2(r.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {catalogo && datos && <CatalogoDialog datos={datos} productos={productos} onClose={() => setCatalogo(false)} onGuardado={onCatalogo} />}
    </div>
  )
}

/* ------------------------------------------------- catálogo bancario (admin) */

function CatalogoDialog({ datos, productos, onClose, onGuardado }: { datos: Datos; productos: ProductoHipotecario[]; onClose: () => void; onGuardado: () => Promise<void> }) {
  const [f, setF] = useState({ clave: '', entidad: '', producto: '', tipo_tasa: 'fija', tasa_nominal: '', plazo_min_meses: '', plazo_max_meses: '', financiamiento_max_pct: '',
    monto_max: '', desgravamen_pct_mensual: '', incendio_pct_anual: '', gastos_fijos: '', avaluo: '', fuente: '', fecha_fuente: '' })
  const [tramos, setTramos] = useState<{ montoMin: string; montoMax: string; plazoMin: string; plazoMax: string; tasa: string }[]>([])
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const editar = (p: ProductoHipotecario) => {
    const t = (v: number | null) => (v === null ? '' : String(v))
    setF({ clave: p.clave, entidad: p.entidad, producto: p.producto, tipo_tasa: p.tipoTasa, tasa_nominal: t(p.tasaNominal), plazo_min_meses: String(p.plazoMinMeses), plazo_max_meses: String(p.plazoMaxMeses),
      financiamiento_max_pct: t(p.financiamientoMaxPct), monto_max: t(p.montoMax), desgravamen_pct_mensual: t(p.desgravamenPctMensual), incendio_pct_anual: t(p.incendioPctAnual),
      gastos_fijos: t(p.gastosFijos), avaluo: t(p.avaluo), fuente: '', fecha_fuente: '' })
    setTramos(p.tramos.map((x) => ({ montoMin: t(x.montoMin), montoMax: t(x.montoMax), plazoMin: t(x.plazoMinMeses), plazoMax: t(x.plazoMaxMeses), tasa: String(x.tasaNominal) })))
  }
  const guardar = async () => {
    setEnviando(true); setError(null)
    try {
      const d: Record<string, unknown> = Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'clave').map(([k, v]) => [k, typeof v === 'string' && /^(tasa|plazo|financ|monto|desgr|incend|gastos|avaluo)/.test(k) ? numero(v) : v]))
      d.tramos = tramos.map((x) => ({ montoMin: numero(x.montoMin), montoMax: numero(x.montoMax), plazoMinMeses: numero(x.plazoMin), plazoMaxMeses: numero(x.plazoMax), tasaNominal: Number(x.tasa.replace(',', '.')) }))
      await datos.rpc('financiamiento_guardar_producto', { p_clave: f.clave, p_datos: d, p_motivo: motivo })
      await onGuardado()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  const campo = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="grid gap-1"><Label htmlFor={`cat-${k}`} className="text-[11px]">{label}</Label><Input id={`cat-${k}`} className="h-8" value={f[k]} onChange={set(k)} {...extra} /></div>
  )
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Catálogo bancario</DialogTitle>
          <DialogDescription>Registra tasas y condiciones solo con una fuente verificada y su fecha. Cada cambio crea una versión nueva; las simulaciones guardadas conservan la versión que usaron.</DialogDescription>
        </DialogHeader>
        {productos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{productos.map((p) => <Button key={p.id} size="sm" variant="outline" onClick={() => editar(p)}>{p.entidad} · {p.producto} v{p.version}</Button>)}</div>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {campo('clave', 'Clave (p. ej. BIESS-VIVIENDA)')}
          {campo('entidad', 'Entidad')}
          {campo('producto', 'Producto')}
          <div className="grid gap-1"><Label htmlFor="cat-tipo" className="text-[11px]">Tipo de tasa</Label>
            <select id="cat-tipo" className="h-8 rounded-md border border-border bg-white px-2 text-sm" value={f.tipo_tasa} onChange={set('tipo_tasa')}><option value="fija">Fija</option><option value="variable">Variable</option></select></div>
          {campo('tasa_nominal', 'Tasa nominal anual % (sin tramos)', { inputMode: 'decimal' })}
          {campo('financiamiento_max_pct', '% máximo financiado', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('plazo_min_meses', 'Plazo mínimo (meses)', { inputMode: 'numeric' })}
          {campo('plazo_max_meses', 'Plazo máximo (meses)', { inputMode: 'numeric' })}
          {campo('monto_max', 'Monto máximo (USD)', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('desgravamen_pct_mensual', 'Desgravamen % mensual', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('incendio_pct_anual', 'Incendio % anual', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('gastos_fijos', 'Gastos (USD)', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('avaluo', 'Avalúo (USD)', { inputMode: 'decimal', placeholder: 'Sin dato' })}
          {campo('fuente', 'Fuente verificada *', { placeholder: 'Documento, página web o circular' })}
          {campo('fecha_fuente', 'Fecha de la fuente *', { type: 'date' })}
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between"><span className="text-xs font-medium">Tasas por tramo de monto y plazo (p. ej. BIESS)</span>
            <Button size="sm" variant="outline" onClick={() => setTramos([...tramos, { montoMin: '', montoMax: '', plazoMin: '', plazoMax: '', tasa: '' }])}><Plus />Tramo</Button></div>
          {tramos.map((t, i) => (
            <div key={i} className="grid grid-cols-6 gap-1.5">
              {(['montoMin', 'montoMax', 'plazoMin', 'plazoMax', 'tasa'] as const).map((k) => (
                <Input key={k} aria-label={`Tramo ${i + 1} ${k}`} className="h-8" placeholder={{ montoMin: 'Monto desde', montoMax: 'Monto hasta', plazoMin: 'Meses desde', plazoMax: 'Meses hasta', tasa: 'Tasa %' }[k]}
                  value={t[k]} onChange={(e) => setTramos(tramos.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
              ))}
              <Button size="sm" variant="ghost" aria-label="Quitar tramo" onClick={() => setTramos(tramos.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
        </div>
        <div className="grid gap-1"><Label htmlFor="cat-motivo" className="text-[11px]">Motivo del cambio *</Label><Input id="cat-motivo" className="h-8" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={enviando || motivo.trim().length < 5 || f.fuente.trim().length < 5 || !f.fecha_fuente || !f.clave} onClick={() => void guardar()}>{enviando && <Loader2 className="animate-spin" />}Guardar versión</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------- 3. cotización integral */

interface IntegralProps {
  unit: { codigo: string; dpt: string; edificio: number; tipologia: string }
  precio: number
  fechaFirma: string
  entrada: EntradaCalculada
  credito: Simulacion | null
  asesor: string
  datos: Datos | null
}

function Integral({ unit, precio, fechaFirma, entrada, credito, asesor, datos }: IntegralProps) {
  const [cliente, setCliente] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const generar = async () => {
    if (!credito) return
    setEnviando(true); setError(null); setAviso(null)
    try {
      let numeroDoc = 'BORRADOR'
      if (datos) {
        // Se guarda primero: la base congela la versión del producto usada, así un cambio de catálogo no altera esta cotización.
        const r = await datos.rpc<{ numero: string }>('financiamiento_guardar_simulacion', {
          p_unidad: unit.codigo, p_cliente: null, p_cliente_nombre: cliente.trim(),
          p_producto: credito.productoId,
          p_condiciones: { precio, fechaFirma, reserva: entrada.partidas[0].monto, entrada: entrada.entradaTotal, plazoMeses: credito.plazoMeses, amortizacion: credito.amortizacion,
            escenario: credito.escenario, entidad: credito.entidad, producto: credito.producto, tasaNominal: credito.tasaNominal, tipoTasa: credito.tipoTasa,
            fuente: credito.fuente, fechaFuente: credito.fechaFuente, version: credito.version },
          p_resultado: { primeraCuota: credito.primeraCuota, ultimaCuota: credito.ultimaCuota, montoFinanciado: credito.montoFinanciado, aporteAdicional: credito.aporteAdicional,
            totalIntereses: credito.totalIntereses, costoTotal: credito.costoTotal, faltantes: credito.faltantes, entrada },
        })
        numeroDoc = r.numero
      }
      await descargarPdfIntegral({ numero: numeroDoc, fecha: hoyGuayaquil(), cliente: cliente.trim(), asesor, unidad: unit, precioFinal: precio, fechaFirma, entrada, credito })
      setAviso(datos ? `Cotización ${numeroDoc} guardada y descargada.` : 'PDF descargado como borrador (sin conexión a Supabase no se guarda).')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <section className="dashboard-card grid max-w-xl gap-3 p-5" aria-label="Cotización integral">
      <h2 className="text-sm font-semibold">Cotización integral en PDF</h2>
      <p className="text-xs text-muted-foreground">Incluye precio final, reserva, firma y cronograma del 20%, y el crédito hipotecario del 80% simulado en la pestaña 2, con su aviso de simulación referencial.</p>
      <div className="grid gap-1.5"><Label htmlFor="int-cliente" className="text-xs">Cliente *</Label><Input id="int-cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} /></div>
      {!credito && <p className="text-xs text-amber-800">Completa primero la simulación del crédito hipotecario (pestaña 2).</p>}
      {aviso && <p role="status" className="text-xs text-emerald-800">{aviso}</p>}
      <FieldError>{error}</FieldError>
      <Button disabled={!credito || cliente.trim().length < 3 || enviando} onClick={() => void generar()}>{enviando ? <Loader2 className="animate-spin" /> : <FileText />}{datos ? 'Guardar y descargar PDF' : 'Descargar PDF (borrador)'}</Button>
    </section>
  )
}

function Caja({ titulo, valor, detalle, destacado }: { titulo: string; valor: string; detalle: string; destacado?: boolean }) {
  return (
    <div className={`dashboard-card !p-4 ${destacado ? 'ring-1 ring-primary/30' : ''}`}>
      <div className="text-[11px] text-muted-foreground">{titulo}</div>
      <div className={`mt-1 font-semibold tabular-nums tracking-tight ${destacado ? 'text-2xl text-primary' : 'text-lg'}`}>{valor}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detalle}</div>
    </div>
  )
}
