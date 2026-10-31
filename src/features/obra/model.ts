export type CodigoFrente = 'terreno' | 'urbanismo' | 'edificio1' | 'edificio2'
export type EstadoActividad = 'por_programar' | 'programada' | 'en_ejecucion' | 'completada' | 'pausada' | 'cancelada'
export type EstadoAvance = 'pendiente' | 'validado' | 'rechazado'
export type TipoEvidencia = 'foto' | 'informe' | 'acta' | 'plano' | 'reporte' | 'otro'
export type ModoAvance = 'validado' | 'registrado'

export const ESTADO_ACTIVIDAD: Record<EstadoActividad, { label: string; tono: string }> = {
  por_programar: { label: 'Sin iniciar', tono: 'bg-slate-100 text-slate-700 ring-slate-200' },
  programada: { label: 'Programada', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  en_ejecucion: { label: 'En ejecución', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  completada: { label: 'Completada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  pausada: { label: 'Pausada', tono: 'bg-orange-50 text-orange-800 ring-orange-200' },
  cancelada: { label: 'Cancelada', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export const TIPO_EVIDENCIA: Record<TipoEvidencia, string> = {
  foto: 'Fotografía', informe: 'Informe técnico', acta: 'Acta', plano: 'Plano', reporte: 'Reporte', otro: 'Otro documento',
}

export interface Frente {
  id: string
  codigo: CodigoFrente
  nombre: string
  descripcion: string
  contexto: string
  orden: number
  pesosAprobados: boolean
  pesosAprobadosNombre: string | null
  pesosAprobadosEn: string | null
}

export interface Actividad {
  id: string
  frenteId: string
  parentId: string | null
  codigo: string
  nombre: string
  descripcion: string
  orden: number
  peso: number | null
  planInicio: string | null
  planFin: string | null
  realInicio: string | null
  realFin: string | null
  duracionDias: number | null
  responsableId: string | null
  responsableTexto: string
  estado: EstadoActividad
  observaciones: string
  avanceRegistrado: number | null
  avanceValidado: number | null
  ultimoCorteValidado: string | null
  version: number
}

export interface Dependencia { predecesoraId: string; sucesoraId: string }

export interface RegistroAvance {
  id: string
  actividadId: string
  fechaCorte: string
  avance: number
  avanceAnterior: number | null
  observaciones: string
  dificultades: string
  estado: EstadoAvance
  registradoPor: string
  registradoNombre: string
  registradoEn: string
  validadoNombre: string | null
  validadoEn: string | null
  validacionNota: string | null
  responsableNombre: string | null
}

export interface Evidencia {
  id: string
  frenteId: string
  actividadId: string | null
  avanceId: string | null
  tipo: TipoEvidencia
  nombre: string
  descripcion: string
  ruta: string
  mime: string | null
  tamano: number | null
  fecha: string
  cargadoNombre: string
  cargadoEn: string
  retiradoEn: string | null
  retiradoMotivo: string | null
}

export interface ControlTecnico {
  id: string
  frenteId: string
  actividadId: string | null
  fecha: string
  tipo: string
  valor: number | null
  unidad: string
  observaciones: string
  registradoNombre: string
}

/** Fotografía fija de las fechas y ponderaciones aprobadas. Con ella se calcula el avance planificado. */
export interface ItemCronograma { id: string; parentId: string | null; planInicio: string | null; planFin: string | null; peso: number | null }
export interface Cronograma {
  id: string
  frenteId: string
  version: number
  estado: 'aprobado' | 'reemplazado'
  nota: string
  aprobadoNombre: string
  aprobadoEn: string
  actividades: ItemCronograma[]
}

export interface RegistroHistorial {
  id: string
  frenteId: string
  actividadId: string | null
  usuario: string
  accion: string
  motivo: string
  fecha: string
}

/** Lo que ve quien solo consulta el resumen oficial. */
export interface ResumenFrente {
  frenteId: string
  codigo: CodigoFrente
  nombre: string
  descripcion: string
  orden: number
  pesosAprobados: boolean
  avanceValidado: number | null
  ultimoCorte: string | null
  actividades: number
  actividadesConAvance: number
}

export interface DatosObra {
  frentes: Frente[]
  actividades: Actividad[]
  dependencias: Dependencia[]
  avances: RegistroAvance[]
  controles: ControlTecnico[]
  evidencias: Evidencia[]
  cronogramas: Cronograma[]
  historial: RegistroHistorial[]
  personas: { id: string; nombre: string }[]
}

export interface FilaImportada {
  codigo: string
  parent_codigo: string
  nombre: string
  descripcion: string
  peso: number | null
  plan_inicio: string | null
  plan_fin: string | null
  real_inicio: string | null
  real_fin: string | null
  duracion_dias: number | null
  responsable_texto: string
  estado: EstadoActividad
  observaciones: string
}
