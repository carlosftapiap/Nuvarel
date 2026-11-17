import { useEffect, useState } from 'react'
import { CheckCircle2, Upload } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { leerMaestro, subirMaestro, ETIQUETA_MAESTRO } from '@/features/venta/expediente-datos'
import { MAESTROS, type TipoMaestro } from '@/features/venta/expediente'

const CLAVES: TipoMaestro[] = ['natural', 'juridica', 'ficha']

/** Administración: carga los tres formularios oficiales que arman el expediente de venta. Cada archivo se valida por número de páginas antes de guardarse. */
export default function FormulariosVenta() {
  const [cargados, setCargados] = useState<Partial<Record<TipoMaestro, boolean>> | null>(null)
  const [trabajando, setTrabajando] = useState<TipoMaestro | null>(null)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const revisar = async () => {
    const estado: Partial<Record<TipoMaestro, boolean>> = {}
    for (const k of CLAVES) estado[k] = (await leerMaestro(k).catch(() => null)) !== null
    setCargados(estado)
  }
  useEffect(() => { void revisar() }, [])

  const subir = async (clave: TipoMaestro, archivo: File | undefined) => {
    if (!archivo) return
    setTrabajando(clave); setMensaje(null)
    try {
      await subirMaestro(clave, archivo)
      setMensaje({ tipo: 'ok', texto: `Cargado: ${ETIQUETA_MAESTRO[clave]}.` })
      await revisar()
    } catch (e) {
      setMensaje({ tipo: 'error', texto: (e as Error).message })
    } finally {
      setTrabajando(null)
    }
  }

  return (
    <section aria-labelledby="formularios-venta" className="grid gap-4">
      <div>
        <h2 id="formularios-venta" className="text-base font-semibold">Formularios del expediente de venta</h2>
        <p className="text-sm text-muted-foreground">
          Los PDF oficiales de AMURA. Se usan tal cual en cada expediente: la carátula se agrega delante. Solo se aceptan archivos con el número de páginas indicado.
        </p>
      </div>

      <div className="grid gap-3">
        {CLAVES.map((clave) => {
          const ok = cargados?.[clave]
          return (
            <div key={clave} className="grid gap-2 rounded-xl border bg-white p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{ETIQUETA_MAESTRO[clave]}</p>
                <p className="text-xs text-muted-foreground">{MAESTROS[clave].nombre} · {MAESTROS[clave].paginas} páginas</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-medium">
                  {cargados === null ? 'Verificando…' : ok ? <><CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" /><span className="text-emerald-700">Cargado</span></> : <span className="text-amber-700">Falta cargar</span>}
                </p>
              </div>
              <Label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 has-[:disabled]:opacity-60">
                <Upload className="size-4" aria-hidden="true" />
                {trabajando === clave ? 'Cargando…' : ok ? 'Reemplazar PDF' : 'Cargar PDF'}
                <input type="file" accept="application/pdf" className="sr-only" disabled={trabajando !== null}
                  onChange={(e) => { void subir(clave, e.target.files?.[0]); e.target.value = '' }} />
              </Label>
            </div>
          )
        })}
      </div>

      {mensaje && (
        <p role="status" className={mensaje.tipo === 'error' ? 'text-sm font-medium text-red-700' : 'text-sm font-medium text-emerald-700'}>{mensaje.texto}</p>
      )}
    </section>
  )
}
