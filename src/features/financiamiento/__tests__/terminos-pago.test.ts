import { describe, expect, it } from 'vitest'
import { calcularEntrada } from '@/features/cobranza/entrada'
import { generarPlan } from '@/features/financiamiento/plan'
import { dataFlags, estadoDocumento } from '@/features/inventario/data/data-quality'
import { calcularPrecio } from '@/features/inventario/pricing'
import { aprobarPropuesta, aplicarCambioPrecio, crearPropuesta, trazaAjuste } from '@/features/inventario/service'
import type { Actor } from '@/features/inventario/types'
import { DEFAULT_PARAMS } from '@/features/inventario/__tests__/fixtures'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const FECHA = '2026-11-02'
const unidades = createInitialState().units

describe('una sola forma de pago en Inventario, Cotizaciones y Financiamiento', () => {
  it.each([0, 1.5, 3])('las tres fórmulas coinciden al centavo en las 72 unidades, con %s %% de descuento', (descuentoPct) => {
    for (const u of unidades) {
      const plan = generarPlan(u, DEFAULT_PARAMS, { descuentoPct, fechaReserva: FECHA })
      const e = calcularEntrada({ precioFinal: plan.precioFinal, reserva: 500, meses: plan.meses })
      expect(e.acumuladoFirma, u.codigo).toBe(plan.reserva)
      expect(e.saldoCuotas, u.codigo).toBe(plan.cuotasTotal)
      expect(e.cuotaMensual, u.codigo).toBe(plan.cuotaMensual)
      expect(e.ultimaCuota, u.codigo).toBe(plan.ultimaCuota)
      expect(e.saldoEntrega, u.codigo).toBe(plan.contraEntrega)
      expect(e.entradaTotal, u.codigo).toBeCloseTo(plan.reserva + plan.cuotasTotal, 2)
      if (descuentoPct === 0) {
        const p = calcularPrecio(u, DEFAULT_PARAMS)
        expect(p.reserva, u.codigo).toBe(plan.reserva)
        expect(p.cuotaMensual, u.codigo).toBe(plan.cuotaMensual)
        expect(p.ultimaCuota, u.codigo).toBe(plan.ultimaCuota)
        expect(p.contraEntrega, u.codigo).toBe(plan.contraEntrega)
      }
    }
  })

  it('el 6 % forma parte del 20 %: con cualquier reserva, nada se cobra dos veces y el total es el precio', () => {
    const u = unidades[0]
    const plan = generarPlan(u, DEFAULT_PARAMS, { fechaReserva: FECHA })
    for (const reserva of [500, 600, 1000, plan.reserva]) {
      const e = calcularEntrada({ precioFinal: plan.precioFinal, reserva, meses: plan.meses })
      const de = (tipo: string) => e.partidas.filter((p) => p.tipo === tipo).reduce((t, p) => t + p.monto, 0)
      expect(Math.round((de('reserva') + de('firma')) * 100) / 100).toBe(plan.reserva)
      expect(Math.round((de('reserva') + de('firma') + de('cuota') + de('entrega')) * 100) / 100).toBe(plan.precioFinal)
    }
  })

  it('la cotización llama «Pago a la firma» al 6 %, no reserva', () => {
    const plan = generarPlan(unidades[0], DEFAULT_PARAMS, { fechaReserva: FECHA })
    expect(plan.cronograma[0].concepto).toBe('Pago a la firma 6 %')
    expect(plan.cronograma.some((p) => /^Reserva/.test(p.concepto))).toBe(false)
  })
})

describe('historial de ajustes', () => {
  const gerencia: Actor = { id: 'g', nombre: 'Gabriela Gerencia', rol: 'gerencia' }
  const admin: Actor = { id: 'a', nombre: 'Andrés Admin', rol: 'administrador' }
  const input = { alcance: { codigos: ['E1-PB-A1'] }, modo: 'fijar' as const, valor: 2300, motivo: 'Ajuste de comité' }

  it('separa quién propuso de quién aprobó, con sus fechas', () => {
    let s = crearPropuesta(createInitialState(), input, gerencia)
    s = aprobarPropuesta(s, s.propuestas[0].id, 'Conforme', admin)
    expect(trazaAjuste(s.priceHistory[0], s.propuestas)).toMatchObject({
      propuso: { usuario: 'Gabriela Gerencia', fecha: s.propuestas[0].fecha },
      aprobo: { usuario: 'Andrés Admin', comentario: 'Conforme' },
    })
  })

  it('un cambio directo no inventa una propuesta, ni la confunde con otra del mismo motivo que sigue pendiente', () => {
    let s = crearPropuesta(createInitialState(), input, gerencia)
    s = aplicarCambioPrecio(s, input, admin)
    expect(trazaAjuste(s.priceHistory[0], s.propuestas)).toMatchObject({ propuso: null, aprobo: { usuario: 'Andrés Admin' } })
  })

  it('una importación no figura como aprobada', () => {
    const h = { id: 'x', fecha: new Date().toISOString(), usuario: 'Gabriela Gerencia', rol: 'gerencia', tipo: 'importacion' as const, alcance: 'Excel', motivo: 'Carga', detalle: '', cambios: [], totalAntes: 0, totalDespues: 0 }
    expect(trazaAjuste(h, [])).toMatchObject({ propuso: null, aprobo: null, registro: { usuario: 'Gabriela Gerencia' } })
  })
})

describe('estados de documentación', () => {
  it('sin archivo está pendiente; cargado queda en revisión; validado solo si se indica expresamente', () => {
    expect(estadoDocumento(false)).toBe('pendiente')
    expect(estadoDocumento(true)).toBe('en_revision')
    expect(estadoDocumento(true, true)).toBe('validado')
    expect(estadoDocumento(false, true)).toBe('pendiente')
  })

  it('una unidad con plano cargado no se presenta como validada', () => {
    const f = dataFlags({ ...unidades[0], planoPath: 'planos/1001.pdf' }).find((x) => x.campo === 'Plano')!
    expect(f.mensaje).toMatch(/en revisión: aún no está validado/)
  })
})
