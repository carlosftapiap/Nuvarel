import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { nombreSeguro, TAMANO_MAXIMO, type AlmacenContratos } from '../almacen'
import { VARIABLES_FIRMAS } from '../docxTexto'
import { leer, sha256 } from '../hash'
import {
  BUCKET_PLANTILLAS, MIME_DOCX, TIPOS_DOCUMENTO_CONTRACTUAL, TIPOS_OPERACION, type CampoCatalogo, type FormatoPlantilla, type Plantilla, type TipoDocumentoContractual, type TipoOperacion, type VariablePlantilla,
} from '../model'
import { ErrorPlantilla, etiquetasDeTexto, extraerEtiquetas, variablesSugeridas } from '../plantilla'
import * as api from '../remoto'

const campo = 'h-9 rounded-md border border-border bg-white px-2 text-xs'

export type ModoPlantilla = { tipo: 'nueva'; formato: FormatoPlantilla } | { tipo: 'version'; base: Plantilla } | { tipo: 'editar'; plantilla: Plantilla }

const AYUDA = 'Escribe cada campo entre llaves, por ejemplo {comprador.nombre}. Una línea es un párrafo. «# Título» y «## Subtítulo» dan formato; [[SALTO]] cambia de página. Para repetir una lista: {#compradores} en una línea, su contenido debajo y {/compradores} en otra.'

/** Crea o edita una plantilla: sube el modelo Word de Legal o recibe su texto, detecta los campos y deja configurar cuáles son obligatorios. */
export default function PlantillaDialog({ datos, almacen, campos, modo, onCambio, onClose }: {
  datos: Datos; almacen: AlmacenContratos; campos: CampoCatalogo[]; modo: ModoPlantilla; onCambio: () => Promise<void>; onClose: () => void
}) {
  const base = modo.tipo === 'nueva' ? null : modo.tipo === 'version' ? modo.base : modo.plantilla
  const formato: FormatoPlantilla = modo.tipo === 'nueva' ? modo.formato : base!.formato
  const [nombre, setNombre] = useState(base?.nombre ?? '')
  const [tipoDoc, setTipoDoc] = useState<TipoDocumentoContractual>(base?.tipoDocumento ?? 'contrato_compraventa')
  const [tipoOp, setTipoOp] = useState<TipoOperacion>(base?.tipoOperacion ?? 'general')
  const [notas, setNotas] = useState(base?.notas ?? '')
  const [cuerpo, setCuerpo] = useState(base?.cuerpo ?? '')
  const [archivo, setArchivo] = useState<{ bytes: Uint8Array; nombre: string } | null>(null)
  const [variables, setVariables] = useState<VariablePlantilla[]>(base?.variables ?? [])
  const [motivo, setMotivo] = useState(modo.tipo === 'nueva' ? 'Modelo recibido de Legal' : modo.tipo === 'version' ? 'Nueva versión del modelo' : '')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const catalogo = useMemo(() => new Set(campos.map((c) => c.clave)), [campos])

  /** Combina los campos detectados con lo que la persona ya configuró. */
  const combinar = (detectadas: VariablePlantilla[], previas: VariablePlantilla[]) =>
    detectadas.map((d) => { const p = previas.find((x) => x.clave === d.clave); return p ? { ...d, obligatorio: p.obligatorio, etiqueta: p.origen === 'manual' ? p.etiqueta : d.etiqueta, origen: p.origen === 'catalogo' && catalogo.has(d.clave) ? 'catalogo' as const : d.origen } : d })

  // Plantilla de texto: los campos se detectan mientras se escribe.
  useEffect(() => {
    if (formato !== 'texto') return
    const et = etiquetasDeTexto(cuerpo)
    const detectadas = variablesSugeridas({ variables: [...new Set([...et.variables, ...VARIABLES_FIRMAS])], bucles: et.bucles }, campos)
    setVariables((prev) => combinar(detectadas, prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuerpo, formato, campos])

  async function elegir(f: File | undefined) {
    if (!f) return
    setError(null)
    if (!f.name.toLowerCase().endsWith('.docx')) { setError('El modelo debe ser un archivo de Word (.docx).'); return }
    if (f.size > TAMANO_MAXIMO) { setError('El archivo supera el máximo de 25 MB.'); return }
    try {
      const bytes = new Uint8Array(await leer(f))
      const detectadas = variablesSugeridas(extraerEtiquetas(bytes), campos)
      setArchivo({ bytes, nombre: f.name })
      setVariables((prev) => combinar(detectadas, prev))
      if (!nombre.trim()) setNombre(f.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' '))
    } catch (e) {
      setArchivo(null)
      setError(e instanceof ErrorPlantilla ? `${e.message}${e.detalles.length ? ` (${e.detalles.slice(0, 3).join('; ')})` : ''}` : (e as Error).message)
    }
  }

  const set = (clave: string, cambio: Partial<VariablePlantilla>) => setVariables((v) => v.map((x) => (x.clave === clave ? { ...x, ...cambio } : x)))
  const valido = nombre.trim().length >= 3 && motivo.trim().length >= 5 && (formato === 'texto' ? cuerpo.trim().length > 0 : !!archivo || !!base?.archivoRuta)

  async function guardar() {
    setError(null); setOcupado(true)
    try {
      let familia = base?.familiaId ?? ''
      if (modo.tipo === 'nueva') familia = globalThis.crypto.randomUUID()
      let archivoDatos: { archivo_ruta?: string | null; archivo_nombre?: string | null; archivo_hash?: string | null; archivo_tamano?: number | null } = {}
      if (formato === 'docx') {
        if (archivo) {
          const ruta = `${familia}/${globalThis.crypto.randomUUID()}-${nombreSeguro(archivo.nombre)}`
          await almacen.subir(BUCKET_PLANTILLAS, ruta, new Blob([new Uint8Array(archivo.bytes)], { type: MIME_DOCX }), MIME_DOCX)
          archivoDatos = { archivo_ruta: ruta, archivo_nombre: archivo.nombre, archivo_hash: await sha256(archivo.bytes), archivo_tamano: archivo.bytes.byteLength }
        } else if (base) {
          archivoDatos = { archivo_ruta: base.archivoRuta, archivo_nombre: base.archivoNombre, archivo_hash: base.archivoHash, archivo_tamano: base.archivoTamano }
        }
      }
      const datosPlantilla: api.DatosPlantilla = {
        nombre: nombre.trim(), tipo_documento: tipoDoc, tipo_operacion: tipoOp, formato, cuerpo: formato === 'texto' ? cuerpo : null, ...archivoDatos,
        variables: variables.map((v) => ({ ...v, etiqueta: v.etiqueta.trim() || v.clave })), notas: notas.trim(),
      }
      await api.guardarPlantilla(datos, modo.tipo === 'editar' ? modo.plantilla.id : null, modo.tipo === 'editar' ? null : familia, datosPlantilla, motivo.trim())
      await onCambio()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const titulo = modo.tipo === 'nueva' ? (formato === 'docx' ? 'Subir modelo en Word' : 'Crear plantilla de texto') : modo.tipo === 'version' ? `Nueva versión de «${base!.nombre}»` : `Editar borrador · ${base!.nombre} v${base!.version}`

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Queda guardada como borrador en Supabase. No se puede usar para emitir documentos hasta que Legal la apruebe.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-3"><Label htmlFor="pl-nombre" className="text-xs">Nombre de la plantilla *</Label><Input id="pl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pl-tipo" className="text-xs">Tipo de documento *</Label>
              <select id="pl-tipo" className={campo} value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value as TipoDocumentoContractual)}>{(Object.keys(TIPOS_DOCUMENTO_CONTRACTUAL) as TipoDocumentoContractual[]).map((t) => <option key={t} value={t}>{TIPOS_DOCUMENTO_CONTRACTUAL[t]}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="pl-op" className="text-xs">Tipo de operación *</Label>
              <select id="pl-op" className={campo} value={tipoOp} onChange={(e) => setTipoOp(e.target.value as TipoOperacion)}>{(Object.keys(TIPOS_OPERACION) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPOS_OPERACION[t]}</option>)}</select></div>
            <div className="grid gap-1.5"><Label htmlFor="pl-notas" className="text-xs">Notas internas</Label><Input id="pl-notas" value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
          </div>

          {formato === 'docx' ? (
            <div className="grid gap-1.5 rounded-lg border border-border p-3">
              <Label htmlFor="pl-archivo" className="text-xs">Modelo en Word (.docx) {modo.tipo === 'editar' ? '(opcional: reemplaza el actual)' : '*'}</Label>
              <input id="pl-archivo" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="text-xs" onChange={(e) => void elegir(e.target.files?.[0])} />
              <p className="text-[11px] text-muted-foreground">Escribe en el Word los campos entre llaves, por ejemplo {'{comprador.nombre}'}, y {'{#pago.cuotas}'} … {'{/pago.cuotas}'} para repetir filas de una tabla. Se conservan el formato, las tablas, la numeración, los encabezados y los pies.</p>
              {(archivo || base?.archivoNombre) && <p className="text-[11px]">Archivo: <b>{archivo?.nombre ?? base?.archivoNombre}</b></p>}
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="pl-cuerpo" className="text-xs">Texto de la plantilla *</Label>
              <Textarea id="pl-cuerpo" rows={12} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} className="font-mono text-[11px]" />
              <p className="text-[11px] text-muted-foreground">{AYUDA}</p>
              <p className="text-[11px] text-muted-foreground">Se agrega automáticamente un bloque de firmas (parte vendedora, compradores y apoderados) sin cláusulas.</p>
            </div>
          )}

          <fieldset className="grid gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold">Campos de la plantilla</legend>
            {variables.length === 0 ? <p className="text-muted-foreground">Cuando cargues el modelo aparecen aquí los campos detectados. Los del catálogo de AMURA se llenan solos con datos de Supabase; los demás se piden al generar.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" aria-label="Campos de la plantilla">
                  <thead className="text-[11px] text-muted-foreground"><tr><th className="py-1 text-left font-medium">Campo</th><th className="text-left font-medium">Cómo se llena</th><th className="text-left font-medium">Nombre en pantalla</th><th className="text-center font-medium">Obligatorio</th></tr></thead>
                  <tbody>{variables.map((v) => (
                    <tr key={v.clave} className="border-t border-border">
                      <td className="py-1.5"><code>{`{${v.clave}}`}</code></td>
                      <td>
                        <select className={campo} aria-label={`Origen de ${v.clave}`} value={v.origen} onChange={(e) => set(v.clave, { origen: e.target.value as 'catalogo' | 'manual' })}>
                          {catalogo.has(v.clave) && <option value="catalogo">Datos de AMURA</option>}<option value="manual">Se escribe al generar</option>
                        </select>
                      </td>
                      <td>{v.origen === 'manual' ? <Input aria-label={`Nombre de ${v.clave}`} value={v.etiqueta} onChange={(e) => set(v.clave, { etiqueta: e.target.value })} /> : <span className="text-muted-foreground">{campos.find((c) => c.clave === v.clave)?.etiqueta}</span>}</td>
                      <td className="text-center"><input type="checkbox" aria-label={`${v.clave} obligatorio`} checked={v.obligatorio} onChange={(e) => set(v.clave, { obligatorio: e.target.checked })} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </fieldset>
          <div className="grid gap-1.5"><Label htmlFor="pl-motivo" className="text-xs">Motivo *</Label><Input id="pl-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!valido || ocupado} onClick={() => void guardar()}>{ocupado ? 'Guardando…' : modo.tipo === 'editar' ? 'Guardar borrador' : 'Guardar como borrador'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
