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
}

export interface ProximaActividad {
  tipo: Exclude<TipoActividad, 'etapa' | 'cotizacion'>
  descripcion: string
  fecha: string
}

export interface Cliente {
  id: string
  nombre: string
  telefono: string
  email: string
  origen: Origen
  /** Quién lo refirió o qué corredor lo trajo. */
  origenDetalle: string
  unidadesInteres: string[]
  presupuesto: number | null
  proposito: Proposito | null
  formaPago: FormaPago | null
  asesor: string
  etapa: Etapa
  motivoPerdida: string
  /** Para "Seguimiento futuro": cuándo retomar el contacto. */
  fechaRetomar: string | null
  proxima: ProximaActividad | null
  actividades: Actividad[]
  cotizaciones: string[]
  creadoPor: { nombre: string; rol: Rol }
  creadoEn: string
  actualizadoEn: string
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
