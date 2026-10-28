import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Base de datos Postgres en memoria con las migraciones reales del proyecto.
 * Simula lo mínimo de Supabase: esquema auth, auth.uid() y el rol `authenticated` con RLS activa.
 */
const RAIZ = path.resolve(__dirname, '..')

const STUB_SUPABASE = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on auth.users to authenticated;
`

const GRANTS_SUPABASE = `
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
`

export async function crearDb(opts: { hasta?: string } = {}) {
  const db = new PGlite()
  await db.exec(STUB_SUPABASE)
  const migraciones = fs.readdirSync(path.join(RAIZ, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  for (const m of migraciones) {
    if (opts.hasta && m > opts.hasta) break
    await db.exec(fs.readFileSync(path.join(RAIZ, 'migrations', m), 'utf8'))
    if (m.startsWith('20261028120000')) await db.exec(fs.readFileSync(path.join(RAIZ, 'seed.sql'), 'utf8'))
    if (m.startsWith('20261028220000')) await db.exec(fs.readFileSync(path.join(RAIZ, 'seed_roles.sql'), 'utf8'))
  }
  await db.exec(GRANTS_SUPABASE)
  return db
}

/** Crea una cuenta y su perfil (como lo haría la función invitar-usuario) y la deja activa. */
export async function crearUsuario(db: PGlite, nombre: string, rol: string, extra: { equipo?: string; supervisor?: string; alcance?: string } = {}) {
  const { rows } = await db.query<{ id: string }>('select gen_random_uuid() as id')
  const id = rows[0].id
  const email = `${nombre.toLowerCase().replace(/\s+/g, '.')}@prueba.local`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  await db.query(
    `insert into public.profiles (id, nombre, email, estado, rol_id, alcance, supervisor_id, equipo_id) values ($1, $2, $3, 'activo', $4, $5, $6, $7)`,
    [id, nombre, email, rol, extra.alcance ?? null, extra.supervisor ?? null, extra.equipo ?? null],
  )
  return id
}

/** Ejecuta una función como un usuario autenticado concreto (RLS aplicada). */
export async function como<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}
