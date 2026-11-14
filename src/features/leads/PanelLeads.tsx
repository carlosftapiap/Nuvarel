import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { cn } from '@/lib/utils'
import { cargarConversion, cargarLeads, FUENTES, indicadoresLeads, porcentaje, type Conversion, type Lead } from './remoto'

type Periodo = 'mes' | 'todo'
const mesDe = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }).slice(0, 7)
const hace = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000
  return h < 1 ? 'hace menos de 1 h' : h < 48 ? `hace ${Math.floor(h)} h` : `hace ${Math.floor(h / 24)} días`
}

/**
 * Indicadores de captación con el alcance de quien consulta: el administrador ve el proyecto, el supervisor su equipo
 * y el vendedor sus prospectos. Sin leads aún, muestra solo un aviso breve.
 */
export default function PanelLeads({ titulo, sub }: { titulo?: string; sub?: string }) {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) return null
  return <Panel datos={datos} titulo={titulo} sub={sub} />
}

function Panel({ datos, titulo, sub }: { datos: Datos; titulo?: string; sub?: string }) {
  const { actor, can } = useSession()
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [conv, setConv] = useState<Conversion | null>(null)
  const [nombres, setNombres] = useState<Map<string, string>>(new Map())
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const cargar = useCallback(async () => {
    try {
      const [l, c, p] = await Promise.all([cargarLeads(datos), cargarConversion(datos), datos.select<Record<string, unknown>>('profiles').catch(() => [])])
      setLeads(l); setConv(c); setNombres(new Map(p.map((x) => [String(x.id), String(x.nombre)])))
    } catch { setLeads([]) }
  }, [datos])
  useRefresco(cargar)

  const alcance = actor.alcance?.tipo ?? 'propio'
  const t = titulo ?? (alcance === 'empresa' ? 'Captación de leads' : alcance === 'equipo' ? 'Leads de tu equipo' : 'Tus prospectos')
  const s = sub ?? (alcance === 'empresa' ? 'Página web, Facebook e Instagram · proyecto completo' : alcance === 'equipo' ? 'De tus vendedores y tus ventas propias' : 'Asignados a ti desde la web y las redes sociales')
  const visibles = useMemo(() => (leads ?? []).filter((l) => periodo === 'todo' || mesDe(l.recibidoEn) === hoyGuayaquil().slice(0, 7)), [leads, periodo])
  const ind = useMemo(() => (conv ? indicadoresLeads(visibles, conv) : null), [visibles, conv])
  const porContactar = visibles.filter((l) => l.estado !== 'pendiente' && !l.primerContactoEn && (alcance !== 'propio' || l.asignadoA === actor.id)).slice(0, 8)

  if (!leads || !ind) return null
  if (leads.length === 0) {
    return (
      <section aria-label={t} className="rounded-2xl border border-dashed border-border bg-white p-4 text-xs text-slate-600">
        <span className="flex items-center gap-2 font-semibold text-slate-700"><Megaphone className="size-4" />{t}</span>
        <p className="mt-1">Aún no llegan leads de la página web, Facebook ni Instagram. Cuando lleguen, se asignan solos y aparecen aquí.</p>
      </section>
    )
  }
  const tarjeta = (label: string, valor: string, hint: string, tono?: string) => (
    <div className="rounded-xl border border-border p-3"><div className="text-xs text-slate-600">{label}</div><div className={cn('mt-0.5 text-lg font-semibold tabular-nums', tono)}>{valor}</div><div className="text-xs text-slate-600">{hint}</div></div>
  )
  return (
    <section aria-label={t} className="min-w-0 rounded-2xl border border-border bg-white p-4 shadow-[0_3px_8px_#18243d05] sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="size-4 text-primary" />{t}</h2><p className="text-xs text-slate-600">{s}</p></div>
        <div className="flex gap-1" role="group" aria-label="Periodo de leads">
          {([['mes', 'Este mes'], ['todo', 'Todo']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={periodo === k} onClick={() => setPeriodo(k)} className={cn('rounded-full border px-3 py-1 text-xs', periodo === k ? 'border-primary bg-secondary' : 'border-border hover:bg-muted')}>{l}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {tarjeta('Leads recibidos', String(ind.recibidos), `${ind.prospectos} prospectos nuevos · ${ind.consultas} de clientes ya registrados`)}
        {tarjeta('Por contactar', String(ind.porContactar), ind.pendientes ? `${ind.pendientes} aún sin vendedor` : 'Asignados, sin primer contacto', ind.porContactar ? 'text-amber-700' : undefined)}
        {tarjeta('Primer contacto', ind.horasPrimerContacto === null ? '—' : `${ind.horasPrimerContacto} h`, `Promedio desde la asignación · ${ind.contactados} contactados`)}
        {tarjeta('A cotización', `${porcentaje(ind.conCotizacion, ind.prospectos)} %`, `${ind.conCotizacion} de ${ind.prospectos} prospectos`)}
        {tarjeta('A reserva', `${porcentaje(ind.conReserva, ind.prospectos)} %`, `${ind.conReserva} de ${ind.prospectos} prospectos`)}
        {tarjeta('A venta', `${porcentaje(ind.conVenta, ind.prospectos)} %`, `${ind.conVenta} con contrato firmado`)}
      </div>
      <div className="mt-3 grid gap-3 text-xs lg:grid-cols-3">
        <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Por fuente</h3>
          <ul className="grid gap-0.5">{ind.porFuente.map((f) => <li key={f.clave} className="flex justify-between"><span>{FUENTES[f.clave]}</span><b className="tabular-nums">{f.total}</b></li>)}</ul>
        </div>
        <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Por campaña</h3>
          <ul className="grid gap-0.5">{ind.porCampana.slice(0, 6).map((c) => <li key={c.campana} className="flex justify-between gap-2"><span className="truncate">{c.campana}</span><b className="tabular-nums">{c.total}{c.ventas ? ` · ${c.ventas} venta${c.ventas === 1 ? '' : 's'}` : ''}</b></li>)}</ul>
        </div>
        {alcance !== 'propio' ? (
          <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Por vendedor</h3>
            <ul className="grid gap-0.5">{ind.porVendedor.slice(0, 8).map((v) => <li key={v.id} className="flex justify-between gap-2"><span className="truncate">{nombres.get(v.id) ?? 'Vendedor'}</span><b className="tabular-nums">{v.total}{v.porContactar ? <span className="font-normal text-amber-700"> · {v.porContactar} por contactar</span> : ''}</b></li>)}</ul>
          </div>
        ) : (
          <div><h3 className="mb-1 text-xs font-semibold text-slate-600">Por contactar</h3>
            {porContactar.length === 0 ? <p className="text-xs text-slate-600">Todos tus prospectos tienen primer contacto.</p> : (
              <ul className="grid gap-0.5">{porContactar.map((l) => (
                <li key={l.id}><Link className="flex justify-between gap-2 hover:underline" to={`/clientes?cliente=${l.clientId}`}><span className="truncate font-medium">{l.nombre}</span><span className="shrink-0 text-slate-600">{FUENTES[l.fuente]} · {hace(l.asignadoEn ?? l.recibidoEn)}</span></Link></li>
              ))}</ul>
            )}
          </div>
        )}
      </div>
      {can('config.leads') && ind.pendientes > 0 && <p className="mt-2 text-xs text-amber-800">{ind.pendientes} {ind.pendientes === 1 ? 'lead espera' : 'leads esperan'} vendedor disponible. <Link className="underline" to="/configuracion">Ver distribución</Link></p>}
    </section>
  )
}
