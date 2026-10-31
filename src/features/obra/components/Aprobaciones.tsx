import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldError } from '@/features/inventario/components/shared'
import { gruposPesos, modificadaDesdeAprobacion, pesosCompletos } from '../calculos'
import type { Frente } from '../model'
import { aprobarCronograma, aprobarPesos } from '../remoto'
import type { ContextoBase } from '../useObra'
import { Aviso, fechaHora, Vacio } from './ui'

/** Gerencia y Administración aprueban ponderaciones y cronogramas. El avance ya no requiere una segunda aprobación. */
export default function Aprobaciones({ ctx, frente }: { ctx: ContextoBase; frente: Frente }) {
  return <PanelFrente key={frente.id} ctx={ctx} frente={frente} valida={ctx.can('obra.validar')} />
}

function PanelFrente({ ctx, frente, valida }: { ctx: ContextoBase; frente: Frente; valida: boolean }) {
  const { obra, datos, recargar } = ctx
  const acts = useMemo(() => obra.actividades.filter((a) => a.frenteId === frente.id), [obra.actividades, frente.id])
  const grupos = gruposPesos(acts)
  const completos = pesosCompletos(acts)
  const cronogramas = obra.cronogramas.filter((c) => c.frenteId === frente.id)
  const vigente = cronogramas.find((c) => c.estado === 'aprobado') ?? null
  const distintas = vigente ? acts.filter((a) => a.estado !== 'cancelada' && modificadaDesdeAprobacion(a, vigente.actividades)).length : 0
  const conFechas = acts.some((a) => a.estado !== 'cancelada' && a.planInicio && a.planFin)
  const [motivoPesos, setMotivoPesos] = useState('')
  const [motivoCron, setMotivoCron] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function accion(fn: () => Promise<unknown>, mensaje: string, limpiar: () => void) {
    setError(null); setAviso(null); setOcupado(true)
    try { await fn(); limpiar(); await recargar(); setAviso(mensaje) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  return (
    <section className="dashboard-card" aria-labelledby={`apr-${frente.id}`}>
      <h2 id={`apr-${frente.id}`} className="text-sm font-semibold">{frente.nombre}</h2>
      {acts.length === 0 ? <div className="mt-3"><Vacio titulo="Sin actividades">Carga la plantilla o importa el cronograma.</Vacio></div> : (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="grid content-start gap-2 text-xs">
            <h3 className="font-semibold">Ponderaciones</h3>
            {frente.pesosAprobados
              ? <p className="text-emerald-700">Aprobadas por {frente.pesosAprobadosNombre}{frente.pesosAprobadosEn ? ` el ${fechaHora(frente.pesosAprobadosEn)}` : ''}. Cualquier cambio de ponderación o de estructura exige aprobarlas de nuevo.</p>
              : <p className="text-amber-800">Sin aprobar: mientras tanto el avance del frente es el promedio simple de sus etapas.</p>}
            <ul className="list-disc pl-5 text-muted-foreground">
              {grupos.map((g) => (
                <li key={g.parentId ?? 'raiz'} className={g.completo ? '' : 'text-amber-800'}>
                  {g.parentId ? `Dentro de ${acts.find((a) => a.id === g.parentId)?.codigo ?? ''}` : 'Nivel principal'}: {g.actividades} actividad(es), suman {g.suma.toLocaleString('es-EC')} %{g.completo ? ' ✓' : g.conPeso < g.actividades ? ` — faltan ${g.actividades - g.conPeso} ponderación(es)` : ' — deben sumar 100 %'}
                </li>
              ))}
            </ul>
            {valida && !frente.pesosAprobados && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-48 flex-1 gap-1"><label htmlFor={`mp-${frente.id}`} className="text-[11px]">Motivo de la aprobación</label><Input id={`mp-${frente.id}`} value={motivoPesos} onChange={(e) => setMotivoPesos(e.target.value)} /></div>
                <Button size="sm" disabled={!completos || motivoPesos.trim().length < 5 || ocupado} onClick={() => void accion(() => aprobarPesos(datos, frente.id, motivoPesos.trim()), `Ponderaciones de ${frente.nombre} aprobadas.`, () => setMotivoPesos(''))}>Aprobar ponderaciones</Button>
              </div>
            )}
            {valida && !frente.pesosAprobados && !completos && <p className="text-[11px] text-muted-foreground">Se pueden aprobar cuando todos los niveles suman 100 %.</p>}
          </div>

          <div className="grid content-start gap-2 text-xs">
            <h3 className="font-semibold">Cronograma</h3>
            {vigente
              ? <p>Vigente: versión {vigente.version}, aprobada por {vigente.aprobadoNombre} el {fechaHora(vigente.aprobadoEn)}. {distintas ? <span className="text-amber-800">{distintas} actividad(es) tienen hoy fechas o ponderación distintas.</span> : 'Sin cambios desde la aprobación.'}</p>
              : <p className="text-muted-foreground">Todavía no hay un cronograma aprobado: sin él no se calcula el avance planificado.</p>}
            {cronogramas.length > 1 && <p className="text-muted-foreground">Versiones anteriores: {cronogramas.filter((c) => c.estado === 'reemplazado').map((c) => `v${c.version}`).join(', ')}.</p>}
            {valida && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-48 flex-1 gap-1"><label htmlFor={`mc-${frente.id}`} className="text-[11px]">Motivo de la aprobación</label><Input id={`mc-${frente.id}`} value={motivoCron} onChange={(e) => setMotivoCron(e.target.value)} /></div>
                <Button size="sm" variant="outline" disabled={!conFechas || motivoCron.trim().length < 5 || ocupado} onClick={() => void accion(() => aprobarCronograma(datos, frente.id, motivoCron.trim()), `Cronograma de ${frente.nombre} aprobado.`, () => setMotivoCron(''))}>{vigente ? 'Aprobar nueva versión' : 'Aprobar cronograma'}</Button>
              </div>
            )}
            {valida && !conFechas && <p className="text-[11px] text-muted-foreground">Se puede aprobar cuando haya actividades con fechas previstas.</p>}
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-2"><FieldError>{error}</FieldError><Aviso>{aviso}</Aviso></div>
    </section>
  )
}
