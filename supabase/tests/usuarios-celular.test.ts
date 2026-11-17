// @vitest-environment node
// Celular / WhatsApp de usuarios (migración 20261208000000) en una base local aislada.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string, vito: string, supervisor: string

const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
const guardar = (quien: string, usuario: string, celular: string) =>
  rpc<{ c: string | null }>(quien, `select public.config_usuario_celular($1, $2) as c`, [usuario, celular]).then((r) => r.rows[0].c)
const celularDe = async (id: string) => (await db.query<{ celular: string | null }>(`select celular from public.usuarios_contacto where user_id = $1`, [id])).rows[0]?.celular ?? null

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Celular', 'administrador')
  vera = await crearUsuario(db, 'Vera Celular', 'asesor')
  vito = await crearUsuario(db, 'Vito Celular', 'asesor')
  supervisor = await crearUsuario(db, 'Sara Celular', 'supervisor')
}, 120_000)

describe('celular de usuarios', () => {
  it('el administrador lo registra; se guarda normalizado en E.164 con +593 por defecto', async () => {
    expect(await guardar(admin, vera, '099 123 4567')).toBe('+593991234567')
    expect(await celularDe(vera)).toBe('+593991234567')
  })

  it('se puede editar, incluso con otro código de país, y vaciarlo lo retira', async () => {
    expect(await guardar(admin, vera, '+57 300 123 4567')).toBe('+573001234567')
    expect(await celularDe(vera)).toBe('+573001234567')
    expect(await guardar(admin, vera, '')).toBeNull()
    expect(await celularDe(vera)).toBeNull()
    await guardar(admin, vera, '0991234567')
  })

  it('valida el formato y no guarda números inválidos', async () => {
    await expect(guardar(admin, vito, '12345')).rejects.toThrow(/Celular no válido/)
    await expect(guardar(admin, vito, '+593 4 234 5678')).rejects.toThrow(/Celular no válido/)
    expect(await celularDe(vito)).toBeNull()
  })

  it('solo quien administra usuarios lo registra; nadie escribe la tabla directamente', async () => {
    await expect(guardar(vera, vera, '0991234567')).rejects.toThrow(/administra usuarios/)
    await expect(guardar(supervisor, vito, '0991234567')).rejects.toThrow(/administra usuarios/)
    await expect(rpc(admin, `insert into public.usuarios_contacto (user_id, celular) values ($1, '+593990000000')`, [vito])).rejects.toThrow()
  })

  it('lo consultan el propio usuario y el administrador; otros perfiles no', async () => {
    await guardar(admin, vito, '0987654321')
    const propio = await rpc<{ user_id: string }>(vera, `select user_id from public.usuarios_contacto`)
    expect(propio.rows.map((r) => r.user_id)).toEqual([vera])
    const delSupervisor = await rpc<{ n: number }>(supervisor, `select count(*)::int as n from public.usuarios_contacto`)
    expect(delSupervisor.rows[0].n).toBe(0)
    const delAdmin = await rpc<{ n: number }>(admin, `select count(*)::int as n from public.usuarios_contacto`)
    expect(delAdmin.rows[0].n).toBe(2)
  })

  it('la auditoría registra el cambio sin el número completo', async () => {
    const { rows } = await db.query<{ antes: unknown; despues: unknown }>(`select antes, despues from public.audit_log where accion = 'Celular de usuario' and entidad_id = $1 order by fecha desc limit 1`, [vito])
    expect(JSON.stringify(rows[0])).not.toContain('0987654321')
    expect(JSON.stringify(rows[0])).not.toContain('593987654321')
    expect(rows[0].despues).toEqual({ celular: '···4321' })
  })
})
