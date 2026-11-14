import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { aplicarImportacion, COLUMNAS_IMPORTABLES, descargarLibro, leerLibro, validarImportacion, type ResultadoValidacion } from '../excel'
import { useInventory } from '../store'
import { FieldError } from './shared'

const MAX_BYTES = 5 * 1024 * 1024

export default function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: (m: string) => void }) {
  const { state, update } = useInventory()
  const { actor, can } = useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<string | null>(null)
  const [hojas, setHojas] = useState<string[]>([])
  const [validacion, setValidacion] = useState<ResultadoValidacion | null>(null)
  const [verTodo, setVerTodo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (open) { setArchivo(null); setHojas([]); setValidacion(null); setMotivo(''); setError(null); setVerTodo(false) }
  }, [open])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null); setValidacion(null)
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setError('Formato no admitido. Usa .xlsx, .xls o .csv.')
    if (file.size > MAX_BYTES) return setError('El archivo supera 5 MB.')
    setCargando(true)
    try {
      const { filas, hojas: hs } = leerLibro(await file.arrayBuffer())
      if (!hs.length) throw new Error('No se encontró ninguna hoja con la columna "Codigo". Descarga la plantilla para ver el formato.')
      setArchivo(file.name); setHojas(hs)
      setValidacion(validarImportacion(state, filas))
    } catch (e) {
      setError((e as Error).message || 'No se pudo leer el archivo.')
    } finally {
      setCargando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function aplicar() {
    if (!validacion || !archivo) return
    setError(null)
    try {
      update((s) => aplicarImportacion(s, validacion, motivo, actor, archivo))
      onDone(`Importación aplicada: ${validacion.conCambios} unidades actualizadas desde ${archivo}`)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const filas = validacion ? validacion.filas.filter((f) => verTodo || f.cambios.length || f.errores.length || f.advertencias.length) : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar inventario desde Excel</DialogTitle>
          <DialogDescription>
            Columnas reconocidas: {COLUMNAS_IMPORTABLES.join(', ')}. También se acepta la exportación del simulador AMURA. Nada se guarda hasta confirmar la previsualización.
          </DialogDescription>
        </DialogHeader>

        {!can('inventario.importar') ? (
          <FieldError>Tu rol actual no puede importar datos al inventario.</FieldError>
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only" id="inv-import-file" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button asChild variant="default" size="sm"><label htmlFor="inv-import-file" className="cursor-pointer"><Upload />{archivo ? 'Elegir otro archivo' : 'Elegir archivo Excel'}</label></Button>
              <Button variant="outline" size="sm" onClick={() => descargarLibro(state, { plantilla: true })}><Download />Descargar plantilla</Button>
              {archivo && <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><FileSpreadsheet className="size-3.5" />{archivo} · hojas: {hojas.join(', ')}</span>}
              {cargando && <span className="text-xs text-muted-foreground">Leyendo…</span>}
            </div>
            <FieldError>{error}</FieldError>

            {validacion && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-live="polite">
                  <Chip label="Filas leídas" value={validacion.totalFilas} />
                  <Chip label="Con cambios" value={validacion.conCambios} tone="text-primary" />
                  <Chip label="Sin cambios" value={validacion.sinCambios} />
                  <Chip label="Advertencias" value={validacion.conAdvertencias} tone="text-amber-700" />
                  <Chip label="Errores" value={validacion.conErrores} tone="text-rose-700" />
                </div>
                {validacion.faltantes.length > 0 && validacion.faltantes.length < 72 && (
                  <p className="text-xs text-muted-foreground">{validacion.faltantes.length} unidades no vienen en el archivo y se mantienen sin cambios.</p>
                )}
                <div className="max-h-72 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr><th className="p-2 text-left font-medium">Fila</th><th className="p-2 text-left font-medium">Unidad</th><th className="p-2 text-left font-medium">Cambios</th><th className="p-2 text-left font-medium">Validación</th></tr>
                    </thead>
                    <tbody>
                      {filas.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">El archivo coincide con el inventario actual.</td></tr>}
                      {filas.map((f) => (
                        <tr key={`${f.hoja}-${f.fila}`} className={`border-t border-border align-top ${f.errores.length ? 'bg-rose-50/60' : ''}`}>
                          <td className="p-2 tabular-nums text-muted-foreground">{f.hoja !== 'Inventario' ? `${f.hoja} · ` : ''}{f.fila}</td>
                          <td className="p-2 font-medium">{f.codigo || '—'}</td>
                          <td className="p-2">
                            {f.cambios.length ? f.cambios.map((c) => (
                              <div key={c.campo}>{c.etiqueta}: <span className="text-muted-foreground line-through">{c.antes ?? '—'}</span> → <b>{c.despues ?? '—'}</b></div>
                            )) : <span className="text-muted-foreground">Sin cambios</span>}
                          </td>
                          <td className="p-2">
                            {f.errores.map((e) => <div key={e} className="flex gap-1 text-rose-700"><XCircle className="mt-px size-3 shrink-0" />{e}</div>)}
                            {f.advertencias.map((e) => <div key={e} className="flex gap-1 text-amber-700"><AlertTriangle className="mt-px size-3 shrink-0" />{e}</div>)}
                            {!f.errores.length && !f.advertencias.length && <span className="flex gap-1 text-emerald-700"><CheckCircle2 className="size-3" />Correcto</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={verTodo} onChange={(e) => setVerTodo(e.target.checked)} />Mostrar también las filas sin cambios</label>
                {validacion.conErrores > 0 ? (
                  <FieldError>Hay {validacion.conErrores} filas con errores. Corrígelas en el archivo y vuelve a cargarlo; no se aplicará ningún cambio parcial.</FieldError>
                ) : validacion.conCambios > 0 && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="imp-motivo" className="text-xs">Motivo de la importación (queda en el historial)</Label>
                    <Textarea id="imp-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. Actualización de disponibilidad enviada por Inmobiliaria Jarval" />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {can('inventario.importar') && (
            <Button onClick={aplicar} disabled={!validacion || validacion.conErrores > 0 || validacion.conCambios === 0 || motivo.trim().length < 5}>
              Aplicar {validacion?.conCambios ? `${validacion.conCambios} cambios` : 'importación'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Chip({ label, value, tone = 'text-foreground' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}
