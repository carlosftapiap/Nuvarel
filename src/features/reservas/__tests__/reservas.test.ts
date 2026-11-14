import { describe, expect, it } from 'vitest'
import { PermissionError } from '@/app/permissions'
import { crearCliente, estadoInicialClientes, moverEtapa, vincularCotizacion } from '@/features/clientes/service'
import { crearCotizacion, type Cotizacion, type CotizacionInput } from '@/features/cotizaciones/cotizacion'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor, InventoryState } from '@/features/inventario/types'
import { anularReserva, aprobarReserva, reservasVisibles, ReservaError, solicitarReserva, verificarPagoReserva, type Estado } from '../service'
import { estadoInicialReservas } from '../service'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

const asesor: Actor = { id: 'u-ana-asesora', nombre: 'Ana Asesora', rol: 'asesor' }
const gerencia: Actor = { id: 'u-gerencia', nombre: 'Gerencia', rol: 'gerencia' }
const admin: Actor = { id: 'u-admin', nombre: 'Admin', rol: 'administrador' }
const corredor: Actor = { id: 'u-carlos-corredor', nombre: 'Carlos Corredor', rol: 'corredor' }
const finanzas: Actor = { id: 'u-finanzas', nombre: 'Finanzas', rol: 'finanzas' }

/** Tres pasos: el vendedor solicita (fuera de esta función); Finanzas verifica el ingreso; Gerencia aprueba. */
const confirmar = (e: Estado, id: string, input: { comprobante: string; montoRecibido: number }, aprobador: Actor) =>
  aprobarReserva(verificarPagoReserva(e, id, input, finanzas), id, 'Aprobada en comité', aprobador)

/** Lleva una unidad a vendida, para probar que no se reserva. */
const vendida = (s: InventoryState, codigo: string): InventoryState => ({ ...s, units: s.units.map((u) => (u.codigo === codigo ? { ...u, estado: 'vendido' as const } : u)) })

/** Escenario: cliente, unidad disponible y cotización emitida para ese cliente. */
function escenario(opts: { fecha?: string; unidad?: string; descuento?: number } = {}) {
  const unidad = opts.unidad ?? 'E1-PB-A2'
  const inv: InventoryState = createInitialState()
  const cli = crearCliente(estadoInicialClientes(), {
    nombre: 'María Pérez', telefono: '0991234567', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [unidad],
    presupuesto: null, proposito: null, formaPago: null, asesorId: asesor.id, asesor: asesor.nombre,
  }, asesor, inv)
  const input: CotizacionInput = {
    codigo: unidad, clienteId: cli.cliente.id,
    cliente: { nombre: 'María Pérez', email: '', telefono: '0991234567' },
    asesor: { nombre: 'Ana Asesora', email: 'ana@nuvarel.com', telefono: '' },
    descuentoPct: opts.descuento ?? 0, vigenciaDias: 15, fecha: opts.fecha ?? hoyGuayaquil(), observaciones: '',
  }
  const cot: Cotizacion = crearCotizacion(inv, input, opts.descuento ? gerencia : asesor, [])
  const e: Estado = { inv, clientes: cli.state, res: estadoInicialReservas() }
  return { e, cot, clienteId: cli.cliente.id }
}

const pago = (monto: number, comprobante = 'TRF-00123') => ({ comprobante, montoRecibido: monto })

describe('solicitud de reserva', () => {
  it('crea una solicitud sin bloquear la unidad', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(s.res.reservas[0]).toMatchObject({ estado: 'solicitada', unidad: 'E1-PB-A2', cotizacionNumero: cot.numero, montoReserva: 500 })
    expect(s.inv.units.find((u) => u.codigo === 'E1-PB-A2')!.estado).toBe('disponible')
  })

  it('no permite solicitar una unidad vendida', () => {
    const { e, cot } = escenario()
    expect(() => solicitarReserva({ ...e, inv: vendida(e.inv, cot.unidad.codigo) }, cot, asesor)).toThrow(/vendido y no puede reservarse/)
  })

  it('no permite solicitar con cotización vencida', () => {
    const { e, cot } = escenario({ fecha: '2020-01-01' })
    expect(() => solicitarReserva(e, cot, asesor)).toThrow(/venció/)
  })

  it('no permite una segunda reserva activa sobre la misma unidad', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => solicitarReserva(s, cot, gerencia)).toThrow(/ya tiene la reserva/)
  })

  it('exige cotización vinculada a un cliente', () => {
    const { e, cot } = escenario()
    expect(() => solicitarReserva(e, { ...cot, clienteId: undefined }, asesor)).toThrow(/vinculada a un cliente/)
  })

  it('corredores solicitan; solo ven sus propias solicitudes', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, corredor)
    expect(reservasVisibles(s.res.reservas, corredor)).toHaveLength(1)
    expect(reservasVisibles(s.res.reservas, asesor)).toHaveLength(1) // es el responsable del cliente
    expect(reservasVisibles(s.res.reservas, { id: 'u-otro', nombre: 'Otro', rol: 'asesor' })).toHaveLength(0)
    expect(reservasVisibles(s.res.reservas, admin)).toHaveLength(1)
  })
})

describe('confirmación de reserva', () => {
  it('con condiciones normales, verificar el pago confirma la reserva sin aprobación de Gerencia', () => {
    const { e, cot, clienteId } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    const id = s.res.reservas[0].id
    const c = verificarPagoReserva(s, id, pago(cot.plan.reserva), finanzas)
    const u = c.inv.units.find((x) => x.codigo === 'E1-PB-A2')!
    expect(u).toMatchObject({ estado: 'reservado', reservaId: c.res.reservas[0].codigo })
    expect(c.res.reservas[0]).toMatchObject({ estado: 'confirmada', comprobante: 'TRF-00123', verificadaPor: { id: finanzas.id }, aprobadaPor: null })
    expect(c.clientes.clientes.find((x) => x.id === clienteId)!.etapa).toBe('reserva')
    expect(c.res.reservas[0].historial[0].texto).toMatch(/confirmada automáticamente/)
    // Aprobar después no cambia nada.
    expect(aprobarReserva(c, id, 'Doble clic', gerencia)).toBe(c)
  })

  it('con descuento queda como excepción: Gerencia la autoriza y la unidad se bloquea al autorizar', () => {
    const { e, cot } = escenario({ descuento: 2 })
    const s = solicitarReserva(e, cot, asesor)
    const id = s.res.reservas[0].id
    const v = verificarPagoReserva(s, id, pago(cot.plan.reserva), finanzas)
    expect(v.res.reservas[0].estado).toBe('pago_verificado')
    expect(v.inv.units.find((x) => x.codigo === 'E1-PB-A2')!.estado).toBe('disponible')
    const c = aprobarReserva(v, id, 'Descuento autorizado', gerencia)
    expect(c.res.reservas[0]).toMatchObject({ estado: 'confirmada', aprobadaPor: { id: gerencia.id } })
    expect(c.inv.units.find((x) => x.codigo === 'E1-PB-A2')!.estado).toBe('reservado')
  })

  it('no confirma con un monto menor a la reserva acordada', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => confirmar(s, s.res.reservas[0].id, pago(499), gerencia)).toThrow(/menor a la reserva/)
  })

  it('exige comprobante de pago', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => confirmar(s, s.res.reservas[0].id, pago(cot.plan.reserva, ' '), gerencia)).toThrow(/comprobante/)
  })

  it('no confirma si la cotización venció entre la solicitud y el pago', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    const vencida: Estado = { ...s, res: { ...s.res, reservas: s.res.reservas.map((r) => ({ ...r, vigenciaHasta: '2020-01-16' })) } }
    expect(() => confirmar(vencida, vencida.res.reservas[0].id, pago(cot.plan.reserva), gerencia)).toThrow(/venció/)
  })

  it('quien verificó el pago no puede aprobar la reserva', () => {
    const { e, cot } = escenario({ descuento: 2 })
    const pedida = solicitarReserva(e, cot, asesor)
    // Un administrador tiene ambos permisos: aun así no puede verificar y autorizar la misma excepción.
    const s = verificarPagoReserva(pedida, pedida.res.reservas[0].id, pago(cot.plan.reserva), admin)
    expect(() => aprobarReserva(s, s.res.reservas[0].id, 'Motivo válido', admin)).toThrow(/no puede aprobar/)
  })

  it('quien solicita la reserva no puede verificar su propio pago', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => verificarPagoReserva(s, s.res.reservas[0].id, pago(cot.plan.reserva), asesor)).toThrow(/no puede verificar su pago|No tienes permiso/)
  })

  it('gerencia aprueba, pero no verifica pagos', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => verificarPagoReserva(s, s.res.reservas[0].id, pago(cot.plan.reserva), gerencia)).toThrow(PermissionError)
  })

  it('no se aprueba una reserva que aún no tiene el pago verificado', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => aprobarReserva(s, s.res.reservas[0].id, 'Motivo válido', gerencia)).toThrow(/pago verificado/)
  })

  it('asesores no confirman reservas', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => confirmar(s, s.res.reservas[0].id, pago(cot.plan.reserva), asesor)).toThrow(PermissionError)
  })

  it('una confirmación no puede dejar la misma unidad reservada dos veces', () => {
    const { e, cot } = escenario()
    const s1 = solicitarReserva(e, cot, asesor)
    const id1 = s1.res.reservas[0].id
    // Una segunda solicitud solo es posible si la primera se anula; simulamos dos solicitudes con la misma unidad.
    const dup: Estado = { ...s1, res: { ...s1.res, reservas: [{ ...s1.res.reservas[0], id: 'otra', codigo: 'RES-X' }, ...s1.res.reservas] } }
    const c = confirmar(dup, id1, pago(cot.plan.reserva), gerencia)
    expect(() => confirmar(c, 'otra', pago(cot.plan.reserva), gerencia)).toThrow(/ya está reservada|ya está confirmada|reservado|no está disponible/)
  })

  it('si falla una regla no se modifica ningún dato', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    const antes = JSON.stringify(s)
    expect(() => confirmar(s, s.res.reservas[0].id, pago(1), gerencia)).toThrow(ReservaError)
    expect(JSON.stringify(s)).toBe(antes)
  })
})

describe('anulación', () => {
  it('anular una confirmada libera la unidad y devuelve al cliente a Negociación', () => {
    const { e, cot, clienteId } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    const id = s.res.reservas[0].id
    const c = confirmar(s, id, pago(cot.plan.reserva), gerencia)
    const a = anularReserva(c, id, 'El cliente desistió', admin)
    expect(a.inv.units.find((u) => u.codigo === 'E1-PB-A2')!).toMatchObject({ estado: 'disponible', reservaId: null })
    expect(a.res.reservas[0]).toMatchObject({ estado: 'anulada', motivoAnulacion: 'El cliente desistió' })
    expect(a.clientes.clientes.find((x) => x.id === clienteId)!.etapa).toBe('negociacion')
  })

  it('anular una solicitud no toca el inventario', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    const a = anularReserva(s, s.res.reservas[0].id, 'Cliente cambió de opinión', gerencia)
    expect(a.inv).toBe(s.inv)
    expect(a.res.reservas[0].estado).toBe('anulada')
  })

  it('asesores no anulan y el motivo es obligatorio', () => {
    const { e, cot } = escenario()
    const s = solicitarReserva(e, cot, asesor)
    expect(() => anularReserva(s, s.res.reservas[0].id, 'Motivo válido', asesor)).toThrow(PermissionError)
    expect(() => anularReserva(s, s.res.reservas[0].id, 'x', gerencia)).toThrow(/motivo/)
  })
})

describe('reglas de Clientes', () => {
  it('la etapa Reserva ya no se puede asignar a mano', () => {
    const { e, clienteId } = escenario()
    expect(() => moverEtapa(e.clientes, clienteId, 'reserva', asesor)).toThrow(/módulo Reservas/)
  })

  it('una cotización vinculada no adelanta al cliente a Reserva', () => {
    const { e, cot, clienteId } = escenario()
    const c = vincularCotizacion(e.clientes, clienteId, { numero: cot.numero, codigo: cot.unidad.codigo, precioFinal: cot.plan.precioFinal }, asesor)
    expect(c.clientes[0].etapa).toBe('cotizacion')
  })
})
