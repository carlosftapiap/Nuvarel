import type { Datos } from '@/features/conexion/datos'

/** Mismas reglas que la base (clientes_unicos): la pantalla avisa antes de guardar; la base lo garantiza. */
export type TipoDocumento = 'cedula' | 'ruc' | 'pasaporte'

export function tipoDocumento(doc: string): TipoDocumento | null {
  const d = doc.replace(/[\s.-]/g, '')
  if (!d) return null
  return /^\d{10}$/.test(d) ? 'cedula' : /^\d{13}$/.test(d) ? 'ruc' : 'pasaporte'
}

export function cedulaValida(c: string) {
  if (!/^\d{10}$/.test(c)) return false
  const prov = Number(c.slice(0, 2))
  if (Number(c[2]) >= 6 || ((prov < 1 || prov > 24) && prov !== 30)) return false
  let s = 0
  for (let i = 0; i < 9; i++) {
    const d = Number(c[i]) * (i % 2 === 0 ? 2 : 1)
    s += d > 9 ? d - 9 : d
  }
  return (10 - (s % 10)) % 10 === Number(c[9])
}

/** Error de formato del documento, o null si es válido o está vacío. */
export function errorDocumento(doc: string): string | null {
  const tipo = tipoDocumento(doc)
  const d = doc.replace(/\D/g, '')
  if (tipo === 'cedula' && !cedulaValida(d)) return `La cédula ${doc.trim()} no es válida: revisa los dígitos.`
  if (tipo === 'ruc' && (!/^\d{10}001$/.test(d) || (Number(d[2]) < 6 && !cedulaValida(d.slice(0, 10))))) return `El RUC ${doc.trim()} no es válido: revisa los dígitos.`
  if (tipo === 'pasaporte' && !/^[0-9A-Z]{5,20}$/.test(doc.toUpperCase().replace(/[^0-9A-Z]/g, ''))) return `El pasaporte ${doc.trim()} no es válido.`
  return null
}

export const ETIQUETA_TIPO: Record<TipoDocumento, string> = { cedula: 'Cédula', ruc: 'RUC', pasaporte: 'Pasaporte' }

export interface Existente { mensaje: string; visible: boolean; clienteId: string | null }

/** Busca un cliente con el mismo documento, teléfono o correo. Sin la migración, no avisa (la base tampoco valida). */
export async function buscarExistente(d: Datos, p: { documento?: string; telefono?: string; email?: string; excluir?: string }): Promise<Existente | null> {
  const r = await d.rpc<{ existe: boolean; visible: boolean; cliente_id: string | null; mensaje: string | null }>('clientes_verificar_documento', {
    p_documento: p.documento || null, p_telefono: p.telefono || null, p_email: p.email || null, p_excluir: p.excluir ?? null,
  }).catch(() => null)
  return r?.existe ? { mensaje: r.mensaje ?? 'Este cliente ya se encuentra registrado en AMURA.', visible: r.visible, clienteId: r.cliente_id } : null
}

export const esClienteExistente = (mensaje: string) => /^Este (cliente|celular) ya se encuentra registrado en AMURA/.test(mensaje)

export const solicitarReasignacion = (d: Datos, p: { documento?: string; telefono?: string; email?: string }, motivo: string) =>
  d.rpc<string>('clientes_solicitar_reasignacion', { p_documento: p.documento || null, p_telefono: p.telefono || null, p_email: p.email || null, p_motivo: motivo })

export interface Solicitud { id: string; clientId: string; cliente: string; solicitante: string; asesorActual: string; motivo: string; estado: 'pendiente' | 'aprobada' | 'rechazada'; resolucion: string | null; creadoEn: string; puedeResolver: boolean }

export const cargarSolicitudes = (d: Datos): Promise<Solicitud[] | null> =>
  d.rpc<Record<string, unknown>[]>('clientes_reasignaciones', {}).then((f) => (f ?? []).map((r) => ({
    id: String(r.id), clientId: String(r.client_id), cliente: String(r.cliente), solicitante: String(r.solicitante ?? ''), asesorActual: String(r.asesor_actual ?? ''),
    motivo: String(r.motivo), estado: r.estado as Solicitud['estado'], resolucion: r.resolucion ? String(r.resolucion) : null, creadoEn: String(r.creado_en), puedeResolver: Boolean(r.puede_resolver),
  }))).catch(() => null)

export const resolverSolicitud = (d: Datos, id: string, aprobar: boolean, motivo: string) =>
  d.rpc('clientes_resolver_reasignacion', { p_id: id, p_aprobar: aprobar, p_motivo: motivo })

export interface Trazabilidad {
  creado_por: string | null; creado_en: string; responsable: string | null; equipo: string | null; supervisor: string | null
  reasignaciones: { fecha: string; anterior: string | null; nuevo: string | null; por: string | null; motivo: string | null }[]
  cotizaciones: { numero: string; fecha: string; vendedor: string | null }[]
  reservas: { codigo: string; estado: string; fecha: string; vendedor: string | null }[]
}
export const cargarTrazabilidad = (d: Datos, id: string) => d.rpc<Trazabilidad>('clientes_trazabilidad', { p_client: id }).catch(() => null)
