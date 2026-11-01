// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { TODOS_LOS_PERMISOS } from '../../src/app/permissions'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cargarInventario } from '../../src/features/inventario/remoto'
import { gestionarCuenta, type AdminAuth, type ClienteUsuario, type Peticion } from '../functions/_shared/cuentas'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, sofia: string, vera: string, valeria: string, carlos: string, obra: string, jarval: string, equipo: string
const hoy = hoyGuayaquil()
let n = 991100000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const filas = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows)
const permisos = async (rol: string) => (await db.query<{ permiso: string }>(`select permiso from public.role_permissions where role_id = $1`, [rol])).rows.map((r) => r.permiso)
const tiene = (u: string, p: string) => rpc<{ r: boolean }>(u, `select public.tiene_permiso($1) as r`, [p]).then((x) => x.r)

/** El cliente de la función de cuentas, con la sesión del usuario contra la base real. */
const clienteDe = (u: string): ClienteUsuario => ({
  rpc: async (fn, args = {}) => {
    const claves = Object.keys(args)
    try {
      const { rows } = await como(db, u, () => db.query(`select public.${fn}(${claves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, claves.map((k) => args[k])))
      return { data: (rows[0] as { r: unknown }).r, error: null }
    } catch (e) { return { error: { message: (e as Error).message } } }
  },
})
function adminFalso() {
  const a = {
    createUser: vi.fn(async (p: { email: string }) => {
      if ((await db.query(`select 1 from auth.users where email = $1`, [p.email])).rows.length) return { data: { user: null }, error: { message: 'User already registered' } }
      const { rows } = await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [p.email])
      return { data: { user: { id: rows[0].id } }, error: null }
    }),
    updateUserById: vi.fn(async () => ({ error: null })),
    deleteUser: vi.fn(async (id: string) => { await db.query(`delete from auth.users where id = $1`, [id]); return { error: null } }),
  }
  return a as typeof a & AdminAuth
}
const alta = (o: Partial<Extract<Peticion, { accion: 'crear' }>> = {}): Peticion => ({ accion: 'crear', nombre: 'Persona Nueva', email: `nueva${++n}@amura.ec`, password: 'Clave-Inicial-1', rolId: 'asesor', alcance: null, equipoId: null, supervisorId: null, motivo: 'Alta de personal', ...o })

async function venta(u: string, nombre: string, codigo: string) {
  const c = (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: `0${++n}`, origen: 'whatsapp' }), u])).id
  const op = (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
  const cot = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(u, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 6)}`])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, 500, $2::date, $3, true, 'Ingreso confirmado')`, [r, hoy, `BAN-${r.slice(0, 6)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const k = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoy])).id
  await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contrato.pdf')`, [k, hoy])
  return { cliente: c, contrato: k }
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Andrés Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gabriela Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  sofia = await crearUsuario(db, 'Sofía Supervisora', 'supervisor')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  valeria = await crearUsuario(db, 'Valeria Vendedora', 'asesor')
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  obra = await crearUsuario(db, 'Omar Constructor', 'constructor')
  jarval = await crearUsuario(db, 'Promotor Jarval', 'jarval')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('matriz aprobada de perfiles', () => {
  it('existen los ocho perfiles, y el catálogo de la app coincide con la base', async () => {
    const roles = (await db.query<{ id: string; nombre: string; disponible: boolean }>(`select id, nombre, disponible from public.roles where sistema order by id`)).rows
    expect(roles.filter((r) => r.disponible).map((r) => r.nombre).sort()).toEqual(['Administrador', 'Constructor', 'Corredor', 'Finanzas', 'Gerencia', 'Legal', 'Supervisor', 'Vendedor'])
    const catalogo = (await db.query<{ clave: string }>(`select clave from public.permissions`)).rows.map((r) => r.clave)
    expect([...catalogo].sort()).toEqual([...TODOS_LOS_PERMISOS].sort())
    expect((await permisos('administrador')).length).toBe(TODOS_LOS_PERMISOS.length)
  })

  it('vendedor: consulta y crea lo suyo; no aprueba, no fija precios ni confirma pagos', async () => {
    const p = await permisos('asesor')
    expect(p).toEqual(expect.arrayContaining(['inventario.ver', 'financiamiento.simular', 'clientes.editar', 'cotizaciones.crear', 'reservas.solicitar', 'ventas.ver', 'cobranzas.ver', 'comisiones.ver_propias']))
    for (const x of ['precios.aprobar', 'precios.proponer', 'cotizaciones.descuento', 'reservas.verificar_pago', 'reservas.confirmar', 'cobranzas.registrar', 'cobranzas.verificar', 'ventas.formalizar', 'ventas.preparar', 'inventario.editar_precios', 'config.usuarios']) expect(p, x).not.toContain(x)
  })

  it('supervisor y corredor consultan cobranzas sin registrar ni confirmar pagos', async () => {
    for (const rol of ['supervisor', 'corredor']) {
      const p = await permisos(rol)
      expect(p).toContain('cobranzas.ver')
      expect(p).not.toContain('cobranzas.registrar')
      expect(p).not.toContain('cobranzas.verificar')
    }
    expect(await permisos('supervisor')).toContain('corredores.ver')
  })

  it('constructor: información técnica y Avance de obra, sin datos comerciales', async () => {
    const p = await permisos('constructor'); expect(p).toEqual(expect.arrayContaining(['inventario.tecnico', 'obra.avance', 'obra.editar', 'obra.resumen'])); expect(p.filter((x) => !x.startsWith('obra.') && x !== 'inventario.tecnico')).toEqual([])
  })
})

describe('el servidor hace cumplir los permisos, no solo la pantalla', () => {
  it('un vendedor no cambia precios, ni aprueba descuentos, ni confirma pagos, ni toca contratos', async () => {
    await expect(rpc(vera, `select public.inventario_ajustar_precio('fijar', 2600, 'Intento de vendedora', array['E1-PB-A1'])`)).rejects.toThrow(/Sin permiso/)
    const c = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Descuento Negado', telefono: `0${++n}`, origen: 'whatsapp' }), vera])).id
    const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, 'E1-PB-A3', null) as id`, [c])).id
    await expect(rpc(vera, `select public.cotizaciones_emitir($1, 5, 30, '')`, [op])).rejects.toThrow(/descuento/i)
    const v = await venta(vera, 'Venta De Vera', 'E1-P1-A1')
    await expect(rpc(vera, `select public.cobranzas_reportar_pago($1::uuid, 100, $2::date, 'Banco de prueba', 'PAGO-X', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [v.contrato, hoy])).rejects.toThrow(/permiso/i)
    await expect(rpc(vera, `select public.contratos_anular($1, 'Intento de vendedora', 'x.pdf')`, [v.contrato])).rejects.toThrow(/Sin permiso/)
    await expect(como(db, vera, () => db.query(`update public.contracts set precio = 1 where id = $1`, [v.contrato]).then((r) => r.affectedRows))).resolves.toBe(0)
  })

  it('cada vendedor ve solo sus ventas y cobranzas; el supervisor, las de su equipo; otro no', async () => {
    equipo = (await rpc<{ id: string }>(admin, `select public.config_guardar_equipo(null, 'Equipo Norte', $1, null, 'Equipo comercial del norte') as id`, [sofia])).id
    const asignar = async (u: string) => {
      const p = await uno<{ rol_id: string; estado: string }>(`select rol_id, estado from public.profiles where id = $1`, [u])
      await rpc(admin, `select public.config_actualizar_usuario($1, $2, null, null, $3, array['AMURA'], $4, 'Asignación al equipo')`, [u, p.rol_id, equipo, p.estado])
    }
    await asignar(vera)
    const a = await venta(vera, 'Cliente De Vera', 'E1-P2-A1')
    const b = await venta(valeria, 'Cliente De Valeria', 'E1-P2-A2')
    const ve = (u: string, id: string, t = 'contracts') => filas(u, `select 1 from public.${t} where ${t === 'contracts' ? 'id' : 'contract_id'} = $1`, [id]).then((r) => r.length)
    expect(await ve(vera, a.contrato)).toBe(1)
    expect(await ve(vera, b.contrato)).toBe(0)
    expect(await ve(valeria, a.contrato)).toBe(0)
    expect(await ve(vera, a.contrato, 'payments')).toBe(1)
    expect(await ve(vera, b.contrato, 'payments')).toBe(0)
    expect(await ve(sofia, a.contrato)).toBe(1)
    expect(await ve(sofia, b.contrato)).toBe(0)
    expect(await ve(gerente, b.contrato)).toBe(1)
    expect((await filas(vera, `select 1 from public.clients where id = $1`, [b.cliente])).length).toBe(0)
    expect((await filas(vera, `select id from public.profiles`)).map((r) => (r as { id: string }).id)).toEqual([vera])
  })

  it('el constructor no lee precios, clientes, reservas, cobranzas, comisiones ni usuarios', async () => {
    for (const t of ['inventory_units', 'pricing_params', 'inventory_price_history', 'clients', 'opportunities', 'quotes', 'reservations', 'contracts', 'payments', 'audit_log']) {
      expect((await filas(obra, `select 1 from public.${t}`)).length, t).toBe(0)
    }
    await expect(rpc(obra, `select public.comisiones_listar()`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(obra, `select public.config_listar_cuentas()`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(obra, `select public.clientes_crear(null, '{}'::jsonb, $1)`, [obra])).rejects.toThrow(/Sin permiso/)
  })

  it('el constructor consulta la información técnica, sin ningún dato comercial', async () => {
    const r = await filas<Record<string, unknown>>(obra, `select * from public.inventario_tecnico()`)
    expect(r).toHaveLength(72)
    expect(r[0].codigo).toBe('E1-PB-A1')
    expect(Object.keys(r[0]).sort()).toEqual(['area_m2', 'bodega_codigo', 'bodega_m2', 'codigo', 'dpt', 'edificio', 'imagenes', 'parqueo', 'patio_m2', 'piso', 'plano_path', 'posicion', 'tipologia', 'ubicacion'])
    await expect(rpc(jarval, `select public.tiene_permiso('inventario.tecnico') as x`)).resolves.toEqual({ x: false })
    const vacio = (await rpc<{ r: string }>(admin, `select public.config_guardar_rol(null, 'Sin Permisos', '', 'propio', '{}', 'Rol sin permisos') as r`)).r
    const sinNada = await crearUsuario(db, 'Sin Nada', vacio)
    await expect(rpc(sinNada, `select * from public.inventario_tecnico()`)).rejects.toThrow(/Sin permiso/)
    await db.exec(`set role anon`)
    try { await expect(db.query(`select * from public.inventario_tecnico()`)).rejects.toThrow(/permission denied/) } finally { await db.exec(`reset role`) }
  })

  it('la app carga para el constructor sin error y sin unidades comerciales', async () => {
    const s = await cargarInventario(datosPglite(db, obra))
    expect(s.units).toEqual([])
  })

  it('desactivar quita de inmediato todos los permisos', async () => {
    const u = await crearUsuario(db, 'Se Desactiva', 'asesor')
    expect(await tiene(u, 'clientes.ver')).toBe(true)
    await rpc(admin, `select public.config_actualizar_usuario($1, 'asesor', null, null, null, array['AMURA'], 'inactivo', 'Dejó la empresa')`, [u])
    expect(await tiene(u, 'clientes.ver')).toBe(false)
    expect((await filas(u, `select 1 from public.inventory_units`)).length).toBe(0)
  })
})

describe('crear usuarios desde AMURA', () => {
  it('crea la cuenta confirmada, con contraseña, rol, alcance y equipo; ya tiene permisos y queda auditada sin la contraseña', async () => {
    const a = adminFalso()
    const email = 'vendedor.nuevo@amura.ec'
    const r = await gestionarCuenta(alta({ email: ` ${email.toUpperCase()} `, alcance: 'equipo', equipoId: equipo }), clienteDe(admin), a)
    expect(r.status).toBe(200)
    expect(a.createUser).toHaveBeenCalledWith({ email, password: 'Clave-Inicial-1', email_confirm: true, user_metadata: { nombre: 'Persona Nueva' } })
    const id = r.body.id!
    expect(await uno(`select nombre, email, estado, rol_id, alcance, equipo_id from public.profiles where id = $1`, [id])).toEqual({ nombre: 'Persona Nueva', email, estado: 'activo', rol_id: 'asesor', alcance: 'equipo', equipo_id: equipo })
    expect(await tiene(id, 'clientes.editar')).toBe(true)
    const log = await uno<{ actor_id: string; despues: Record<string, unknown> }>(`select actor_id, despues from public.audit_log where accion = 'Crear usuario' and entidad_id = $1`, [id])
    expect(log.actor_id).toBe(admin)
    expect(JSON.stringify(log)).not.toContain('Clave-Inicial-1')
  })

  it('quien no administra usuarios no crea cuentas, y no se llega a Auth', async () => {
    const a = adminFalso()
    for (const u of [vera, gerente, finanzas]) {
      const r = await gestionarCuenta(alta(), clienteDe(u), a)
      expect(r.status).toBe(403)
    }
    expect(a.createUser).not.toHaveBeenCalled()
  })

  it('sin contraseña, crea la cuenta con una aleatoria larga y distinta cada vez', async () => {
    const a = adminFalso()
    const c = clienteDe(admin)
    const base = alta({ email: 'sin.clave.1@amura.ec' }) as Extract<Peticion, { accion: 'crear' }>
    const { password: _omitida, ...sinClave } = base
    expect((await gestionarCuenta(sinClave, c, a)).status).toBe(200)
    expect((await gestionarCuenta({ ...sinClave, email: 'sin.clave.2@amura.ec' }, c, a)).status).toBe(200)
    const claves = (a.createUser as unknown as { mock: { calls: [{ password: string }][] } }).mock.calls.map((x) => x[0].password)
    expect(claves[0].length).toBeGreaterThanOrEqual(40)
    expect(claves[0]).not.toBe(claves[1])
  })

  it('valida antes de crear: contraseña, correo, motivo, rol retirado o inexistente', async () => {
    const a = adminFalso()
    const c = clienteDe(admin)
    expect((await gestionarCuenta(alta({ password: 'corta' }), c, a)).body.error).toMatch(/al menos 8/)
    expect((await gestionarCuenta(alta({ email: 'malo' }), c, a)).body.error).toMatch(/Correo/)
    expect((await gestionarCuenta(alta({ motivo: 'no' }), c, a)).body.error).toMatch(/Motivo/)
    expect((await gestionarCuenta(alta({ rolId: 'jarval' }), c, a)).body.error).toMatch(/no está disponible/)
    expect((await gestionarCuenta(alta({ rolId: 'no-existe' }), c, a)).body.error).toMatch(/no está disponible/)
    expect((await gestionarCuenta(alta({ alcance: 'otro' }), c, a)).body.error).toMatch(/Alcance/)
    expect(a.createUser).not.toHaveBeenCalled()
  })

  it('un correo repetido se explica, y si falla el perfil no queda una cuenta suelta', async () => {
    const a = adminFalso()
    const email = 'repetido@amura.ec'
    expect((await gestionarCuenta(alta({ email }), clienteDe(admin), a)).status).toBe(200)
    expect((await gestionarCuenta(alta({ email }), clienteDe(admin), a)).body.error).toBe('Ya existe una cuenta con ese correo')

    const cliente: ClienteUsuario = { rpc: (fn, args) => (fn === 'config_crear_perfil' ? Promise.resolve({ error: { message: 'Fallo del perfil' } }) : clienteDe(admin).rpc(fn, args)) }
    const r = await gestionarCuenta(alta({ email: 'suelta@amura.ec' }), cliente, a)
    expect(r.body.error).toBe('Fallo del perfil')
    expect(a.deleteUser).toHaveBeenCalledOnce()
    expect((await db.query(`select 1 from auth.users where email = 'suelta@amura.ec'`)).rows).toEqual([])
  })

  it('no se concede lo que no se tiene', async () => {
    const limitado = await crearUsuario(db, 'Admin Limitado', 'administrador')
    await rpc(admin, `select public.config_fijar_excepcion($1, 'precios.aprobar', 'denegar', 'Sin aprobación de precios')`, [limitado])
    const a = adminFalso()
    expect((await gestionarCuenta(alta({ rolId: 'administrador' }), clienteDe(limitado), a)).status).toBe(403)
    expect(a.createUser).not.toHaveBeenCalled()
  })

  it('JARVAL no se ofrece para cuentas nuevas, y quien ya lo tiene conserva su acceso', async () => {
    expect(await tiene(jarval, 'reportes.ver')).toBe(true)
    await db.query(`insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222', 'panel@amura.ec')`)
    await expect(rpc(admin, `select public.config_habilitar_cuenta('22222222-2222-4222-8222-222222222222', 'Desde Panel', 'jarval', 'Intento con rol retirado')`)).rejects.toThrow(/no está disponible/)
    await rpc(admin, `select public.config_actualizar_usuario($1, 'jarval', null, null, null, array['AMURA'], 'activo', 'Sigue con su rol')`, [jarval])
    expect((await uno<{ rol_id: string }>(`select rol_id from public.profiles where id = $1`, [jarval])).rol_id).toBe('jarval')
  })

  it('cambiar contraseña: solo administración, nunca la propia, no a quien tiene más permisos, y queda auditada', async () => {
    const a = adminFalso()
    const pet = (usuarioId: string): Peticion => ({ accion: 'clave', usuarioId, password: 'Nueva-Clave-22', motivo: 'Olvidó su contraseña' })
    expect((await gestionarCuenta(pet(vera), clienteDe(valeria), a)).status).toBe(403)
    expect((await gestionarCuenta(pet(admin), clienteDe(admin), a)).body.error).toMatch(/propia/)
    const limitado = await crearUsuario(db, 'Otro Limitado', 'administrador')
    await rpc(admin, `select public.config_fijar_excepcion($1, 'precios.aprobar', 'denegar', 'Sin aprobación de precios')`, [limitado])
    expect((await gestionarCuenta(pet(admin), clienteDe(limitado), a)).status).toBe(403)
    expect(a.updateUserById).not.toHaveBeenCalled()
    expect((await gestionarCuenta(pet(vera), clienteDe(admin), a)).status).toBe(200)
    expect(a.updateUserById).toHaveBeenCalledWith(vera, { password: 'Nueva-Clave-22' })
    const log = await uno(`select actor_id from public.audit_log where accion = 'Cambiar contraseña' and entidad_id = $1`, [vera])
    expect(log).toEqual({ actor_id: admin })
    expect(JSON.stringify((await db.query(`select * from public.audit_log where accion = 'Cambiar contraseña'`)).rows)).not.toContain('Nueva-Clave-22')
  })
})

describe('roles configurables', () => {
  const guardar = (u: string, id: string | null, permisosRol: string[], nombre = 'Marketing', alcance = 'propio', motivo = 'Rol de marketing') =>
    rpc<{ r: string }>(u, `select public.config_guardar_rol($1, $2, 'Descripción', $3, $4, $5) as r`, [id, nombre, alcance, permisosRol, motivo]).then((x) => x.r)

  it('el administrador crea y edita un rol; el cambio vale de inmediato y queda auditado con antes y después', async () => {
    const id = await guardar(admin, null, ['clientes.ver'])
    const u = await crearUsuario(db, 'Mara Marketing', id)
    expect(await tiene(u, 'clientes.ver')).toBe(true)
    expect(await tiene(u, 'clientes.editar')).toBe(false)
    await guardar(admin, id, ['clientes.ver', 'clientes.editar'], 'Marketing', 'equipo', 'Ahora también edita')
    expect(await tiene(u, 'clientes.editar')).toBe(true)
    const log = await uno<{ antes: { permisos: string[] }; despues: { permisos: string[]; alcance: string }; actor_id: string; motivo: string }>(`select antes, despues, actor_id, motivo from public.audit_log where accion = 'Editar rol' and entidad_id = $1`, [id])
    expect(log).toMatchObject({ actor_id: admin, motivo: 'Ahora también edita', antes: { permisos: ['clientes.ver'] }, despues: { permisos: ['clientes.editar', 'clientes.ver'], alcance: 'equipo' } })
  })

  it('quien no administra roles no los cambia, ni escribiendo directo en la tabla', async () => {
    await expect(guardar(gerente, null, ['clientes.ver'], 'Otro Rol')).rejects.toThrow(/Sin permiso/)
    await expect(como(db, vera, () => db.query(`insert into public.role_permissions values ('asesor', 'precios.aprobar')`))).rejects.toThrow(/row-level security|permission denied/)
    expect(await permisos('asesor')).not.toContain('precios.aprobar')
  })

  it('no se concede un permiso que no se tiene', async () => {
    const limitado = await crearUsuario(db, 'Roles Limitado', 'administrador')
    await rpc(admin, `select public.config_fijar_excepcion($1, 'precios.aprobar', 'denegar', 'Sin aprobación de precios')`, [limitado])
    await expect(guardar(limitado, null, ['precios.aprobar'], 'Escalada')).rejects.toThrow(/no tienes: precios.aprobar/)
    // Conservar uno que el rol ya tenía no es escalar.
    const p = await permisos('administrador')
    await expect(guardar(limitado, 'administrador', p, 'Administrador', 'empresa', 'Mismos permisos')).resolves.toBe('administrador')
  })

  it('valida datos, y Administrador no pierde lo que permite recuperar el sistema', async () => {
    await expect(guardar(admin, 'administrador', ['dashboard.ver'], 'Administrador', 'empresa', 'Quitar administración')).rejects.toThrow(/debe conservar/)
    expect(await permisos('administrador')).toContain('config.usuarios')
    await expect(guardar(admin, null, ['no.existe'], 'Rol Malo')).rejects.toThrow(/no existen/)
    await expect(guardar(admin, null, [], 'Gerencia')).rejects.toThrow(/Ya existe/)
    await expect(guardar(admin, null, [], 'Rol Alcance', 'todo')).rejects.toThrow(/Alcance/)
    await expect(guardar(admin, null, [], 'Rol Motivo', 'propio', 'no')).rejects.toThrow(/motivo/i)
  })

  it('solo se elimina un rol propio y sin usuarios', async () => {
    await expect(rpc(admin, `select public.config_eliminar_rol('asesor', 'Eliminar perfil inicial')`)).rejects.toThrow(/iniciales/)
    const id = await guardar(admin, null, ['clientes.ver'], 'Temporal')
    const u = await crearUsuario(db, 'Con Temporal', id)
    await expect(rpc(admin, `select public.config_eliminar_rol($1, 'Con usuarios asignados')`, [id])).rejects.toThrow(/Hay usuarios/)
    await rpc(admin, `select public.config_actualizar_usuario($1, 'asesor', null, null, null, array['AMURA'], 'activo', 'Reasignada')`, [u])
    await rpc(admin, `select public.config_eliminar_rol($1, 'Ya no se usa')`, [id])
    expect((await db.query(`select 1 from public.roles where id = $1`, [id])).rows).toEqual([])
    expect(await uno(`select motivo from public.audit_log where accion = 'Eliminar rol' and entidad_id = $1`, [id])).toEqual({ motivo: 'Ya no se usa' })
  })

  it('las propuestas de precio funcionan con un rol configurable, por permiso', async () => {
    const id = await guardar(admin, null, ['precios.proponer', 'inventario.ver'], 'Pricing')
    const u = await crearUsuario(db, 'Pia Pricing', id)
    await rpc(u, `select public.precios_proponer('fijar', 2300, 'Propuesta de pricing', array['E1-PB-A5'], null, null, null, 'Departamento 1005')`)
    expect((await filas(u, `select 1 from public.price_proposals`)).length).toBeGreaterThan(0)
    expect((await filas(vera, `select 1 from public.price_proposals`)).length).toBe(0)
  })
})

describe('equipos', () => {
  it('solo quien administra equipos los cambia; queda auditado y rige el alcance', async () => {
    await expect(rpc(vera, `select public.config_guardar_equipo(null, 'Mi Equipo', null, null, 'Intento de vendedora')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(gerente, `select public.config_guardar_equipo(null, 'De Gerencia', null, null, 'Sin permiso de equipos')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(admin, `select public.config_guardar_equipo(null, 'Equipo Norte', null, null, 'Nombre repetido')`)).rejects.toThrow(/Ya existe/)
    const sur = (await rpc<{ id: string }>(admin, `select public.config_guardar_equipo(null, 'Equipo Sur', null, array[$1::uuid], 'Equipo del sur') as id`, [gerente])).id
    expect(await uno(`select user_id from public.team_managers where team_id = $1`, [sur])).toEqual({ user_id: gerente })
    await rpc(admin, `select public.config_guardar_equipo($1, 'Equipo Sur', $2, null, 'Cambio de supervisora')`, [sur, sofia])
    expect((await db.query(`select 1 from public.team_managers where team_id = $1`, [sur])).rows).toEqual([])
    expect(await uno(`select antes, despues from public.audit_log where accion = 'Editar equipo' and entidad_id = $1`, [sur])).toMatchObject({ antes: { supervisor_id: null }, despues: { supervisor_id: sofia } })
  })
})
