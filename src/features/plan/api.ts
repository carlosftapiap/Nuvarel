import type { Datos } from '@/features/conexion/datos'
import type { FilaImportacion } from './importar'
import type { Actividad, Dependencia, Evidencia, Fase, Frente, Historial, Plan } from './model'

/** Acceso a datos del plan. Lecturas con RLS; toda escritura pasa por funciones del servidor con permiso, alcance, versión y motivo. */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const fecha = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export const aPlan = (r: Fila): Plan => ({
  id: String(r.id), projectId: String(r.project_id), codigo: String(r.codigo), nombre: String(r.nombre),
  fechaCorte: fecha(r.fecha_corte)!, alertaDias: Number(r.alerta_dias),
})

export const aFrente = (r: Fila): Frente => ({
  id: String(r.id), planId: String(r.plan_id), codigo: String(r.codigo), nombre: String(r.nombre), orden: Number(r.orden),
  peso: n(r.peso), pesoValidado: Boolean(r.peso_validado), incluido: Boolean(r.incluido),
})

export const aFase = (r: Fila): Fase => ({
  id: String(r.id), planId: String(r.plan_id), frenteId: s(r.frente_id), codigo: String(r.codigo), nombre: String(r.nombre), orden: Number(r.orden),
})

export const aActividad = (r: Fila): Actividad => ({
  id: String(r.id), planId: String(r.plan_id), codigo: String(r.codigo), nombre: String(r.nombre), descripcion: String(r.descripcion ?? ''),
  resultadoEsperado: String(r.resultado_esperado ?? ''), tipo: r.tipo === 'hito' ? 'hito' : 'actividad',
  frenteId: s(r.frente_id), faseId: s(r.fase_id), parentId: s(r.parent_id), responsableId: s(r.responsable_id), equipoId: s(r.equipo_id),
  responsableTexto: s(r.responsable_texto), aprobadorTexto: s(r.aprobador_texto),
  baseInicio: fecha(r.base_inicio), baseFin: fecha(r.base_fin), planInicio: fecha(r.plan_inicio), planFin: fecha(r.plan_fin),
  realInicio: fecha(r.real_inicio), realFin: fecha(r.real_fin), prioridad: (s(r.prioridad) as Actividad['prioridad']) ?? null,
  peso: n(r.peso), avance: n(r.avance), estado: r.estado as Actividad['estado'], bloqueada: Boolean(r.bloqueada), motivoBloqueo: s(r.motivo_bloqueo),
  excluidaAlcance: Boolean(r.excluida_alcance), requiereEvidencia: Boolean(r.requiere_evidencia),
  bloqueaLanzamiento: r.bloquea_lanzamiento === null || r.bloquea_lanzamiento === undefined ? null : Boolean(r.bloquea_lanzamiento),
  observaciones: String(r.observaciones ?? ''), fuente: String(r.fuente ?? ''), version: Number(r.version),
  updatedAt: String(r.updated_at ?? ''), updatedBy: s(r.updated_by),
})

export interface Persona {
  id: string
  nombre: string
  email: string
  estado: string
  rolId: string
  equipoId: string | null
}

export interface DatosPlan {
  planes: Plan[]
  plan: Plan | null
  frentes: Frente[]
  fases: Fase[]
  actividades: Actividad[]
  dependencias: Dependencia[]
  personas: Persona[]
  /** Momento de la consulta: los indicadores se calculan sobre este corte de datos. */
  consultadoEn: string
}

/** Carga el plan elegido (o el primero) con todo lo que el usuario puede ver según RLS. */
export async function cargarPlan(d: Datos, planId?: string | null): Promise<DatosPlan> {
  const planes = (await d.select('plan_plans', { orden: [{ columna: 'created_at' }] })).map(aPlan)
  const plan = planes.find((p) => p.id === planId) ?? planes[0] ?? null
  const personas = (await d.select('profiles', { orden: [{ columna: 'nombre' }] })).map((r) => ({
    id: String(r.id), nombre: String(r.nombre), email: String(r.email), estado: String(r.estado), rolId: String(r.rol_id), equipoId: s(r.equipo_id),
  }))
  if (!plan) return { planes, plan: null, frentes: [], fases: [], actividades: [], dependencias: [], personas, consultadoEn: new Date().toISOString() }
  const [frentes, fases, actividades, dependencias] = await Promise.all([
    d.select('plan_frentes', { filtros: { plan_id: plan.id }, orden: [{ columna: 'orden' }] }),
    d.select('plan_fases', { filtros: { plan_id: plan.id }, orden: [{ columna: 'orden' }, { columna: 'codigo' }] }),
    d.select('plan_activities', { filtros: { plan_id: plan.id }, orden: [{ columna: 'codigo' }] }),
    d.select('plan_dependencies', { filtros: { plan_id: plan.id } }),
  ])
  return {
    planes, plan, personas,
    frentes: frentes.map(aFrente), fases: fases.map(aFase), actividades: actividades.map(aActividad),
    dependencias: dependencias.map((r) => ({ predecesoraId: String(r.predecesora_id), sucesoraId: String(r.sucesora_id) })),
    consultadoEn: new Date().toISOString(),
  }
}

export async function historial(d: Datos, activityId: string): Promise<Historial[]> {
  const rows = await d.select('plan_history', { filtros: { activity_id: activityId }, orden: [{ columna: 'fecha', asc: false }] })
  return rows.map((r) => ({
    id: String(r.id), activityId: String(r.activity_id), fecha: String(r.fecha), userId: s(r.user_id), accion: String(r.accion), motivo: String(r.motivo),
    antes: (r.antes as Historial['antes']) ?? null, despues: (r.despues as Historial['despues']) ?? null,
  }))
}

export async function evidencias(d: Datos, activityId: string): Promise<Evidencia[]> {
  const rows = await d.select('plan_evidences', { filtros: { activity_id: activityId }, orden: [{ columna: 'created_at', asc: false }] })
  return rows.map((r) => ({
    id: String(r.id), activityId: String(r.activity_id), tipo: r.tipo === 'archivo' ? 'archivo' : 'enlace', referencia: String(r.referencia),
    descripcion: String(r.descripcion ?? ''), createdBy: s(r.created_by), createdAt: String(r.created_at),
  }))
}

/* ------------------------------------------------------------- escrituras */

export const crearPlan = (d: Datos, p: { proyecto: string; codigo: string; nombre: string; fechaCorte: string }) =>
  d.rpc<string>('plan_crear', { p_project: p.proyecto, p_codigo: p.codigo, p_nombre: p.nombre, p_fecha_corte: p.fechaCorte })

export const configurarPlan = (d: Datos, planId: string, fechaCorte: string, alertaDias: number, motivo: string) =>
  d.rpc('plan_configurar', { p_plan: planId, p_fecha_corte: fechaCorte, p_alerta_dias: alertaDias, p_motivo: motivo })

export const pesoFrente = (d: Datos, frenteId: string, peso: number | null, validado: boolean, incluido: boolean, motivo: string) =>
  d.rpc('plan_frente_peso', { p_frente: frenteId, p_peso: peso, p_validado: validado, p_incluido: incluido, p_motivo: motivo })

export const guardarFase = (d: Datos, planId: string, codigo: string, nombre: string, frenteId: string | null, orden: number) =>
  d.rpc<string>('plan_fase_guardar', { p_plan: planId, p_codigo: codigo, p_nombre: nombre, p_frente: frenteId, p_orden: orden })

export const actualizarAvance = (d: Datos, a: Pick<Actividad, 'id' | 'version'>, avance: number | null, motivo: string | null, realInicio: string | null = null) =>
  d.rpc('plan_actividad_avance', { p_id: a.id, p_version: a.version, p_avance: avance, p_real_inicio: realInicio, p_motivo: motivo })

export const reprogramar = (d: Datos, a: Pick<Actividad, 'id' | 'version'>, inicio: string, fin: string, motivo: string) =>
  d.rpc('plan_actividad_reprogramar', { p_id: a.id, p_version: a.version, p_inicio: inicio, p_fin: fin, p_motivo: motivo })

export const impacto = (d: Datos, id: string, fin: string) =>
  d.rpc<{ codigo: string; nombre: string; plan_inicio: string | null; conflicto: boolean }[]>('plan_impacto', { p_id: id, p_fin: fin })

export const asignar = (d: Datos, a: Pick<Actividad, 'id' | 'version'>, responsableId: string | null, motivo: string) =>
  d.rpc('plan_actividad_asignar', { p_id: a.id, p_version: a.version, p_responsable: responsableId, p_equipo: null, p_colaboradores: null, p_motivo: motivo })

export const pesoActividad = (d: Datos, a: Pick<Actividad, 'id' | 'version'>, peso: number | null, motivo: string) =>
  d.rpc('plan_actividad_peso', { p_id: a.id, p_version: a.version, p_peso: peso, p_motivo: motivo })

export type AccionEstado = 'cerrar' | 'reabrir' | 'cancelar' | 'excluir' | 'incluir' | 'bloquear' | 'desbloquear'
export const cambiarEstado = (d: Datos, a: Pick<Actividad, 'id' | 'version'>, accion: AccionEstado, fecha: string | null, motivo: string) =>
  d.rpc('plan_actividad_estado', { p_id: a.id, p_version: a.version, p_accion: accion, p_fecha: fecha, p_motivo: motivo })

export const editarActividad = (d: Datos, planId: string, a: Pick<Actividad, 'id' | 'version'> | null, datos: Record<string, unknown>, motivo: string) =>
  d.rpc<string>('plan_actividad_guardar', { p_plan: planId, p_id: a?.id ?? null, p_version: a?.version ?? null, p_datos: datos, p_motivo: motivo })

export const dependencia = (d: Datos, predecesoraId: string, sucesoraId: string, agregar: boolean, motivo: string) =>
  d.rpc('plan_dependencia', { p_pred: predecesoraId, p_suc: sucesoraId, p_agregar: agregar, p_motivo: motivo })

export const agregarEvidencia = (d: Datos, activityId: string, referencia: string, descripcion: string) =>
  d.rpc<string | null>('plan_evidencia', { p_id: activityId, p_tipo: 'enlace', p_referencia: referencia, p_descripcion: descripcion })

export const importar = (d: Datos, planId: string, archivo: string, hoja: string, filas: FilaImportacion[]) =>
  d.rpc<{ import_id: string; nuevas: number; actualizadas: number; sin_cambios: number }>('plan_importar', { p_plan: planId, p_archivo: archivo, p_hoja: hoja, p_filas: filas })
