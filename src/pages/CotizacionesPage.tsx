import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Download, FileText } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { crearCotizacion, ESTADOS_COTIZABLES, validarCotizacion, type DatosPersona } from '@/features/cotizaciones/cotizacion'
import { descargarCotizacionPdf } from '@/features/cotizaciones/pdf'
import { guardarAsesor, leerAsesor, useCotizaciones } from '@/features/cotizaciones/store'
import { fmtFechaCorta, generarPlan, hoyGuayaquil } from '@/features/financiamiento/plan'
import UnitPicker from '@/features/inventario/components/UnitPicker'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ETAPAS } from '@/features/clientes/model'
import { clientesVisibles, vincularCotizacion } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import { useReservaFlujo } from '@/features/reservas/flujo'
import { Link } from 'react-router-dom'
import { useInventory } from '@/features/inventario/store'

const CLIENTE_VACIO: DatosPersona = { nombre: '', documento: '', email: '', telefono: '' }

export default function CotizacionesPage() {
  const { state } = useInventory()
  const { actor, can } = useSession()
  const [params] = useSearchParams()
  const { lista, agregar } = useCotizaciones()
  const { state: cs, update: updateClientes } = useClientes()
  const reservas = useReservaFlujo()
  const [avisoReserva, setAvisoReserva] = useState<string | null>(null)
  const registrados = clientesVisibles(cs.clientes, actor).filter((c) => c.etapa !== 'perdido')
  const [codigo, setCodigo] = useState(params.get('unidad') ?? '')
  const [clienteId, setClienteId] = useState(() => (registrados.some((c) => c.id === params.get('cliente')) ? params.get('cliente')! : ''))
  const desdeRegistro = (id: string): DatosPersona => {
    const c = cs.clientes.find((x) => x.id === id)
    return c ? { nombre: c.nombre, documento: '', email: c.email, telefono: c.telefono } : CLIENTE_VACIO
  }
  const [cliente, setCliente] = useState<DatosPersona>(() => (clienteId ? desdeRegistro(clienteId) : CLIENTE_VACIO))
  const [asesor, setAsesor] = useState<DatosPersona>(() => leerAsesor())
  const [descuento, setDescuento] = useState(params.get('descuento') ?? '0')
  const [vigencia, setVigencia] = useState('')
  const [fecha, setFecha] = useState(params.get('fecha') ?? hoyGuayaquil())
  const [observaciones, setObservaciones] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [generando, setGenerando] = useState(false)

  const puedeDescontar = can('cotizaciones.descuento')
  const unit = state.units.find((u) => u.codigo === codigo)
  const input = {
    codigo, cliente, asesor, fecha, observaciones, clienteId: clienteId || undefined,
    descuentoPct: puedeDescontar ? Number(descuento.replace(',', '.')) || 0 : 0,
    vigenciaDias: Number(vigencia),
  }
  const errores = validarCotizacion(input, unit, actor)
  const plan = useMemo(() => {
    if (!unit) return null
    try { return generarPlan(unit, state.params, { descuentoPct: input.descuentoPct, fechaReserva: fecha }) } catch { return null }
  }, [unit, state.params, input.descuentoPct, fecha])

  async function generar() {
    setError(null); setOk(null); setGenerando(true)
    try {
      const c = crearCotizacion(state, input, actor, lista)
      agregar(c)
      guardarAsesor(asesor)
      if (c.clienteId) updateClientes((s) => vincularCotizacion(s, c.clienteId!, { numero: c.numero, codigo: c.unidad.codigo, precioFinal: c.plan.precioFinal }, actor))
      await descargarCotizacionPdf(c)
      setOk(`Cotización ${c.numero} generada para ${c.cliente.nombre}.`)
      if (!c.clienteId) setCliente(CLIENTE_VACIO)
      setObservaciones('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerando(false)
    }
  }

  if (!can('cotizaciones.crear')) return <PageHeader title="Cotizaciones" subtitle="Tu rol no puede emitir cotizaciones." />

  return (
    <>
      <PageHeader eyebrow="Ventas · Cotizaciones" title="Cotizaciones" subtitle="Genera una cotización en PDF con precio, condiciones de pago, cronograma y vigencia." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="dashboard-card p-5 grid content-start gap-5" aria-label="Datos de la cotización">
          <div className="grid gap-3 sm:grid-cols-2">
            <UnitPicker id="cot-unidad" units={state.units} params={state.params} value={codigo} onChange={setCodigo} permitidos={ESTADOS_COTIZABLES} />
            <Campo id="cot-fecha" label="Fecha de la cotización (inicio del cronograma)" type="date" value={fecha} onChange={setFecha} />
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Cliente</legend>
            <Select value={clienteId || 'ninguno'} onValueChange={(v) => { const id = v === 'ninguno' ? '' : v; setClienteId(id); setCliente(id ? desdeRegistro(id) : CLIENTE_VACIO) }}>
              <SelectTrigger aria-label="Cliente registrado" className="h-9 w-full sm:max-w-md"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguno">Sin vincular a un cliente registrado</SelectItem>
                {registrados.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre} · {ETAPAS[c.etapa].label}</SelectItem>)}
              </SelectContent>
            </Select>
            {clienteId && <p className="text-[11px] text-muted-foreground">La cotización quedará en el historial del cliente y lo moverá a la etapa Cotización si estaba antes.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="cli-nombre" label="Nombre completo *" value={cliente.nombre} onChange={(v) => setCliente({ ...cliente, nombre: v })} />
              <Campo id="cli-doc" label="Cédula o RUC" value={cliente.documento ?? ''} onChange={(v) => setCliente({ ...cliente, documento: v })} />
              <Campo id="cli-email" label="Correo" type="email" value={cliente.email} onChange={(v) => setCliente({ ...cliente, email: v })} />
              <Campo id="cli-tel" label="Teléfono" value={cliente.telefono} onChange={(v) => setCliente({ ...cliente, telefono: v })} />
            </div>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Asesor</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo id="ase-nombre" label="Nombre *" value={asesor.nombre} onChange={(v) => setAsesor({ ...asesor, nombre: v })} />
              <Campo id="ase-email" label="Correo" type="email" value={asesor.email} onChange={(v) => setAsesor({ ...asesor, email: v })} />
              <Campo id="ase-tel" label="Teléfono" value={asesor.telefono} onChange={(v) => setAsesor({ ...asesor, telefono: v })} />
            </div>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold">Condiciones</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Campo id="cot-vigencia" label="Vigencia (días) *" value={vigencia} onChange={setVigencia} inputMode="numeric" />
                <div className="flex gap-1.5">{[8, 15, 30].map((d) => <Button key={d} type="button" size="xs" variant="outline" onClick={() => setVigencia(String(d))}>{d} días</Button>)}</div>
              </div>
              {puedeDescontar
                ? <Campo id="cot-desc" label="Descuento autorizado (%)" value={descuento} onChange={setDescuento} inputMode="decimal" />
                : <p className="self-end rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">Los descuentos los autoriza gerencia.</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cot-obs" className="text-xs">Observaciones para el cliente</Label>
              <Textarea id="cot-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
            </div>
          </fieldset>
          <FieldError>{error}</FieldError>
          {ok && <p role="status" className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="size-4" />{ok}</p>}
        </section>

        <aside className="grid content-start gap-4">
          <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="cot-resumen">
            <h2 id="cot-resumen" className="text-sm font-semibold">Resumen</h2>
            {plan && unit ? (
              <dl className="mt-3 grid gap-2 text-xs">
                <Fila t="Departamento" v={`${unit.dpt} · ${unit.tipologia}`} />
                <Fila t="Precio de lista" v={fmtUsd(plan.precioLista)} />
                {plan.descuentoPct > 0 && <Fila t={`Descuento ${plan.descuentoPct}%`} v={`− ${fmtUsd2(plan.descuentoMonto)}`} />}
                <Fila t="Precio final" v={fmtUsd(plan.precioFinal)} fuerte />
                <Fila t={`Reserva ${plan.reservaPct}%`} v={fmtUsd2(plan.reserva)} />
                <Fila t={`${plan.meses} cuotas`} v={fmtUsd2(plan.cuotaMensual)} />
                <Fila t={`Contra entrega ${plan.entregaPct}%`} v={fmtUsd2(plan.contraEntrega)} />
                {unit.estado === 'por_confirmar' && <p className="mt-1 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">El PDF indicará que la disponibilidad está sujeta a confirmación.</p>}
              </dl>
            ) : <p className="mt-2 text-xs text-muted-foreground">Selecciona un departamento.</p>}
            <Button className="mt-4 w-full" onClick={generar} disabled={errores.length > 0 || generando}><FileText />{generando ? 'Generando…' : 'Generar PDF'}</Button>
            {errores.length > 0 && unit && <ul className="mt-2 list-disc pl-4 text-[11px] text-muted-foreground">{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
          </section>

          <section className="dashboard-card p-5 [&_.section-heading]:p-0" aria-labelledby="cot-hist">
            <h2 id="cot-hist" className="text-sm font-semibold">Cotizaciones emitidas</h2>
            {avisoReserva && <p role="status" className="mt-2 rounded-md bg-muted px-2 py-1.5 text-[11px]">{avisoReserva} {avisoReserva.startsWith('Solicitud') && <Link className="text-primary hover:underline" to="/reservas">Ver reservas</Link>}</p>}
            {lista.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Aún no hay cotizaciones.</p> : (
              <ul className="mt-2 grid max-h-80 gap-1.5 overflow-auto">
                {lista.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.numero} · {c.unidad.dpt}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{c.cliente.nombre} · {fmtUsd(c.plan.precioFinal)} · vence {fmtFechaCorta(c.validaHasta)}</div>
                    </div>
                    {c.clienteId && can('reservas.solicitar') && (
                      <Button size="xs" variant="outline" onClick={() => { setAvisoReserva(null); try { reservas.solicitar(c); setAvisoReserva(`Solicitud de reserva creada para ${c.numero}. Pendiente de verificación de pago.`) } catch (e) { setAvisoReserva((e as Error).message) } }}>Solicitar reserva</Button>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label={`Descargar ${c.numero}`} onClick={() => descargarCotizacionPdf(c)}><Download /></Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

function Campo({ id, label, value, onChange, type = 'text', inputMode }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; inputMode?: 'numeric' | 'decimal' }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </div>
  )
}

function Fila({ t, v, fuerte }: { t: string; v: string; fuerte?: boolean }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t}</dt><dd className={`tabular-nums ${fuerte ? 'text-base font-semibold text-primary' : 'font-medium'}`}>{v}</dd></div>
}
