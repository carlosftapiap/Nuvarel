import { useEffect, useState, type CSSProperties } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/features/inventario/components/shared'
import type { AlmacenContratos } from '../almacen'
import type { Bloque, BordeDoc, Parrafo, Rgb, Tramo } from '../bloques'
import { descargarBlob, obtenerArchivo, type ArchivoVersion } from '../generar'
import type { VersionDocumento } from '../model'

const FAMILIA: Record<Tramo['fuente'], string> = { helvetica: 'Arial, Helvetica, sans-serif', times: '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' }
const rgb = (c: Rgb | null) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : undefined)
const estiloTramo = (t: Tramo): CSSProperties => ({
  fontFamily: FAMILIA[t.fuente], fontSize: `${t.tamano}pt`, fontWeight: t.negrita ? 700 : 400, fontStyle: t.cursiva ? 'italic' : 'normal', color: rgb(t.color), backgroundColor: rgb(t.fondo),
  textDecoration: [t.subrayado && 'underline', t.tachado && 'line-through'].filter(Boolean).join(' ') || undefined, verticalAlign: t.posicion === 'super' ? 'super' : t.posicion === 'sub' ? 'sub' : undefined,
})

function TramoHtml({ t }: { t: Tramo }) {
  if (t.imagen) return t.imagen.flotante ? null : <img src={t.imagen.dataUrl} alt="" style={{ display: 'inline-block', width: `${t.imagen.ancho}pt`, height: `${t.imagen.alto}pt` }} />
  return <span style={estiloTramo(t)}>{t.campo === 'PAGE' ? '#' : t.campo === 'NUMPAGES' ? '#' : t.texto}</span>
}

function ParrafoHtml({ p }: { p: Parrafo }) {
  const estilo: CSSProperties = {
    textAlign: p.alinear === 'centro' ? 'center' : p.alinear === 'der' ? 'right' : p.alinear === 'justificado' ? 'justify' : 'left',
    marginLeft: `${p.izq}pt`, marginRight: `${p.der}pt`, textIndent: `${p.primera}pt`, marginTop: `${p.antes}pt`, marginBottom: `${p.despues}pt`, whiteSpace: 'pre-wrap', tabSize: 6,
    lineHeight: p.linea.modo === 'auto' ? p.linea.valor * 1.15 : `${p.linea.valor}pt`, minHeight: `${p.marca.tamano * 1.15}pt`, backgroundColor: rgb(p.fondo),
    borderTop: p.bordeArriba ? `${p.bordeArriba.ancho}pt solid ${rgb(p.bordeArriba.color)}` : undefined, borderBottom: p.bordeAbajo ? `${p.bordeAbajo.ancho}pt solid ${rgb(p.bordeAbajo.color)}` : undefined,
  }
  return <p style={estilo}>{p.etiqueta && <span style={estiloTramo(p.etiqueta)}>{p.etiqueta.texto}{p.sufijo === 'nada' ? '' : p.sufijo === 'espacio' ? ' ' : '\t'}</span>}{p.tramos.map((t, i) => <TramoHtml key={i} t={t} />)}</p>
}

function BloquesHtml({ bloques }: { bloques: Bloque[] }) {
  return bloques.map((b, i) => {
    if (b.tipo === 'salto') return <div key={i} className="my-8 border-t border-dashed border-slate-300 text-center text-xs uppercase tracking-widest text-slate-400">nueva página</div>
    if (b.tipo === 'parrafo') return <ParrafoHtml key={i} p={b} />
    return (
      <table key={i} className="my-1 border-collapse" style={{ tableLayout: 'fixed', width: b.columnas.length ? `${b.columnas.reduce((s, c) => s + c, 0)}pt` : '100%', maxWidth: '100%' }}>
        {b.columnas.length > 0 && <colgroup>{b.columnas.map((c, k) => <col key={k} style={{ width: `${c}pt` }} />)}</colgroup>}
        <tbody>
          {b.detalle.map((f, r) => (
            <tr key={r}>{f.celdas.map((c, k) => {
              if (c.vmerge === 'sigue') return null
              let filas = 1
              if (c.vmerge === 'inicio') while (b.detalle[r + filas]?.celdas.some((o) => o.columna === c.columna && o.vmerge === 'sigue')) filas++
              const lado = (x: BordeDoc | null) => (x ? `${x.ancho}pt solid ${rgb(x.color)}` : undefined)
              return (
                <td key={k} colSpan={c.span} rowSpan={filas} style={{ verticalAlign: c.vAlign === 'centro' ? 'middle' : c.vAlign === 'abajo' ? 'bottom' : 'top', backgroundColor: rgb(c.fondo), padding: `${c.margenes.arriba}pt ${c.margenes.der}pt ${c.margenes.abajo}pt ${c.margenes.izq}pt`, borderTop: lado(c.bordes.arriba), borderBottom: lado(c.bordes.abajo), borderLeft: lado(c.bordes.izq), borderRight: lado(c.bordes.der) }}>
                  <BloquesHtml bloques={c.bloques} />
                </td>
              )
            })}</tr>
          ))}
        </tbody>
      </table>
    )
  })
}

/** Vista del documento tal como saldrá: una hoja con su contenido, y el PDF exacto a un clic. Sirve antes de generar y para plantillas en borrador. */
export function VistaPrevia({ bloques, marca, pdf, avisos = [] }: { bloques: Bloque[]; marca?: string; pdf?: Uint8Array | null; avisos?: string[] }) {
  const [urlPdf, setUrlPdf] = useState<string | null>(null)
  useEffect(() => () => { if (urlPdf) URL.revokeObjectURL(urlPdf) }, [urlPdf])
  return (
    <div className="grid gap-2">
      {avisos.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Diferencias entre el Word y el PDF:</p>
          <ul className="list-disc pl-5">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {pdf && <div><Button size="xs" variant="outline" onClick={() => setUrlPdf(urlPdf ? null : URL.createObjectURL(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' })))}>{urlPdf ? 'Ver como texto' : 'Ver el PDF exacto'}</Button></div>}
      {urlPdf ? <iframe title="PDF del documento" src={urlPdf} className="h-[60vh] w-full rounded-lg border border-border bg-white" /> : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-slate-200 p-3 sm:p-5">
          <article aria-label="Vista previa del documento" className="mx-auto max-w-[760px] bg-white px-6 py-8 text-slate-900 shadow sm:px-14 sm:py-12">
            {marca && <p className="mb-6 text-center text-xs font-bold uppercase tracking-wide text-rose-700">{marca}</p>}
            <BloquesHtml bloques={bloques} />
          </article>
        </div>
      )}
    </div>
  )
}

/** Visor del PDF guardado de una versión. Antes de mostrarlo se comprueba su huella de integridad. */
export function VisorDocumento({ version, almacen, titulo, onClose }: { version: VersionDocumento; almacen: AlmacenContratos; titulo: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cual, setCual] = useState<ArchivoVersion>('pdf')
  useEffect(() => {
    let vivo = true
    let objeto: string | null = null
    setUrl(null); setError(null)
    obtenerArchivo(almacen, version, cual)
      .then(({ blob }) => { if (vivo) { objeto = URL.createObjectURL(blob); setUrl(objeto) } })
      .catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto) }
  }, [almacen, version, cual])

  async function descargar(c: ArchivoVersion) {
    setError(null)
    try { const { blob, nombre } = await obtenerArchivo(almacen, version, c); descargarBlob(blob, nombre) } catch (e) { setError((e as Error).message) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>Versión {version.numero} · plantilla «{version.plantillaNombre}» v{version.plantillaVersion}. Verificado contra su huella de integridad.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={cual === 'pdf' ? 'default' : 'outline'} onClick={() => setCual('pdf')}>Documento generado</Button>
          {version.firmadoRuta && <Button size="sm" variant={cual === 'firmado' ? 'default' : 'outline'} onClick={() => setCual('firmado')}>Documento firmado</Button>}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void descargar(cual)}><Download />Descargar este archivo</Button>
        </div>
        <FieldError>{error}</FieldError>
        {!error && !url && <p className="p-6 text-center text-sm text-muted-foreground">Abriendo el documento…</p>}
        {url && <iframe title="Documento contractual" src={url} className="h-[65vh] w-full rounded-lg border border-border bg-white" />}
      </DialogContent>
    </Dialog>
  )
}
