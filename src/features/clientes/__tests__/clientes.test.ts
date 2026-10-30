import { describe, expect, it } from 'vitest'
import { PermissionError } from '@/app/permissions'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { createInitialState } from '@/features/inventario/service'
import type { Actor } from '@/features/inventario/types'
import {
  actualizarCliente, clientesVisibles, completarProxima, crearCliente, estadoInicialClientes, moverEtapa,
  programarProxima, registrarActividad, resumenClientes, urgencia, vincularCotizacion, type ClienteInput,
} from '../service'

const asesor: Actor = { id: 'u-ana-asesora', nombre: 'Ana Asesora', rol: 'asesor' }
const gerencia: Actor = { id: 'u-gerencia', nombre: 'Gerencia', rol: 'gerencia', alcance: { tipo: 'empresa', usuarios: [] } }
const corredor: Actor = { id: 'u-carlos-corredor', nombre: 'Carlos Corredor', rol: 'corredor' }
const inv = createInitialState()

const input = (o: Partial<ClienteInput> = {}): ClienteInput => ({
  nombre: 'María Pérez', telefono: '0991234567', email: 'maria@correo.com', origen: 'instagram', origenDetalle: '',
  unidadesInteres: [], presupuesto: 170000, proposito: 'vivir', formaPago: 'banco', asesorId: asesor.id, asesor: asesor.nombre, ...o,
})
const nuevo = (o: Partial<ClienteInput> = {}, actor = asesor) => crearCliente(estadoInicialClientes(), input(o), actor, inv)
const fecha = (dias: number) => { const [y, m, d] = hoyGuayaquil().split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10) }

describe('registro de clientes', () => {
  it('crea el cliente en etapa Nuevo con historial', () => {
    const { state, cliente } = nuevo()
    expect(state.clientes).toHaveLength(1)
    expect(cliente).toMatchObject({ etapa: 'nuevo', asesor: 'Ana Asesora', formaPago: 'banco', proposito: 'vivir' })
    expect(cliente.actividades[0].descripcion).toMatch(/Cliente registrado/)
  })

  it('valida datos y origen', () => {
    expect(() => nuevo({ nombre: '' })).toThrow(/nombre/)
    expect(() => nuevo({ telefono: '', email: '' })).toThrow(/teléfono o un correo/)
    expect(() => nuevo({ email: 'malo' })).toThrow(/correo/)
    expect(() => nuevo({ origen: 'referido' })).toThrow(/refirió/)
    expect(() => nuevo({ origen: 'corredor' })).toThrow(/corredor/)
    expect(() => nuevo({ unidadesInteres: ['E9-PB-A1'] })).toThrow(/inexistentes/)
    expect(() => nuevo({ presupuesto: -5 })).toThrow(/presupuesto/)
  })

  it('evita duplicados por teléfono o correo', () => {
    const { state } = nuevo()
    expect(() => crearCliente(state, input({ nombre: 'Otra persona', email: '', telefono: '+593 99 123 4567' }), asesor, inv)).toThrow(/Ya existe/)
    expect(() => crearCliente(state, input({ nombre: 'Otra persona', telefono: '', email: 'MARIA@correo.com' }), asesor, inv)).toThrow(/Ya existe/)
  })

  it('solo quien tiene permiso asigna o reasigna, y la atribución de origen se conserva', () => {
    expect(() => nuevo({ asesorId: 'u-otro', asesor: 'Otro Asesor' })).toThrow(/permiso para asignar/)
    const { state, cliente } = nuevo({ asesorId: 'u-otro', asesor: 'Otro Asesor' }, gerencia)
    expect(cliente).toMatchObject({ asesorId: 'u-otro', asesor: 'Otro Asesor', atribucion: { usuarioId: 'u-gerencia' } })
    expect(() => actualizarCliente(state, cliente.id, input({ asesorId: asesor.id, asesor: 'Ana Asesora' }), gerencia, inv)).toThrow(/motivo de la reasignación/)
    const s2 = actualizarCliente(state, cliente.id, input({ asesorId: asesor.id, asesor: 'Ana Asesora', motivoAsignacion: 'Cambio de zona' }), gerencia, inv)
    expect(s2.clientes[0].actividades[0].descripcion).toMatch(/reasignado.*Cambio de zona/)
    expect(s2.clientes[0].atribucion.usuarioId).toBe('u-gerencia')
  })

  it('un supervisor solo asigna dentro de su equipo', () => {
    const supervisor: Actor = { id: 'u-sup', nombre: 'Sup', rol: 'supervisor', alcance: { tipo: 'equipo', usuarios: ['u-sup', 'u-ana-asesora'] } }
    expect(nuevo({ asesorId: 'u-ana-asesora' }, supervisor).cliente.asesorId).toBe('u-ana-asesora')
    expect(() => nuevo({ asesorId: 'u-fuera', asesor: 'Fuera' }, supervisor)).toThrow(/tu equipo/)
  })

  it('el aviso de duplicado no revela datos de otro equipo', () => {
    const { state } = nuevo()
    const otro: Actor = { id: 'u-otro', nombre: 'Otro', rol: 'asesor' }
    expect(() => crearCliente(state, input({ nombre: 'X Y Z', email: '', asesorId: 'u-otro', asesor: 'Otro' }), otro, inv)).toThrow(/otro equipo/)
    expect(() => crearCliente(state, input({ nombre: 'X Y Z', email: '', asesorId: 'u-otro', asesor: 'Otro' }), otro, inv)).not.toThrow(/María/)
  })

  it('corredores ven solo sus clientes', () => {
    const a = nuevo()
    const b = crearCliente(a.state, input({ nombre: 'Cliente Corredor', telefono: '0987654321', email: '', asesorId: corredor.id, asesor: corredor.nombre, origen: 'corredor', origenDetalle: 'Carlos Corredor' }), corredor, inv)
    expect(clientesVisibles(b.state.clientes, corredor).map((c) => c.nombre)).toEqual(['Cliente Corredor'])
    // Un vendedor ve por defecto solo los suyos; la visibilidad ampliada se concede expresamente.
    expect(clientesVisibles(b.state.clientes, asesor).map((c) => c.nombre)).toEqual(['María Pérez'])
    expect(clientesVisibles(b.state.clientes, gerencia)).toHaveLength(2)
    expect(() => moverEtapa(b.state, a.cliente.id, 'contactado', corredor)).toThrow(/no tienes acceso/)
  })
})

describe('tablero comercial', () => {
  it('Perdido exige motivo y Seguimiento futuro una fecha futura', () => {
    const { state, cliente } = nuevo()
    expect(() => moverEtapa(state, cliente.id, 'perdido', asesor)).toThrow(/motivo/)
    const p = moverEtapa(state, cliente.id, 'perdido', asesor, { motivo: 'Compró en otro proyecto' })
    expect(p.clientes[0]).toMatchObject({ etapa: 'perdido', motivoPerdida: 'Compró en otro proyecto', proxima: null })
    expect(() => moverEtapa(state, cliente.id, 'seguimiento', asesor, { fechaRetomar: hoyGuayaquil() })).toThrow(/futura/)
    const s = moverEtapa(state, cliente.id, 'seguimiento', asesor, { fechaRetomar: fecha(60) })
    expect(s.clientes[0]).toMatchObject({ etapa: 'seguimiento', fechaRetomar: fecha(60) })
    expect(s.clientes[0].proxima?.fecha).toBe(fecha(60))
  })

  it('Cotización y Negociación requieren departamento; Reserva requiere cotización', () => {
    const { state, cliente } = nuevo()
    expect(() => moverEtapa(state, cliente.id, 'cotizacion', asesor)).toThrow(/departamento/)
    const s1 = actualizarCliente(state, cliente.id, input({ unidadesInteres: ['E1-PB-A2'] }), asesor, inv)
    expect(moverEtapa(s1, cliente.id, 'negociacion', asesor).clientes[0].etapa).toBe('negociacion')
    expect(() => moverEtapa(s1, cliente.id, 'reserva', asesor)).toThrow(/módulo Reservas/)
  })

  it('registrar una llamada a un cliente nuevo lo pasa a Contactado', () => {
    const { state, cliente } = nuevo()
    const s = registrarActividad(state, cliente.id, { tipo: 'llamada', descripcion: 'Primera llamada, interesado en 2 hab', fecha: hoyGuayaquil() }, asesor)
    expect(s.clientes[0].etapa).toBe('contactado')
    expect(s.clientes[0].actividades.map((a) => a.tipo).slice(0, 2)).toEqual(['etapa', 'llamada'])
    expect(() => registrarActividad(state, cliente.id, { tipo: 'llamada', descripcion: 'Llamada futura', fecha: fecha(2) }, asesor)).toThrow(/futura/)
  })

  it('próxima actividad, urgencia y completado', () => {
    const { state, cliente } = nuevo()
    expect(urgencia(cliente)).toBe('sin_actividad')
    const s1 = programarProxima(state, cliente.id, { tipo: 'visita', descripcion: 'Visita al proyecto', fecha: fecha(-1) }, asesor)
    expect(urgencia(s1.clientes[0])).toBe('vencida')
    expect(resumenClientes(s1.clientes).vencidas).toBe(1)
    const s2 = completarProxima(s1, cliente.id, 'Le gustó el 1002', asesor)
    expect(s2.clientes[0].proxima).toBeNull()
    expect(s2.clientes[0].actividades.some((a) => a.tipo === 'visita' && /Le gustó el 1002/.test(a.descripcion))).toBe(true)
  })

  it('vincular una cotización registra el historial y avanza a Cotización', () => {
    const { state, cliente } = nuevo()
    const s = vincularCotizacion(state, cliente.id, { numero: 'COT-2026-0001', codigo: 'E1-PB-A2', precioFinal: 172147.2 }, asesor)
    expect(s.clientes[0]).toMatchObject({ etapa: 'cotizacion', cotizaciones: ['COT-2026-0001'], unidadesInteres: ['E1-PB-A2'] })
    // Desde Negociación no retrocede
    const n = moverEtapa(s, cliente.id, 'negociacion', asesor)
    expect(vincularCotizacion(n, cliente.id, { numero: 'COT-2026-0002', codigo: 'E1-PB-A2', precioFinal: 170000 }, asesor).clientes[0].etapa).toBe('negociacion')
  })

  it('el rol sin permiso no edita', () => {
    // Todos los roles comerciales editan clientes; se valida que la verificación existe.
    expect(() => crearCliente(estadoInicialClientes(), input(), { id: 'u-x', nombre: 'X', rol: 'nadie' as never }, inv)).toThrow(PermissionError)
  })
})
