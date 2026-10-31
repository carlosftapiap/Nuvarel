import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { aplanar, fechaLocalIso, indexar } from '../calculos'
import { cargarEvidencia, tipoPorMime, validarArchivo } from '../evidencias'
import type { Frente } from '../model'
import { guardarAvance } from '../remoto'
import type { ContextoBase } from '../useObra'
import { fechaCorta, pct, Vacio } from './ui'

const campo = 'h-9 w-full rounded-md border border-border bg-white px-2 text-sm'
const OTRA = 'otra'

/** Actividad, responsable, fecha y porcentaje → Guardar avance. El tablero se actualiza de inmediato. */
export default function ActualizarAvance({ ctx, frente, actividadInicial, onClose, onGuardado }: {
  ctx: ContextoBase
  frente: Frente
  actividadInicial: string | null
  onClose: () => void
  onGuardado: (mensaje: string, error: string | null) => void
}) {
  const { obra, datos, recargar, almacen, usuarioId, usuario, can } = ctx
  const hojas = useMemo(() => {
    const deFrente = obra.actividades.filter((a) => a.frenteId === frente.id)
    const idx = indexar(deFrente)
    return aplanar(deFrente).map((n) => n.actividad).filter((a) => a.estado !== 'cancelada' && !(idx.get(a.id) ?? []).length)
  }, [obra.actividades, frente.id])
  const personas = useMemo(() => (obra.personas.some((p) => p.id === usuarioId) ? obra.personas : [{ id: usuarioId, nombre: usuario }, ...obra.personas]), [obra.personas, usuarioId, usuario])

  const responsableDe = (id: string) => {
    const a = hojas.find((h) => h.id === id)
    return a?.responsableId ?? (a?.responsableTexto ? OTRA : usuarioId)
  }
  const [actividadId, setActividadId] = useState(actividadInicial ?? '')
  const [responsable, setResponsable] = useState(() => (actividadInicial ? responsableDe(actividadInicial) : usuarioId))
  const [externo, setExterno] = useState(() => hojas.find((h) => h.id === actividadInicial)?.responsableTexto ?? '')
  const [fecha, setFecha] = useState(fechaLocalIso())
  const [avance, setAvance] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actividad = hojas.find((a) => a.id === actividadId) ?? null
  const num = avance.trim() === '' ? null : Number(avance.replace(',', '.'))
  const errorArchivos = archivos.map(validarArchivo).find(Boolean) ?? null
  const conResponsable = responsable === OTRA ? externo.trim().length >= 3 : !!responsable
  const valido = !!actividad && num !== null && Number.isFinite(num) && num >= 0 && num <= 100 && !!fecha && conResponsable && !errorArchivos
  const anterior = !!actividad?.ultimoCorteValidado && fecha < actividad.ultimoCorteValidado

  async function guardar() {
    if (!actividad || num === null) return
    setError(null); setEnviando(true)
    try {
      const id = await guardarAvance(datos, { actividadId: actividad.id, fecha, avance: num, responsableId: responsable === OTRA ? null : responsable, responsableTexto: responsable === OTRA ? externo.trim() : '', observaciones: observaciones.trim() })
      const fallidos: string[] = []
      for (const archivo of archivos) {
        try {
          await cargarEvidencia({ datos, almacen }, { frenteId: frente.id, actividadId: actividad.id, avanceId: id, tipo: tipoPorMime(archivo.type), descripcion: `Respaldo del avance al ${fechaCorta(fecha)}`, fecha, archivo })
        } catch (e) {
          fallidos.push(`${archivo.name}: ${(e as Error).message}`)
        }
      }
      await recargar()
      onGuardado(`${actividad.nombre}: avance guardado (${pct(num)}).`, fallidos.length ? `El avance se guardó, pero no se pudieron cargar estos archivos: ${fallidos.join(' · ')}. Súbelos desde Evidencias.` : null)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Actualizar avance · {frente.nombre}</DialogTitle>
          <DialogDescription>El nuevo porcentaje se ve de inmediato. Queda registrado quién lo guardó, cuándo y el valor anterior.</DialogDescription>
        </DialogHeader>
        {hojas.length === 0 ? (
          <Vacio titulo="Aún no hay actividades en este frente">{can('obra.editar') ? 'Créalas en Opciones avanzadas.' : 'El equipo técnico debe crearlas primero.'}</Vacio>
        ) : (
          <form id="form-avance" className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (valido && !enviando) void guardar() }}>
            <div className="grid gap-1.5">
              <Label htmlFor="av-actividad" className="text-xs">Actividad *</Label>
              <select id="av-actividad" className={campo} value={actividadId} onChange={(e) => { setActividadId(e.target.value); setResponsable(responsableDe(e.target.value)); setExterno(hojas.find((h) => h.id === e.target.value)?.responsableTexto ?? '') }}>
                <option value="">Elegir actividad</option>
                {hojas.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>)}
              </select>
              {actividad && <p className="text-[11px] text-muted-foreground">Avance actual: <b>{pct(actividad.avanceValidado ?? 0)}</b></p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-responsable" className="text-xs">Responsable *</Label>
              <select id="av-responsable" className={campo} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                <option value={OTRA}>Otra persona</option>
              </select>
              {responsable === OTRA && <Input aria-label="Nombre del responsable" placeholder="Nombre del responsable" value={externo} onChange={(e) => setExterno(e.target.value)} />}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="av-fecha" className="text-xs">Fecha *</Label><Input id="av-fecha" type="date" max={fechaLocalIso()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="av-porcentaje" className="text-xs">Porcentaje de avance *</Label><Input id="av-porcentaje" type="number" min="0" max="100" step="0.01" value={avance} onChange={(e) => setAvance(e.target.value)} /></div>
            </div>
            {anterior && <p className="text-[11px] text-amber-800">Esta fecha es anterior al último registro ({fechaCorta(actividad!.ultimoCorteValidado)}): queda en el historial, pero el avance actual sigue siendo el del registro más reciente.</p>}
            <div className="grid gap-1.5"><Label htmlFor="av-obs" className="text-xs">Observaciones</Label><Textarea id="av-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
            <div className="grid gap-1.5">
              <Label htmlFor="av-fotos" className="text-xs">Fotografías</Label>
              <input id="av-fotos" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" onChange={(e) => setArchivos(Array.from(e.target.files ?? []))} />
              <FieldError>{errorArchivos}</FieldError>
            </div>
            <FieldError>{error}</FieldError>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {hojas.length > 0 && <Button type="submit" form="form-avance" disabled={!valido || enviando}>{enviando ? 'Guardando…' : 'Guardar avance'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
