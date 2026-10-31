import type { Datos } from '@/features/conexion/datos'
import type {
  Actividad, ControlTecnico, Cronograma, DatosObra, Dependencia, EstadoActividad, Evidencia, FilaImportada, Frente, RegistroAvance, RegistroHistorial,
  ResumenFrente, TipoEvidencia,
} from './model'

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const t = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const dia = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 10))

const aFrente = (f: Fila): Frente => ({
  id: String(f.id), codigo: f.codigo as Frente['codigo'], nombre: String(f.nombre), descripcion: t(f.descripcion), contexto: t(f.contexto), orden: Number(f.orden),
  pesosAprobados: f.pesos_aprobados_en !== null && f.pesos_aprobados_en !== undefined, pesosAprobadosNombre: s(f.pesos_aprobados_nombre), pesosAprobadosEn: s(f.pesos_aprobados_en),
})

const aActividad = (a: Fila): Actividad => ({
  id: String(a.id), frenteId: String(a.frente_id), parentId: s(a.parent_id), codigo: String(a.codigo), nombre: String(a.nombre), descripcion: t(a.descripcion),
  orden: Number(a.orden), peso: n(a.peso), planInicio: dia(a.plan_inicio), planFin: dia(a.plan_fin), realInicio: dia(a.real_inicio), realFin: dia(a.real_fin),
  duracionDias: n(a.duracion_dias), responsableId: s(a.responsable_id), responsableTexto: t(a.responsable_texto), estado: a.estado as EstadoActividad,
  observaciones: t(a.observaciones), avanceRegistrado: n(a.avance_registrado), avanceValidado: n(a.avance_validado), ultimoCorteValidado: dia(a.ultimo_corte_validado),
  version: Number(a.version),
})

const aAvance = (r: Fila): RegistroAvance => ({
  id: String(r.id), actividadId: String(r.actividad_id), fechaCorte: String(dia(r.fecha_corte)), avance: Number(r.avance), avanceAnterior: n(r.avance_anterior),
  observaciones: t(r.observaciones), dificultades: t(r.dificultades), estado: r.estado as RegistroAvance['estado'], registradoPor: String(r.registrado_por),
  registradoNombre: String(r.registrado_nombre), registradoEn: String(r.registrado_en), validadoNombre: s(r.validado_nombre), validadoEn: s(r.validado_en), validacionNota: s(r.validacion_nota), responsableNombre: s(r.responsable_nombre),
})

export const aEvidencia = (e: Fila): Evidencia => ({
  id: String(e.id), frenteId: String(e.frente_id), actividadId: s(e.actividad_id), avanceId: s(e.avance_id), tipo: e.tipo as TipoEvidencia, nombre: String(e.nombre),
  descripcion: t(e.descripcion), ruta: String(e.ruta), mime: s(e.mime), tamano: n(e.tamano), fecha: String(dia(e.fecha)), cargadoNombre: String(e.cargado_nombre),
  cargadoEn: String(e.cargado_en), retiradoEn: s(e.retirado_en), retiradoMotivo: s(e.retirado_motivo),
})

const aControl = (c: Fila): ControlTecnico => ({
  id: String(c.id), frenteId: String(c.frente_id), actividadId: s(c.actividad_id), fecha: String(dia(c.fecha)), tipo: String(c.tipo), valor: n(c.valor),
  unidad: t(c.unidad), observaciones: t(c.observaciones), registradoNombre: String(c.registrado_nombre),
})

const aCronograma = (c: Fila): Cronograma => ({
  id: String(c.id), frenteId: String(c.frente_id), version: Number(c.version), estado: c.estado as Cronograma['estado'], nota: t(c.nota),
  aprobadoNombre: String(c.aprobado_nombre), aprobadoEn: String(c.aprobado_en),
  actividades: ((c.actividades as Fila[] | null) ?? []).map((i) => ({
    id: String(i.id), parentId: s(i.parent_id), planInicio: dia(i.plan_inicio), planFin: dia(i.plan_fin), peso: n(i.peso),
  })),
})

const aHistorial = (h: Fila): RegistroHistorial => ({
  id: String(h.id), frenteId: String(h.frente_id), actividadId: s(h.actividad_id), usuario: String(h.usuario), accion: String(h.accion), motivo: String(h.motivo), fecha: String(h.fecha),
})

/** Todo el detalle técnico. Lo que la persona no puede ver, la base no se lo entrega. */
export async function cargarObra(d: Datos): Promise<DatosObra> {
  const [frentes, actividades, dependencias, avances, controles, evidencias, cronogramas, historial, perfiles] = await Promise.all([
    d.select<Fila>('obra_frentes', { orden: [{ columna: 'orden' }] }),
    d.select<Fila>('obra_actividades', { orden: [{ columna: 'orden' }, { columna: 'codigo' }] }),
    d.select<Fila>('obra_dependencias'),
    d.select<Fila>('obra_avances', { orden: [{ columna: 'fecha_corte', asc: false }, { columna: 'registrado_en', asc: false }] }),
    d.select<Fila>('obra_controles', { orden: [{ columna: 'fecha', asc: false }] }),
    d.select<Fila>('obra_evidencias', { orden: [{ columna: 'fecha', asc: false }, { columna: 'cargado_en', asc: false }] }),
    d.select<Fila>('obra_cronogramas', { orden: [{ columna: 'version', asc: false }] }),
    d.select<Fila>('obra_historial', { orden: [{ columna: 'fecha', asc: false }], limite: 500 }),
    d.select<Fila>('profiles', { filtros: { estado: 'activo' }, orden: [{ columna: 'nombre' }] }).catch(() => [] as Fila[]),
  ])
  return {
    frentes: frentes.map(aFrente), actividades: actividades.map(aActividad),
    dependencias: dependencias.map((x): Dependencia => ({ predecesoraId: String(x.predecesora_id), sucesoraId: String(x.sucesora_id) })),
    avances: avances.map(aAvance), controles: controles.map(aControl), evidencias: evidencias.map(aEvidencia), cronogramas: cronogramas.map(aCronograma),
    historial: historial.map(aHistorial), personas: perfiles.map((p) => ({ id: String(p.id), nombre: String(p.nombre) })),
  }
}

/** Avance oficial por frente, para quien solo consulta el resumen. */
export async function cargarResumen(d: Datos): Promise<ResumenFrente[]> {
  const filas = (await d.rpc<Fila[] | null>('obra_resumen')) ?? []
  return filas.map((f) => ({
    frenteId: String(f.frente_id), codigo: f.codigo as ResumenFrente['codigo'], nombre: String(f.nombre), descripcion: t(f.descripcion), orden: Number(f.orden),
    pesosAprobados: Boolean(f.pesos_aprobados), avanceValidado: n(f.avance_validado), ultimoCorte: dia(f.ultimo_corte),
    actividades: Number(f.actividades), actividadesConAvance: Number(f.actividades_con_avance),
  }))
}

/** Informes, actas y planos, para quien tiene documentos pero no el detalle técnico. */
export async function cargarDocumentos(d: Datos): Promise<Evidencia[]> {
  const filas = await d.select<Fila>('obra_evidencias', { orden: [{ columna: 'fecha', asc: false }] })
  return filas.map(aEvidencia)
}

/* ------------------------------------------------------------------ acciones */

export interface DatosActividad {
  codigo: string
  nombre: string
  descripcion: string
  parent_id: string | null
  peso: number | null
  plan_inicio: string | null
  plan_fin: string | null
  real_inicio: string | null
  real_fin: string | null
  duracion_dias: number | null
  responsable_id: string | null
  responsable_texto: string
  estado: EstadoActividad
  observaciones: string
  /** Posición entre sus hermanas; si se omite, se conserva o se pone al final. */
  orden?: number
}

export const datosDeActividad = (a: Actividad): DatosActividad => ({
  codigo: a.codigo, nombre: a.nombre, descripcion: a.descripcion, parent_id: a.parentId, peso: a.peso, plan_inicio: a.planInicio, plan_fin: a.planFin,
  real_inicio: a.realInicio, real_fin: a.realFin, duracion_dias: a.duracionDias, responsable_id: a.responsableId, responsable_texto: a.responsableTexto,
  estado: a.estado, observaciones: a.observaciones, orden: a.orden,
})

export const guardarActividad = (d: Datos, frenteId: string, id: string | null, version: number | null, datos: DatosActividad, motivo: string) =>
  d.rpc<string>('obra_actividad_guardar', { p_frente: frenteId, p_id: id, p_version: version, p_datos: datos, p_motivo: motivo })

export const reordenar = (d: Datos, frenteId: string, cambios: { id: string; parent_id: string | null; orden: number }[], motivo: string) =>
  d.rpc('obra_reordenar', { p_frente: frenteId, p_orden: cambios, p_motivo: motivo })

export const cambiarDependencia = (d: Datos, predecesora: string, sucesora: string, agregar: boolean, motivo: string) =>
  d.rpc('obra_dependencia', { p_pred: predecesora, p_suc: sucesora, p_agregar: agregar, p_motivo: motivo })

export const guardarPesos = (d: Datos, frenteId: string, pesos: { id: string; peso: number | null }[], motivo: string) =>
  d.rpc('obra_pesos', { p_frente: frenteId, p_pesos: pesos, p_motivo: motivo })

export const aprobarPesos = (d: Datos, frenteId: string, motivo: string) => d.rpc('obra_pesos_aprobar', { p_frente: frenteId, p_motivo: motivo })
export const aprobarCronograma = (d: Datos, frenteId: string, motivo: string) => d.rpc<number>('obra_cronograma_aprobar', { p_frente: frenteId, p_motivo: motivo })
export const cargarPlantilla = (d: Datos, frenteId: string, motivo: string) => d.rpc<number>('obra_plantilla_cargar', { p_frente: frenteId, p_motivo: motivo })

/** Lo guardado por un responsable autorizado cuenta de inmediato. */
export const guardarAvance = (d: Datos, a: { actividadId: string; fecha: string; avance: number; responsableId: string | null; responsableTexto: string; observaciones: string }) =>
  d.rpc<string>('obra_avance_guardar', { p_actividad: a.actividadId, p_fecha: a.fecha, p_avance: a.avance, p_responsable: a.responsableId, p_responsable_texto: a.responsableTexto, p_observaciones: a.observaciones })

export const registrarControl = (d: Datos, frenteId: string, actividadId: string | null, fecha: string, tipo: string, valor: number | null, unidad: string, observaciones: string) =>
  d.rpc<string>('obra_control_registrar', { p_frente: frenteId, p_actividad: actividadId, p_fecha: fecha, p_tipo: tipo, p_valor: valor, p_unidad: unidad, p_observaciones: observaciones })

export interface DatosEvidencia {
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
}

export const registrarEvidencia = (d: Datos, e: DatosEvidencia) =>
  d.rpc<string>('obra_evidencia_registrar', {
    p_frente: e.frenteId, p_actividad: e.actividadId, p_avance: e.avanceId, p_tipo: e.tipo, p_nombre: e.nombre, p_descripcion: e.descripcion,
    p_ruta: e.ruta, p_mime: e.mime, p_tamano: e.tamano, p_fecha: e.fecha,
  })

export const retirarEvidencia = (d: Datos, id: string, motivo: string) => d.rpc('obra_evidencia_retirar', { p_id: id, p_motivo: motivo })

export const importarCronograma = (d: Datos, frenteId: string, filas: FilaImportada[], motivo: string) =>
  d.rpc<{ creadas: number; actualizadas: number }>('obra_importar', { p_frente: frenteId, p_filas: filas, p_motivo: motivo })
