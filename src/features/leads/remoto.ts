import type { Datos } from '@/features/conexion/datos'

/**
 * Captación de leads. La base decide la rotación, la disponibilidad y quién ve qué (alcance de Clientes);
 * la app configura, consulta y calcula indicadores con lo que el usuario puede ver.
 */
export type Fuente = 'web' | 'facebook' | 'instagram'
export type EstadoLead = 'pendiente' | 'asignado' | 'duplicado'
export type EstadoParticipante = 'disponible' | 'fuera_de_horario' | 'vacaciones' | 'pausado' | 'no_participa' | 'no_habilitado'

export const FUENTES: Record<Fuente, string> = { web: 'Página web', facebook: 'Facebook', instagram: 'Instagram' }
export const ESTADO_PARTICIPANTE: Record<EstadoParticipante, { label: string; tono: string }> = {
  disponible: { label: 'Disponible', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  fuera_de_horario: { label: 'Fuera de horario', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
  vacaciones: { label: 'Vacaciones', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  pausado: { label: 'Pausado', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  no_participa: { label: 'No recibe leads', tono: 'bg-slate-50 text-slate-600 ring-slate-200' },
  no_habilitado: { label: 'Cuenta no habilitada', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}
/** Días ISO: 1 = lunes … 7 = domingo. */
export const DIAS: [number, string][] = [[1, 'Lun'], [2, 'Mar'], [3, 'Mié'], [4, 'Jue'], [5, 'Vie'], [6, 'Sáb'], [7, 'Dom']]

export interface Participante {
  userId: string; nombre: string; rol: string; equipo: string | null; activo: boolean; dias: number[]; horaInicio: string; horaFin: string
  vacacionesDesde: string | null; vacacionesHasta: string | null; pausado: boolean; pausaMotivo: string | null; ultimoLeadEn: string | null
  estado: EstadoParticipante; leadsAsignados: number; porContactar: number
}
export interface ConfigParticipante {
  activo: boolean; dias: number[]; hora_inicio: string; hora_fin: string; vacaciones_desde: string | null; vacaciones_hasta: string | null; pausado: boolean; pausa_motivo: string | null
}
export interface Lead {
  id: string; fuente: Fuente; formulario: string | null; nombre: string; telefono: string; email: string; mensaje: string; unidadInteres: string | null
  campana: string | null; anuncio: string | null; pagina: string | null; recibidoEn: string; estado: EstadoLead; clientId: string | null; asignadoA: string | null
  asignadoEn: string | null; asignacion: string | null; primerContactoEn: string | null; primerContactoTipo: string | null
}
export interface ErrorLead { id: string; fuente: string; externoId: string | null; error: string; recibidoEn: string }

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const hora = (v: unknown) => String(v ?? '').slice(0, 5)

export const aLead = (l: Fila): Lead => ({
  id: String(l.id), fuente: l.fuente as Fuente, formulario: s(l.formulario), nombre: String(l.nombre), telefono: String(l.telefono), email: String(l.email ?? ''),
  mensaje: String(l.mensaje ?? ''), unidadInteres: s(l.unidad_interes), campana: s(l.campana), anuncio: s(l.anuncio), pagina: s(l.pagina),
  recibidoEn: String(l.recibido_en), estado: l.estado as EstadoLead, clientId: s(l.client_id), asignadoA: s(l.asignado_a), asignadoEn: s(l.asignado_en),
  asignacion: s(l.asignacion), primerContactoEn: s(l.primer_contacto_en), primerContactoTipo: s(l.primer_contacto_tipo),
})

/** De dónde vino el lead: campaña y anuncio (Facebook, Instagram) o campaña, formulario y página (web). */
export function procedencia(l: Pick<Lead, 'fuente' | 'formulario' | 'campana' | 'anuncio' | 'pagina'>): string {
  const ruta = l.pagina ? l.pagina.replace(/^https?:\/\/[^/]+/, '') || '/' : ''
  const formulario = l.fuente !== 'web' || !l.formulario ? '' : l.formulario === 'whatsapp' ? 'botón de WhatsApp' : `formulario ${l.formulario.replace(/[-_]+/g, ' ')}`
  return [l.campana, l.anuncio, formulario, ruta && `página ${ruta}`].filter(Boolean).join(' · ')
}

export async function cargarDisponibilidad(d: Datos): Promise<Participante[]> {
  const filas = await d.rpc<Fila[]>('leads_disponibilidad')
  return (filas ?? []).map((p) => ({
    userId: String(p.user_id), nombre: String(p.nombre), rol: String(p.rol), equipo: s(p.equipo), activo: p.activo === true,
    dias: ((p.dias as number[]) ?? []).map(Number), horaInicio: hora(p.hora_inicio), horaFin: hora(p.hora_fin),
    vacacionesDesde: s(p.vacaciones_desde), vacacionesHasta: s(p.vacaciones_hasta), pausado: p.pausado === true, pausaMotivo: s(p.pausa_motivo),
    ultimoLeadEn: s(p.ultimo_lead_en), estado: p.estado as EstadoParticipante, leadsAsignados: Number(p.leads_asignados ?? 0), porContactar: Number(p.por_contactar ?? 0),
  }))
}

export const configuracionDe = (p: Participante): ConfigParticipante => ({
  activo: p.activo, dias: p.dias, hora_inicio: p.horaInicio, hora_fin: p.horaFin, vacaciones_desde: p.vacacionesDesde, vacaciones_hasta: p.vacacionesHasta,
  pausado: p.pausado, pausa_motivo: p.pausaMotivo,
})

export const configurarParticipante = (d: Datos, usuario: string, cfg: ConfigParticipante, motivo: string) =>
  d.rpc('leads_configurar_participante', { p_user: usuario, p: cfg, p_motivo: motivo })
export const asignarAhora = (d: Datos) => d.rpc<number>('leads_asignar_ahora')
export const asignarManual = (d: Datos, lead: string, vendedor: string, motivo: string) => d.rpc<string>('leads_asignar_manual', { p_lead: lead, p_vendedor: vendedor, p_motivo: motivo })

/** Leads visibles para quien consulta (la base aplica el alcance). */
export async function cargarLeads(d: Datos, filtros?: Record<string, string | null>): Promise<Lead[]> {
  return (await d.select<Fila>('leads', { filtros, orden: [{ columna: 'recibido_en', asc: false }], limite: 1000 })).map(aLead)
}
export async function cargarErrores(d: Datos): Promise<ErrorLead[]> {
  return (await d.select<Fila>('leads_errores', { orden: [{ columna: 'recibido_en', asc: false }], limite: 50 }))
    .map((e) => ({ id: String(e.id), fuente: String(e.fuente), externoId: s(e.externo_id), error: String(e.error), recibidoEn: String(e.recibido_en) }))
}

/** Prospectos nuevos sin primer contacto de quien consulta (para el aviso del menú). */
export async function contarPorContactar(d: Datos, usuario: string): Promise<number> {
  return (await d.select<Fila>('leads', { filtros: { asignado_a: usuario, primer_contacto_en: null }, limite: 200 })).length
}

/* ---------------------------------------------------------------- indicadores */

export interface Conversion { cotizacion: Set<string>; reserva: Set<string>; venta: Set<string> }
export interface IndicadoresLeads {
  recibidos: number; prospectos: number; consultas: number; pendientes: number; porContactar: number
  horasPrimerContacto: number | null; contactados: number
  conCotizacion: number; conReserva: number; conVenta: number
  porFuente: { clave: Fuente; total: number }[]
  porCampana: { campana: string; total: number; ventas: number }[]
  porVendedor: { id: string; total: number; porContactar: number }[]
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
export const porcentaje = pct

/**
 * Indicadores con los leads visibles. Prospectos: leads que crearon un cliente nuevo; la conversión se mide sobre ellos
 * (cotización, reserva no rechazada y contrato firmado de ese cliente). Las consultas de clientes existentes se cuentan aparte.
 */
export function indicadoresLeads(leads: Lead[], conv: Conversion): IndicadoresLeads {
  const prospectos = leads.filter((l) => l.estado === 'asignado')
  const atendibles = leads.filter((l) => l.estado !== 'pendiente')
  const contactados = atendibles.filter((l) => l.primerContactoEn && l.asignadoEn)
  const horas = contactados.map((l) => (Date.parse(l.primerContactoEn!) - Date.parse(l.asignadoEn!)) / 3_600_000).filter((h) => h >= 0)
  const cuenta = <K extends string>(xs: K[]) => [...xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>())]
  const clientes = (x: Set<string>) => prospectos.filter((l) => l.clientId && x.has(l.clientId)).length
  return {
    recibidos: leads.length, prospectos: prospectos.length, consultas: leads.filter((l) => l.estado === 'duplicado').length,
    pendientes: leads.filter((l) => l.estado === 'pendiente').length,
    porContactar: atendibles.filter((l) => !l.primerContactoEn).length,
    horasPrimerContacto: horas.length ? Math.round((horas.reduce((a, b) => a + b, 0) / horas.length) * 10) / 10 : null,
    contactados: contactados.length,
    conCotizacion: clientes(conv.cotizacion), conReserva: clientes(conv.reserva), conVenta: clientes(conv.venta),
    porFuente: cuenta(leads.map((l) => l.fuente)).map(([clave, total]) => ({ clave, total })).sort((a, b) => b.total - a.total),
    porCampana: cuenta(leads.map((l) => l.campana || 'Sin campaña')).map(([campana, total]) => ({
      campana, total, ventas: prospectos.filter((l) => (l.campana || 'Sin campaña') === campana && l.clientId && conv.venta.has(l.clientId)).length,
    })).sort((a, b) => b.total - a.total),
    porVendedor: cuenta(atendibles.filter((l) => l.asignadoA).map((l) => l.asignadoA!)).map(([id, total]) => ({
      id, total, porContactar: atendibles.filter((l) => l.asignadoA === id && !l.primerContactoEn).length,
    })).sort((a, b) => b.total - a.total),
  }
}

/** Clientes con cotización, con reserva (no rechazada) y con contrato firmado, según lo que el usuario puede ver. */
export async function cargarConversion(d: Datos): Promise<Conversion> {
  const opcional = (t: string) => d.select<Fila>(t, { limite: 5000 }).catch(() => [] as Fila[])
  const [q, r, k] = await Promise.all([opcional('quotes'), opcional('reservations'), opcional('contracts')])
  const ids = (xs: Fila[], ok: (x: Fila) => boolean = () => true) => new Set(xs.filter(ok).map((x) => String(x.client_id)))
  return { cotizacion: ids(q), reserva: ids(r, (x) => x.estado !== 'rechazada'), venta: ids(k, (x) => x.estado === 'firmado') }
}

/** Mensaje inicial editable para escribir por WhatsApp. */
export const mensajeWhatsApp = (cliente: string, vendedor: string) =>
  `Hola ${cliente.split(' ')[0]}, te saluda ${vendedor} de AMURA Apartments. Recibimos tu interés en nuestros departamentos y quiero ayudarte con la información que necesitas. ¿Te puedo llamar ahora o prefieres que conversemos por aquí?`

/** Enlace de WhatsApp con el número en formato internacional y el mensaje. */
export function enlaceWhatsApp(telefono: string, mensaje: string): string | null {
  const d = telefono.replace(/\D/g, '')
  const numero = /^09\d{8}$/.test(d) ? `593${d.slice(1)}` : d
  if (numero.length < 8) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`
}
