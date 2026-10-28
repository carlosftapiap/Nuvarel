import { describe, expect, it } from 'vitest'
import { PermissionError } from '@/app/permissions'
import { calcularPrecio } from '@/features/inventario/pricing'
import { aplicarCambioPrecio, aprobarPropuesta, createInitialState, crearPropuesta, rechazarPropuesta } from '@/features/inventario/service'
import type { Actor } from '@/features/inventario/types'
import { comparacionPorPiso, conteoPosiciones, RANGO_FRATELLI_TOTAL, RANGOS_FRATELLI } from '../competencia'
import { FRATELLI } from '../data/fratelli'

const admin: Actor = { nombre: 'Admin', rol: 'administrador' }
const gerencia: Actor = { nombre: 'Gerencia', rol: 'gerencia' }
const asesor: Actor = { nombre: 'Asesor', rol: 'asesor' }

describe('competencia FRATELLI', () => {
  it('60 unidades con los rangos de la lista PDF', () => {
    expect(FRATELLI).toHaveLength(60)
    expect(Math.round(RANGO_FRATELLI_TOTAL.precioMin)).toBe(166_995)
    expect(Math.round(RANGO_FRATELLI_TOTAL.precioMax)).toBe(205_566)
    expect(Math.round(RANGO_FRATELLI_TOTAL.m2Min)).toBe(2076)
    expect(Math.round(RANGO_FRATELLI_TOTAL.m2Max)).toBe(2554)
    expect([RANGOS_FRATELLI.PB.m2Min, RANGOS_FRATELLI.PB.m2Max].map(Math.round)).toEqual([2140, 2554])
    expect([RANGOS_FRATELLI['1'].m2Min, RANGOS_FRATELLI['1'].m2Max].map(Math.round)).toEqual([2076, 2304])
    expect([RANGOS_FRATELLI['3'].m2Min, RANGOS_FRATELLI['3'].m2Max].map(Math.round)).toEqual([2138, 2373])
  })

  it('posición de AMURA frente a FRATELLI: 0 bajo · 58 dentro · 14 sobre (lista PDF)', () => {
    const s = createInitialState()
    expect(conteoPosiciones(s.units, s.params)).toEqual({ bajo: 0, dentro: 58, sobre: 14 })
  })

  it('promedio por piso coincide con la lista PDF', () => {
    const s = createInitialState()
    const filas = comparacionPorPiso(s.units, s.params)
    const v = (ed: number, piso: string) => Math.round(filas.find((f) => f.edificio === ed && f.piso === piso)!.amuraM2)
    expect(v(1, 'PB')).toBe(2230)
    expect(v(1, '4')).toBe(2262)
    expect(v(2, '1')).toBe(2362)
    expect(v(2, '5')).toBe(2353)
    expect(filas.find((f) => f.edificio === 2 && f.piso === '1')!.posicion).toBe('sobre')
  })
})

describe('propuestas de precio', () => {
  it('gerencia propone sin cambiar precios oficiales; administrador aprueba', () => {
    const s0 = createInitialState()
    const s1 = crearPropuesta(s0, { alcance: { edificio: 2, piso: '1' }, modo: 'porcentaje', valor: -2, motivo: 'Alinear con FRATELLI' }, gerencia)
    expect(s1.propuestas).toHaveLength(1)
    expect(s1.propuestas[0]).toMatchObject({ estado: 'pendiente', usuario: 'Gerencia' })
    expect(s1.propuestas[0].cambios).toHaveLength(7)
    expect(s1.units).toBe(s0.units) // precios oficiales intactos
    expect(s1.priceHistory).toHaveLength(0)

    expect(() => aprobarPropuesta(s1, s1.propuestas[0].id, '', gerencia)).toThrow(PermissionError)
    const s2 = aprobarPropuesta(s1, s1.propuestas[0].id, 'Aprobado en comité', admin)
    const u = s2.units.find((x) => x.codigo === 'E2-P1-A1')!
    expect(u.usdM2).toBe(2314.47)
    expect(calcularPrecio(u, s2.params).precioVenta).toBe(Math.round(2314.47 * 72.57))
    expect(s2.propuestas[0]).toMatchObject({ estado: 'aprobada' })
    expect(s2.priceHistory[0].motivo).toMatch(/Alinear con FRATELLI.*Aprobado en comité/)
    expect(() => aprobarPropuesta(s2, s2.propuestas[0].id, '', admin)).toThrow(/resuelta/)
  })

  it('rechazo exige motivo y no toca precios', () => {
    const s1 = crearPropuesta(createInitialState(), { alcance: {}, modo: 'porcentaje', valor: 5, motivo: 'Subida general' }, gerencia)
    expect(() => rechazarPropuesta(s1, s1.propuestas[0].id, '', admin)).toThrow(/motivo/)
    const s2 = rechazarPropuesta(s1, s1.propuestas[0].id, 'Fuera de mercado', admin)
    expect(s2.propuestas[0].estado).toBe('rechazada')
    expect(s2.units).toBe(s1.units)
  })

  it('asesores no proponen y gerencia no aplica cambios directos', () => {
    const input = { alcance: {}, modo: 'porcentaje' as const, valor: 1, motivo: 'Prueba de permisos' }
    expect(() => crearPropuesta(createInitialState(), input, asesor)).toThrow(PermissionError)
    expect(() => aplicarCambioPrecio(createInitialState(), input, gerencia)).toThrow(PermissionError)
  })
})
