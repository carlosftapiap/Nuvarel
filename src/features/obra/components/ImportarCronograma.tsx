import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/features/inventario/components/shared'
import { clasificar, type ResultadoLectura } from '../excel'
import { importarCronograma } from '../remoto'
import type { ContextoObra } from '../useObra'

/** Vista previa de lo que haría la importación. Con errores no se guarda nada; sin errores se importa todo o nada. */
export default function ImportarCronograma({ ctx, lectura, archivo, onClose, onHecho }: {
  ctx: ContextoObra; lectura: ResultadoLectura; archivo: string; onClose: () => void; onHecho: (mensaje: string) => void
}) {
  const { datos, obra, frente, recargar } = ctx
  const [motivo, setMotivo] = useState(`Importación del cronograma (${archivo})`)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const existentes = useMemo(() => obra.actividades.filter((a) => a.frenteId === frente.id), [obra.actividades, frente.id])
  const clase = useMemo(() => clasificar(lectura.filas, existentes), [lectura.filas, existentes])
  const hayErrores = lectura.errores.length > 0

  async function importar() {
    setError(null); setEnviando(true)
    try {
      const filas = lectura.filas.map((f) => ({ codigo: f.codigo, parent_codigo: f.parent_codigo, nombre: f.nombre, descripcion: f.descripcion, peso: f.peso, plan_inicio: f.plan_inicio,
        plan_fin: f.plan_fin, real_inicio: f.real_inicio, real_fin: f.real_fin, duracion_dias: f.duracion_dias, responsable_texto: f.responsable_texto, estado: f.estado, observaciones: f.observaciones }))
      const r = await importarCronograma(datos, frente.id, filas, motivo.trim())
      await recargar()
      onHecho(`Importación lista: ${r.creadas} actividad(es) nueva(s) y ${r.actualizadas} actualizada(s). Los avances no se tocaron.`)
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar cronograma · {frente.nombre}</DialogTitle>
          <DialogDescription>Hoja «{lectura.hoja}» del archivo {archivo}. Las actividades se identifican por su código: no se duplican ni se borran.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-emerald-50 p-2"><dt className="text-emerald-800">Nuevas</dt><dd className="text-lg font-semibold tabular-nums">{clase.nuevas}</dd></div>
            <div className="rounded-lg bg-sky-50 p-2"><dt className="text-sky-800">Se actualizan</dt><dd className="text-lg font-semibold tabular-nums">{clase.actualizadas}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-muted-foreground">Sin cambios</dt><dd className="text-lg font-semibold tabular-nums">{clase.sinCambios}</dd></div>
          </dl>
          {hayErrores && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="font-semibold text-rose-800">No se puede importar: corrige estos {lectura.errores.length} error(es) en el archivo y vuelve a cargarlo.</p>
              <ul className="mt-2 max-h-48 list-disc overflow-y-auto pl-5 text-rose-800">
                {lectura.errores.slice(0, 50).map((e, i) => <li key={i}>Fila {e.fila}: {e.mensaje}</li>)}
              </ul>
              {lectura.errores.length > 50 && <p className="mt-1 text-[11px]">…y {lectura.errores.length - 50} más.</p>}
            </div>
          )}
          {!hayErrores && clase.detalle.some((d) => d.clase === 'actualizada') && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer font-medium">Ver qué cambia en las actividades existentes</summary>
              <ul className="mt-2 max-h-44 overflow-y-auto">
                {clase.detalle.filter((d) => d.clase === 'actualizada').map((d) => <li key={d.codigo}><b>{d.codigo}</b>: {d.cambios.join(', ')}</li>)}
              </ul>
            </details>
          )}
          {!hayErrores && <div className="grid gap-1.5"><Label htmlFor="imp-motivo" className="text-xs">Motivo *</Label><Input id="imp-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={hayErrores || enviando || motivo.trim().length < 5 || lectura.filas.length === 0} onClick={() => void importar()}>{enviando ? 'Importando…' : 'Importar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
