import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, Download, FileText, Landmark, Mail, MessageCircle, PencilLine, Phone, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { descargarCotizacionPdf } from '@/features/cotizaciones/pdf'
import { useCotizaciones } from '@/features/cotizaciones/store'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { EstadoBadge, FieldError } from '@/features/inventario/components/shared'
import { calcularPrecio, fmtUsd } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { nombreEdificio } from '@/features/inventario/nomenclatura'
import { ETAPA_ORDEN, ETAPAS, FORMAS_PAGO, ORIGENES, PROPOSITOS, TIPOS_ACTIVIDAD, type Cliente, type Etapa, type ProximaActividad } from '../model'
import { completarProxima, moverEtapa, programarProxima, registrarActividad, registrarContactoWhatsApp, urgencia } from '../service'
import { useClientes } from '../store'
import NegociacionesCliente from './NegociacionesCliente'
import DocumentosCliente from '@/features/cumplimiento/components/DocumentosCliente'
import { TrazabilidadCliente } from './Reasignaciones'
import { AVISO_PROSPECTO, CATEGORIAS, categoriaCliente } from '../categoria'
import { celularLocal } from '../celular'
import LeadsDelCliente from '@/features/leads/LeadsDelCliente'
import WhatsAppDialog from '@/features/leads/WhatsAppDialog'
import { useReservas } from '@/features/reservas/store'
import { Destacado } from '@/features/venta/GuiaVenta'
import { operacionesAbiertas } from '@/features/venta/operacion'

type TipoRegistrable = ProximaActividad['tipo']
const TIPOS: TipoRegistrable[] = ['llamada', 'mensaje', 'visita', 'nota']

export function CategoriaBadge({ cliente }: { cliente: Pick<Cliente, 'etapa' | 'documento'> }) {
  const k = CATEGORIAS[categoriaCliente(cliente)]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tracking-wide ring-1 ring-inset ${k.clase}`}>{k.label}</span>
}

export function EtapaBadge({ etapa }: { etapa: Etapa }) {
  const e = ETAPAS[etapa]
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset" style={{ color: e.color, background: `${e.color}14`, boxShadow: `inset 0 0 0 1px ${e.color}40` }}>{e.label}</span>
}

export default function ClienteSheet({ id, onClose, onEdit, onPedirEtapa, onMessage }: {
  id: string | null
  onClose: () => void
  onEdit: (id: string) => void
  onPedirEtapa: (id: string, etapa: Etapa) => void
  onMessage: (m: string) => void
}) {
  const { state, guardar } = useClientes()
  const { state: inv } = useInventory()
  const { actor, can } = useSession()
  const { lista: cotizaciones } = useCotizaciones()
  const { state: rs } = useReservas()
  const c = state.clientes.find((x) => x.id === id) ?? null
  const [error, setError] = useState<string | null>(null)
  const [act, setAct] = useState<{ tipo: TipoRegistrable; descripcion: string; fecha: string }>({ tipo: 'llamada', descripcion: '', fecha: hoyGuayaquil() })
  const [prox, setProx] = useState<ProximaActividad>({ tipo: 'llamada', descripcion: '', fecha: '' })
  const [resultado, setResultado] = useState('')
  const [unidadCot, setUnidadCot] = useState('')
  const [whatsapp, setWhatsapp] = useState(false)
  const [pestana, setPestana] = useState('resumen')
  useEffect(() => {
    setError(null); setResultado(''); setWhatsapp(false); setPestana('resumen')
    setAct({ tipo: 'llamada', descripcion: '', fecha: hoyGuayaquil() })
    setProx({ tipo: 'llamada', descripcion: '', fecha: '' })
    setUnidadCot(c?.unidadesInteres[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!c) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>

  const run = async (fn: () => Promise<void>, ok: string) => {
    setError(null)
    try { await fn(); onMessage(ok); return true } catch (e) { setError((e as Error).message); return false }
  }
  const cambiarEtapa = (etapa: Etapa) => {
    if (etapa === 'perdido' || etapa === 'seguimiento') return onPedirEtapa(c.id, etapa)
    void run(() => guardar((s) => moverEtapa(s, c.id, etapa, actor)), `${c.nombre} → ${ETAPAS[etapa].label}`)
  }
  const unidades = c.unidadesInteres.map((cod) => inv.units.find((u) => u.codigo === cod)).filter((u) => !!u)
  const urg = urgencia(c)
  const cotsCliente = cotizaciones.filter((q) => c.cotizaciones.includes(q.numero))
  const cod = unidades.some((u) => u!.codigo === unidadCot) ? unidadCot : unidades[0]?.codigo ?? ''
  // Venta en curso del cliente: sale de lo guardado, así que se retoma igual al volver a entrar o desde otro equipo.
  const enCurso = operacionesAbiertas(cotizaciones.filter((q) => q.clienteId === c.id), rs.reservas.filter((r) => r.clienteId === c.id), new Set(), hoyGuayaquil())[0] ?? null

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <Tabs value={pestana} onValueChange={setPestana} className="gap-0">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-popover/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{ORIGENES[c.origen]}{c.origenDetalle ? ` · ${c.origenDetalle}` : ''} · Asesor: {c.asesor}</span>
            <span className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon-xs" aria-label="Editar cliente" onClick={() => onEdit(c.id)}><PencilLine /></Button>
              <SheetClose asChild><Button variant="ghost" size="icon-xs" aria-label="Cerrar ficha"><X /></Button></SheetClose>
            </span>
          </div>
          <SheetTitle className="flex flex-wrap items-center gap-2 text-xl">{c.nombre} <CategoriaBadge cliente={c} /> <EtapaBadge etapa={c.etapa} /></SheetTitle>
          {categoriaCliente(c) === 'prospecto' && <p className="text-xs text-muted-foreground">{AVISO_PROSPECTO}</p>}
          <SheetDescription className="flex flex-wrap gap-x-4 gap-y-1">
            {c.telefono && <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${c.telefono}`}><Phone className="size-3" />{celularLocal(c.telefono)}</a>}
            {c.email && <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${c.email}`}><Mail className="size-3" />{c.email}</a>}
          </SheetDescription>
          {c.telefono && can('clientes.editar') && (
            <div><Button size="xs" variant="outline" className="border-emerald-300 text-emerald-800 hover:bg-emerald-50" onClick={() => setWhatsapp(true)}><MessageCircle />Contactar por WhatsApp</Button></div>
          )}
          <TabsList className="mt-1 w-full justify-start overflow-x-auto" aria-label="Secciones de la ficha">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="actividad">Actividad</TabsTrigger>
            <TabsTrigger value="operaciones">Operaciones</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
          </TabsList>
        </SheetHeader>

        <div className="grid gap-5 px-5 py-5">
          <FieldError>{error}</FieldError>
          <TabsContent value="resumen" className="grid gap-5">
            <LeadsDelCliente clientId={c.id} />

            {can('cotizaciones.crear') && c.etapa !== 'perdido' && (
              <section aria-labelledby="cs-venta" className="rounded-xl border border-primary/40 bg-secondary p-4">
                <h3 id="cs-venta" className="text-sm font-semibold">{enCurso ? 'Venta en curso' : 'Siguiente paso: crear cotización'}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {enCurso
                    ? `${enCurso.cotizacion.unidad.dpt} · ${enCurso.reserva?.codigo ?? enCurso.cotizacion.numero} · ${enCurso.paso}. Continúa donde quedó; la pantalla te indica qué sigue.`
                    : 'Elige el departamento y el plan de pagos, y emite la cotización para el cliente.'}
                </p>
                <div className="mt-2">
                  <Destacado activo texto="Haz clic aquí para continuar">
                    <Button size="sm" asChild><Link to={enCurso ? `/venta?cotizacion=${enCurso.cotizacion.id}` : `/venta?cliente=${c.id}${cod ? `&unidad=${cod}` : ''}`}><FileText />{enCurso ? 'Continuar la venta' : 'Crear cotización'}</Link></Button>
                  </Destacado>
                </div>
              </section>
            )}

            {/* Próxima actividad */}
            <section aria-labelledby="cs-prox" className={`rounded-xl border p-4 ${urg === 'vencida' ? 'border-rose-200 bg-rose-50/50' : urg === 'hoy' ? 'border-amber-200 bg-amber-50/50' : 'border-border'}`}>
              <h3 id="cs-prox" className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock className="size-4" />Próxima actividad</h3>
              {c.proxima ? (
                <div className="mt-2 grid gap-2">
                  <p className="text-sm"><b>{TIPOS_ACTIVIDAD[c.proxima.tipo]}</b> · {c.proxima.descripcion} · <span className={urg === 'vencida' ? 'font-semibold text-rose-700' : ''}>{fmtFechaCorta(c.proxima.fecha)}{urg === 'vencida' ? ' (vencida)' : urg === 'hoy' ? ' (hoy)' : ''}</span></p>
                  <div className="flex gap-2">
                    <Input aria-label="Resultado de la actividad" value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Resultado (opcional)" className="h-8 text-xs" />
                    <Button size="sm" onClick={() => void run(() => guardar((s) => completarProxima(s, c.id, resultado, actor)), 'Actividad completada').then((ok) => { if (ok) setResultado('') })}><Check />Hecha</Button>
                  </div>
                </div>
              ) : c.etapa !== 'perdido' && <p className="mt-1 text-xs text-muted-foreground">Sin actividad programada. Define el siguiente paso para no perder al cliente.</p>}
              {c.etapa !== 'perdido' && (
                <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[120px_1fr_140px_auto]">
                  <TipoSelect id="cs-prox-tipo" value={prox.tipo} onChange={(t) => setProx({ ...prox, tipo: t })} />
                  <Input aria-label="Qué hacer" value={prox.descripcion} onChange={(e) => setProx({ ...prox, descripcion: e.target.value })} placeholder="Qué hacer" className="h-8 text-xs" />
                  <Input aria-label="Fecha de la próxima actividad" type="date" value={prox.fecha} min={hoyGuayaquil()} onChange={(e) => setProx({ ...prox, fecha: e.target.value })} className="h-8 text-xs" />
                  <Button size="sm" variant="outline" onClick={() => void run(() => guardar((s) => programarProxima(s, c.id, prox, actor)), 'Próxima actividad programada').then((ok) => { if (ok) setProx({ tipo: 'llamada', descripcion: '', fecha: '' }) })}>{c.proxima ? 'Reprogramar' : 'Programar'}</Button>
                </div>
              )}
            </section>

            {/* Etapa */}
            <section aria-labelledby="cs-etapa" className="grid gap-2">
              <h3 id="cs-etapa" className="text-sm font-semibold">Etapa comercial</h3>
              <div className="flex flex-wrap gap-1.5">
                {ETAPA_ORDEN.map((e) => (
                  <button key={e} type="button" aria-pressed={c.etapa === e} onClick={() => cambiarEtapa(e)}
                    disabled={e === 'reserva' || c.etapa === 'reserva'} title={e === 'reserva' || c.etapa === 'reserva' ? 'La reserva se gestiona en el módulo Reservas' : undefined}
                    className="rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:text-white aria-pressed:opacity-100"
                    style={c.etapa === e ? { background: ETAPAS[e].color, borderColor: ETAPAS[e].color } : undefined}>
                    {ETAPAS[e].label}
                  </button>
                ))}
              </div>
              {c.etapa === 'perdido' && <p className="text-xs text-rose-700">Motivo: {c.motivoPerdida}</p>}
              {c.etapa === 'seguimiento' && c.fechaRetomar && <p className="text-xs text-muted-foreground">Retomar el {fmtFechaCorta(c.fechaRetomar)}</p>}
            </section>

            {/* Interés */}
            <section aria-labelledby="cs-interes" className="rounded-xl border border-border p-4">
              <h3 id="cs-interes" className="text-sm font-semibold">Interés</h3>
              <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
                <div><dt className="text-muted-foreground">Presupuesto</dt><dd className="font-medium">{c.presupuesto ? fmtUsd(c.presupuesto) : 'Sin definir'}</dd></div>
                <div><dt className="text-muted-foreground">Compra para</dt><dd className="font-medium">{c.proposito ? PROPOSITOS[c.proposito] : 'Sin definir'}</dd></div>
                <div><dt className="text-muted-foreground">Forma de pago</dt><dd className="font-medium">{c.formaPago ? FORMAS_PAGO[c.formaPago] : 'Sin definir'}</dd></div>
              </dl>
              {unidades.length ? (
                <ul className="mt-3 grid gap-1.5">
                  {unidades.map((u) => {
                    const precio = calcularPrecio(u!, inv.params).precioVenta
                    const excede = c.presupuesto ? precio - c.presupuesto : 0
                    return (
                      <li key={u!.codigo} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                        <Link to={`/inventario?unidad=${u!.codigo}`} className="font-semibold hover:underline">{u!.dpt}</Link>
                        <span className="text-muted-foreground">{u!.tipologia} · {nombreEdificio(u!.edificio)}</span>
                        <EstadoBadge estado={u!.estado} />
                        <span className="ml-auto font-medium tabular-nums">{fmtUsd(precio)}</span>
                        {excede > 0 && <span className="basis-full text-xs text-amber-700">Supera el presupuesto en {fmtUsd(excede)}</span>}
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="mt-2 text-xs text-muted-foreground">Sin departamento de interés. <button type="button" className="text-primary hover:underline" onClick={() => onEdit(c.id)}>Agregar</button></p>}
            </section>
            <TrazabilidadCliente clientId={c.id} />
          </TabsContent>
          <TabsContent value="actividad" className="grid gap-5">
            {/* Registrar actividad */}
            <section aria-labelledby="cs-reg" className="grid gap-2">
              <h3 id="cs-reg" className="text-sm font-semibold">Registrar actividad realizada</h3>
              <div className="grid gap-2 sm:grid-cols-[120px_140px_1fr]">
                <TipoSelect id="cs-act-tipo" value={act.tipo} onChange={(t) => setAct({ ...act, tipo: t })} />
                <Input aria-label="Fecha de la actividad" type="date" value={act.fecha} max={hoyGuayaquil()} onChange={(e) => setAct({ ...act, fecha: e.target.value })} className="h-8 text-xs" />
                <div className="hidden sm:block" />
              </div>
              <Label htmlFor="cs-act-desc" className="sr-only">Descripción</Label>
              <Textarea id="cs-act-desc" rows={2} value={act.descripcion} onChange={(e) => setAct({ ...act, descripcion: e.target.value })} placeholder="Ej. Llamada: confirma interés en 2 habitaciones, pide cuota mensual" />
              <Button size="sm" className="justify-self-end" disabled={act.descripcion.trim().length < 3}
                onClick={() => void run(() => guardar((s) => registrarActividad(s, c.id, act, actor)), 'Actividad registrada').then((ok) => { if (ok) setAct({ ...act, descripcion: '' }) })}>Registrar</Button>
            </section>

            {/* Historial */}
            <section aria-labelledby="cs-hist">
              <h3 id="cs-hist" className="mb-2 text-sm font-semibold">Historial</h3>
              <ol className="relative grid gap-3 border-l border-border pl-4">
                {c.actividades.map((a) => (
                  <li key={a.id} className="text-xs">
                    <span className="absolute -left-[5px] mt-1 size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden="true" />
                    <div><b>{TIPOS_ACTIVIDAD[a.tipo]}</b> · {a.descripcion}</div>
                    <div className="text-xs text-muted-foreground">{fmtFechaCorta(a.fecha)} · {a.usuario}</div>
                  </li>
                ))}
              </ol>
            </section>
          </TabsContent>
          <TabsContent value="operaciones" className="grid gap-5">
            <NegociacionesCliente c={c} onMessage={onMessage} />
            {/* Cotizar */}
            <section aria-labelledby="cs-cot" className="grid gap-2 rounded-xl border border-border p-4">
              <h3 id="cs-cot" className="text-sm font-semibold">Cotizar</h3>
              {unidades.length ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={cod} onValueChange={setUnidadCot}>
                      <SelectTrigger aria-label="Departamento a cotizar" className="h-8 min-w-40 text-xs"><SelectValue placeholder="Departamento" /></SelectTrigger>
                      <SelectContent>{unidades.map((u) => <SelectItem key={u!.codigo} value={u!.codigo}>{u!.dpt} · {u!.tipologia}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" asChild><Link to={`/financiamiento?unidad=${cod}`}><Landmark />Simular financiamiento</Link></Button>
                  </div>
                </>
              ) : <p className="text-xs text-muted-foreground">Registra un departamento de interés para cotizar.</p>}
              {c.cotizaciones.length > 0 && (
                <ul className="mt-1 grid gap-1">
                  {c.cotizaciones.map((n) => {
                    const q = cotsCliente.find((x) => x.numero === n)
                    return (
                      <li key={n} className="flex items-center gap-2 text-xs">
                        <FileText className="size-3.5 text-muted-foreground" /><b>{n}</b>
                        {q && <span className="text-muted-foreground">{q.unidad.dpt} · {fmtUsd(q.plan.precioFinal)} · vence {fmtFechaCorta(q.validaHasta)}</span>}
                        {q && <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label={`Descargar ${n}`} onClick={() => { void descargarCotizacionPdf(q).catch((e: Error) => setError(e.message)) }}><Download /></Button>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </TabsContent>
          <TabsContent value="documentos" className="grid gap-5">
            <DocumentosCliente clientId={c.id} nombre={c.nombre} onMessage={onMessage} />
          </TabsContent>
        </div>
        </Tabs>
        {whatsapp && (
          <WhatsAppDialog cliente={c.nombre} telefono={c.telefono} vendedor={actor.nombre} onClose={() => setWhatsapp(false)}
            onContactado={() => run(() => guardar((s) => registrarContactoWhatsApp(s, c.id, actor)), 'Contacto por WhatsApp registrado')} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function TipoSelect({ id, value, onChange }: { id: string; value: TipoRegistrable; onChange: (t: TipoRegistrable) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as TipoRegistrable)}>
      <SelectTrigger id={id} aria-label="Tipo de actividad" className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>{TIPOS.map((t) => <SelectItem key={t} value={t}>{TIPOS_ACTIVIDAD[t]}</SelectItem>)}</SelectContent>
    </Select>
  )
}
