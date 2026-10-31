import { describe, expect, it } from 'vitest'
import { aplanar, avanceActualFrente, avanceFrente, estadoPorAvance, cobertura, desviacion, duracionDias, gruposPesos, modificadaDesdeAprobacion, pesosCompletos, planificadoFrente, planificadoHoja, retrasos } from '../calculos'
import type { Actividad } from '../model'

let n = 0
const act = (p: Partial<Actividad> & { codigo: string }): Actividad => ({
  id: p.id ?? `a${++n}`, frenteId: 'f1', parentId: null, nombre: `Actividad ${p.codigo}`, descripcion: '', orden: n, peso: null, planInicio: null, planFin: null,
  realInicio: null, realFin: null, duracionDias: null, responsableId: null, responsableTexto: '', estado: 'por_programar', observaciones: '',
  avanceRegistrado: null, avanceValidado: null, ultimoCorteValidado: null, version: 1, ...p,
})
const aprobado = { id: 'f1', pesosAprobados: true }
const sinAprobar = { id: 'f1', pesosAprobados: false }

describe('avance físico ponderado', () => {
  // Ejemplo ilustrativo de la definición: cimentación 20 % al 100 %, estructura 30 % al 50 %, resto en 0 → 35 %.
  const ejemplo = () => [
    act({ id: 'c', codigo: 'C', peso: 20, avanceValidado: 100 }),
    act({ id: 'e', codigo: 'E', peso: 30, avanceValidado: 50 }),
    act({ id: 'i', codigo: 'I', peso: 20, avanceValidado: 0 }),
    act({ id: 'a', codigo: 'A', peso: 20 }),
    act({ id: 'p', codigo: 'P', peso: 10 }),
  ]

  it('el ejemplo ilustrativo da 35 %', () => {
    expect(avanceFrente(aprobado, ejemplo(), 'validado')).toBe(35)
  })

  it('sin ponderaciones aprobadas no hay cifra, aunque haya avances', () => {
    expect(avanceFrente(sinAprobar, ejemplo(), 'validado')).toBeNull()
  })

  it('si falta una ponderación tampoco hay cifra', () => {
    const lista = ejemplo(); lista[4] = { ...lista[4], peso: null }
    expect(avanceFrente(aprobado, lista, 'validado')).toBeNull()
  })

  it('un frente sin actividades no tiene avance', () => {
    expect(avanceFrente(aprobado, [], 'validado')).toBeNull()
  })

  it('las subactividades ponderan a su etapa, y la etapa al frente', () => {
    const lista = [
      act({ id: 'e1', codigo: 'E1', peso: 60 }),
      act({ id: 's1', codigo: 'E1.1', parentId: 'e1', peso: 50, avanceValidado: 70 }),
      act({ id: 's2', codigo: 'E1.2', parentId: 'e1', peso: 50, avanceValidado: 40 }),
      act({ id: 'e2', codigo: 'E2', peso: 40, avanceValidado: 100 }),
    ]
    expect(avanceFrente(aprobado, lista, 'validado')).toBe(73) // 0.6 × 55 + 0.4 × 100
  })

  it('lo validado y lo registrado se calculan por separado', () => {
    const lista = [act({ id: 'x', codigo: 'X', peso: 100, avanceValidado: 40, avanceRegistrado: 60 })]
    expect(avanceFrente(aprobado, lista, 'validado')).toBe(40)
    expect(avanceFrente(aprobado, lista, 'registrado')).toBe(60)
  })

  it('una actividad cancelada sale del cálculo', () => {
    const lista = [...ejemplo().slice(0, 4), act({ id: 'p', codigo: 'P', peso: 10, estado: 'cancelada' })]
    expect(avanceFrente(aprobado, lista, 'validado')).toBeCloseTo(38.89, 2)
  })

  it('cada frente se calcula solo con sus actividades', () => {
    const lista = [...ejemplo(), act({ id: 'o', codigo: 'O', frenteId: 'f2', peso: 100, avanceValidado: 100 })]
    expect(avanceFrente(aprobado, lista, 'validado')).toBe(35)
    expect(avanceFrente({ id: 'f2', pesosAprobados: true }, lista, 'validado')).toBe(100)
  })

  it('la cobertura cuenta las hojas con avance validado', () => {
    const lista = [act({ id: 'e1', codigo: 'E1' }), act({ id: 's1', codigo: 'E1.1', parentId: 'e1', avanceValidado: 10 }), act({ id: 's2', codigo: 'E1.2', parentId: 'e1' })]
    expect(cobertura(lista)).toEqual({ hojas: 2, conAvanceValidado: 1 })
  })
})

describe('avance planificado', () => {
  it('reparte el avance en partes iguales entre los días de la actividad', () => {
    expect(planificadoHoja('2027-03-01', '2027-03-10', '2027-02-28')).toBe(0)
    expect(planificadoHoja('2027-03-01', '2027-03-10', '2027-03-05')).toBe(50)
    expect(planificadoHoja('2027-03-01', '2027-03-10', '2027-03-10')).toBe(100)
    expect(planificadoHoja('2027-03-01', '2027-03-10', '2027-04-01')).toBe(100)
  })

  it('sin fechas no se inventa un planificado', () => {
    expect(planificadoHoja(null, '2027-03-10', '2027-03-05')).toBeNull()
    expect(planificadoHoja('2027-03-01', null, '2027-03-05')).toBeNull()
  })

  it('el frente usa el cronograma aprobado y sus ponderaciones', () => {
    const snap = [
      { id: 'a', parentId: null, planInicio: '2027-03-01', planFin: '2027-03-10', peso: 50 },
      { id: 'b', parentId: null, planInicio: '2027-03-11', planFin: '2027-03-20', peso: 50 },
    ]
    expect(planificadoFrente(snap, '2027-03-10')).toBe(50)
    expect(planificadoFrente(snap, '2027-03-15')).toBe(75)
    expect(planificadoFrente([{ ...snap[0], planFin: null }, snap[1]], '2027-03-15')).toBeNull()
    expect(planificadoFrente([{ ...snap[0], peso: null }, snap[1]], '2027-03-15')).toBeNull()
    expect(planificadoFrente([], '2027-03-15')).toBeNull()
  })

  it('la desviación es ejecutado menos planificado, y nula si falta uno', () => {
    expect(desviacion(40, 50)).toBe(-10)
    expect(desviacion(null, 50)).toBeNull()
    expect(desviacion(40, null)).toBeNull()
  })

  it('detecta cambios respecto al cronograma aprobado', () => {
    const a = act({ id: 'a', codigo: 'A', planInicio: '2027-03-01', planFin: '2027-03-10', peso: 50 })
    const snap = [{ id: 'a', parentId: null, planInicio: '2027-03-01', planFin: '2027-03-10', peso: 50 }]
    expect(modificadaDesdeAprobacion(a, snap)).toBe(false)
    expect(modificadaDesdeAprobacion({ ...a, planFin: '2027-03-12' }, snap)).toBe(true)
    expect(modificadaDesdeAprobacion(act({ codigo: 'N' }), snap)).toBe(true)
    expect(modificadaDesdeAprobacion(a, null)).toBe(false)
  })
})

describe('retrasos', () => {
  const hoy = '2027-03-20'
  it('marca el fin vencido sin completar, y el inicio vencido sin arrancar', () => {
    const lista = [
      act({ id: 'fin', codigo: 'F', planInicio: '2027-03-01', planFin: '2027-03-10', estado: 'en_ejecucion', avanceValidado: 60 }),
      act({ id: 'ini', codigo: 'I', planInicio: '2027-03-15', planFin: '2027-04-10', estado: 'programada' }),
      act({ id: 'ok', codigo: 'O', planInicio: '2027-03-01', planFin: '2027-03-10', estado: 'completada', avanceValidado: 100 }),
      act({ id: 'fut', codigo: 'U', planInicio: '2027-04-01', planFin: '2027-04-10', estado: 'programada' }),
      act({ id: 'sin', codigo: 'S' }),
      act({ id: 'canc', codigo: 'C', planFin: '2027-03-10', estado: 'cancelada' }),
    ]
    expect(retrasos(lista, hoy).map((r) => [r.actividad.id, r.tipo, r.dias])).toEqual([['fin', 'fin', 10], ['ini', 'inicio', 5]])
  })

  it('una actividad ya iniciada no cuenta como inicio atrasado', () => {
    const lista = [act({ id: 'x', codigo: 'X', planInicio: '2027-03-01', planFin: '2027-04-10', realInicio: '2027-03-05', estado: 'en_ejecucion' })]
    expect(retrasos(lista, hoy)).toEqual([])
  })

  it('solo cuentan las actividades hoja', () => {
    const lista = [act({ id: 'p', codigo: 'P', planFin: '2027-03-10' }), act({ id: 'h', codigo: 'P.1', parentId: 'p', planFin: '2027-03-10', avanceValidado: 100 })]
    expect(retrasos(lista, hoy)).toEqual([])
  })
})

describe('ponderaciones por nivel', () => {
  it('cada nivel debe sumar 100 %', () => {
    const lista = [
      act({ id: 'a', codigo: 'A', peso: 60 }), act({ id: 'b', codigo: 'B', peso: 40 }),
      act({ id: 'a1', codigo: 'A.1', parentId: 'a', peso: 30 }), act({ id: 'a2', codigo: 'A.2', parentId: 'a', peso: 30 }),
    ]
    const g = gruposPesos(lista)
    expect(g.find((x) => x.parentId === null)).toMatchObject({ suma: 100, completo: true })
    expect(g.find((x) => x.parentId === 'a')).toMatchObject({ suma: 60, completo: false })
    expect(pesosCompletos(lista)).toBe(false)
    expect(pesosCompletos([act({ codigo: 'A', peso: 100 })])).toBe(true)
  })

  it('reconoce el nivel con alguna ponderación pendiente', () => {
    const g = gruposPesos([act({ codigo: 'A', peso: 50 }), act({ codigo: 'B' })])
    expect(g[0]).toMatchObject({ actividades: 2, conPeso: 1, completo: false })
  })

  it('no suma las canceladas', () => {
    expect(pesosCompletos([act({ codigo: 'A', peso: 100 }), act({ codigo: 'B', peso: 20, estado: 'cancelada' })])).toBe(true)
  })
})

describe('fechas y orden de lectura', () => {
  it('la duración cuenta ambos extremos y es nula sin fechas', () => {
    expect(duracionDias('2027-03-01', '2027-03-10')).toBe(10)
    expect(duracionDias('2027-03-01', '2027-03-01')).toBe(1)
    expect(duracionDias(null, '2027-03-01')).toBeNull()
    expect(duracionDias('2027-03-10', '2027-03-01')).toBeNull()
  })

  it('aplana el árbol con cada actividad seguida de sus subactividades y permite ocultar ramas', () => {
    const lista = [
      act({ id: 'b', codigo: 'B', orden: 20 }), act({ id: 'a', codigo: 'A', orden: 10 }),
      act({ id: 'a2', codigo: 'A.2', parentId: 'a', orden: 2 }), act({ id: 'a1', codigo: 'A.1', parentId: 'a', orden: 1 }),
      act({ id: 'c', codigo: 'C', orden: 5, estado: 'cancelada' }),
    ]
    expect(aplanar(lista).map((x) => [x.actividad.codigo, x.nivel])).toEqual([['A', 0], ['A.1', 1], ['A.2', 1], ['B', 0], ['C', 0]])
    expect(aplanar(lista, new Set(['a'])).map((x) => x.actividad.codigo)).toEqual(['A', 'B', 'C'])
  })
})

describe('avance actual', () => {
  const lista = () => [
    act({ id: 'e1', codigo: 'E1', orden: 1 }),
    act({ id: 'a', codigo: 'E1.1', parentId: 'e1', orden: 1, avanceValidado: 100 }),
    act({ id: 'b', codigo: 'E1.2', parentId: 'e1', orden: 2, avanceValidado: 50 }),
    act({ id: 'e2', codigo: 'E2', orden: 2 }),
  ]
  it('sin ponderaciones aprobadas, promedia las etapas; una etapa sin registro cuenta 0', () => {
    expect(avanceActualFrente({ id: 'f1', pesosAprobados: false }, lista())).toBe(37.5)
  })
  it('sin etapas no hay cifra', () => {
    expect(avanceActualFrente({ id: 'f1', pesosAprobados: false }, [])).toBeNull()
  })
  it('el estado coincide con el porcentaje; pausada y cancelada se respetan', () => {
    expect(estadoPorAvance({ estado: 'programada' }, 0)).toBe('por_programar')
    expect(estadoPorAvance({ estado: 'por_programar' }, 1)).toBe('en_ejecucion')
    expect(estadoPorAvance({ estado: 'en_ejecucion' }, 99.9)).toBe('en_ejecucion')
    expect(estadoPorAvance({ estado: 'por_programar' }, 100)).toBe('completada')
    expect(estadoPorAvance({ estado: 'pausada' }, 50)).toBe('pausada')
    expect(estadoPorAvance({ estado: 'cancelada' }, 100)).toBe('cancelada')
  })
})
