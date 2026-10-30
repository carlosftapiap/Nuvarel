import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import * as api from '../api'
import {
  CAMPOS, ESTADOS_SUGERIDOS, clasificar, fasesDelArchivo, leerFilas, mapeoGanttAmura, normalizar, responsablesDelArchivo,
  type Campo, type Clase, type OpcionesImportacion,
} from '../importar'
import { ESTADO_ACTIVIDAD, type EstadoActividad } from '../model'

const COLS = Array.from({ length: 30 }, (_, i) => XLSX.utils.encode_col(i))
const CLASE: Record<Clase, { label: string; tono: string }> = {
  nueva: { label: 'Nueva', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  actualizada: { label: 'Actualizada', tono: 'bg-amber-50 text-amber-900 ring-amber-200' },
  sin_cambios: { label: 'Sin cambios', tono: 'bg-slate-50 text-slate-600 ring-slate-200' },
  error: { label: 'Con error', tono: 'bg-rose-50 text-rose-800 ring-rose-200' },
}

/**
 * Importación del cronograma: hoja y correspondencia de columnas, interpretación explícita de porcentajes y fechas,
 * vínculo explícito de responsables, vista previa clasificada y confirmación del alcance. Se aplica en una sola transacción.
 */
export default function Importacion({ d, datos, ejecutar }: { d: api.DatosPlan; datos: Datos; ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const plan = d.plan!
  const [archivo, setArchivo] = useState<{ nombre: string; wb: XLSX.WorkBook } | null>(null)
  const [op, setOp] = useState<OpcionesImportacion | null>(null)
  const [fasesFrente, setFasesFrente] = useState<Record<string, string>>({})
  const [soloValidas, setSoloValidas] = useState(true)
  const [confirmar, setConfirmar] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtroClase, setFiltroClase] = useState<'todas' | Clase>('todas')

  const abrir = async (f: File) => {
    setError(null)
    try {
      // Solo valores: sin macros ni fórmulas (se usa el último valor guardado de cada celda).
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellFormula: false, bookVBA: false, cellHTML: false })
      setArchivo({ nombre: f.name, wb })
      const g = mapeoGanttAmura()
      const base = wb.SheetNames.includes(g.hoja) ? g : { hoja: wb.SheetNames[0], filaEncabezado: 1, avanceComo: 'fraccion' as const, mapeo: {} }
      setOp({ ...base, estados: { ...ESTADOS_SUGERIDOS }, responsables: {}, fases: {}, vaciarConCeldasVacias: false })
    } catch (e) {
      setError(`No se pudo leer el archivo: ${(e as Error).message}`)
    }
  }

  const leidas = useMemo(() => {
    if (!archivo || !op) return null
    try { return { filas: leerFilas(archivo.wb, op), error: null } } catch (e) { return { filas: [], error: (e as Error).message } }
  }, [archivo, op])

  const grupos = useMemo(() => (leidas ? fasesDelArchivo(leidas.filas) : []), [leidas])
  const responsables = useMemo(() => (leidas ? responsablesDelArchivo(leidas.filas) : []), [leidas])
  const estadosArchivo = useMemo(() => (leidas ? [...new Set(leidas.filas.map((f) => f.celdas.estado).filter((x) => x !== undefined).map(String))] : []), [leidas])
  const opcionesFinales = useMemo(() => (op ? { ...op, fases: Object.fromEntries(grupos.map((g) => [g.texto, g.codigo])) } : null), [op, grupos])
  const clasif = useMemo(() => {
    if (!leidas || !opcionesFinales) return []
    const fasesPlan = [...d.fases, ...grupos.filter((g) => !d.fases.some((f) => f.codigo === g.codigo)).map((g) => ({ id: `nueva-${g.codigo}`, planId: plan.id, frenteId: null, codigo: g.codigo, nombre: g.nombre, orden: 0 }))]
    return clasificar(normalizar(leidas.filas, opcionesFinales), d.actividades, fasesPlan, d.dependencias, opcionesFinales.hoja, opcionesFinales.mapeo.predecesora)
  }, [leidas, opcionesFinales, d, grupos, plan.id])

  const cuenta = (c: Clase) => clasif.filter((x) => x.clase === c).length
  const errores = cuenta('error')
  const aAplicar = clasif.filter((x) => x.clase === 'nueva' || x.clase === 'actualizada')
  const fasesNuevas = grupos.filter((g) => !d.fases.some((f) => f.codigo === g.codigo))
  const puedeAplicar = aAplicar.length > 0 && (errores === 0 || soloValidas)

  const aplicar = async () => {
    if (!op || !archivo) return
    setAplicando(true)
    const ok = await ejecutar(async () => {
      // 1) Fases que aún no existen (se conservan los grupos del archivo; el frente es opcional y se puede asignar después).
      for (const [i, g] of grupos.entries()) {
        if (d.fases.some((f) => f.codigo === g.codigo)) continue
        await api.guardarFase(datos, plan.id, g.codigo, g.nombre, fasesFrente[g.codigo] || null, i + 1)
      }
      // 2) Filas confirmadas, en una sola transacción del servidor.
      const r = await api.importar(datos, plan.id, archivo.nombre, op.hoja, aAplicar.map((x) => x.datos))
      setError(null)
      return r
    }, `Importación aplicada: ${cuenta('nueva')} nuevas, ${cuenta('actualizada')} actualizadas, ${cuenta('sin_cambios')} sin cambios${errores ? `, ${errores} filas con error omitidas` : ''}.`)
    setAplicando(false)
    setConfirmar(false)
    if (ok) { setArchivo(null); setOp(null) }
  }

  if (!archivo || !op) {
    return (
      <div className="dashboard-card grid gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet className="size-4" />Importar cronograma desde Excel</h2>
        <p className="text-xs text-muted-foreground">Selecciona el archivo (por ejemplo, Gantt_AMURA.xlsx). Nada se guarda hasta que revises la vista previa y confirmes. No se ejecutan macros ni fórmulas del archivo.</p>
        <Input type="file" accept=".xlsx,.xls" aria-label="Archivo Excel" onChange={(e) => { const f = e.target.files?.[0]; if (f) void abrir(f) }} />
        <FieldError>{error}</FieldError>
      </div>
    )
  }

  const set = (p: Partial<OpcionesImportacion>) => setOp({ ...op, ...p })
  const lista = clasif.filter((x) => filtroClase === 'todas' || x.clase === filtroClase)
  return (
    <div className="grid gap-4">
      <div className="dashboard-card grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">1. Hoja y columnas · {archivo.nombre}</h2>
          <Button size="sm" variant="outline" onClick={() => { setArchivo(null); setOp(null) }}>Elegir otro archivo</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Hoja</Label>
            <select className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={op.hoja} onChange={(e) => set({ hoja: e.target.value })}>
              {archivo.wb.SheetNames.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Fila del encabezado</Label>
            <Input type="number" min={1} value={op.filaEncabezado} onChange={(e) => set({ filaEncabezado: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">El avance del archivo está en</Label>
            <select className="h-8 rounded-md border border-border bg-white px-2 text-xs" value={op.avanceComo} onChange={(e) => set({ avanceComo: e.target.value as OpcionesImportacion['avanceComo'] })}>
              <option value="fraccion">Fracción 0–1 (formato % de Excel: 0,5 = 50%)</option>
              <option value="porcentaje">Número 0–100</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {(Object.keys(CAMPOS) as Campo[]).map((c) => {
            const ws = archivo.wb.Sheets[op.hoja]
            const col = op.mapeo[c]
            const titulo = col && ws ? (ws[`${col}${op.filaEncabezado}`] as XLSX.CellObject | undefined)?.v : undefined
            return (
              <div key={c} className="grid gap-1">
                <Label className="text-[11px]">{CAMPOS[c]}{c === 'codigo' || c === 'nombre' ? ' *' : ''}</Label>
                <select className="h-7 rounded-md border border-border bg-white px-1 text-[11px]" value={col ?? ''} onChange={(e) => set({ mapeo: { ...op.mapeo, [c]: e.target.value || undefined } })}>
                  <option value="">No importar</option>
                  {COLS.map((x) => <option key={x} value={x}>Columna {x}</option>)}
                </select>
                {titulo !== undefined && <span className="truncate text-[10px] text-muted-foreground" title={String(titulo)}>“{String(titulo)}”</span>}
              </div>
            )
          })}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={op.vaciarConCeldasVacias} onChange={(e) => set({ vaciarConCeldasVacias: e.target.checked })} />
          Las celdas vacías borran el dato existente (desactivado: una celda vacía no modifica nada)
        </label>
        {leidas?.error && <FieldError>{leidas.error}</FieldError>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="dashboard-card grid content-start gap-2">
          <h2 className="text-sm font-semibold">2. Estados</h2>
          {estadosArchivo.map((t) => (
            <div key={t} className="flex items-center justify-between gap-2 text-xs">
              <span>“{t}”</span>
              <select className="h-7 rounded-md border border-border bg-white px-1 text-[11px]" value={op.estados[t] ?? ''} onChange={(e) => set({ estados: { ...op.estados, [t]: e.target.value as EstadoActividad } })}>
                <option value="">Sin correspondencia (error)</option>
                {(['pendiente', 'en_ejecucion', 'cancelada'] as EstadoActividad[]).map((e) => <option key={e} value={e}>{ESTADO_ACTIVIDAD[e].label}</option>)}
              </select>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">“Completado” no cierra la actividad: el cierre exige fecha real de fin y evidencias desde la aplicación.</p>
        </div>
        <div className="dashboard-card grid content-start gap-2">
          <h2 className="text-sm font-semibold">3. Responsables</h2>
          <p className="text-[11px] text-muted-foreground">Vincula cada texto con un usuario existente. Sin vínculo, se conserva el texto y la actividad queda sin responsable. No se crean usuarios.</p>
          {responsables.map((r) => (
            <div key={r.texto} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">“{r.texto}” <span className="text-muted-foreground">({r.filas})</span></span>
              <select className="h-7 max-w-40 rounded-md border border-border bg-white px-1 text-[11px]" value={op.responsables[r.texto] ?? ''} onChange={(e) => set({ responsables: { ...op.responsables, [r.texto]: e.target.value || null } })}>
                <option value="">Sin vincular</option>
                {d.personas.filter((p) => p.estado === 'activo').map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="dashboard-card grid content-start gap-2">
          <h2 className="text-sm font-semibold">4. Fases ({grupos.length} grupos del archivo)</h2>
          <p className="text-[11px] text-muted-foreground">Se conservan los grupos originales como fases. El frente es opcional y puede asignarse después en Configuración del plan.</p>
          {grupos.map((g) => {
            const existente = d.fases.find((f) => f.codigo === g.codigo)
            return (
              <div key={g.codigo} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{g.codigo} {g.nombre}{existente && <span className="text-muted-foreground"> (ya existe)</span>}</span>
                {!existente && (
                  <select className="h-7 max-w-32 rounded-md border border-border bg-white px-1 text-[11px]" value={fasesFrente[g.codigo] ?? ''} onChange={(e) => setFasesFrente({ ...fasesFrente, [g.codigo]: e.target.value })}>
                    <option value="">Sin frente</option>
                    {d.frentes.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="dashboard-card !p-0">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
          <h2 className="mr-auto text-sm font-semibold">5. Vista previa</h2>
          {(['todas', 'nueva', 'actualizada', 'sin_cambios', 'error'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={filtroClase === c} onClick={() => setFiltroClase(c)}
              className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', filtroClase === c ? 'border-primary bg-secondary' : 'border-border hover:bg-muted')}>
              {c === 'todas' ? `Todas (${clasif.length})` : `${CLASE[c].label} (${cuenta(c)})`}
            </button>
          ))}
        </div>
        <div className="mt-3 max-h-[50vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-[11px] text-muted-foreground">
              <tr><th className="px-3 py-2 text-left font-medium">Fila</th><th className="px-2 py-2 text-left font-medium">Código</th><th className="px-2 py-2 text-left font-medium">Resultado</th><th className="px-3 py-2 text-left font-medium">Detalle</th></tr>
            </thead>
            <tbody>
              {lista.map((x) => (
                <tr key={`${x.fila}-${x.codigo}`} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 tabular-nums">{x.fila}</td>
                  <td className="px-2 py-1.5 font-mono">{x.codigo}</td>
                  <td className="px-2 py-1.5"><span className={cn('rounded-full px-2 py-0.5 text-[10px] ring-1 ring-inset', CLASE[x.clase].tono)}>{CLASE[x.clase].label}</span></td>
                  <td className="px-3 py-1.5">
                    {x.errores.map((e, i) => <div key={i} className="text-rose-700">Hoja “{e.hoja}”, fila {e.fila}{e.columna ? `, columna ${e.columna}` : ''}: {e.mensaje}</div>)}
                    {x.cambios.length > 0 && <div className="text-muted-foreground">{x.cambios.map((c) => `${c.campo}: ${c.antes ?? '∅'} → ${c.despues ?? '∅'}`).join(' · ')}</div>}
                    {x.advertencias.map((t, i) => <div key={i} className="text-amber-800">{t}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
          {errores > 0 && (
            <label className="flex items-center gap-2 text-xs text-rose-800">
              <AlertTriangle className="size-4" />
              <input type="checkbox" checked={soloValidas} onChange={(e) => setSoloValidas(e.target.checked)} />
              Aplicar solo las filas válidas ({errores} con error quedan fuera)
            </label>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">No se eliminan actividades que no estén en el archivo.</span>
          <Button disabled={!puedeAplicar} onClick={() => setConfirmar(true)}>Revisar y confirmar</Button>
        </div>
      </div>

      {confirmar && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmar(false) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Confirmar importación</DialogTitle>
              <DialogDescription>Plan {plan.nombre} · archivo {archivo.nombre} · hoja “{op.hoja}”</DialogDescription>
            </DialogHeader>
            <ul className="grid gap-1 text-sm">
              <li>{cuenta('nueva')} actividades nuevas</li>
              <li>{cuenta('actualizada')} actividades actualizadas</li>
              <li>{cuenta('sin_cambios')} sin cambios (no se tocan)</li>
              {errores > 0 && <li className="text-rose-700">{errores} filas con error (no se aplican)</li>}
              {fasesNuevas.length > 0 && <li>{fasesNuevas.length} fases nuevas</li>}
            </ul>
            <p className="text-[11px] text-muted-foreground">Se aplica en una sola transacción: si el servidor rechaza alguna fila (por permisos o reglas), no se guarda nada del lote. Queda registrado quién importó, cuándo, qué archivo y qué cambió.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmar(false)}>Volver</Button>
              <Button disabled={aplicando} onClick={() => void aplicar()}>{aplicando ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Aplicar importación</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
