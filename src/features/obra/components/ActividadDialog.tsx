import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import type { Actividad } from '../model'
import { cambiarDependencia, guardarActividad } from '../remoto'
import type { ContextoObra } from '../useObra'

export type ModoActividad = { tipo: 'nueva'; parentId: string | null } | { tipo: 'editar'; actividad: Actividad }

const SIN = ''
const EXTERNO = '__externo__'
const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'

/** Código sugerido: el siguiente libre dentro de su nivel. */
function codigoSugerido(trabajo: Actividad[], parentId: string | null) {
  const padre = parentId ? trabajo.find((a) => a.id === parentId) : null
  const hermanos = trabajo.filter((a) => a.parentId === parentId).length
  let n = hermanos + 1
  const existe = (c: string) => trabajo.some((a) => a.codigo === c)
  const hacer = (k: number) => (padre ? `${padre.codigo}.${k}` : `A-${String(k).padStart(2, '0')}`)
  while (existe(hacer(n))) n++
  return hacer(n)
}

export default function ActividadDialog({ ctx, modo, trabajo, onAplicar, onClose }: {
  ctx: ContextoObra; modo: ModoActividad; trabajo: Actividad[]; onAplicar: (id: string, patch: Partial<Actividad>) => void; onClose: () => void
}) {
  const { datos, obra, frente, recargar } = ctx
  const editando = modo.tipo === 'editar' ? modo.actividad : null
  const [f, setF] = useState({
    codigo: editando?.codigo ?? codigoSugerido(trabajo, modo.tipo === 'nueva' ? modo.parentId : null),
    nombre: editando?.nombre ?? '',
    descripcion: editando?.descripcion ?? '',
    parentId: editando ? editando.parentId ?? SIN : modo.tipo === 'nueva' ? modo.parentId ?? SIN : SIN,
    responsable: editando ? (editando.responsableId ?? (editando.responsableTexto ? EXTERNO : SIN)) : SIN,
    externo: editando?.responsableTexto ?? '',
    observaciones: editando?.observaciones ?? '',
    motivo: editando ? '' : 'Nueva actividad del cronograma',
  })
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [motivoDep, setMotivoDep] = useState('')
  const [nuevaPred, setNuevaPred] = useState('')
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const vigentes = trabajo.filter((a) => a.estado !== 'cancelada' && a.id !== editando?.id)
  const predecesoras = editando ? obra.dependencias.filter((d) => d.sucesoraId === editando.id) : []
  const porId = new Map(obra.actividades.map((a) => [a.id, a]))
  const valido = f.codigo.trim().length >= 1 && f.nombre.trim().length >= 3 && (editando ? true : f.motivo.trim().length >= 5) && (f.responsable !== EXTERNO || f.externo.trim().length >= 3)

  async function guardar() {
    setError(null)
    if (editando) {
      onAplicar(editando.id, {
        codigo: f.codigo.trim(), nombre: f.nombre.trim(), descripcion: f.descripcion.trim(), observaciones: f.observaciones.trim(), parentId: f.parentId || null,
        responsableId: f.responsable && f.responsable !== EXTERNO ? f.responsable : null, responsableTexto: f.responsable === EXTERNO ? f.externo.trim() : '',
      })
      onClose()
      return
    }
    setEnviando(true)
    try {
      await guardarActividad(datos, frente.id, null, null, {
        codigo: f.codigo.trim(), nombre: f.nombre.trim(), descripcion: f.descripcion.trim(), parent_id: f.parentId || null, peso: null, plan_inicio: null, plan_fin: null,
        real_inicio: null, real_fin: null, duracion_dias: null, responsable_id: f.responsable && f.responsable !== EXTERNO ? f.responsable : null,
        responsable_texto: f.responsable === EXTERNO ? f.externo.trim() : '', estado: 'por_programar', observaciones: f.observaciones.trim(),
      }, f.motivo.trim())
      await recargar()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function dependencia(pred: string, agregar: boolean) {
    if (!editando) return
    setError(null); setEnviando(true)
    try {
      await cambiarDependencia(datos, pred, editando.id, agregar, motivoDep.trim())
      setNuevaPred('')
      await recargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editando ? `Editar ${editando.codigo}` : 'Nueva actividad'}</DialogTitle>
          <DialogDescription>
            {editando ? 'Los cambios quedan en el borrador del cronograma y se guardan juntos, con su motivo.' : `Se agrega al cronograma de ${frente.nombre} sin fechas ni ponderación; las defines después en la tabla.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="grid gap-1.5"><Label htmlFor="act-codigo" className="text-xs">Código *</Label><Input id="act-codigo" value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="act-nombre" className="text-xs">Actividad *</Label><Input id="act-nombre" value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="act-superior" className="text-xs">Actividad superior</Label>
            <select id="act-superior" className={campo} value={f.parentId} onChange={(e) => set('parentId', e.target.value)}>
              <option value={SIN}>Ninguna (nivel principal)</option>
              {vigentes.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="act-desc" className="text-xs">Descripción</Label><Textarea id="act-desc" rows={2} value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label htmlFor="act-resp" className="text-xs">Responsable</Label>
            <select id="act-resp" className={campo} value={f.responsable} onChange={(e) => set('responsable', e.target.value)}>
              <option value={SIN}>Sin responsable</option>
              {obra.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              <option value={EXTERNO}>Persona o empresa externa…</option>
            </select>
            {f.responsable === EXTERNO && <Input aria-label="Responsable externo" placeholder="Nombre de la persona o empresa" value={f.externo} onChange={(e) => set('externo', e.target.value)} />}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="act-obs" className="text-xs">Observaciones</Label><Textarea id="act-obs" rows={2} value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} /></div>
          {!editando && <div className="grid gap-1.5"><Label htmlFor="act-motivo" className="text-xs">Motivo *</Label><Input id="act-motivo" value={f.motivo} onChange={(e) => set('motivo', e.target.value)} /></div>}

          {editando && (
            <fieldset className="grid gap-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-xs font-semibold">Dependencias (predecesoras)</legend>
              {predecesoras.length === 0 ? <p className="text-[11px] text-muted-foreground">No depende de otras actividades.</p> : (
                <ul className="grid gap-1 text-xs">
                  {predecesoras.map((d) => (
                    <li key={d.predecesoraId} className="flex items-center justify-between gap-2">
                      <span>{porId.get(d.predecesoraId)?.codigo} · {porId.get(d.predecesoraId)?.nombre}</span>
                      <Button size="xs" variant="ghost" disabled={enviando || motivoDep.trim().length < 5} onClick={() => void dependencia(d.predecesoraId, false)}>Quitar</Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid min-w-48 flex-1 gap-1"><Label htmlFor="dep-pred" className="text-[11px]">Agregar predecesora</Label>
                  <select id="dep-pred" className={campo} value={nuevaPred} onChange={(e) => setNuevaPred(e.target.value)}>
                    <option value="">Elegir actividad</option>
                    {obra.actividades.filter((a) => a.estado !== 'cancelada' && a.id !== editando.id && !predecesoras.some((d) => d.predecesoraId === a.id)).map((a) => (
                      <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="grid min-w-40 flex-1 gap-1"><Label htmlFor="dep-motivo" className="text-[11px]">Motivo del cambio</Label><Input id="dep-motivo" value={motivoDep} onChange={(e) => setMotivoDep(e.target.value)} /></div>
                <Button size="sm" variant="outline" disabled={!nuevaPred || motivoDep.trim().length < 5 || enviando} onClick={() => void dependencia(nuevaPred, true)}>Agregar</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Las dependencias se guardan al instante. No se permiten ciclos.</p>
            </fieldset>
          )}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido || enviando} onClick={() => void guardar()}>{editando ? 'Aplicar al borrador' : enviando ? 'Guardando…' : 'Crear actividad'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
