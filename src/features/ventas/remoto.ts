import type { Datos } from '@/features/conexion/datos'

/**
 * Ventas y contratos. Lee las tablas del flujo comercial con RLS y no guarda copias: cliente, unidad y condiciones
 * vienen de su módulo responsable. Toda escritura es una función del servidor con permiso, alcance, motivo y auditoría.
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const fecha = (v: unknown) => (v ? String(v).slice(0, 10) : null)
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))

export type EstadoContrato = 'borrador' | 'firmado' | 'anulado'
export type TipoDocumento = 'borrador' | 'contrato_firmado' | 'anexo' | 'escritura' | 'anulacion' | 'otro'
export type TipoHito = 'contrato_firmado' | 'escritura' | 'desembolso' | 'entrega'

export const ESTADO_CONTRATO: Record<EstadoContrato, { label: string; tono: string }> = {
  borrador: { label: 'Pendiente de firma', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  firmado: { label: 'Firmado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulado: { label: 'Anulado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
export const TIPOS_DOCUMENTO: Record<TipoDocumento, string> = {
  borrador: 'Borrador', contrato_firmado: 'Contrato firmado', anexo: 'Anexo', escritura: 'Escritura', anulacion: 'Anulación', otro: 'Otro',
}
export const HITOS: Record<TipoHito, string> = { contrato_firmado: 'Contrato firmado', escritura: 'Escritura', desembolso: 'Desembolso del crédito', entrega: 'Entrega' }
export const ORIGENES_VENTA: Record<string, string> = { instagram: 'Instagram', whatsapp: 'WhatsApp', referido: 'Referido', corredor: 'Corredor', visita: 'Visita directa' }

export interface Documento { id: string; tipo: TipoDocumento; referencia: string; descripcion: string; registradoPor: string; registradoEn: string; retiradoEn: string | null; motivoRetiro: string | null }
export interface Hito { id: string; hito: TipoHito; fecha: string; referencia: string; motivo: string; registradoPor: string; revertidoEn: string | null; motivoReversion: string | null }
export interface Cuota { numero: number; concepto: string; vencimiento: string | null; monto: number; pagado: number; pendiente: number; situacion: string }

/** Condiciones de la cotización aceptada, tal como las fijó el servidor. */
export interface Condiciones { extraordinarias?: { mes: number; monto: number }[]; precioLista: number; descuentoPct: number; reservaPct: number; reserva: number; cuotasTotal: number; meses: number; cuotaMensual: number; ultimaCuota: number; contraEntrega: number; entregaPct: number }

export interface Venta {
  id: string
  codigo: string
  estado: EstadoContrato
  clienteId: string
  /** null si el rol puede ver la venta pero no los datos del cliente. */
  cliente: { nombre: string; documento: string; telefono: string; email: string; formaPago: string | null } | null
  unidad: string
  precio: number
  fechaContrato: string
  fechaFirma: string | null
  firmadoPor: string | null
  anuladoEn: string | null
  anuladoPor: string | null
  motivoAnulacion: string | null
  reservaId: string
  reservaCodigo: string
  reservaEstado: string
  montoReserva: number
  cotizacionId: string
  cotizacionNumero: string
  cotizacionFecha: string | null
  condiciones: Condiciones | null
  /** Fijados al generar el contrato: no cambian con una reasignación. Null en contratos anteriores a guardarlos. */
  asesor: string | null
  responsable: string | null
  atribucion: string | null
  corredorOrigen: string | null
  origen: string | null
  origenDetalle: string | null
  /** Hoy: puede diferir de quien vendió si el cliente se reasignó después. */
  asesorActual: string | null
  documentos: Documento[]
  hitos: Hito[]
  cuotas: Cuota[]
  pagadoVerificado: number
  saldo: number
  simulaciones: string[]
}

export interface ReservaPorContratar {
  id: string
  codigo: string
  clienteNombre: string
  unidad: string
  precio: number
  fechaConfirmacion: string | null
  /** Contrato anulado anterior, si lo hubo. */
  contratoAnulado: string | null
}

export interface DatosVentas { ventas: Venta[]; porContratar: ReservaPorContratar[] }

export async function cargarVentas(d: Datos): Promise<DatosVentas> {
  const [contratos, reservas, cotizaciones, clientes, documentos, hitos, cuotas, balances, simulaciones, personas] = await Promise.all([
    d.select<Fila>('contracts', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] }),
    d.select<Fila>('reservations'),
    d.select<Fila>('quotes'),
    d.select<Fila>('clients'),
    d.select<Fila>('contract_documents', { orden: [{ columna: 'registrado_en', asc: false }] }),
    d.select<Fila>('contract_milestones', { orden: [{ columna: 'fecha' }] }),
    d.select<Fila>('installment_status', { orden: [{ columna: 'numero' }] }),
    d.select<Fila>('contract_balances'),
    d.select<Fila>('mortgage_simulations', { orden: [{ columna: 'created_at', asc: false }] }),
    d.rpc<Fila[]>('contratos_personas'),
  ])
  const nombres = new Map(personas.map((p) => [String(p.id), String(p.nombre)]))
  const nombre = (id: unknown) => (id ? nombres.get(String(id)) ?? 'Otro usuario' : null)
  const reserva = new Map(reservas.map((r) => [String(r.id), r]))
  const cotizacion = new Map(cotizaciones.map((q) => [String(q.id), q]))
  const cliente = new Map(clientes.map((c) => [String(c.id), c]))
  const balance = new Map(balances.map((b) => [String(b.contract_id), b]))
  const de = <T,>(filas: Fila[], id: string, f: (x: Fila) => T) => filas.filter((x) => String(x.contract_id) === id).map(f)

  const ventas = contratos.map((c): Venta => {
    const id = String(c.id)
    const r = reserva.get(String(c.reservation_id))
    const q = r ? cotizacion.get(String(r.quote_id)) : undefined
    const k = cliente.get(String(c.client_id))
    const b = balance.get(id)
    return {
      id, codigo: String(c.codigo), estado: c.estado as EstadoContrato, clienteId: String(c.client_id),
      cliente: k ? { nombre: String(k.nombre), documento: String(k.documento ?? ''), telefono: String(k.telefono ?? ''), email: String(k.email ?? ''), formaPago: s(k.forma_pago) } : null,
      unidad: String(c.codigo_unidad), precio: n(c.precio), fechaContrato: fecha(c.fecha_contrato)!, fechaFirma: fecha(c.fecha_firma), firmadoPor: nombre(c.firmado_por),
      anuladoEn: fecha(c.anulado_en), anuladoPor: nombre(c.anulado_por), motivoAnulacion: s(c.motivo_anulacion),
      reservaId: String(c.reservation_id), reservaCodigo: r ? String(r.codigo) : '—', reservaEstado: r ? String(r.estado) : '', montoReserva: r ? n(r.monto_reserva) : 0,
      cotizacionId: r ? String(r.quote_id) : '', cotizacionNumero: q ? String(q.numero) : '—', cotizacionFecha: q ? fecha(q.fecha) : null,
      condiciones: q ? (q.plan as Condiciones) : null,
      asesor: nombre(c.asesor_id), responsable: nombre(c.responsable_id), atribucion: nombre(c.atribucion_usuario_id), corredorOrigen: nombre(c.corredor_origen_id),
      origen: s(c.origen), origenDetalle: s(c.origen_detalle), asesorActual: k ? nombre(k.asesor_id) : null,
      documentos: de(documentos, id, (x) => ({ id: String(x.id), tipo: x.tipo as TipoDocumento, referencia: String(x.referencia), descripcion: String(x.descripcion ?? ''), registradoPor: nombre(x.registrado_por) ?? 'Sistema', registradoEn: String(x.registrado_en), retiradoEn: s(x.retirado_en), motivoRetiro: s(x.motivo_retiro) })),
      hitos: de(hitos, id, (x) => ({ id: String(x.id), hito: x.hito as TipoHito, fecha: fecha(x.fecha)!, referencia: String(x.referencia ?? ''), motivo: String(x.motivo), registradoPor: nombre(x.registrado_por) ?? 'Sistema', revertidoEn: s(x.revertido_en), motivoReversion: s(x.motivo_reversion) })),
      cuotas: de(cuotas, id, (x) => ({ numero: n(x.numero), concepto: String(x.concepto), vencimiento: fecha(x.vencimiento), monto: n(x.monto), pagado: n(x.pagado), pendiente: n(x.pendiente), situacion: String(x.situacion) })),
      pagadoVerificado: b ? n(b.pagado_verificado) : 0, saldo: b ? n(b.saldo) : n(c.precio),
      simulaciones: simulaciones.filter((m) => String(m.client_id) === String(c.client_id) && String(m.codigo_unidad) === String(c.codigo_unidad)).map((m) => String(m.numero)),
    }
  })

  const conVigente = new Set(ventas.filter((v) => v.estado !== 'anulado').map((v) => v.reservaId))
  const porContratar = reservas
    .filter((r) => r.estado === 'confirmada' && !conVigente.has(String(r.id)))
    .map((r): ReservaPorContratar => ({
      id: String(r.id), codigo: String(r.codigo), clienteNombre: cliente.get(String(r.client_id)) ? String(cliente.get(String(r.client_id))!.nombre) : 'Cliente reservado',
      unidad: String(r.codigo_unidad), precio: n(r.precio_acordado), fechaConfirmacion: fecha(r.fecha_confirmacion),
      contratoAnulado: ventas.find((v) => v.reservaId === String(r.id) && v.estado === 'anulado')?.codigo ?? null,
    }))
  return { ventas, porContratar }
}

export const crearContrato = (d: Datos, reserva: string, fechaContrato: string, motivo: string) => d.rpc<string>('contratos_crear', { p_reservation: reserva, p_fecha: fechaContrato, p_motivo: motivo })
export const formalizar = (d: Datos, id: string, fechaFirma: string, motivo: string, evidencia: string) => d.rpc('contratos_formalizar', { p_id: id, p_fecha: fechaFirma, p_motivo: motivo, p_evidencia: evidencia })
export const registrarDocumento = (d: Datos, id: string, tipo: TipoDocumento, referencia: string, descripcion: string) => d.rpc('contratos_registrar_documento', { p_contract: id, p_tipo: tipo, p_referencia: referencia, p_descripcion: descripcion })
export const retirarDocumento = (d: Datos, id: string, motivo: string) => d.rpc('contratos_retirar_documento', { p_id: id, p_motivo: motivo })
export const registrarHito = (d: Datos, id: string, hito: TipoHito, fechaHito: string, referencia: string, motivo: string) => d.rpc('contratos_registrar_hito', { p_contract: id, p_hito: hito, p_fecha: fechaHito, p_referencia: referencia, p_motivo: motivo })
export const revertirHito = (d: Datos, id: string, motivo: string) => d.rpc('contratos_revertir_hito', { p_id: id, p_motivo: motivo })
export const anular = (d: Datos, id: string, motivo: string, evidencia: string) => d.rpc('contratos_anular', { p_id: id, p_motivo: motivo, p_evidencia: evidencia })

export interface EventoHistorial { fecha: string; accion: string; motivo: string; usuario: string; evidencia: string | null }
export const historial = (d: Datos, id: string) => d.rpc<EventoHistorial[]>('contratos_historial', { p_id: id })
