// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let elegido: string, otro: string, admin: string

beforeAll(async () => {
  db = await crearDb()
  // Sin administrador: solo la cuenta autorizada puede activarse.
  elegido = (await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'carlosftapiap@gmail.com') returning id`)).rows[0].id
  otro = (await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'otra@empresa.test') returning id`)).rows[0].id
})

describe('administrador inicial desde la app', () => {
  it('una cuenta no autorizada no puede activarse', async () => {
    expect(await como(db, otro, async () => (await db.query<{ ok: boolean }>(`select public.puede_activar_administrador_inicial() as ok`)).rows[0].ok)).toBe(false)
    await expect(como(db, otro, () => db.query(`select public.activar_administrador_inicial()`))).rejects.toThrow(/no está autorizada/)
    expect((await db.query(`select count(*)::int as n from public.profiles`)).rows[0]).toEqual({ n: 0 })
  })

  it('la cuenta autorizada se activa como administrador, una sola vez', async () => {
    expect(await como(db, elegido, async () => (await db.query<{ ok: boolean }>(`select public.puede_activar_administrador_inicial() as ok`)).rows[0].ok)).toBe(true)
    await como(db, elegido, () => db.query(`select public.activar_administrador_inicial()`))
    const p = (await db.query(`select rol_id, estado from public.profiles where id = $1`, [elegido])).rows[0]
    expect(p).toEqual({ rol_id: 'administrador', estado: 'activo' })
    const s = await como(db, elegido, async () => (await db.query<{ permisos: string[] }>(`select public.mi_sesion() as s`)).rows[0])
    expect((s as unknown as { s: { permisos: string[] } }).s.permisos).toContain('config.usuarios')
    await expect(como(db, elegido, () => db.query(`select public.activar_administrador_inicial()`))).rejects.toThrow(/Ya existe un administrador|ya tiene perfil/)
  })

  it('después no vuelve a poder usarse, ni siquiera para otra cuenta', async () => {
    admin = (await db.query<{ id: string }>(`insert into auth.users (id, email) values (gen_random_uuid(), 'tercero@empresa.test') returning id`)).rows[0].id
    expect(await como(db, admin, async () => (await db.query<{ ok: boolean }>(`select public.puede_activar_administrador_inicial() as ok`)).rows[0].ok)).toBe(false)
    await expect(como(db, admin, () => db.query(`select public.activar_administrador_inicial()`))).rejects.toThrow(/Ya existe un administrador/)
  })

  it('el correo autorizado no se puede leer ni cambiar desde la app', async () => {
    await como(db, elegido, () => db.query(`update public.bootstrap_admin set email = 'yo@empresa.test'`))
    expect((await db.query(`select email from public.bootstrap_admin`)).rows).toEqual([{ email: 'carlosftapiap@gmail.com' }])
  })
})
