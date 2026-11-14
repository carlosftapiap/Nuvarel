import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Link2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import * as api from '../api'
import { avanceActividad, duracion, finalizacionTardia, indiceHijas, retrasoBase, semaforo } from '../calculo'
import type { Actividad, Evidencia, Historial } from '../model'
import { EstadoBadge, SemaforoBadge, fmtFecha, fmtPct, nombreResponsable } from '../ui'

export type Accion = 'editar' | 'avance' | 'reprogramar' | 'asignar' | 'peso' | 'cerrar' | 'reabrir' | 'cancelar' | 'bloquear' | 'desbloquear' | 'excluir' | 'incluir' | 'evidencia'

const TITULO: Record<Accion, string> = {
  editar: 'Editar datos', avance: 'Actualizar avance', reprogramar: 'Reprogramar', asignar: 'Asignar responsable', peso: 'Modificar peso', cerrar: 'Cerrar actividad',
  reabrir: 'Reabrir actividad', cancelar: 'Cancelar actividad', bloquear: 'Registrar bloqueo', desbloquear: 'Quitar bloqueo',
  excluir: 'Excluir del cálculo', incluir: 'Volver a incluir en el cálculo', evidencia: 'Agregar evidencia',
}

interface Props {
  d: api.DatosPlan
  a: Actividad | null
  datos: Datos
  puede: (permiso: string, a: Actividad) => boolean
  onAccion: (a: Actividad, accion: Accion) => void
  onClose: () => void
  version: number
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>
}

/** Panel de detalle: datos, plazos, dependencias, acciones permitidas, evidencias e historial. */
export default function DetalleActividad({ d, a, datos, puede, onAccion, onClose, version }: Props) {
  const [hist, setHist] = useState<Historial[] | null>(null)
  const [evs, setEvs] = useState<Evidencia[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!a) return
    let vivo = true
    setHist(null); setEvs(null); setError(null)
    Promise.all([api.historial(datos, a.id), api.evidencias(datos, a.id)])
      .then(([h, e]) => { if (vivo) { setHist(h); setEvs(e) } })
      .catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
  }, [a, datos, version])

  if (!a) return <Sheet open={false} onOpenChange={onClose}><SheetContent /></Sheet>
  const plan = d.plan!
  const personas = new Map(d.personas.map((p) => [p.id, p.nombre]))
  const porId = new Map(d.actividades.map((x) => [x.id, x]))
  const hijas = indiceHijas(d.actividades)
  const esPadre = (hijas.get(a.id) ?? []).length > 0
  const preds = d.dependencias.filter((x) => x.sucesoraId === a.id).map((x) => porId.get(x.predecesoraId)).filter((x): x is Actividad => !!x)
  const sucs = d.dependencias.filter((x) => x.predecesoraId === a.id).map((x) => porId.get(x.sucesoraId)).filter((x): x is Actividad => !!x)
  const fase = d.fases.find((f) => f.id === a.faseId)
  const frente = d.frentes.find((f) => f.id === a.frenteId)
  const abierta = a.estado !== 'completada' && a.estado !== 'cancelada'
  const retraso = retrasoBase(a)
  const tardia = finalizacionTardia(a)
  const acciones: { accion: Accion; permiso: string; visible: boolean }[] = [
    { accion: 'editar', permiso: 'plan.editar', visible: true },
    { accion: 'avance', permiso: 'plan.avance', visible: abierta && !esPadre },
    { accion: 'reprogramar', permiso: 'plan.reprogramar', visible: abierta },
    { accion: 'asignar', permiso: 'plan.asignar', visible: true },
    { accion: 'peso', permiso: 'plan.alcance', visible: true },
    { accion: 'evidencia', permiso: 'plan.avance', visible: true },
    { accion: a.bloqueada ? 'desbloquear' : 'bloquear', permiso: 'plan.avance', visible: abierta },
    { accion: 'cerrar', permiso: 'plan.cerrar', visible: abierta },
    { accion: 'cancelar', permiso: 'plan.cerrar', visible: abierta },
    { accion: 'reabrir', permiso: 'plan.cerrar', visible: !abierta },
    { accion: a.excluidaAlcance ? 'incluir' : 'excluir', permiso: 'plan.alcance', visible: a.estado === 'cancelada' },
  ]
  const disponibles = acciones.filter((x) => x.visible && puede(x.permiso, a))

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base"><span className="font-mono">{a.codigo}</span> · {a.nombre}</SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-1.5">
                <EstadoBadge estado={a.estado} bloqueada={a.bloqueada} /><SemaforoBadge s={semaforo(a, plan.fechaCorte, plan.alertaDias)} />
                {a.tipo === 'hito' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-inset ring-violet-200">Hito</span>}
              </SheetDescription>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
        </SheetHeader>
        <div className="grid gap-5 px-5 py-4">
          {disponibles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {disponibles.map((x) => <Button key={x.accion} size="sm" variant={x.accion === 'avance' ? 'default' : 'outline'} onClick={() => onAccion(a, x.accion)}>{TITULO[x.accion]}</Button>)}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3">
            <Campo label="Frente">{frente?.nombre ?? <i className="text-muted-foreground">Sin frente</i>}</Campo>
            <Campo label="Fase">{fase ? `${fase.codigo} ${fase.nombre}` : <i className="text-muted-foreground">Sin fase</i>}</Campo>
            <Campo label="Responsable">{nombreResponsable(a, personas)}</Campo>
            <Campo label="Aprueba / valida">{a.aprobadorTexto ?? <i className="text-muted-foreground">Pendiente</i>}</Campo>
            <Campo label="Avance">{esPadre ? `${fmtPct(avanceActividad(a, hijas).valor)} (calculado)` : fmtPct(a.avance)}</Campo>
            <Campo label="Peso">{a.peso ?? <i className="text-muted-foreground">Pendiente</i>}</Campo>
            <Campo label="Línea base">{fmtFecha(a.baseInicio)} – {fmtFecha(a.baseFin)}</Campo>
            <Campo label="Vigente">{fmtFecha(a.planInicio)} – {fmtFecha(a.planFin)} {duracion(a.planInicio, a.planFin) !== null && <span className="text-muted-foreground">({duracion(a.planInicio, a.planFin)} d)</span>}</Campo>
            <Campo label="Real">{a.realInicio || a.realFin ? `${fmtFecha(a.realInicio)} – ${a.realFin ? fmtFecha(a.realFin) : 'en curso'}` : <i className="text-muted-foreground">Sin inicio real</i>}</Campo>
            <Campo label="Retraso vs línea base">{retraso === null ? '—' : retraso > 0 ? <span className="text-rose-700">{retraso} días</span> : 'Sin retraso'}{tardia ? <div className="text-xs text-rose-700">Finalizó {tardia} días tarde</div> : null}</Campo>
            {a.bloqueada && <div className="col-span-2 rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-orange-200">Bloqueada: {a.motivoBloqueo}</div>}
          </dl>
          {(a.descripcion || a.resultadoEsperado || a.observaciones) && (
            <div className="grid gap-3 text-sm">
              {a.descripcion && <div><div className="text-xs text-muted-foreground">Qué hacer</div><p className="mt-0.5 whitespace-pre-line">{a.descripcion}</p></div>}
              {a.resultadoEsperado && <div><div className="text-xs text-muted-foreground">Resultado para darla por terminada</div><p className="mt-0.5 whitespace-pre-line">{a.resultadoEsperado}</p></div>}
              {a.observaciones && <div><div className="text-xs text-muted-foreground">Comentarios</div><p className="mt-0.5 whitespace-pre-line">{a.observaciones}</p></div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><div className="mb-1 text-xs text-muted-foreground">Predecesoras</div>{preds.length ? preds.map((p) => <div key={p.id} className={p.planFin && a.planInicio && a.planInicio <= p.planFin ? 'text-amber-800' : ''}>{p.codigo} · fin {fmtFecha(p.planFin)}{p.planFin && a.planInicio && a.planInicio <= p.planFin ? ' (revisar)' : ''}</div>) : <span className="text-muted-foreground">Ninguna</span>}</div>
            <div><div className="mb-1 text-xs text-muted-foreground">Sucesoras</div>{sucs.length ? sucs.map((s) => <div key={s.id}>{s.codigo} · inicio {fmtFecha(s.planInicio)}</div>) : <span className="text-muted-foreground">Ninguna</span>}</div>
          </div>
          <FieldError>{error}</FieldError>
          <section>
            <h3 className="text-xs font-semibold">Evidencias</h3>
            {evs === null ? <p className="mt-1 text-xs text-muted-foreground">Cargando…</p> : evs.length ? (
              <ul className="mt-2 grid gap-1.5 text-xs">
                {evs.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      {/^https?:\/\//.test(e.referencia) ? <a href={e.referencia} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-primary hover:underline">{e.referencia}<ExternalLink className="size-3" /></a> : <span className="break-all">{e.referencia}</span>}
                      {e.descripcion && <span className="block text-muted-foreground">{e.descripcion} · {new Date(e.createdAt).toLocaleDateString('es-EC')}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-xs text-muted-foreground">Sin evidencias.{a.requiereEvidencia ? ' Esta actividad exige evidencia para cerrarse.' : ''}</p>}
          </section>
          <section>
            <h3 className="text-xs font-semibold">Historial</h3>
            {hist === null ? <p className="mt-1 text-xs text-muted-foreground">Cargando…</p> : (
              <ol className="mt-2 grid gap-2 text-xs">
                {hist.map((h) => (
                  <li key={h.id} className="border-l-2 border-border pl-3">
                    <div className="font-medium">{h.accion} <span className="font-normal text-muted-foreground">· {new Date(h.fecha).toLocaleString('es-EC')} · {h.userId ? personas.get(h.userId) ?? 'Usuario' : 'Sistema'}</span></div>
                    <div className="text-muted-foreground">{h.motivo}</div>
                    {h.antes && h.despues && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{resumenCambio(h.antes, h.despues)}</div>}
                  </li>
                ))}
                {!hist.length && <li className="text-muted-foreground">Sin movimientos.</li>}
              </ol>
            )}
          </section>
          <p className="text-xs text-muted-foreground">Versión {a.version} · actualizado {a.updatedAt ? new Date(a.updatedAt).toLocaleString('es-EC') : '—'}{a.updatedBy ? ` por ${personas.get(a.updatedBy) ?? 'otro usuario'}` : ''}</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function resumenCambio(antes: Record<string, unknown>, despues: Record<string, unknown>) {
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))
  return claves.slice(0, 6).map((k) => `${k}: ${fmt(antes[k])} → ${fmt(despues[k])}`).join(' · ')
}
const fmt = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/* ---------------------------------------------------------------- acciones */

interface DialogProps {
  d: api.DatosPlan
  datos: Datos
  a: Actividad
  accion: Accion
  onClose: () => void
  ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>
}

/** Formulario de cada acción. El servidor vuelve a comprobar permiso, alcance, versión y reglas. */
export function AccionDialog({ d, datos, a, accion, onClose, ejecutar }: DialogProps) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
  const [motivo, setMotivo] = useState('')
  const [avance, setAvance] = useState(a.avance === null ? '' : String(a.avance))
  const [inicio, setInicio] = useState(a.planInicio ?? '')
  const [fin, setFin] = useState(a.planFin ?? '')
  const [fecha, setFecha] = useState(hoy)
  const [responsable, setResponsable] = useState(a.responsableId ?? (a.responsableExterno ? 'otro' : 'ninguno'))
  const [responsableExterno, setResponsableExterno] = useState(a.responsableExterno ?? '')
  const [peso, setPeso] = useState(a.peso === null ? '' : String(a.peso))
  const [url, setUrl] = useState('')
  const [impacto, setImpacto] = useState<{ codigo: string; nombre: string; plan_inicio: string | null; conflicto: boolean }[] | null>(null)
  const [aceptaImpacto, setAceptaImpacto] = useState(false)
  const [nombre, setNombre] = useState(a.nombre)
  const [descripcion, setDescripcion] = useState(a.descripcion)
  const [resultado, setResultado] = useState(a.resultadoEsperado)
  const [observaciones, setObservaciones] = useState(a.observaciones)
  const [prioridad, setPrioridad] = useState(a.prioridad ?? 'ninguna')
  const [faseId, setFaseId] = useState(a.faseId ?? 'ninguna')
  const [requiereEvidencia, setRequiereEvidencia] = useState(a.requiereEvidencia)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (accion !== 'reprogramar' || !fin || fin === a.planFin) { setImpacto(null); return }
    let vivo = true
    api.impacto(datos, a.id, fin).then((r) => { if (vivo) setImpacto(r) }).catch(() => { if (vivo) setImpacto(null) })
    return () => { vivo = false }
  }, [accion, fin, a.id, a.planFin, datos])

  const num = avance.trim() === '' ? null : Number(avance.replace(',', '.'))
  const baja = a.avance !== null && (num === null || num < a.avance)
  const conflictos = impacto?.filter((x) => x.conflicto) ?? []
  const motivoOk = motivo.trim().length >= 5
  let valido = motivoOk
  if (accion === 'avance') valido = (num === null || (Number.isFinite(num) && num >= 0 && num <= 100)) && (!baja || motivoOk)
  if (accion === 'reprogramar') valido = motivoOk && !!inicio && !!fin && fin >= inicio && (!conflictos.length || aceptaImpacto)
  if (accion === 'cerrar') valido = motivoOk && !!fecha
  if (accion === 'peso') valido = motivoOk && (peso.trim() === '' || Number(peso.replace(',', '.')) > 0)
  if (accion === 'evidencia') valido = /^https?:\/\/\S{4,}$/.test(url.trim())
  if (accion === 'editar') valido = motivoOk && nombre.trim().length >= 3
  if (accion === 'asignar') valido = motivoOk && (responsable !== 'otro' || responsableExterno.trim().length >= 3)
  const motivoExigido = accion !== 'evidencia' && (accion !== 'avance' || baja)
  // Explica por qué Guardar sigue deshabilitado, en lugar de dejar el botón apagado sin aviso.
  const falta = valido ? null
    : accion === 'evidencia' ? 'Pega un enlace que empiece con https://'
    : accion === 'avance' && !(num === null || (Number.isFinite(num) && num >= 0 && num <= 100)) ? 'El avance debe estar entre 0 y 100'
    : accion === 'reprogramar' && (!inicio || !fin) ? 'Indica las fechas de inicio y fin'
    : accion === 'reprogramar' && fin < inicio ? 'El fin debe ser igual o posterior al inicio'
    : accion === 'editar' && nombre.trim().length < 3 ? 'El nombre debe tener al menos 3 caracteres'
    : accion === 'peso' && !(peso.trim() === '' || Number(peso.replace(',', '.')) > 0) ? 'El peso debe ser un número positivo'
    : accion === 'cerrar' && !fecha ? 'Indica la fecha real de fin'
    : accion === 'asignar' && responsable === 'otro' && responsableExterno.trim().length < 3 ? 'Escribe el nombre del responsable (mínimo 3 caracteres)'
    : motivoExigido && !motivoOk ? `Escribe el motivo (mínimo 5 caracteres; llevas ${motivo.trim().length})`
    : accion === 'reprogramar' && conflictos.length && !aceptaImpacto ? 'Marca la casilla de impacto en sucesoras'
    : null

  const enviar = async () => {
    setEnviando(true); setError(null)
    const run: Record<Accion, () => Promise<unknown>> = {
      avance: () => api.actualizarAvance(datos, a, num, motivo.trim() || null),
      reprogramar: () => api.reprogramar(datos, a, inicio, fin, motivo),
      asignar: () => api.asignar(datos, a, responsable === 'ninguno' || responsable === 'otro' ? null : responsable, motivo, responsable === 'otro' ? responsableExterno.trim() : null),
      peso: () => api.pesoActividad(datos, a, peso.trim() === '' ? null : Number(peso.replace(',', '.')), motivo),
      cerrar: () => api.cambiarEstado(datos, a, 'cerrar', fecha, motivo),
      reabrir: () => api.cambiarEstado(datos, a, 'reabrir', null, motivo),
      cancelar: () => api.cambiarEstado(datos, a, 'cancelar', null, motivo),
      bloquear: () => api.cambiarEstado(datos, a, 'bloquear', null, motivo),
      desbloquear: () => api.cambiarEstado(datos, a, 'desbloquear', null, motivo),
      excluir: () => api.cambiarEstado(datos, a, 'excluir', null, motivo),
      incluir: () => api.cambiarEstado(datos, a, 'incluir', null, motivo),
      evidencia: () => api.agregarEvidencia(datos, a.id, url.trim(), motivo.trim()),
      editar: () => api.editarActividad(datos, d.plan!.id, a, {
        nombre: nombre.trim(), descripcion, resultado_esperado: resultado, observaciones,
        prioridad: prioridad === 'ninguna' ? null : prioridad, fase_id: faseId === 'ninguna' ? null : faseId,
        requiere_evidencia: requiereEvidencia,
      }, motivo),
    }
    const ok = await ejecutar(run[accion], `${a.codigo}: ${TITULO[accion].toLowerCase()} registrado`)
    setEnviando(false)
    if (ok) onClose()
    else setError('No se guardó. Revisa el mensaje en la parte superior; si otra persona cambió la actividad, los datos ya se recargaron.')
  }

  const activos = d.personas.filter((p) => p.estado === 'activo')
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{TITULO[accion]} · {a.codigo}</DialogTitle>
          <DialogDescription className="line-clamp-2">{a.nombre}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {accion === 'avance' && (
            <div className="grid gap-1.5">
              <Label htmlFor="ac-av" className="text-xs">Avance (0 a 100). Vacío = sin dato</Label>
              <Input id="ac-av" inputMode="decimal" value={avance} onChange={(e) => setAvance(e.target.value)} placeholder="Sin dato" />
              {baja && <p className="text-xs text-amber-800">Bajar el avance es una corrección: indica el motivo.</p>}
            </div>
          )}
          {accion === 'reprogramar' && (
            <>
              <p className="text-xs text-muted-foreground">Línea base: {fmtFecha(a.baseInicio)} – {fmtFecha(a.baseFin)}. Se conserva; el retraso respecto de ella seguirá visible.</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5"><Label htmlFor="ac-ini" className="text-xs">Nuevo inicio</Label><Input id="ac-ini" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
                <div className="grid gap-1.5"><Label htmlFor="ac-fin" className="text-xs">Nuevo fin</Label><Input id="ac-fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
              </div>
              {fin && inicio && fin < inicio && <p className="text-xs text-rose-700">El fin debe ser igual o posterior al inicio.</p>}
              {conflictos.length > 0 && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
                  <p className="font-medium">Impacto en sucesoras (no se moverán automáticamente):</p>
                  <ul className="mt-1 list-disc pl-4">{conflictos.map((c) => <li key={c.codigo}>{c.codigo} {c.nombre} empieza el {fmtFecha(c.plan_inicio)}</li>)}</ul>
                  <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={aceptaImpacto} onChange={(e) => setAceptaImpacto(e.target.checked)} />Entiendo el impacto y autorizo la reprogramación</label>
                </div>
              )}
            </>
          )}
          {accion === 'editar' && (
            <>
              <div className="grid gap-1.5"><Label htmlFor="ed-nombre" className="text-xs">Nombre</Label><Input id="ed-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="ed-desc" className="text-xs">Qué hacer</Label><Textarea id="ed-desc" rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="ed-res" className="text-xs">Resultado para darla por terminada</Label><Textarea id="ed-res" rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Fase</Label>
                  <Select value={faseId} onValueChange={setFaseId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ninguna">Sin fase</SelectItem>
                      {d.fases.map((f) => <SelectItem key={f.id} value={f.id}>{f.codigo} {f.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Prioridad</Label>
                  <Select value={prioridad} onValueChange={setPrioridad}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ninguna">Sin prioridad</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="media">Media</SelectItem>
                      <SelectItem value="baja">Baja</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="ed-obs" className="text-xs">Comentarios</Label><Textarea id="ed-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={requiereEvidencia} onChange={(e) => setRequiereEvidencia(e.target.checked)} />Exige evidencia para cerrarse</label>
              <p className="text-xs text-muted-foreground">Responsable, fechas, peso y avance se cambian con sus propios botones, para que cada cambio quede con su motivo.</p>
            </>
          )}
          {accion === 'asignar' && (
            <div className="grid gap-1.5">
              <Label className="text-xs">Responsable (usuario activo dentro de tu alcance)</Label>
              <Select value={responsable} onValueChange={setResponsable}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguno">Sin responsable</SelectItem>
                  {activos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre} · {p.email}</SelectItem>)}
                  <SelectItem value="otro">Otro (persona fuera de la app)</SelectItem>
                </SelectContent>
              </Select>
              {responsable === 'otro' && (
                <div className="grid gap-1.5">
                  <Label htmlFor="ac-ext" className="text-xs">Nombre del responsable</Label>
                  <Input id="ac-ext" value={responsableExterno} onChange={(e) => setResponsableExterno(e.target.value)} placeholder="Ej.: Juan Pérez (proveedor)" />
                </div>
              )}
              {a.responsableTexto && <p className="text-xs text-muted-foreground">Texto original del cronograma: “{a.responsableTexto}”.</p>}
            </div>
          )}
          {accion === 'peso' && (
            <div className="grid gap-1.5">
              <Label htmlFor="ac-peso" className="text-xs">Peso relativo (positivo). Vacío = pendiente</Label>
              <Input id="ac-peso" inputMode="decimal" value={peso} onChange={(e) => setPeso(e.target.value)} placeholder="Pendiente" />
            </div>
          )}
          {accion === 'cerrar' && (
            <>
              <p className="text-xs text-muted-foreground">Para cerrar se exige avance de 100%, fecha real de fin{a.requiereEvidencia ? ' y la evidencia obligatoria' : ''}.</p>
              <div className="grid gap-1.5"><Label htmlFor="ac-fecha" className="text-xs">Fecha real de fin</Label><Input id="ac-fecha" type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} /></div>
            </>
          )}
          {accion === 'evidencia' && (
            <div className="grid gap-1.5">
              <Label htmlFor="ac-url" className="text-xs">Enlace al documento (Drive, carpeta compartida…)</Label>
              <Input id="ac-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
              <p className="text-xs text-muted-foreground">La carga de archivos al almacenamiento privado está pendiente; por ahora se registran enlaces.</p>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="ac-motivo" className="text-xs">{accion === 'evidencia' ? 'Descripción' : accion === 'avance' && !baja ? 'Comentario (opcional)' : 'Motivo *'}</Label>
            <Textarea id="ac-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder={motivoExigido ? 'Ej.: El proveedor confirmó nueva fecha de entrega' : undefined} />
          </div>
          {falta && <p className="text-xs text-amber-800">Para guardar: {falta}.</p>}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} variant={accion === 'cancelar' ? 'destructive' : 'default'} onClick={() => void enviar()}>{enviando && <Loader2 className="animate-spin" />}Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
