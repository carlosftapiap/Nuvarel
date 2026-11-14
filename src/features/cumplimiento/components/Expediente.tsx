import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { fechaGuayaquil, fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import {
  cargarCatalogo, cargarDocumento, cargarRequisitos, etiquetaCatalogo, cargarRevisiones, descargarDocumentos, enviarACumplimiento, ESTADO_DOCUMENTO, ESTADO_REVISION, resolverCumplimiento, revisarDocumento,
  type EstadoRevision, type Requisito, type Revision,
} from '../expediente'

type Ejecutar = (fn: () => Promise<unknown>, ok: string) => Promise<unknown>

function Pastilla({ texto, tono }: { texto: string; tono: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tono)}>{texto}</span>
}

/** Lista de documentos obligatorios con sus acciones según el permiso. La usan la venta y la ficha del cliente. */
export function ListaRequisitos({ requisitos, datos, almacen, ejecutar, onCambio }: { requisitos: Requisito[]; datos: Datos; almacen: AlmacenContratos | null; ejecutar: Ejecutar; onCambio: () => Promise<void> | void }) {
  const { can, actor } = useSession()
  const [cargar, setCargar] = useState<Requisito | null>(null)
  const [revisar, setRevisar] = useState<Requisito | null>(null)
  const [error, setError] = useState<string | null>(null)
  const puedeCargar = can('clientes.editar') || can('ventas.datos_comprador')
  const puedeVer = (r: Requisito) => !!r.documento && (can('cumplimiento.ver') || r.cargadoPor === actor.id)
  const descargar = async (ids: string[]) => {
    setError(null)
    try { await descargarDocumentos(datos, almacen, ids) } catch (e) { setError((e as Error).message) }
  }
  // Un error del servidor se muestra aquí; la lista se relee igual.
  const intentar = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) }
    await onCambio()
  }
  const personas = [...new Map(requisitos.map((r) => [`${r.persona.clientId ?? ''}${r.persona.buyerId ?? ''}`, r])).values()]

  return (
    <div className="grid gap-3">
      {personas.map((p) => {
        const propios = requisitos.filter((r) => r.persona.clientId === p.persona.clientId && r.persona.buyerId === p.persona.buyerId)
        return (
          <div key={`${p.persona.clientId}${p.persona.buyerId}`} className="overflow-x-auto rounded-lg border border-border">
            <div className="flex items-center justify-between gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <span><b className="text-foreground">{p.nombrePersona}</b> · persona {p.tipoPersona === 'natural' ? 'natural' : 'jurídica'}</span>
              {can('cumplimiento.ver') && propios.some((r) => r.documento) && (
                <Button size="sm" variant="ghost" onClick={() => void descargar(propios.filter((r) => r.documento).map((r) => r.documento!))}><Download />Descargar todo</Button>
              )}
            </div>
            <table className="w-full text-xs">
              <tbody>
                {propios.map((r) => (
                  <tr key={r.tipo} className="border-t border-border align-top">
                    <td className="px-3 py-1.5">{r.nombre}{r.archivoNombre && <div className="text-xs text-muted-foreground">{r.archivoNombre}{r.cargadoEn ? ` · ${fmtFechaCorta(fechaGuayaquil(r.cargadoEn))}` : ''}{r.vigenciaHasta ? ` · vigente hasta ${fmtFechaCorta(r.vigenciaHasta)}` : ''}</div>}
                      {r.observacion && <div className="text-xs text-amber-800">{r.observacion}</div>}</td>
                    <td className="px-2 py-1.5"><Pastilla texto={ESTADO_DOCUMENTO[r.estado].label} tono={ESTADO_DOCUMENTO[r.estado].tono} /></td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {puedeVer(r) && <Button size="sm" variant="ghost" aria-label={`Descargar ${r.nombre}`} onClick={() => void descargar([r.documento!])}><Download /></Button>}
                      {puedeCargar && <Button size="sm" variant="ghost" onClick={() => setCargar(r)}><Upload />{r.documento ? 'Reemplazar' : 'Cargar'}</Button>}
                      {can('cumplimiento.revisar') && r.documento && r.estado !== 'aprobado' && <Button size="sm" variant="outline" onClick={() => setRevisar(r)}>Revisar</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
      <FieldError>{error}</FieldError>
      {cargar && <CargarDocumento r={cargar} onClose={() => setCargar(null)}
        guardar={(archivo, vigencia) => intentar(() => ejecutar(() => cargarDocumento(datos, almacen, cargar.persona, cargar.tipo, archivo, vigencia), `${cargar.nombre}: documento cargado`))} />}
      {revisar && <RevisarDocumento r={revisar} onClose={() => setRevisar(null)}
        guardar={(estado, obs) => intentar(() => ejecutar(() => revisarDocumento(datos, revisar.documento!, estado, obs), `${revisar.nombre}: ${estado}`))} />}
    </div>
  )
}

/** Sección Cumplimiento del expediente de la venta: documentos, envío, resolución e historial. */
export default function ExpedienteCumplimiento({ contrato, borrador, datos, almacen, ejecutar, onEstado }: {
  contrato: string; borrador: boolean; datos: Datos; almacen: AlmacenContratos | null; ejecutar: Ejecutar; onEstado: (e: EstadoRevision | 'sin_enviar') => void
}) {
  const { can, actor } = useSession()
  const [requisitos, setRequisitos] = useState<Requisito[] | null | undefined>(undefined)
  const [revisiones, setRevisiones] = useState<Revision[]>([])
  const [dialogo, setDialogo] = useState<'enviar' | 'resolver' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<string | null>(null)
  const recargar = useCallback(async () => {
    const [r, h, c] = await Promise.all([cargarRequisitos(datos, contrato), cargarRevisiones(datos, contrato), cargarCatalogo(datos)])
    setRequisitos(r); setRevisiones(h); setCatalogo(etiquetaCatalogo(c))
    onEstado(h.at(-1)?.estado ?? 'sin_enviar')
  }, [datos, contrato, onEstado])
  useEffect(() => { void recargar() }, [recargar])

  if (requisitos === undefined) return <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline size-3 animate-spin" />Cargando expediente…</p>
  if (requisitos === null) return <p className="text-xs text-muted-foreground">El expediente de Cumplimiento todavía no está disponible en esta base.</p>
  const ultima = revisiones.at(-1) ?? null
  const estado = ultima?.estado ?? 'sin_enviar'
  const incompletos = requisitos.filter((r) => ['falta', 'rechazado', 'vencido'].includes(r.estado)).length
  const sinAprobar = requisitos.filter((r) => r.estado !== 'aprobado').length
  const hacer = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null)
    try { await ejecutar(fn, ok) } catch (e) { setError((e as Error).message) }
    await recargar()
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pastilla texto={ESTADO_REVISION[estado].label} tono={ESTADO_REVISION[estado].tono} />
        {incompletos > 0 && <span className="text-xs text-muted-foreground">{incompletos} documento(s) obligatorio(s) por cargar</span>}
        <span className="ml-auto flex gap-1.5">
          {borrador && can('ventas.preparar') && estado !== 'pendiente' && estado !== 'aprobado' && (
            <Button size="sm" disabled={incompletos > 0} title={incompletos > 0 ? 'Carga todos los documentos obligatorios' : undefined} onClick={() => setDialogo('enviar')}>Enviar a Cumplimiento</Button>
          )}
          {can('cumplimiento.revisar') && estado === 'pendiente' && (
            ultima?.registradoPor === actor.id
              ? <span className="text-xs text-muted-foreground">Lo resuelve otra persona</span>
              : <Button size="sm" onClick={() => setDialogo('resolver')}>Resolver revisión</Button>
          )}
        </span>
      </div>
      {catalogo && <p className="text-xs text-muted-foreground">{catalogo}</p>}
      <FieldError>{error}</FieldError>
      <ListaRequisitos requisitos={requisitos} datos={datos} almacen={almacen} ejecutar={ejecutar} onCambio={recargar} />
      {revisiones.length > 0 && (
        <ol className="grid gap-1 text-xs">
          {revisiones.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-1.5 text-muted-foreground">
              <span className="tabular-nums">{new Date(r.registradoEn).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</span>
              <b className="text-foreground">{ESTADO_REVISION[r.estado].label}</b>
              <span>· {r.registradoNombre}</span>
              {r.observaciones && <span>· {r.observaciones}</span>}
            </li>
          ))}
        </ol>
      )}
      {dialogo === 'enviar' && (
        <Motivo titulo="Enviar a Cumplimiento" descripcion="El Oficial de Cumplimiento revisará el expediente. Hasta que lo apruebe, el contrato no se puede firmar." etiqueta="Nota (opcional)" obligatorio={false} boton="Enviar"
          onClose={() => setDialogo(null)} guardar={(nota) => hacer(() => enviarACumplimiento(datos, contrato, nota), 'Expediente enviado a Cumplimiento')} />
      )}
      {dialogo === 'resolver' && <Resolver sinAprobar={sinAprobar} onClose={() => setDialogo(null)} guardar={(e, obs) => hacer(() => resolverCumplimiento(datos, contrato, e, obs), `Revisión de Cumplimiento: ${ESTADO_REVISION[e].label.toLowerCase()}`)} />}
    </div>
  )
}

function CargarDocumento({ r, onClose, guardar }: { r: Requisito; onClose: () => void; guardar: (archivo: File | null, vigencia: string | null) => Promise<void> }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [vigencia, setVigencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{r.documento ? 'Reemplazar' : 'Cargar'} {r.nombre}</DialogTitle>
          <DialogDescription>{r.nombrePersona}. {r.documento ? 'La versión anterior se conserva como reemplazada.' : 'Lo revisará el Oficial de Cumplimiento.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ex-doc" className="text-xs">Documento * (PDF, JPG o PNG; máximo 10 MB)</Label>
            <Input id="ex-doc" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-vig" className="text-xs">Vigente hasta (si aplica)</Label>
            <Input id="ex-vig" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={!archivo || enviando} onClick={async () => { setEnviando(true); await guardar(archivo, vigencia || null); setEnviando(false); onClose() }}>{enviando && <Loader2 className="animate-spin" />}Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RESOLUCIONES = [['aprobado', 'Aprobar'], ['observado', 'Observar'], ['rechazado', 'Rechazar']] as const

function RevisarDocumento({ r, onClose, guardar }: { r: Requisito; onClose: () => void; guardar: (estado: 'observado' | 'aprobado' | 'rechazado', obs: string) => Promise<void> }) {
  const [estado, setEstado] = useState<'observado' | 'aprobado' | 'rechazado'>('aprobado')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const listo = (estado === 'aprobado' || obs.trim().length >= 5) && !enviando
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Revisar {r.nombre}</DialogTitle>
          <DialogDescription>{r.nombrePersona}. Observar o rechazar exige un comentario.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Resultado">
            {RESOLUCIONES.map(([v, t]) => <Button key={v} size="sm" role="radio" aria-checked={estado === v} variant={estado === v ? 'default' : 'outline'} onClick={() => setEstado(v)}>{t}</Button>)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-obs" className="text-xs">Observación{estado === 'aprobado' ? ' (opcional)' : ' *'}</Label>
            <Textarea id="ex-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} onClick={async () => { setEnviando(true); await guardar(estado, obs.trim()); setEnviando(false); onClose() }}>{enviando && <Loader2 className="animate-spin" />}Guardar revisión</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Resolver({ sinAprobar, onClose, guardar }: { sinAprobar: number; onClose: () => void; guardar: (estado: 'observado' | 'aprobado' | 'rechazado', obs: string) => Promise<void> }) {
  const [estado, setEstado] = useState<'observado' | 'aprobado' | 'rechazado'>(sinAprobar ? 'observado' : 'aprobado')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const bloqueado = estado === 'aprobado' && sinAprobar > 0
  const listo = !bloqueado && (estado === 'aprobado' || obs.trim().length >= 5) && !enviando
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolver revisión de Cumplimiento</DialogTitle>
          <DialogDescription>Solo con la aprobación el contrato se puede marcar como firmado.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Resultado">
            {RESOLUCIONES.map(([v, t]) => <Button key={v} size="sm" role="radio" aria-checked={estado === v} variant={estado === v ? 'default' : 'outline'} onClick={() => setEstado(v)}>{t}</Button>)}
          </div>
          {bloqueado && <FieldError>{`Hay ${sinAprobar} documento(s) obligatorio(s) sin aprobar.`}</FieldError>}
          <div className="grid gap-1.5">
            <Label htmlFor="cu-obs" className="text-xs">Observaciones{estado === 'aprobado' ? ' (opcional)' : ' *'}</Label>
            <Textarea id="cu-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} onClick={async () => { setEnviando(true); await guardar(estado, obs.trim()); setEnviando(false); onClose() }}>{enviando && <Loader2 className="animate-spin" />}Guardar resolución</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Motivo({ titulo, descripcion, etiqueta, obligatorio, boton, onClose, guardar }: { titulo: string; descripcion: string; etiqueta: string; obligatorio: boolean; boton: string; onClose: () => void; guardar: (texto: string) => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="cu-nota" className="text-xs">{etiqueta}</Label>
          <Textarea id="cu-nota" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={(obligatorio && texto.trim().length < 5) || enviando} onClick={async () => { setEnviando(true); await guardar(texto.trim()); setEnviando(false); onClose() }}>{enviando && <Loader2 className="animate-spin" />}{boton}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
