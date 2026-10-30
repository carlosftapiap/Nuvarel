// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb } from './db'

const RAIZ = path.resolve(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')

/** Orden de instalación indicado al usuario para una base que ya tiene inventario, clientes, cotizaciones y reservas. */
const ORDEN = [
  'migrations/20261028220000_usuarios_tablas.sql',
  'seed_roles.sql',
  'migrations/20261028220100_usuarios_funciones.sql',
  'migrations/20261028220200_usuarios_perfiles_existentes.sql',
  'migrations/20261028220300_usuarios_administracion.sql',
  'migrations/20261028220400_alcance_por_permisos.sql',
]

async function instalar(db: PGlite) {
  for (const f of ORDEN) await db.exec(leer(f))
}

async function verificar(db: PGlite) {
  const { rows } = await db.query<{ grupo: string; objeto: string; ok: boolean }>(leer('instalacion/verificar_dependencias.sql'))
  return rows
}

/** Base como la del proyecto en Supabase: migraciones hasta reservas, una cuenta con rol en user_roles y datos comerciales. */
async function baseExistente() {
  const db = await crearDb({ hasta: '20261028200000_reservas.sql' })
  const { rows } = await db.query<{ id: string }>('select gen_random_uuid() as id')
  const admin = rows[0].id
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'admin@empresa.test', '{"full_name": "Administración"}')`, [admin])
  await db.query(`insert into public.user_roles (user_id, role) values ($1, 'administrador')`, [admin])
  await db.query(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by) values ('Cliente existente', '0990000009', 'whatsapp', $1, $1)`, [admin])
  return { db, admin }
}

describe('instalación de usuarios y permisos sobre una base existente', () => {
  it('el flujo comercial se detiene con un mensaje claro si faltan dependencias', async () => {
    const { db } = await baseExistente()
    await expect(db.exec(leer('migrations/20261029000000_flujo_comercial.sql'))).rejects.toThrow(/Faltan dependencias/)
  })

  it('instala sin perder datos, migra la cuenta existente y la verificación final queda en verde', async () => {
    const { db, admin } = await baseExistente()
    await instalar(db)
    const fallas = (await verificar(db)).filter((r) => !r.ok)
    expect(fallas).toEqual([])
    const c = await db.query<{ nombre: string; atribucion_usuario_id: string }>(`select nombre, atribucion_usuario_id from public.clients`)
    expect(c.rows).toEqual([{ nombre: 'Cliente existente', atribucion_usuario_id: admin }])
    const p = await db.query(`select nombre, rol_id, estado from public.profiles where id = $1`, [admin])
    expect(p.rows[0]).toEqual({ nombre: 'Administración', rol_id: 'administrador', estado: 'activo' })
    const ok = await como(db, admin, async () => (await db.query<{ ok: boolean }>(`select public.tiene_permiso('config.usuarios') as ok`)).rows[0].ok)
    expect(ok).toBe(true)
  })

  it('se puede volver a ejecutar sin errores ni duplicados', async () => {
    const { db } = await baseExistente()
    await instalar(db)
    await instalar(db)
    const n = await db.query<{ p: number; c: number; a: number }>(
      `select (select count(*)::int from public.profiles) as p, (select count(*)::int from public.clients) as c,
              (select count(*)::int from public.audit_log where accion = 'Perfil migrado desde user_roles') as a`)
    expect(n.rows[0]).toEqual({ p: 1, c: 1, a: 1 })
  })

  it('sin perfil activo no hay permisos ni alcance (no hay acceso por defecto)', async () => {
    const { db } = await baseExistente()
    await instalar(db)
    const { rows } = await db.query<{ id: string }>('select gen_random_uuid() as id')
    await db.query(`insert into auth.users (id, email) values ($1, 'sinperfil@empresa.test')`, [rows[0].id])
    const r = await como(db, rows[0].id, async () => (await db.query<{ p: boolean; n: number }>(
      `select public.tiene_permiso('clientes.ver') as p, (select count(*)::int from public.clients) as n`)).rows[0])
    expect(r).toEqual({ p: false, n: 0 })
  })

  it('primer administrador: solo con una cuenta real y solo si no hay otro administrador', async () => {
    const db = await crearDb({ hasta: '20261028200000_reservas.sql' })
    await instalar(db)
    expect((await verificar(db)).find((r) => r.objeto === 'al menos un administrador activo')?.ok).toBe(false)
    const plantilla = leer('instalacion/primer_administrador.sql')
    await expect(db.exec(plantilla)).rejects.toThrow(/Escribe en v_email/)
    await expect(db.exec(plantilla.replace('REEMPLAZAR@correo.com', 'nadie@empresa.test'))).rejects.toThrow(/No existe una cuenta/)
    await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'duena@empresa.test')`)
    await db.exec(plantilla.replace('REEMPLAZAR@correo.com', 'duena@empresa.test'))
    expect((await verificar(db)).filter((r) => !r.ok)).toEqual([])
    await expect(db.exec(plantilla.replace('REEMPLAZAR@correo.com', 'duena@empresa.test'))).rejects.toThrow(/Ya existe un administrador/)
  })
})

describe('alta de usuario desde el SQL Editor', () => {
  it('crea el perfil solo para una cuenta real, con un rol existente, y no duplica', async () => {
    const db = await crearDb()
    const plantilla = leer('instalacion/alta_usuario.sql')
    const con = (email: string, rol = 'finanzas') => plantilla.replace('REEMPLAZAR@correo.com', email).replace('REEMPLAZAR Nombre', 'Fernanda Finanzas').replace(`v_rol    text := 'asesor'`, `v_rol    text := '${rol}'`)
    await expect(db.exec(plantilla)).rejects.toThrow(/Completa v_email/)
    await expect(db.exec(con('nadie@empresa.test'))).rejects.toThrow(/No existe una cuenta/)
    await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'fer@empresa.test')`)
    await expect(db.exec(con('fer@empresa.test', 'inventado'))).rejects.toThrow(/Rol inexistente/)
    await db.exec(con('fer@empresa.test'))
    expect((await db.query(`select rol_id, estado from public.profiles where email = 'fer@empresa.test'`)).rows[0]).toEqual({ rol_id: 'finanzas', estado: 'activo' })
    await expect(db.exec(con('fer@empresa.test'))).rejects.toThrow(/ya tiene perfil/)
  })
})
