import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let libre: string, vera: string, inactivo: string

const tablas = async () => (await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`)).rows.map((x) => x.t)
const filas = (u: string, t: string) => como(db, u, async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n).catch(() => 0)

beforeAll(async () => {
  db = await crearDb()
  // Una cuenta creada por registro público: existe en Auth, pero no tiene perfil en AMURA.
  libre = '99999999-9999-4999-8999-999999999999'
  await db.query(`insert into auth.users (id, email) values ($1, 'registro.libre@ejemplo.ec')`, [libre])
  vera = await crearUsuario(db, 'Vera', 'asesor')
  inactivo = await crearUsuario(db, 'Iván', 'asesor')
  await db.query(`update public.profiles set estado = 'inactivo' where id = $1`, [inactivo])
  await db.query(`insert into public.teams (nombre) values ('Equipo Norte')`)
}, 120_000)

describe('una cuenta sin perfil activo no accede a nada', () => {
  it.each(['sin perfil', 'inactiva'])('cuenta %s: ninguna tabla le muestra filas', async (tipo) => {
    const u = tipo === 'sin perfil' ? libre : inactivo
    const visibles: string[] = []
    for (const t of await tablas()) {
      // Cada quien puede leer su propia ficha; lo demás debe quedar vacío.
      if (await filas(u, t) > 0 && !(tipo === 'inactiva' && ['profiles', 'user_projects'].includes(t))) visibles.push(t)
    }
    expect(visibles).toEqual([])
  })

  it('ningún dato de configuración, ni el porcentaje de comisión', async () => {
    for (const t of ['emisor_recibos', 'payment_settings', 'roles', 'permissions', 'role_permissions', 'projects', 'teams', 'client_import_settings']) expect(await filas(libre, t), t).toBe(0)
    expect((await como(db, libre, () => db.query<{ r: unknown }>(`select public.comisiones_porcentaje() as r`))).rows[0].r).toBeNull()
  })

  it('no puede darse acceso a sí misma ni modificar datos', async () => {
    await expect(como(db, libre, () => db.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, 'x', 'x@x.ec', 'activo', 'administrador')`, [libre]))).rejects.toThrow()
    expect((await como(db, libre, () => db.query(`update public.inventory_units set estado = estado returning 1`))).rows).toEqual([])
  })

  it('un usuario activo sigue leyendo la configuración', async () => {
    for (const t of ['emisor_recibos', 'payment_settings', 'roles', 'teams']) expect(await filas(vera, t), t).toBeGreaterThan(0)
    expect((await como(db, vera, () => db.query<{ r: unknown }>(`select public.comisiones_porcentaje() as r`))).rows[0].r).not.toBeNull()
  })
})
