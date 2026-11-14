import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { List, Search } from 'lucide-react'
import Aviso from '@/components/Aviso'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ClienteFormDialog from '@/features/clientes/components/ClienteFormDialog'
import ClienteSheet from '@/features/clientes/components/ClienteSheet'
import MoverEtapaDialog from '@/features/clientes/components/MoverEtapaDialog'
import TableroPipeline from '@/features/clientes/components/TableroPipeline'
import { ETAPAS, ETAPAS_EMBUDO, ORIGENES, type Cliente, type Etapa, type Origen } from '@/features/clientes/model'
import { clientesVisibles, moverEtapa, resumenClientes } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { useInventory } from '@/features/inventario/store'
import { cn } from '@/lib/utils'

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Pipeline: las oportunidades de cada cliente por etapa comercial, con el embudo, el origen y el seguimiento futuro a la vista. */
export default function GestionComercialPage() {
  const { state, guardar } = useClientes()
  const { state: inv } = useInventory()
  const { actor } = useSession()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [asesor, setAsesor] = useState('todos')
  const [cerrados, setCerrados] = useState(false)
  const [pedido, setPedido] = useState<{ id: string; nombre: string; etapa: Etapa } | null>(null)
  const [form, setForm] = useState<{ open: boolean; id?: string }>({ open: false })
  const [aviso, setAviso] = useState<string | null>(null)
  const cerrarAviso = useCallback(() => setAviso(null), [])
  const [error, setError] = useState<string | null>(null)
  const visibles = useMemo(() => clientesVisibles(state.clientes, actor), [state.clientes, actor])
  const asesores = useMemo(() => [...new Set(visibles.map((c) => c.asesor))].sort(), [visibles])
  const filtrados = visibles.filter((c) => (asesor === 'todos' || c.asesor === asesor) && (!q.trim() || norm(`${c.nombre} ${c.telefono} ${c.unidadesInteres.join(' ')}`).includes(norm(q.trim()))))
  const r = resumenClientes(filtrados)
  const maxEtapa = Math.max(1, ...ETAPAS_EMBUDO.map((e) => r.porEtapa[e]))
  const porOrigen = Object.entries(ORIGENES).map(([k, l]) => ({ k, l, n: filtrados.filter((c) => c.origen === (k as Origen)).length })).filter((o) => o.n > 0)
  const proximosRetomar = filtrados.filter((c) => c.etapa === 'seguimiento').sort((a, b) => (a.fechaRetomar ?? '').localeCompare(b.fechaRetomar ?? ''))
  const dpt = (codigo: string) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? codigo
  const abierta = params.get('cliente')
  const abrir = (id: string) => setParams((p) => { p.set('cliente', id); return p })

  async function mover(c: Cliente, etapa: Etapa) {
    setError(null)
    if (c.etapa === etapa) return
    if (etapa === 'perdido' || etapa === 'seguimiento') return setPedido({ id: c.id, nombre: c.nombre, etapa })
    try {
      await guardar((s) => moverEtapa(s, c.id, etapa, actor))
      setAviso(`${c.nombre} → ${ETAPAS[etapa].label}`)
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <>
      <PageHeader eyebrow="Comercial" title="Pipeline" subtitle="Cada cliente en su etapa comercial. Arrastra una tarjeta para cambiarla de etapa; las acciones rápidas no abren la ficha."
        actions={<Button variant="outline" asChild><Link to="/clientes"><List />Lista de trabajo</Link></Button>} />
      {visibles.length === 0 ? (
        <div className="module-empty"><h2 className="text-lg font-semibold">Sin clientes registrados</h2><p className="mt-2 text-sm text-muted-foreground">El pipeline se llena con los clientes del módulo <Link className="text-primary hover:underline" to="/clientes">Clientes</Link>.</p></div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <section aria-label="Embudo comercial" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {ETAPAS_EMBUDO.map((e) => (
              <div key={e} className="rounded-xl border border-border bg-white px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><i className="size-2 rounded-full" style={{ background: ETAPAS[e].color }} aria-hidden="true" />{ETAPAS[e].label}</div>
                <div className="mt-1 text-xl font-semibold tabular-nums">{r.porEtapa[e]}</div>
                <div className="mt-1.5 h-1 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(r.porEtapa[e] / maxEtapa) * 100}%`, background: ETAPAS[e].color }} /></div>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[min(100%,260px)] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <label htmlFor="pipe-q" className="sr-only">Buscar en el pipeline</label>
              <Input id="pipe-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, celular o departamento" className="h-10 bg-white pl-9 text-sm" />
            </div>
            {asesores.length > 1 && (
              <Select value={asesor} onValueChange={setAsesor}>
                <SelectTrigger className="h-10 min-w-44 bg-white text-[13px]" aria-label="Filtrar por vendedor"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="todos">Vendedor: todos</SelectItem>{asesores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Button variant="outline" className={cn('h-10', cerrados && 'border-primary text-primary')} aria-pressed={cerrados} onClick={() => setCerrados(!cerrados)}>
              {cerrados ? 'Ocultar' : 'Ver'} seguimiento futuro y perdidos
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}

          <TableroPipeline clientes={filtrados} etapas={cerrados ? [...ETAPAS_EMBUDO, 'seguimiento', 'perdido'] : ETAPAS_EMBUDO} dpt={dpt} onAbrir={abrir} onMover={(c, e) => void mover(c, e)} onMessage={setAviso} />

          <div className="grid gap-4 md:grid-cols-2">
            <section className="dashboard-card p-5" aria-labelledby="gc-origen">
              <h2 id="gc-origen" className="text-sm font-semibold">Origen de los clientes</h2>
              <ul className="mt-3 grid gap-1.5 text-[13px]">{porOrigen.map((o) => <li key={o.k} className="flex justify-between"><span className="text-slate-600">{o.l}</span><b className="tabular-nums">{o.n}</b></li>)}</ul>
              <p className="mt-3 border-t border-border pt-2 text-xs text-slate-600">Perdidos: {r.porEtapa.perdido} · Seguimiento futuro: {r.porEtapa.seguimiento}</p>
            </section>
            <section className="dashboard-card p-5" aria-labelledby="gc-futuro">
              <h2 id="gc-futuro" className="text-sm font-semibold">Seguimiento futuro</h2>
              {proximosRetomar.length ? (
                <ul className="mt-3 grid gap-1.5 text-[13px]">{proximosRetomar.map((c) => <li key={c.id} className="flex justify-between gap-2"><button type="button" className="text-left hover:underline" onClick={() => abrir(c.id)}>{c.nombre}</button><span className="text-slate-600">{fmtFechaCorta(c.fechaRetomar)}</span></li>)}</ul>
              ) : <p className="mt-2 text-xs text-slate-600">Ningún cliente espera retomarse más adelante.</p>}
            </section>
          </div>
        </div>
      )}
      <Aviso texto={aviso} onClose={cerrarAviso} />
      <ClienteSheet id={abierta} onClose={() => setParams((p) => { p.delete('cliente'); return p })} onEdit={(id) => setForm({ open: true, id })} onMessage={setAviso}
        onPedirEtapa={(id, etapa) => { const c = state.clientes.find((x) => x.id === id); if (c) setPedido({ id, nombre: c.nombre, etapa }) }} />
      <ClienteFormDialog open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))} cliente={form.id ? state.clientes.find((c) => c.id === form.id) : undefined} onSaved={(_id, m) => setAviso(m)} />
      <MoverEtapaDialog pedido={pedido} onClose={() => setPedido(null)} onDone={setAviso} />
    </>
  )
}
