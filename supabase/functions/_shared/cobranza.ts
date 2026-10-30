/**
 * Lógica de cobranza compartida por la función programada y las pruebas. Sin APIs de Deno ni del navegador.
 * Fechas en yyyy-mm-dd (hora de Ecuador: el servidor pasa "hoy" ya calculado con America/Guayaquil).
 */

export const DIAS_ALERTA = 7
export const MAX_INTENTOS = 3
export const CORREO_DIARIO_HORA_ECUADOR = 8

const redondear = (n: number) => Math.round(n * 100) / 100

/** Días de b menos a. Positivo si b es posterior. */
export function diasEntre(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

export type Situacion = 'pagada' | 'pendiente' | 'por_vencer' | 'vence_hoy' | 'vencida'

export interface CuotaEstado {
  situacion: Situacion
  saldo: number
  pagado: number
  /** Abono parcial: tiene pagos y todavía debe. Puede estar por vencer o vencida. */
  parcial: boolean
  atrasoDias: number
}

/** Estado de una cuota con las mismas reglas que la vista installment_status. */
export function estadoCuota(c: { monto: number; pagado: number; vencimiento: string | null }, hoy: string, diasAlerta = DIAS_ALERTA): CuotaEstado {
  const saldo = redondear(c.monto - c.pagado)
  const parcial = c.pagado > 0 && saldo > 0
  if (saldo <= 0.005) return { situacion: 'pagada', saldo: 0, pagado: c.pagado, parcial: false, atrasoDias: 0 }
  if (!c.vencimiento) return { situacion: 'pendiente', saldo, pagado: c.pagado, parcial, atrasoDias: 0 }
  const dif = diasEntre(hoy, c.vencimiento)
  if (dif < 0) return { situacion: 'vencida', saldo, pagado: c.pagado, parcial, atrasoDias: -dif }
  if (dif === 0) return { situacion: 'vence_hoy', saldo, pagado: c.pagado, parcial, atrasoDias: 0 }
  if (dif <= diasAlerta) return { situacion: 'por_vencer', saldo, pagado: c.pagado, parcial, atrasoDias: 0 }
  return { situacion: 'pendiente', saldo, pagado: c.pagado, parcial, atrasoDias: 0 }
}

/** Reparte pagos verificados en orden de cuota. Lo que no cubre ninguna cuota es saldo a favor. */
export function aplicarPagos(cuotas: { numero: number; monto: number }[], verificado: number) {
  let resto = redondear(verificado)
  const pagado = new Map<number, number>()
  for (const c of [...cuotas].sort((a, b) => a.numero - b.numero)) {
    const p = redondear(Math.max(0, Math.min(c.monto, resto)))
    pagado.set(c.numero, p)
    resto = redondear(resto - p)
  }
  return { pagado, excedente: Math.max(0, resto) }
}

export interface ContratoEntrada {
  id: string
  codigo: string
  cliente: string
  unidad: string
  precio: number
  estado: 'borrador' | 'firmado' | 'anulado'
  responsableEmail: string | null
  responsableNombre: string | null
}
export interface CuotaEntrada { contratoId: string; numero: number; concepto: string; vencimiento: string | null; monto: number }
export interface PagoEntrada { id: string; contratoId: string; monto: number; estado: 'registrado' | 'verificado' | 'rechazado' | 'anulado'; referencia: string; creadoEn: string }
export interface CompromisoEntrada { id: string; contratoId: string; numero: number | null; monto: number; fecha: string; estado: 'pendiente' | 'cumplido' | 'incumplido' | 'cancelado' }
export interface Destinatarios { finanzas: string[]; gerencia: string[]; administracion: string[] }
export interface EntradaCobranza {
  hoy: string
  /** Momento exacto de la consulta (ISO), para medir las 24 horas de los comprobantes. */
  ahora: string
  app: string
  contratos: ContratoEntrada[]
  cuotas: CuotaEntrada[]
  pagos: PagoEntrada[]
  compromisos: CompromisoEntrada[]
  destinatarios: Destinatarios
}

export interface AlertaPlan {
  dedupeKey: string
  contratoId: string | null
  numero: number | null
  tipo: string
  destinatario: string
  asunto: string
  cuerpo: string
}

export interface ResultadoPlan {
  alertas: AlertaPlan[]
  /** Claves "contratoId:numero:" cuyas alertas pendientes deben cancelarse (cuota pagada). */
  cancelarPrefijos: string[]
  /** Compromisos pendientes con fecha vencida: deben pasar a "incumplido". */
  compromisosIncumplidos: string[]
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const usd = (n: number) => n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }

/** Datos del correo. Sin adjuntos: nunca se incluyen documentos personales ni comprobantes. */
function mensaje(c: ContratoEntrada, cuota: CuotaEntrada, estado: CuotaEstado, app: string, titulo: string, hoy: string) {
  const enlace = `${app}/cobranza?contrato=${c.id}`
  const filas: [string, string][] = [
    ['Cliente', c.cliente], ['Departamento', c.unidad], ['Contrato', c.codigo],
    ['Cuota', `${cuota.concepto} (nº ${cuota.numero})`], ['Vencimiento', cuota.vencimiento ? fecha(cuota.vencimiento) : 'Sin fecha'],
    ['Saldo pendiente', `USD ${usd(estado.saldo)}${estado.parcial ? ' (abono parcial recibido)' : ''}`],
    ['Días de atraso', String(estado.atrasoDias)], ['Responsable', c.responsableNombre ?? 'Sin asignar'],
  ]
  const html = `<h2>${esc(titulo)}</h2><table>${filas.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>` +
    `<p><a href="${esc(enlace)}">Abrir el registro en AMURA</a></p><p style="color:#666">Fecha de corte ${fecha(hoy)} (hora de Ecuador).</p>`
  return { html, enlace }
}

/**
 * Decide qué alertas crear hoy. Es idempotente: la clave única evita duplicados aunque la función corra varias veces.
 * Escalamientos a 7 y 15 días de atraso: una sola vez por cuota. Las cuotas pagadas cancelan sus alertas pendientes.
 */
export function planificarCobranza(e: EntradaCobranza): ResultadoPlan {
  const alertas: AlertaPlan[] = []
  const cancelarPrefijos: string[] = []
  const compromisosIncumplidos: string[] = []
  const porContrato = new Map(e.contratos.map((c) => [c.id, c]))
  const verificadoPorContrato = new Map<string, number>()
  for (const p of e.pagos) if (p.estado === 'verificado') verificadoPorContrato.set(p.contratoId, (verificadoPorContrato.get(p.contratoId) ?? 0) + p.monto)

  const enviar = (base: string, tipo: string, contratoId: string | null, numero: number | null, destinos: string[], asunto: string, cuerpo: string) => {
    for (const d of new Set(destinos.map((x) => x.trim().toLowerCase()).filter(Boolean))) {
      alertas.push({ dedupeKey: `${base}|${d}`, contratoId, numero, tipo, destinatario: d, asunto, cuerpo })
    }
  }

  const resumen: string[] = []
  for (const c of e.contratos) {
    if (c.estado !== 'firmado') continue // Antes de firmar nada es exigible: solo se registra el dinero recibido.
    const cs = e.cuotas.filter((x) => x.contratoId === c.id)
    const { pagado } = aplicarPagos(cs, verificadoPorContrato.get(c.id) ?? 0)
    for (const cuota of cs) {
      const est = estadoCuota({ monto: cuota.monto, pagado: pagado.get(cuota.numero) ?? 0, vencimiento: cuota.vencimiento }, e.hoy)
      if (est.situacion === 'pagada') { cancelarPrefijos.push(`${c.id}:${cuota.numero}:`); continue }
      const base = `${c.id}:${cuota.numero}`
      const dif = cuota.vencimiento ? diasEntre(e.hoy, cuota.vencimiento) : null
      const seguimiento = c.responsableEmail ? [c.responsableEmail] : e.destinatarios.administracion
      const cobranza = [...e.destinatarios.finanzas, ...e.destinatarios.administracion]

      if (dif !== null && dif > 0 && (dif === 7 || dif === 3)) {
        const m = mensaje(c, cuota, est, e.app, `Vence en ${dif} días`, e.hoy)
        enviar(`${base}:aviso_${dif}d`, `aviso_${dif}d`, c.id, cuota.numero, seguimiento, `[AMURA] ${cuota.concepto} vence en ${dif} días · ${c.unidad}`, m.html)
      }
      if (dif === 0) {
        const m = mensaje(c, cuota, est, e.app, 'Vence hoy', e.hoy)
        enviar(`${base}:vence_hoy`, 'vence_hoy', c.id, cuota.numero, seguimiento, `[AMURA] ${cuota.concepto} vence hoy · ${c.unidad}`, m.html)
      }
      if (est.situacion === 'vencida') {
        if (est.atrasoDias === 1) {
          const m = mensaje(c, cuota, est, e.app, 'Primer día de atraso', e.hoy)
          enviar(`${base}:primer_atraso`, 'primer_atraso', c.id, cuota.numero, seguimiento, `[AMURA] Atraso de 1 día · ${cuota.concepto} · ${c.unidad}`, m.html)
        }
        if (est.atrasoDias >= 7) {
          const m = mensaje(c, cuota, est, e.app, 'Escalamiento: 7 días de atraso', e.hoy)
          enviar(`${base}:escalamiento_7`, 'escalamiento_7', c.id, cuota.numero, cobranza, `[AMURA] Escalamiento 7 días · ${cuota.concepto} · ${c.unidad}`, m.html)
        }
        if (est.atrasoDias >= 15) {
          const m = mensaje(c, cuota, est, e.app, 'Escalamiento: 15 días de atraso', e.hoy)
          enviar(`${base}:escalamiento_15`, 'escalamiento_15', c.id, cuota.numero, [...e.destinatarios.gerencia, ...cobranza], `[AMURA] Escalamiento 15 días · ${cuota.concepto} · ${c.unidad}`, m.html)
        }
      }
      if (est.situacion === 'por_vencer' || est.situacion === 'vence_hoy' || est.situacion === 'vencida') {
        resumen.push(`${c.cliente} · ${c.unidad} · ${cuota.concepto} · USD ${usd(est.saldo)} · ${est.situacion === 'vencida' ? `atraso ${est.atrasoDias} d` : est.situacion === 'vence_hoy' ? 'vence hoy' : `vence ${fecha(cuota.vencimiento!)}`}`)
      }
    }
  }

  for (const k of e.compromisos) {
    if (k.estado !== 'pendiente' || k.fecha >= e.hoy) continue
    compromisosIncumplidos.push(k.id)
    const c = porContrato.get(k.contratoId)
    if (!c) continue
    const cuerpo = `<h2>Compromiso de pago incumplido</h2><p>${esc(c.cliente)} · ${esc(c.unidad)} · compromiso de USD ${usd(k.monto)} para el ${fecha(k.fecha)}.</p><p><a href="${esc(`${e.app}/cobranza?contrato=${c.id}`)}">Abrir el registro en AMURA</a></p>`
    enviar(`compromiso:${k.id}:incumplido`, 'compromiso_incumplido', c.id, k.numero, c.responsableEmail ? [c.responsableEmail] : e.destinatarios.finanzas, `[AMURA] Compromiso incumplido · ${c.unidad}`, cuerpo)
  }

  const limite = Date.parse(e.ahora) - 24 * 3600 * 1000
  for (const p of e.pagos) {
    if (p.estado !== 'registrado' || Date.parse(p.creadoEn) > limite) continue
    const c = porContrato.get(p.contratoId)
    if (!c) continue
    const cuerpo = `<h2>Comprobante pendiente de verificar</h2><p>${esc(c.cliente)} · ${esc(c.unidad)} · referencia ${esc(p.referencia)} · USD ${usd(p.monto)}, registrado hace más de 24 horas.</p><p><a href="${esc(`${e.app}/cobranza?contrato=${c.id}`)}">Abrir el registro en AMURA</a></p>`
    enviar(`pago:${p.id}:comprobante_24h`, 'comprobante_24h', c.id, null, e.destinatarios.finanzas, `[AMURA] Comprobante sin verificar · ${c.unidad}`, cuerpo)
  }

  // Resumen diario: solo si hay cartera de seguimiento. Un solo correo por destinatario y día.
  if (resumen.length) {
    const cuerpo = `<h2>Resumen de cobranza · ${fecha(e.hoy)}</h2><ul>${resumen.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p><a href="${esc(`${e.app}/cobranza`)}">Abrir cobranza en AMURA</a></p>`
    enviar(`resumen:${e.hoy}`, 'resumen_diario', null, null, [...e.destinatarios.finanzas, ...e.destinatarios.administracion], `[AMURA] Resumen de cobranza · ${fecha(e.hoy)}`, cuerpo)
  }

  return { alertas, cancelarPrefijos, compromisosIncumplidos }
}

/* ----------------------------------------------------------------- correo */

export interface MensajeCorreo { from?: string; to: string; subject: string; html: string }
export interface ProveedorCorreo { enviar(m: MensajeCorreo): Promise<{ id: string }> }

export interface FilaCola { id: string; estado: string; intentos: number; destinatario: string; asunto: string; cuerpo: string }
export interface ActualizacionCola { id: string; estado: 'pendiente' | 'enviada' | 'fallida'; intentos: number; proveedor_id?: string; error?: string; enviada_en?: string }

/**
 * Envía las alertas pendientes. Sin proveedor configurado no envía nada y deja el aviso "pendiente de configuración".
 * Tras MAX_INTENTOS fallos la alerta queda fallida y no se reintenta sola.
 */
export async function enviarPendientes(filas: FilaCola[], proveedor: ProveedorCorreo | null, ahora: string, remitente?: string): Promise<ActualizacionCola[]> {
  const out: ActualizacionCola[] = []
  for (const f of filas) {
    if (f.estado !== 'pendiente') continue
    if (!proveedor) {
      out.push({ id: f.id, estado: 'pendiente', intentos: f.intentos, error: 'Correo pendiente de configuración' })
      continue
    }
    const intento = f.intentos + 1
    try {
      const r = await proveedor.enviar({ from: remitente, to: f.destinatario, subject: f.asunto, html: f.cuerpo })
      out.push({ id: f.id, estado: 'enviada', intentos: intento, proveedor_id: r.id, enviada_en: ahora })
    } catch (err) {
      out.push({ id: f.id, estado: intento >= MAX_INTENTOS ? 'fallida' : 'pendiente', intentos: intento, error: String((err as Error).message).slice(0, 300) })
    }
  }
  return out
}

/** Proveedor Resend. Solo se crea si hay clave, remitente y el envío real está activado. */
export function proveedorResend(apiKey: string, fetchImpl: typeof fetch = fetch): ProveedorCorreo {
  return {
    async enviar(m) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html }),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
      if (!res.ok) throw new Error(`Resend ${res.status}: ${json.message ?? 'error'}`)
      return { id: String(json.id) }
    },
  }
}

/** Proveedor simulado para pruebas y ensayos: no envía nada real. */
export function proveedorSimulado(opciones: { fallos?: number } = {}): ProveedorCorreo & { enviados: MensajeCorreo[] } {
  let fallos = opciones.fallos ?? 0
  const enviados: MensajeCorreo[] = []
  return {
    enviados,
    async enviar(m) {
      if (fallos > 0) { fallos--; throw new Error('Simulado: fallo temporal del proveedor') }
      enviados.push(m)
      return { id: `sim-${enviados.length}` }
    },
  }
}

/** Solo activa el envío real si está explícitamente habilitado y hay clave, remitente y dominio configurados. */
export function configurarProveedor(env: Record<string, string | undefined>): { proveedor: ProveedorCorreo | null; remitente: string | undefined; motivo?: string } {
  if (env.COBRANZA_ENVIO_REAL !== 'true') return { proveedor: null, remitente: undefined, motivo: 'Envío real desactivado (COBRANZA_ENVIO_REAL no es true)' }
  if (!env.RESEND_API_KEY) return { proveedor: null, remitente: undefined, motivo: 'Falta RESEND_API_KEY en el servidor' }
  if (!env.COBRANZA_REMITENTE) return { proveedor: null, remitente: undefined, motivo: 'Falta el dominio remitente (COBRANZA_REMITENTE)' }
  return { proveedor: proveedorResend(env.RESEND_API_KEY), remitente: env.COBRANZA_REMITENTE }
}
