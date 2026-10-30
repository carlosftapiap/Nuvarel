import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Columns3, List, Search, UserPlus, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ClienteFormDialog from '@/features/clientes/components/ClienteFormDialog'
import ClienteSheet, { EtapaBadge } from '@/features/clientes/components/ClienteSheet'
import ImportarLocal from '@/features/clientes/components/ImportarLocalDialog'
import MoverEtapaDialog from '@/features/clientes/components/MoverEtapaDialog'
import { ETAPA_ORDEN, ETAPAS, ORIGENES, TIPOS_ACTIVIDAD, type Cliente, type Etapa } from '@/features/clientes/model'
import { clientesVisibles, moverEtapa, resumenClientes, urgencia } from '@/features/clientes/service'
import { useClientes } from '@/features/clientes/store'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { cn } from '@/lib/utils'

const norm = (v: string) => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function ClientesPage() {
  const { state, guardar, cargando, faltaMigracion } = useClientes()
  const { state: inv } = useInventory()
  const { actor } = useSession()
  const [params, setParams] = useSearchParams()
  const [vista, setVista] = useState<'tablero' | 'lista'>('tablero')
  const [q, setQ] = useState('')
  const [asesor, setAsesor] = useState('todos')
  const [form, setForm] = useState<{ open: boolean; id?: string }>({ open: false })
  const [pedido, setPedido] = useState<{ id: string; nombre: string; etapa: Etapa } | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)

  const abierta = params.get('cliente')
  const abrir = (id: string) => setParams((p) => { p.set('cliente', id); return p })
  const cerrar = () => setParams((p) => { p.delete('cliente'); return p })

  const visibles = useMemo(() => clientesVisibles(state.clientes, actor), [state.clientes, actor])
  const asesores = useMemo(() => [...new Set(visibles.map((c) => c.asesor))].sort(), [visibles])
  const filtrados = visibles.filter((c) =>
    (asesor === 'todos' || c.asesor === asesor) &&
    (!q.trim() || norm(`${c.nombre} ${c.telefono} ${c.email} ${c.unidadesInteres.join(' ')}`).includes(norm(q.trim()))),
  )
  const r = resumenClientes(visibles)

  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t) }, [aviso])

  async function mover(c: Cliente, etapa: Etapa) {
    setError(null)
    if (c.etapa === etapa) return
    if (etapa === 'perdido' || etapa === 'seguimiento') return setPedido({ id: c.id, nombre: c.nombre, etapa })
    try {
      await guardar((s) => moverEtapa(s, c.id, etapa, actor))
      setAviso(`${c.nombre} → ${ETAPAS[etapa].label}`)
    } catch (e) { setError((e as Error).message) }
  }
  const dpt = (codigo: string) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? codigo

  return (
    <>
      <PageHeader eyebrow="Ventas · Clientes" title="Clientes"
        subtitle="Quién está interesado, qué departamento busca y cuál es el siguiente paso para cerrar la venta."
        actions={<Button size="sm" onClick={() => setForm({ open: true })}><UserPlus />Nuevo cliente</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi t="Clientes activos" v={r.activos} d={`${r.total} registrados`} />
        <Kpi t="Actividades vencidas" v={r.vencidas} d="Requieren atención" tone={r.vencidas ? 'text-rose-700' : undefined} />
        <Kpi t="Para hoy" v={r.hoy} d="Actividades programadas" />
        <Kpi t="Sin próxima actividad" v={r.sinActividad} d="Clientes activos sin siguiente paso" tone={r.sinActividad ? 'text-amber-700' : undefined} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="cli-q" className="sr-only">Buscar cliente</label>
          <Input id="cli-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono, correo o departamento" className="h-8 pl-8 text-xs" />
        </div>
        <Select value={asesor} onValueChange={setAsesor}>
          <SelectTrigger size="sm" className="h-8 min-w-40 text-xs" aria-label="Filtrar por asesor"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Asesor: todos</SelectItem>{asesores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
          <Button size="sm" variant={vista === 'tablero' ? 'secondary' : 'ghost'} aria-pressed={vista === 'tablero'} onClick={() => setVista('tablero')}><Columns3 />Tablero</Button>
          <Button size="sm" variant={vista === 'lista' ? 'secondary' : 'ghost'} aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}><List />Lista</Button>
        </div>
      </div>

      {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}<button type="button" className="ml-auto" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X className="size-3.5" /></button></p>}
      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}

      {faltaMigracion && (
        <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          La base de datos todavía no tiene las funciones de Clientes: puedes consultar, pero no guardar. Falta aplicar la migración <code>20261031000000_clientes_crm.sql</code>. Tus datos locales siguen intactos.
        </p>
      )}
      <ImportarLocal onMessage={setAviso} />

      {cargando ? (
        <p className="p-6 text-sm text-muted-foreground">Cargando clientes…</p>
      ) : visibles.length === 0 ? (
        <div className="module-empty">
          <span className="module-empty-icon"><UserPlus className="size-7" aria-hidden="true" /></span>
          <h2 className="text-xl font-semibold tracking-tight">Aún no hay clientes</h2>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">Registra el primer interesado para empezar a darle seguimiento.</p>
          <Button className="mt-6" onClick={() => setForm({ open: true })}><UserPlus />Nuevo cliente</Button>
        </div>
      ) : vista === 'tablero' ? (
        <div className="flex gap-3 overflow-x-auto pb-3" aria-label="Tablero comercial">
          {ETAPA_ORDEN.map((etapa) => {
            const col = filtrados.filter((c) => c.etapa === etapa)
            return (
              <section key={etapa} aria-label={`${ETAPAS[etapa].label}: ${col.length} clientes`}
                className={cn('flex w-64 shrink-0 flex-col rounded-xl border border-border bg-muted/40 transition-colors', arrastrando && 'border-dashed')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const c = state.clientes.find((x) => x.id === e.dataTransfer.getData('text/plain')); setArrastrando(null); if (c) void mover(c, etapa) }}>
                <header className="flex items-center gap-2 px-3 py-2.5">
                  <span className="size-2 rounded-full" style={{ background: ETAPAS[etapa].color }} />
                  <h2 className="text-xs font-semibold">{ETAPAS[etapa].label}</h2>
                  <span className="ml-auto rounded-full bg-background px-1.5 text-[10px] text-muted-foreground">{col.length}</span>
                </header>
                <div className="grid min-h-24 content-start gap-2 px-2 pb-2">
                  {col.map((c) => {
                    const u = urgencia(c)
                    return (
                      <button key={c.id} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); setArrastrando(c.id) }} onDragEnd={() => setArrastrando(null)}
                        onClick={() => abrir(c.id)} aria-label={`Abrir ficha de ${c.nombre}`}
                        className="grid gap-1 rounded-lg border border-border bg-card p-2.5 text-left text-xs shadow-xs transition hover:-translate-y-px hover:shadow-sm">
                        <span className="font-semibold">{c.nombre}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {c.unidadesInteres.length ? c.unidadesInteres.map(dpt).join(', ') : 'Sin departamento'}{c.presupuesto ? ` · ${fmtUsd(c.presupuesto)}` : ''}
                        </span>
                        {c.proxima ? (
                          <span className={cn('flex items-center gap-1 text-[11px]', u === 'vencida' ? 'font-medium text-rose-700' : u === 'hoy' ? 'font-medium text-amber-700' : 'text-muted-foreground')}>
                            <CalendarClock className="size-3" />{TIPOS_ACTIVIDAD[c.proxima.tipo]} · {fmtFechaCorta(c.proxima.fecha)}
                          </span>
                        ) : etapa !== 'perdido' && <span className="text-[11px] text-amber-700">Sin próxima actividad</span>}
                        {etapa === 'perdido' && <span className="line-clamp-2 text-[11px] text-rose-700">{c.motivoPerdida}</span>}
                        <span className="text-[10px] text-muted-foreground">{c.asesor} · {ORIGENES[c.origen]}</span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-[11px] text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Etapa</th><th className="px-2 py-2 text-left font-medium">Interés</th><th className="px-2 py-2 text-left font-medium">Origen</th><th className="px-2 py-2 text-left font-medium">Asesor</th><th className="px-4 py-2 text-left font-medium">Próxima actividad</th></tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-muted/50" tabIndex={0} onClick={() => abrir(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') abrir(c.id) }} aria-label={`Abrir ficha de ${c.nombre}`}>
                  <td className="px-4 py-2"><div className="font-semibold">{c.nombre}</div><div className="text-[11px] text-muted-foreground">{c.telefono || c.email}</div></td>
                  <td className="px-2 py-2"><EtapaBadge etapa={c.etapa} /></td>
                  <td className="px-2 py-2">{c.unidadesInteres.map(dpt).join(', ') || '—'}{c.presupuesto ? <div className="text-[11px] text-muted-foreground">{fmtUsd(c.presupuesto)}</div> : null}</td>
                  <td className="px-2 py-2">{ORIGENES[c.origen]}</td>
                  <td className="px-2 py-2">{c.asesor}</td>
                  <td className={cn('px-4 py-2', urgencia(c) === 'vencida' && 'font-medium text-rose-700')}>{c.proxima ? `${TIPOS_ACTIVIDAD[c.proxima.tipo]} · ${fmtFechaCorta(c.proxima.fecha)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClienteSheet id={abierta} onClose={cerrar} onEdit={(id) => setForm({ open: true, id })} onMessage={setAviso}
        onPedirEtapa={(id, etapa) => { const c = state.clientes.find((x) => x.id === id); if (c) setPedido({ id, nombre: c.nombre, etapa }) }} />
      <ClienteFormDialog open={form.open} onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))}
        cliente={form.id ? state.clientes.find((c) => c.id === form.id) : undefined}
        onSaved={(id, m) => { setAviso(m); if (!form.id) abrir(id) }} />
      <MoverEtapaDialog pedido={pedido} onClose={() => setPedido(null)} onDone={setAviso} />
    </>
  )
}

function Kpi({ t, v, d, tone }: { t: string; v: number; d: string; tone?: string }) {
  return (
    <div className="dashboard-card !p-4">
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{v}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{d}</div>
    </div>
  )
}
