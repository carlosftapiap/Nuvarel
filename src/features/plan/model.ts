/**
 * Plan de implementación. Convenciones (iguales en la base de datos):
 * - Avance en porcentaje 0–100. `null` significa "sin dato" y es distinto de 0.
 * - Peso positivo; `null` significa "pendiente de definir" (nunca se asume 1 ni pesos iguales).
 * - Fechas como texto aaaa-mm-dd, sin hora ni zona horaria. Duración en días calendario inclusivos.
 * - Dependencias fin a inicio: la sucesora empieza después del día en que termina la predecesora.
 */
export type EstadoActividad = 'pendiente' | 'en_ejecucion' | 'completada' | 'cancelada'
export type TipoActividad = 'actividad' | 'hito'
export type Prioridad = 'alta' | 'media' | 'baja'

export interface Plan {
  id: string
  projectId: string
  codigo: string
  nombre: string
  fechaCorte: string
  alertaDias: number
}

export interface Frente {
  id: string
  planId: string
  codigo: string
  nombre: string
  orden: number
  peso: number | null
  pesoValidado: boolean
  incluido: boolean
}

export interface Fase {
  id: string
  planId: string
  frenteId: string | null
  codigo: string
  nombre: string
  orden: number
}

export interface Actividad {
  id: string
  planId: string
  codigo: string
  nombre: string
  descripcion: string
  resultadoEsperado: string
  tipo: TipoActividad
  frenteId: string | null
  faseId: string | null
  parentId: string | null
  responsableId: string | null
  equipoId: string | null
  responsableTexto: string | null
  aprobadorTexto: string | null
  baseInicio: string | null
  baseFin: string | null
  planInicio: string | null
  planFin: string | null
  realInicio: string | null
  realFin: string | null
  prioridad: Prioridad | null
  peso: number | null
  avance: number | null
  estado: EstadoActividad
  bloqueada: boolean
  motivoBloqueo: string | null
  excluidaAlcance: boolean
  requiereEvidencia: boolean
  bloqueaLanzamiento: boolean | null
  observaciones: string
  fuente: string
  version: number
  updatedAt: string
  updatedBy: string | null
}

export interface Dependencia {
  predecesoraId: string
  sucesoraId: string
}

export interface Evidencia {
  id: string
  activityId: string
  tipo: 'enlace' | 'archivo'
  referencia: string
  descripcion: string
  createdBy: string | null
  createdAt: string
}

export interface Historial {
  id: string
  activityId: string
  fecha: string
  userId: string | null
  accion: string
  motivo: string
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
}

export const ESTADO_ACTIVIDAD: Record<EstadoActividad, { label: string; tone: string }> = {
  pendiente: { label: 'Pendiente', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
  en_ejecucion: { label: 'En ejecución', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  completada: { label: 'Completada', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelada: { label: 'Cancelada', tone: 'bg-zinc-100 text-zinc-500 ring-zinc-200' },
}
