import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { cargarCatalogo, etiquetaCatalogo } from '../expediente'

/** Lista de documentos obligatorios: provisional, configurable por administración y versionada. Nada se borra: se desactiva. */
type Fila = Record<string, unknown>
interface Tipo { clave: string; tipoPersona: 'natural' | 'juridica'; nombre: string; obligatorio: boolean; orden: number; activo: boolean }

export default function CatalogoExpediente({ datos }: { datos: Datos }) {
  const [tipos, setTipos] = useState<Tipo[] | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [editar, setEditar] = useState<Tipo | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const cargar = useCallback(async () => {
    const [f, c] = await Promise.all([datos.select<Fila>('expediente_tipos', { orden: [{ columna: 'tipo_persona' }, { columna: 'orden' }] }).catch(() => null), cargarCatalogo(datos)])
    setTipos(f ? f.map((t) => ({ clave: String(t.clave), tipoPersona: t.tipo_persona as Tipo['tipoPersona'], nombre: String(t.nombre), obligatorio: Boolean(t.obligatorio), orden: Number(t.orden), activo: Boolean(t.activo) })) : [])
    setVersion(etiquetaCatalogo(c))
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])
  const guardar = async () => {
    if (!editar) return
    setEnviando(true); setError(null); setAviso(null)
    try {
      const v = await datos.rpc<number>('expediente_catalogo_definir', {
        p_clave: editar.clave, p_tipo_persona: editar.tipoPersona, p_nombre: editar.nombre, p_obligatorio: editar.obligatorio, p_orden: editar.orden, p_activo: editar.activo, p_provisional: true, p_motivo: motivo,
      })
      setAviso(`Lista actualizada: versión ${v}`); setEditar(null); setMotivo('')
      await cargar()
    } catch (e) { setError((e as Error).message) }
    setEnviando(false)
  }
  if (!tipos) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando documentos…</p>

  return (
    <section className="dashboard-card grid gap-3 p-5" aria-labelledby="cat-titulo">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="cat-titulo" className="text-sm font-semibold">Documentos del expediente</h2>
        {version && <span className="text-xs text-muted-foreground">{version}</span>}
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setNuevo(true); setEditar({ clave: '', tipoPersona: 'natural', nombre: '', obligatorio: true, orden: 10, activo: true }) }}>Agregar documento</Button>
      </div>
      {aviso && <p role="status" className="text-xs text-emerald-700">{aviso}</p>}
      <table className="w-full text-xs">
        <thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium">Documento</th><th className="px-2 py-1.5 text-left font-medium">Persona</th><th className="px-2 py-1.5 text-left font-medium">Obligatorio</th><th className="px-2 py-1.5 text-left font-medium">Estado</th><th /></tr></thead>
        <tbody>
          {tipos.map((t) => (
            <tr key={t.clave} className={t.activo ? 'border-t border-border' : 'border-t border-border text-muted-foreground'}>
              <td className="px-3 py-1.5">{t.nombre}</td><td className="px-2 py-1.5">{t.tipoPersona === 'natural' ? 'Natural' : 'Jurídica'}</td>
              <td className="px-2 py-1.5">{t.obligatorio ? 'Sí' : 'No'}</td><td className="px-2 py-1.5">{t.activo ? 'Activo' : 'Desactivado'}</td>
              <td className="px-3 py-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => { setNuevo(false); setEditar(t) }}>Editar</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editar && (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
          <div className="grid gap-1"><Label htmlFor="cat-clave" className="text-xs">Clave *</Label><Input id="cat-clave" value={editar.clave} disabled={!nuevo} onChange={(e) => setEditar({ ...editar, clave: e.target.value })} /></div>
          <div className="grid gap-1"><Label htmlFor="cat-nombre" className="text-xs">Nombre *</Label><Input id="cat-nombre" value={editar.nombre} onChange={(e) => setEditar({ ...editar, nombre: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-xs">Persona
            <select aria-label="Persona" disabled={!nuevo} className="rounded-md border border-border px-1.5 py-0.5" value={editar.tipoPersona} onChange={(e) => setEditar({ ...editar, tipoPersona: e.target.value as Tipo['tipoPersona'] })}><option value="natural">Natural</option><option value="juridica">Jurídica</option></select>
          </label>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editar.obligatorio} onChange={(e) => setEditar({ ...editar, obligatorio: e.target.checked })} />Obligatorio</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editar.activo} onChange={(e) => setEditar({ ...editar, activo: e.target.checked })} />Activo</label>
          </div>
          <div className="grid gap-1 sm:col-span-2"><Label htmlFor="cat-motivo" className="text-xs">Motivo del cambio * (mínimo 10 caracteres)</Label><Input id="cat-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={enviando || motivo.trim().length < 10} onClick={() => void guardar()}>{enviando && <Loader2 className="animate-spin" />}Guardar versión nueva</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditar(null); setError(null) }}>Cancelar</Button>
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </section>
  )
}
