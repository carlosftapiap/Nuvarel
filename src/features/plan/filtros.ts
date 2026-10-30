import type { Actividad, EstadoActividad, Fase, Prioridad } from './model'

export interface Filtros {
  frente: string
  fase: string
  /** id de usuario, 'sin' (sin responsable vinculado) o 'todos' */
  responsable: string
  estado: 'todos' | EstadoActividad
  prioridad: 'todas' | Prioridad | 'sin'
  texto: string
}

export const FILTROS_INICIALES: Filtros = { frente: 'todos', fase: 'todas', responsable: 'todos', estado: 'todos', prioridad: 'todas', texto: '' }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrar(acts: Actividad[], f: Filtros, fases: Fase[]) {
  const frenteDeFase = new Map(fases.map((x) => [x.id, x.frenteId]))
  const q = norm(f.texto.trim())
  return acts.filter((a) => {
    const frente = a.frenteId ?? (a.faseId ? frenteDeFase.get(a.faseId) ?? null : null)
    if (f.frente !== 'todos' && (f.frente === 'sin' ? frente !== null : frente !== f.frente)) return false
    if (f.fase !== 'todas' && a.faseId !== f.fase) return false
    if (f.responsable === 'sin' && a.responsableId) return false
    if (f.responsable !== 'todos' && f.responsable !== 'sin' && a.responsableId !== f.responsable) return false
    if (f.estado !== 'todos' && a.estado !== f.estado) return false
    if (f.prioridad === 'sin' && a.prioridad) return false
    if (f.prioridad !== 'todas' && f.prioridad !== 'sin' && a.prioridad !== f.prioridad) return false
    if (q && !norm(`${a.codigo} ${a.nombre} ${a.responsableTexto ?? ''}`).includes(q)) return false
    return true
  })
}

export const hayFiltros = (f: Filtros) => JSON.stringify(f) !== JSON.stringify(FILTROS_INICIALES)
