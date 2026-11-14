// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, cora: string, asesor: string
let n = 990950000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const datos = (o: Record<string, unknown> = {}) => JSON.stringify({ nombre: 'Corredora Nueva', documento: '0912345678', licencia: 'LIC-77', telefono: '0991234500', email: 'nueva@correo.com', responsable_id: null, ...o })
const listar = async (u: string) => (await rpc<{ j: { id: string; nombre: string; estado: string; usuario_id: string | null; clientes: number; ventas: number }[] }>(u, `select public.corredores_listar() as j`)).j
const cliente = async (u: string, nombre: string, corredor: string | null) =>
  (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: corredor ? 'corredor' : 'whatsapp', origen_detalle: corredor ? 'Corredor' : '', corredor_origen_id: corredor }), u])).id

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  asesor = await crearUsuario(db, 'Vera', 'asesor')
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('alta sin invitación', () => {
  it('un perfil comercial se crea sin cuenta de acceso', async () => {
    const id = (await rpc<{ id: string }>(gerente, `select public.corredores_crear($1::jsonb, 'Alta de corredor externo') as id`, [datos()])).id
    const fila = await uno<{ usuario_id: string | null; estado: string }>(`select usuario_id, estado from public.corredores where id = $1`, [id])
    expect(fila).toEqual({ usuario_id: null, estado: 'activo' })
    expect((await listar(gerente)).find((c) => c.id === id)).toMatchObject({ nombre: 'Corredora Nueva', usuario_id: null })
  })

  it('valida nombre, documento, correo y motivo; sin permiso no se crea', async () => {
    await expect(rpc(gerente, `select public.corredores_crear($1::jsonb, 'Alta válida')`, [datos({ nombre: 'Al' })])).rejects.toThrow(/nombre/)
    await expect(rpc(gerente, `select public.corredores_crear($1::jsonb, 'Alta válida')`, [datos({ documento: '123' })])).rejects.toThrow(/cédula o el RUC/)
    await expect(rpc(gerente, `select public.corredores_crear($1::jsonb, 'Alta válida')`, [datos({ email: 'malo' })])).rejects.toThrow(/correo/)
    await expect(rpc(gerente, `select public.corredores_crear($1::jsonb, 'no')`, [datos()])).rejects.toThrow(/motivo/)
    await expect(rpc(asesor, `select public.corredores_crear($1::jsonb, 'Intento de asesor')`, [datos()])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(finanzas, `select public.corredores_crear($1::jsonb, 'Intento de finanzas')`, [datos()])).rejects.toThrow(/Sin permiso/)
  })

  it('la tabla no se escribe directo', async () => {
    await expect(como(db, gerente, () => db.query(`insert into public.corredores (nombre) values ('Directo')`))).rejects.toThrow(/row-level security|permission denied/)
  })
})

describe('edición, estado y auditoría', () => {
  it('editar deja el valor anterior y el nuevo en la auditoría', async () => {
    const id = (await uno<{ id: string }>(`select id from public.corredores where nombre = 'Corredora Nueva'`)).id
    await rpc(gerente, `select public.corredores_editar($1, $2::jsonb, 'Licencia renovada')`, [id, datos({ licencia: 'LIC-99' })])
    const a = await uno<{ antes: { licencia: string }; despues: { licencia: string } }>(`select antes, despues from public.audit_log where accion = 'Editar corredor' and entidad_id = $1`, [id])
    expect(a).toMatchObject({ antes: { licencia: 'LIC-77' }, despues: { licencia: 'LIC-99' } })
  })

  it('desactivar impide asignarlo a clientes nuevos, pero conserva lo ya asignado', async () => {
    const id = (await uno<{ id: string }>(`select id from public.corredores where nombre = 'Corredora Nueva'`)).id
    const viejo = await cliente(gerente, 'Antes de desactivar', id)
    await rpc(gerente, `select public.corredores_cambiar_estado($1, 'inactivo', 'Dejó de trabajar con AMURA')`, [id])
    await expect(rpc(gerente, `select public.clientes_crear(null, $1::jsonb, $2)`, [JSON.stringify({ nombre: 'Nuevo con inactivo', telefono: '0999000111', origen: 'corredor', origen_detalle: 'x', corredor_origen_id: id }), gerente])).rejects.toThrow(/corredor activo/)
    expect((await uno<{ corredor_origen_id: string }>(`select corredor_origen_id from public.clients where id = $1`, [viejo])).corredor_origen_id).toBe(id)
    expect((await listar(gerente)).find((c) => c.id === id)).toMatchObject({ estado: 'inactivo' })
    await expect(rpc(gerente, `select public.corredores_cambiar_estado($1, 'inactivo', 'Repetido')`, [id])).rejects.toThrow(/ya está/)
    await rpc(gerente, `select public.corredores_cambiar_estado($1, 'activo', 'Vuelve a trabajar')`, [id])
  })
})

describe('acceso a la app: separado y opcional', () => {
  it('vincular exige administración, rol Corredor y cuenta activa; un acceso no sirve para dos perfiles', async () => {
    const sin = (await rpc<{ id: string }>(gerente, `select public.corredores_crear($1::jsonb, 'Alta sin acceso') as id`, [datos({ nombre: 'Sin Acceso Aún', documento: '' })])).id
    await expect(rpc(gerente, `select public.corredores_vincular_acceso($1, $2, 'Gerencia intenta vincular')`, [sin, carlos])).rejects.toThrow(/Solo administración/)
    await expect(rpc(admin, `select public.corredores_vincular_acceso($1, $2, 'Cuenta de asesor')`, [sin, asesor])).rejects.toThrow(/rol Corredor/)
    await expect(rpc(admin, `select public.corredores_vincular_acceso($1, $2, 'Ya vinculada a otro')`, [sin, carlos])).rejects.toThrow(/ya está vinculada/)
    // Carlos ya tiene su perfil; se desvincula para probar el alta de acceso en otro perfil sin mover el historial.
    const cc = (await uno<{ id: string }>(`select id from public.corredores where usuario_id = $1`, [carlos])).id
    await rpc(admin, `select public.corredores_desvincular_acceso($1, 'Cambio de perfil de prueba')`, [cc])
    await rpc(admin, `select public.corredores_vincular_acceso($1, $2, 'Acceso de Carlos al perfil nuevo')`, [sin, carlos])
    expect((await listar(admin)).find((c) => c.id === sin)).toMatchObject({ usuario_id: carlos, acceso: 'Carlos Corredor' })
    expect((await listar(admin)).find((c) => c.id === cc)).toMatchObject({ usuario_id: null })
    // El historial del perfil anterior se conserva: sigue en la base aunque ya no tenga acceso.
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.corredores where id = $1`, [cc])).n).toBe(1)
  })

  it('el corredor con acceso registra su cliente sin indicarse y queda como origen', async () => {
    const sin = (await uno<{ id: string }>(`select id from public.corredores where nombre = 'Sin Acceso Aún'`)).id
    const c = await cliente(carlos, 'Propio de Carlos', null)
    const origen = await uno<{ corredor_origen_id: string | null; origen: string }>(`select corredor_origen_id, origen from public.clients where id = $1`, [c])
    expect(origen.origen).toBe('whatsapp')
    expect(origen.corredor_origen_id).toBeNull()
    // Con origen Corredor, sin indicar corredor: el sistema usa el perfil del propio corredor.
    const d = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Registrado como corredor', telefono: '0999000777', origen: 'corredor', origen_detalle: 'Carlos' }), carlos])).id
    const k = await uno<{ corredor_origen_id: string }>(`select corredor_origen_id from public.clients where id = $1`, [d])
    expect(k.corredor_origen_id).toBe(sin)
  })

  it('desvincular no borra el perfil ni el historial de clientes y ventas', async () => {
    const sin = (await uno<{ id: string }>(`select id from public.corredores where nombre = 'Sin Acceso Aún'`)).id
    await rpc(admin, `select public.corredores_desvincular_acceso($1, 'Dejó la app')`, [sin])
    expect((await listar(admin)).find((c) => c.id === sin)).toMatchObject({ usuario_id: null, clientes: 1 })
    await expect(rpc(admin, `select public.corredores_desvincular_acceso($1, 'Repetido')`, [sin])).rejects.toThrow(/no tiene acceso/)
  })
})

describe('lo que ve cada quien', () => {
  it('el listado cuenta clientes y ventas firmadas dentro del alcance', async () => {
    const id = (await uno<{ id: string }>(`select id from public.corredores where nombre = 'Sin Acceso Aún'`)).id
    const fila = (await listar(gerente)).find((c) => c.id === id)!
    expect(fila.clientes).toBeGreaterThanOrEqual(1)
    expect(fila.ventas).toBe(0)
  })

  it('quien no tiene el permiso no ve el listado', async () => {
    expect(await listar(asesor)).toEqual([])
    const sinPermiso = await como(db, legal, async () => (await db.query(`select * from public.clientes_corredores()`)).rows)
    expect(sinPermiso).toEqual([])
  })
})
