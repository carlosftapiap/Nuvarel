/// <reference types="node" />
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import type { Actividad } from '../model'
import {
  avanceExcel, clasificar, ESTADOS_SUGERIDOS, fasesDelArchivo, fechaExcel, leerFilas, mapeoGanttAmura, normalizar, responsablesDelArchivo,
  type OpcionesImportacion,
} from '../importar'

function libro(filas: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet([['ID', 'Actividad', 'Estado', 'Responsable', 'Avance', 'Inicio', 'Fin', 'Grupo', 'Predecesora'], ...filas])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Plan')
  return wb
}

const op = (o: Partial<OpcionesImportacion> = {}): OpcionesImportacion => ({
  hoja: 'Plan', filaEncabezado: 1, avanceComo: 'fraccion', estados: ESTADOS_SUGERIDOS, responsables: { 'Ana Pérez': 'u-ana' },
  fases: { '01 Dirección': '01' }, vaciarConCeldasVacias: false,
  mapeo: { codigo: 'A', nombre: 'B', estado: 'C', responsable: 'D', avance: 'E', inicio: 'F', fin: 'G', fase: 'H', predecesora: 'I' },
  ...o,
})

describe('interpretación explícita de celdas', () => {
  it('fechas de Excel sin desplazamiento por zona horaria', () => {
    expect(fechaExcel(46322)).toBe('2026-10-27')
    expect(fechaExcel('27/10/2026')).toBe('2026-10-27')
    expect(fechaExcel('2026-02-30')).toBeNull()
  })

  it('porcentajes: fracción 0–1 o número 0–100, según se elija', () => {
    expect(avanceExcel(0.5, 'fraccion')).toBe(50)
    expect(avanceExcel(50, 'porcentaje')).toBe(50)
    expect(avanceExcel('50%', 'fraccion')).toBe(50)
    expect(avanceExcel(1.5, 'fraccion')).toBeNull()
    expect(avanceExcel(0, 'fraccion')).toBe(0)
  })
})

describe('vista previa de importación', () => {
  const wb = libro([
    ['D01', 'Confirmar alcance', 'Pendiente', 'Ana Pérez', 0, 46322, 46323, '01 Dirección', null],
    ['D02', 'Asignar responsables', 'Completado', 'Área Comercial', 1, 46322, 46323, '01 Dirección', 'D01'],
    ['D03', 'x', 'Raro', null, 2, 46325, 46322, '99 Otro', 'D03'],
    ['D01', 'Duplicada', 'Pendiente', null, null, null, null, '01 Dirección', null],
  ])

  it('errores identificados por hoja, fila y columna', () => {
    const n = normalizar(leerFilas(wb, op()), op())
    const d03 = n.errores.filter((e) => e.fila === 4)
    expect(d03.map((e) => e.columna).sort()).toEqual(['B', 'C', 'E', 'G', 'H', 'I'])
    expect(n.errores.find((e) => e.fila === 5)?.mensaje).toMatch(/duplicado/)
    expect(n.errores.every((e) => e.hoja === 'Plan')).toBe(true)
  })

  it('no crea usuarios por un nombre: los responsables sin vincular quedan pendientes', () => {
    const n = normalizar(leerFilas(wb, op()), op())
    expect(n.filas[0]).toMatchObject({ responsable_id: 'u-ana', responsable_texto: 'Ana Pérez' })
    expect(n.filas[1]).not.toHaveProperty('responsable_id')
    expect(n.advertencias.get(3)?.join(' ')).toMatch(/sin vincular/)
  })

  it('"Completado" no cierra la actividad: entra en ejecución al 100% con advertencia', () => {
    const n = normalizar(leerFilas(wb, op()), op())
    expect(n.filas[1]).toMatchObject({ estado: 'en_ejecucion', avance: 100 })
    expect(n.advertencias.get(3)?.join(' ')).toMatch(/fecha real de fin/)
  })

  it('las celdas vacías no borran datos salvo selección explícita', () => {
    const vacia = libro([['D01', 'Confirmar alcance', 'Pendiente', null, null, null, null, null, null]])
    expect(normalizar(leerFilas(vacia, op()), op()).filas[0]).not.toHaveProperty('avance')
    expect(normalizar(leerFilas(vacia, op()), op({ vaciarConCeldasVacias: true })).filas[0]).toMatchObject({ avance: null, plan_inicio: null })
  })

  it('clasifica nuevas, actualizadas, sin cambios y con error; no marca ausentes para borrar', () => {
    const ok = libro([
      ['D01', 'Confirmar alcance', 'Pendiente', 'Ana Pérez', 0, 46322, 46323, '01 Dirección', null],
      ['D02', 'Asignar responsables', 'Pendiente', null, 0.5, 46324, 46325, '01 Dirección', 'D01'],
      ['D04', 'Nueva actividad', 'Pendiente', null, 0, 46324, 46325, '01 Dirección', 'D02'],
    ])
    const base = { planId: 'p', descripcion: '', resultadoEsperado: '', tipo: 'actividad', frenteId: null, faseId: 'fase-01', parentId: null, equipoId: null,
      aprobadorTexto: null, baseInicio: null, baseFin: null, realInicio: null, realFin: null, prioridad: null, peso: null, bloqueada: false, motivoBloqueo: null,
      excluidaAlcance: false, requiereEvidencia: false, bloqueaLanzamiento: null, observaciones: '', fuente: '', version: 1, updatedAt: '', updatedBy: null } as const
    const existentes: Actividad[] = [
      { ...base, id: 'x1', codigo: 'D01', nombre: 'Confirmar alcance', estado: 'pendiente', responsableId: 'u-ana', responsableTexto: 'Ana Pérez', responsableExterno: null, avance: 0, planInicio: '2026-10-27', planFin: '2026-10-28' },
      { ...base, id: 'x2', codigo: 'D02', nombre: 'Asignar responsables', estado: 'pendiente', responsableId: null, responsableTexto: null, responsableExterno: null, avance: 0, planInicio: '2026-10-29', planFin: '2026-10-30' },
      { ...base, id: 'x9', codigo: 'D09', nombre: 'Solo en la app', estado: 'pendiente', responsableId: null, responsableTexto: null, responsableExterno: null, avance: null, planInicio: null, planFin: null },
    ]
    const fases = [{ id: 'fase-01', planId: 'p', frenteId: null, codigo: '01', nombre: 'Dirección', orden: 1 }]
    const deps = [{ predecesoraId: 'x1', sucesoraId: 'x2' }]
    const c = clasificar(normalizar(leerFilas(ok, op()), op()), existentes, fases, deps, 'Plan', 'I')
    expect(c.map((x) => [x.codigo, x.clase])).toEqual([['D01', 'sin_cambios'], ['D02', 'actualizada'], ['D04', 'nueva']])
    expect(c[1].cambios.map((x) => x.campo)).toEqual(['avance'])
    expect(c.some((x) => x.codigo === 'D09')).toBe(false)
  })

  it('rechaza ciclos entre el archivo y las dependencias existentes', () => {
    const ciclo = libro([
      ['D01', 'Confirmar alcance', 'Pendiente', null, 0, 46322, 46323, '01 Dirección', 'D02'],
      ['D02', 'Asignar responsables', 'Pendiente', null, 0, 46324, 46325, '01 Dirección', 'D01'],
    ])
    const c = clasificar(normalizar(leerFilas(ciclo, op()), op()), [], [], [], 'Plan', 'I')
    expect(c.every((x) => x.clase === 'error' && /ciclo/.test(x.errores[0].mensaje))).toBe(true)
  })
})

const REAL = 'D:/Empresas/NUVAREL/Gantt_AMURA.xlsx'
describe.skipIf(!fs.existsSync(REAL))('cronograma real Gantt_AMURA.xlsx (solo lectura)', () => {
  it('lee las 147 actividades, 14 grupos y responsables por texto, sin errores bloqueantes con la correspondencia sugerida', () => {
    const wb = XLSX.read(fs.readFileSync(REAL), { type: 'buffer' })
    const m = mapeoGanttAmura()
    const filas = leerFilas(wb, m)
    const grupos = fasesDelArchivo(filas)
    const opciones: OpcionesImportacion = { ...m, estados: ESTADOS_SUGERIDOS, responsables: {}, fases: Object.fromEntries(grupos.map((g) => [g.texto, g.codigo])), vaciarConCeldasVacias: false }
    const n = normalizar(filas, opciones)
    expect(filas).toHaveLength(147)
    expect(grupos).toHaveLength(14)
    expect(responsablesDelArchivo(filas).length).toBeGreaterThan(5)
    expect(n.errores).toEqual([])
    expect(n.filas.find((f) => f.codigo === 'D01')).toMatchObject({ plan_inicio: '2026-10-27', plan_fin: '2026-10-28', avance: 0, fase_codigo: '01' })
    expect(n.filas.filter((f) => f.avance === 100)).toHaveLength(4)
    const c = clasificar(n, [], [], [], m.hoja, 'O')
    expect(c.filter((x) => x.clase === 'error')).toEqual([])
  })
})
