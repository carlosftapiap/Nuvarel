import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { almacenPagos, completarRecibo, rechazarPagoReserva, reportarPagoReserva, type DatosPago } from '@/features/cobranza/comprobantes'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { useClientes } from '@/features/clientes/store'
import { RESERVA_PREDETERMINADA } from '@/features/inventario/pricing'
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
  const conexion = useConexion()

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
      recargar: () => Promise.all([recargarRes(), recargarInv(), recargarCli()]),
      solicitar: (cot: Cotizacion, monto?: number) => enServidor(() => remoto.solicitarReserva(datos, cot.id, monto ?? Math.min(RESERVA_PREDETERMINADA, cot.plan.reserva))),
      fijarMonto: (id: string, monto: number) => enServidor(() => remoto.fijarMonto(datos, id, monto)),
      rechazarPago: (id: string, motivo: string) => enServidor(() => rechazarPagoReserva(datos, id, motivo)),
      registrarPago: (r: Reserva, pago: DatosPago) => enServidor(() => reportarPagoReserva(datos, almacenPagos(conexion), r.id, pago)),
      /** Devuelve cómo quedó la reserva: confirmada (condiciones normales) o pago_verificado (excepción para Gerencia). */
      verificarPago: async (id: string, input: ConfirmarInput & { verificadoBanco?: boolean }) => {
        let estado: string | null = null
        await enServidor(async () => {
          const recibo = await remoto.confirmarPago(datos, id, input.montoRecibido, input.comprobante, !!input.verificadoBanco)
          await completarRecibo(datos, almacenPagos(conexion), recibo)
          estado = (await datos.select<{ estado: string }>('reservations', { filtros: { id } }).catch(() => []))[0]?.estado ?? null
        })
        return estado
      },
      aprobar: (id: string, motivo: string) => enServidor(() => remoto.aprobar(datos, id, motivo)),
      anular: (id: string, motivo: string) => enServidor(() => remoto.anular(datos, id, motivo)),
    }
  }

  return {
    res,
    remoto: false,
    recargar: async () => {},
    solicitar: async (cot: Cotizacion, monto?: number) => aplicar((e) => solicitarReserva(e, cot, actor, monto)),
    fijarMonto: async () => {},
    registrarPago: async () => {},
    rechazarPago: async () => {},
    verificarPago: async (id: string, input: ConfirmarInput) => {
      const n = verificarPagoReserva({ inv, res, clientes }, id, input, actor)
      aplicar(() => n)
      return n.res.reservas.find((r) => r.id === id)?.estado ?? null
    },
    aprobar: async (id: string, motivo: string) => aplicar((e) => aprobarReserva(e, id, motivo, actor)),
    anular: async (id: string, motivo: string) => aplicar((e) => anularReserva(e, id, motivo, actor)),
  }
}
