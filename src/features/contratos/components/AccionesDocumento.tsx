import { useCallback, useEffect, useState } from 'react'
import { Download, Eye, FileCheck2, FilePlus2, FileText, History, Paperclip, Users } from 'lucide-react'
import type { Permiso } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import type { AlmacenContratos } from '../almacen'
import { adjuntarDocumentoFirmado, descargarBlob, obtenerArchivo, validarFirmado, type ArchivoVersion } from '../generar'
import { ESTADO_DOCUMENTO, type EventoDocumento, type VersionDocumento } from '../model'
import * as api from '../remoto'
import CompradoresDialog from './CompradoresDialog'
import GenerarDialog from './GenerarDialog'
import { VisorDocumento } from './VistaPrevia'

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const dia = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—')

export const EstadoDoc = ({ e }: { e: VersionDocumento['estado'] }) => (
  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ESTADO_DOCUMENTO[e].tono)}>{ESTADO_DOCUMENTO[e].label}</span>
)

type Dialogo =
  | { tipo: 'ver'; version: VersionDocumento } | { tipo: 'generar' } | { tipo: 'adjuntar'; version: VersionDocumento } | { tipo: 'historial' } | { tipo: 'compradores' }
  | { tipo: 'motivo'; accion: 'emitir' | 'validar' | 'anular'; version: VersionDocumento }

/**
 * Documentos contractuales de una venta. Las acciones visibles son Ver contrato · PDF · Word · Adjuntar firmado;
 * la base decide quién puede cada cosa, aquí solo se muestran las que el perfil puede usar.
 */
export default function AccionesDocumento({ venta, versiones, datos, almacen, can, compacto = false, onCambio }: {
  venta: { id: string; codigo: string; estado: string }
  versiones: VersionDocumento[]
  datos: Datos
  almacen: AlmacenContratos
  can: (p: Permiso) => boolean
  compacto?: boolean
  onCambio: () => Promise<void>
}) {
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const vigente = versiones.find((v) => v.estado !== 'anulado') ?? null
  const ver = can('ventas.documentos_ver')
  const genera = can('ventas.documentos_generar') && venta.estado !== 'anulado'

  async function bajar(v: VersionDocumento, cual: ArchivoVersion) {
    setError(null)
    try { const { blob, nombre } = await obtenerArchivo(almacen, v, cual); descargarBlob(blob, nombre) } catch (e) { setError((e as Error).message) }
  }

  if (!ver && !genera) return null
  const parar = (e: React.SyntheticEvent) => e.stopPropagation()
  const tam = compacto ? 'xs' : 'sm'

  return (
    <div onClick={parar} onKeyDown={parar} className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Documentos de ${venta.codigo}`}>
        {vigente && ver && (
          <>
            <Button size={tam} variant="outline" aria-label={`Ver contrato ${venta.codigo}`} onClick={() => setDialogo({ tipo: 'ver', version: vigente })}><Eye />Ver contrato</Button>
            <Button size={tam} variant="outline" aria-label={`Descargar PDF ${venta.codigo}`} onClick={() => void bajar(vigente, 'pdf')}><FileText />PDF</Button>
            <Button size={tam} variant="outline" aria-label={`Descargar Word ${venta.codigo}`} disabled={!vigente.docxRuta} onClick={() => void bajar(vigente, 'docx')}><Download />Word</Button>
            {can('ventas.preparar') && (
              <Button size={tam} variant="outline" aria-label={`Adjuntar firmado ${venta.codigo}`} disabled={vigente.estado !== 'pendiente_firma'} title={vigente.estado !== 'pendiente_firma' ? 'Se adjunta cuando Gerencia autoriza la emisión y el documento queda pendiente de firma' : undefined}
                onClick={() => setDialogo({ tipo: 'adjuntar', version: vigente })}><Paperclip />Adjuntar firmado</Button>
            )}
          </>
        )}
        {genera && <Button size={tam} variant={vigente ? 'ghost' : 'default'} aria-label={`Generar documento ${venta.codigo}`} onClick={() => setDialogo({ tipo: 'generar' })}><FilePlus2 />{vigente ? 'Nueva versión' : 'Generar documento'}</Button>}
        {ver && versiones.length > 0 && <Button size={tam} variant="ghost" aria-label={`Historial de documentos ${venta.codigo}`} onClick={() => setDialogo({ tipo: 'historial' })}><History />Historial</Button>}
        {!vigente && !genera && <span className="text-xs text-muted-foreground">Sin documento generado</span>}
      </div>

      {!compacto && (
        <div className="grid gap-2 text-xs">
          {vigente ? (
            <p className="flex flex-wrap items-center gap-2">
              <EstadoDoc e={vigente.estado} /> <span>Versión {vigente.numero} · plantilla «{vigente.plantillaNombre}» v{vigente.plantillaVersion} · generada por {vigente.generadoNombre} el {fecha(vigente.generadoEn)}</span>
              {vigente.emitidoNombre && <span className="text-muted-foreground">Emisión autorizada por {vigente.emitidoNombre}</span>}
              {vigente.estado === 'pendiente_firma' && vigente.firmadoRuta && <span className="text-sky-800">Firma adjunta por {vigente.firmadoCargadoNombre}: falta que Legal la valide.</span>}
              {vigente.estado === 'firmado' && <span className="text-emerald-700">Firma validada por {vigente.firmaValidadaNombre} el {fecha(vigente.firmaValidadaEn)}.</span>}
            </p>
          ) : versiones.length > 0 ? <p className="text-muted-foreground">Todas las versiones están anuladas. Genera una nueva.</p> : <p className="text-muted-foreground">Aún no se ha generado ningún documento de este contrato.</p>}
          <div className="flex flex-wrap gap-1.5">
            {(can('ventas.datos_comprador') || ver) && <Button size="sm" variant="outline" onClick={() => setDialogo({ tipo: 'compradores' })}><Users />Compradores y apoderados</Button>}
            {vigente?.estado === 'borrador' && can('ventas.documentos_emitir') && <Button size="sm" onClick={() => setDialogo({ tipo: 'motivo', accion: 'emitir', version: vigente })}><FileCheck2 />Autorizar emisión</Button>}
            {vigente?.estado === 'pendiente_firma' && vigente.firmadoRuta && can('ventas.formalizar') && <Button size="sm" onClick={() => setDialogo({ tipo: 'motivo', accion: 'validar', version: vigente })}><FileCheck2 />Validar firma</Button>}
            {vigente && can('ventas.formalizar') && <Button size="sm" variant="outline" className="text-rose-700" onClick={() => setDialogo({ tipo: 'motivo', accion: 'anular', version: vigente })}>Anular documento</Button>}
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
      {aviso && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{aviso}</p>}

      {dialogo?.tipo === 'ver' && <VisorDocumento version={dialogo.version} almacen={almacen} titulo={`Contrato ${venta.codigo}`} onClose={() => setDialogo(null)} />}
      {dialogo?.tipo === 'generar' && <GenerarDialog datos={datos} almacen={almacen} contratoId={venta.id} codigo={venta.codigo} versiones={versiones} onCompradores={() => setDialogo({ tipo: 'compradores' })} onCambio={async () => { await onCambio(); setAviso('Documento generado y guardado en Supabase.') }} onClose={() => setDialogo(null)} />}
      {dialogo?.tipo === 'compradores' && <CompradoresDialog datos={datos} contratoId={venta.id} codigo={venta.codigo} puedeEditar={can('ventas.datos_comprador')} onCambio={onCambio} onClose={() => setDialogo(null)} />}
      {dialogo?.tipo === 'adjuntar' && <AdjuntarDialog version={dialogo.version} datos={datos} almacen={almacen} onCambio={async () => { await onCambio(); setAviso('Documento firmado adjuntado. Legal debe validarlo para que figure como firmado.') }} onClose={() => setDialogo(null)} />}
      {dialogo?.tipo === 'historial' && <HistorialDialog venta={venta} versiones={versiones} datos={datos} onVer={(v) => setDialogo({ tipo: 'ver', version: v })} onBajar={(v, c) => void bajar(v, c)} onClose={() => setDialogo(null)} />}
      {dialogo?.tipo === 'motivo' && (
        <MotivoDialog
          titulo={dialogo.accion === 'emitir' ? 'Autorizar emisión' : dialogo.accion === 'validar' ? 'Validar firma' : 'Anular documento'}
          descripcion={dialogo.accion === 'emitir' ? `Versión ${dialogo.version.numero}: pasa a pendiente de firma y ya no puede modificarse.`
            : dialogo.accion === 'validar' ? `Confirma que el documento firmado adjunto (${dialogo.version.firmadoNombre}) corresponde a la versión ${dialogo.version.numero}. Quedará como firmado y fijo.`
            : `La versión ${dialogo.version.numero} queda anulada y se conserva. Si estaba firmada, se podrá generar otra.`}
          accion={dialogo.accion === 'emitir' ? 'Autorizar' : dialogo.accion === 'validar' ? 'Validar firma' : 'Anular'} peligro={dialogo.accion === 'anular'}
          onClose={() => setDialogo(null)}
          onConfirm={async (motivo) => {
            const v = dialogo.version
            if (dialogo.accion === 'emitir') await api.emitirDocumento(datos, v.id, motivo)
            else if (dialogo.accion === 'validar') await api.validarFirma(datos, v.id, motivo)
            else await api.anularDocumento(datos, v.id, motivo)
            await onCambio()
            setAviso(dialogo.accion === 'emitir' ? 'Emisión autorizada: el documento está pendiente de firma.' : dialogo.accion === 'validar' ? 'Firma validada: el documento figura como firmado.' : 'Documento anulado.')
          }} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ diálogos */

function MotivoDialog({ titulo, descripcion, accion, peligro, onClose, onConfirm }: { titulo: string; descripcion: string; accion: string; peligro?: boolean; onClose: () => void; onConfirm: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function ir() { setError(null); setOcupado(true); try { await onConfirm(motivo.trim()); onClose() } catch (e) { setError((e as Error).message) } finally { setOcupado(false) } }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>{descripcion}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="doc-motivo" className="text-xs">Motivo *</Label><Input id="doc-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <FieldError>{error}</FieldError>
        <DialogFooter><Button variant="outline" onClick={onClose}>Volver</Button><Button variant={peligro ? 'destructive' : 'default'} disabled={ocupado || motivo.trim().length < 5} onClick={() => void ir()}>{ocupado ? 'Guardando…' : accion}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdjuntarDialog({ version, datos, almacen, onCambio, onClose }: { version: VersionDocumento; datos: Datos; almacen: AlmacenContratos; onCambio: () => Promise<void>; onClose: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [firmado, setFirmado] = useState(hoyGuayaquil())
  const [motivo, setMotivo] = useState('Contrato suscrito por las partes')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const errorArchivo = archivo ? validarFirmado(archivo) : null
  async function ir() {
    if (!archivo) return
    setError(null); setOcupado(true)
    try { await adjuntarDocumentoFirmado(datos, almacen, version, archivo, firmado, motivo.trim()); await onCambio(); onClose() } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjuntar documento firmado</DialogTitle>
          <DialogDescription>Versión {version.numero}. Se guarda en el almacenamiento privado con su huella de integridad. No queda como «firmado» hasta que Legal lo valide.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="grid gap-1.5"><Label htmlFor="firm-archivo" className="text-xs">Documento firmado (PDF, JPG o PNG, máx. 25 MB) *</Label>
            <input id="firm-archivo" type="file" accept="application/pdf,image/jpeg,image/png" className="text-xs" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
          <FieldError>{errorArchivo}</FieldError>
          <div className="grid gap-1.5"><Label htmlFor="firm-fecha" className="text-xs">Fecha de la firma *</Label><Input id="firm-fecha" type="date" max={hoyGuayaquil()} value={firmado} onChange={(e) => setFirmado(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="firm-motivo" className="text-xs">Motivo *</Label><Input id="firm-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Volver</Button><Button disabled={!archivo || !!errorArchivo || ocupado || !firmado || motivo.trim().length < 5} onClick={() => void ir()}>{ocupado ? 'Subiendo…' : 'Adjuntar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HistorialDialog({ venta, versiones, datos, onVer, onBajar, onClose }: {
  venta: { id: string; codigo: string }; versiones: VersionDocumento[]; datos: Datos; onVer: (v: VersionDocumento) => void; onBajar: (v: VersionDocumento, c: ArchivoVersion) => void; onClose: () => void
}) {
  const [eventos, setEventos] = useState<EventoDocumento[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(() => api.cargarEventosDocumento(datos, venta.id).then(setEventos).catch((e: Error) => setError(e.message)), [datos, venta.id])
  useEffect(() => { void cargar() }, [cargar])
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader><DialogTitle>Historial de documentos · {venta.codigo}</DialogTitle><DialogDescription>Cada versión se conserva con la plantilla que se usó, quién la generó y cómo avanzó.</DialogDescription></DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label="Versiones del documento">
            <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left font-medium">Versión</th><th className="text-left font-medium">Plantilla</th><th className="text-left font-medium">Estado</th><th className="text-left font-medium">Generada</th><th className="text-left font-medium">Firma</th><th /></tr></thead>
            <tbody>
              {versiones.map((v) => (
                <tr key={v.id} className="border-t border-border align-top">
                  <td className="py-2 font-semibold">{v.numero}</td>
                  <td>{v.plantillaNombre} v{v.plantillaVersion}</td>
                  <td><EstadoDoc e={v.estado} />{v.anuladoMotivo && <div className="mt-1 max-w-48 text-xs text-muted-foreground">{v.anuladoMotivo}</div>}</td>
                  <td>{v.generadoNombre}<div className="text-xs text-muted-foreground">{fecha(v.generadoEn)}</div></td>
                  <td>{v.firmadoNombre ? <>{v.firmadoNombre}<div className="text-xs text-muted-foreground">Firmado el {dia(v.firmadoFecha)} · cargó {v.firmadoCargadoNombre}{v.firmaValidadaEn ? ` · validó ${v.firmaValidadaNombre}` : ' · sin validar'}</div></> : '—'}</td>
                  <td><div className="flex justify-end gap-1"><Button size="xs" variant="ghost" aria-label={`Abrir versión ${v.numero}`} onClick={() => onVer(v)}>Abrir</Button><Button size="xs" variant="ghost" aria-label={`PDF versión ${v.numero}`} onClick={() => onBajar(v, 'pdf')}>PDF</Button>{v.docxRuta && <Button size="xs" variant="ghost" aria-label={`Word versión ${v.numero}`} onClick={() => onBajar(v, 'docx')}>Word</Button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section aria-label="Eventos del documento" className="grid gap-1">
          <h3 className="text-xs font-semibold">Eventos</h3>
          <FieldError>{error}</FieldError>
          {eventos === null ? <p className="text-xs text-muted-foreground">Cargando…</p> : (
            <ul className="divide-y divide-border text-xs">{eventos.map((e) => (
              <li key={e.id} className="grid gap-0.5 py-1.5 sm:grid-cols-[12rem_1fr_9rem]"><span className="font-medium">{e.accion}</span><span className="text-muted-foreground">{e.motivo}</span><span className="text-muted-foreground sm:text-right">{e.usuario} · {fecha(e.fecha)}</span></li>
            ))}</ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
