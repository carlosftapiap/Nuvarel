import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, History, Pencil, Replace, RotateCcw, Star, Trash2, Upload } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { almacenPagos } from '@/features/cobranza/comprobantes'
import type { Datos } from '@/features/conexion/datos'
import ArchivosSinVincular from '@/features/config/remoto/ArchivosSinVincular'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtFecha } from '@/features/inventario/pricing'
import {
  ACEPTA_MEDIOS, actualizarMedio, aMedio, BUCKET_MULTIMEDIA, cargarBiblioteca, crearMedio, destacarMedio, eliminarMedio, firmarRutas, LIMITES_MEDIOS, recuperarMedio, reemplazarMedio,
  reordenarMedios, restaurarVersion, rutasDe, vigente, type MedioAdmin, type VersionMedio,
} from '@/features/marca/biblioteca'
import { fmtDuracion } from '@/features/marca/medios'
import VisorMedios from '@/features/marca/VisorMedios'

const pesoLegible = (b: number | null) => (b === null ? null : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`)

/** Solo administradores: el resto de perfiles no ve esta pantalla y la base de datos rechaza sus cambios. */
export default function MultimediaProyecto({ datos }: { datos: Datos }) {
  const conexion = useConexion()
  const almacen = almacenPagos(conexion)
  const [lista, setLista] = useState<MedioAdmin[] | null>(null)
  const [sinActivar, setSinActivar] = useState(false)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [carga, setCarga] = useState<{ medio: MedioAdmin | null } | null>(null)
  const [editar, setEditar] = useState<MedioAdmin | null>(null)
  const [versiones, setVersiones] = useState<MedioAdmin | null>(null)
  const [eliminar, setEliminar] = useState<MedioAdmin | null>(null)
  const [vista, setVista] = useState<MedioAdmin | null>(null)

  const cargar = useCallback(async () => {
    try {
      const m = await cargarBiblioteca(datos)
      setLista(m); setSinActivar(false)
      // Sin firma, la miniatura muestra su lugar vacío; el resto de la pantalla sigue operativa.
      setUrls(await firmarRutas(almacen, m.flatMap((x) => x.versiones.flatMap(rutasDe))).catch(() => ({})))
      return m
    } catch { setSinActivar(true); return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el almacén no cambia durante la sesión.
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])
  useEffect(() => {
    datos.select<{ id: string; nombre: string }>('profiles').then((f) => setNombres(Object.fromEntries(f.map((p) => [p.id, p.nombre])))).catch(() => {})
  }, [datos])

  async function hacer(accion: () => Promise<unknown>, mensaje: string) {
    setError(null); setAviso(null); setOcupado(true)
    try { await accion(); setAviso(mensaje); await cargar(); return true } catch (e) { setError((e as Error).message); return false } finally { setOcupado(false) }
  }

  if (sinActivar) {
    return (
      <section aria-labelledby="mm-tit" className="dashboard-card p-5">
        <h2 id="mm-tit" className="text-sm font-semibold">Multimedia del proyecto</h2>
        <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">La biblioteca aún no está activada en la base de datos. Mientras tanto, la app sigue mostrando las fotografías y el video incluidos.</p>
      </section>
    )
  }
  if (!lista) return <p role="status" className="dashboard-card p-5 text-xs text-muted-foreground">Cargando material…</p>

  const activos = lista.filter((m) => !m.eliminadoEn)
  const eliminados = lista.filter((m) => m.eliminadoEn)
  const mover = (i: number, d: number) => {
    const ids = activos.map((m) => m.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    void hacer(() => reordenarMedios(datos, ids), 'Orden actualizado.')
  }
  const medioVista = vista && aMedio(vista, vigente(vista), urls)

  return (
    <div className="grid gap-4">
      <section aria-labelledby="mm-tit" className="dashboard-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-60 flex-1">
            <h2 id="mm-tit" className="text-sm font-semibold">Multimedia del proyecto</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">El administrador publica y los vendedores presentan. Reemplazar no borra la versión anterior: se puede restaurar.</p>
          </div>
          <Button size="sm" onClick={() => { setError(null); setAviso(null); setCarga({ medio: null }) }}><Upload />Subir fotografía o video</Button>
        </div>
        <div className="mt-2 empty:hidden"><FieldError>{error}</FieldError></div>
        {aviso && <p role="status" className="mt-2 text-xs text-emerald-800">{aviso}</p>}

        {activos.length === 0
          ? <p className="mt-3 rounded-lg bg-muted/50 px-3 py-6 text-center text-xs text-muted-foreground">Todavía no hay contenidos. Sube la primera fotografía o video.</p>
          : (
            <ul className="mt-3 grid gap-2">
              {activos.map((m, i) => {
                const v = vigente(m)
                const mini = v ? urls[v.miniaturaRuta] : undefined
                return (
                  <li key={m.id} aria-label={m.titulo} className="grid gap-3 rounded-xl border border-border p-3 md:grid-cols-[88px_minmax(0,1fr)_auto] md:items-center">
                    <div className="relative h-20 w-[88px] overflow-hidden rounded-lg bg-[#dad3c1]">
                      {mini && <img src={mini} alt="" loading="lazy" className="size-full object-cover" />}
                      {m.tipo === 'video' && <span className="absolute bottom-1 left-1 rounded bg-[#282828]/80 px-1 text-xs text-white">Video{v?.duracion ? ` · ${fmtDuracion(v.duracion)}` : ''}</span>}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold">{m.titulo}</span>
                        {m.destacado && <span className="rounded-full bg-[#dad3c1] px-2 py-0.5 text-xs font-medium text-[#282828]">En el banner</span>}
                        {!m.activo && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Oculto</span>}
                      </div>
                      {m.descripcion && <p className="truncate text-xs text-muted-foreground">{m.descripcion}</p>}
                      <p className="text-xs text-muted-foreground">Versión {v?.numero ?? '—'} · Actualizado el {fmtFecha(m.actualizadoEn)}{m.actualizadoPor ? ` por ${nombres[m.actualizadoPor] ?? 'un administrador'}` : ''}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ocupado} checked={m.activo} onChange={(e) => void hacer(() => actualizarMedio(datos, m, { activo: e.target.checked }), e.target.checked ? `«${m.titulo}» visible.` : `«${m.titulo}» oculto.`)} />Visible</label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ocupado} checked={m.enDashboard} onChange={(e) => void hacer(() => actualizarMedio(datos, m, { enDashboard: e.target.checked }), 'Dashboard actualizado.')} />Dashboard</label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" disabled={ocupado} checked={m.enVenta} onChange={(e) => void hacer(() => actualizarMedio(datos, m, { enVenta: e.target.checked }), 'Atender cliente actualizado.')} />Atender cliente</label>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 md:max-w-64 md:justify-end">
                      <Button size="icon-sm" variant="outline" aria-label={`Subir ${m.titulo}`} disabled={ocupado || i === 0} onClick={() => mover(i, -1)}><ArrowUp /></Button>
                      <Button size="icon-sm" variant="outline" aria-label={`Bajar ${m.titulo}`} disabled={ocupado || i === activos.length - 1} onClick={() => mover(i, 1)}><ArrowDown /></Button>
                      <Button size="xs" variant="outline" aria-pressed={m.destacado} disabled={ocupado || !m.activo} onClick={() => void hacer(() => destacarMedio(datos, m.destacado ? null : m.id), m.destacado ? 'El banner vuelve a la primera imagen publicada.' : `«${m.titulo}» es ahora el banner del Dashboard.`)}><Star />{m.destacado ? 'Quitar del banner' : 'Usar en banner'}</Button>
                      <Button size="xs" variant="outline" disabled={!v} onClick={() => setVista(m)}><Eye />Ver</Button>
                      <Button size="xs" variant="outline" onClick={() => { setError(null); setEditar(m) }}><Pencil />Editar</Button>
                      <Button size="xs" variant="outline" onClick={() => { setError(null); setAviso(null); setCarga({ medio: m }) }}><Replace />Reemplazar</Button>
                      <Button size="xs" variant="outline" onClick={() => setVersiones(m)}><History />Versiones ({m.versiones.length})</Button>
                      <Button size="xs" variant="outline" onClick={() => setEliminar(m)}><Trash2 />Eliminar</Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

        {eliminados.length > 0 && (
          <details className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
            <summary className="cursor-pointer font-medium">Eliminados ({eliminados.length})</summary>
            <p className="mt-1 text-muted-foreground">Sus archivos y versiones se conservan. Al recuperarlos vuelven ocultos.</p>
            <ul className="mt-1 grid gap-1">
              {eliminados.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{m.titulo} <span className="text-muted-foreground">· {fmtFecha(m.eliminadoEn!)}</span></span>
                  <Button size="xs" variant="outline" disabled={ocupado} onClick={() => void hacer(() => recuperarMedio(datos, m.id), `«${m.titulo}» recuperado y oculto.`)}><RotateCcw />Recuperar</Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <ArchivosSinVincular datos={datos} titulo="Archivos multimedia sin vincular" descripcion="Cargas interrumpidas hace más de 24 horas. Lo que pertenece a una versión no aparece aquí y no se puede quitar." rpcListar="medios_sin_vincular" rpcRegistrar="medio_limpieza_registrar" bucket={BUCKET_MULTIMEDIA} />

      {carga && <CargaDialog medio={carga.medio} onCerrar={() => setCarga(null)} onHecho={async (mensaje) => { setCarga(null); setAviso(mensaje); await cargar() }}
        subir={async (d, archivo, vertical) => {
          if (carga.medio) await reemplazarMedio(datos, almacen, carga.medio, archivo, vertical)
          else await crearMedio(datos, almacen, d, archivo, vertical)
        }} />}
      {editar && <EditarDialog medio={editar} onCerrar={() => setEditar(null)} guardar={async (titulo, descripcion) => { if (await hacer(() => actualizarMedio(datos, editar, { titulo, descripcion }), 'Datos guardados.')) setEditar(null) }} error={error} ocupado={ocupado} />}
      {versiones && <VersionesDialog medio={lista.find((m) => m.id === versiones.id) ?? versiones} urls={urls} nombres={nombres} ocupado={ocupado} error={error} onCerrar={() => setVersiones(null)}
        restaurar={(v) => void hacer(() => restaurarVersion(datos, versiones.id, v.id), `Versión ${v.numero} restaurada.`)} />}
      {eliminar && (
        <Dialog open onOpenChange={(o) => { if (!o) setEliminar(null) }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Eliminar «{eliminar.titulo}»</DialogTitle>
              <DialogDescription>Deja de mostrarse en toda la app. Sus archivos y versiones se conservan, y se puede recuperar desde «Eliminados».</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEliminar(null)}>Cancelar</Button>
              <Button variant="destructive" disabled={ocupado} onClick={() => { const m = eliminar; setEliminar(null); void hacer(() => eliminarMedio(datos, m.id), `«${m.titulo}» eliminado.`) }}>Eliminar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {medioVista && <VisorMedios medios={[medioVista]} inicio={0} onCerrar={() => setVista(null)} />}
    </div>
  )
}

/* ------------------------------------------------------- subir y reemplazar */

function CargaDialog({ medio, subir, onCerrar, onHecho }: {
  medio: MedioAdmin | null
  subir: (d: { titulo: string; descripcion: string; enDashboard: boolean; enVenta: boolean }, archivo: File, vertical: File | null) => Promise<void>
  onCerrar: () => void
  onHecho: (mensaje: string) => Promise<void>
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vertical, setVertical] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [enDashboard, setEnDashboard] = useState(true)
  const [enVenta, setEnVenta] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const esVideo = medio ? medio.tipo === 'video' : archivo?.type.startsWith('video/') ?? false

  async function enviar() {
    if (!archivo) return
    setError(null); setSubiendo(true)
    try {
      await subir({ titulo, descripcion, enDashboard, enVenta }, archivo, esVideo ? vertical : null)
      await onHecho(medio ? `«${medio.titulo}» reemplazado. La versión anterior se conserva.` : `«${titulo.trim()}» cargado.`)
    } catch (e) { setError((e as Error).message); setSubiendo(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !subiendo) onCerrar() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{medio ? `Reemplazar «${medio.titulo}»` : 'Subir fotografía o video'}</DialogTitle>
          <DialogDescription>{LIMITES_MEDIOS}{medio ? ' La versión actual se conserva y se puede restaurar.' : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mm-archivo" className="text-xs">Archivo *</Label>
            <Input id="mm-archivo" type="file" accept={medio ? (medio.tipo === 'video' ? 'video/mp4,video/webm' : 'image/jpeg,image/png,image/webp') : ACEPTA_MEDIOS} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            {archivo && <p className="text-xs text-muted-foreground">{archivo.name} · {pesoLegible(archivo.size)}</p>}
          </div>
          {esVideo && (
            <div className="grid gap-1.5">
              <Label htmlFor="mm-vertical" className="text-xs">Versión vertical para celulares (opcional)</Label>
              <Input id="mm-vertical" type="file" accept="video/mp4,video/webm" onChange={(e) => setVertical(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">Sin ella, los celulares reproducen este mismo video.</p>
            </div>
          )}
          {!medio && (
            <>
              <div className="grid gap-1.5"><Label htmlFor="mm-titulo" className="text-xs">Título *</Label><Input id="mm-titulo" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label htmlFor="mm-desc" className="text-xs">Descripción</Label><Textarea id="mm-desc" rows={2} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
              <fieldset className="grid gap-1 text-xs">
                <legend className="mb-1">Dónde se muestra</legend>
                <label className="flex items-center gap-2"><input type="checkbox" checked={enDashboard} onChange={(e) => setEnDashboard(e.target.checked)} />Dashboard</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={enVenta} onChange={(e) => setEnVenta(e.target.checked)} />Ventas · Atender cliente</label>
              </fieldset>
            </>
          )}
          <FieldError>{error}</FieldError>
          {subiendo && <p role="status" className="text-xs text-muted-foreground">Preparando y subiendo el archivo…</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={subiendo} onClick={onCerrar}>Cancelar</Button>
          <Button disabled={subiendo || !archivo || (!medio && titulo.trim().length < 3)} onClick={() => void enviar()}>{medio ? 'Reemplazar' : 'Subir'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditarDialog({ medio, guardar, onCerrar, error, ocupado }: { medio: MedioAdmin; guardar: (titulo: string, descripcion: string) => Promise<void>; onCerrar: () => void; error: string | null; ocupado: boolean }) {
  const [titulo, setTitulo] = useState(medio.titulo)
  const [descripcion, setDescripcion] = useState(medio.descripcion)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Editar contenido</DialogTitle><DialogDescription>El título y la descripción se muestran a los clientes.</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label htmlFor="mm-e-titulo" className="text-xs">Título *</Label><Input id="mm-e-titulo" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="mm-e-desc" className="text-xs">Descripción</Label><Textarea id="mm-e-desc" rows={3} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
          <Button disabled={ocupado || titulo.trim().length < 3} onClick={() => void guardar(titulo, descripcion)}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function VersionesDialog({ medio, urls, nombres, ocupado, error, restaurar, onCerrar }: { medio: MedioAdmin; urls: Record<string, string>; nombres: Record<string, string>; ocupado: boolean; error: string | null; restaurar: (v: VersionMedio) => void; onCerrar: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCerrar() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Versiones de «{medio.titulo}»</DialogTitle><DialogDescription>Restaurar cambia la versión que se muestra. Ninguna versión se borra.</DialogDescription></DialogHeader>
        <FieldError>{error}</FieldError>
        <ul className="grid gap-2">
          {medio.versiones.map((v) => (
            <li key={v.id} aria-label={`Versión ${v.numero}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2 text-xs">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-[#dad3c1]">{urls[v.miniaturaRuta] && <img src={urls[v.miniaturaRuta]} alt="" loading="lazy" className="size-full object-cover" />}</div>
              <div className="min-w-40 flex-1">
                <div className="font-semibold">Versión {v.numero}{v.id === medio.versionVigente && <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Vigente</span>}</div>
                <div className="truncate text-muted-foreground">{[v.archivoNombre, v.ancho && v.alto ? `${v.ancho}×${v.alto}` : null, pesoLegible(v.tamano)].filter(Boolean).join(' · ')}</div>
                <div className="text-muted-foreground">{v.cargadoPor ? `${nombres[v.cargadoPor] ?? 'Un administrador'} · ${fmtFecha(v.cargadoEn)}` : 'Material inicial de AMURA'}</div>
              </div>
              {v.id !== medio.versionVigente && <Button size="xs" variant="outline" disabled={ocupado} onClick={() => restaurar(v)}><RotateCcw />Restaurar</Button>}
            </li>
          ))}
        </ul>
        <DialogFooter><Button variant="outline" onClick={onCerrar}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
