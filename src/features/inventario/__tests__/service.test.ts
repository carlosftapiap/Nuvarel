import { describe, expect, it } from 'vitest'
import { PermissionError } from '@/app/permissions'
import { calcularPrecio } from '../pricing'
import { actualizarParametros, aplicarCambioPrecio, cambiarEstado, liberarReserva, marcarReservada, previsualizarCambioPrecio, restablecerListaBase, resumenInventario } from '../service'
import type { Actor } from '../types'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const gerencia: Actor = { id: 'u-gerencia', nombre: 'Gerencia', rol: 'gerencia' }
const admin: Actor = { id: 'u-admin', nombre: 'Admin', rol: 'administrador' }
const asesor: Actor = { id: 'u-asesor', nombre: 'Asesor', rol: 'asesor' }
const corredor: Actor = { id: 'u-corredor', nombre: 'Corredor', rol: 'corredor' }
const find = (s: ReturnType<typeof createInitialState>, c: string) => s.units.find((u) => u.codigo === c)!

describe('cambios de precio', () => {
  it('ajuste porcentual por edificio y piso recalcula precio y registra historial', () => {
    const s0 = createInitialState()
    const s1 = aplicarCambioPrecio(s0, { alcance: { edificio: 1, piso: 'PB' }, modo: 'porcentaje', valor: 3, motivo: 'Ajuste comercial PB' }, admin)
    const u = find(s1, 'E1-PB-A1')
    expect(u.usdM2).toBe(2296.9)
    expect(calcularPrecio(u, s1.params).precioVenta).toBe(Math.round(2296.9 * 72.57))
    expect(find(s1, 'E1-P1-A1').usdM2).toBe(2260)
    expect(find(s1, 'E2-PB-A1').usdM2).toBe(find(s0, 'E2-PB-A1').usdM2)
    expect(s1.priceHistory).toHaveLength(1)
    const h = s1.priceHistory[0]
    expect(h.cambios).toHaveLength(5)
    expect(h.tipo).toBe('porcentaje')
    expect(h.usuario).toBe('Admin')
    expect(h.totalDespues).toBeGreaterThan(h.totalAntes)
    // El estado original no se modifica (funciones puras).
    expect(find(s0, 'E1-PB-A1').usdM2).toBe(2230)
  })

  it('descuento porcentual reduce el precio', () => {
    const s = aplicarCambioPrecio(createInitialState(), { alcance: { tipologia: '1 hab' }, modo: 'porcentaje', valor: -2, motivo: 'Promoción 1 hab' }, admin)
    expect(s.priceHistory[0].cambios).toHaveLength(24)
    expect(s.priceHistory[0].totalDespues).toBeLessThan(s.priceHistory[0].totalAntes)
  })

  it('fijar USD/m² de una unidad', () => {
    const s = aplicarCambioPrecio(createInitialState(), { alcance: { codigos: ['E2-P3-A2'] }, modo: 'fijar', valor: 2400, motivo: 'Precio aprobado' }, admin)
    const u = find(s, 'E2-P3-A2')
    expect(u.usdM2).toBe(2400)
    expect(calcularPrecio(u, s.params).precioVenta).toBe(Math.round(2400 * 72.53))
  })

  it('rechaza usuarios no autorizados', () => {
    const input = { alcance: {}, modo: 'porcentaje' as const, valor: 1, motivo: 'Intento no autorizado' }
    expect(() => aplicarCambioPrecio(createInitialState(), input, asesor)).toThrow(PermissionError)
    expect(() => aplicarCambioPrecio(createInitialState(), input, corredor)).toThrow(PermissionError)
  })

  it('exige motivo y valores razonables', () => {
    const s = createInitialState()
    expect(() => aplicarCambioPrecio(s, { alcance: {}, modo: 'porcentaje', valor: 1, motivo: '' }, admin)).toThrow(/motivo/)
    expect(() => previsualizarCambioPrecio(s, { alcance: {}, modo: 'porcentaje', valor: 80, motivo: 'x' })).toThrow(/50/)
    expect(() => previsualizarCambioPrecio(s, { alcance: {}, modo: 'fijar', valor: 20, motivo: 'x' })).toThrow(/entre/)
    expect(() => previsualizarCambioPrecio(s, { alcance: {}, modo: 'porcentaje', valor: Number.NaN, motivo: 'x' })).toThrow()
  })

  it('no modifica precios de unidades reservadas', () => {
    let s = createInitialState()
    s = marcarReservada(s, 'E1-PB-A1', 'RES-001', gerencia)
    const p = previsualizarCambioPrecio(s, { alcance: { edificio: 1, piso: 'PB' }, modo: 'porcentaje', valor: 5, motivo: 'x' })
    expect(p.omitidas.map((o) => o.codigo)).toEqual(['E1-PB-A1'])
    expect(p.cambios).toHaveLength(4)
  })

  it('restablecer vuelve a la lista base', () => {
    let s = aplicarCambioPrecio(createInitialState(), { alcance: {}, modo: 'porcentaje', valor: 4, motivo: 'Prueba general' }, admin)
    s = restablecerListaBase(s, 'Volver a la lista base', admin)
    expect(resumenInventario(s).total).toBeCloseTo(11_197_344.9, 1)
    expect(s.priceHistory).toHaveLength(2)
  })
})

describe('parámetros de pago', () => {
  it('sólo administrador puede cambiar parámetros y queda en historial', () => {
    const s0 = createInitialState()
    const p = { ...s0.params, patioUsdM2: 250 }
    expect(() => actualizarParametros(s0, p, 'Nuevo valor de patio', gerencia)).toThrow(PermissionError)
    const s1 = actualizarParametros(s0, p, 'Nuevo valor de patio', admin)
    expect(s1.params.patioUsdM2).toBe(250)
    expect(s1.priceHistory[0].tipo).toBe('parametros')
    expect(s1.priceHistory[0].cambios).toHaveLength(7) // unidades con patio
  })

  it('valida que reserva + cuotas no supere 100%', () => {
    const s0 = createInitialState()
    expect(() => actualizarParametros(s0, { ...s0.params, reservaPct: 60, cuotasPct: 50 }, 'Prueba inválida', admin)).toThrow(/100%/)
  })
})

describe('estados comerciales y puerto de Reservas', () => {
  it('flujo disponible → reservado → vendido con historial', () => {
    let s = createInitialState()
    s = marcarReservada(s, 'E2-P1-A1', 'RES-100', gerencia)
    expect(find(s, 'E2-P1-A1').reservaId).toBe('RES-100')
    s = cambiarEstado(s, 'E2-P1-A1', 'vendido', 'Contrato firmado', gerencia, { sistema: true })
    expect(find(s, 'E2-P1-A1').estado).toBe('vendido')
    expect(s.statusHistory).toHaveLength(2)
    expect(() => cambiarEstado(s, 'E2-P1-A1', 'disponible', 'Reabrir venta', gerencia)).toThrow(/Venta formalizada/)
    expect(() => marcarReservada(s, 'E2-P1-A1', 'RES-101', gerencia)).toThrow(/no está disponible/)
  })

  it('una unidad reservada no se reserva de nuevo', () => {
    const s = marcarReservada(createInitialState(), 'E1-P2-A3', 'RES-1', gerencia)
    expect(() => marcarReservada(s, 'E1-P2-A3', 'RES-2', gerencia)).toThrow(/no está disponible/)
  })

  it('liberar reserva devuelve la unidad a disponible', () => {
    let s = createInitialState()
    s = marcarReservada(s, 'E1-P2-A3', 'RES-7', gerencia)
    expect(() => liberarReserva(s, 'E1-P2-A3', 'RES-8', 'Reserva vencida', gerencia)).toThrow()
    s = liberarReserva(s, 'E1-P2-A3', 'RES-7', 'Reserva vencida', gerencia)
    expect(find(s, 'E1-P2-A3')).toMatchObject({ estado: 'disponible', reservaId: null })
  })

  it('asesores no cambian estados manualmente', () => {
    expect(() => cambiarEstado(createInitialState(), 'E1-PB-A1', 'disponible', 'Intento asesor', asesor)).toThrow(PermissionError)
  })

  it('resumen cuenta estados', () => {
    const s = marcarReservada(createInitialState(), 'E1-PB-A1', 'RES-9', gerencia)
    const r = resumenInventario(s)
    expect(r.porEstado).toEqual({ disponible: 71, reservado: 1, vendido: 0 })
    expect(r.porEdificio).toEqual({ 1: 30, 2: 42 })
  })
})
