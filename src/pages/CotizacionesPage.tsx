import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Download, Info, Plus, Search } from 'lucide-react'
import DatosLocalesAviso from '@/components/DatosLocalesAviso'
import Estado from '@/components/Estado'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { puedeVerDe } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { descargarCotizacionPdf } from '@/features/cotizaciones/pdf'
import { useCotizaciones } from '@/features/cotizaciones/store'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { fmtUsd, RESERVA_PREDETERMINADA } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { useReservaFlujo } from '@/features/reservas/flujo'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { numeroAnterior } from '@/features/inventario/nomenclatura'

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
type Filtro = 'vigentes' | 'vencidas' | 'todas'

/**
 * Cotizaciones: historial y consulta. Se emiten en un solo recorrido, «Atender cliente», que lleva del cliente al
 * departamento, al plan de pagos y a la cotización. Los enlaces antiguos para cotizar abren ese mismo recorrido.
 */
export default function CotizacionesPage() {
  const { state } = useInventory()
  const { actor, can } = useSession()
  const [params] = useSearchParams()
  const { lista: todas, remoto: conectado } = useCotizaciones()
  const reservas = useReservaFlujo()
  const movil = useIsMobile()
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [q, setQ] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const hoy = hoyGuayaquil()

  if (!can('cotizaciones.crear')) return <PageHeader title="Cotizaciones" subtitle="Tu rol no puede emitir cotizaciones." />
  // Un enlace para cotizar (cliente o departamento) abre el creador único.
  const cliente = params.get('cliente')
  const unidad = params.get('unidad')
  if (cliente || unidad) {
    const destino = new URLSearchParams()
    if (cliente) destino.set('cliente', cliente)
    if (unidad) destino.set('unidad', unidad)
    return <Navigate to={`/venta?${destino}`} replace />
  }

  // Solo las cotizaciones del alcance del usuario. Con Supabase ya llegan filtradas por la base de datos.
  const lista = (conectado ? todas : todas.filter((c) => puedeVerDe(actor, [c.creadaPor.id])))
  const vigente = (c: Cotizacion) => c.validaHasta >= hoy && c.estado !== 'anulada' && c.estado !== 'reemplazada'
  const enFiltro = (c: Cotizacion) => filtro === 'todas' || (filtro === 'vigentes' ? vigente(c) : !vigente(c))
  const visibles = lista
    .filter((c) => enFiltro(c) && (!q.trim() || norm(`${c.numero} ${c.cliente.nombre} ${c.unidad.dpt} ${c.unidad.codigo} ${numeroAnterior(c.unidad.codigo) ?? ''}`).includes(norm(q.trim()))))
    .sort((a, b) => b.numero.localeCompare(a.numero))
  const cuenta = (f: Filtro) => lista.filter((c) => f === 'todas' || (f === 'vigentes' ? vigente(c) : !vigente(c))).length
  // Misma condición de siempre para pedir la reserva desde una cotización.
  const puedeReservar = (c: Cotizacion) => !!c.clienteId && can('reservas.solicitar') && (!c.estado || c.estado === 'emitida' || c.estado === 'aceptada')
    && !reservas.res.reservas.some((r) => r.cotizacionId === c.id && r.estado !== 'anulada') && !state.units.find((u) => u.codigo === c.unidad.codigo)?.solicitud
  const solicitar = (c: Cotizacion) => {
    setAviso(null)
    void reservas.solicitar(c, Math.min(state.params.reservaPredeterminada ?? RESERVA_PREDETERMINADA, c.plan.reserva))
      .then(() => setAviso(`Solicitud de reserva creada para ${c.numero}. Pendiente de verificación de pago.`))
      .catch((e: Error) => setAviso(e.message))
  }
  const estado = (c: Cotizacion) => (c.estado === 'anulada' ? <Estado tono="neutro">Anulada</Estado>
    : c.estado === 'reemplazada' ? <Estado tono="neutro">Reemplazada</Estado>
      : c.estado === 'aceptada' ? <Estado tono="ok" punto>Aceptada</Estado>
        : vigente(c) ? <Estado tono="info" punto>Vigente</Estado> : <Estado tono="aviso" punto>Vencida</Estado>)
  const acciones = (c: Cotizacion) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button size="icon-sm" variant="outline" aria-label={`Descargar ${c.numero}`} title="Descargar PDF" onClick={() => { void descargarCotizacionPdf(c).catch((e: Error) => setAviso(e.message)) }}><Download /></Button>
      {conectado && <Button size="sm" variant="ghost" asChild><Link to={`/venta?cotizacion=${c.id}`}>Continuar<ArrowRight /></Link></Button>}
      {puedeReservar(c) && <Button size="sm" variant="outline" onClick={() => solicitar(c)}>{c.estado === 'emitida' ? 'Cliente acepta: solicitar reserva' : 'Solicitar reserva'}</Button>}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Cotizaciones"
        subtitle="Historial y consulta. Para emitir una cotización se usa un solo recorrido: cliente, departamento y plan de pagos en Atender cliente."
        actions={<Button asChild><Link to="/venta"><Plus />Nueva cotización</Link></Button>} />
      <DatosLocalesAviso solo="amura.cotizaciones.v1" />

      <p className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-white px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>El precio sale del inventario y puede ser referencial hasta su aprobación. La simulación de crédito es referencial: tasas y condiciones las define cada banco o el BIESS.</span>
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[min(100%,260px)] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="cot-q" className="sr-only">Buscar cotización</label>
          <Input id="cot-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por número, cliente o departamento" className="h-10 bg-white pl-9 text-sm" />
        </div>
        <div className="flex gap-1 rounded-xl bg-[#eaedf2] p-1" role="group" aria-label="Filtrar cotizaciones">
          {(['todas', 'vigentes', 'vencidas'] as Filtro[]).map((f) => (
            <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
              className={cn('h-8 rounded-lg px-3 text-[13px] font-semibold capitalize text-slate-600', filtro === f && 'bg-white text-foreground shadow-xs')}>
              {f === 'todas' ? 'Todas' : f === 'vigentes' ? 'Vigentes' : 'Vencidas'} <span className="tabular-nums text-slate-500">{cuenta(f)}</span>
            </button>
          ))}
        </div>
      </div>

      {aviso && <p role="status" className="mb-3 rounded-lg bg-muted px-3 py-2 text-xs">{aviso} {aviso.startsWith('Solicitud') && <Link className="text-primary hover:underline" to="/reservas">Ver reservas</Link>}</p>}

      {lista.length === 0 ? (
        <div className="module-empty">
          <h2 className="text-lg font-semibold">Aún no hay cotizaciones.</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Atiende al cliente, elige el departamento y el plan de pagos, y emite la cotización desde un solo lugar.</p>
          <Button asChild className="mt-6"><Link to="/venta"><Plus />Nueva cotización</Link></Button>
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-xl border border-border bg-white p-6 text-center text-sm text-slate-600">No hay cotizaciones con ese filtro.</p>
      ) : movil ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Cotizaciones">
          {visibles.map((c) => (
            <li key={c.id} className="grid gap-2 rounded-2xl border border-border bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{c.numero} · Dpto. {c.unidad.dpt}</p>
                  <p className="truncate text-xs text-slate-600">{c.clienteId ? <Link className="hover:underline" to={`/clientes?cliente=${c.clienteId}`}>{c.cliente.nombre}</Link> : c.cliente.nombre} · {fmtUsd(c.plan.precioFinal)}</p>
                </div>
                {estado(c)}
              </div>
              <p className="text-xs text-slate-600">Vence {fmtFechaCorta(c.validaHasta)}</p>
              {acciones(c)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="dashboard-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border bg-[#fafbfc] text-xs text-slate-600">
              <tr><th className="px-4 py-2.5 text-left font-semibold">Cotización</th><th className="px-2 py-2.5 text-left font-semibold">Cliente</th><th className="px-2 py-2.5 text-right font-semibold">Precio final</th><th className="px-2 py-2.5 text-left font-semibold">Vigencia</th><th className="px-2 py-2.5 text-left font-semibold">Estado</th><th className="px-4 py-2.5"><span className="sr-only">Acciones</span></th></tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.id} className="border-t border-border first:border-t-0">
                  <td className="px-4 py-2.5"><b className="font-semibold">{c.numero}</b><span className="block text-xs text-slate-600">Dpto. {c.unidad.dpt} · {c.unidad.tipologia}</span></td>
                  <td className="px-2 py-2.5">{c.clienteId ? <Link className="hover:underline" to={`/clientes?cliente=${c.clienteId}`}>{c.cliente.nombre}</Link> : c.cliente.nombre}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{fmtUsd(c.plan.precioFinal)}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap">{fmtFechaCorta(c.validaHasta)}</td>
                  <td className="px-2 py-2.5">{estado(c)}</td>
                  <td className="px-4 py-2.5">{acciones(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
