import { useSession } from '@/app/session'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { useClientes } from '@/features/clientes/store'
import { useInventory } from '@/features/inventario/store'
import { useReservas } from './store'
import { anularReserva, confirmarReserva, solicitarReserva, type ConfirmarInput, type Estado } from './service'

/**
 * Punto único para tocar reservas. Calcula inventario, clientes y reservas juntos;
 * si una regla falla, lanza el error y no se modifica ningún dato.
 */
export function useReservaFlujo() {
  const { state: inv, update: updInv } = useInventory()
  const { state: clientes, update: updCli } = useClientes()
  const { state: res, update: updRes } = useReservas()
  const { actor } = useSession()

  const aplicar = (fn: (e: Estado) => Estado) => {
    const n = fn({ inv, res, clientes })
    updInv(() => n.inv)
    updCli(() => n.clientes)
    updRes(() => n.res)
  }

  return {
    res,
    solicitar: (cot: Cotizacion) => aplicar((e) => solicitarReserva(e, cot, actor)),
    confirmar: (id: string, input: ConfirmarInput) => aplicar((e) => confirmarReserva(e, id, input, actor)),
    anular: (id: string, motivo: string) => aplicar((e) => anularReserva(e, id, motivo, actor)),
  }
}
