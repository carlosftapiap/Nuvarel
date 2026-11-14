import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, IndentDecrease, IndentIncrease, Pencil, Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FieldError } from '@/features/inventario/components/shared'
import { aplanar, avanceEtapa, dia, estadoPorAvance, duracionDias, fechaLocalIso, gruposPesos, indexar, modificadaDesdeAprobacion } from '../calculos'
import { descargarLibro, leerBytes, leerCronograma, libroCronograma, nombreArchivo, type ResultadoLectura } from '../excel'
import { ESTADO_ACTIVIDAD, type Actividad, type EstadoActividad } from '../model'
import { cargarPlantilla, datosDeActividad, guardarActividad } from '../remoto'
import type { ContextoObra } from '../useObra'
import ActividadDialog, { type ModoActividad } from './ActividadDialog'
import ImportarCronograma from './ImportarCronograma'
import { Aviso, EtiquetaEstado, fechaCorta, fechaHora, pct, Vacio } from './ui'

const PX_DIA = 3
const campo = 'h-7 rounded border border-border bg-white px-1 text-xs disabled:bg-transparent disabled:border-transparent'
const porOrden = (a: Actividad, b: Actividad) => a.orden - b.orden || a.codigo.localeCompare(b.codigo, 'es', { numeric: true })

const distinto = (a: Actividad, b: Actividad) =>
  a.codigo !== b.codigo || a.nombre !== b.nombre || a.descripcion !== b.descripcion || a.parentId !== b.parentId || a.orden !== b.orden || a.peso !== b.peso ||
  a.planInicio !== b.planInicio || a.planFin !== b.planFin || a.realInicio !== b.realInicio || a.realFin !== b.realFin || a.responsableId !== b.responsableId ||
  a.responsableTexto !== b.responsableTexto || a.estado !== b.estado || a.observaciones !== b.observaciones

/** Cronograma del frente: tabla editable y diagrama. Los cambios se acumulan en un borrador y se guardan juntos con su motivo. */
export default function Cronograma({ ctx }: { ctx: ContextoObra }) {
  const { obra, frente, can, datos, recargar } = ctx
  const editar = can('obra.editar')
  const base = useMemo(() => obra.actividades.filter((a) => a.frenteId === frente.id), [obra.actividades, frente.id])
  const [trabajo, setTrabajo] = useState<Actividad[]>(base)
  const baseMap = useMemo(() => new Map(base.map((a) => [a.id, a])), [base])
  const cambios = useMemo(() => trabajo.filter((a) => { const b = baseMap.get(a.id); return !!b && distinto(a, b) }), [trabajo, baseMap])
  const sucio = cambios.length > 0
  // Mientras no haya cambios sin guardar, el borrador sigue lo que hay en el servidor.
  useEffect(() => { if (!sucio) setTrabajo(base) }, [base, sucio])

  const [ocultas, setOcultas] = useState<Set<string>>(new Set())
  const [dialogo, setDialogo] = useState<ModoActividad | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [lectura, setLectura] = useState<{ resultado: ResultadoLectura; archivo: string } | null>(null)
  const [motivoPlantilla, setMotivoPlantilla] = useState('Cargar las etapas de la plantilla')
  const entrada = useRef<HTMLInputElement>(null)
  const hoy = fechaLocalIso()

  const filas = useMemo(() => aplanar(trabajo, ocultas), [trabajo, ocultas])
  const idx = useMemo(() => indexar(trabajo), [trabajo])
  const grupos = useMemo(() => gruposPesos(trabajo), [trabajo])
  const incompletos = grupos.filter((g) => !g.completo)
  const personas = useMemo(() => new Map(obra.personas.map((p) => [p.id, p.nombre])), [obra.personas])
  const porId = useMemo(() => new Map(obra.actividades.map((a) => [a.id, a])), [obra.actividades])
  const cronograma = obra.cronogramas.find((c) => c.frenteId === frente.id && c.estado === 'aprobado') ?? null
  const desviadas = cronograma ? base.filter((a) => a.estado !== 'cancelada' && modificadaDesdeAprobacion(a, cronograma.actividades)).length : 0
  const historial = obra.historial.filter((h) => h.frenteId === frente.id).slice(0, 30)

  const patch = (id: string, cambio: Partial<Actividad>) =>
    setTrabajo((t) => t.map((a) => {
      if (a.id !== id) return a
      const n = { ...a, ...cambio }
      return { ...n, duracionDias: n.planInicio && n.planFin ? duracionDias(n.planInicio, n.planFin) : n.duracionDias }
    }))

  const hermanos = (parentId: string | null) => trabajo.filter((a) => a.parentId === parentId).sort(porOrden)
  function mover(id: string, delta: -1 | 1) {
    const a = trabajo.find((x) => x.id === id)
    if (!a) return
    const lista = hermanos(a.parentId)
    const i = lista.findIndex((x) => x.id === id), j = i + delta
    if (j < 0 || j >= lista.length) return
    const otra = lista[j]
    const nuevoA = a.orden !== otra.orden ? otra.orden : otra.orden + delta
    const nuevoB = a.orden !== otra.orden ? a.orden : a.orden
    setTrabajo((t) => t.map((x) => (x.id === a.id ? { ...x, orden: nuevoA } : x.id === otra.id ? { ...x, orden: nuevoB } : x)))
  }
  function sangria(id: string) {
    const a = trabajo.find((x) => x.id === id)
    if (!a) return
    const lista = hermanos(a.parentId).filter((x) => x.estado !== 'cancelada')
    const i = lista.findIndex((x) => x.id === id)
    if (i <= 0) return
    const padre = lista[i - 1]
    const orden = (hermanos(padre.id).at(-1)?.orden ?? 0) + 10
    setTrabajo((t) => t.map((x) => (x.id === id ? { ...x, parentId: padre.id, orden } : x)))
    setOcultas((o) => { const n = new Set(o); n.delete(padre.id); return n })
  }
  function quitarSangria(id: string) {
    const a = trabajo.find((x) => x.id === id)
    const padre = a?.parentId ? trabajo.find((x) => x.id === a.parentId) : null
    if (!a || !padre) return
    setTrabajo((t) => t.map((x) => (x.id === id ? { ...x, parentId: padre.parentId, orden: padre.orden + 1 } : x)))
  }

  async function guardar() {
    setError(null); setAviso(null); setGuardando(true)
    let hechos = 0
    try {
      for (const a of cambios) {
        await guardarActividad(datos, frente.id, a.id, baseMap.get(a.id)!.version, datosDeActividad(a), motivo.trim())
        hechos++
      }
      setMotivo('')
      await recargar()
      setAviso(`Cronograma guardado: ${hechos} actividad(es) actualizada(s). Si cambió una ponderación, las ponderaciones deben volver a aprobarse.`)
    } catch (e) {
      setError(`${(e as Error).message}${hechos ? ` (${hechos} de ${cambios.length} cambios ya se guardaron)` : ''}`)
      await recargar()
    } finally {
      setGuardando(false)
    }
  }

  async function leerArchivo(f: File | undefined) {
    if (!f) return
    setError(null); setAviso(null)
    try {
      const resultado = leerCronograma(await leerBytes(f), new Set(base.map((a) => a.codigo)))
      setLectura({ resultado, archivo: f.name })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (entrada.current) entrada.current.value = ''
    }
  }

  async function plantilla() {
    setError(null); setAviso(null); setGuardando(true)
    try {
      const n = await cargarPlantilla(datos, frente.id, motivoPlantilla.trim())
      await recargar()
      setAviso(`Se cargaron ${n} actividades de la plantilla, sin fechas ni ponderaciones. Puedes editarlas, agregar otras o reorganizarlas.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  /* ----- diagrama */
  const fechas = trabajo.flatMap((a) => [a.planInicio, a.planFin, a.realInicio, a.realFin]).filter((f): f is string => !!f)
  const hayFechas = fechas.length > 0
  const desde = hayFechas ? Math.min(...fechas.map(dia)) - 3 : 0
  const hasta = hayFechas ? Math.max(...fechas.map(dia)) + 7 : 0
  const ancho = hayFechas ? (hasta - desde + 1) * PX_DIA : 0
  const x = (iso: string) => (dia(iso) - desde) * PX_DIA
  const largo = (a: string, b: string) => Math.max(PX_DIA, (dia(b) - dia(a) + 1) * PX_DIA)
  const meses = useMemo(() => {
    if (!hayFechas) return []
    const salida: { etiqueta: string; px: number }[] = []
    const d0 = new Date(desde * 86_400_000)
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth()
    let cursor = desde
    while (cursor <= hasta) {
      const finMes = Math.min(hasta, Date.UTC(y, m + 1, 0) / 86_400_000)
      salida.push({ etiqueta: new Date(Date.UTC(y, m, 1)).toLocaleDateString('es-EC', { month: 'short', year: '2-digit', timeZone: 'UTC' }), px: (finMes - cursor + 1) * PX_DIA })
      cursor = finMes + 1; m++; if (m > 11) { m = 0; y++ }
    }
    return salida
  }, [hayFechas, desde, hasta])
  const hoyEnRango = hayFechas && dia(hoy) >= desde && dia(hoy) <= hasta

  const nombreResp = (a: Actividad) => (a.responsableId ? personas.get(a.responsableId) ?? 'Usuario' : a.responsableTexto || '')

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {frente.pesosAprobados
            ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">Ponderaciones aprobadas por {frente.pesosAprobadosNombre}</span>
            : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Ponderaciones sin aprobar</span>}
          {trabajo.length > 0 && (incompletos.length === 0
            ? <span className="text-emerald-700">Cada nivel suma 100 %</span>
            : <span className="text-amber-800">{incompletos.length} nivel(es) sin completar: {incompletos.slice(0, 3).map((g) => `${g.parentId ? porId.get(g.parentId)?.codigo ?? '' : 'principal'} suma ${g.suma.toLocaleString('es-EC')} %`).join(' · ')}{incompletos.length > 3 ? '…' : ''}</span>)}
          {cronograma && <span className="text-muted-foreground">Cronograma aprobado v{cronograma.version}{desviadas ? ` · ${desviadas} actividad(es) distinta(s)` : ''}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {editar && <Button size="sm" onClick={() => setDialogo({ tipo: 'nueva', parentId: null })}><Plus />Agregar actividad</Button>}
          {can('obra.importar') && (
            <>
              <Button size="sm" variant="outline" onClick={() => entrada.current?.click()}><Upload />Importar Excel</Button>
              <input ref={entrada} type="file" accept=".xlsx,.xls" className="sr-only" aria-label="Archivo de cronograma en Excel" onChange={(e) => void leerArchivo(e.target.files?.[0])} />
            </>
          )}
          {can('obra.exportar') && trabajo.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => descargarLibro(libroCronograma(frente, obra.actividades, obra.personas), nombreArchivo('Cronograma', frente.nombre, 'xlsx', hoy))}><Download />Exportar Excel</Button>
          )}
        </div>
      </div>

      <FieldError>{error}</FieldError>
      <Aviso>{aviso}</Aviso>

      {trabajo.length === 0 ? (
        <Vacio titulo={`${frente.nombre} todavía no tiene actividades`}>
          Las fechas y los porcentajes quedan vacíos hasta que el equipo técnico los defina. Puedes partir de una plantilla editable de etapas o importar el cronograma desde Excel.
          {editar && (
            <div className="mt-4 flex flex-wrap items-end justify-center gap-2 text-left">
              <div className="grid gap-1"><label htmlFor="plantilla-motivo" className="text-xs">Motivo</label><Input id="plantilla-motivo" className="w-72" value={motivoPlantilla} onChange={(e) => setMotivoPlantilla(e.target.value)} /></div>
              <Button size="sm" disabled={guardando || motivoPlantilla.trim().length < 5} onClick={() => void plantilla()}>Cargar etapas de la plantilla</Button>
            </div>
          )}
        </Vacio>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs" aria-label={`Cronograma de ${frente.nombre}`}>
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Actividad</th>
                <th className="px-1 py-2 text-right font-medium">Peso %</th>
                <th className="px-1 py-2 text-left font-medium">Inicio previsto</th>
                <th className="px-1 py-2 text-left font-medium">Fin previsto</th>
                <th className="px-1 py-2 text-right font-medium">Días</th>
                <th className="px-1 py-2 text-left font-medium">Inicio real</th>
                <th className="px-1 py-2 text-left font-medium">Fin real</th>
                <th className="px-1 py-2 text-left font-medium">Responsable</th>
                <th className="px-1 py-2 text-left font-medium">Estado</th>
                <th className="px-1 py-2 text-left font-medium">Avance</th>
                <th className="px-1 py-2 text-left font-medium">Depende de</th>
                {editar && <th className="px-2 py-2 text-right font-medium">Acciones</th>}
                <th className="p-0 text-left font-medium" style={hayFechas ? { width: ancho, minWidth: ancho } : undefined}>
                  {hayFechas ? <div className="flex" aria-label="Meses del diagrama">{meses.map((m, i) => <div key={i} className="shrink-0 border-l border-border px-1 py-2 text-xs capitalize" style={{ width: m.px }}>{m.px > 28 ? m.etiqueta : ''}</div>)}</div> : <span className="px-2">Diagrama</span>}
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ actividad: a, nivel, tieneHijos }) => {
                const cancelada = a.estado === 'cancelada'
                const actual = cancelada ? null : avanceEtapa(frente, idx, a)
                const preds = obra.dependencias.filter((d) => d.sucesoraId === a.id).map((d) => porId.get(d.predecesoraId)?.codigo).filter(Boolean).join(', ')
                const modificada = trabajo.length > 0 && baseMap.get(a.id) && distinto(a, baseMap.get(a.id)!)
                return (
                  <tr key={a.id} className={`border-t border-border ${cancelada ? 'text-muted-foreground' : ''} ${modificada ? 'bg-amber-50/60' : ''}`}>
                    <td className="px-3 py-1" style={{ paddingLeft: 12 + nivel * 18 }}>
                      <div className="flex items-center gap-1">
                        {tieneHijos
                          ? <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={ocultas.has(a.id) ? `Expandir ${a.codigo}` : `Contraer ${a.codigo}`} onClick={() => setOcultas((o) => { const n = new Set(o); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })}>{ocultas.has(a.id) ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}</button>
                          : <span className="inline-block w-5" />}
                        <span className="min-w-0"><b className="tabular-nums">{a.codigo}</b> <span className={cancelada ? 'line-through' : ''}>{a.nombre}</span></span>
                      </div>
                    </td>
                    <td className="px-1 py-1 text-right">
                      <input type="number" min="0" max="100" step="0.01" className={`${campo} w-16 text-right tabular-nums`} aria-label={`Ponderación de ${a.codigo}`} disabled={!editar || cancelada}
                        value={a.peso ?? ''} placeholder="—" onChange={(e) => patch(a.id, { peso: e.target.value === '' ? null : Number(e.target.value) })} />
                    </td>
                    {(['planInicio', 'planFin'] as const).map((k) => (
                      <td key={k} className="px-1 py-1">
                        <input type="date" className={`${campo} w-[8.2rem]`} aria-label={`${k === 'planInicio' ? 'Inicio previsto' : 'Fin previsto'} de ${a.codigo}`} disabled={!editar || cancelada}
                          value={a[k] ?? ''} onChange={(e) => patch(a.id, { [k]: e.target.value || null })} />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-right tabular-nums">{a.planInicio && a.planFin ? duracionDias(a.planInicio, a.planFin) : a.duracionDias ?? '—'}</td>
                    {(['realInicio', 'realFin'] as const).map((k) => (
                      <td key={k} className="px-1 py-1">
                        <input type="date" className={`${campo} w-[8.2rem]`} aria-label={`${k === 'realInicio' ? 'Inicio real' : 'Fin real'} de ${a.codigo}`} disabled={!editar || cancelada}
                          value={a[k] ?? ''} onChange={(e) => patch(a.id, { [k]: e.target.value || null })} />
                      </td>
                    ))}
                    <td className="max-w-32 truncate px-1 py-1" title={nombreResp(a)}>{nombreResp(a) || <span className="text-muted-foreground">Sin responsable</span>}</td>
                    <td className="px-1 py-1">
                      {editar && !cancelada
                        ? <select className={`${campo} w-28`} aria-label={`Estado de ${a.codigo}`} value={a.estado} onChange={(e) => patch(a.id, { estado: e.target.value as EstadoActividad })}>
                            {(Object.keys(ESTADO_ACTIVIDAD) as EstadoActividad[]).map((e) => <option key={e} value={e}>{ESTADO_ACTIVIDAD[e].label}</option>)}
                          </select>
                        : <EtiquetaEstado estado={estadoPorAvance(a, actual ?? 0)} />}
                    </td>
                    <td className="whitespace-nowrap px-1 py-1 tabular-nums">
                      {pct(actual, '—')}
                    </td>
                    <td className="max-w-24 truncate px-1 py-1 text-muted-foreground" title={preds}>{preds || '—'}</td>
                    {editar && (
                      <td className="px-2 py-1">
                        <div className="flex justify-end gap-0.5">
                          <Button size="icon-xs" variant="ghost" aria-label={`Subir ${a.codigo}`} onClick={() => mover(a.id, -1)}><ArrowUp /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Bajar ${a.codigo}`} onClick={() => mover(a.id, 1)}><ArrowDown /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Convertir ${a.codigo} en subactividad`} onClick={() => sangria(a.id)}><IndentIncrease /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Subir ${a.codigo} de nivel`} onClick={() => quitarSangria(a.id)}><IndentDecrease /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Agregar subactividad a ${a.codigo}`} onClick={() => setDialogo({ tipo: 'nueva', parentId: a.id })}><Plus /></Button>
                          <Button size="icon-xs" variant="ghost" aria-label={`Editar ${a.codigo}`} onClick={() => setDialogo({ tipo: 'editar', actividad: a })}><Pencil /></Button>
                        </div>
                      </td>
                    )}
                    <td className="p-0" style={hayFechas ? { width: ancho, minWidth: ancho } : undefined}>
                      {hayFechas && (
                        <div className="relative h-8">
                          {a.planInicio && a.planFin && (
                            <div className="absolute top-1 h-3 overflow-hidden rounded bg-sky-200" style={{ left: x(a.planInicio), width: largo(a.planInicio, a.planFin) }} title={`Previsto ${fechaCorta(a.planInicio)} – ${fechaCorta(a.planFin)}`}>
                              <div className="h-full bg-sky-500" style={{ width: `${actual ?? 0}%` }} />
                            </div>
                          )}
                          {a.realInicio && <div className="absolute bottom-1 h-2 rounded bg-slate-700" style={{ left: x(a.realInicio), width: largo(a.realInicio, a.realFin ?? (hoy < a.realInicio ? a.realInicio : hoy)) }} title={`Real desde ${fechaCorta(a.realInicio)}${a.realFin ? ` hasta ${fechaCorta(a.realFin)}` : ' (en curso)'}`} />}
                          {hoyEnRango && <div className="absolute inset-y-0 w-px bg-rose-400" style={{ left: x(hoy) }} aria-hidden="true" />}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {hayFechas
              ? 'Diagrama: barra clara = previsto (relleno = avance actual) · barra oscura = real · línea roja = hoy.'
              : 'El diagrama aparece cuando se definan fechas. Las fechas pueden quedar vacías mientras no estén programadas.'}
          </p>
        </div>
      )}

      {sucio && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-end gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 shadow-md" role="region" aria-label="Cambios sin guardar">
          <p className="mr-auto text-xs font-medium text-amber-900">{cambios.length} actividad(es) con cambios sin guardar</p>
          <div className="grid min-w-64 gap-1"><label htmlFor="cronograma-motivo" className="text-xs text-amber-900">Motivo del cambio *</label><Input id="cronograma-motivo" className="bg-white" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <Button size="sm" variant="outline" disabled={guardando} onClick={() => { setTrabajo(base); setMotivo(''); setError(null) }}>Descartar</Button>
          <Button size="sm" disabled={guardando || motivo.trim().length < 5} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
      )}

      {historial.length > 0 && (
        <details className="dashboard-card">
          <summary className="cursor-pointer text-sm font-semibold">Historial de actualizaciones</summary>
          <ul className="mt-3 divide-y divide-border text-xs">
            {historial.map((h) => (
              <li key={h.id} className="grid gap-0.5 py-2 sm:grid-cols-[10rem_1fr_9rem]">
                <span className="font-medium">{h.accion}{h.actividadId && porId.get(h.actividadId) ? ` · ${porId.get(h.actividadId)!.codigo}` : ''}</span>
                <span className="text-muted-foreground">{h.motivo}</span>
                <span className="text-muted-foreground sm:text-right">{h.usuario} · {fechaHora(h.fecha)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dialogo && <ActividadDialog ctx={ctx} modo={dialogo} trabajo={trabajo} onAplicar={(id, p) => patch(id, p)} onClose={() => setDialogo(null)} />}
      {lectura && <ImportarCronograma ctx={ctx} lectura={lectura.resultado} archivo={lectura.archivo} onClose={() => setLectura(null)} onHecho={(m) => { setAviso(m); setError(null) }} />}
    </div>
  )
}
