import { useSession } from '@/app/session'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { useClientes } from '@/features/clientes/store'
import { useInventory } from '@/features/inventario/store'
import type { Reserva } from './model'
import * as remoto from './remoto'
import { useReservas } from './store'
import { anularReserva, aprobarReserva, solicitarReserva, verificarPagoReserva, type ConfirmarInput, type Estado } from './service'

/**
 * Punto único para tocar reservas.
 * Sin Supabase calcula inventario, clientes y reservas juntos; si una regla falla, lanza el error y no se modifica ningún dato.
 * Con Supabase cada paso lo ejecuta el servidor en una transacción, y después se releen los tres módulos.
 */
export function useReservaFlujo() {
  const { state: inv, update: updInv, recargar: recargarInv } = useInventory()
  const { state: clientes, update: updCli, recargar: recargarCli } = useClientes()
  const { state: res, update: updRes, recargar: recargarRes, remoto: conectado, datos } = useReservas()
  const { actor } = useSession()

  const aplicar = (fn: (e: Estado) => Estado) => {
    const n = fn({ inv, res, clientes })
    updInv(() => n.inv)
    updCli(() => n.clientes)
    updRes(() => n.res)
  }

  if (conectado && datos) {
    const enServidor = async (fn: () => Promise<unknown>) => {
      try {
        await fn()
      } finally {
        // Si el servidor rechaza, también se relee: otra persona pudo haber avanzado la reserva.
        await Promise.all([recargarRes(), recargarInv(), recargarCli()])
      }
    }
    return {
      res,
      remoto: true,
      solicitar: (cot: Cotizacion) => enServidor(() => remoto.solicitarReserva(datos, cot.id, cot.estado)),
      registrarComprobante: (r: Reserva, referencia: string, monto: number | null) => enServidor(() => remoto.registrarComprobante(datos, r, referencia, monto)),
      verificarPago: (id: string, input: ConfirmarInput) => enServidor(() => remoto.verificarPago(datos, id, input.montoRecibido, input.comprobante)),
      aprobar: (id: string, motivo: string) => enServidor(() => remoto.aprobar(datos, id, motivo)),
      anular: (id: string, motivo: string) => enServidor(() => remoto.anular(datos, id, motivo)),
    }
  }

  return {
    res,
    remoto: false,
    solicitar: async (cot: Cotizacion) => aplicar((e) => solicitarReserva(e, cot, actor)),
    registrarComprobante: async () => {},
    verificarPago: async (id: string, input: ConfirmarInput) => aplicar((e) => verificarPagoReserva(e, id, input, actor)),
    aprobar: async (id: string, motivo: string) => aplicar((e) => aprobarReserva(e, id, motivo, actor)),
    anular: async (id: string, motivo: string) => aplicar((e) => anularReserva(e, id, motivo, actor)),
  }
}
