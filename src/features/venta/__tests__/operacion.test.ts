import { describe, expect, it } from 'vitest'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { ESTADOS_EFECTIVOS, estadoEfectivo } from '@/features/inventario/estados'
import { leerMonto } from '@/features/inventario/pricing'
import type { Reserva } from '@/features/reservas/model'
import { acreditacion, errorMontoReserva, operacionesAbiertas, PASOS_VENTA, pasoActual, siguientePaso, type ContextoOperacion } from '../operacion'

const HOY = '2026-11-10'
const cot = (id: string, extra: Partial<Cotizacion> = {}) => ({ id, numero: id, clienteId: 'c1', validaHasta: '2026-12-01', estado: 'emitida', creadaEn: `2026-11-0${id.slice(-1)}`, unidad: { codigo: 'E1-PB-A1', dpt: 'A1' }, ...extra }) as Cotizacion
const res = (estado: Reserva['estado'], extra: Partial<Reserva> = {}) => ({ id: 'r1', codigo: 'RES-1', cotizacionId: 'q1', estado, montoReserva: 600, comprobante: null, montoRecibido: null, ...extra }) as Reserva
const ctx = (extra: Partial<ContextoOperacion> = {}): ContextoOperacion => ({ clienteId: 'c1', codigo: 'E1-PB-A1', estadoUnidad: 'disponible', cotizacion: cot('q1'), reserva: null, otraReserva: null, estadoContrato: null, receptorDefinido: true, hoy: HOY, ...extra })

describe('monto de la reserva', () => {
  it('lee los formatos habituales sin multiplicar por cien', () => {
    expect(leerMonto('600')).toBe(600)
    expect(leerMonto('600.50')).toBe(600.5)
    expect(leerMonto('600,50')).toBe(600.5)
    expect(leerMonto('1.500')).toBe(1500)
    expect(leerMonto('1,500')).toBe(1500)
    expect(leerMonto('1.500,50')).toBe(1500.5)
    expect(leerMonto('1,500.50')).toBe(1500.5)
    expect(leerMonto('')).toBeNull()
    expect(leerMonto('abc')).toBeNaN()
  })

  it('admite 600 u otro valor hasta el 6 %, no cero ni más del tope', () => {
    expect(errorMontoReserva(500, 6000)).toBeNull()
    expect(errorMontoReserva(600, 6000)).toBeNull()
    expect(errorMontoReserva(6000, 6000)).toBeNull()
    expect(errorMontoReserva(6000.01, 6000)).toMatch(/6 %/)
    expect(errorMontoReserva(0, 6000)).toMatch(/mayor a cero/)
    expect(errorMontoReserva(null, 6000)).toMatch(/Ingresa/)
    expect(errorMontoReserva(NaN, 6000)).toMatch(/Ingresa/)
    expect(errorMontoReserva(10.555, 6000)).toMatch(/decimales/)
  })
})

describe('la reserva se acredita al 6 % sin duplicarse', () => {
  it('sin pago proyecta con el monto acordado', () => {
    expect(acreditacion(6000, 600, null)).toEqual({ base: 600, proyectado: true, restanteFirma: 5400, excedente: 0 })
  })
  it('con pago usa lo pagado, no lo acordado', () => {
    expect(acreditacion(6000, 600, 700)).toEqual({ base: 700, proyectado: false, restanteFirma: 5300, excedente: 0 })
  })
  it('si lo pagado supera el 6 %, no queda saldo negativo', () => {
    expect(acreditacion(6000, 600, 6500)).toEqual({ base: 6500, proyectado: false, restanteFirma: 0, excedente: 500 })
  })
})

describe('siguiente paso', () => {
  it('guía desde el cliente hasta la solicitud', () => {
    expect(siguientePaso(ctx({ clienteId: '', codigo: '', cotizacion: null })).accion).toBe('cliente')
    expect(siguientePaso(ctx({ codigo: '', cotizacion: null })).accion).toBe('unidad')
    expect(siguientePaso(ctx({ cotizacion: null })).accion).toBe('emitir')
    expect(siguientePaso(ctx()).accion).toBe('solicitar')
  })

  it('no permite solicitar si la unidad no se puede reservar o la cotización venció', () => {
    expect(siguientePaso(ctx({ estadoUnidad: 'reservado' })).accion).toBe('unidad_ocupada')
    expect(siguientePaso(ctx({ otraReserva: res('solicitada', { id: 'r9', cotizacionId: 'q9' }) })).accion).toBe('unidad_ocupada')
    expect(siguientePaso(ctx({ cotizacion: cot('q1', { validaHasta: '2026-11-01' }) })).accion).toBe('reemitir')
  })

  it('reparte el resto del trámite entre vendedor, Finanzas, Gerencia y Legal', () => {
    expect(siguientePaso(ctx({ reserva: res('solicitada') }))).toMatchObject({ accion: 'registrar_pago', responsable: 'Vendedor' })
    expect(siguientePaso(ctx({ reserva: res('solicitada', { comprobante: 'TRF-1' }) }))).toMatchObject({ accion: 'verificar', responsable: 'Finanzas' })
    expect(siguientePaso(ctx({ reserva: res('pago_verificado', { comprobante: 'T', montoRecibido: 600 }) }))).toMatchObject({ accion: 'aprobar', responsable: 'Gerencia' })
    expect(siguientePaso(ctx({ reserva: res('confirmada') }))).toMatchObject({ accion: 'contrato', responsable: 'Legal' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'borrador' }))).toMatchObject({ accion: 'enviar_cumplimiento', responsable: 'Legal' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'borrador', cumplimiento: 'pendiente' }))).toMatchObject({ accion: 'cumplimiento', responsable: 'Cumplimiento' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'borrador', cumplimiento: 'observado' }))).toMatchObject({ accion: 'expediente', responsable: 'Vendedor' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'borrador', cumplimiento: 'aprobado' }))).toMatchObject({ accion: 'firma', responsable: 'Legal' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'firmado' })).accion).toBe('cobranza')
  })

  it('un pago rechazado muestra el motivo y vuelve a pedir el comprobante al vendedor', () => {
    const p = siguientePaso(ctx({ reserva: res('solicitada'), rechazoPago: { motivo: 'El monto no coincide con el banco', fecha: '2026-11-12' } }))
    expect(p).toMatchObject({ accion: 'registrar_pago', responsable: 'Vendedor' })
    expect(p.titulo).toMatch(/rechazó el pago/)
    expect(p.detalle).toMatch(/El monto no coincide con el banco/)
  })

  it('la guía marca terminados los pasos anteriores y señala uno solo como actual', () => {
    // El vendedor ve cinco etapas; verificación, excepciones, contrato, Cumplimiento y firma ocurren dentro de Reserva y Venta.
    expect(PASOS_VENTA.map((p) => p.titulo)).toEqual(['Cliente', 'Departamento', 'Cotización', 'Reserva', 'Venta'])
    expect(siguientePaso(ctx({ cotizacion: null, planConfirmado: false })).accion).toBe('plan')
    expect(siguientePaso(ctx({ cotizacion: null, planConfirmado: true })).accion).toBe('emitir')
    expect(pasoActual('cliente')).toBe(0)
    expect(pasoActual('plan')).toBe(2)
    expect(pasoActual('emitir')).toBe(2)
    expect(pasoActual('verificar')).toBe(3)
    expect(pasoActual('aprobar')).toBe(3)
    expect(pasoActual('expediente')).toBe(4)
    expect(pasoActual('cobranza')).toBe(4)
  })

  it('Gerencia solo aparece cuando la reserva tiene una excepción, con el motivo', () => {
    const p = siguientePaso(ctx({ reserva: res('pago_verificado', { comprobante: 'T', montoRecibido: 600 }), excepciones: ['Descuento de 2.00 %'] }))
    expect(p).toMatchObject({ accion: 'aprobar', responsable: 'Gerencia' })
    expect(p.detalle).toMatch(/Descuento de 2.00 %/)
    expect(siguientePaso(ctx({ reserva: res('confirmada') }))).toMatchObject({ accion: 'contrato', responsable: 'Legal' })
  })

  it('avisa si Finanzas no puede verificar porque falta el receptor de pagos', () => {
    expect(siguientePaso(ctx({ reserva: res('solicitada', { comprobante: 'T' }), receptorDefinido: false })).detalle).toMatch(/quién recibe los pagos/)
  })

  it('una reserva anulada pide una cotización nueva', () => {
    expect(siguientePaso(ctx({ reserva: res('anulada') })).accion).toBe('anulada')
  })
})

describe('estado comercial efectivo', () => {
  it('solo hay tres estados y una solicitud en trámite no cambia el estado guardado', () => {
    expect(Object.keys(ESTADOS_EFECTIVOS)).toEqual(['disponible', 'reservado', 'vendido'])
    expect(estadoEfectivo({ estado: 'disponible' })).toBe('disponible')
    expect(estadoEfectivo({ estado: 'reservado' })).toBe('reservado')
    expect(estadoEfectivo({ estado: 'vendido' })).toBe('vendido')
  })
})

describe('ventas por continuar', () => {
  it('muestra la última versión vigente y las reservas en curso, no las vencidas ni las firmadas', () => {
    const lista = [cot('q1', { creadaEn: '2026-11-01' }), cot('q2', { creadaEn: '2026-11-02' }), cot('q3', { clienteId: 'c2', validaHasta: '2026-11-01' })]
    expect(operacionesAbiertas(lista, [], new Set(), HOY).map((o) => o.cotizacion.id)).toEqual(['q2'])
    const conReserva = operacionesAbiertas(lista, [res('solicitada')], new Set(), HOY)
    expect(conReserva.map((o) => [o.cotizacion.id, o.paso])).toEqual([['q2', 'Por solicitar reserva'], ['q1', 'Esperando el pago']])
    expect(operacionesAbiertas([lista[0]], [res('confirmada')], new Set(['r1']), HOY)).toEqual([])
  })
})
