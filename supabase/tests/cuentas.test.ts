// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string, sofia: string, sinPerfil: string

const sesion = (id: string) => como(db, id, async () => (await db.query<{ s: { estado: string; permisos: string[] } | null }>(`select public.mi_sesion() as s`)).rows[0].s)
const rol = async (id: string) => (await db.query<{ rol_id: string; estado: string }>(`select rol_id, estado from public.profiles where id = $1`, [id])).rows[0]

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  sinPerfil = (await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'nueva@empresa.test') returning id`)).rows[0].id
})

describe('nadie se asigna privilegios a sí mismo', () => {
  it('un usuario normal no cambia su rol ni su estado escribiendo en la tabla', async () => {
    await como(db, vera, () => db.query(`update public.profiles set rol_id = 'administrador' where id = $1`, [vera])).catch(() => undefined)
    expect(await rol(vera)).toEqual({ rol_id: 'asesor', estado: 'activo' })
  })

  it('una cuenta sin perfil no puede crearse uno', async () => {
    await expect(como(db, sinPerfil, () => db.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, 'Yo', 'nueva@empresa.test', 'activo', 'administrador')`, [sinPerfil])))
      .rejects.toThrow(/row-level security|permission denied/)
    expect(await sesion(sinPerfil)).toBeNull()
  })

  it('las funciones de administración rechazan a quien no tiene permiso', async () => {
    await expect(como(db, vera, () => db.query(`select * from public.config_listar_cuentas()`))).rejects.toThrow(/Sin permiso/)
    await expect(como(db, vera, () => db.query(`select public.config_habilitar_cuenta($1, 'Nueva', 'administrador', 'Intento de alta')`, [sinPerfil]))).rejects.toThrow(/Sin permiso/)
    await expect(como(db, vera, () => db.query(`select public.config_actualizar_usuario($1, 'administrador', null, null, null, '{AMURA}', 'activo', 'Me asciendo')`, [vera]))).rejects.toThrow(/Sin permiso/)
  })

  it('ni el administrador puede cambiar su propio rol o estado', async () => {
    await expect(como(db, admin, () => db.query(`select public.config_actualizar_usuario($1, 'asesor', null, null, null, '{AMURA}', 'activo', 'Prueba propia')`, [admin]))).rejects.toThrow(/propio rol/)
  })

  it('quien administra usuarios sin ser administrador no puede conceder el rol administrador', async () => {
    await db.query(`insert into public.user_permission_overrides values ($1, 'config.usuarios', 'permitir')`, [sofia])
    await expect(como(db, sofia, () => db.query(`select public.config_habilitar_cuenta($1, 'Nueva Persona', 'administrador', 'Alta de prueba')`, [sinPerfil]))).rejects.toThrow(/No puedes conceder/)
    await expect(como(db, sofia, () => db.query(`select public.config_actualizar_usuario($1, 'administrador', null, null, null, '{AMURA}', 'activo', 'Ascenso de prueba')`, [vera]))).rejects.toThrow(/No puedes conceder/)
    await db.query(`delete from public.user_permission_overrides where user_id = $1`, [sofia])
  })
})

describe('administración de cuentas por el administrador', () => {
  it('lista las cuentas de Authentication, incluso las que aún no tienen perfil', async () => {
    const { rows } = await como(db, admin, () => db.query<{ email: string; estado: string; tiene_perfil: boolean }>(`select email, estado, tiene_perfil from public.config_listar_cuentas()`))
    expect(rows.find((r) => r.email === 'nueva@empresa.test')).toEqual({ email: 'nueva@empresa.test', estado: 'sin_perfil', tiene_perfil: false })
    expect(rows).toHaveLength(4)
  })

  it('habilita una cuenta existente con motivo y auditoría', async () => {
    await como(db, admin, () => db.query(`select public.config_habilitar_cuenta($1, 'Nueva Persona', 'finanzas', 'Alta de Finanzas')`, [sinPerfil]))
    expect(await rol(sinPerfil)).toEqual({ rol_id: 'finanzas', estado: 'activo' })
    expect((await sesion(sinPerfil))!.permisos).toContain('reservas.verificar_pago')
    const a = await db.query(`select actor_id, motivo from public.audit_log where accion = 'Habilitar cuenta'`)
    expect(a.rows[0]).toEqual({ actor_id: admin, motivo: 'Alta de Finanzas' })
  })

  it('desactivar quita el acceso a los datos de inmediato y conserva el perfil', async () => {
    await como(db, admin, () => db.query(`select public.config_actualizar_usuario($1, 'asesor', null, null, null, '{AMURA}', 'inactivo', 'Dejó la empresa')`, [vera]))
    const s = await sesion(vera)
    expect(s!.estado).toBe('inactivo')
    expect(s!.permisos).toEqual([])
    expect(await como(db, vera, async () => (await db.query(`select count(*)::int as n from public.inventory_units`)).rows[0])).toEqual({ n: 0 })
  })
})
