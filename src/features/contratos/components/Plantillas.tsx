import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Eye, FilePlus2, FileUp, History, Pencil } from 'lucide-react'
import type { Permiso } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import type { AlmacenContratos } from '../almacen'
import { descargarBlob, prepararDocumento, type Preparado } from '../generar'
import { sha256 } from '../hash'
import {
  BUCKET_PLANTILLAS, ESTADO_PLANTILLA, MIME_DOCX, TIPOS_DOCUMENTO_CONTRACTUAL, TIPOS_OPERACION, type CampoCatalogo, type EntidadVendedora, type EventoPlantilla, type Plantilla,
} from '../model'
import * as api from '../remoto'
import PlantillaDialog, { type ModoPlantilla } from './PlantillaDialog'
import { VistaPrevia } from './VistaPrevia'

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : '—')
export const EtiquetaPlantilla = ({ e }: { e: Plantilla['estado'] }) => <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ESTADO_PLANTILLA[e].tono)}>{ESTADO_PLANTILLA[e].label}</span>

type Accion =
  | { tipo: 'crear'; modo: ModoPlantilla } | { tipo: 'vista'; plantilla: Plantilla } | { tipo: 'historial'; plantilla: Plantilla }
  | { tipo: 'motivo'; accion: 'aprobar' | 'retirar'; plantilla: Plantilla }

/** Plantillas y formatos: modelos en Word o texto que aprueba Legal, y los datos de la entidad vendedora. Todo vive en Supabase. */
export default function Plantillas({ datos, almacen, can, ventas }: { datos: Datos; almacen: AlmacenContratos; can: (p: Permiso) => boolean; ventas: { id: string; codigo: string; cliente: string | null }[] }) {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null)
  const [campos, setCampos] = useState<CampoCatalogo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion | null>(null)
  const administra = can('ventas.plantillas')
  const aprueba = can('ventas.plantillas_aprobar')

  const recargar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api.cargarPlantillas(datos), api.cargarCampos(datos)])
      setPlantillas(p); setCampos(c); setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useRefresco(recargar)

  const familias = useMemo(() => {
    const m = new Map<string, Plantilla[]>()
    for (const p of plantillas ?? []) m.set(p.familiaId, [...(m.get(p.familiaId) ?? []), p])
    return [...m.values()].map((v) => v.sort((a, b) => b.version - a.version)).sort((a, b) => b[0].creadaEn.localeCompare(a[0].creadaEn))
  }, [plantillas])

  async function bajarModelo(p: Plantilla) {
    setError(null)
    try {
      if (!p.archivoRuta) throw new Error('Esta plantilla es de texto: no tiene archivo Word.')
      const bytes = new Uint8Array(await almacen.descargar(BUCKET_PLANTILLAS, p.archivoRuta))
      if (p.archivoHash && (await sha256(bytes)) !== p.archivoHash) throw new Error('El modelo no coincide con su huella de integridad registrada.')
      descargarBlob(new Blob([bytes], { type: MIME_DOCX }), p.archivoNombre ?? `${p.nombre}.docx`)
    } catch (e) { setError((e as Error).message) }
  }

  const puedePrevisualizar = administra || can('ventas.documentos_generar')

  return (
    <div className="grid gap-5">
      <Entidad datos={datos} puedeEditar={administra} onGuardado={() => setAviso('Datos de la entidad vendedora guardados.')} />

      <section className="dashboard-card" aria-labelledby="pl-titulo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="pl-titulo" className="text-sm font-semibold">Plantillas contractuales</h2>
            <p className="text-xs text-muted-foreground">Solo una plantilla aprobada puede usarse para emitir documentos. Una versión aprobada no se edita: se crea otra y la anterior queda retirada, conservada.</p>
          </div>
          {administra && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAccion({ tipo: 'crear', modo: { tipo: 'nueva', formato: 'docx' } })}><FileUp />Subir Word</Button>
              <Button size="sm" variant="outline" onClick={() => setAccion({ tipo: 'crear', modo: { tipo: 'nueva', formato: 'texto' } })}><FilePlus2 />Crear plantilla de texto</Button>
            </div>
          )}
        </div>
        <div className="mt-3 grid gap-2"><FieldError>{error}</FieldError>{aviso && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{aviso}</p>}</div>

        {plantillas === null ? <p className="p-4 text-sm text-muted-foreground">Cargando plantillas…</p> : familias.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-8 text-center">
            <h3 className="text-sm font-semibold">Todavía no hay plantillas</h3>
            <p className="mx-auto mt-2 max-w-lg text-xs text-muted-foreground">Legal debe subir los modelos de contrato en Word y aprobarlos. Hasta entonces el sistema no emite documentos legales: puedes completar los datos de compradores y de la entidad vendedora.</p>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3">
            {familias.map((vs) => {
              const ultima = vs[0]
              const vigente = vs.find((v) => v.estado === 'aprobada')
              const borrador = vs.find((v) => v.estado === 'borrador')
              return (
                <li key={ultima.familiaId} className="rounded-xl border border-border p-4" aria-label={`Plantilla ${ultima.nombre}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold">{ultima.nombre}</h3>
                      <p className="text-xs text-muted-foreground">{TIPOS_DOCUMENTO_CONTRACTUAL[ultima.tipoDocumento]} · {TIPOS_OPERACION[ultima.tipoOperacion]} · {ultima.formato === 'docx' ? 'Modelo en Word' : 'Texto'}</p>
                    </div>
                    <p className="text-xs">{vigente ? <>En uso: <b>v{vigente.version}</b> <EtiquetaPlantilla e="aprobada" /></> : <span className="text-amber-800">Sin versión aprobada: no se pueden emitir documentos con ella</span>}</p>
                  </div>
                  <table className="mt-2 w-full text-xs" aria-label={`Versiones de ${ultima.nombre}`}>
                    <tbody>
                      {vs.map((p) => (
                        <tr key={p.id} className="border-t border-border align-top">
                          <td className="py-2 pr-2 font-semibold">v{p.version}</td>
                          <td className="pr-2"><EtiquetaPlantilla e={p.estado} />
                            <div className="mt-1 text-xs text-muted-foreground">Creada por {p.creadaNombre} · {fecha(p.creadaEn)}
                              {p.aprobadaNombre && <> · aprobada por {p.aprobadaNombre} · {fecha(p.aprobadaEn)}</>}
                              {p.retiradaMotivo && <> · retirada: {p.retiradaMotivo}</>}</div></td>
                          <td className="py-1"><div className="flex flex-wrap justify-end gap-1">
                            {puedePrevisualizar && <Button size="xs" variant="ghost" aria-label={`Vista previa de ${p.nombre} v${p.version}`} onClick={() => setAccion({ tipo: 'vista', plantilla: p })}><Eye />Vista previa</Button>}
                            {p.formato === 'docx' && <Button size="xs" variant="ghost" aria-label={`Descargar modelo de ${p.nombre} v${p.version}`} onClick={() => void bajarModelo(p)}><Download />Modelo</Button>}
                            {p.estado === 'borrador' && administra && <Button size="xs" variant="ghost" aria-label={`Editar ${p.nombre} v${p.version}`} onClick={() => setAccion({ tipo: 'crear', modo: { tipo: 'editar', plantilla: p } })}><Pencil />Editar</Button>}
                            {p.estado === 'borrador' && aprueba && <Button size="xs" aria-label={`Aprobar ${p.nombre} v${p.version}`} onClick={() => setAccion({ tipo: 'motivo', accion: 'aprobar', plantilla: p })}>Aprobar</Button>}
                            {p.estado === 'aprobada' && aprueba && <Button size="xs" variant="outline" className="text-rose-700" aria-label={`Retirar ${p.nombre} v${p.version}`} onClick={() => setAccion({ tipo: 'motivo', accion: 'retirar', plantilla: p })}>Retirar</Button>}
                            <Button size="xs" variant="ghost" aria-label={`Historial de ${p.nombre} v${p.version}`} onClick={() => setAccion({ tipo: 'historial', plantilla: p })}><History />Historial</Button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {administra && !borrador && ultima.estado !== 'borrador' && (
                    <div className="mt-2"><Button size="xs" variant="outline" onClick={() => setAccion({ tipo: 'crear', modo: { tipo: 'version', base: ultima } })}><FilePlus2 />Nueva versión</Button></div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {accion?.tipo === 'crear' && <PlantillaDialog datos={datos} almacen={almacen} campos={campos} modo={accion.modo} onCambio={async () => { await recargar(); setAviso('Plantilla guardada como borrador en Supabase.') }} onClose={() => setAccion(null)} />}
      {accion?.tipo === 'vista' && <VistaPreviaPlantilla datos={datos} almacen={almacen} plantilla={accion.plantilla} ventas={ventas} onClose={() => setAccion(null)} />}
      {accion?.tipo === 'historial' && <HistorialPlantilla datos={datos} plantilla={accion.plantilla} onClose={() => setAccion(null)} />}
      {accion?.tipo === 'motivo' && (
        <MotivoPlantilla titulo={accion.accion === 'aprobar' ? `Aprobar ${accion.plantilla.nombre} v${accion.plantilla.version}` : `Retirar ${accion.plantilla.nombre} v${accion.plantilla.version}`}
          descripcion={accion.accion === 'aprobar' ? 'Queda aprobada y ya no se podrá editar. Si había otra versión aprobada, pasa a retirada y se conserva.' : 'Deja de poder usarse para nuevas emisiones. Los documentos ya generados no cambian.'}
          accion={accion.accion === 'aprobar' ? 'Aprobar plantilla' : 'Retirar plantilla'} peligro={accion.accion === 'retirar'} onClose={() => setAccion(null)}
          onConfirm={async (motivo) => {
            if (accion.accion === 'aprobar') await api.aprobarPlantilla(datos, accion.plantilla.id, motivo); else await api.retirarPlantilla(datos, accion.plantilla.id, motivo)
            await recargar()
            setAviso(accion.accion === 'aprobar' ? 'Plantilla aprobada: ya puede usarse para emitir documentos.' : 'Plantilla retirada.')
          }} />
      )}
    </div>
  )
}

/* ----------------------------------------------------------- entidad vendedora */

const VACIA: Omit<EntidadVendedora, 'actualizadoNombre' | 'actualizadoEn'> = { razonSocial: '', ruc: '', domicilio: '', representanteNombre: '', representanteCargo: '', representanteDocumento: '', email: '', telefono: '' }

function Entidad({ datos, puedeEditar, onGuardado }: { datos: Datos; puedeEditar: boolean; onGuardado: () => void }) {
  const [e, setE] = useState(VACIA)
  const [meta, setMeta] = useState<{ nombre: string | null; en: string | null }>({ nombre: null, en: null })
  const [cargada, setCargada] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const cargar = useCallback(async () => {
    try { const x = await api.cargarEntidad(datos); if (x) { const { actualizadoNombre, actualizadoEn, ...resto } = x; setE(resto); setMeta({ nombre: actualizadoNombre, en: actualizadoEn }) } setCargada(true) } catch (err) { setError((err as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])
  const incompleta = !e.razonSocial || !e.ruc || !e.domicilio || !e.representanteNombre || !e.representanteCargo
  const campo = (k: keyof typeof VACIA, etiqueta: string, id: string, ancho = '') => (
    <div className={cn('grid gap-1', ancho)}><Label htmlFor={id} className="text-xs">{etiqueta}</Label><Input id={id} value={e[k]} disabled={!puedeEditar} onChange={(ev) => setE({ ...e, [k]: ev.target.value })} /></div>
  )
  async function guardar() {
    setError(null); setOcupado(true)
    try { await api.guardarEntidad(datos, e, motivo.trim()); setMotivo(''); await cargar(); onGuardado() } catch (err) { setError((err as Error).message) } finally { setOcupado(false) }
  }
  return (
    <section className="dashboard-card" aria-labelledby="ent-titulo">
      <h2 id="ent-titulo" className="text-sm font-semibold">Entidad vendedora</h2>
      <p className="text-xs text-muted-foreground">Parte vendedora que firma los contratos. No se asume: la define Legal. {meta.nombre && <>Última actualización: {meta.nombre}, {fecha(meta.en)}.</>}</p>
      {cargada && incompleta && <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">Faltan datos de la entidad vendedora (razón social, RUC, domicilio y representante legal). Los documentos que los usen no podrán emitirse.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {campo('razonSocial', 'Razón social', 'ent-razon', 'sm:col-span-2')}{campo('ruc', 'RUC (13 dígitos)', 'ent-ruc')}
        {campo('domicilio', 'Domicilio', 'ent-dom', 'sm:col-span-3')}
        {campo('representanteNombre', 'Representante legal', 'ent-rep', 'sm:col-span-2')}{campo('representanteCargo', 'Cargo', 'ent-cargo')}
        {campo('representanteDocumento', 'Documento del representante', 'ent-repdoc')}{campo('email', 'Correo', 'ent-mail')}{campo('telefono', 'Teléfono', 'ent-tel')}
      </div>
      {puedeEditar && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid min-w-64 flex-1 gap-1"><Label htmlFor="ent-motivo" className="text-xs">Motivo del cambio *</Label><Input id="ent-motivo" value={motivo} onChange={(ev) => setMotivo(ev.target.value)} /></div>
          <Button size="sm" disabled={ocupado || motivo.trim().length < 5} onClick={() => void guardar()}>Guardar entidad vendedora</Button>
        </div>
      )}
      <div className="mt-2"><FieldError>{error}</FieldError></div>
    </section>
  )
}

/* ------------------------------------------------------------------ diálogos */

function MotivoPlantilla({ titulo, descripcion, accion, peligro, onClose, onConfirm }: { titulo: string; descripcion: string; accion: string; peligro?: boolean; onClose: () => void; onConfirm: (m: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  async function ir() { setError(null); setOcupado(true); try { await onConfirm(motivo.trim()); onClose() } catch (e) { setError((e as Error).message) } finally { setOcupado(false) } }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>{descripcion}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="mp-motivo" className="text-xs">Motivo *</Label><Input id="mp-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <FieldError>{error}</FieldError>
        <DialogFooter><Button variant="outline" onClick={onClose}>Volver</Button><Button variant={peligro ? 'destructive' : 'default'} disabled={ocupado || motivo.trim().length < 5} onClick={() => void ir()}>{ocupado ? 'Guardando…' : accion}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HistorialPlantilla({ datos, plantilla, onClose }: { datos: Datos; plantilla: Plantilla; onClose: () => void }) {
  const [eventos, setEventos] = useState<EventoPlantilla[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api.cargarEventosPlantilla(datos, plantilla.id).then(setEventos).catch((e: Error) => setError(e.message)) }, [datos, plantilla.id])
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Historial · {plantilla.nombre} v{plantilla.version}</DialogTitle><DialogDescription>Quién hizo cada cambio, cuándo y por qué.</DialogDescription></DialogHeader>
        <FieldError>{error}</FieldError>
        {eventos === null ? <p className="text-xs text-muted-foreground">Cargando…</p> : (
          <ul className="divide-y divide-border text-xs">{eventos.map((e) => <li key={e.id} className="grid gap-0.5 py-2"><span className="font-medium">{e.accion}</span><span className="text-muted-foreground">{e.motivo}</span><span className="text-muted-foreground">{e.usuario} · {fecha(e.fecha)}</span></li>)}</ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Vista previa de una plantilla (aprobada o en borrador) con los datos reales de un contrato. Nunca se guarda ni tiene validez. */
function VistaPreviaPlantilla({ datos, almacen, plantilla, ventas, onClose }: { datos: Datos; almacen: AlmacenContratos; plantilla: Plantilla; ventas: { id: string; codigo: string; cliente: string | null }[]; onClose: () => void }) {
  const [contrato, setContrato] = useState(ventas[0]?.id ?? '')
  const [manuales, setManuales] = useState<Record<string, string>>({})
  const [p, setP] = useState<Preparado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const manualesVars = plantilla.variables.filter((v) => v.origen === 'manual')
  async function generar() {
    setError(null); setOcupado(true); setP(null)
    try { setP(await prepararDocumento(datos, almacen, plantilla, contrato, manuales, { numero: 1, permitirFaltantes: true, marca: 'VISTA PREVIA · SIN VALIDEZ LEGAL' })) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Vista previa · {plantilla.nombre} v{plantilla.version}</DialogTitle>
          <DialogDescription>Se llena con los datos reales del contrato que elijas. No se guarda ni tiene validez legal.{plantilla.estado !== 'aprobada' ? ' Esta versión no está aprobada.' : ''}</DialogDescription>
        </DialogHeader>
        {ventas.length === 0 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">No hay contratos a tu alcance para probar la plantilla.</p> : (
          <div className="grid gap-3 text-xs">
            <div className="grid gap-1.5"><Label htmlFor="vp-contrato" className="text-xs">Contrato de prueba</Label>
              <select id="vp-contrato" className="h-9 rounded-md border border-border bg-white px-2 text-xs" value={contrato} onChange={(e) => { setContrato(e.target.value); setP(null) }}>{ventas.map((v) => <option key={v.id} value={v.id}>{v.codigo}{v.cliente ? ` · ${v.cliente}` : ''}</option>)}</select></div>
            {manualesVars.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{manualesVars.map((v) => <div key={v.clave} className="grid gap-1"><Label htmlFor={`vpm-${v.clave}`} className="text-xs">{v.etiqueta}</Label><Input id={`vpm-${v.clave}`} value={manuales[v.clave] ?? ''} onChange={(e) => setManuales({ ...manuales, [v.clave]: e.target.value })} /></div>)}</div>}
            <div><Button size="sm" disabled={!contrato || ocupado} onClick={() => void generar()}>{ocupado ? 'Generando…' : 'Generar vista previa'}</Button></div>
            {p && p.faltantes.length > 0 && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">Con este contrato faltarían: {p.faltantes.map((f) => f.etiqueta).join(', ')}.</p>}
            {p?.bloques && <VistaPrevia bloques={p.bloques} marca="Vista previa · sin validez legal" pdf={p.pdf} avisos={p.avisos} />}
          </div>
        )}
        <FieldError>{error}</FieldError>
      </DialogContent>
    </Dialog>
  )
}
