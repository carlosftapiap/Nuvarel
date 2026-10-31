import type { Datos } from '@/features/conexion/datos'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { EstadoReserva, Reserva, ReservasState } from './model'

/**
 * Reservas desde Supabase. Lectura con RLS; cada paso es una función del servidor con permiso, alcance,
 * segregación de funciones y auditoría. La unidad y la etapa del cliente las cambia ese flujo, nunca la app.
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const fecha = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export async function cargarReservas(datos: Datos): Promise<ReservasState> {
  const [reservas, cotizaciones, clientes] = await Promise.all([
    datos.select<Fila>('reservations', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] }),
    datos.select<Fila>('quotes'),
    datos.select<Fila>('clients'),
  ])
  const numero = new Map(cotizaciones.map((q) => [String(q.id), String(q.numero)]))
  const cliente = new Map(clientes.map((c) => [String(c.id), c]))
  return {
    version: 1,
    reservas: reservas.map((r): Reserva => {
      const c = cliente.get(String(r.client_id))
      return {
        id: String(r.id), codigo: String(r.codigo), clienteId: String(r.client_id), oportunidadId: s(r.opportunity_id),
        // Un rol de consulta puede ver la reserva sin tener acceso a los datos del cliente.
        clienteNombre: c ? String(c.nombre) : 'Cliente reservado',
        asesorId: c ? String(c.asesor_id) : String(r.created_by), unidad: String(r.codigo_unidad), cotizacionId: String(r.quote_id),
        cotizacionNumero: numero.get(String(r.quote_id)) ?? '—', vigenciaHasta: fecha(r.vigencia_hasta)!, precioAcordado: Number(r.precio_acordado),
        descuentoPct: Number(r.descuento_pct), reservaPct: Number(r.reserva_pct), montoReserva: Number(r.monto_reserva), meses: Number(r.meses), cuotaMensual: Number(r.cuota_mensual),
        estado: (r.estado === 'rechazada' ? 'anulada' : r.estado) as EstadoReserva, comprobante: s(r.comprobante),
        montoRecibido: r.monto_recibido === null || r.monto_recibido === undefined ? null : Number(r.monto_recibido),
        verificadaPor: r.pago_verificado_por ? { id: String(r.pago_verificado_por), nombre: '' } : null, fechaVerificacion: fecha(r.pago_verificado_en),
        aprobadaPor: r.aprobado_por ? { id: String(r.aprobado_por), nombre: '' } : null, fechaConfirmacion: fecha(r.fecha_confirmacion),
        motivoAnulacion: String(r.motivo_anulacion ?? ''), creadaPor: { id: String(r.created_by), nombre: '', rol: '' }, creadaEn: String(r.created_at), historial: [],
      }
    }),
  }
}

/** El cliente acepta la cotización y se crea la solicitud con el monto acordado: una sola transacción en el servidor. Reintentarla no la duplica. No registra pagos. */
export const solicitarReserva = (d: Datos, cotizacionId: string, monto: number) =>
  d.rpc<string>('reservas_solicitar_acordada', { p_quote_id: cotizacionId, p_monto: monto })

/** Monto acordado con el cliente, mientras la reserva está solicitada. El servidor exige que no supere el 6 %. No es un pago. */
export const fijarMonto = (d: Datos, id: string, monto: number) =>
  d.rpc('reservas_fijar_monto', { p_id: id, p_monto: monto, p_motivo: 'Monto de reserva acordado con el cliente' })

/** Finanzas confirma tras verificar el ingreso en el banco. El servidor emite el recibo en la misma operación. */
export const confirmarPago = (d: Datos, id: string, monto: number, referencia: string, verificadoBanco: boolean) =>
  d.rpc<string | null>('reservas_confirmar_pago', { p_id: id, p_monto: monto, p_fecha: hoyGuayaquil(), p_referencia: referencia, p_verificado_banco: verificadoBanco, p_motivo: 'Ingreso verificado en banco' })
export const aprobar = (d: Datos, id: string, motivo: string) => d.rpc('reservas_aprobar', { p_id: id, p_motivo: motivo })
export const anular = (d: Datos, id: string, motivo: string) => d.rpc('reservas_anular', { p_id: id, p_motivo: motivo })
