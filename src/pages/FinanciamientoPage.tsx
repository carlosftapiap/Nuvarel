import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { AlertTriangle, ArrowLeft, Download, FileText, Landmark, Loader2, Plus, Scale, Trash2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { clientesVisibles } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import type { EntradaCalculada } from '@/features/cobranza/entrada'
import type { Datos } from '@/features/conexion/datos'
import { ESTADOS_COTIZABLES } from '@/features/cotizaciones/cotizacion'
import CuotasExtraordinarias, { filasAParam } from '@/features/financiamiento/components/CuotasExtraordinarias'
import { textoCuotas } from '@/features/financiamiento/components/ResumenFinanciero'
import { calcularCondiciones, type Calculo, type CondicionesFinanciamiento, type CreditoCondiciones } from '@/features/financiamiento/condiciones'
import { simularHipoteca, type Amortizacion, type CondicionesManuales, type ProductoHipotecario, type Simulacion, type Tramo } from '@/features/financiamiento/hipoteca'
import { descargarPdfIntegral } from '@/features/financiamiento/pdfIntegral'
import { cronogramaPorMes, DESCUENTO_MAX, fechaCuota, fmtFechaCorta, hoyGuayaquil, type PlanFinanciamiento } from '@/features/financiamiento/plan'
import { calendarioCuotas, DIA_PAGO_PREDETERMINADO, DIAS_PAGO, etiquetaDiaPago, vencimientos as calcularVencimientos, type DiaPago } from '@/features/financiamiento/calendario'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { EstadoBadge, FieldError, pisoLabel } from '@/features/inventario/components/shared'
import { estadoEfectivo } from '@/features/inventario/estados'
import { fmtM2, fmtUsd, fmtUsd2, RESERVA_PREDETERMINADA } from '@/features/inventario/pricing'
import type { PricingParams, Unit } from '@/features/inventario/types'
import { useInventory } from '@/features/inventario/store'
import { claveBorrador, claveSimulacion, guardarJson, leerBorrador, leerCondiciones } from '@/features/venta/borrador'
import { Destacado } from '@/features/venta/GuiaVenta'
import OperacionPanel from '@/features/venta/OperacionPanel'
import { useOperacion } from '@/features/venta/useOperacion'
import { cn } from '@/lib/utils'
import { nombreEdificio } from '@/features/inventario/nomenclatura'

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

/* -------------------------------------------------------------- pantalla */

/** Una sola pantalla de financiamiento. Con `operacion=1` trabaja sobre la operación de Atender cliente; sin ella, simula sin cliente. */
export default function FinanciamientoPage() {
  const [params] = useSearchParams()
  return params.get('operacion') === '1' ? <OperacionFinanciamiento /> : <SimulacionFinanciamiento />
}

function OperacionFinanciamiento() {
  const { actor, can } = useSession()
  const hoy = hoyGuayaquil()
  const [b, setB] = useState(() => leerBorrador(actor.id, hoy))
  useEffect(() => guardarJson(claveBorrador(actor.id), b), [b, actor.id])
  const op = useOperacion(b, setB, can('cotizaciones.descuento'))
  const [credito, setCredito] = useState<Simulacion | null>(null)
  const { cliente, unit, cotizacion, bloqueada, calc } = op
  const nombreCliente = cliente?.nombre ?? cotizacion?.cliente.nombre ?? null

  const confirmacion = cotizacion ? (
    <p className="rounded-lg bg-muted px-3 py-2 text-xs">Plan de la cotización {cotizacion.numero} · versión <b>{calc.version}</b>. Para cambiarlo, crea una versión nueva desde el panel de operación.</p>
  ) : op.confirmadoVigente ? (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <CheckIcon />
      <span className="min-w-0 flex-1">Plan confirmado · versión <b>{calc.version}</b>. Ya puedes emitir la cotización.</span>
      <Button size="xs" variant="outline" onClick={op.editarPlan}>Editar financiamiento</Button>
    </div>
  ) : (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Destacado activo={op.paso.accion === 'plan' && !!calc.plan && !op.bloqueoCalculo} texto="Revisa el plan y haz clic aquí"><Button disabled={!calc.plan || !!op.bloqueoCalculo || !unit} onClick={op.confirmarPlan}><FileText />Usar este plan y continuar cotización</Button></Destacado>
        {!calc.plan && <span className="text-xs text-muted-foreground">Elige un departamento para calcular el plan.</span>}
        {calc.plan && op.bloqueoCalculo && <span className="text-xs text-rose-700">Corrige el plan para confirmarlo.</span>}
      </div>
      {op.precioCambio && op.planConfirmado && calc.plan && (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          El precio del departamento cambió de {fmtUsd2(op.planConfirmado.precioFinal)} a {fmtUsd2(calc.plan.precioFinal)} desde que confirmaste el plan. Revisa las condiciones y confirma de nuevo.
        </p>
      )}
      {op.planConfirmado && !op.confirmadoVigente && !op.precioCambio && (
        <p role="status" className="text-xs text-amber-800">Cambiaste las condiciones desde la confirmación. Confirma el plan de nuevo para emitir.</p>
      )}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow="Ventas · Financiamiento" title="Financiamiento de la operación"
        subtitle={`${nombreCliente ?? 'Cliente pendiente'} · ${unit ? `Departamento ${unit.dpt}` : 'Departamento pendiente'}. Plan, operación y cotización en una sola pantalla.`}
        actions={<>
          {calc.entrada && unit && <Button variant="outline" size="sm" onClick={() => exportar(calc.entrada!, unit, op.condiciones.fecha, credito, calc.plan?.vencimientos)}><Download />Excel</Button>}
          <Button asChild variant="outline" size="sm"><Link to="/venta"><ArrowLeft />Atender cliente</Link></Button>
        </>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-4">
          {op.otraReserva && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              <span className="min-w-0 flex-1">Esta unidad ya tiene la solicitud {op.otraReserva.codigo}. No admite otra reserva.</span>
              {op.otraReserva.cotizacionId && op.otraReserva.cotizacionId !== b.cotizacionId && <Button size="xs" variant="outline" onClick={() => op.retomar(op.otraReserva!.cotizacionId!)}>Continuar operación</Button>}
            </div>
          )}
          <section className="dashboard-card grid gap-4 p-5" aria-label="Condiciones del plan">
            <CondicionesForm unit={unit} params={op.inv.params} precioFinal={calc.plan?.precioFinal ?? null} valor={op.condiciones} soloLectura={bloqueada} reservaBloqueada={!!op.reserva} puedeDescontar={can('cotizaciones.descuento')}
              onChange={(c) => setB((x) => ({ ...x, financiamiento: bloqueada ? { ...x.financiamiento, reserva: c.reserva } : c }))}
              vigencia={{ valor: cotizacion ? String(cotizacion.vigenciaDias) : b.vigencia, onChange: (v) => setB((x) => ({ ...x, vigencia: v })) }}
              observaciones={{ valor: cotizacion ? cotizacion.observaciones : b.observaciones, onChange: (v) => setB((x) => ({ ...x, observaciones: v })) }}
              unitPicker={!bloqueada ? <UnitPicker id="fin-unidad" label="Departamento" units={op.inv.units} params={op.inv.params} value={op.codigo} onChange={(v) => setB((x) => ({ ...x, codigo: v, planConfirmado: null }))} permitidos={ESTADOS_COTIZABLES} soloPermitidos /> : null} />
          </section>
          <PanelFinanciamiento calc={calc} unit={unit} condiciones={op.condiciones} credito={credito} onSimulacion={setCredito}
            onCredito={(c) => setB((x) => ({ ...x, financiamiento: { ...x.financiamiento, credito: c } }))} confirmacion={confirmacion} asesor={actor.nombre} />
        </div>
        <aside className="grid content-start gap-4 xl:sticky xl:top-4 xl:self-start">
          <OperacionPanel op={op} />
        </aside>
      </div>
    </>
  )
}

function SimulacionFinanciamiento() {
  const { state } = useInventory()
  const { can, actor } = useSession()
  const { state: cs } = useClientes()
  const [params, setParams] = useSearchParams()
  const hoy = hoyGuayaquil()
  const codigo = params.get('unidad') ?? ''
  const unit = state.units.find((u) => u.codigo === codigo)
  const [cond, setCond] = useState(() => leerCondiciones(claveSimulacion(actor.id), hoy))
  useEffect(() => guardarJson(claveSimulacion(actor.id), cond), [cond, actor.id])
  const puedeDescontar = can('cotizaciones.descuento')
  const calc = useMemo(() => calcularCondiciones(unit, state.params, cond, puedeDescontar), [unit, state.params, cond, puedeDescontar])
  const [credito, setCredito] = useState<Simulacion | null>(null)

  return (
    <>
      <PageHeader eyebrow="Ventas · Financiamiento" title="Simulador de financiamiento"
        subtitle="Entrada del 20% a favor de Nuvarel y crédito hipotecario del 80% del comprador. Una simulación no crea deuda ni es una aprobación bancaria."
        actions={calc.entrada && unit && <>
          <Button variant="outline" size="sm" onClick={() => exportar(calc.entrada!, unit, cond.fecha, credito, calc.plan?.vencimientos)}><Download />Excel</Button>
          {can('cotizaciones.crear') && <Button size="sm" variant="outline" asChild><Link to={`/cotizaciones?unidad=${encodeURIComponent(codigo)}&fecha=${cond.fecha}${cond.extras.length && !calc.errorExtras ? `&extras=${filasAParam(cond.extras)}` : ''}`}><FileText />Crear cotización</Link></Button>}
        </>} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <section className="dashboard-card grid content-start gap-4 p-5" aria-label="Datos de la simulación">
            <CondicionesForm unit={unit} params={state.params} precioFinal={calc.plan?.precioFinal ?? null} valor={cond} onChange={setCond} puedeDescontar={puedeDescontar} vertical
              unitPicker={<UnitPicker id="fin-unidad" units={state.units} params={state.params} value={codigo}
                onChange={(c) => setParams((p) => { p.set('unidad', c); return p }, { replace: true })} />} />
          </section>
          {unit && can('cotizaciones.crear') && <VincularCliente unit={unit} condiciones={cond} clientes={clientesVisibles(cs.clientes, actor).filter((c) => c.etapa !== 'perdido')} />}
        </div>
        <PanelFinanciamiento calc={calc} unit={unit} condiciones={cond} credito={credito} onSimulacion={setCredito} onCredito={(c) => setCond((x) => ({ ...x, credito: c }))} confirmacion={null} asesor={actor.nombre} />
      </div>
    </>
  )
}

/** Vincula la simulación a una operación: conserva las condiciones y abre el mismo plan en la operación. */
function VincularCliente({ unit, condiciones, clientes }: { unit: Unit; condiciones: CondicionesFinanciamiento; clientes: { id: string; nombre: string }[] }) {
  const { actor } = useSession()
  const navigate = useNavigate()
  const [clienteId, setClienteId] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <section aria-label="Vincular a una operación" className="dashboard-card grid gap-3 p-5">
      <h2 className="text-sm font-semibold">Usar esta simulación en una venta</h2>
      <div className="grid gap-1.5">
        <Label htmlFor="sim-cliente" className="text-xs">Cliente</Label>
        <select id="sim-cliente" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
          <option value="">Elige un cliente</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <FieldError>{error}</FieldError>
      <Button size="sm" disabled={!clienteId} onClick={() => {
        // Se guarda antes de cambiar de pantalla: la operación lee las condiciones al abrirse.
        const hoy = hoyGuayaquil()
        const previo = leerBorrador(actor.id, hoy)
        if (previo.cotizacionId) { setError('Ya tienes abierta una operación con cotización. En Atender cliente, elige «Atender a otro cliente».'); return }
        guardarJson(claveBorrador(actor.id), { ...previo, clienteId, codigo: unit.codigo, financiamiento: condiciones, planConfirmado: null })
        navigate('/financiamiento?operacion=1')
      }}>Vincular y abrir la operación</Button>
    </section>
  )
}

/* ---------------------------------------------------- condiciones del plan */

interface CondicionesProps {
  unit: Unit | undefined
  params: PricingParams
  valor: CondicionesFinanciamiento
  onChange: (c: CondicionesFinanciamiento) => void
  puedeDescontar: boolean
  soloLectura?: boolean
  reservaBloqueada?: boolean
  vertical?: boolean
  precioFinal: number | null
  vigencia?: { valor: string; onChange: (v: string) => void }
  observaciones?: { valor: string; onChange: (v: string) => void }
  unitPicker: ReactNode
}

function CondicionesForm({ unit, params, valor, onChange, puedeDescontar, soloLectura = false, reservaBloqueada = soloLectura, vertical = false, precioFinal, vigencia, observaciones, unitPicker }: CondicionesProps) {
  const set = <K extends keyof CondicionesFinanciamiento>(k: K, v: CondicionesFinanciamiento[K]) => onChange({ ...valor, [k]: v })
  const diaPago = valor.diaPago ?? DIA_PAGO_PREDETERMINADO
  const calendario = unit ? (() => {
    try {
      const c = calendarioCuotas(valor.fecha, params.meses[unit.edificio], params.inicioCuotas)
      return { meses: c.meses, fechas: calcularVencimientos(c, diaPago, valor.fecha) }
    } catch { return null }
  })() : null
  // Cambiar la fecha, el día o el departamento cambia el calendario: el comprador debe volver a aceptarlo.
  const cambiar = (cambio: Partial<CondicionesFinanciamiento>) => onChange({ ...valor, ...cambio, calendarioAceptado: false })
  return (
    <div className={cn('grid gap-4', !vertical && 'sm:grid-cols-2 xl:grid-cols-4')}>
      <div className={cn(!vertical && 'xl:col-span-1', 'grid content-start gap-3')}>{unitPicker}</div>
      <div className="grid gap-1.5">
        <Label htmlFor="fin-firma" className="text-xs">Fecha de firma</Label>
        <Input id="fin-firma" type="date" value={valor.fecha} disabled={soloLectura} onChange={(e) => cambiar({ fecha: e.target.value })} className="h-9" />
        <p className="text-xs text-muted-foreground">Las cuotas de entrada van del mes de firma al mes final del edificio.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fin-dia-pago" className="text-xs">¿Qué día del mes desea pagar sus cuotas? *</Label>
        <select id="fin-dia-pago" required disabled={soloLectura} value={diaPago} onChange={(e) => cambiar({ diaPago: e.target.value as DiaPago })} className="h-9 rounded-md border border-border bg-white px-2 text-sm">
          {DIAS_PAGO.map((d) => <option key={d} value={d}>{d === 'ultimo' ? 'Último día del mes' : `Día ${d}`}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">{etiquetaDiaPago(diaPago)}.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fin-reserva" className="text-xs">Reserva (USD)</Label>
        <Input id="fin-reserva" inputMode="decimal" value={valor.reserva ?? ''} disabled={reservaBloqueada} placeholder={String(params.reservaPredeterminada ?? RESERVA_PREDETERMINADA)} onChange={(e) => set('reserva', e.target.value === '' ? null : e.target.value)} className="h-9" />
        <p className="text-xs text-muted-foreground">Monto que paga el cliente al reservar. Se acredita al pago a la firma del 6 %; no se cobra dos veces.</p>
      </div>
      {puedeDescontar ? (
        <div className="grid gap-1.5">
          <Label htmlFor="fin-desc" className="text-xs">Descuento autorizado (%)</Label>
          <Input id="fin-desc" inputMode="decimal" value={valor.descuento} disabled={soloLectura} onChange={(e) => set('descuento', e.target.value)} className="h-9" />
          <p className="text-xs text-muted-foreground">Máximo técnico {DESCUENTO_MAX}%. Úsalo solo con autorización.</p>
        </div>
      ) : <p className="self-end rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Los descuentos los autoriza gerencia.</p>}
      {vigencia && (
        <div className="grid gap-1.5">
          <Label htmlFor="ve-vigencia" className="text-xs">Vigencia de la cotización (días)</Label>
          <Input id="ve-vigencia" inputMode="numeric" className="h-9" disabled={soloLectura} value={vigencia.valor} onChange={(e) => vigencia.onChange(e.target.value)} />
        </div>
      )}
      {observaciones && (
        <div className="grid gap-1.5 sm:col-span-2 xl:col-span-4">
          <Label htmlFor="ve-obs" className="text-xs">Observaciones para el cliente</Label>
          <textarea id="ve-obs" rows={2} disabled={soloLectura} value={observaciones.valor} onChange={(e) => observaciones.onChange(e.target.value)} className="rounded-md border border-border bg-white p-2 text-sm" />
        </div>
      )}
      {unit && (
        <div className={cn('rounded-lg border border-border p-3 text-xs', !vertical && 'sm:col-span-2 xl:col-span-4')}>
          <div className="flex items-center justify-between gap-2"><b>Departamento {unit.dpt}</b><EstadoBadge estado={estadoEfectivo(unit)} /></div>
          <p className="mt-1 text-muted-foreground">{nombreEdificio(unit.edificio)} · {pisoLabel(unit.piso)} · {unit.tipologia} · {fmtM2(unit.areaM2 + unit.bodegaM2)}</p>
          {precioFinal !== null && <p className="mt-2 text-sm font-semibold text-primary">Precio final {fmtUsd(precioFinal)}</p>}
        </div>
      )}
      {unit && (
        <div className={cn('grid gap-2', !vertical && 'sm:col-span-2 xl:col-span-4')}>
          <CuotasExtraordinarias filas={valor.extras} onChange={(f) => set('extras', f)} meses={calendario?.meses ?? params.meses[unit.edificio]} fechaBase={valor.fecha} vencimientos={calendario?.fechas ?? undefined} soloLectura={soloLectura} />
        </div>
      )}
      {unit && calendario?.fechas && (
        <CalendarioPagos fechaFirma={valor.fecha} diaPago={diaPago} meses={calendario.meses} fechas={calendario.fechas}
          aceptado={!!valor.calendarioAceptado} onAceptar={soloLectura ? undefined : (v) => set('calendarioAceptado', v)} className={cn(!vertical && 'sm:col-span-2 xl:col-span-4')} />
      )}
    </div>
  )
}

/** Calendario resultante: cuotas que quedan, primera y última fecha, advertencia si el día ya pasó y aceptación expresa. */
export function CalendarioPagos({ fechaFirma, diaPago, meses, fechas, aceptado, onAceptar, className }: { fechaFirma: string; diaPago: DiaPago; meses: number; fechas: string[]; aceptado: boolean; onAceptar?: (v: boolean) => void; className?: string }) {
  const enFirma = diaPago !== 'ultimo' && fechas[0] === fechaFirma && Number(diaPago) < Number(fechaFirma.slice(8))
  return (
    <div className={cn('grid gap-2 rounded-lg border border-border p-3 text-xs', className)} role="group" aria-label="Calendario de pagos">
      <p><b>{meses} cuotas mensuales</b> · primera {fmtFechaCorta(fechas[0])} · última {fmtFechaCorta(fechas[fechas.length - 1])} (fin del calendario del edificio). {etiquetaDiaPago(diaPago)}.</p>
      {enFirma && (
        <p role="alert" className="rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
          El día {diaPago} ya pasó en el mes de firma: la cuota 1 vence el {fmtFechaCorta(fechaFirma)}, el mismo día de la firma, junto con el pago a la firma.
          No cambia el número de cuotas ni sus montos. Desde la cuota 2 vencen el día {diaPago} de cada mes.
        </p>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={aceptado} disabled={!onAceptar} onChange={(e) => onAceptar?.(e.target.checked)} className="mt-0.5" />
        <span>El comprador acepta este calendario de pagos (obligatorio para emitir la cotización).</span>
      </label>
    </div>
  )
}

/* ------------------------------------------------ resumen y cálculos */

function exportar(e: EntradaCalculada, unit: Unit, fecha: string, credito: Simulacion | null, vencimientos?: string[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(e.partidas.map((p, i) => ({
    'N.º': i, Concepto: p.concepto, Fecha: p.tipo === 'reserva' ? 'Al reservar' : p.tipo === 'firma' ? fmtFechaCorta(fecha) : p.mes ? fmtFechaCorta(fechaCuota({ vencimientos }, fecha, p.mes)) : 'A la entrega',
    'Monto (USD)': p.monto,
  }))), 'Entrada 20%')
  if (credito) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(credito.tabla.map((r) => ({
      'N.º': r.n, Capital: r.capital, Interés: r.interes, Desgravamen: r.desgravamen ?? 'Sin dato', Incendio: r.incendio ?? 'Sin dato', Cuota: r.cuota, Saldo: r.saldo,
    }))), 'Crédito 80%')
  }
  XLSX.writeFile(wb, `AMURA_financiamiento_${unit.dpt}_${fecha}.xlsx`)
}

interface PanelProps {
  calc: Calculo
  unit: Unit | undefined
  condiciones: CondicionesFinanciamiento
  onCredito: (c: CreditoCondiciones) => void
  credito: Simulacion | null
  onSimulacion: (s: Simulacion | null) => void
  confirmacion: ReactNode
  asesor: string
}

function PanelFinanciamiento({ calc, unit, condiciones, onCredito, credito, onSimulacion, confirmacion, asesor }: PanelProps) {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  const [productos, setProductos] = useState<ProductoHipotecario[]>([])
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState(false)
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

  const { plan, entrada: e } = calc
  const fecha = condiciones.fecha
  const errores = [calc.error, calc.errorExtras, calc.errorReserva].filter(Boolean) as string[]

  if (!plan || !e || !unit) {
    return (
      <div className="grid content-start gap-4">
        {plan && unit
          ? <>{confirmacion}<div className="module-empty"><h2 className="text-lg font-semibold">Corrige las condiciones del plan</h2><p className="mt-2 text-sm text-muted-foreground">Con estos valores no se puede calcular la entrada.</p></div></>
          : <div className="module-empty"><h2 className="text-lg font-semibold">Selecciona un departamento</h2><p className="mt-2 text-sm text-muted-foreground">Verás la entrada del 20%, el crédito hipotecario del 80% y podrás generar la cotización integral.</p></div>}
        <FieldError>{errores.join(' ')}</FieldError>
      </div>
    )
  }
  const cuotas = e.partidas.filter((p) => p.tipo === 'cuota').length
  return (
    <div className="grid min-w-0 content-start gap-4">
      <section aria-label="Resumen financiero" className="grid gap-3">
        <h2 className="text-sm font-semibold">Resumen del plan</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <Caja titulo="Valor total del departamento" valor={fmtUsd2(plan.precioFinal)} detalle={plan.descuentoPct > 0 ? `Incluye descuento de ${plan.descuentoPct} %` : `Precio ${fmtUsd(plan.precioLista)} sin descuento`} />
          <Caja titulo="Reserva y pago a la firma" valor={fmtUsd2(calc.reserva)} detalle={`Pago adicional a la firma ${fmtUsd2(e.pagoFirma)}`} />
          <Caja titulo="Entrada del 20 %" valor={fmtUsd2(e.entradaTotal)} detalle="A favor de Nuvarel" destacado />
          <Caja titulo="Cuotas ordinarias y extraordinarias" valor={fmtUsd2(e.saldoCuotas)} detalle={`${cuotas} cuotas de ${fmtUsd2(e.cuotaMensual)}${e.extraordinarias.length ? ` + ${e.extraordinarias.length} extraordinarias` : ''}`} />
          <Caja titulo="Saldo del 80 % para crédito" valor={fmtUsd2(e.saldoEntrega)} detalle="Crédito hipotecario" />
        </div>
        {confirmacion}
        <FieldError>{errores.join(' ')}</FieldError>
      </section>

      <Tabs defaultValue="entrada" className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto overflow-y-hidden">
          <TabsTrigger value="entrada">1. Entrada del 20%</TabsTrigger>
          <TabsTrigger value="credito">2. Crédito hipotecario 80%</TabsTrigger>
          <TabsTrigger value="pdf">3. Cotización integral</TabsTrigger>
        </TabsList>
        <TabsContent value="entrada" className="min-w-0"><Entrada e={e} fechaFirma={fecha} plan={plan} /></TabsContent>
        <TabsContent value="credito" className="min-w-0">
          <Credito valor={condiciones.credito} onChange={onCredito} precio={plan.precioFinal} entrada={e.entradaTotal}
            productos={productos} remoto={remoto} errorCatalogo={errorCatalogo} puedeCatalogo={can('financiamiento.catalogo')} datos={datos}
            onSimulacion={onSimulacion} onAbrirCatalogo={() => setCatalogo(true)} />
        </TabsContent>
        <TabsContent value="pdf" className="min-w-0">
          <Integral unit={unit} precio={plan.precioFinal} fechaFirma={fecha} vencimientos={plan.vencimientos} entrada={e} credito={credito} asesor={asesor} datos={remoto ? datos : null} />
        </TabsContent>
      </Tabs>
      {catalogo && datos && <CatalogoDialog datos={datos} productos={productos} onClose={() => setCatalogo(false)} onGuardado={cargarCatalogo} />}
    </div>
  )
}

/* ------------------------------------------------------- 1. entrada del 20% */

function Entrada({ e, fechaFirma, plan }: { e: EntradaCalculada; fechaFirma: string; plan: PlanFinanciamiento }) {
  const vencimientos = plan.vencimientos
  const cuotas = e.partidas.filter((p) => p.tipo === 'cuota')
  const meses = cronogramaPorMes({ meses: cuotas.length, cuotaMensual: e.cuotaMensual, ultimaCuota: e.ultimaCuota, extraordinarias: e.extraordinarias, vencimientos }, fechaFirma)
  return (
    <div className="grid gap-4">
      {(() => {
        // Al firmar se pagan por separado el complemento del 6 % (descontada la reserva) y, si vence ese día, la cuota 1.
        const cuota1 = plan.cuotaEnFirma ? meses[0]?.total ?? 0 : 0
        return (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" role="group" aria-label="Pago al firmar">
            <p className="font-semibold">Al firmar ({fmtFechaCorta(fechaFirma)}) el comprador paga {fmtUsd2(e.pagoFirma + cuota1)}</p>
            <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
              <li>Pago a la firma (completa el 6 %, descontada la reserva ya abonada): {fmtUsd2(e.pagoFirma)}</li>
              {cuota1 > 0 && <li>Cuota 1 de {cuotas.length} del diferido, que vence el mismo día porque el día de pago elegido ya pasó: {fmtUsd2(cuota1)}</li>}
            </ul>
            {vencimientos && <p className="mt-1 text-xs">{cuotas.length} cuotas hasta el {fmtFechaCorta(vencimientos[vencimientos.length - 1])}.</p>}
          </div>
        )
      })()}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Caja titulo="Entrada total (20%)" valor={fmtUsd2(e.entradaTotal)} detalle="A favor de Nuvarel" destacado />
        <Caja titulo="Pago adicional a la firma" valor={fmtUsd2(e.pagoFirma)} detalle={`Completa el 6% (${fmtUsd2(e.acumuladoFirma)}) · ${fmtFechaCorta(fechaFirma)}`} />
        <Caja titulo={`Cuotas de entrada`} valor={textoCuotas({ meses: cuotas.length, cuotaMensual: e.cuotaMensual, ultimaCuota: e.ultimaCuota })} detalle={e.extraordinarias.length ? `Más ${e.extraordinarias.length} extraordinarias · total ${fmtUsd2(e.saldoCuotas)}` : `Total ${fmtUsd2(e.saldoCuotas)}`} />
        <Caja titulo="Saldo contra entrega (80%)" valor={fmtUsd2(e.saldoEntrega)} detalle="Normalmente con crédito hipotecario" />
      </div>
      <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="crono">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="crono" className="text-sm font-semibold">Cronograma de pagos</h2>
          <span className="text-xs text-muted-foreground">Simulación: la deuda se activa al firmar</span>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Concepto</th>
                <th className="px-2 py-2 text-left font-medium">Fecha</th>
                <th className="px-2 py-2 text-right font-medium">Cuota mensual</th>
                <th className="px-2 py-2 text-right font-medium">Extraordinaria</th>
                <th className="px-4 py-2 text-right font-medium">Total del mes</th>
              </tr>
            </thead>
            <tbody>
              {e.partidas.filter((p) => p.tipo !== 'extraordinaria').map((p, i) => {
                const extra = p.mes ? meses[p.mes - 1].extraordinaria : 0
                return (
                  <tr key={i} className={cn('border-t border-border', (p.tipo !== 'cuota' || extra > 0) && 'bg-secondary/40 font-medium')}>
                    <td className="px-4 py-1.5">{p.concepto}</td>
                    <td className="px-2 py-1.5 tabular-nums">{p.tipo === 'reserva' ? 'Al reservar' : p.tipo === 'firma' ? fmtFechaCorta(fechaFirma) : p.mes ? fmtFechaCorta(fechaCuota({ vencimientos }, fechaFirma, p.mes)) : 'A la entrega'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{p.tipo === 'cuota' ? fmtUsd2(p.monto) : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{extra > 0 ? fmtUsd2(extra) : ''}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsd2(p.monto + extra)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">La reserva se acredita al pago a la firma del 6 %. La última cuota ajusta los centavos para que el total sea exacto.</p>
    </div>
  )
}

/* ------------------------------------------------- 2. crédito hipotecario 80% */

interface CreditoProps {
  valor: CreditoCondiciones
  onChange: (c: CreditoCondiciones) => void
  precio: number
  entrada: number
  productos: ProductoHipotecario[]
  remoto: boolean
  errorCatalogo: string | null
  puedeCatalogo: boolean
  datos: Datos | null
  onSimulacion: (s: Simulacion | null) => void
  onAbrirCatalogo: () => void
}

function Credito({ valor, onChange, precio, entrada, productos, remoto, errorCatalogo, puedeCatalogo, datos, onSimulacion, onAbrirCatalogo }: CreditoProps) {
  const [todas, setTodas] = useState(false)
  const [comparar, setComparar] = useState<Simulacion[]>([])
  const set = <K extends keyof CreditoCondiciones>(k: K) => (v: CreditoCondiciones[K]) => onChange({ ...valor, [k]: v })

  const producto = productos.find((p) => p.id === valor.productoId) ?? null
  const plazoMeses = (Number(valor.anios) || 0) * 12 + (Number(valor.meses) || 0)
  const sim = useMemo(() => {
    try {
      const manual: CondicionesManuales | null = producto ? null : (() => {
        const t = numero(valor.tasa)
        if (t === null) throw new Error('Ingresa la tasa del escenario manual o elige un producto del catálogo.')
        return { tasa: t, tasaEs: valor.tasaEs, tipoTasa: valor.tipoTasa, desgravamenPctMensual: numero(valor.desgravamen), incendioPctAnual: numero(valor.incendio), gastosFijos: numero(valor.gastos), avaluo: numero(valor.avaluo) }
      })()
      return { s: simularHipoteca({ precio, entrada, plazoMeses, amortizacion: valor.amortizacion, producto, manual }), error: null }
    } catch (e) {
      return { s: null, error: (e as Error).message }
    }
  }, [producto, valor, precio, entrada, plazoMeses])
  useEffect(() => { onSimulacion(sim.s) }, [sim.s, onSimulacion])
  const s = sim.s

  return (
    <div className="grid gap-4">
      <section className="dashboard-card grid gap-4 p-5" aria-label="Condiciones del crédito">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="cr-prod" className="text-xs">Banco o BIESS y producto</Label>
            <select id="cr-prod" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={valor.productoId} onChange={(e) => set('productoId')(e.target.value)}>
              <option value="manual">Escenario manual (tasa y plazo personalizados)</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.entidad} · {p.producto} (v{p.version})</option>)}
            </select>
            {producto
              ? <p className="text-xs text-muted-foreground">Fuente: {producto.fuente} · {fmtFechaCorta(producto.fechaFuente)} · plazo {producto.plazoMinMeses}–{producto.plazoMaxMeses} meses{producto.tramos.length ? ' · tasa por tramos de monto y plazo' : ''}</p>
              : <p className="text-xs text-muted-foreground">{remoto ? (productos.length ? 'Escenario manual: se identifica así en la cotización.' : 'El catálogo aún no tiene productos con tasas verificadas.') : 'Sin conexión a Supabase: solo escenario manual.'}</p>}
            {errorCatalogo && <p className="text-xs text-rose-700">{errorCatalogo}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="cr-anios" className="text-xs">Plazo (años)</Label><Input id="cr-anios" inputMode="numeric" value={valor.anios} onChange={(e) => set('anios')(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-meses" className="text-xs">+ meses</Label><Input id="cr-meses" inputMode="numeric" value={valor.meses} onChange={(e) => set('meses')(e.target.value)} className="h-9" /></div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cr-amort" className="text-xs">Amortización</Label>
            <select id="cr-amort" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={valor.amortizacion} onChange={(e) => set('amortizacion')(e.target.value as Amortizacion)}>
              <option value="francesa">Francesa (cuota fija)</option>
              <option value="alemana">Alemana (capital fijo)</option>
            </select>
          </div>
        </div>
        {!producto && (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-3 xl:grid-cols-7">
            <div className="grid gap-1.5"><Label htmlFor="cr-tasa" className="text-xs">Tasa anual (%)</Label><Input id="cr-tasa" inputMode="decimal" value={valor.tasa} onChange={(e) => set('tasa')(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-tasa-es" className="text-xs">La tasa es</Label>
              <select id="cr-tasa-es" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={valor.tasaEs} onChange={(e) => set('tasaEs')(e.target.value as 'nominal' | 'efectiva')}><option value="nominal">Nominal</option><option value="efectiva">Efectiva</option></select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cr-tipo" className="text-xs">Tipo</Label>
              <select id="cr-tipo" className="h-9 rounded-md border border-border bg-white px-2 text-sm" value={valor.tipoTasa} onChange={(e) => set('tipoTasa')(e.target.value as 'fija' | 'variable')}><option value="fija">Fija</option><option value="variable">Variable</option></select>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="cr-desg" className="text-xs">Desgravamen % mensual</Label><Input id="cr-desg" inputMode="decimal" placeholder="Sin dato" value={valor.desgravamen} onChange={(e) => set('desgravamen')(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-inc" className="text-xs">Incendio % anual</Label><Input id="cr-inc" inputMode="decimal" placeholder="Sin dato" value={valor.incendio} onChange={(e) => set('incendio')(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-gastos" className="text-xs">Gastos (USD)</Label><Input id="cr-gastos" inputMode="decimal" placeholder="Sin dato" value={valor.gastos} onChange={(e) => set('gastos')(e.target.value)} className="h-9" /></div>
            <div className="grid gap-1.5"><Label htmlFor="cr-avaluo" className="text-xs">Avalúo (USD)</Label><Input id="cr-avaluo" inputMode="decimal" placeholder="Sin dato" value={valor.avaluo} onChange={(e) => set('avaluo')(e.target.value)} className="h-9" /></div>
          </div>
        )}
        <FieldError>{sim.error}</FieldError>
        {puedeCatalogo && remoto && datos && (
          <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onAbrirCatalogo}><Landmark />Catálogo bancario</Button></div>
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
          <p className="text-xs text-muted-foreground">
            Simulación referencial sujeta a aprobación bancaria. {s.escenario === 'manual' ? 'Escenario manual ingresado por el asesor.' : `Fuente ${s.fuente} del ${fmtFechaCorta(s.fechaFuente)} (versión ${s.version}).`} No se garantiza que la tasa siga vigente a la entrega.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={comparar.length >= 3} onClick={() => setComparar([...comparar, s])}><Scale />Agregar al comparador ({comparar.length}/3)</Button>
          </div>

          {comparar.length > 0 && (
            <section className="dashboard-card !p-0 overflow-x-auto" aria-label="Comparador">
              <h2 className="px-4 pt-4 text-sm font-semibold">Comparación de escenarios</h2>
              <table className="mt-3 w-full text-xs">
                <thead className="bg-muted text-xs text-muted-foreground">
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
              <p className="px-4 py-2 text-xs text-muted-foreground">* Sin seguros o gastos conocidos: el costo real será mayor.</p>
            </section>
          )}

          <section className="dashboard-card !p-0 overflow-hidden" aria-labelledby="amort">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 id="amort" className="text-sm font-semibold">Tabla de amortización</h2>
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTodas(!todas)}>{todas ? 'Ver primeras 12' : `Ver las ${s.tabla.length} cuotas`}</button>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
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
    <div className="grid gap-1"><Label htmlFor={`cat-${k}`} className="text-xs">{label}</Label><Input id={`cat-${k}`} className="h-8" value={f[k]} onChange={set(k)} {...extra} /></div>
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
          <div className="grid gap-1"><Label htmlFor="cat-tipo" className="text-xs">Tipo de tasa</Label>
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
        <div className="grid gap-1"><Label htmlFor="cat-motivo" className="text-xs">Motivo del cambio *</Label><Input id="cat-motivo" className="h-8" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
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
  vencimientos?: string[]
  entrada: EntradaCalculada
  credito: Simulacion | null
  asesor: string
  datos: Datos | null
}

function Integral({ unit, precio, fechaFirma, vencimientos, entrada, credito, asesor, datos }: IntegralProps) {
  const [cliente, setCliente] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const generar = async () => {
    if (!credito) return
    setEnviando(true); setError(null); setAviso(null)
    try {
      let numeroDoc = 'BORRADOR'
      let unidadDocumento: IntegralProps['unit'] & { edificioNombre?: string } = unit
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
        const [guardada] = await datos.select<{ unidad_snapshot: typeof unidadDocumento | null }>('mortgage_simulations', { filtros: { numero: numeroDoc } })
        if (!guardada?.unidad_snapshot) throw new Error('La simulación no tiene una instantánea de emisión. Conserva el original y solicita actualizar la base antes de generar otra.')
        unidadDocumento = guardada.unidad_snapshot
      }
      await descargarPdfIntegral({ numero: numeroDoc, fecha: hoyGuayaquil(), cliente: cliente.trim(), asesor, unidad: unidadDocumento, precioFinal: precio, fechaFirma, vencimientos, entrada, credito })
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
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className={`mt-1 font-semibold tabular-nums tracking-tight ${destacado ? 'text-2xl text-primary' : 'text-lg'}`}>{valor}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detalle}</div>
    </div>
  )
}

function CheckIcon() {
  return <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">✓</span>
}
