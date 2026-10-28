import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, CalendarClock, CalendarDays, CircleDashed } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { ETAPAS, ETAPAS_EMBUDO, ORIGENES, TIPOS_ACTIVIDAD, type Cliente, type Origen } from '@/features/clientes/model'
import { clientesVisibles, resumenClientes, urgencia, type Urgencia } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import { fmtFechaCorta } from '@/features/financiamiento/plan'

const GRUPOS: { key: Urgencia; titulo: string; icon: typeof AlertCircle; tone: string }[] = [
  { key: 'vencida', titulo: 'Vencidas', icon: AlertCircle, tone: 'text-rose-700' },
  { key: 'hoy', titulo: 'Hoy', icon: CalendarClock, tone: 'text-amber-700' },
  { key: 'semana', titulo: 'Próximos 7 días', icon: CalendarDays, tone: 'text-foreground' },
  { key: 'sin_actividad', titulo: 'Sin siguiente paso', icon: CircleDashed, tone: 'text-muted-foreground' },
]

/** Agenda del asesor y embudo comercial, calculados con los clientes registrados. */
export default function GestionComercialPage() {
  const { state } = useClientes()
  const { actor } = useSession()
  const visibles = useMemo(() => clientesVisibles(state.clientes, actor), [state.clientes, actor])
  const activos = visibles.filter((c) => c.etapa !== 'perdido' && c.etapa !== 'seguimiento')
  const r = resumenClientes(visibles)
  const maxEtapa = Math.max(1, ...ETAPAS_EMBUDO.map((e) => r.porEtapa[e]))
  const porOrigen = Object.entries(ORIGENES).map(([k, l]) => ({ k, l, n: visibles.filter((c) => c.origen === (k as Origen)).length }))
  const proximosRetomar = visibles.filter((c) => c.etapa === 'seguimiento').sort((a, b) => (a.fechaRetomar ?? '').localeCompare(b.fechaRetomar ?? ''))

  return (
    <>
      <PageHeader eyebrow="Seguimiento · Gestión comercial" title="Gestión comercial" subtitle="Qué debe hacer cada asesor hoy para avanzar sus ventas." />
      {visibles.length === 0 ? (
        <div className="module-empty"><h2 className="text-lg font-semibold">Sin clientes registrados</h2><p className="mt-2 text-sm text-muted-foreground">La agenda y el embudo se llenan con los clientes del módulo <Link className="text-primary hover:underline" to="/clientes">Clientes</Link>.</p></div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <section className="dashboard-card p-5" aria-labelledby="gc-agenda">
            <h2 id="gc-agenda" className="text-sm font-semibold">Agenda</h2>
            <div className="mt-3 grid gap-4">
              {GRUPOS.map(({ key, titulo, icon: Icon, tone }) => {
                const lista = activos.filter((c) => urgencia(c) === key).sort((a, b) => (a.proxima?.fecha ?? '').localeCompare(b.proxima?.fecha ?? ''))
                return (
                  <div key={key}>
                    <h3 className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold ${tone}`}><Icon className="size-3.5" />{titulo} <span className="font-normal text-muted-foreground">({lista.length})</span></h3>
                    {lista.length === 0 ? <p className="text-[11px] text-muted-foreground">Nada pendiente.</p> : (
                      <ul className="grid gap-1.5">{lista.map((c) => <Fila key={c.id} c={c} />)}</ul>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
          <div className="grid content-start gap-4">
            <section className="dashboard-card p-5" aria-labelledby="gc-embudo">
              <h2 id="gc-embudo" className="text-sm font-semibold">Embudo comercial</h2>
              <ul className="mt-3 grid gap-2">
                {ETAPAS_EMBUDO.map((e) => (
                  <li key={e} className="grid grid-cols-[92px_1fr_28px] items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{ETAPAS[e].label}</span>
                    <span className="h-2 rounded-full bg-muted"><span className="block h-2 rounded-full" style={{ width: `${(r.porEtapa[e] / maxEtapa) * 100}%`, background: ETAPAS[e].color }} /></span>
                    <b className="text-right tabular-nums">{r.porEtapa[e]}</b>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">Perdidos: {r.porEtapa.perdido} · Seguimiento futuro: {r.porEtapa.seguimiento}</p>
            </section>
            <section className="dashboard-card p-5" aria-labelledby="gc-origen">
              <h2 id="gc-origen" className="text-sm font-semibold">Origen de los clientes</h2>
              <ul className="mt-3 grid gap-1.5 text-xs">{porOrigen.map((o) => <li key={o.k} className="flex justify-between"><span className="text-muted-foreground">{o.l}</span><b className="tabular-nums">{o.n}</b></li>)}</ul>
            </section>
            {proximosRetomar.length > 0 && (
              <section className="dashboard-card p-5" aria-labelledby="gc-futuro">
                <h2 id="gc-futuro" className="text-sm font-semibold">Seguimiento futuro</h2>
                <ul className="mt-3 grid gap-1.5 text-xs">{proximosRetomar.map((c) => <li key={c.id} className="flex justify-between gap-2"><Link className="hover:underline" to={`/clientes?cliente=${c.id}`}>{c.nombre}</Link><span className="text-muted-foreground">{fmtFechaCorta(c.fechaRetomar)}</span></li>)}</ul>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Fila({ c }: { c: Cliente }) {
  return (
    <li>
      <Link to={`/clientes?cliente=${c.id}`} className="flex flex-wrap items-center gap-x-2 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/50">
        <b>{c.nombre}</b>
        <span className="text-muted-foreground">{ETAPAS[c.etapa].label}</span>
        <span className="ml-auto text-muted-foreground">{c.asesor}</span>
        <span className="basis-full text-[11px]">{c.proxima ? `${TIPOS_ACTIVIDAD[c.proxima.tipo]} · ${c.proxima.descripcion} · ${fmtFechaCorta(c.proxima.fecha)}` : 'Programa la siguiente actividad'}</span>
      </Link>
    </li>
  )
}
