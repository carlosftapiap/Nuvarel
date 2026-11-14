import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, CheckCheck, ChevronRight, ListChecks, Receipt, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useSession } from '@/app/session'
import Estado, { Avatar, type Tono } from '@/components/Estado'
import { Button } from '@/components/ui/button'
import AccionesRapidas from '@/features/clientes/components/AccionesRapidas'
import { TIPOS_ACTIVIDAD, type Cliente } from '@/features/clientes/model'
import { clientesVisibles, ordenarPorUrgencia, urgencia } from '@/features/clientes/service'
import { useClientesOpcional } from '@/features/clientes/store'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { DIALOGO_DE, useAccionesReserva } from '@/features/reservas/components/AccionesReserva'
import type { Reserva } from '@/features/reservas/model'
import { reservasVisibles } from '@/features/reservas/service'
import { siguientePaso, type AccionReserva, type SiguientePaso } from '@/features/reservas/siguiente'
import { useReservasOpcional } from '@/features/reservas/store'
import { cn } from '@/lib/utils'

const ICONO_RESERVA: Record<AccionReserva, LucideIcon> = { registrar_pago: Receipt, reenviar_pago: Receipt, verificar_pago: ShieldCheck, autorizar: BadgeCheck }

/** Fila de la cola: ícono o avatar, qué pasa, su estado y la acción a un clic. */
export function FilaCola({ icono, avatar, titulo, detalle, estado, tono, children, destacada }: {
  icono?: LucideIcon; avatar?: string; titulo: ReactNode; detalle: ReactNode; estado?: string; tono?: Tono; children?: ReactNode; destacada?: boolean
}) {
  const Icono = icono
  return (
    <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-white p-3 sm:px-4', destacada ? 'border-[#c7d2fe] shadow-[0_0_0_3px_#eef2ff]' : 'border-border')}>
      {avatar ? <Avatar nombre={avatar} className="size-10" /> : Icono && (
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', tono === 'peligro' ? 'bg-peligro-bg text-peligro' : tono === 'aviso' ? 'bg-aviso-bg text-aviso' : tono === 'neutro' ? 'bg-neutro-bg text-neutro' : 'bg-secondary text-primary')}>
          <Icono className="size-[18px]" aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1 basis-40">
        <div className="truncate text-sm font-semibold">{titulo}</div>
        <div className="truncate text-xs text-slate-600">{detalle}</div>
      </div>
      {estado && <Estado tono={tono ?? 'neutro'} className="max-sm:order-3">{estado}</Estado>}
      {children && <div className="flex shrink-0 items-center gap-2 max-sm:ml-auto">{children}</div>}
    </li>
  )
}

/** Gestión de un cliente (vencida o de hoy) con sus acciones rápidas. */
export function FilaGestion({ c, onAviso, vendedor }: { c: Cliente; onAviso: (m: string) => void; vendedor?: boolean }) {
  const u = urgencia(c)
  return (
    <FilaCola avatar={c.nombre}
      titulo={<Link to={`/clientes?cliente=${c.id}`} className="hover:underline">{c.nombre}</Link>}
      detalle={c.proxima ? `${TIPOS_ACTIVIDAD[c.proxima.tipo]} · ${c.proxima.descripcion}${vendedor ? ` · ${c.asesor}` : ''}` : 'Sin próxima gestión'}
      estado={u === 'vencida' ? `Vencida · ${fmtFechaCorta(c.proxima!.fecha)}` : u === 'hoy' ? 'Hoy' : undefined}
      tono={u === 'vencida' ? 'peligro' : 'aviso'}>
      <AccionesRapidas cliente={c} onMessage={onAviso} />
    </FilaCola>
  )
}

/**
 * Lo que la persona debe hacer hoy, en orden de urgencia: reservas en las que le toca actuar (con su diálogo a un clic),
 * gestiones vencidas y de hoy, y los clientes que se quedaron sin siguiente paso.
 * `propios`: solo los clientes de los que la persona es responsable (el Supervisor ve los de su equipo aparte).
 */
export default function ColaDelDia({ onAviso, onError, propios = false, max = 6, vacio }: { onAviso: (m: string) => void; onError: (m: string) => void; propios?: boolean; max?: number; vacio?: ReactNode }) {
  const clientesCtx = useClientesOpcional()
  const reservasCtx = useReservasOpcional()
  if (!clientesCtx || !reservasCtx) return null
  return <Cola onAviso={onAviso} onError={onError} propios={propios} max={max} vacio={vacio} />
}

function Cola({ onAviso, onError, propios, max, vacio }: { onAviso: (m: string) => void; onError: (m: string) => void; propios: boolean; max: number; vacio?: ReactNode }) {
  const { actor, can } = useSession()
  const { state } = useClientesOpcional()!
  const { flujo, abrir, dialogos } = useAccionesReserva(onAviso, onError)
  const hoy = hoyGuayaquil()
  const clientes = clientesVisibles(state.clientes, actor).filter((c) => c.etapa !== 'perdido' && (!propios || c.asesorId === actor.id))
  const reservas: { r: Reserva; p: SiguientePaso }[] = reservasVisibles(flujo.res.reservas, actor)
    .map((r) => ({ r, p: siguientePaso(r, can, { remoto: flujo.remoto }) }))
    .filter((x) => x.p.accion)
    .sort((a, b) => a.r.vigenciaHasta.localeCompare(b.r.vigenciaHasta))
  const gestiones = ordenarPorUrgencia(clientes.filter((c) => ['vencida', 'hoy'].includes(urgencia(c, hoy))), hoy)
  const sinGestion = clientes.filter((c) => urgencia(c, hoy) === 'sin_actividad').length
  const vencidas = gestiones.filter((c) => urgencia(c, hoy) === 'vencida').length
  const total = reservas.length + gestiones.length + (sinGestion ? 1 : 0)
  return (
    <>
      {total === 0 ? (vacio ?? (
        <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center gap-2 rounded-2xl border border-dashed border-[#c9cfda] bg-white px-6 py-10 text-center">
          <span className="grid grid-cols-[minmax(0,1fr)] size-12 place-items-center rounded-2xl bg-secondary text-primary"><CheckCheck className="size-6" aria-hidden="true" /></span>
          <p className="text-[15px] font-semibold">Todo al día</p>
          <p className="max-w-sm text-[13px] text-slate-600">No hay reservas ni gestiones pendientes. Buen momento para atender a un cliente nuevo o revisar el pipeline.</p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="outline" asChild><Link to="/clientes">Ver mis clientes</Link></Button>
            <Button size="sm" variant="outline" asChild><Link to="/comercial">Ver pipeline</Link></Button>
          </div>
        </div>
      )) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Pendientes de hoy">
          {reservas.slice(0, max).map(({ r, p }) => (
            <FilaCola key={r.id} destacada icono={ICONO_RESERVA[p.accion!]} tono="info" titulo={p.titulo}
              detalle={`${r.codigo} · ${r.clienteNombre} · ${fmtUsd2(r.montoReserva)}`} estado={p.estado}>
              <Button size="sm" onClick={() => abrir(DIALOGO_DE[p.accion!], r)}>{p.boton}</Button>
            </FilaCola>
          ))}
          {reservas.length > max && <li><Link to="/reservas" className="flex items-center gap-1 px-2 text-xs font-semibold text-primary hover:underline">Ver las {reservas.length} reservas por atender<ChevronRight className="size-3.5" /></Link></li>}
          {gestiones.slice(0, max).map((c) => <FilaGestion key={c.id} c={c} onAviso={onAviso} vendedor={!propios && c.asesorId !== actor.id} />)}
          {gestiones.length > max && (
            <li><Link to={`/clientes?filtro=${vencidas ? 'vencidas' : 'hoy'}`} className="flex items-center gap-1 px-2 text-xs font-semibold text-primary hover:underline">Ver las {gestiones.length} gestiones pendientes<ChevronRight className="size-3.5" /></Link></li>
          )}
          {sinGestion > 0 && (
            <FilaCola icono={ListChecks} tono="neutro" titulo={`${sinGestion} ${sinGestion === 1 ? 'cliente' : 'clientes'} sin próxima gestión`} detalle="Sin siguiente paso, el seguimiento se enfría" estado="Esta semana">
              <Button size="sm" variant="outline" asChild><Link to="/clientes?filtro=sin">Ver lista</Link></Button>
            </FilaCola>
          )}
        </ul>
      )}
      {dialogos}
    </>
  )
}

/** Cuántas cosas esperan a la persona hoy (para el saludo del inicio). */
// eslint-disable-next-line react-refresh/only-export-components
export function usePendientesDelDia(propios = false) {
  const { actor, can } = useSession()
  const clientesCtx = useClientesOpcional()
  const reservasCtx = useReservasOpcional()
  if (!clientesCtx || !reservasCtx) return null
  const hoy = hoyGuayaquil()
  const clientes = clientesVisibles(clientesCtx.state.clientes, actor).filter((c) => c.etapa !== 'perdido' && (!propios || c.asesorId === actor.id))
  const reservas = reservasVisibles(reservasCtx.state.reservas, actor).filter((r) => siguientePaso(r, can, { remoto: reservasCtx.remoto }).accion).length
  const vencidas = clientes.filter((c) => urgencia(c, hoy) === 'vencida').length
  const deHoy = clientes.filter((c) => urgencia(c, hoy) === 'hoy').length
  return { reservas, vencidas, deHoy, total: reservas + vencidas + deHoy }
}
