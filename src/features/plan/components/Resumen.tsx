import { Info } from 'lucide-react'
import { avanceActividad, avanceConsolidado, avanceFrente, fmtAvance, indiceHijas, indicadores, operativas, validarDependencias } from '../calculo'
import type { DatosPlan } from '../api'
import type { Actividad } from '../model'
import { Kpi, fmtFecha } from '../ui'

/** Dashboard del plan. Usa las mismas reglas de cálculo que la lista, el Gantt y la exportación. */
export default function Resumen({ d, acts, onAbrir }: { d: DatosPlan; acts: Actividad[]; onAbrir: (a: Actividad) => void }) {
  const plan = d.plan!
  const k = indicadores(acts, plan.fechaCorte, plan.alertaDias)
  const cons = avanceConsolidado(d.frentes, d.actividades)
  const hijas = indiceHijas(d.actividades)
  const revisar = validarDependencias(d.actividades, d.dependencias)
  const porCodigo = new Map(d.actividades.map((a) => [a.codigo, a]))
  const ops = new Set(operativas(d.actividades).map((a) => a.id))

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Fecha de corte de los indicadores: <b>{fmtFecha(plan.fechaCorte)}</b> · alertas a {plan.alertaDias} días · datos consultados {new Date(d.consultadoEn).toLocaleString('es-EC')}
        {acts.length !== d.actividades.length && <> · conteos según los filtros aplicados ({acts.length} de {d.actividades.length})</>}
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi t="Actividades operativas" v={k.operativas} d="Sin duplicar superiores y subactividades" />
        <Kpi t="Pendientes" v={k.pendientes} />
        <Kpi t="En ejecución" v={k.enEjecucion} />
        <Kpi t="Completadas" v={k.completadas} />
        <Kpi t="Canceladas" v={k.canceladas} />
      </div>
      <div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi t="Atrasadas" v={k.atrasadas} d="Fin vigente antes del corte" tone={k.atrasadas ? 'text-rose-700' : undefined} />
          <Kpi t="Bloqueadas" v={k.bloqueadas} tone={k.bloqueadas ? 'text-orange-700' : undefined} />
          <Kpi t="Próximas a vencer" v={k.proximas} d={`Dentro de ${plan.alertaDias} días`} tone={k.proximas ? 'text-amber-700' : undefined} />
          <Kpi t="Sin responsable" v={k.sinResponsable} d="Abiertas sin usuario vinculado" />
          <Kpi t="Información incompleta" v={k.sinInformacion} d="Faltan fechas, responsable o avance" />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" />Atrasadas, bloqueadas y próximas son condiciones adicionales: una actividad en ejecución puede estar también bloqueada y atrasada.</p>
      </div>

      <section className="dashboard-card !p-0 overflow-x-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h2 className="text-sm font-semibold">Avance ponderado por frente</h2>
          <span className="text-xs text-muted-foreground">Σ(peso × avance) / Σ(pesos), desde las actividades de último nivel</span>
        </div>
        <table className="mt-3 w-full text-xs">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Frente</th><th className="px-2 py-2 text-right font-medium">Peso</th><th className="px-2 py-2 text-right font-medium">Avance</th><th className="px-2 py-2 text-left font-medium">Actividades</th><th className="px-4 py-2 text-left font-medium">Datos faltantes</th></tr>
          </thead>
          <tbody>
            {d.frentes.map((f) => {
              const r = avanceFrente(f.id, d.actividades)
              const sinPeso = r.faltantes.filter((x) => x.motivo === 'sin peso').length
              const sinAvance = r.faltantes.filter((x) => x.motivo === 'sin avance').length
              return (
                <tr key={f.id} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium">{f.nombre}{!f.incluido && <span className="ml-1 text-xs text-muted-foreground">(no incluido)</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{f.peso === null ? <span className="italic text-muted-foreground">Pendiente</span> : `${f.peso}${f.pesoValidado ? '' : ' (sin validar)'}`}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.incluidas.length ? fmtAvance(r) : <span className="font-normal italic text-muted-foreground">Sin actividades</span>}</td>
                  <td className="px-2 py-2 tabular-nums">{r.incluidas.length}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {[sinPeso && `${sinPeso} sin peso`, sinAvance && `${sinAvance} sin avance`].filter(Boolean).join(' · ') || (r.incluidas.length ? '—' : 'Asigna fases a este frente en Configuración del plan')}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-border bg-muted/40">
              <td className="px-4 py-2 font-semibold">Consolidado</td><td />
              <td className="px-2 py-2 text-right font-semibold tabular-nums">{cons.completo ? fmtAvance(cons) : 'No habilitado'}</td>
              <td colSpan={2} className="px-2 py-2 text-xs text-muted-foreground">{cons.completo ? 'Todos los frentes incluidos tienen peso validado y avance calculable.' : cons.bloqueos.slice(0, 4).join(' ') + (cons.bloqueos.length > 4 ? ` (+${cons.bloqueos.length - 4})` : '')}</td>
            </tr>
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted-foreground">Los frentes se calculan por separado (por ejemplo, comercial y construcción). No se asignan pesos iguales automáticamente: un peso faltante deja el resultado como incompleto.</p>
      </section>

      <section className="dashboard-card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 text-sm font-semibold">Fases (grupos del cronograma)</h2>
        <table className="mt-3 w-full text-xs">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr><th className="px-4 py-2 text-left font-medium">Fase</th><th className="px-2 py-2 text-left font-medium">Frente</th><th className="px-2 py-2 text-right font-medium">Actividades</th><th className="px-2 py-2 text-right font-medium">Completadas</th><th className="px-2 py-2 text-right font-medium">Atrasadas</th><th className="px-4 py-2 text-right font-medium">Avance ponderado</th></tr>
          </thead>
          <tbody>
            {d.fases.map((f) => {
              const lista = d.actividades.filter((a) => a.faseId === f.id && ops.has(a.id))
              const raices = d.actividades.filter((a) => a.faseId === f.id && !a.parentId && !a.excluidaAlcance)
              let num = 0, den = 0, completo = raices.length > 0
              for (const a of raices) {
                const r = avanceActividad(a, hijas)
                if (a.peso === null || r.valor === null) { completo = false; continue }
                num += a.peso * r.valor; den += a.peso
              }
              return (
                <tr key={f.id} className="border-t border-border">
                  <td className="px-4 py-2">{f.codigo} {f.nombre}</td>
                  <td className="px-2 py-2 text-muted-foreground">{d.frentes.find((x) => x.id === f.frenteId)?.nombre ?? <span className="italic">Sin frente</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{lista.length}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{lista.filter((a) => a.estado === 'completada').length}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{lista.filter((a) => a.estado !== 'completada' && a.estado !== 'cancelada' && !!a.planFin && a.planFin < plan.fechaCorte).length}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{completo && den > 0 ? fmtAvance({ valor: num / den, completo: true }) : <span className="italic text-muted-foreground">Incompleto</span>}</td>
                </tr>
              )
            })}
            {!d.fases.length && <tr><td colSpan={6} className="px-4 py-3 text-muted-foreground">Todavía no hay fases asignadas. Se toman de la columna de grupo al importar el cronograma.</td></tr>}
          </tbody>
        </table>
      </section>

      {revisar.length > 0 && (
        <section className="dashboard-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Dependencias por confirmar <span className="font-normal text-muted-foreground">({revisar.length})</span></h2>
            <span className="text-xs text-muted-foreground">Revisión recomendada · no bloquea nada</span>
          </div>

          <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            <p><span className="font-medium">Cómo funciona:</span> una dependencia indica que una actividad (la <i>sucesora</i>) empieza cuando termina otra (la <i>predecesora</i>). Por eso la sucesora debe empezar al día siguiente del fin de la predecesora.</p>
            <p><span className="font-medium">Qué muestra esta lista:</span> en estos casos la sucesora empieza el mismo día en que termina la predecesora, o antes. Las fechas vienen del cronograma original. La app no cambia ninguna fecha por su cuenta.</p>
          </div>

          <ul className="mt-3 divide-y divide-border">
            {revisar.slice(0, 40).map((p, i) => {
              const suc = porCodigo.get(p.sucesora)
              const pre = porCodigo.get(p.predecesora)
              return (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs">
                  <button type="button" className="font-mono font-semibold text-primary hover:underline" onClick={() => { if (suc) onAbrir(suc) }}>{p.sucesora}</button>
                  <span className="text-muted-foreground">empieza {fmtFecha(suc?.planInicio ?? null)}</span>
                  <span className="text-muted-foreground">·</span>
                  <button type="button" className="font-mono font-semibold text-primary hover:underline" onClick={() => { if (pre) onAbrir(pre) }}>{p.predecesora}</button>
                  <span className="text-muted-foreground">termina {fmtFecha(pre?.planFin ?? null)}</span>
                </li>
              )
            })}
          </ul>
          {revisar.length > 40 && <p className="mt-2 text-xs text-muted-foreground">Hay {revisar.length - 40} más. La exportación a Excel las incluye todas en la columna Predecesoras.</p>}

          <div className="mt-4 grid gap-1.5 text-xs text-slate-700">
            <p className="font-medium">Cómo resolver cada caso</p>
            <ul className="grid list-disc gap-1 pl-5">
              <li>Si la dependencia no aplica, quítala en el detalle de la actividad (sección <i>Predecesoras</i>).</li>
              <li>Si la fecha de la sucesora debe cambiar, usa <i>Reprogramar</i> en su detalle. La línea base se conserva y el retraso queda visible.</li>
              <li>Si el orden es correcto aunque las fechas se traslapen, no hace falta cambiar nada. La lista solo recuerda revisarlo.</li>
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
