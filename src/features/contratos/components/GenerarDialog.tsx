import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import type { AlmacenContratos } from '../almacen'
import { generarDocumento, prepararDocumento, type Preparado } from '../generar'
import { TIPOS_DOCUMENTO_CONTRACTUAL, TIPOS_OPERACION, type Plantilla, type VersionDocumento } from '../model'
import * as api from '../remoto'
import { VistaPrevia } from './VistaPrevia'

const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'
const DONDE: Record<string, string> = {
  comprador: 'Completa los datos del comprador en «Compradores y apoderados».',
  compradores: 'Completa los datos de cada comprador en «Compradores y apoderados».',
  apoderados: 'Agrega al apoderado en «Compradores y apoderados».',
  compradores_adicionales: 'Agrega al comprador adicional en «Compradores y apoderados».',
  vendedora: 'Legal los configura en Plantillas y formatos → Entidad vendedora.',
  manual: 'Escríbelo abajo.',
  unidad: 'Viene de Inventario: no se corrige desde aquí.',
  precio: 'Viene del contrato: no se corrige desde aquí.',
  pago: 'Viene del cronograma del contrato: no se corrige desde aquí.',
  contrato: 'Viene del contrato: no se corrige desde aquí.',
}

/** Genera un documento desde una plantilla aprobada, con los datos reales del contrato. Muestra exactamente qué falta antes de permitir generarlo. */
export default function GenerarDialog({ datos, almacen, contratoId, codigo, versiones, onCompradores, onCambio, onClose }: {
  datos: Datos; almacen: AlmacenContratos; contratoId: string; codigo: string; versiones: VersionDocumento[]
  onCompradores: () => void; onCambio: () => Promise<void>; onClose: () => void
}) {
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null)
  const [plantillaId, setPlantillaId] = useState('')
  const [manuales, setManuales] = useState<Record<string, string>>({})
  const [preparado, setPreparado] = useState<Preparado | null>(null)
  const [motivo, setMotivo] = useState('Documento generado desde Ventas y contratos')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    api.cargarPlantillas(datos).then((l) => { const ok = l.filter((p) => p.estado === 'aprobada'); setPlantillas(ok); setPlantillaId(ok[0]?.id ?? '') }).catch((e: Error) => { setError(e.message); setPlantillas([]) })
  }, [datos])
  const plantilla = useMemo(() => plantillas?.find((p) => p.id === plantillaId) ?? null, [plantillas, plantillaId])
  const variablesManuales = plantilla?.variables.filter((v) => v.origen === 'manual') ?? []
  const siguienteNumero = Math.max(0, ...versiones.filter((v) => v.tipoDocumento === plantilla?.tipoDocumento).map((v) => v.numero)) + 1

  async function verificar() {
    if (!plantilla) return
    setError(null); setOcupado(true); setPreparado(null)
    try { setPreparado(await prepararDocumento(datos, almacen, plantilla, contratoId, manuales, { numero: siguienteNumero })) } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }
  async function generar() {
    if (!plantilla || !preparado) return
    setError(null); setOcupado(true)
    try { await generarDocumento(datos, almacen, plantilla, contratoId, manuales, preparado, motivo.trim()); await onCambio(); onClose() } catch (e) { setError((e as Error).message) } finally { setOcupado(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generar documento · {codigo}</DialogTitle>
          <DialogDescription>Se toman los datos del contrato, del cliente, de la unidad y del cronograma de pagos. No se vuelven a digitar. Solo se usan plantillas aprobadas por Legal.</DialogDescription>
        </DialogHeader>

        {plantillas === null ? <p className="p-4 text-sm text-muted-foreground">Cargando plantillas…</p> : plantillas.length === 0 ? (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">No hay plantillas aprobadas. Legal debe cargar y aprobar un modelo en <b>Plantillas y formatos</b> antes de emitir documentos contractuales.</p>
        ) : (
          <div className="grid gap-3 text-xs">
            <div className="grid gap-1.5">
              <Label htmlFor="gen-plantilla" className="text-xs">Plantilla *</Label>
              <select id="gen-plantilla" className={campo} value={plantillaId} onChange={(e) => { setPlantillaId(e.target.value); setPreparado(null); setManuales({}) }}>
                {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre} · v{p.version} · {TIPOS_DOCUMENTO_CONTRACTUAL[p.tipoDocumento]} · {TIPOS_OPERACION[p.tipoOperacion]}</option>)}
              </select>
            </div>
            {variablesManuales.length > 0 && (
              <fieldset className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
                <legend className="px-1 text-xs font-semibold">Datos propios de este documento</legend>
                {variablesManuales.map((v) => (
                  <div key={v.clave} className="grid gap-1"><Label htmlFor={`man-${v.clave}`} className="text-[11px]">{v.etiqueta}{v.obligatorio ? ' *' : ''}</Label>
                    <Input id={`man-${v.clave}`} value={manuales[v.clave] ?? ''} onChange={(e) => { setManuales({ ...manuales, [v.clave]: e.target.value }); setPreparado(null) }} /></div>
                ))}
              </fieldset>
            )}
            <div><Button size="sm" disabled={ocupado || !plantilla} onClick={() => void verificar()}>{ocupado && !preparado ? 'Verificando…' : 'Verificar datos y previsualizar'}</Button></div>

            {preparado && preparado.faltantes.length > 0 && (
              <div role="alert" className="grid gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                <p className="font-semibold">Faltan {preparado.faltantes.length} dato(s) obligatorio(s). No se puede generar hasta completarlos:</p>
                <ul className="list-disc pl-5">{preparado.faltantes.map((f) => <li key={f.clave}><b>{f.etiqueta}</b> — {DONDE[f.donde] ?? 'Revisa el dato.'}</li>)}</ul>
                {preparado.faltantes.some((f) => ['comprador', 'compradores', 'apoderados', 'compradores_adicionales'].includes(f.donde)) && <div><Button size="xs" variant="outline" onClick={onCompradores}>Abrir compradores y apoderados</Button></div>}
              </div>
            )}
            {preparado?.bloques && preparado.faltantes.length === 0 && (
              <>
                <p className="text-emerald-800">Datos completos. Esta es la vista previa; al generar se guardan el PDF y el Word en Supabase como la versión {siguienteNumero}.</p>
                <VistaPrevia bloques={preparado.bloques} pdf={preparado.pdf} avisos={preparado.avisos} />
                <div className="grid gap-1.5"><Label htmlFor="gen-motivo" className="text-xs">Motivo *</Label><Input id="gen-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
              </>
            )}
          </div>
        )}
        <FieldError>{error}</FieldError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button disabled={ocupado || !preparado?.bloques || preparado.faltantes.length > 0 || motivo.trim().length < 5} onClick={() => void generar()}>{ocupado && preparado ? 'Generando…' : 'Generar documento'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
