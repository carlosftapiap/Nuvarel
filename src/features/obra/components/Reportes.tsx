import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fechaLocalIso } from '../calculos'
import { descargarLibro, nombreArchivo } from '../excel'
import { construirPdfReporte, filasReporte, historialMensual, libroReporte } from '../reportes'
import type { ContextoBase } from '../useObra'
import { fechaCorta, pct } from './ui'

/** Planificado frente a ejecutado, retrasos e historial mensual, descargables en Excel y PDF. */
export default function Reportes({ ctx }: { ctx: ContextoBase }) {
  const { obra, can, usuario } = ctx
  const [fecha, setFecha] = useState(fechaLocalIso())
  const hoy = fechaLocalIso()
  const filas = useMemo(() => filasReporte(obra, fecha), [obra, fecha])
  const historial = useMemo(() => historialMensual(obra, hoy), [obra, hoy])
  const exporta = can('obra.exportar')

  return (
    <div className="grid gap-4">
      <section className="dashboard-card" aria-labelledby="rep-titulo">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rep-titulo" className="text-sm font-semibold">Comparación de avance</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">El planificado sale del cronograma aprobado; sin cronograma o sin ponderaciones aprobadas no se muestra una cifra.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1"><Label htmlFor="rep-fecha" className="text-xs">Fecha de corte</Label><Input id="rep-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value || hoy)} /></div>
            {exporta && (
              <>
                <Button size="sm" variant="outline" onClick={() => descargarLibro(libroReporte(filas, historial, obra.frentes, fecha, usuario), nombreArchivo('Avance-de-obra', 'AMURA', 'xlsx', fecha))}><FileSpreadsheet />Excel</Button>
                <Button size="sm" variant="outline" onClick={() => construirPdfReporte(filas, historial, obra.frentes, fecha, usuario).save(nombreArchivo('Avance-de-obra', 'AMURA', 'pdf', fecha))}><Download />PDF</Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs" aria-label="Comparación de avance por frente">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 text-left font-medium">Frente</th><th className="text-right font-medium">Planificado</th><th className="text-right font-medium">Avance actual</th><th className="text-right font-medium">Desviación</th><th className="text-right font-medium">Con avance</th><th className="text-right font-medium">Retrasadas</th><th className="pl-3 text-left font-medium">Último corte</th></tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.frente.id} className="border-t border-border">
                  <td className="py-2 font-medium">{f.frente.nombre}</td>
                  <td className="text-right tabular-nums">{f.planificado === null ? <span className="text-muted-foreground">Sin cronograma aprobado</span> : pct(f.planificado)}</td>
                  <td className="text-right tabular-nums font-semibold">{pct(f.actual)}</td>
                  <td className={`text-right tabular-nums ${f.desviacion !== null && f.desviacion < 0 ? 'text-rose-700' : ''}`}>{f.desviacion === null ? '—' : `${f.desviacion > 0 ? '+' : ''}${f.desviacion.toLocaleString('es-EC')} pts`}</td>
                  <td className="text-right tabular-nums">{f.conAvance} de {f.actividades}</td>
                  <td className={`text-right tabular-nums ${f.retrasadas.length ? 'text-rose-700' : ''}`}>{f.retrasadas.length}</td>
                  <td className="pl-3 tabular-nums">{fechaCorta(f.ultimoCorte)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-card" aria-labelledby="rep-historial">
        <h2 id="rep-historial" className="text-sm font-semibold">Historial mensual del avance</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Avance a fin de cada mes. Nada se sobrescribe: cada registro se conserva.</p>
        {historial.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Todavía no hay avances.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs" aria-label="Historial mensual">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left font-medium">Corte</th>{obra.frentes.map((f) => <th key={f.id} className="text-right font-medium">{f.nombre}</th>)}</tr></thead>
              <tbody>{historial.map((p) => (
                <tr key={p.fecha} className="border-t border-border"><td className="py-1.5 tabular-nums">{fechaCorta(p.fecha)}</td>{obra.frentes.map((f) => <td key={f.id} className="text-right tabular-nums">{pct(p.valores[f.id] ?? null)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dashboard-card" aria-labelledby="rep-retrasos">
        <h2 id="rep-retrasos" className="text-sm font-semibold">Actividades con retraso al {fechaCorta(fecha)}</h2>
        {filas.every((f) => f.retrasadas.length === 0) ? <p className="mt-3 text-xs text-muted-foreground">No hay actividades con retraso según las fechas registradas.</p> : (
          <ul className="mt-3 divide-y divide-border text-xs">
            {filas.flatMap((f) => f.retrasadas.map((r) => (
              <li key={r.actividad.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span><b>{r.actividad.codigo}</b> {r.actividad.nombre} <span className="text-muted-foreground">· {f.frente.nombre}</span></span><span className="text-rose-700">{r.tipo === 'fin' ? 'Fin previsto vencido' : 'Inicio previsto vencido'} hace {r.dias} día(s)</span></li>
            )))}
          </ul>
        )}
      </section>
    </div>
  )
}
