import { describe, expect, it } from 'vitest'
import { PermissionError } from '@/app/permissions'
import { marcarReservada } from '@/features/inventario/service'
import type { Actor } from '@/features/inventario/types'
import { crearCotizacion, siguienteNumero, type CotizacionInput } from '../cotizacion'
import { construirPdfCotizacion } from '../pdf'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const asesor: Actor = { id: 'u-asesor', nombre: 'Asesor', rol: 'asesor' }
const gerencia: Actor = { id: 'u-gerencia', nombre: 'Gerencia', rol: 'gerencia' }

const base: CotizacionInput = {
  codigo: 'E1-PB-A2',
  cliente: { nombre: 'Cliente de prueba', email: 'cliente@correo.com', telefono: '0990000000' },
  asesor: { nombre: 'Asesor de prueba', email: 'asesor@nuvarel.com', telefono: '' },
  descuentoPct: 0,
  vigenciaDias: 15,
  fecha: '2026-10-28',
  observaciones: '',
}

describe('cotizaciones', () => {
  it('crea una cotización con precio, plan y vigencia', () => {
    const c = crearCotizacion(createInitialState(), base, asesor, [])
    expect(c.numero).toBe('COT-2026-0001')
    expect(c.validaHasta).toBe('2026-11-12')
    expect(c.plan.precioFinal).toBe(172147.2)
    expect(Math.round(c.plan.reserva)).toBe(10329)
    expect(c.unidad.parqueo).toBeNull()
  })

  it('numeración correlativa por año', () => {
    const c1 = crearCotizacion(createInitialState(), base, asesor, [])
    expect(siguienteNumero([c1], '2026-12-01')).toBe('COT-2026-0002')
    expect(siguienteNumero([c1], '2027-01-02')).toBe('COT-2027-0001')
  })

  it('sólo gerencia o administración aplican descuentos', () => {
    expect(() => crearCotizacion(createInitialState(), { ...base, descuentoPct: 2 }, asesor, [])).toThrow(PermissionError)
    const c = crearCotizacion(createInitialState(), { ...base, descuentoPct: 2 }, gerencia, [])
    expect(c.plan.precioFinal).toBeCloseTo(172147.2 * 0.98, 2)
  })

  it('no cotiza unidades comprometidas con otro cliente', () => {
    let s = createInitialState()
    s = marcarReservada(s, 'E1-PB-A2', 'RES-1', gerencia)
    expect(() => crearCotizacion(s, base, asesor, [])).toThrow(/reservado/)
  })

  it('valida datos del cliente y del asesor', () => {
    expect(() => crearCotizacion(createInitialState(), { ...base, cliente: { ...base.cliente, nombre: '' } }, asesor, [])).toThrow(/cliente/)
    expect(() => crearCotizacion(createInitialState(), { ...base, cliente: { ...base.cliente, email: 'no-es-correo' } }, asesor, [])).toThrow(/correo/)
    expect(() => crearCotizacion(createInitialState(), { ...base, vigenciaDias: 0 }, asesor, [])).toThrow(/vigencia/)
  })

  it('genera un PDF con los datos de la cotización', () => {
    const c = crearCotizacion(createInitialState(), { ...base, descuentoPct: 2 }, gerencia, [])
    const doc = construirPdfCotizacion(c)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
    const raw = doc.output()
    expect(raw.startsWith('%PDF')).toBe(true)
    for (const t of ['COT-2026-0001', 'Departamento 1002', 'Cliente de prueba', 'Asesor de prueba', 'Cuota 30 de 30', 'Descuento autorizado']) {
      expect(raw, t).toContain(t)
    }
  })
})
