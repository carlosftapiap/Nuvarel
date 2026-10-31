import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/features/inventario/components/shared'
import { avanceActualFrente, avanceEtapa, estadoPorAvance, indexar } from '../calculos'
import type { Actividad, Frente } from '../model'
import type { ContextoBase } from '../useObra'
import ActualizarAvance from './ActualizarAvance'
import { Anillo } from './Graficos'
import { Aviso, Barra, EtiquetaEstado, fechaCorta, fechaHora, pct, Vacio } from './ui'

/** Cuatro frentes, cada uno con su avance actual. Abrir Obra → elegir frente → actualizar actividad → guardar → ver el porcentaje. */
export default function Avance({ ctx }: { ctx: ContextoBase }) {
  const { obra, can } = ctx
  const registra = can('obra.avance')
  const [frenteId, setFrenteId] = useState<string | null>(obra.frentes[0]?.id ?? null)
  const [dialogo, setDialogo] = useState<{ frente: Frente; actividad: string | null } | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const frente = obra.frentes.find((f) => f.id === frenteId) ?? obra.frentes[0] ?? null

  const abrir = (f: Frente, actividad: string | null) => { setMensaje(null); setError(null); setFrenteId(f.id); setDialogo({ frente: f, actividad }) }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Frentes de obra">
        {obra.frentes.map((f) => {
          const acts = obra.actividades.filter((a) => a.frenteId === f.id)
          const idx = indexar(acts)
          const etapas = (idx.get(null) ?? [])
          const completas = etapas.filter((e) => avanceEtapa(f, idx, e) >= 100).length
          const actual = avanceActualFrente(f, obra.actividades)
          return (
            <section key={f.id} aria-label={f.nombre} className={`dashboard-card grid justify-items-center gap-2 !p-4 ${f.id === frente?.id ? 'ring-1 ring-primary/40' : ''}`}>
              <button type="button" aria-pressed={f.id === frente?.id} aria-label={`Ver ${f.nombre}`} className="rounded-lg" onClick={() => setFrenteId(f.id)}>
                <Anillo valor={actual} etiqueta={f.nombre} sublabel={etapas.length ? `${completas} de ${etapas.length} etapas` : 'sin etapas'} />
              </button>
              <span className="text-[11px] text-muted-foreground">Avance actual</span>
              <EtiquetaEstado estado={estadoPorAvance({ estado: 'por_programar' }, actual ?? 0)} />
              {registra && <Button size="sm" variant={f.id === frente?.id ? 'default' : 'outline'} aria-label={`Actualizar avance de ${f.nombre}`} onClick={() => abrir(f, null)}>Actualizar avance</Button>}
            </section>
          )
        })}
      </div>

      <div className="grid gap-2 empty:hidden"><FieldError>{error}</FieldError><Aviso>{mensaje}</Aviso></div>

      {frente && <Detalle ctx={ctx} frente={frente} registra={registra} onActualizar={(a) => abrir(frente, a)} />}

      {dialogo && <ActualizarAvance ctx={ctx} frente={dialogo.frente} actividadInicial={dialogo.actividad} onClose={() => setDialogo(null)} onGuardado={(m, e) => { setMensaje(m); setError(e) }} />}
    </div>
  )
}

function Detalle({ ctx, frente, registra, onActualizar }: { ctx: ContextoBase; frente: Frente; registra: boolean; onActualizar: (actividad: string) => void }) {
  const { obra } = ctx
  const acts = useMemo(() => obra.actividades.filter((a) => a.frenteId === frente.id), [obra.actividades, frente.id])
  const idx = useMemo(() => indexar(acts), [acts])
  const porId = useMemo(() => new Map(acts.map((a) => [a.id, a])), [acts])
  const registros = useMemo(() => obra.avances.filter((r) => porId.has(r.actividadId)).slice(0, 60), [obra.avances, porId])
  const etapas = idx.get(null) ?? []
  const responsable = (a: Actividad) => (a.responsableId ? obra.personas.find((p) => p.id === a.responsableId)?.nombre ?? null : a.responsableTexto || null)

  const fila = (a: Actividad, nivel: number) => {
    const v = avanceEtapa(frente, idx, a)
    const hijos = idx.get(a.id) ?? []
    const r = responsable(a)
    return (
      <li key={a.id} className="grid gap-1.5" style={{ paddingLeft: nivel ? 16 : 0 }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={nivel ? '' : 'font-semibold'}>{a.nombre}</span>
          <span className="flex flex-wrap items-center gap-2">
            {r && <span className="text-[11px] text-muted-foreground">{r}</span>}
            <EtiquetaEstado estado={estadoPorAvance(a, v)} />
            <b className="w-14 text-right tabular-nums">{pct(Math.round(v * 100) / 100)}</b>
            {registra && !hijos.length && <Button size="xs" variant="outline" aria-label={`Actualizar ${a.nombre}`} onClick={() => onActualizar(a.id)}>Actualizar</Button>}
          </span>
        </div>
        <Barra valor={v} etiqueta={`${a.nombre}: ${Math.round(v)} por ciento`} tono="bg-emerald-500" />
        {hijos.length > 0 && <ul className="mt-1 grid gap-2">{hijos.map((h) => fila(h, nivel + 1))}</ul>}
      </li>
    )
  }

  return (
    <section className="dashboard-card grid gap-4 p-5" aria-labelledby="av-frente">
      <h2 id="av-frente" className="text-sm font-semibold">{frente.nombre}</h2>
      {etapas.length === 0
        ? <Vacio titulo="Aún no hay etapas">El equipo técnico las define en Opciones avanzadas. No se inventan fechas ni porcentajes.</Vacio>
        : <ul className="grid gap-4" aria-label={`Etapas de ${frente.nombre}`}>{etapas.map((e) => fila(e, 0))}</ul>}
      <details>
        <summary className="cursor-pointer text-xs font-medium">Historial de avances ({registros.length})</summary>
        {registros.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Todavía no hay avances en este frente.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[11px] text-muted-foreground"><tr><th className="py-1 text-left font-medium">Fecha</th><th className="text-left font-medium">Actividad</th><th className="text-right font-medium">Avance</th><th className="pl-3 text-left font-medium">Responsable</th><th className="text-left font-medium">Registró</th><th className="text-left font-medium">Observaciones</th></tr></thead>
              <tbody>
                {registros.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-1.5 tabular-nums">{fechaCorta(r.fechaCorte)}</td>
                    <td className="pr-2">{porId.get(r.actividadId)?.nombre ?? '—'}</td>
                    <td className="text-right tabular-nums">{pct(r.avance)}{r.avanceAnterior !== null && <div className="text-[10px] text-muted-foreground">antes {pct(r.avanceAnterior)}</div>}{r.estado === 'rechazado' && <div className="text-[10px] text-rose-700">no cuenta</div>}{r.estado === 'pendiente' && <div className="text-[10px] text-amber-800">sin incorporar: registrar de nuevo</div>}</td>
                    <td className="pl-3">{r.responsableNombre ?? '—'}</td>
                    <td>{r.registradoNombre}<div className="text-[10px] text-muted-foreground">{fechaHora(r.registradoEn)}</div></td>
                    <td className="max-w-64 text-muted-foreground">{r.observaciones || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  )
}
