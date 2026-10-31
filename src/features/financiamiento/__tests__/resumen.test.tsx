// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createInitialState, DEFAULT_PARAMS } from '@/features/inventario/__tests__/fixtures'
import { round2 } from '@/features/inventario/pricing'
import { calcularCondiciones, condicionesIniciales, type CondicionesFinanciamiento } from '../condiciones'
import ResumenFinanciero from '../components/ResumenFinanciero'

// E1-PB-A3 es el departamento 1003 del caso de AMURA: $128.549,50, edificio 1 (30 cuotas).
const unit = createInitialState().units.find((u) => u.codigo === 'E1-PB-A3')!
const base = (over: Partial<CondicionesFinanciamiento> = {}): CondicionesFinanciamiento => ({ ...condicionesIniciales('2026-10-31'), reserva: '500', ...over })
const calc = (c = base(), puedeDescontar = false) => calcularCondiciones(unit, DEFAULT_PARAMS, c, puedeDescontar)

/** Reserva + saldo a la firma + cuotas (ordinarias y extraordinarias) + 80 % debe ser el precio, al centavo. */
function cuadra(x: ReturnType<typeof calc>) {
  const suma = round2(x.reserva + x.entrada!.pagoFirma + x.entrada!.saldoCuotas + x.entrada!.saldoEntrega)
  expect(suma).toBe(x.plan!.precioFinal)
}

describe('ejemplo de AMURA: cada cifra del resumen', () => {
  it('cuadra al centavo con los valores del caso', () => {
    const x = calc()
    expect(x.plan!.precioFinal).toBe(128549.5)
    expect(x.entrada!.entradaTotal).toBe(25709.9)
    expect(x.entrada!.acumuladoFirma).toBe(7712.97)
    expect(x.reserva).toBe(500)
    expect(x.entrada!.pagoFirma).toBe(7212.97)
    expect(x.entrada!.saldoCuotas).toBe(17996.93)
    expect(x.plan!.meses).toBe(30)
    expect(x.entrada!.cuotaMensual).toBe(599.9)
    expect(x.entrada!.ultimaCuota).toBe(599.83)
    expect(x.entrada!.saldoEntrega).toBe(102839.6)
    expect(x.errorReserva).toBeNull()
    cuadra(x)
  })

  it('la reserva forma parte del 6 %: no se cobra dos veces', () => {
    const x = calc()
    expect(round2(x.reserva + x.entrada!.pagoFirma)).toBe(x.entrada!.acumuladoFirma)
    expect(x.entrada!.partidas.filter((p) => p.tipo === 'reserva')).toHaveLength(1)
  })

  it('reserva de $5.000: valida el tope del 6 % y ajusta solo el saldo a la firma', () => {
    const x = calc(base({ reserva: '5000' }))
    expect(x.errorReserva).toBeNull()
    expect(x.reserva).toBe(5000)
    expect(x.entrada!.pagoFirma).toBe(2712.97)
    expect(x.entrada!.entradaTotal).toBe(25709.9)
    expect(x.entrada!.saldoCuotas).toBe(17996.93)
    cuadra(x)
  })

  it('reserva por encima del 6 % se rechaza', () => {
    expect(calc(base({ reserva: '9000' })).errorReserva).toMatch(/no puede superar el 6 %/)
  })

  it('cuotas extraordinarias: reducen las ordinarias sin duplicar la reserva ni el 14 %', () => {
    const x = calc(base({ extras: [{ mes: '6', monto: '10000' }] }))
    expect(x.entrada!.extraordinarias).toEqual([{ mes: 6, monto: 10000 }])
    expect(x.entrada!.saldoCuotas).toBe(17996.93)
    const pagos = x.entrada!.partidas.filter((p) => p.tipo === 'cuota' || p.tipo === 'extraordinaria').reduce((t, p) => round2(t + p.monto), 0)
    expect(pagos).toBe(17996.93)
    expect(x.entrada!.cuotaMensual).toBeLessThan(599.9)
    expect(x.sinExtras).toEqual({ cuotaMensual: 599.9, ultimaCuota: 599.83 })
    expect(x.entrada!.partidas.filter((p) => p.tipo === 'reserva')).toHaveLength(1)
    cuadra(x)
  })

  it('descuento autorizado: se aplica al precio base y el resumen sigue cuadrando', () => {
    const x = calc(base({ descuento: '5' }), true)
    expect(x.plan!.descuentoPct).toBe(5)
    expect(x.plan!.precioFinal).toBe(round2(x.plan!.precioLista - x.plan!.descuentoMonto))
    cuadra(x)
  })
})

describe('resumen financiero en pantalla', () => {
  it('muestra el orden de 1 a 12, las cifras del caso y la comprobación', () => {
    render(<ResumenFinanciero calc={calc()} plan={calc().plan!} edificio={1} />)
    const r = screen.getByRole('region', { name: 'Resumen financiero' })
    expect(within(r).getByText(/1\. Precio total del departamento/)).toBeInTheDocument()
    expect(within(r).getByText('$128.549,50')).toBeInTheDocument()
    expect(within(r).getByText('$25.709,90')).toBeInTheDocument()
    expect(within(r).getByText('$7.712,97')).toBeInTheDocument()
    expect(within(r).getByText('− $500,00')).toBeInTheDocument()
    expect(within(r).getByText('$7.212,97')).toBeInTheDocument()
    expect(within(r).getByText('$17.996,93')).toBeInTheDocument()
    expect(within(r).getByText('30 (edificio 1)')).toBeInTheDocument()
    expect(within(r).getByText('30 cuotas: 29 de $599,90 y una de $599,83')).toBeInTheDocument()
    expect(within(r).getByText('$102.839,60')).toBeInTheDocument()
    expect(within(r).getByText('Ninguna')).toBeInTheDocument()
    expect(within(r).getByText(/cuadra al centavo/)).toBeInTheDocument()
    const orden = within(r).getAllByText(/^\d+\. /).map((n) => Number(n.textContent!.match(/^(\d+)/)![1]))
    expect(orden).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('con cuotas extraordinarias muestra el importe y el efecto sobre las ordinarias', () => {
    const x = calc(base({ extras: [{ mes: '6', monto: '10000' }] }))
    render(<ResumenFinanciero calc={x} plan={x.plan!} edificio={1} />)
    expect(screen.getByText('Extraordinaria · mes 6')).toBeInTheDocument()
    expect(screen.getByText('$10.000,00')).toBeInTheDocument()
    expect(screen.getByText(/Sin extraordinarias serían 30 cuotas: 29 de \$599,90 y una de \$599,83/)).toBeInTheDocument()
  })
})
