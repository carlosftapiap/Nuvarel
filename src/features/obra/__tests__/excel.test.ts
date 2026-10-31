import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { clasificar, ENCABEZADOS, leerCronograma, leerFecha, libroABuffer, libroCronograma, nombreArchivo } from '../excel'
import type { Actividad, Frente } from '../model'

const frente: Frente = { id: 'f1', codigo: 'edificio1', nombre: 'Edificio 1', descripcion: '', contexto: '', orden: 3, pesosAprobados: false, pesosAprobadosNombre: null, pesosAprobadosEn: null }
let n = 0
const act = (p: Partial<Actividad> & { codigo: string }): Actividad => ({
  id: p.id ?? `a${++n}`, frenteId: 'f1', parentId: null, nombre: `Actividad ${p.codigo}`, descripcion: '', orden: ++n, peso: null, planInicio: null, planFin: null,
  realInicio: null, realFin: null, duracionDias: null, responsableId: null, responsableTexto: '', estado: 'por_programar', observaciones: '',
  avanceRegistrado: null, avanceValidado: null, ultimoCorteValidado: null, version: 1, ...p,
})

/** Arma un archivo con las columnas indicadas. */
function archivo(filas: unknown[][], encabezado: readonly string[] = ENCABEZADOS, hoja = 'Cronograma'): ArrayBuffer {
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([[...encabezado], ...filas]), hoja)
  return libroABuffer(libro)
}

describe('fechas de Excel', () => {
  it('acepta serie de Excel, ISO y dd/mm/aaaa; las vacías son nulas y las inválidas se detectan', () => {
    expect(leerFecha(46450)).toBe('2027-03-04')
    expect(leerFecha('2027-03-04')).toBe('2027-03-04')
    expect(leerFecha('04/03/2027')).toBe('2027-03-04')
    expect(leerFecha('4-3-2027')).toBe('2027-03-04')
    expect(leerFecha('')).toBeNull()
    expect(leerFecha(null)).toBeNull()
    expect(leerFecha('31/02/2027')).toBeUndefined()
    expect(leerFecha('mañana')).toBeUndefined()
    expect(leerFecha(-5)).toBeUndefined()
  })
})

describe('leer el cronograma', () => {
  it('lee las columnas por nombre, deja las fechas vacías y calcula la duración', () => {
    const r = leerCronograma(archivo([
      ['E-01', '', 'Preparación', 'Replanteo y obras provisionales', 20, '01/03/2027', '10/03/2027', null, null, null, 'Contratista Andes', 'Programada', ''],
      ['E-01.1', 'E-01', 'Replanteo', '', 100, null, null, null, null, 5, '', '', 'Sin fechas'],
    ]))
    expect(r.errores).toEqual([])
    expect(r.filas).toHaveLength(2)
    expect(r.filas[0]).toMatchObject({ codigo: 'E-01', nombre: 'Preparación', peso: 20, plan_inicio: '2027-03-01', plan_fin: '2027-03-10', duracion_dias: 10, estado: 'programada', responsable_texto: 'Contratista Andes', fila: 2 })
    expect(r.filas[1]).toMatchObject({ codigo: 'E-01.1', parent_codigo: 'E-01', plan_inicio: null, plan_fin: null, duracion_dias: 5, estado: 'por_programar' })
  })

  it('informa todos los errores con su fila y no deja pasar datos dudosos', () => {
    const r = leerCronograma(archivo([
      ['', '', 'Sin código', '', null, null, null, null, null, null, '', '', ''],
      ['A-1', '', 'ok', '', 50, null, null, null, null, null, '', '', ''],
      ['A-1', '', 'Repetida', '', 50, null, null, null, null, null, '', '', ''],
      ['A-2', '', 'Peso malo', '', 150, '10/03/2027', '01/03/2027', null, null, null, '', 'Inventado', ''],
      ['A-3', 'NO-EXISTE', 'Padre ausente', '', null, 'cuando se pueda', null, null, null, null, '', '', ''],
    ]))
    const por = (f: number) => r.errores.filter((e) => e.fila === f).map((e) => e.mensaje).join(' | ')
    expect(por(2)).toMatch(/Falta el código/)
    expect(por(3)).toMatch(/nombre/)
    expect(por(4)).toMatch(/repetido/)
    expect(por(5)).toMatch(/entre 0 y 100/)
    expect(por(5)).toMatch(/anterior al inicio/)
    expect(por(5)).toMatch(/estado «Inventado»/)
    expect(por(6)).toMatch(/superior «NO-EXISTE» no existe/)
    expect(por(6)).toMatch(/no es válida/)
  })

  it('acepta una superior que ya existe en la base y una ponderación con formato de porcentaje', () => {
    const libro = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([[...ENCABEZADOS], ['B-1', 'EXISTE', 'Con superior existente', '', 0.2, null, null, null, null, null, '', '', '']])
    ws[XLSX.utils.encode_cell({ r: 1, c: 4 })].z = '0%'
    XLSX.utils.book_append_sheet(libro, ws, 'Cronograma')
    const r = leerCronograma(libroABuffer(libro), new Set(['EXISTE']))
    expect(r.errores).toEqual([])
    expect(r.filas[0].peso).toBe(20)
  })

  it('rechaza archivos sin encabezado, vacíos o que no son Excel', () => {
    expect(() => leerCronograma(archivo([['x']], ['Algo', 'Otro']))).toThrow(/No se encontró el encabezado/)
    expect(() => leerCronograma(archivo([]))).toThrow(/no tiene actividades/)
    expect(() => leerCronograma(new TextEncoder().encode('esto no es un libro').buffer)).toThrow()
  })

  it('reconoce el encabezado aunque esté más abajo y los títulos con otras mayúsculas o sin acentos', () => {
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Cronograma del Edificio 1'], [], ['CODIGO', 'actividad', 'inicio previsto'], ['Z-1', 'Actividad Z', '15/05/2027']]), 'Hoja1')
    const r = leerCronograma(libroABuffer(libro))
    expect(r.errores).toEqual([])
    expect(r.filas[0]).toMatchObject({ codigo: 'Z-1', plan_inicio: '2027-05-15', fila: 4 })
  })
})

describe('exportar y volver a importar', () => {
  it('el libro exportado se importa tal cual, con jerarquía y fechas, sin errores ni cambios', () => {
    const lista = [
      act({ id: 'e1', codigo: 'E-01', nombre: 'Cimentación', peso: 60, planInicio: '2027-03-01', planFin: '2027-03-31', duracionDias: 31, estado: 'programada', orden: 10 }),
      act({ id: 's1', codigo: 'E-01.1', parentId: 'e1', nombre: 'Excavación', peso: 100, orden: 1, avanceValidado: 40, avanceRegistrado: 50 }),
      act({ id: 'e2', codigo: 'E-02', nombre: 'Estructura', peso: 40, orden: 20, observaciones: 'Pendiente de diseño' }),
    ]
    const libro = libroCronograma(frente, lista, [])
    expect(libro.SheetNames).toEqual(['Cronograma', 'Instrucciones'])
    const r = leerCronograma(libroABuffer(libro))
    expect(r.errores).toEqual([])
    expect(r.filas.map((f) => [f.codigo, f.parent_codigo])).toEqual([['E-01', ''], ['E-01.1', 'E-01'], ['E-02', '']])
    const c = clasificar(r.filas, lista)
    expect(c).toMatchObject({ nuevas: 0, actualizadas: 0, sinCambios: 3 })
  })

  it('el libro incluye el avance actual como solo lectura', () => {
    const lista = [act({ id: 'a', codigo: 'A', peso: 100, avanceValidado: 40, avanceRegistrado: 55 })]
    const ws = libroCronograma(frente, lista, []).Sheets.Cronograma
    const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
    expect(m[0].slice(-1)).toEqual(['Avance actual % (solo lectura)'])
    expect(m[1].slice(-1)).toEqual([40])
  })

  it('usa el nombre del responsable si es un usuario, y el texto si es externo', () => {
    const lista = [act({ id: 'a', codigo: 'A', responsableId: 'u1' }), act({ id: 'b', codigo: 'B', responsableTexto: 'Contratista Andes' })]
    const m = XLSX.utils.sheet_to_json<unknown[]>(libroCronograma(frente, lista, [{ id: 'u1', nombre: 'Juan Páez' }]).Sheets.Cronograma, { header: 1 })
    expect(m.slice(1).map((f) => f[10])).toEqual(['Juan Páez', 'Contratista Andes'])
  })

  it('el nombre del archivo es seguro', () => {
    expect(nombreArchivo('Cronograma', 'Urbanismo y áreas comunes', 'xlsx', '2027-03-04')).toBe('Cronograma-Urbanismo-y-areas-comunes-2027-03-04.xlsx')
  })
})

describe('qué haría la importación', () => {
  it('distingue nuevas, actualizadas y sin cambios, y dice qué cambió', () => {
    const existentes = [act({ id: 'a', codigo: 'A', nombre: 'Actividad A' }), act({ id: 'b', codigo: 'B', nombre: 'Actividad B', peso: 50 })]
    const filas = [
      { codigo: 'A', parent_codigo: '', nombre: 'Actividad A', descripcion: '', peso: null, plan_inicio: null, plan_fin: null, real_inicio: null, real_fin: null, duracion_dias: null, responsable_texto: '', estado: 'por_programar' as const, observaciones: '' },
      { codigo: 'B', parent_codigo: '', nombre: 'Actividad B', descripcion: '', peso: 60, plan_inicio: '2027-03-01', plan_fin: null, real_inicio: null, real_fin: null, duracion_dias: null, responsable_texto: '', estado: 'por_programar' as const, observaciones: '' },
      { codigo: 'C', parent_codigo: '', nombre: 'Actividad C', descripcion: '', peso: null, plan_inicio: null, plan_fin: null, real_inicio: null, real_fin: null, duracion_dias: null, responsable_texto: '', estado: 'por_programar' as const, observaciones: '' },
    ]
    const c = clasificar(filas, existentes)
    expect(c).toMatchObject({ nuevas: 1, actualizadas: 1, sinCambios: 1 })
    expect(c.detalle.find((d) => d.codigo === 'B')?.cambios).toEqual(['Ponderación', 'Inicio previsto'])
  })
})
