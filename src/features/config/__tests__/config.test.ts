/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { can, PermissionError, puedeVerDe } from '@/app/permissions'
import { crearCliente, clientesVisibles, estadoInicialClientes } from '@/features/clientes/service'
import { createInitialState } from '@/features/inventario/service'
import type { DirectorioState, Usuario } from '../model'
import {
  actorDe, actualizarUsuario, cambiarEstadoUsuario, directorioInicial, fijarExcepcion, guardarEquipo, guardarRol,
  ID_ADMIN_INICIAL, invitarUsuario, permisosEfectivos, type UsuarioInput,
} from '../service'

const motivo = 'Alta del equipo comercial'
const base = (o: Partial<UsuarioInput>): UsuarioInput => ({ nombre: 'Persona', email: 'x@nuvarel.com', rolId: 'asesor', alcance: null, supervisorId: null, equipoId: null, proyectos: ['AMURA'], ...o })
const admin = (d: DirectorioState) => actorDe(d, d.usuarios.find((u) => u.id === ID_ADMIN_INICIAL)!)
const activar = (d: DirectorioState, id: string) => cambiarEstadoUsuario(d, id, 'activo', 'Aceptó la invitación', admin(d))
const usuario = (d: DirectorioState, email: string) => d.usuarios.find((u) => u.email === email) as Usuario

/** Criterio 1: el administrador invita dos vendedores y un supervisor, y asigna equipo y proyectos. */
function escenario() {
  let d = directorioInicial()
  d = invitarUsuario(d, base({ nombre: 'Sofía Supervisora', email: 'sofia@nuvarel.com', rolId: 'supervisor' }), motivo, admin(d)).dir
  const sofia = usuario(d, 'sofia@nuvarel.com')
  d = guardarEquipo(d, null, { nombre: 'Equipo Norte', supervisorId: sofia.id, gerenciaIds: [] }, 'Crear equipo norte', admin(d))
  const norte = d.equipos[0]
  d = invitarUsuario(d, base({ nombre: 'Vera Vendedora', email: 'vera@nuvarel.com', equipoId: norte.id }), motivo, admin(d)).dir
  d = invitarUsuario(d, base({ nombre: 'Víctor Vendedor', email: 'victor@nuvarel.com', equipoId: null }), motivo, admin(d)).dir
  for (const e of ['sofia@nuvarel.com', 'vera@nuvarel.com', 'victor@nuvarel.com']) d = activar(d, usuario(d, e).id)
  return { d, sofia: usuario(d, 'sofia@nuvarel.com'), vera: usuario(d, 'vera@nuvarel.com'), victor: usuario(d, 'victor@nuvarel.com') }
}

describe('usuarios y alcance', () => {
  it('estado inicial: perfiles plantilla y un solo administrador, sin personas ficticias', () => {
    const d = directorioInicial()
    expect(d.usuarios).toHaveLength(1)
    expect(d.roles.map((r) => r.id)).toEqual(['administrador', 'gerencia', 'supervisor', 'asesor', 'corredor'])
  })

  it('los invitados no tienen acceso hasta activarse', () => {
    let d = directorioInicial()
    d = invitarUsuario(d, base({ email: 'nuevo@nuvarel.com' }), motivo, admin(d)).dir
    expect(permisosEfectivos(d, usuario(d, 'nuevo@nuvarel.com'))).toEqual([])
  })

  it('criterio 2 y 3: cada vendedor ve lo suyo; el supervisor ve su equipo y no otros', () => {
    const { d, sofia, vera, victor } = escenario()
    const inv = createInitialState()
    const nuevoCliente = (state: ReturnType<typeof estadoInicialClientes>, u: Usuario, tel: string) =>
      crearCliente(state, { nombre: `Cliente de ${u.nombre}`, telefono: tel, email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [], presupuesto: null, proposito: null, formaPago: null, asesorId: u.id, asesor: u.nombre }, actorDe(d, u), inv).state
    let c = nuevoCliente(estadoInicialClientes(), vera, '0990000001')
    c = nuevoCliente(c, victor, '0990000002')
    expect(clientesVisibles(c.clientes, actorDe(d, vera)).map((x) => x.nombre)).toEqual(['Cliente de Vera Vendedora'])
    expect(clientesVisibles(c.clientes, actorDe(d, victor)).map((x) => x.nombre)).toEqual(['Cliente de Víctor Vendedor'])
    expect(clientesVisibles(c.clientes, actorDe(d, sofia)).map((x) => x.nombre)).toEqual(['Cliente de Vera Vendedora'])
    // Criterio 5: conocer el identificador de otro registro no da acceso.
    expect(puedeVerDe(actorDe(d, sofia), [victor.id])).toBe(false)
    expect(clientesVisibles(c.clientes, admin(d))).toHaveLength(2)
  })

  it('criterio 4: una excepción individual cambia solo a esa persona', () => {
    const { d, vera, victor } = escenario()
    const d2 = fijarExcepcion(d, vera.id, 'inventario.ver', 'denegar', 'Acceso restringido temporal', admin(d))
    expect(can(actorDe(d2, usuario(d2, vera.email)), 'inventario.ver')).toBe(false)
    expect(can(actorDe(d2, usuario(d2, victor.email)), 'inventario.ver')).toBe(true)
    const d3 = fijarExcepcion(d2, victor.id, 'cotizaciones.descuento', 'permitir', 'Autorizado por gerencia', admin(d2))
    expect(can(actorDe(d3, usuario(d3, victor.email)), 'cotizaciones.descuento')).toBe(true)
    // Heredar elimina la excepción
    const d4 = fijarExcepcion(d3, vera.id, 'inventario.ver', 'heredar', 'Fin de la restricción', admin(d3))
    expect(can(actorDe(d4, usuario(d4, vera.email)), 'inventario.ver')).toBe(true)
  })

  it('criterio 6: solo quienes tienen permiso confirman reservas o aprueban precios', () => {
    const { d, vera, sofia } = escenario()
    for (const u of [vera, sofia]) {
      const a = actorDe(d, u)
      expect(can(a, 'reservas.confirmar')).toBe(false)
      expect(can(a, 'reservas.verificar_pago')).toBe(false)
      expect(can(a, 'precios.aprobar')).toBe(false)
    }
    expect(can(admin(d), 'precios.aprobar')).toBe(true)
  })

  it('criterio 7: desactivar bloquea el acceso; el usuario sigue existiendo para su historial', () => {
    const { d, vera } = escenario()
    const d2 = cambiarEstadoUsuario(d, vera.id, 'inactivo', 'Dejó la empresa', admin(d))
    const v = usuario(d2, vera.email)
    expect(v.estado).toBe('inactivo')
    expect(permisosEfectivos(d2, v)).toEqual([])
  })

  it('criterio 8: cada cambio de acceso queda en auditoría con actor, motivo, antes y después', () => {
    const { d, vera } = escenario()
    const d2 = actualizarUsuario(d, vera.id, base({ nombre: vera.nombre, email: vera.email, rolId: 'supervisor' }), 'Ascenso a supervisora', admin(d))
    const a = d2.auditoria[0]
    expect(a).toMatchObject({ accion: 'Editar usuario', actorId: ID_ADMIN_INICIAL, motivo: 'Ascenso a supervisora', entidadId: vera.id })
    expect(a.antes).toMatch(/rol Vendedor/)
    expect(a.despues).toMatch(/rol Supervisor/)
    expect(d2.auditoria.length).toBeGreaterThan(d.auditoria.length)
  })
})

describe('reglas de control', () => {
  it('no se puede dejar la empresa sin administrador activo', () => {
    const d = directorioInicial()
    expect(() => cambiarEstadoUsuario(d, ID_ADMIN_INICIAL, 'inactivo', 'Prueba de bloqueo', admin(d))).toThrow(/administrador activo/)
  })

  it('nadie se asigna a sí mismo un rol superior ni amplía sus permisos', () => {
    const { d, sofia } = escenario()
    const d2 = fijarExcepcion(d, sofia.id, 'config.usuarios', 'permitir', 'Apoyo administrativo', admin(d))
    const s = actorDe(d2, usuario(d2, sofia.email))
    expect(() => actualizarUsuario(d2, sofia.id, base({ nombre: sofia.nombre, email: sofia.email, rolId: 'administrador' }), 'Me asciendo', s)).toThrow(/propio rol|no tienes|No puedes/)
    expect(() => fijarExcepcion(d2, sofia.id, 'precios.aprobar', 'permitir', 'Me autorizo', s)).toThrow(PermissionError)
  })

  it('no se pueden conceder permisos que uno no tiene', () => {
    const { d, sofia, vera } = escenario()
    const d2 = fijarExcepcion(d, sofia.id, 'config.usuarios', 'permitir', 'Apoyo administrativo', admin(d))
    const s = actorDe(d2, usuario(d2, sofia.email))
    expect(() => actualizarUsuario(d2, vera.id, base({ nombre: vera.nombre, email: vera.email, rolId: 'administrador' }), 'Subir a Vera', s)).toThrow(/no tienes/)
  })

  it('roles configurables: crear un perfil nuevo con permisos y alcance', () => {
    const d = directorioInicial()
    const d2 = guardarRol(d, null, { nombre: 'Operaciones', descripcion: 'Back office', alcance: 'empresa', permisos: ['reservas.ver', 'cobranzas.ver', 'cobranzas.registrar'] }, 'Nuevo perfil de operaciones', admin(d))
    expect(d2.roles.at(-1)).toMatchObject({ nombre: 'Operaciones', sistema: false, alcance: 'empresa' })
    expect(d2.auditoria[0].accion).toBe('Crear rol')
  })

  it('quitar config.usuarios al rol de administrador no deja la empresa sin administrador', () => {
    const d = directorioInicial()
    const rol = d.roles.find((r) => r.id === 'administrador')!
    expect(() => guardarRol(d, 'administrador', { ...rol, permisos: rol.permisos.filter((p) => p !== 'config.usuarios') }, 'Quitar administración', admin(d))).toThrow(/administrador activo/)
  })

  it('correos únicos y motivo obligatorio', () => {
    const { d } = escenario()
    expect(() => invitarUsuario(d, base({ email: 'vera@nuvarel.com' }), motivo, admin(d))).toThrow(/correo/)
    expect(() => invitarUsuario(d, base({ email: 'nueva@nuvarel.com' }), '', admin(d))).toThrow(/motivo/)
  })
})

describe('semilla SQL de roles', () => {
  it('supabase/seed_roles.sql coincide con el catálogo y los perfiles de la app', async () => {
    const fs = await import('node:fs')
    const { generarSqlRoles } = await import('../sql')
    const normal = (s: string) => s.split('\r\n').join('\n')
    expect(normal(fs.readFileSync('supabase/seed_roles.sql', 'utf8'))).toBe(generarSqlRoles())
  })
})
