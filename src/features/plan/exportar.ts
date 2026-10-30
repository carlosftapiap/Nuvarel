import * as XLSX from 'xlsx'
import { avanceConsolidado, avanceFrente, diaNumero, duracion, retrasoBase, semaforo } from './calculo'
import type { DatosPlan } from './api'
import { ESTADO_ACTIVIDAD, type Actividad } from './model'

/** Fecha como número de serie de Excel (sin hora): evita desplazamientos por zona horaria. */
const serial = (iso: string | null) => (iso ? diaNumero(iso) + 25569 : null)

/**
 * Libro con datos tipados: fechas como fechas, avance y peso como números y códigos estables.
 * Solo incluye lo que el usuario ve (la consulta ya está limitada por su alcance en el servidor).
 */
export function libroPlan(d: DatosPlan, acts: Actividad[], usuario: string): XLSX.WorkBook {
  if (!d.plan) throw new Error('No hay un plan seleccionado.')
  const plan = d.plan
  const personas = new Map(d.personas.map((p) => [p.id, p.nombre]))
  const frente = new Map(d.frentes.map((f) => [f.id, f.nombre]))
  const fase = new Map(d.fases.map((f) => [f.id, f]))
  const porId = new Map(d.actividades.map((a) => [a.id, a]))
  const preds = (id: string) => d.dependencias.filter((x) => x.sucesoraId === id).map((x) => porId.get(x.predecesoraId)?.codigo).filter(Boolean).join('; ')

  const encabezado = ['Código', 'Actividad', 'Tipo', 'Frente', 'Fase', 'Actividad superior', 'Responsable', 'Responsable (texto original)', 'Estado', 'Bloqueada',
    'Avance %', 'Peso', 'Inicio base', 'Fin base', 'Inicio vigente', 'Fin vigente', 'Inicio real', 'Fin real', 'Duración (días)', 'Retraso vs base (días)',
    'Predecesoras', 'Semáforo', 'Descripción', 'Resultado esperado', 'Observaciones', 'Fuente', 'Versión']
  const filas = acts.map((a) => {
    const f = a.faseId ? fase.get(a.faseId) : undefined
    return [
      a.codigo, a.nombre, a.tipo === 'hito' ? 'Hito' : 'Actividad', a.frenteId ? frente.get(a.frenteId) ?? '' : '', f ? `${f.codigo} ${f.nombre}` : '',
      a.parentId ? porId.get(a.parentId)?.codigo ?? '' : '', a.responsableId ? personas.get(a.responsableId) ?? '' : a.responsableExterno ?? '', a.responsableTexto ?? '',
      ESTADO_ACTIVIDAD[a.estado].label, a.bloqueada ? 'Sí' : 'No', a.avance, a.peso,
      serial(a.baseInicio), serial(a.baseFin), serial(a.planInicio), serial(a.planFin), serial(a.realInicio), serial(a.realFin),
      duracion(a.planInicio, a.planFin), retrasoBase(a), preds(a.id), semaforo(a, plan.fechaCorte, plan.alertaDias).texto,
      a.descripcion, a.resultadoEsperado, a.observaciones, a.fuente, a.version,
    ]
  })
  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...filas])
  for (let r = 1; r <= filas.length; r++) {
    for (const c of [12, 13, 14, 15, 16, 17]) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') cell.z = 'dd/mm/yyyy'
    }
    const av = ws[XLSX.utils.encode_cell({ r, c: 10 })]
    if (av && typeof av.v === 'number') av.z = '0.0'
  }
  ws['!cols'] = encabezado.map((h, i) => ({ wch: i === 1 ? 48 : i >= 22 ? 40 : Math.max(10, h.length + 2) }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: filas.length, c: encabezado.length - 1 } }) }

  const cons = avanceConsolidado(d.frentes, d.actividades)
  const wsF = XLSX.utils.aoa_to_sheet([
    ['Frente', 'Peso', 'Peso validado', 'Incluido', 'Avance %', 'Cálculo', 'Actividades consideradas', 'Datos faltantes'],
    ...d.frentes.map((f) => {
      const r = avanceFrente(f.id, d.actividades)
      return [f.nombre, f.peso, f.pesoValidado ? 'Sí' : 'No', f.incluido ? 'Sí' : 'No', r.completo ? Math.round(r.valor! * 10) / 10 : null,
        r.completo ? 'Completo' : 'Incompleto', r.incluidas.join(', '), r.faltantes.map((x) => `${x.codigo} ${x.motivo}`.trim()).join('; ')]
    }),
    [],
    ['Consolidado', null, null, null, cons.completo ? Math.round(cons.valor! * 10) / 10 : null, cons.completo ? 'Completo' : 'No habilitado', '', cons.bloqueos.join(' ')],
  ])
  const wsI = XLSX.utils.aoa_to_sheet([
    ['Plan', plan.nombre], ['Código del plan', plan.codigo], ['Proyecto', plan.projectId], ['Fecha de corte', serial(plan.fechaCorte)],
    ['Exportado por', usuario], ['Exportado el', new Date().toISOString()], ['Actividades exportadas', acts.length],
    ['Convenciones', 'Avance 0–100 (vacío = sin dato). Duración en días calendario inclusivos. Dependencias fin a inicio.'],
  ])
  const corte = wsI.B4
  if (corte) corte.z = 'dd/mm/yyyy'

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Actividades')
  XLSX.utils.book_append_sheet(wb, wsF, 'Avance por frente')
  XLSX.utils.book_append_sheet(wb, wsI, 'Información')
  return wb
}

export function descargarPlan(d: DatosPlan, acts: Actividad[], usuario: string) {
  const wb = libroPlan(d, acts, usuario)
  XLSX.writeFile(wb, `${d.plan!.codigo}_${d.plan!.fechaCorte}.xlsx`)
}
