import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/features/inventario/components/shared'
import { fechaLocalIso } from '../calculos'
import { registrarControl } from '../remoto'
import type { ContextoObra } from '../useObra'
import { Aviso, fechaCorta } from './ui'

const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'

export default function ControlesTecnicos({ ctx, actividades, puedeRegistrar, controles, alRegistrar, datos }: {
  ctx: ContextoObra; actividades: { id: string; etiqueta: string }[]; puedeRegistrar: boolean
  controles: { id: string; fecha: string; tipo: string; valor: number | null; unidad: string; observaciones: string; registradoNombre: string; actividad: string }[]
  alRegistrar: () => Promise<void>; datos: ContextoObra['datos']
}) {
  const { frente } = ctx
  const [f, setF] = useState({ fecha: fechaLocalIso(), tipo: '', valor: '', unidad: '', actividad: '', observaciones: '' })
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))
  const valido = f.tipo.trim().length >= 3 && !!f.fecha && (f.valor === '' || Number.isFinite(Number(f.valor)))

  async function registrar() {
    setError(null); setAviso(null); setEnviando(true)
    try {
      await registrarControl(datos, frente.id, f.actividad || null, f.fecha, f.tipo.trim(), f.valor === '' ? null : Number(f.valor), f.unidad.trim(), f.observaciones.trim())
      setF({ fecha: fechaLocalIso(), tipo: f.tipo, valor: '', unidad: f.unidad, actividad: f.actividad, observaciones: '' })
      await alRegistrar()
      setAviso('Control técnico registrado.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="dashboard-card" aria-labelledby="controles-titulo">
      <h2 id="controles-titulo" className="text-sm font-semibold">Controles técnicos</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Mediciones de campo (por ejemplo, asentamientos de la precarga). Sustentan el avance, pero no lo calculan.</p>
      {puedeRegistrar && (
        <form className="mt-3 grid gap-2 md:grid-cols-[8.5rem_1fr_6rem_6rem_1fr_auto]" onSubmit={(e) => { e.preventDefault(); if (valido) void registrar() }}>
          <div className="grid gap-1"><Label htmlFor="ctl-fecha" className="text-xs">Fecha *</Label><Input id="ctl-fecha" type="date" max={fechaLocalIso()} value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="ctl-tipo" className="text-xs">Tipo de control *</Label><Input id="ctl-tipo" list="tipos-control" placeholder="Asentamiento" value={f.tipo} onChange={(e) => set('tipo', e.target.value)} />
            <datalist id="tipos-control"><option value="Asentamiento" /><option value="Altura de la precarga" /><option value="Nivelación" /><option value="Humedad" /></datalist></div>
          <div className="grid gap-1"><Label htmlFor="ctl-valor" className="text-xs">Valor</Label><Input id="ctl-valor" type="number" step="any" value={f.valor} onChange={(e) => set('valor', e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="ctl-unidad" className="text-xs">Unidad</Label><Input id="ctl-unidad" placeholder="mm" value={f.unidad} onChange={(e) => set('unidad', e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="ctl-obs" className="text-xs">Observaciones</Label><Input id="ctl-obs" value={f.observaciones} onChange={(e) => set('observaciones', e.target.value)} /></div>
          <div className="flex items-end"><Button type="submit" size="sm" disabled={!valido || enviando}>Registrar</Button></div>
          {actividades.length > 0 && (
            <div className="grid gap-1 md:col-span-6"><Label htmlFor="ctl-act" className="text-xs">Actividad relacionada (opcional)</Label>
              <select id="ctl-act" className={campo} value={f.actividad} onChange={(e) => set('actividad', e.target.value)}><option value="">General del frente</option>{actividades.map((a) => <option key={a.id} value={a.id}>{a.etiqueta}</option>)}</select></div>
          )}
        </form>
      )}
      <div className="mt-2 grid gap-2"><FieldError>{error}</FieldError><Aviso>{aviso}</Aviso></div>
      {controles.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Todavía no hay controles registrados en este frente.</p> : (
        <table className="mt-3 w-full text-xs">
          <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left font-medium">Fecha</th><th className="text-left font-medium">Control</th><th className="text-right font-medium">Valor</th><th className="pl-3 text-left font-medium">Actividad</th><th className="text-left font-medium">Registró</th><th className="text-left font-medium">Observaciones</th></tr></thead>
          <tbody>{controles.slice(0, 40).map((c) => (
            <tr key={c.id} className="border-t border-border"><td className="py-1.5 tabular-nums">{fechaCorta(c.fecha)}</td><td>{c.tipo}</td><td className="text-right tabular-nums">{c.valor === null ? '—' : `${c.valor.toLocaleString('es-EC')} ${c.unidad}`}</td><td className="pl-3">{c.actividad || 'General'}</td><td>{c.registradoNombre}</td><td className="text-muted-foreground">{c.observaciones || '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
    </section>
  )
}
