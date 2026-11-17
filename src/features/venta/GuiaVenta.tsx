import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, Check, Clock } from 'lucide-react'
import { useSession } from '@/app/session'
import type { Permiso } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PASOS_VENTA, pasoActual, type Accion, type Paso } from './operacion'

/** Pantalla donde otro rol ejecuta el paso, si quien mira tiene permiso para hacerlo. */
const DESTINO_OTRO_ROL: Partial<Record<Accion, { permisos: Permiso[]; to: string; texto: string }>> = {
  verificar: { permisos: ['reservas.verificar_pago', 'cobranzas.verificar'], to: '/pagos-por-verificar', texto: 'Verificar el pago' },
  aprobar: { permisos: ['reservas.confirmar'], to: '/reservas', texto: 'Autorizar la excepción' },
  contrato: { permisos: ['ventas.preparar'], to: '/ventas', texto: 'Generar el contrato' },
  enviar_cumplimiento: { permisos: ['ventas.preparar'], to: '/ventas', texto: 'Enviar a Cumplimiento' },
  cumplimiento: { permisos: ['cumplimiento.revisar'], to: '/cumplimiento', texto: 'Revisar el expediente' },
  firma: { permisos: ['ventas.formalizar'], to: '/ventas', texto: 'Formalizar la firma' },
}

/**
 * Guía del proceso de venta: qué se completó, qué sigue, quién lo hace y dónde hacer clic.
 * Solo orienta: cada botón sigue validando permisos y datos en el servidor.
 */
export default function GuiaVenta({ paso, clienteId, compacta = false }: { paso: Paso; clienteId?: string; compacta?: boolean }) {
  const actual = pasoActual(paso.accion)
  const final = paso.accion === 'cobranza'

  return (
    <section aria-labelledby="guia-titulo" className={cn(!compacta && 'dashboard-card mb-4 p-4')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="guia-titulo" className="text-sm font-semibold">Proceso de venta</h2>
        <span className="text-xs text-muted-foreground">{final ? 'Venta formalizada' : `Etapa ${actual + 1} de ${PASOS_VENTA.length}`}</span>
      </div>
      <ol aria-label="Pasos de la venta" className={cn('mt-2 grid grid-cols-5 gap-1', !compacta && 'sm:gap-1.5')}>
        {PASOS_VENTA.map((x, i) => {
          const hecho = i < actual || (final && i === actual)
          const enCurso = i === actual && !final
          return (
            <li key={x.clave} aria-current={enCurso ? 'step' : undefined}
              className={cn('flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-center text-xs sm:flex-row sm:items-start sm:gap-1.5 sm:px-2 sm:text-left',
                hecho ? 'border-emerald-200 bg-emerald-50/60' : enCurso ? 'border-primary bg-secondary ring-1 ring-primary' : 'border-border text-muted-foreground')}>
              <span className={cn('grid size-4 shrink-0 place-items-center rounded-full text-xs font-semibold', hecho ? 'bg-emerald-600 text-white' : enCurso ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                {hecho ? <Check className="size-2.5" /> : i + 1}
              </span>
              <span className="w-full min-w-0"><span className="block truncate font-medium leading-tight text-foreground">{x.titulo}</span><span className={cn('hidden text-xs', !compacta && 'sm:block')}>{x.quien}</span></span>
            </li>
          )
        })}
      </ol>

      <EstadoPaso paso={paso} clienteId={clienteId} />
    </section>
  )
}

/** Qué sigue, quién lo hace y, si quien mira puede, el botón para hacerlo. */
export function EstadoPaso({ paso, clienteId, className }: { paso: Paso; clienteId?: string; className?: string }) {
  const { can } = useSession()
  const propio = paso.responsable === 'Vendedor'
  const otro = DESTINO_OTRO_ROL[paso.accion]
  const puedeActuar = !!otro && otro.permisos.some((p) => can(p))
  const final = paso.accion === 'cobranza'
  return (
    <div role="status" className={cn('mt-3 rounded-lg border px-3 py-2.5', propio || puedeActuar ? 'border-primary/40 bg-secondary' : 'border-amber-200 bg-amber-50', className)}>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {propio || puedeActuar ? <><ArrowRight className="size-3" />Ahora te toca</> : <><Clock className="size-3 text-amber-700" /><span className="text-amber-800">{final ? 'Seguimiento' : `Esperando a ${paso.responsable}`}</span></>}
        </div>
        <div className="mt-0.5 text-sm font-semibold">{paso.titulo}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{paso.detalle}</p>
        {propio && paso.accion !== 'expediente' && paso.accion !== 'identificacion' && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary"><ArrowDown className="size-3" />Haz clic en el botón destacado para continuar.</p>}
        {!propio && !puedeActuar && !final && <p className="mt-1 text-xs text-amber-800">No necesitas hacer nada ahora. Cuando {paso.responsable} termine, aquí se destacará tu siguiente acción.</p>}
        <div className="mt-2 flex flex-wrap gap-2 empty:hidden">
          {paso.accion === 'expediente' && clienteId && can('clientes.ver') && <Destacado activo><Button asChild size="sm"><Link to={`/clientes?cliente=${clienteId}`}>Abrir los documentos del cliente</Link></Button></Destacado>}
          {paso.accion === 'identificacion' && clienteId && can('clientes.editar') && <Destacado activo><Button asChild size="sm"><Link to={`/clientes?cliente=${clienteId}`}>Completar la identificación</Link></Button></Destacado>}
          {puedeActuar && <Destacado activo><Button asChild size="sm"><Link to={otro.to}>{otro.texto}</Link></Button></Destacado>}
          {final && can('cobranzas.ver') && <Button asChild size="sm" variant="outline"><Link to="/cobranzas">Ver cobranzas</Link></Button>}
          {final && can('comisiones.ver_propias') && <Button asChild size="sm" variant="outline"><Link to="/comisiones">Ver mi comisión</Link></Button>}
        </div>
      </div>
  )
}

/** Ilumina el control del siguiente paso. Sin `activo`, lo deja tal cual. */
export function Destacado({ activo, children, texto }: { activo: boolean; children: ReactNode; texto?: string }) {
  if (!activo) return <>{children}</>
  return (
    <div className="grid gap-1" data-guia="siguiente">
      {texto && <span className="flex items-center gap-1 text-xs font-semibold text-primary"><ArrowDown className="size-3" />{texto}</span>}
      <div className="guia-pulso grid rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background">{children}</div>
    </div>
  )
}
