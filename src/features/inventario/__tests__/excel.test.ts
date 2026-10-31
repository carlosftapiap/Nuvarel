import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { PermissionError } from '@/app/permissions'
import { aplicarImportacion, construirLibro, leerLibro, validarImportacion } from '../excel'
import { calcularPrecio } from '../pricing'
import type { Actor } from '../types'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const gerencia: Actor = { id: 'u-gerencia', nombre: 'Gerencia', rol: 'gerencia' }
const asesor: Actor = { id: 'u-asesor', nombre: 'Asesor', rol: 'asesor' }

function libro(rows: unknown[][], hoja = 'Inventario') {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), hoja)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}
const H = ['Codigo', 'Area m2', 'Bodega', 'Bodega m2', 'Patio m2', 'USD/m2', 'Estado', 'Observaciones']

describe('exportación e importación Excel', () => {
  it('la exportación incluye las 72 unidades con precio calculado y se puede releer sin cambios', () => {
    const s = createInitialState()
    const buf = XLSX.write(construirLibro(s), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const { filas, hojas } = leerLibro(buf)
    expect(hojas).toEqual(['Inventario'])
    expect(filas).toHaveLength(72)
    const v = validarImportacion(s, filas)
    expect(v.conErrores).toBe(0)
    expect(v.conCambios).toBe(0)
    expect(v.sinCambios).toBe(72)
    const wb = XLSX.read(buf, { type: 'array' })
    const datos = XLSX.utils.sheet_to_json<Record<string, number>>(wb.Sheets.Inventario)
    expect(datos.find((d) => d.Codigo as unknown as string === 'E1-PB-A2')!['Precio de venta']).toBe(172147.2)
  })

  it('la plantilla también se reimporta sin cambios', () => {
    const s = createInitialState()
    const buf = XLSX.write(construirLibro(s, { plantilla: true }), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const v = validarImportacion(s, leerLibro(buf).filas)
    expect(v.totalFilas).toBe(72)
    expect(v.conErrores + v.conCambios).toBe(0)
  })

  it('detecta errores: código inexistente, duplicado, número inválido, estado desconocido y transición inválida', () => {
    const s = createInitialState()
    const buf = libro([
      H,
      ['E9-PB-A1', 70, '', 0, 0, 2200, '', ''],
      ['E1-PB-A1', 'setenta', '10A', 2.1, 0, 2230, '', ''],
      ['E1-PB-A1', 70.47, '10A', 2.1, 0, 2230, '', ''],
      ['E1-PB-A2', 70.55, '10B', 1.98, 45.24, 2230, 'Ocupado', ''],
      ['E1-PB-A3', 53.69, '', 0, 38.35, 40, '', ''],
    ])
    const v = validarImportacion(s, leerLibro(buf).filas)
    expect(v.conErrores).toBe(5)
    const errores = v.filas.map((f) => f.errores.join(' '))
    expect(errores[0]).toMatch(/no existe/)
    expect(errores[1]).toMatch(/no es un número/)
    expect(errores[2]).toMatch(/duplicado/)
    expect(errores[3]).toMatch(/no reconocido/)
    expect(errores[4]).toMatch(/fuera de rango/)
    expect(() => aplicarImportacion(s, v, 'Carga con errores', gerencia, 'x.xlsx')).toThrow(/errores/)
  })

  it('acepta formato es-EC, previsualiza cambios y los aplica con historial', () => {
    const s = createInitialState()
    const buf = libro([
      H,
      ['E1-PB-A1', '70,47', 'BOD 10A', '2,10', '-', '2.300,00', 'Bloqueado', 'Bloqueo por gerencia'],
      ['E2-P1-A3', 53.69, '21E', 1.07, 0, 2361.7, 'No disponible', 'Unidad modelo'],
    ])
    const v = validarImportacion(s, leerLibro(buf).filas)
    expect(v.conErrores).toBe(0)
    expect(v.conCambios).toBe(2)
    expect(v.faltantes).toHaveLength(70)
    expect(v.filas[0].cambios.map((c) => c.campo)).toEqual(['usdM2', 'estado', 'notas'])
    expect(() => aplicarImportacion(s, v, 'Carga de prueba', asesor, 'x.xlsx')).toThrow(PermissionError)
    const s2 = aplicarImportacion(s, v, 'Carga de prueba', gerencia, 'x.xlsx')
    const u = s2.units.find((x) => x.codigo === 'E1-PB-A1')!
    expect(u).toMatchObject({ usdM2: 2300, estado: 'bloqueado', notas: 'Bloqueo por gerencia' })
    expect(calcularPrecio(u, s2.params).precioVenta).toBe(Math.round(2300 * 72.57))
    expect(s2.priceHistory[0]).toMatchObject({ tipo: 'importacion' })
    expect(s2.priceHistory[0].cambios).toHaveLength(1)
    expect(s2.statusHistory).toHaveLength(2)
  })

  it('lee la exportación del simulador AMURA (hojas Edificio 1 / Edificio 2)', () => {
    const s = createInitialState()
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Simulador'], ['Precio base', 2230]]), 'Parametros')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Codigo', 'DPT', 'Area m2', 'Bodega', 'Bodega m2', 'Patio m2', 'Precio m2 fijo'],
      ['E1-PB-A1', '1001', 70.47, 'BOD 10A', 2.1, 0, 2230],
      ['E1-PB-A3', '1003', 53.69, 'sin bodega', 0, 38.35, 2230],
    ]), 'Edificio 1')
    const { filas, hojas } = leerLibro(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(hojas).toEqual(['Edificio 1'])
    const v = validarImportacion(s, filas)
    expect(v.conErrores).toBe(0)
    expect(v.conCambios).toBe(0)
  })

  it('advierte al cambiar superficies verificadas', () => {
    const s = createInitialState()
    const v = validarImportacion(s, leerLibro(libro([H, ['E1-P1-A1', 70.47, '11A', 2.1, 0, 2260, '', '']])).filas)
    expect(v.filas[0].errores).toHaveLength(0)
    expect(v.filas[0].advertencias.join(' ')).toMatch(/verificad/)
  })
})
