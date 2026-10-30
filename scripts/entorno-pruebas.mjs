#!/usr/bin/env node
/**
 * Entorno de pruebas local: Postgres en memoria (PGlite) con las migraciones reales del proyecto, detrás de un servidor
 * que responde como Supabase Auth y su API REST en lo que usa la app. RLS y funciones se ejecutan como en producción.
 * No se conecta a ningún proyecto de Supabase; los datos se pierden al detenerlo. No sustituye la prueba en un proyecto alojado.
 *
 *   npm run entorno:pruebas
 *   VITE_SUPABASE_URL=http://127.0.0.1:54399 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 5174
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../supabase')
const PUERTO = Number(process.env.PUERTO ?? 54399)
const CLAVE = 'Prueba123'
const PARSERS = { 1700: Number, 1082: (v) => v, 1114: (v) => v, 1184: (v) => v }
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador no válido: ${s}`)
  return s
}

const db = new PGlite()
await db.exec(`
create role anon nologin; create role authenticated nologin; create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; grant select on auth.users to authenticated;`)
for (const m of fs.readdirSync(path.join(RAIZ, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(RAIZ, 'migrations', m), 'utf8'))
  if (m.startsWith('20261028120000')) await db.exec(fs.readFileSync(path.join(RAIZ, 'seed.sql'), 'utf8'))
  if (m.startsWith('20261028220000')) await db.exec(fs.readFileSync(path.join(RAIZ, 'seed_roles.sql'), 'utf8'))
}
await db.exec(`grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;`)

/* ------------------------------------------------------------ usuarios de prueba */

const usuarios = new Map()
async function crearUsuario(nombre, email, rol, extra = {}) {
  const id = (await db.query('select gen_random_uuid() as id')).rows[0].id
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  await db.query(`insert into public.profiles (id, nombre, email, estado, rol_id, alcance, equipo_id) values ($1, $2, $3, 'activo', $4, $5, $6)`, [id, nombre, email, rol, extra.alcance ?? null, extra.equipo ?? null])
  usuarios.set(email, { id, email, nombre })
  return id
}
const admin = await crearUsuario('Ana Administradora', 'admin@prueba.local', 'administrador')
await crearUsuario('Gabriel Gerente', 'gerente@prueba.local', 'gerencia')
await crearUsuario('Fernanda Finanzas', 'finanzas@prueba.local', 'finanzas', { alcance: 'empresa' })
const supervisora = await crearUsuario('Sofía Supervisora', 'supervisora@prueba.local', 'supervisor')
const equipo = (await db.query(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [supervisora])).rows[0].id
await crearUsuario('Carlos Corredor', 'corredor1@prueba.local', 'corredor', { equipo })
await crearUsuario('Cora Corredora', 'corredor2@prueba.local', 'corredor')
await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${admin}', false);`)
await db.query(`select public.config_definir_receptor('NUVAREL', 'Entorno de pruebas')`)
await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)

/* ------------------------------------------------------------------- utilidades */

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const usuarioDe = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { nombre: u.nombre }, created_at: '2026-01-01T00:00:00Z' })
function sesion(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return {
    access_token: `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp })}.prueba`,
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: u.email, user: usuarioDe(u),
  }
}
const idDe = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')
  try { return m ? JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString()).sub ?? null : null } catch { return null }
}
const nombreColumna = (c) => ident(c)

/** Cada petición corre en su transacción, con el rol y el usuario de la sesión: si falla, se revierte, igual que en PostgREST. */
function comoUsuario(userId, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${userId ?? ''}', true);`)
    return fn(tx)
  })
}

function filtros(params) {
  const partes = []; const valores = []
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue
    if (v === 'is.null') partes.push(`${nombreColumna(k)} is null`)
    else if (v.startsWith('eq.')) { valores.push(v.slice(3)); partes.push(`${nombreColumna(k)}::text = $${valores.length}`) }
    else throw new Error(`Filtro no admitido en el entorno de pruebas: ${k}=${v}`)
  }
  return { where: partes.length ? ` where ${partes.join(' and ')}` : '', valores }
}

async function rest(req, url, cuerpo) {
  const [, , , recurso, nombre] = url.pathname.split('/')
  const userId = idDe(req)
  if (recurso === 'rpc') {
    const args = Object.keys(cuerpo ?? {})
    const lista = args.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
    const valores = args.map((k) => (cuerpo[k] !== null && typeof cuerpo[k] === 'object' && (!Array.isArray(cuerpo[k]) || cuerpo[k].some((x) => x !== null && typeof x === 'object')) ? JSON.stringify(cuerpo[k]) : cuerpo[k]))
    const f = await db.query(`select bool_or(proretset) as s, count(*)::int as n from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [nombre])
    if (!f.rows[0].n) return [404, { code: 'PGRST202', message: `Could not find the function public.${nombre} in the schema cache` }]
    return comoUsuario(userId, async (tx) => {
      if (f.rows[0].s) return [200, (await tx.query(`select * from public.${ident(nombre)}(${lista})`, valores, { parsers: PARSERS })).rows]
      return [200, (await tx.query(`select public.${ident(nombre)}(${lista}) as r`, valores, { parsers: PARSERS })).rows[0]?.r ?? null]
    })
  }
  const tabla = ident(recurso)
  return comoUsuario(userId, async (tx) => {
    if (req.method === 'GET') {
      const { where, valores } = filtros(url.searchParams)
      const orden = url.searchParams.get('order')?.split(',').map((o) => { const [c, d] = o.split('.'); return `${nombreColumna(c)} ${d === 'desc' ? 'desc' : 'asc'}` }).join(', ')
      const limite = url.searchParams.get('limit'); const salto = url.searchParams.get('offset')
      const sql = `select * from public.${tabla}${where}${orden ? ` order by ${orden}` : ''}${limite ? ` limit ${Number(limite)}` : ''}${salto ? ` offset ${Number(salto)}` : ''}`
      return [200, (await tx.query(sql, valores, { parsers: PARSERS })).rows]
    }
    if (req.method === 'POST') {
      const cols = Object.keys(cuerpo)
      const r = await tx.query(`insert into public.${tabla} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, cols.map((c) => cuerpo[c]), { parsers: PARSERS })
      return [201, req.headers.accept?.includes('vnd.pgrst.object') ? r.rows[0] : r.rows]
    }
    if (req.method === 'PATCH') {
      const cols = Object.keys(cuerpo)
      const { where, valores } = filtros(url.searchParams)
      const desplazado = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + cols.length}`)
      const r = await tx.query(`update public.${tabla} set ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ')}${desplazado} returning *`, [...cols.map((c) => cuerpo[c]), ...valores], { parsers: PARSERS })
      return [200, r.rows]
    }
    return [405, { message: 'Método no admitido en el entorno de pruebas' }]
  })
}

function auth(req, url, cuerpo) {
  const ruta = url.pathname.replace('/auth/v1', '')
  if (ruta === '/token') {
    const grant = url.searchParams.get('grant_type')
    const u = usuarios.get(grant === 'refresh_token' ? cuerpo.refresh_token : cuerpo.email)
    if (!u || (grant === 'password' && cuerpo.password !== CLAVE)) return [400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]
    return [200, sesion(u)]
  }
  if (ruta === '/user') {
    const u = [...usuarios.values()].find((x) => x.id === idDe(req))
    return u ? [200, usuarioDe(u)] : [401, { msg: 'invalid JWT' }]
  }
  if (ruta === '/logout') return [204, null]
  return [404, { msg: `Ruta de autenticación no admitida en el entorno de pruebas: ${ruta}` }]
}

/* --------------------------------------------------------------------- servidor */

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  let datos = ''
  req.on('data', (c) => { datos += c })
  req.on('end', async () => {
    const url = new URL(req.url, 'http://local')
    const responder = (codigo, cuerpo) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json' })
      res.end(cuerpo === null || cuerpo === undefined ? (codigo === 204 ? undefined : 'null') : JSON.stringify(cuerpo))
    }
    try {
      const cuerpo = datos ? JSON.parse(datos) : undefined
      const [codigo, respuesta] = url.pathname.startsWith('/auth/v1') ? auth(req, url, cuerpo) : await rest(req, url, cuerpo)
      responder(codigo, respuesta)
    } catch (e) {
      const denegado = /row-level security|permission denied/.test(e.message) || e.code === '42501'
      responder(denegado ? 403 : 400, { message: e.message, code: e.code ?? 'P0001', details: null, hint: null })
    }
  })
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`Entorno de pruebas en http://127.0.0.1:${PUERTO} (contraseña de todos: ${CLAVE})`)
  for (const u of usuarios.values()) console.log(`  ${u.email} · ${u.nombre}`)
})
