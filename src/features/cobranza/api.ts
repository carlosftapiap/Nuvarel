import type { Datos } from '@/features/conexion/datos'
import type { ContratoFila, CuotaFila, PagoFila } from './tablero'

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
  gestiones: Gestion[]
  compromisos: Compromiso[]
  alertas: Alerta[]
  nombres: Map<string, string>
}

export async function cargarCobranza(d: Datos): Promise<DatosCobranza> {
  const [contratos, cuotas, pagos, gestiones, compromisos, alertas, clientes, personas, oportunidades] = await Promise.all([
    d.select('contracts', { orden: [{ columna: 'codigo' }] }),
    d.select('installments', { orden: [{ columna: 'numero' }] }),
    d.select('payments', { orden: [{ columna: 'registrado_en', asc: false }] }),
    d.select('cobranza_gestiones', { orden: [{ columna: 'fecha', asc: false }] }),
    d.select('cobranza_compromisos', { orden: [{ columna: 'fecha_compromiso' }] }),
    d.select('cobranza_alertas', { orden: [{ columna: 'creada_en', asc: false }], limite: 300 }),
    d.select('clients'),
    d.select('profiles'),
    d.select('opportunities'),
  ])
  const nombres = new Map((personas as Fila[]).map((p) => [String(p.id), String(p.nombre)]))
  const cliente = new Map((clientes as Fila[]).map((c) => [String(c.id), String(c.nombre)]))
  const responsable = new Map((oportunidades as Fila[]).map((o) => [String(o.id), s(o.responsable_id)]))
  return {
    nombres,
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

export const registrarPago = (d: Datos, contrato: string, monto: number, fecha: string, referencia: string, comprobante: string | null) =>
  d.rpc<string>('cobranzas_registrar_pago', { p_contract: contrato, p_monto: monto, p_fecha: fecha, p_referencia: referencia, p_path: comprobante })
export const verificarPago = (d: Datos, pago: string, aprobar: boolean, motivo: string) =>
  d.rpc('cobranzas_verificar_pago', { p_payment: pago, p_aprobar: aprobar, p_motivo: motivo })
export const anularPago = (d: Datos, pago: string, motivo: string) => d.rpc('cobranzas_anular_pago', { p_payment: pago, p_motivo: motivo })
export const reprogramarCuota = (d: Datos, contrato: string, numero: number, fecha: string, motivo: string) =>
  d.rpc('cobranza_reprogramar_cuota', { p_contract: contrato, p_numero: numero, p_nuevo: fecha, p_motivo: motivo })
export const registrarGestion = (d: Datos, contrato: string, numero: number | null, tipo: string, descripcion: string) =>
  d.rpc<string>('cobranza_registrar_gestion', { p_contract: contrato, p_numero: numero, p_tipo: tipo, p_descripcion: descripcion })
export const registrarCompromiso = (d: Datos, contrato: string, numero: number | null, monto: number, fecha: string, motivo: string) =>
  d.rpc<string>('cobranza_registrar_compromiso', { p_contract: contrato, p_numero: numero, p_monto: monto, p_fecha: fecha, p_motivo: motivo })
export const cerrarCompromiso = (d: Datos, id: string, estado: 'cumplido' | 'incumplido' | 'cancelado', motivo: string) =>
  d.rpc('cobranza_cerrar_compromiso', { p_id: id, p_estado: estado, p_motivo: motivo })
