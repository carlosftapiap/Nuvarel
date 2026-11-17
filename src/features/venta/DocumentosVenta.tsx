import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { cn } from '@/lib/utils'
import { cargarChecklist, imprimirChecklist, verCotizacion } from './checklist'
import { ESPECIFICACIONES_APROBADAS, FICHA_TECNICA } from './ficha'
import { verFicha } from './paquete'
import { descargarExpedienteCotizacion, ETIQUETA_MAESTRO, maestrosFaltantes } from './expediente-datos'
import OrdenContratoPanel from './OrdenContratoPanel'
import PlanoCotizacion from '@/features/planos/PlanoCotizacion'
import type { TipoMaestro } from './expediente'

/**
 * Documentos para el cliente, en cinco secciones: cotización, plano, checklist, orden de contrato y expediente.
 * Ver o imprimir no cambia el expediente de Cumplimiento. Imprimir y descargar se hacen desde el visor del PDF.
 */
export default function DocumentosVenta({ cotizacion, datos, onError, className }: { cotizacion: Cotizacion; datos: Datos | null; onError: (m: string) => void; className?: string }) {
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [tipo, setTipo] = useState<TipoPersona>('natural')
  const [aviso, setAviso] = useState<string | null>(null)
  // null: aún no se sabe (o no se pudo consultar). Lista vacía: expediente listo.
  const [faltan, setFaltan] = useState<TipoMaestro[] | null>(null)

  // El tipo de comprador sale del cliente registrado; el vendedor puede corregirlo antes de imprimir.
  useEffect(() => {
    if (!datos) return
    void cargarChecklist(datos, cotizacion.clienteId).then((r) => setTipo(r.tipoPersona)).catch(() => undefined)
  }, [datos, cotizacion.clienteId])
  useEffect(() => {
    maestrosFaltantes().then(setFaltan).catch(() => { setFaltan(null); setAviso('No se pudo verificar los formularios del expediente.') })
  }, [])
  const listo = faltan !== null && faltan.length === 0

  const ejecutar = async (clave: string, fn: () => Promise<void>) => {
    setTrabajando(clave); setAviso(null)
    try { await fn() } catch (e) { onError((e as Error).message) }
    setTrabajando(null)
  }
  const boton = 'h-10 w-full sm:w-auto'
  const cargando = (clave: string) => trabajando === clave
  const spin = (clave: string) => (cargando(clave) ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null)

  return (
    <section aria-labelledby="docs-venta" className={cn('rounded-2xl border bg-white p-4 sm:p-5', className)}>
      <header className="grid gap-0.5">
        <h2 id="docs-venta" className="text-base font-semibold">Documentos para el cliente</h2>
        <p className="text-xs text-muted-foreground">{cotizacion.numero} · cotización vigente hasta el {fmtFechaCorta(cotizacion.validaHasta)}</p>
      </header>

      <div className="mt-4 grid gap-5 divide-y [&>*]:pt-5 [&>*:first-child]:pt-0">
        <Seccion titulo="1. Cotización">
          <Button className={boton} disabled={!!trabajando} onClick={() => void ejecutar('ver-cot', () => verCotizacion(cotizacion))}>
            {spin('ver-cot')}Ver cotización
          </Button>
        </Seccion>

        <Seccion titulo="2. Plano">
          <PlanoCotizacion cotizacion={cotizacion} datos={datos} onError={onError} />
        </Seccion>

        <Seccion titulo="3. Checklist de documentos" ayuda="Lo que el comprador debe entregar.">
          {datos ? (
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-medium text-slate-700">
                Tipo de comprador
                <select className="h-10 rounded-md border border-border bg-white px-2 text-sm" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPersona)} disabled={!!trabajando}>
                  <option value="natural">Persona natural</option>
                  <option value="juridica">Persona jurídica</option>
                </select>
              </label>
              <Button className={boton} disabled={!!trabajando} onClick={() => void ejecutar('chk', () => imprimirChecklist(datos, cotizacion, tipo, false))}>
                {spin('chk')}Ver checklist
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Disponible cuando la cotización está conectada al sistema.</p>
          )}
        </Seccion>

        <Seccion titulo="4. Orden de contrato">
          <OrdenContratoPanel cotizacion={cotizacion} datos={datos} tipo={tipo} onError={onError} />
        </Seccion>

        <Seccion titulo="5. Expediente completo" ayuda={`Carátula con los datos de esta operación y el formulario oficial AMURA: 15 páginas${ESPECIFICACIONES_APROBADAS ? ' (17 con la ficha técnica)' : ''}.`}>
          {faltan === null && <p className="text-xs text-muted-foreground">Verificando formularios…</p>}
          {faltan !== null && faltan.length > 0 && (
            <div role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Expediente pendiente</p>
              <p className="mt-1">Falta cargar: {faltan.map((f) => ETIQUETA_MAESTRO[f]).join('; ')}. Un administrador los carga en Configuración &gt; Formularios de venta.</p>
            </div>
          )}
          <Button className={boton} disabled={!datos || !listo || !!trabajando}
            onClick={() => void ejecutar('desc-exp', async () => {
              const r = await descargarExpedienteCotizacion(cotizacion, tipo)
              setAviso(`Expediente descargado: ${r.paginas} páginas.`)
            })}>
            {spin('desc-exp')}Descargar expediente (PDF)
          </Button>

          {ESPECIFICACIONES_APROBADAS ? (
            <Button className={cn(boton, 'mt-2')} variant="outline" disabled={!!trabajando} onClick={() => void ejecutar('ficha', () => verFicha(false))}>
              {spin('ficha')}Ver ficha técnica · {ESPECIFICACIONES_APROBADAS.version}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Ficha técnica pendiente de aprobación ({FICHA_TECNICA.version}). No se incluye hasta su aprobación.</p>
          )}
        </Seccion>

        {aviso && <p role="status" className="pt-4 text-xs font-medium text-slate-800">{aviso}</p>}
      </div>
    </section>
  )
}

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold text-slate-900">{titulo}</h3>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </div>
  )
}
