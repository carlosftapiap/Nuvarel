// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { STUB_SUPABASE, GRANTS_SUPABASE } from './db'

/** Ejecuta la guía tal como está escrita: si le falta o le sobra un paso, esta prueba falla. */
const RAIZ = path.resolve(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
const GUIA = leer('instalacion/ENTORNO_PRUEBAS.md')
const pasos = [...GUIA.matchAll(/^\| \d+ \| `([^`]+\.sql)`/gm)].map((m) => m[1])
const CORREOS = ['admin', 'gerente', 'finanzas', 'legal', 'supervisora', 'corredor1', 'corredor2'].map((c) => `${c}@prueba.local`)
const GANTT = 'migrations/20261030000000_plan_responsable_externo.sql'

let db: PGlite

async function usuarios(base: PGlite, correos: string[]) {
  for (const e of correos) await base.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1)`, [e])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SUPABASE)
  for (const p of pasos) await db.exec(leer(p))
  await db.exec(GRANTS_SUPABASE)
  await usuarios(db, CORREOS)
}, 90_000)

describe('guía del proyecto de pruebas', () => {
  it('incluye todas las migraciones, salvo la del Gantt, que va aparte', () => {
    const todas = fs.readdirSync(path.join(RAIZ, 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => `migrations/${f}`)
    expect(pasos.filter((p) => p.startsWith('migrations/')).sort()).toEqual(todas.filter((m) => m !== GANTT).sort())
    expect(pasos).not.toContain(GANTT)
    expect(GUIA).toContain(GANTT)
  })

  it('no incluye contraseñas ni claves reales', () => {
    expect(GUIA).not.toMatch(/eyJhbGciOi|sb_secret_|service_role\s*=/)
    expect(leer('instalacion/usuarios_prueba.sql')).not.toMatch(/password|contraseña\s*[:=]/i)
  })

  it('usuarios_prueba.sql crea los perfiles y el equipo, y se puede repetir', async () => {
    await db.exec(leer('instalacion/usuarios_prueba.sql'))
    await db.exec(leer('instalacion/usuarios_prueba.sql'))
    const p = await db.query<{ email: string; rol_id: string; estado: string }>(`select email, rol_id, estado from public.profiles order by email`)
    expect(p.rows).toHaveLength(7)
    expect(p.rows.every((r) => r.estado === 'activo')).toBe(true)
    expect(p.rows.find((r) => r.email === 'legal@prueba.local')?.rol_id).toBe('legal')
    const e = await db.query(`select 1 from public.profiles where email = 'corredor1@prueba.local' and equipo_id is not null`)
    expect(e.rows).toHaveLength(1)
    expect((await db.query<{ receptor: string }>(`select receptor from public.payment_settings`)).rows[0].receptor).toBe('NUVAREL')
  })

  it('validar_rls.sql da ok en todas las filas y no deja datos', async () => {
    const antes = (await db.query<{ n: number }>(`select count(*)::int as n from public.clients`)).rows[0].n
    await db.exec(leer('instalacion/validar_rls.sql'))
    const r = await db.query<{ prueba: string; esperado: string; obtenido: string; ok: boolean }>(`select prueba, esperado, obtenido, ok from rls_resultado order by n`)
    expect(r.rows.length).toBeGreaterThan(10)
    expect(r.rows.filter((f) => !f.ok)).toEqual([])
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.clients`)).rows[0].n).toBe(antes)
  })

  it('validar_rls.sql detecta una política rota', async () => {
    const r0 = new PGlite()
    await r0.exec(STUB_SUPABASE)
    for (const p of pasos) await r0.exec(leer(p))
    await r0.exec(GRANTS_SUPABASE)
    await usuarios(r0, CORREOS)
    await r0.exec(leer('instalacion/usuarios_prueba.sql'))
    await r0.exec(`drop policy "ver clientes" on public.clients; create policy "ver clientes" on public.clients for select to authenticated using (true);`)
    await r0.exec(leer('instalacion/validar_rls.sql'))
    const r = await r0.query<{ prueba: string; ok: boolean }>(`select prueba, ok from rls_resultado`)
    expect(r.rows.filter((f) => !f.ok).map((f) => f.prueba)).toContain('Corredor 2 no ve el cliente ajeno')
  }, 90_000)

  it('usuarios_prueba.sql se niega a correr si hay cuentas reales', async () => {
    const otra = new PGlite()
    await otra.exec(STUB_SUPABASE)
    for (const p of pasos) await otra.exec(leer(p))
    await usuarios(otra, CORREOS)
    await usuarios(otra, ['persona@empresa.com'])
    await expect(otra.exec(leer('instalacion/usuarios_prueba.sql'))).rejects.toThrow(/no son de prueba/)
    expect((await otra.query(`select 1 from public.profiles`)).rows).toHaveLength(0)
  }, 90_000)
})
