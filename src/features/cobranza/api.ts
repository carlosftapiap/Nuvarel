import type { Datos } from '@/features/conexion/datos'
import type { Reserva } from '@/features/reservas/model'
import { cargarComprobantes, cargarMovimientos, cargarRecibos, type Comprobante, type Movimiento, type Recibo } from './comprobantes'
import { cargarReservas } from '@/features/reservas/remoto'
import type { AplicacionFila, ContratoFila, CuotaFila, PagoFila } from './tablero'

/** Acceso a datos de cobranza. Lecturas con RLS; las escrituras son funciones del servidor con permiso, motivo y auditoría. */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

export interface Gestion { id: string; contratoId: string; numero: number | null; tipo: string; descripcion: string; fecha: string; usuario: string }
export interface Compromiso { id: string; contratoId: string; numero: number | null; monto: number; fecha: string; estado: string }
export interface Alerta { id: string; contratoId: string | null; numero: number | null; tipo: string; destinatario: string; asunto: string; estado: string; intentos: number; error: string | null; creadaEn: string; enviadaEn: string | null }

export interface DatosCobranza {
  contratos: ContratoFila[]
  cuotas: CuotaFila[]
  pagos: PagoFila[]
  /** Excedentes aplicados al saldo contra entrega, también los anulados. */
  aplicaciones: AplicacionFila[]
  gestiones: Gestion[]
  compromisos: Compromiso[]
  alertas: Alerta[]
  nombres: Map<string, string>
  /** null: este perfil no consulta reservas. Son solicitudes y reservas: no son ingresos ni cartera contractual. */
  reservas: Reserva[] | null
  /** Reservas con un contrato que no está anulado. */
  reservasConContrato: Set<string>
  /** Contratos que no están anulados. */
  contratosVigentes: Set<string>
  /** Código de unidad → número de departamento. */
  departamentos: Map<string, string>
  comprobantes: Comprobante[]
  recibos: Recibo[]
  movimientos: Movimiento[]
  /** undefined: no se pudo leer. null: sin definir. */
  receptor: string | null | undefined
  /** Contrato → reserva de la que salió: el pago copiado de la reserva usa su recibo. */
  reservaDeContrato: Map<string, string>
}

export async function cargarCobranza(d: Datos): Promise<DatosCobranza> {
  const [contratos, cuotas, pagos, gestiones, compromisos, alertas, clientes, personas, oportunidades, reservas, unidades, comprobantes, recibos, movimientos, ajustes, aplicaciones] = await Promise.all([
    d.select('contracts', { orden: [{ columna: 'codigo' }] }),
    d.select('installments', { orden: [{ columna: 'numero' }] }),
    d.select('payments', { orden: [{ columna: 'registrado_en', asc: false }] }),
    d.select('cobranza_gestiones', { orden: [{ columna: 'fecha', asc: false }] }),
    d.select('cobranza_compromisos', { orden: [{ columna: 'fecha_compromiso' }] }),
    d.select('cobranza_alertas', { orden: [{ columna: 'creada_en', asc: false }], limite: 300 }),
    d.select('clients'),
    d.select('profiles'),
    d.select('opportunities'),
    cargarReservas(d).then((r) => r.reservas).catch(() => null),
    d.select('inventory_units').catch(() => [] as Fila[]),
    cargarComprobantes(d),
    cargarRecibos(d),
    cargarMovimientos(d),
    d.select<Fila>('payment_settings', { filtros: { id: 1 } }).catch(() => [] as Fila[]),
    cargarAplicaciones(d),
  ])
  const nombres = new Map((personas as Fila[]).map((p) => [String(p.id), String(p.nombre)]))
  const cliente = new Map((clientes as Fila[]).map((c) => [String(c.id), String(c.nombre)]))
  const responsable = new Map((oportunidades as Fila[]).map((o) => [String(o.id), s(o.responsable_id)]))
  const vigentes = (contratos as Fila[]).filter((c) => c.estado !== 'anulado')
  return {
    nombres,
    reservas,
    comprobantes,
    recibos,
    movimientos,
    receptor: ajustes[0] ? s(ajustes[0].receptor) : undefined,
    reservaDeContrato: new Map((contratos as Fila[]).map((c) => [String(c.id), String(c.reservation_id)])),
    reservasConContrato: new Set(vigentes.map((c) => String(c.reservation_id))),
    contratosVigentes: new Set(vigentes.map((c) => String(c.id))),
    departamentos: new Map((unidades as Fila[]).map((u) => [String(u.codigo), String(u.dpt)])),
    contratos: (contratos as Fila[]).map((c) => {
      const r = responsable.get(String(c.opportunity_id)) ?? null
      return {
        id: String(c.id), codigo: String(c.codigo), clientId: String(c.client_id), cliente: cliente.get(String(c.client_id)) ?? 'Cliente',
        unidad: String(c.codigo_unidad), edificio: String(c.codigo_unidad).startsWith('E2') ? 2 : 1,
        responsable: r ? nombres.get(r) ?? 'Sin asignar' : 'Sin asignar', estado: c.estado as ContratoFila['estado'], precio: Number(c.precio),
      }
    }),
    cuotas: (cuotas as Fila[]).map((q) => ({
      contratoId: String(q.contract_id), numero: Number(q.numero), concepto: String(q.concepto),
      vencimiento: s(q.vencimiento)?.slice(0, 10) ?? null, vencimientoOriginal: s(q.vencimiento_original)?.slice(0, 10) ?? null, monto: Number(q.monto),
    })),
    pagos: (pagos as Fila[]).map((p) => ({
      id: String(p.id), contratoId: String(p.contract_id), monto: Number(p.monto), fecha: String(p.fecha).slice(0, 10), referencia: String(p.referencia),
      estado: p.estado as PagoFila['estado'], registradoPor: String(p.registrado_por), registradoEn: String(p.registrado_en), comprobante: s(p.comprobante_path), motivo: s(p.motivo),
    })),
    aplicaciones,
    gestiones: (gestiones as Fila[]).map((g) => ({
      id: String(g.id), contratoId: String(g.contract_id), numero: g.numero_cuota === null ? null : Number(g.numero_cuota), tipo: String(g.tipo),
      descripcion: String(g.descripcion), fecha: String(g.fecha), usuario: nombres.get(String(g.user_id)) ?? 'Usuario',
    })),
    compromisos: (compromisos as Fila[]).map((k) => ({
      id: String(k.id), contratoId: String(k.contract_id), numero: k.numero_cuota === null ? null : Number(k.numero_cuota), monto: Number(k.monto),
      fecha: String(k.fecha_compromiso).slice(0, 10), estado: String(k.estado),
    })),
    alertas: (alertas as Fila[]).map((a) => ({
      id: String(a.id), contratoId: s(a.contract_id), numero: a.numero_cuota === null ? null : Number(a.numero_cuota), tipo: String(a.tipo),
      destinatario: String(a.destinatario), asunto: String(a.asunto), estado: String(a.estado), intentos: Number(a.intentos), error: s(a.error),
      creadaEn: String(a.creada_en), enviadaEn: s(a.enviada_en),
    })),
  }
}

/** Sin la tabla (base anterior a la fase 2) no hay aplicaciones. */
export const cargarAplicaciones = (d: Datos): Promise<AplicacionFila[]> =>
  d.select<Fila>('aplicaciones_excedente', { orden: [{ columna: 'autorizado_en' }] }).then((f) => f.map((a) => ({
    id: String(a.id), contratoId: String(a.contract_id), monto: Number(a.monto), motivo: String(a.motivo), soporteRuta: String(a.soporte_ruta), soporteNombre: s(a.soporte_nombre),
    autorizadoPor: String(a.autorizado_por), autorizadoEn: String(a.autorizado_en), anuladoPor: s(a.anulado_por), anuladoEn: s(a.anulado_en), motivoAnulacion: s(a.motivo_anulacion),
  }))).catch(() => [])

export const anularPago = (d: Datos, pago: string, motivo: string) => d.rpc('cobranzas_anular_pago', { p_payment: pago, p_motivo: motivo })
export const reprogramarCuota = (d: Datos, contrato: string, numero: number, fecha: string, motivo: string) =>
  d.rpc('cobranza_reprogramar_cuota', { p_contract: contrato, p_numero: numero, p_nuevo: fecha, p_motivo: motivo })
export const registrarGestion = (d: Datos, contrato: string, numero: number | null, tipo: string, descripcion: string) =>
  d.rpc<string>('cobranza_registrar_gestion', { p_contract: contrato, p_numero: numero, p_tipo: tipo, p_descripcion: descripcion })
export const registrarCompromiso = (d: Datos, contrato: string, numero: number | null, monto: number, fecha: string, motivo: string) =>
  d.rpc<string>('cobranza_registrar_compromiso', { p_contract: contrato, p_numero: numero, p_monto: monto, p_fecha: fecha, p_motivo: motivo })
export const cerrarCompromiso = (d: Datos, id: string, estado: 'cumplido' | 'incumplido' | 'cancelado', motivo: string) =>
  d.rpc('cobranza_cerrar_compromiso', { p_id: id, p_estado: estado, p_motivo: motivo })
