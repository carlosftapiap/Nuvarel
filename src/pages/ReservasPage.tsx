import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCheck, ChevronLeft, Clock, FolderOpen, Lock, Plus, Search, XCircle } from 'lucide-react'
import Aviso from '@/components/Aviso'
import DatosLocalesAviso from '@/components/DatosLocalesAviso'
import Estado, { Avatar } from '@/components/Estado'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fechaGuayaquil, fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import type { Reserva } from '@/features/reservas/model'
import { reservasVisibles } from '@/features/reservas/service'
import { prioridad, siguientePaso, type SiguientePaso } from '@/features/reservas/siguiente'
import { DIALOGO_DE, useAccionesReserva, type DialogoReserva } from '@/features/reservas/components/AccionesReserva'
import ReglasAnulacion from '@/features/clientes/components/ReglasAnulacion'
import SolicitudesAnulacion from '@/features/clientes/components/SolicitudesAnulacion'
import { useClientes } from '@/features/clientes/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

type Pestana = 'accion' | 'solicitada' | 'pago_verificado' | 'confirmada' | 'anulada' | 'todas'
interface Rechazo { motivo: string; revisadoEn: string | null; referencia: string; archivo: string | null }
const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const PESTANAS: { k: Pestana; label: string }[] = [
  { k: 'accion', label: 'Requieren tu acción' },
  { k: 'solicitada', label: 'Solicitadas' },
  { k: 'pago_verificado', label: 'Excepciones por autorizar' },
  { k: 'confirmada', label: 'Confirmadas' },
  { k: 'anulada', label: 'Anuladas' },
  { k: 'todas', label: 'Todas' },
]

export default function ReservasPage() {
  const { actor, can } = useSession()
  const { state: inv } = useInventory()
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const [error, setError] = useState<string | null>(null)
  const { flujo, abrir, dialogos } = useAccionesReserva((m) => { setError(null); setAviso(m) }, setError)
  const { desistimientos, hayDesistimientos } = useClientes()
  const { datos } = useConexion()
  const movil = useIsMobile()
  const hoy = hoyGuayaquil()
  // Último comprobante de cada reserva: si fue rechazado y la reserva sigue esperando el pago, el vendedor ve por qué y lo reemplaza.
  const [rechazos, setRechazos] = useState<Map<string, Rechazo>>(new Map())
  useEffect(() => {
    if (!flujo.remoto || !datos) return
    void datos.select<Record<string, unknown>>('comprobantes_pago', { orden: [{ columna: 'cargado_en' }] }).then((f) => {
      const ultimo = new Map<string, Record<string, unknown>>()
      for (const k of f) if (k.reservation_id) ultimo.set(String(k.reservation_id), k)
      setRechazos(new Map([...ultimo].filter(([, k]) => k.estado === 'rechazado').map(([id, k]) => [id, {
        motivo: String(k.motivo_revision ?? ''), revisadoEn: k.revisado_en ? String(k.revisado_en) : null, referencia: String(k.referencia ?? ''), archivo: k.archivo_nombre ? String(k.archivo_nombre) : null,
      }])))
    }).catch(() => {})
  }, [flujo.remoto, datos, flujo.res.reservas])
  const rechazoDe = (r: Reserva) => (r.estado === 'solicitada' && !r.comprobante ? rechazos.get(r.id) ?? null : null)
  const pendiente = (r: Reserva) => desistimientos.some((d) => d.reservaId === r.id && d.estado === 'pendiente')

  const visibles = useMemo(() => reservasVisibles(flujo.res.reservas, actor), [flujo.res.reservas, actor])
  const pasos = new Map(visibles.map((r) => [r.id, siguientePaso(r, can, { remoto: flujo.remoto, rechazada: !!rechazoDe(r) })]))
  const paso = (r: Reserva) => pasos.get(r.id)!
  const enPestana = (r: Reserva, k: Pestana) => (k === 'todas' ? true : k === 'accion' ? !!paso(r).accion : r.estado === k)
  const cuenta = (k: Pestana) => visibles.filter((r) => enPestana(r, k)).length

  // Desde Cobranzas y desde el inicio se abre una reserva con ?codigo=.
  const [params, setParams] = useSearchParams()
  const codigo = params.get('codigo')
  const [pestana, setPestana] = useState<Pestana | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  // En el celular el detalle ocupa la pantalla: se abre al tocar una reserva o al llegar con ?codigo=.
  const [verDetalle, setVerDetalle] = useState(() => !!codigo)
  const delCodigo = codigo ? visibles.find((r) => r.codigo === codigo) : undefined
  // Si nada espera a esta persona, se abre la lista completa en lugar de un vacío.
  const actual: Pestana = pestana ?? (delCodigo ? 'todas' : cuenta('accion') ? 'accion' : 'todas')
  const lista = visibles
    .filter((r) => enPestana(r, actual) && (!q.trim() || norm(`${r.codigo} ${r.clienteNombre} ${inv.units.find((u) => u.codigo === r.unidad)?.dpt ?? r.unidad}`).includes(norm(q.trim()))))
    .sort((a, b) => prioridad(a, paso(a)) - prioridad(b, paso(b)) || a.vigenciaHasta.localeCompare(b.vigenciaHasta) || b.codigo.localeCompare(a.codigo))
  const elegida = lista.find((r) => r.id === (sel ?? delCodigo?.id)) ?? (movil ? undefined : lista[0])
  const elegir = (r: Reserva) => { setSel(r.id); setVerDetalle(true); if (codigo) setParams({}, { replace: true }) }

  const solicitadas = visibles.filter((r) => r.estado === 'solicitada').length
  const porAprobar = visibles.filter((r) => r.estado === 'pago_verificado').length
  const confirmadas = visibles.filter((r) => r.estado === 'confirmada')
  const totalReservado = confirmadas.reduce((t, r) => t + (r.montoRecibido ?? 0), 0)
  const bloqueadas = inv.units.filter((u) => u.estado === 'reservado').length
  const dptDe = (r: Reserva) => inv.units.find((u) => u.codigo === r.unidad)
  const mostrarDetalle = !movil || verDetalle

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Reservas"
        subtitle="Una solicitud no bloquea la unidad. Finanzas verifica el ingreso y la reserva se confirma; Gerencia solo autoriza excepciones."
        actions={can('cotizaciones.crear') ? <Button asChild><Link to="/venta"><Plus />Atender cliente</Link></Button> : undefined} />
      <DatosLocalesAviso solo="amura.reservas.v1" />

      <dl aria-label="Resumen de reservas" className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-border bg-white px-4 py-3 text-[13px]">
        {([['Por verificar', solicitadas, solicitadas ? 'text-amber-700' : ''], ['Excepciones', porAprobar, porAprobar ? 'text-sky-700' : ''], ['Confirmadas', confirmadas.length, ''], ['Recibido en reservas', fmtUsd(totalReservado), ''], ['Unidades reservadas', bloqueadas, '']] as const).map(([t, v, tono]) => (
          <div key={t} className="flex items-baseline gap-2"><dt className="text-slate-600">{t}</dt><dd className={cn('font-semibold tabular-nums text-foreground', tono)}>{v}</dd></div>
        ))}
      </dl>

      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}

      {flujo.remoto && hayDesistimientos && (
        <>
          <SolicitudesAnulacion onDone={async (m) => { await flujo.recargar(); setAviso(m) }} />
          <details className="dashboard-card mb-4 p-4">
            <summary className="cursor-pointer text-xs font-semibold">¿Quién aprueba la anulación de una reserva y cómo funciona?</summary>
            <div className="mt-3"><ReglasAnulacion /></div>
          </details>
        </>
      )}

      {visibles.length === 0 ? (
        <div className="module-empty">
          <span className="module-empty-icon"><CheckCheck className="size-7" aria-hidden="true" /></span>
          <h2 className="text-lg font-semibold">Sin reservas todavía</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Atiende al cliente, emite la cotización y solicita la reserva desde una sola pantalla.</p>
          {can('cotizaciones.crear') && <Button asChild className="mt-6"><Link to="/venta">Atender cliente</Link></Button>}
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section aria-label="Lista de reservas" className={cn('dashboard-card grid gap-3 p-3', movil && verDetalle && 'hidden')}>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filtrar reservas">
              {PESTANAS.map(({ k, label }) => {
                const n = cuenta(k)
                return (
                  <button key={k} type="button" aria-pressed={actual === k} onClick={() => { setPestana(k); setSel(null) }}
                    className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-colors',
                      actual === k ? 'bg-[#101828] text-white' : 'text-slate-600 hover:bg-muted')}>
                    <span>{label}</span>
                    <span className={cn('rounded-full px-1.5 text-xs tabular-nums', actual === k ? 'bg-white/20' : k === 'accion' && n ? 'bg-[#e0e7ff] text-[#3730a3]' : 'bg-muted')}>{n}</span>
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <label htmlFor="res-q" className="sr-only">Buscar reserva</label>
              <Input id="res-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, reserva o departamento" className="h-10 pl-9 text-sm" />
            </div>
            {lista.length === 0 ? (
              actual === 'accion' && !q.trim() ? (
                <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center gap-2 px-4 py-10 text-center">
                  <span className="grid grid-cols-[minmax(0,1fr)] size-12 place-items-center rounded-2xl bg-secondary text-primary"><CheckCheck className="size-6" aria-hidden="true" /></span>
                  <p className="text-[15px] font-semibold">Todo al día</p>
                  <p className="max-w-xs text-[13px] text-slate-600">Ninguna reserva espera una acción tuya. Cuando un pago llegue o falte un comprobante, aparecerá aquí primero.</p>
                  <Button size="sm" variant="outline" className="mt-1" onClick={() => setPestana('todas')}>Ver todas ({visibles.length})</Button>
                </div>
              ) : (
                <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center gap-1 px-4 py-10 text-center">
                  <p className="text-sm font-semibold">{q.trim() ? 'No hay reservas que coincidan' : 'Sin reservas en este estado'}</p>
                  <p className="text-xs text-slate-600">{q.trim() ? 'Revisa el nombre o el código.' : 'Prueba con otro filtro.'}</p>
                </div>
              )
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                {lista.map((r) => {
                  const p = paso(r)
                  const u = dptDe(r)
                  const vencida = r.estado === 'solicitada' && r.vigenciaHasta < hoy
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => elegir(r)} aria-pressed={elegida?.id === r.id} aria-label={`Abrir reserva ${r.codigo} de ${r.clienteNombre}`}
                        className={cn('grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent p-2.5 text-left transition-colors hover:bg-muted/70',
                          elegida?.id === r.id && 'border-[#c7d2fe] bg-[#eef2ff] hover:bg-[#eef2ff]')}>
                        <Avatar nombre={r.clienteNombre} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{r.clienteNombre}</span>
                          <span className="block truncate text-xs text-slate-600">Dpto. {u?.dpt ?? r.unidad}{u?.tipologia ? ` · ${u.tipologia}` : ''} · {r.codigo}</span>
                          {p.accion ? <span className="mt-0.5 block truncate text-xs font-semibold text-[#3730a3]">Te toca: {p.boton}</span>
                            : vencida ? <span className="mt-0.5 block text-xs font-semibold text-rose-700">Cotización vencida</span> : null}
                        </span>
                        <span className="grid grid-cols-[minmax(0,1fr)] justify-items-end gap-1.5">
                          <b className="text-[13px] tabular-nums">{fmtUsd2(r.montoReserva)}</b>
                          <Estado tono={p.tono} punto>{p.estado}</Estado>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {mostrarDetalle && elegida && (
            <Detalle r={elegida} p={paso(elegida)} unidad={dptDe(elegida)} hoy={hoy} rechazo={rechazoDe(elegida)} pendiente={pendiente(elegida)}
              remoto={flujo.remoto} hayDesistimientos={hayDesistimientos} onVolver={movil ? () => setVerDetalle(false) : undefined}
              onAccion={(t) => abrir(t, elegida)} />
          )}
        </div>
      )}

      <Aviso texto={aviso} onClose={cerrarAviso} />
      {dialogos}
    </>
  )
}

function Detalle({ r, p, unidad, hoy, rechazo, pendiente, remoto, hayDesistimientos, onVolver, onAccion }: {
  r: Reserva; p: SiguientePaso; unidad?: { dpt: string; tipologia: string; edificio: number }; hoy: string; rechazo: Rechazo | null; pendiente: boolean
  remoto: boolean; hayDesistimientos: boolean; onVolver?: () => void; onAccion: (t: DialogoReserva) => void
}) {
  const { can } = useSession()
  const vencida = r.estado === 'solicitada' && r.vigenciaHasta < hoy
  // Anular directo solo vale para una solicitud sin pago ni comprobante; el servidor lo vuelve a comprobar.
  const anulable = r.estado !== 'anulada' && can('reservas.anular') && (!remoto || (r.estado === 'solicitada' && !r.comprobante && r.montoRecibido === null)) && !pendiente
  const etapas: [string, boolean][] = [
    ['Solicitada', true],
    ['Comprobante', !!r.comprobante || r.montoRecibido !== null],
    ['Pago verificado', r.estado === 'pago_verificado' || r.estado === 'confirmada' || !!r.verificadaPor],
    ['Confirmada', r.estado === 'confirmada'],
  ]
  return (
    <section aria-label={`Detalle de la reserva ${r.codigo}`} className="dashboard-card grid content-start gap-5 p-5 lg:sticky lg:top-[76px]">
      {onVolver && <Button variant="ghost" size="sm" className="-ml-2 justify-self-start" onClick={onVolver}><ChevronLeft />Volver a la lista</Button>}
      <header className="flex flex-wrap items-center gap-3">
        <Avatar nombre={r.clienteNombre} className="size-11 text-sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold tracking-tight">{r.clienteNombre}</h2>
          <p className="text-xs text-slate-600">{r.codigo} · {r.cotizacionNumero}{r.creadaPor.nombre && <> · Vendedor: {r.creadaPor.nombre}</>}</p>
        </div>
        <Estado tono={p.tono} punto>{p.estado}</Estado>
      </header>

      <div className={cn('grid gap-2 rounded-xl border p-4', p.accion ? 'border-[#dde3ff] bg-gradient-to-b from-[#f8f9ff] to-[#f3f4ff]' : 'border-border bg-[#fafbfc]')}>
        <p className="text-xs font-semibold text-[#3730a3]">Siguiente paso</p>
        <h3 className="text-base font-semibold">{p.titulo}</h3>
        <p className="text-[13px] text-slate-700">{p.detalle}</p>
        {rechazo && <AvisoRechazo x={rechazo} />}
        {vencida && <p className="text-xs font-semibold text-rose-700">La cotización venció el {fmtFechaCorta(r.vigenciaHasta)}: el precio ya no está garantizado.</p>}
        {pendiente && <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800"><Clock className="size-3.5" aria-hidden="true" />Anulación por autorizar</p>}
        {p.accion && <div className="mt-1"><Button size="lg" onClick={() => onAccion(DIALOGO_DE[p.accion!])}>{p.boton}</Button></div>}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ['Precio acordado', fmtUsd(r.precioAcordado), r.descuentoPct > 0 ? `−${r.descuentoPct} % de descuento` : 'Precio de lista'],
          ['Reserva', fmtUsd2(r.montoReserva), `${r.reservaPct} % a la firma`],
          ['Pagado', r.montoRecibido !== null ? fmtUsd2(r.montoRecibido) : '—', r.montoRecibido !== null ? 'Verificado por Finanzas' : r.comprobante ? 'Por verificar' : 'Sin pago registrado'],
          ['Vigencia', fmtFechaCorta(r.vigenciaHasta), vencida ? 'Cotización vencida' : 'Del precio cotizado'],
        ] as const).map(([t, v, d]) => (
          <div key={t} className="rounded-xl border border-border px-3 py-2.5">
            <dt className="text-xs text-slate-600">{t}</dt>
            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</dd>
            <dd className={cn('text-xs', t === 'Vigencia' && vencida ? 'font-semibold text-rose-700' : 'text-slate-500')}>{d}</dd>
          </div>
        ))}
      </dl>

      <p className="text-[13px] text-slate-700"><b>Unidad:</b> Dpto. {unidad?.dpt ?? r.unidad}{unidad ? ` · ${unidad.tipologia} · Edificio ${unidad.edificio}` : ''} · {r.meses} cuotas de {fmtUsd(r.cuotaMensual)}</p>

      <ol aria-label="Avance de la reserva" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {etapas.map(([t, ok]) => (
          <li key={t} className={cn('grid gap-1.5 text-xs', ok ? 'text-slate-800' : 'text-slate-500')}>
            <span className={cn('h-1 rounded-full', ok ? 'bg-emerald-600' : 'bg-[#e4e7ec]')} aria-hidden="true" />
            <span className="font-semibold">{t}</span><span>{ok ? 'Hecho' : 'Pendiente'}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {remoto && can('clientes.editar') && <Button size="sm" variant="outline" asChild><Link to={`/clientes?cliente=${r.clienteId}`}><FolderOpen />Documentos</Link></Button>}
        {remoto && r.estado === 'solicitada' && !!r.comprobante && can('reservas.verificar_pago') && <Button size="sm" variant="outline" onClick={() => onAccion('rechazar')}>Rechazar pago</Button>}
        {remoto && hayDesistimientos && r.estado !== 'anulada' && !pendiente && can('ventas.desistimiento') && <Button size="sm" variant="outline" className="text-rose-700" onClick={() => onAccion('desistimiento')}>Desistimiento</Button>}
        {anulable && <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => onAccion('anular')}><XCircle />Anular</Button>}
        {r.estado === 'confirmada' && <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><Lock className="size-3.5" aria-hidden="true" />Unidad bloqueada</span>}
      </div>
    </section>
  )
}

function AvisoRechazo({ x }: { x: Rechazo }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      <div><b>Pago rechazado</b>{x.revisadoEn ? ` el ${fmtFechaCorta(fechaGuayaquil(x.revisadoEn))}` : ''}</div>
      <div>Motivo: {x.motivo}</div>
      <div className="opacity-80">Comprobante {x.referencia}{x.archivo ? ` · ${x.archivo}` : ''}. Reemplázalo y se envía de nuevo a revisión.</div>
    </div>
  )
}
