import { useMemo, useState } from 'react'
import { FileText, Image as Imagen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldError } from '@/features/inventario/components/shared'
import type { Almacen } from '../almacen'
import { aplanar, fechaLocalIso } from '../calculos'
import { cargarEvidencia, tamanoTxt, tipoPorMime, validarArchivo } from '../evidencias'
import { TIPO_EVIDENCIA, type Evidencia, type TipoEvidencia } from '../model'
import { retirarEvidencia } from '../remoto'
import type { ContextoObra } from '../useObra'
import { Aviso, fechaCorta, Vacio } from './ui'

const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'

/** Lista de archivos de respaldo. Se abren con un enlace temporal: el almacenamiento es privado. */
export function ListaEvidencias({ evidencias, etiquetaActividad, almacen, puedeRetirar, onRetirar, mostrarRetiradas }: {
  evidencias: Evidencia[]
  etiquetaActividad: (e: Evidencia) => string
  almacen: Almacen
  puedeRetirar: boolean
  onRetirar?: (e: Evidencia) => void
  mostrarRetiradas: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const visibles = evidencias.filter((e) => mostrarRetiradas || !e.retiradoEn)
  async function abrir(e: Evidencia) {
    setError(null)
    try { window.open(await almacen.urlFirmada(e.ruta), '_blank', 'noopener,noreferrer') } catch (x) { setError((x as Error).message) }
  }
  if (!visibles.length) return <p className="text-xs text-muted-foreground">No hay archivos para mostrar.</p>
  return (
    <div className="grid gap-2">
      <FieldError>{error}</FieldError>
      <ul className="divide-y divide-border text-xs">
        {visibles.map((e) => (
          <li key={e.id} className={`grid gap-1 py-2 sm:grid-cols-[1.5rem_1fr_auto] ${e.retiradoEn ? 'opacity-60' : ''}`}>
            <span className="hidden text-muted-foreground sm:block">{e.tipo === 'foto' ? <Imagen className="size-4" /> : <FileText className="size-4" />}</span>
            <div className="min-w-0">
              <div className="truncate font-medium">{e.nombre}{e.retiradoEn && <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-700">Retirada</span>}</div>
              <div className="text-muted-foreground">{TIPO_EVIDENCIA[e.tipo]} · {etiquetaActividad(e)} · {fechaCorta(e.fecha)}{e.tamano ? ` · ${tamanoTxt(e.tamano)}` : ''} · cargó {e.cargadoNombre}</div>
              {e.descripcion && <div className="text-muted-foreground">{e.descripcion}</div>}
              {e.retiradoMotivo && <div className="text-rose-700">Motivo del retiro: {e.retiradoMotivo}</div>}
            </div>
            <div className="flex items-start gap-1">
              {!e.retiradoEn && <Button size="xs" variant="outline" onClick={() => void abrir(e)} aria-label={`Abrir ${e.nombre}`}>Abrir</Button>}
              {!e.retiradoEn && puedeRetirar && onRetirar && <Button size="xs" variant="ghost" onClick={() => onRetirar(e)} aria-label={`Retirar ${e.nombre}`}>Retirar</Button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Fotografías y documentos por frente y actividad. Nada se borra: una evidencia retirada conserva su archivo y su motivo. */
export default function Evidencias({ ctx }: { ctx: ContextoObra }) {
  const { obra, frente, can, datos, recargar, almacen } = ctx
  const sube = can('obra.avance')
  const edita = can('obra.editar')
  const porId = useMemo(() => new Map(obra.actividades.map((a) => [a.id, a])), [obra.actividades])
  const actividades = useMemo(() => aplanar(obra.actividades.filter((a) => a.frenteId === frente.id)).map((n) => n.actividad).filter((a) => a.estado !== 'cancelada'), [obra.actividades, frente.id])
  const delFrente = obra.evidencias.filter((e) => e.frenteId === frente.id)

  const [filtroActividad, setFiltroActividad] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [retiradas, setRetiradas] = useState(false)
  const [f, setF] = useState<{ tipo: TipoEvidencia; actividad: string; fecha: string; descripcion: string; archivo: File | null }>({ tipo: 'foto', actividad: '', fecha: fechaLocalIso(), descripcion: '', archivo: null })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aRetirar, setARetirar] = useState<Evidencia | null>(null)
  const [motivo, setMotivo] = useState('')
  const [claveEntrada, setClaveEntrada] = useState(0)

  const lista = delFrente.filter((e) => (!filtroActividad || (filtroActividad === '__general__' ? !e.actividadId : e.actividadId === filtroActividad)) && (!filtroTipo || e.tipo === filtroTipo))
  const errorArchivo = f.archivo ? validarArchivo(f.archivo) : null
  const valido = !!f.archivo && !errorArchivo && !!f.fecha

  async function subir() {
    if (!f.archivo) return
    setError(null); setAviso(null); setEnviando(true)
    try {
      await cargarEvidencia({ datos, almacen }, { frenteId: frente.id, actividadId: f.actividad || null, avanceId: null, tipo: f.tipo, descripcion: f.descripcion.trim(), fecha: f.fecha, archivo: f.archivo })
      setAviso(`«${f.archivo.name}» cargado.`)
      setF((p) => ({ ...p, descripcion: '', archivo: null })); setClaveEntrada((k) => k + 1)
      await recargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  async function retirar() {
    if (!aRetirar) return
    setError(null)
    try {
      await retirarEvidencia(datos, aRetirar.id, motivo.trim())
      setARetirar(null); setMotivo('')
      await recargar()
      setAviso('Evidencia retirada. El archivo se conserva en el almacenamiento.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="grid gap-4">
      {sube && (
        <section className="dashboard-card" aria-labelledby="ev-subir">
          <h2 id="ev-subir" className="text-sm font-semibold">Cargar fotografía o documento · {frente.nombre}</h2>
          <form className="mt-3 grid gap-3 md:grid-cols-[10rem_1fr_9rem]" onSubmit={(e) => { e.preventDefault(); if (valido) void subir() }}>
            <div className="grid gap-1.5"><Label htmlFor="ev-tipo" className="text-xs">Tipo *</Label>
              <select id="ev-tipo" className={campo} value={f.tipo} onChange={(e) => setF((p) => ({ ...p, tipo: e.target.value as TipoEvidencia }))}>
                {(Object.keys(TIPO_EVIDENCIA) as TipoEvidencia[]).map((t) => <option key={t} value={t}>{TIPO_EVIDENCIA[t]}</option>)}
              </select></div>
            <div className="grid gap-1.5"><Label htmlFor="ev-actividad" className="text-xs">Actividad</Label>
              <select id="ev-actividad" className={campo} value={f.actividad} onChange={(e) => setF((p) => ({ ...p, actividad: e.target.value }))}>
                <option value="">General del frente</option>
                {actividades.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>)}
              </select></div>
            <div className="grid gap-1.5"><Label htmlFor="ev-fecha" className="text-xs">Fecha *</Label><Input id="ev-fecha" type="date" max={fechaLocalIso()} value={f.fecha} onChange={(e) => setF((p) => ({ ...p, fecha: e.target.value }))} /></div>
            <div className="grid gap-1.5 md:col-span-2"><Label htmlFor="ev-desc" className="text-xs">Descripción</Label><Input id="ev-desc" value={f.descripcion} onChange={(e) => setF((p) => ({ ...p, descripcion: e.target.value }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ev-archivo" className="text-xs">Archivo * (máx. 25 MB)</Label>
              <input key={claveEntrada} id="ev-archivo" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx" className="text-xs"
                onChange={(e) => { const a = e.target.files?.[0] ?? null; setF((p) => ({ ...p, archivo: a, tipo: a ? tipoPorMime(a.type) : p.tipo })) }} /></div>
            <div className="md:col-span-3 flex items-center gap-3">
              <Button type="submit" disabled={!valido || enviando}><Upload />{enviando ? 'Cargando…' : 'Cargar archivo'}</Button>
              <FieldError>{errorArchivo}</FieldError>
            </div>
          </form>
        </section>
      )}

      <section className="dashboard-card" aria-labelledby="ev-lista">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ev-lista" className="text-sm font-semibold">Evidencias y documentos</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select className={campo} aria-label="Filtrar por actividad" value={filtroActividad} onChange={(e) => setFiltroActividad(e.target.value)}>
              <option value="">Todas las actividades</option><option value="__general__">General del frente</option>
              {actividades.map((a) => <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>)}
            </select>
            <select className={campo} aria-label="Filtrar por tipo" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Todos los tipos</option>{(Object.keys(TIPO_EVIDENCIA) as TipoEvidencia[]).map((t) => <option key={t} value={t}>{TIPO_EVIDENCIA[t]}</option>)}
            </select>
            {edita && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={retiradas} onChange={(e) => setRetiradas(e.target.checked)} />Mostrar retiradas</label>}
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          <FieldError>{error}</FieldError><Aviso>{aviso}</Aviso>
          {delFrente.length === 0
            ? <Vacio titulo="Todavía no hay archivos en este frente">Las fotografías y los informes se cargan por fecha y actividad. Los archivos son privados: solo los abre quien tiene permiso.</Vacio>
            : <ListaEvidencias evidencias={lista} etiquetaActividad={(e) => (e.actividadId ? (porId.get(e.actividadId)?.codigo ?? 'Actividad') : 'General')} almacen={almacen} puedeRetirar={edita} onRetirar={(e) => { setARetirar(e); setMotivo('') }} mostrarRetiradas={retiradas} />}
        </div>
      </section>

      {aRetirar && (
        <Dialog open onOpenChange={(o) => { if (!o) setARetirar(null) }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Retirar «{aRetirar.nombre}»</DialogTitle><DialogDescription>Deja de mostrarse, pero el archivo y el motivo se conservan.</DialogDescription></DialogHeader>
            <div className="grid gap-1.5"><Label htmlFor="ev-motivo" className="text-xs">Motivo *</Label><Input id="ev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
            <DialogFooter><Button variant="outline" onClick={() => setARetirar(null)}>Cancelar</Button><Button disabled={motivo.trim().length < 5} onClick={() => void retirar()}>Retirar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
