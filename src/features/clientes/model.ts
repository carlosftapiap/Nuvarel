import type { Rol } from '@/features/inventario/types'

export type Origen = 'instagram' | 'whatsapp' | 'referido' | 'corredor' | 'visita'
export type Proposito = 'vivir' | 'invertir'
export type FormaPago = 'contado' | 'banco' | 'biess'
export type Etapa = 'nuevo' | 'contactado' | 'calificado' | 'visita' | 'cotizacion' | 'negociacion' | 'reserva' | 'perdido' | 'seguimiento'
export type TipoActividad = 'llamada' | 'mensaje' | 'visita' | 'cotizacion' | 'nota' | 'etapa'

export interface Actividad {
  id: string
  tipo: TipoActividad
  /** Fecha en que ocurrió (yyyy-mm-dd). */
  fecha: string
  descripcion: string
  usuario: string
  registradaEn: string
  /** Número de la cotización, en las actividades de tipo cotización. */
  referencia?: string | null
  /** La escribe el servidor al ejecutar la acción: no se envía como actividad aparte. */
  automatica?: boolean
  /** Motivo de una reasignación. */
  motivo?: string
  /** Reasignación: el asesor anterior conserva acceso por autorización expresa. */
  mantenerAcceso?: boolean
}

export interface ProximaActividad {
  tipo: Exclude<TipoActividad, 'etapa' | 'cotizacion'>
  descripcion: string
  fecha: string
}

/** Nombres y apellidos por separado. Vacíos en clientes antiguos hasta completar su ficha. */
export interface NombresCliente {
  primerNombre?: string
  segundoNombre?: string
  primerApellido?: string
  segundoApellido?: string
}

/** Nombre completo con los campos que existan, en el orden de los documentos legales. */
export const nombreCompleto = (n: NombresCliente) =>
  [n.primerNombre, n.segundoNombre, n.primerApellido, n.segundoApellido].map((x) => (x ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' ')

export interface Cliente extends NombresCliente {
  id: string
  /** Nombre completo: lo muestran todos los módulos. */
  nombre: string
  /** Cédula o RUC. */
  documento?: string
  telefono: string
  email: string
  origen: Origen
  /** Quién lo refirió o qué corredor lo trajo. */
  origenDetalle: string
  /** Corredor de origen, si es usuario de la app. Con el origen, define la comisión: no cambia al reasignar. */
  corredorOrigenId?: string | null
  unidadesInteres: string[]
  presupuesto: number | null
  proposito: Proposito | null
  formaPago: FormaPago | null
  /** Responsable actual (identificador de usuario) y su nombre mostrado. */
  asesorId: string
  asesor: string
  /** Atribución de origen: quién captó al cliente. No cambia al reasignar (base para comisiones). */
  atribucion: { usuarioId: string; nombre: string; fecha: string }
  etapa: Etapa
  motivoPerdida: string
  /** Para "Seguimiento futuro": cuándo retomar el contacto. */
  fechaRetomar: string | null
  proxima: ProximaActividad | null
  actividades: Actividad[]
  cotizaciones: string[]
  creadoPor: { id: string; nombre: string; rol: Rol }
  creadoEn: string
  actualizadoEn: string
  /** Versión en la base de datos, para no sobrescribir cambios de otra persona. */
  version?: number
  /** Personas con acceso por autorización expresa (asesores anteriores u otras). */
  accesos?: AccesoCliente[]
  /** Llegó de la base de datos, que ya aplicó el alcance del usuario (RLS). */
  deLaBase?: boolean
}

export interface AccesoCliente {
  usuarioId: string
  nombre: string
  motivo: string
  otorgadoEn: string
}

export interface ClientesState {
  version: 1
  clientes: Cliente[]
}

export const ORIGENES: Record<Origen, string> = {
  instagram: 'Instagram', whatsapp: 'WhatsApp', referido: 'Referido', corredor: 'Corredor', visita: 'Visita directa',
}
export const PROPOSITOS: Record<Proposito, string> = { vivir: 'Para vivir', invertir: 'Para invertir' }
export const FORMAS_PAGO: Record<FormaPago, string> = { contado: 'Contado', banco: 'Crédito bancario', biess: 'BIESS' }
export const TIPOS_ACTIVIDAD: Record<TipoActividad, string> = {
  llamada: 'Llamada', mensaje: 'Mensaje', visita: 'Visita', cotizacion: 'Cotización', nota: 'Nota', etapa: 'Cambio de etapa',
}

/** Embudo principal; "perdido" y "seguimiento" quedan fuera del flujo. */
export const ETAPAS_EMBUDO: Etapa[] = ['nuevo', 'contactado', 'calificado', 'visita', 'cotizacion', 'negociacion', 'reserva']
export const ETAPAS: Record<Etapa, { label: string; color: string }> = {
  nuevo: { label: 'Nuevo', color: '#7b89a1' },
  contactado: { label: 'Contactado', color: '#3563f3' },
  calificado: { label: 'Calificado', color: '#24a6da' },
  visita: { label: 'Visita', color: '#8b5cf6' },
  cotizacion: { label: 'Cotización', color: '#e4a23a' },
  negociacion: { label: 'Negociación', color: '#dc7a29' },
  reserva: { label: 'Reserva', color: '#12a88b' },
  perdido: { label: 'Perdido', color: '#d34259' },
  seguimiento: { label: 'Seguimiento futuro', color: '#65757d' },
}
export const ETAPA_ORDEN: Etapa[] = [...ETAPAS_EMBUDO, 'seguimiento', 'perdido']

/** Negociación concreta de un cliente por una unidad o tipología. Un cliente puede tener varias. */
export type EtapaOportunidad = 'captacion' | 'calificacion' | 'visita' | 'cotizacion' | 'solicitud_reserva' | 'verificacion_pago' | 'aprobacion' | 'contrato' | 'cobranza' | 'entrega' | 'posventa' | 'perdida'

export interface Oportunidad {
  id: string
  clienteId: string
  codigoUnidad: string | null
  tipologia: string | null
  etapa: EtapaOportunidad
  responsableId: string
  motivoPerdida: string | null
  creadaEn: string
}

export const ETAPAS_OPORTUNIDAD: Record<EtapaOportunidad, string> = {
  captacion: 'Captación', calificacion: 'Calificación', visita: 'Visita', cotizacion: 'Cotización', solicitud_reserva: 'Reserva solicitada',
  verificacion_pago: 'Verificando pago', aprobacion: 'Reserva aprobada', contrato: 'Contrato', cobranza: 'Cobranza', entrega: 'Entrega', posventa: 'Posventa', perdida: 'Cerrada',
}

/** Etapas previas a la reserva: se pueden cerrar desde la ficha. Las siguientes las mueve solo el flujo. */
export const OPORTUNIDAD_ABIERTA: EtapaOportunidad[] = ['captacion', 'calificacion', 'visita', 'cotizacion']
