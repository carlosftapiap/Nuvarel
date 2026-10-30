import { describe, expect, it } from 'vitest'
import {
  atrasada, avanceActividad, avanceConsolidado, avanceFrente, duracion, finalizacionTardia, fmtAvance, impactoReprogramacion,
  indiceHijas, indicadores, retrasoBase, semaforo, validarDependencias,
} from '../calculo'
import type { Actividad, Frente } from '../model'

let n = 0
function act(o: Partial<Actividad> = {}): Actividad {
  n++
  return {
    id: `a${n}`, planId: 'p', codigo: `A${String(n).padStart(2, '0')}`, nombre: 'Actividad', descripcion: '', resultadoEsperado: '', tipo: 'actividad',
    frenteId: 'f1', faseId: null, parentId: null, responsableId: 'u1', equipoId: null, responsableTexto: null, aprobadorTexto: null,
    baseInicio: '2026-11-01', baseFin: '2026-11-10', planInicio: '2026-11-01', planFin: '2026-11-10', realInicio: null, realFin: null,
    prioridad: null, peso: 1, avance: 0, estado: 'pendiente', bloqueada: false, motivoBloqueo: null, excluidaAlcance: false, requiereEvidencia: false,
    bloqueaLanzamiento: null, observaciones: '', fuente: '', version: 1, updatedAt: '', updatedBy: null, ...o,
  }
}
const frente = (o: Partial<Frente> = {}): Frente => ({ id: 'f1', planId: 'p', codigo: 'COM', nombre: 'Comercial', orden: 1, peso: null, pesoValidado: false, incluido: true, ...o })

describe('avance ponderado', () => {
  it('pesos 1 y 3 con avances 100% y 0% dan 25%', () => {
    const r = avanceFrente('f1', [act({ peso: 1, avance: 100 }), act({ peso: 3, avance: 0 })])
    expect(r).toMatchObject({ completo: true, valor: 25 })
    expect(fmtAvance(r)).toBe('25%')
  })

  it('padres e hijos no duplican el avance: el padre resume y no se cuenta otra vez', () => {
    const padre = act({ peso: 2, avance: null })
    const h1 = act({ parentId: padre.id, peso: 1, avance: 100 })
    const h2 = act({ parentId: padre.id, peso: 1, avance: 0 })
    const otra = act({ peso: 2, avance: 100 })
    const acts = [padre, h1, h2, otra]
    expect(avanceActividad(padre, indiceHijas(acts)).valor).toBe(50)
    // Frente = (2×50 + 2×100) / 4 = 75. Si se contaran hijas y padre, el resultado sería otro.
    expect(avanceFrente('f1', acts).valor).toBe(75)
  })

  it('un peso o un avance faltante deja el resultado incompleto, sin porcentaje engañoso', () => {
    const sinPeso = avanceFrente('f1', [act({ peso: 1, avance: 100 }), act({ peso: null, avance: 50 })])
    expect(sinPeso).toMatchObject({ completo: false, valor: null })
    expect(sinPeso.faltantes[0].motivo).toBe('sin peso')
    const sinAvance = avanceFrente('f1', [act({ peso: 1, avance: 100 }), act({ peso: 1, avance: null })])
    expect(sinAvance).toMatchObject({ completo: false, valor: null })
    expect(fmtAvance(sinAvance)).toBe('Incompleto')
  })

  it('cero y dato ausente son distintos', () => {
    expect(avanceFrente('f1', [act({ peso: 1, avance: 0 })])).toMatchObject({ completo: true, valor: 0 })
    expect(avanceFrente('f1', [act({ peso: 1, avance: null })])).toMatchObject({ completo: false, valor: null })
  })

  it('una cancelada cuenta hasta que el alcance se modifica de forma autorizada', () => {
    const c = act({ peso: 1, avance: 0, estado: 'cancelada' })
    const ok = act({ peso: 1, avance: 100 })
    expect(avanceFrente('f1', [c, ok]).valor).toBe(50)
    expect(avanceFrente('f1', [{ ...c, excluidaAlcance: true }, ok]).valor).toBe(100)
  })

  it('el consolidado exige pesos definidos y validados en todos los frentes; no reparte pesos iguales', () => {
    const acts = [act({ frenteId: 'f1', avance: 100 }), act({ frenteId: 'f2', avance: 0 })]
    const sinPesos = avanceConsolidado([frente(), frente({ id: 'f2', codigo: 'MKT', nombre: 'Marketing' })], acts)
    expect(sinPesos.completo).toBe(false)
    expect(sinPesos.bloqueos).toContain('Comercial: peso pendiente de definir.')
    const sinValidar = avanceConsolidado([frente({ peso: 1 }), frente({ id: 'f2', nombre: 'Marketing', peso: 3, pesoValidado: true })], acts)
    expect(sinValidar.bloqueos).toContain('Comercial: peso sin validar.')
    const ok = avanceConsolidado([frente({ peso: 1, pesoValidado: true }), frente({ id: 'f2', nombre: 'Marketing', peso: 3, pesoValidado: true })], acts)
    expect(ok).toMatchObject({ completo: true, valor: 25 })
  })
})

describe('fechas y condiciones', () => {
  it('duración en días calendario inclusivos, sin efectos de zona horaria', () => {
    expect(duracion('2026-10-27', '2026-10-27')).toBe(1)
    expect(duracion('2026-10-27', '2026-10-28')).toBe(2)
    expect(duracion('2026-12-31', '2027-01-01')).toBe(2)
    expect(duracion(null, '2026-10-28')).toBeNull()
  })

  it('atraso y semáforo respetan la fecha de corte', () => {
    const a = act({ planFin: '2026-11-10' })
    expect(atrasada(a, '2026-11-10')).toBe(false)
    expect(atrasada(a, '2026-11-11')).toBe(true)
    expect(semaforo(a, '2026-11-11', 7)).toMatchObject({ color: 'rojo' })
    expect(semaforo(a, '2026-11-05', 7)).toMatchObject({ color: 'ambar', texto: 'Vence en 5 d' })
    expect(semaforo(a, '2026-11-01', 7)).toMatchObject({ color: 'verde', texto: 'En plazo' })
    expect(semaforo({ ...a, responsableId: null }, '2026-11-01', 7)).toMatchObject({ color: 'gris' })
    expect(semaforo({ ...a, estado: 'cancelada' }, '2026-12-01', 7)).toMatchObject({ color: 'gris', texto: 'Cancelada' })
    expect(semaforo({ ...a, estado: 'completada', avance: 100, realFin: '2026-11-12' }, '2026-12-01', 7)).toMatchObject({ texto: 'Completada' })
  })

  it('reprogramar no borra el retraso respecto de la línea base', () => {
    const a = act({ baseFin: '2026-11-10', planFin: '2026-11-20' })
    expect(retrasoBase(a)).toBe(10)
    expect(finalizacionTardia({ ...a, estado: 'completada', avance: 100, realFin: '2026-11-15' })).toBe(5)
  })

  it('atrasadas y bloqueadas son condiciones adicionales, no estados excluyentes', () => {
    const acts = [act({ estado: 'en_ejecucion', avance: 30, bloqueada: true, motivoBloqueo: 'Falta firma', planFin: '2026-11-01' })]
    const k = indicadores(acts, '2026-11-05', 7)
    expect(k).toMatchObject({ operativas: 1, enEjecucion: 1, atrasadas: 1, bloqueadas: 1 })
  })

  it('total de actividades operativas sin duplicar padres e hijos', () => {
    const p = act({ avance: null })
    const acts = [p, act({ parentId: p.id }), act({ parentId: p.id }), act()]
    expect(indicadores(acts, '2026-11-01', 7).operativas).toBe(3)
  })
})

describe('dependencias', () => {
  it('rechaza autorreferencias, inexistentes y ciclos', () => {
    const a = act(); const b = act(); const c = act()
    const p = validarDependencias([a, b, c], [
      { predecesoraId: a.id, sucesoraId: a.id },
      { predecesoraId: 'nope', sucesoraId: b.id },
      { predecesoraId: b.id, sucesoraId: c.id },
      { predecesoraId: c.id, sucesoraId: b.id },
    ])
    expect(p.map((x) => x.tipo).sort()).toEqual(['autorreferencia', 'ciclo', 'fechas', 'fechas', 'inexistente'])
  })

  it('detecta incoherencias fin a inicio y muestra el impacto sin mover sucesoras', () => {
    const a = act({ planInicio: '2026-11-01', planFin: '2026-11-05' })
    const b = act({ planInicio: '2026-11-06', planFin: '2026-11-08' })
    const deps = [{ predecesoraId: a.id, sucesoraId: b.id }]
    expect(validarDependencias([a, b], deps)).toEqual([])
    expect(impactoReprogramacion(a.id, '2026-11-07', [a, b], deps).map((x) => x.codigo)).toEqual([b.codigo])
    expect(b.planInicio).toBe('2026-11-06')
  })
})
