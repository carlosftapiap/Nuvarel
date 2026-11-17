import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Base de datos Postgres en memoria con las migraciones reales del proyecto.
 * Simula lo mínimo de Supabase: esquema auth, auth.uid() y el rol `authenticated` con RLS activa.
 */
const RAIZ = path.resolve(__dirname, '..')

export const STUB_SUPABASE = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on auth.users to authenticated;
`

export const GRANTS_SUPABASE = `
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

/** Crea una cuenta y su perfil (como lo hace la función crear-usuario) y la deja activa. */
export async function crearUsuario(db: PGlite, nombre: string, rol: string, extra: { equipo?: string; supervisor?: string; alcance?: string } = {}) {
  const { rows } = await db.query<{ id: string }>('select gen_random_uuid() as id')
  const id = rows[0].id
  const email = `${nombre.toLowerCase().replace(/\s+/g, '.')}@prueba.local`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  await db.query(
    `insert into public.profiles (id, nombre, email, estado, rol_id, alcance, supervisor_id, equipo_id) values ($1, $2, $3, 'activo', $4, $5, $6, $7)`,
    [id, nombre, email, rol, extra.alcance ?? null, extra.supervisor ?? null, extra.equipo ?? null],
  )
  // Un corredor también es un perfil comercial, con el mismo identificador, como lo deja la migración de Corredores.
  if (rol === 'corredor') {
    const { rows } = await db.query<{ t: string | null }>(`select to_regclass('public.corredores')::text as t`)
    if (rows[0].t) await db.query(`insert into public.corredores (id, nombre, usuario_id, estado) values ($1, $2, $1, 'activo') on conflict (id) do nothing`, [id, nombre])
  }
  return id
}

const turnos = new WeakMap<PGlite, Promise<unknown>>()

/** Ejecuta una función como un usuario autenticado concreto (RLS aplicada). */
export function como<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  // Hay una sola conexión: las pantallas leen en paralelo y, sin turno, una lectura correría con el usuario de otra o sin ninguno.
  const anterior = turnos.get(db) ?? Promise.resolve()
  const resultado = anterior.catch(() => undefined).then(async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
    try {
      return await fn()
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
    }
  })
  turnos.set(db, resultado)
  return resultado
}

/** Deja aprobada la revisión de Cumplimiento (fase 3) de los contratos en borrador que no la tienen: sin ella no pasan a firmado. */
export async function aprobarCumplimiento(db: PGlite) {
  const { rows } = await db.query<{ t: string | null }>(`select to_regclass('public.cumplimiento_revisiones')::text as t`)
  if (!rows[0].t) return
  await db.query(`insert into public.cumplimiento_revisiones (contract_id, estado, observaciones, registrado_por)
    select c.id, 'aprobado', 'Aprobado en la prueba', (select id from auth.users order by id limit 1) from public.contracts c
     where c.estado = 'borrador' and public.cumplimiento_estado(c.id) is distinct from 'aprobado'`)
}

const revisoresReserva = new WeakMap<PGlite, string>()

/**
 * Antes de verificar un pago de reserva: registra el pagador y deja aprobada la revisión de Cumplimiento
 * con un revisor distinto de quien solicita y de quien verifica. Solo afecta a las reservas abiertas de la prueba.
 */
export async function prepararReservasParaPago(db: PGlite) {
  // Bases anteriores a la regla de Cumplimiento no tienen estas columnas: no hay nada que preparar.
  const { rows: cols } = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'reservations' and column_name = 'cumplimiento_estado'`)
  if (!cols[0].n) return
  // El revisor de la prueba queda inactivo: solo firma la decisión, sin recibir avisos ni cambiar los destinatarios de las demás pruebas.
  let revisor = revisoresReserva.get(db)
  if (!revisor) {
    const { rows } = await db.query<{ id: string }>('select gen_random_uuid() as id')
    revisor = rows[0].id
    await db.query('insert into auth.users (id, email) values ($1, $2)', [revisor, `revisor-reserva-${revisor.slice(0, 8)}@prueba.local`])
    await db.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, 'Revisor de prueba', $2, 'inactivo', 'oficial_cumplimiento')`, [revisor, `revisor-reserva-${revisor.slice(0, 8)}@prueba.local`])
    revisoresReserva.set(db, revisor)
  }
  await db.query(`select set_config('app.flujo', 'on', false), set_config('app.cumplimiento', 'on', false)`)
  await db.query(
    `update public.reservations set pagador_nombre = coalesce(pagador_nombre, 'Pagador de prueba'),
            pagador_identificacion = coalesce(pagador_identificacion, '0900000001'),
            pagador_relacion = coalesce(pagador_relacion, 'titular')
      where estado = 'solicitada'`)
  await db.query(
    `update public.reservations set cumplimiento_estado = 'aprobado', cumplimiento_decidido_por = $1, cumplimiento_decidido_en = now(),
            apartado_hasta = greatest(apartado_hasta, now() + interval '48 hours')
      where estado = 'solicitada' and cumplimiento_estado is distinct from 'aprobado'`, [revisor])
  await db.query(`select set_config('app.flujo', '', false), set_config('app.cumplimiento', '', false)`)
}

/** Cédula ecuatoriana válida y distinta para cada número: la base no acepta documentos inválidos ni repetidos. */
/** Celular ecuatoriano de prueba, distinto para cada número. */
export const celularPrueba = (n: number) => `09${String(n % 100_000_000).padStart(8, '0')}`

export function cedulaPrueba(n: number) {
  const base = `171${String(n % 1_000_000).padStart(6, '0')}`
  let s = 0
  for (let i = 0; i < 9; i++) {
    const d = Number(base[i]) * (i % 2 === 0 ? 2 : 1)
    s += d > 9 ? d - 9 : d
  }
  return base + ((10 - (s % 10)) % 10)
}
