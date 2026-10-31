import { describe, expect, it } from 'vitest'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import { ESTADOS_EFECTIVOS, estadoEfectivo } from '@/features/inventario/estados'
import { leerMonto } from '@/features/inventario/pricing'
import type { Reserva } from '@/features/reservas/model'
import { acreditacion, errorMontoReserva, operacionesAbiertas, siguientePaso, type ContextoOperacion } from '../operacion'

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
    expect(siguientePaso(ctx({ estadoUnidad: 'por_confirmar' })).accion).toBe('confirmar_unidad')
    expect(siguientePaso(ctx({ estadoUnidad: 'reservado' })).accion).toBe('unidad_ocupada')
    expect(siguientePaso(ctx({ otraReserva: res('solicitada', { id: 'r9', cotizacionId: 'q9' }) })).accion).toBe('unidad_ocupada')
    expect(siguientePaso(ctx({ cotizacion: cot('q1', { validaHasta: '2026-11-01' }) })).accion).toBe('reemitir')
  })

  it('reparte el resto del trámite entre vendedor, Finanzas, Gerencia y Legal', () => {
    expect(siguientePaso(ctx({ reserva: res('solicitada') }))).toMatchObject({ accion: 'registrar_pago', responsable: 'Vendedor' })
    expect(siguientePaso(ctx({ reserva: res('solicitada', { comprobante: 'TRF-1' }) }))).toMatchObject({ accion: 'verificar', responsable: 'Finanzas' })
    expect(siguientePaso(ctx({ reserva: res('pago_verificado', { comprobante: 'T', montoRecibido: 600 }) }))).toMatchObject({ accion: 'aprobar', responsable: 'Gerencia' })
    expect(siguientePaso(ctx({ reserva: res('confirmada') }))).toMatchObject({ accion: 'contrato', responsable: 'Legal' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'borrador' }))).toMatchObject({ accion: 'firma', responsable: 'Legal' })
    expect(siguientePaso(ctx({ reserva: res('confirmada'), estadoContrato: 'firmado' })).accion).toBe('cobranza')
  })

  it('avisa si Finanzas no puede verificar porque falta el receptor de pagos', () => {
    expect(siguientePaso(ctx({ reserva: res('solicitada', { comprobante: 'T' }), receptorDefinido: false })).detalle).toMatch(/quién recibe los pagos/)
  })

  it('una reserva anulada pide una cotización nueva', () => {
    expect(siguientePaso(ctx({ reserva: res('anulada') })).accion).toBe('anulada')
  })
})

describe('estado comercial efectivo', () => {
  const sol = { codigo: 'RES-2026-0001', estado: 'solicitada', vigenciaHasta: null, cotizacionId: null }
  it('una solicitud activa nunca se muestra como disponible, sin tocar el estado guardado', () => {
    const u = { estado: 'disponible' as const, solicitud: sol }
    expect(estadoEfectivo(u)).toBe('en_proceso_reserva')
    expect(u.estado).toBe('disponible')
    expect(estadoEfectivo({ estado: 'por_confirmar', solicitud: sol })).toBe('en_proceso_reserva')
    expect(ESTADOS_EFECTIVOS.en_proceso_reserva.label).toBe('En proceso de reserva')
  })
  it('sin solicitud, o con un estado más avanzado, manda el estado guardado', () => {
    expect(estadoEfectivo({ estado: 'disponible', solicitud: null })).toBe('disponible')
    expect(estadoEfectivo({ estado: 'por_confirmar' })).toBe('por_confirmar')
    expect(estadoEfectivo({ estado: 'reservado', solicitud: sol })).toBe('reservado')
    expect(estadoEfectivo({ estado: 'vendido', solicitud: sol })).toBe('vendido')
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
