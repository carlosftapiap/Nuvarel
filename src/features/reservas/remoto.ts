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
        id: String(r.id), codigo: String(r.codigo), clienteId: String(r.client_id),
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

/** El cliente acepta la cotización y se solicita la reserva. Si la solicitud falla, la aceptación queda registrada y se puede reintentar. */
export async function solicitarReserva(d: Datos, cotizacionId: string, estadoCotizacion: string | undefined) {
  if (estadoCotizacion === 'emitida') await d.rpc('cotizaciones_aceptar', { p_quote: cotizacionId, p_motivo: 'Aceptada por el cliente' })
  await d.rpc('reservas_solicitar', { p_quote_id: cotizacionId })
}

/** El vendedor registra el comprobante, y el monto si difiere del 6% (nunca mayor). Es evidencia: no confirma el pago. */
export async function registrarComprobante(d: Datos, r: Reserva, referencia: string, monto: number | null) {
  if (monto !== null && monto !== r.montoReserva) await d.rpc('reservas_fijar_monto', { p_id: r.id, p_monto: monto, p_motivo: 'Monto de reserva acordado con el cliente' })
  await d.rpc('reservas_adjuntar_comprobante', { p_id: r.id, p_referencia: referencia, p_path: null })
}

export const verificarPago = (d: Datos, id: string, monto: number, referencia: string) =>
  d.rpc('reservas_verificar_pago', { p_id: id, p_monto: monto, p_fecha: hoyGuayaquil(), p_referencia: referencia, p_motivo: 'Ingreso verificado en banco' })
export const aprobar = (d: Datos, id: string, motivo: string) => d.rpc('reservas_aprobar', { p_id: id, p_motivo: motivo })
export const anular = (d: Datos, id: string, motivo: string) => d.rpc('reservas_anular', { p_id: id, p_motivo: motivo })
