// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { cargarClientes, persistirCambios } from '../../src/features/clientes/remoto'
import { actualizarCliente, crearCliente, registrarActividad, moverEtapa } from '../../src/features/clientes/service'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import type { Actor } from '../../src/features/inventario/types'
import { datosPglite } from './datos-pglite'
import { como, crearUsuario, GRANTS_SUPABASE, STUB_SUPABASE } from './db'

/**
 * Reproduce el estado de producción deducido del diagnóstico: la versión anterior de 20261031000000 y de 20261031010000,
 * más 20261031020000 ya ejecutada. El correctivo debe dejar Clientes igual que una instalación limpia, sin tocar nada más.
 */
const RAIZ = path.resolve(__dirname, '..')
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
const CORRECTIVO = 'instalacion/correctivo_clientes_produccion.sql'
const GANTT = '20261030000000_plan_responsable_externo.sql'
const ANTERIORES: Record<string, string> = {
  '20261031000000_clientes_crm.sql': 'tests/fixtures/produccion_clientes_crm_anterior.sql',
  '20261031010000_integracion_comercial.sql': 'tests/fixtures/produccion_integracion_anterior.sql',
}

async function instalar(sustituir: Record<string, string>) {
  const db = new PGlite()
  await db.exec(STUB_SUPABASE)
  for (const f of fs.readdirSync(path.join(RAIZ, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    if (f === GANTT) continue
    await db.exec(leer(sustituir[f] ?? `migrations/${f}`))
    if (f.startsWith('20261028120000')) await db.exec(leer('seed.sql'))
    if (f.startsWith('20261028220000')) await db.exec(leer('seed_roles.sql'))
  }
  await db.exec(GRANTS_SUPABASE)
  return db
}

async function foto(db: PGlite) {
  const { rows } = await db.query<{ k: string; v: string }>(`
    select 'columna ' || table_name || '.' || column_name as k, data_type as v from information_schema.columns where table_schema = 'public'
    union all select 'funcion ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
      md5(replace(p.prosrc, chr(13), '')) || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE') || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'disparador ' || event_object_table || '.' || trigger_name, action_statement from information_schema.triggers where trigger_schema = 'public'
    union all select 'politica ' || tablename || '.' || policyname, cmd || ' ' || coalesce(qual, '') || ' / ' || coalesce(with_check, '') from pg_policies where schemaname = 'public'`)
  return new Map(rows.map((r) => [r.k, r.v]))
}
const diferencias = (a: Map<string, string>, b: Map<string, string>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort()

const prepararGrants = (db: PGlite) => db.exec(GRANTS_SUPABASE)

async function actorDe(db: PGlite, id: string): Promise<Actor> {
  const { s } = (await como(db, id, () => db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`))).rows[0]
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
let tel = 990500000
const entrada = (u: string, nombre: string, o: Record<string, unknown> = {}) => ({ nombre, telefono: `0${++tel}`, email: '', origen: 'whatsapp' as const, origenDetalle: '', unidadesInteres: [], presupuesto: null, proposito: null, formaPago: null, asesorId: u, asesor: 'Asesor', ...o })
async function crear(db: PGlite, u: string, nombre: string, o: Record<string, unknown> = {}) {
  const datos = datosPglite(db, u)
  const prev = (await cargarClientes(datos)).state
  const r = crearCliente(prev, entrada(u, nombre, o), await actorDe(db, u))
  await persistirCambios(datos, prev, r.state)
  return r.cliente.id
}

describe('estado de producción antes del correctivo', () => {
  let db: PGlite, u: string
  beforeAll(async () => {
    db = await instalar(ANTERIORES)
    u = await crearUsuario(db, 'Corredora', 'corredor')
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  }, 120_000)

  it('la app detecta con razón que falta la migración', async () => {
    expect((await cargarClientes(datosPglite(db, u))).faltaMigracion).toBe(true)
  })

  it('crear y consultar clientes funciona con las funciones anteriores, pero cotizar falla por la columna que falta', async () => {
    const id = await crear(db, u, 'Sin correctivo')
    expect((await cargarClientes(datosPglite(db, u))).state.clientes.map((c) => c.id)).toContain(id)
    const op = (await como(db, u, () => db.query<{ id: string }>(`select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [id]))).rows[0].id
    await expect(como(db, u, () => db.query(`select public.cotizaciones_emitir($1, 0, 15, '')`, [op]))).rejects.toThrow(/documento/)
  })
})

describe('correctivo', () => {
  let db: PGlite, admin: string, carlos: string, cora: string, sofia: string, limpio: Map<string, string>

  beforeAll(async () => {
    limpio = await foto(await instalar({}))
    db = await instalar(ANTERIORES)
    await db.exec(leer(CORRECTIVO))
    await prepararGrants(db)
    admin = await crearUsuario(db, 'Admin', 'administrador')
    sofia = await crearUsuario(db, 'Sofia', 'supervisor')
    const equipo = (await db.query<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])).rows[0].id
    carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor', { equipo })
    cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  }, 180_000)

  it('deja la base igual que una instalación limpia, salvo lo que queda fuera a propósito', async () => {
    const d = diferencias(await foto(db), limpio)
    // Es de la integración comercial: un contrato no guardaría origen_detalle hasta corregirla. Se informa aparte.
    expect(d).toEqual(['funcion contrato_datos_venta()'])
  })

  it('crea exactamente los cuatro componentes faltantes y lo necesario para que funcionen', async () => {
    for (const o of ['client_access', 'client_import_settings']) expect((await db.query<{ r: string }>(`select to_regclass('public.${o}')::text as r`)).rows[0].r).toBe(`${o}`)
    for (const f of ['clientes_corredores()', 'clientes_importacion_habilitada()']) expect((await db.query<{ r: string }>(`select to_regprocedure('public.${f}')::text as r`)).rows[0].r).toBe(f)
    expect((await cargarClientes(datosPglite(db, carlos))).faltaMigracion).toBe(false)
  })

  it('no toca el Gantt ni Ventas', async () => {
    const sql = leer(CORRECTIVO)
    expect(sql).not.toMatch(/plan_|responsable_externo|contract_documents|contract_milestones|ventas_historicas|contratos_/)
    expect((await db.query(`select 1 from information_schema.columns where table_name = 'plan_activities' and column_name = 'responsable_externo'`)).rows).toHaveLength(0)
  })

  it('no contiene instrucciones que borren datos', () => {
    const sql = leer(CORRECTIVO).toLowerCase().replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b|\bdrop\s+column\b/)
    expect([...sql.matchAll(/\bdrop\s+(\w+)/g)].map((m) => m[1]).every((x) => x === 'policy' || x === 'function')).toBe(true)
    expect([...sql.matchAll(/drop function[^;]*;/g)].map((m) => m[0])).toEqual(['drop function if exists public.clientes_asignar(uuid, int, uuid, text);'])
  })

  it('crear un cliente persiste, con corredor de origen y cédula, y se lee desde otra sesión', async () => {
    const id = await crear(db, carlos, 'Cliente de prueba', { documento: '1712345678', origen: 'corredor', origenDetalle: 'Carlos Corredor' })
    const c = (await cargarClientes(datosPglite(db, carlos))).state.clientes.find((x) => x.id === id)!
    expect(c).toMatchObject({ documento: '1712345678', corredorOrigenId: carlos, asesorId: carlos, etapa: 'nuevo' })
    expect(c.atribucion.usuarioId).toBe(carlos)
  })

  it('llamada y cambio de etapa persisten', async () => {
    const id = await crear(db, carlos, 'Con actividad')
    const d = datosPglite(db, carlos)
    let prev = (await cargarClientes(d)).state
    const actor = await actorDe(db, carlos)
    await persistirCambios(d, prev, registrarActividad(prev, id, { tipo: 'llamada', descripcion: 'Primera llamada', fecha: hoyGuayaquil() }, actor))
    prev = (await cargarClientes(d)).state
    await persistirCambios(d, prev, moverEtapa(prev, id, 'calificado', actor))
    const c = (await cargarClientes(d)).state.clientes.find((x) => x.id === id)!
    expect(c.etapa).toBe('calificado')
    expect(c.actividades.some((a) => a.descripcion === 'Primera llamada')).toBe(true)
  })

  it('permisos entre corredores: cada uno ve lo suyo; supervisor y administración, según su alcance', async () => {
    const id = await crear(db, carlos, 'Solo de Carlos')
    const ve = async (u: string) => (await cargarClientes(datosPglite(db, u))).state.clientes.some((c) => c.id === id)
    expect(await ve(carlos)).toBe(true)
    expect(await ve(cora)).toBe(false)
    expect(await ve(sofia)).toBe(true)
    expect(await ve(admin)).toBe(true)
    await expect(como(db, cora, () => db.query(`select public.clientes_registrar_actividad(null, $1, 'nota', current_date, 'Ajena', null)`, [id]))).rejects.toThrow(/fuera de tu alcance/)
    await expect(como(db, carlos, () => db.query(`update public.clients set nombre = 'Directo' where id = $1`, [id]))).rejects.toThrow(/row-level security/)
  })

  it('reasignar: el anterior pierde el acceso, el nuevo lo recibe y la atribución no cambia', async () => {
    const id = await crear(db, carlos, 'Por reasignar')
    const d = datosPglite(db, admin)
    const prev = (await cargarClientes(d)).state
    const c = prev.clientes.find((x) => x.id === id)!
    await persistirCambios(d, prev, actualizarCliente(prev, id, { ...c, asesorId: cora, asesor: 'Cora', motivoAsignacion: 'Cambio de zona' }, await actorDe(db, admin)))
    expect((await cargarClientes(datosPglite(db, carlos))).state.clientes.some((x) => x.id === id)).toBe(false)
    const nuevo = (await cargarClientes(datosPglite(db, cora))).state.clientes.find((x) => x.id === id)!
    expect(nuevo.atribucion.usuarioId).toBe(carlos)
  })

  it('cotizar deja de fallar', async () => {
    const id = await crear(db, carlos, 'Para cotizar', { documento: '1799999999' })
    const op = (await como(db, carlos, () => db.query<{ id: string }>(`select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [id]))).rows[0].id
    await como(db, carlos, () => db.query(`select public.cotizaciones_emitir($1, 0, 15, '')`, [op]))
    const q = await db.query<{ cliente: { documento: string } }>(`select cliente from public.quotes where client_id = $1`, [id])
    expect(q.rows[0].cliente.documento).toBe('1799999999')
  })
})

describe('seguridad al ejecutarlo', () => {
  const contar = async (db: PGlite) => (await foto(db)).size

  it('se puede repetir si la base sigue sin clientes', async () => {
    const db = await instalar(ANTERIORES)
    await db.exec(leer(CORRECTIVO))
    const una = await foto(db)
    await db.exec(leer(CORRECTIVO))
    expect(diferencias(await foto(db), una)).toEqual([])
  }, 120_000)

  it('si ya hay clientes se detiene y no aplica nada', async () => {
    const db = await instalar(ANTERIORES)
    const u = await crearUsuario(db, 'Vera', 'asesor')
    await db.query(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Existente', '0991110000', 'whatsapp', $1, $1, $1)`, [u])
    const antes = await contar(db)
    await expect(db.exec(leer(CORRECTIVO))).rejects.toThrow(/Ya hay clientes/)
    await db.exec('rollback')
    expect(await contar(db)).toBe(antes)
    expect((await db.query(`select to_regclass('public.client_access') as r`)).rows[0]).toEqual({ r: null })
  }, 120_000)

  it('sobre una base que no tiene la versión anterior se detiene', async () => {
    const db = await instalar({})
    await db.exec(`drop function public.clientes_crear(uuid, jsonb, uuid)`)
    await expect(db.exec(leer(CORRECTIVO))).rejects.toThrow(/estado esperado/)
  }, 120_000)
})

describe('diagnóstico de solo lectura', () => {
  const diagnostico = async (db: PGlite) => {
    const r = await db.query<{ seccion: string; objeto: string; resultado: string }>(leer('instalacion/diagnostico_solo_lectura.sql'))
    return new Map(r.rows.map((f) => [`${f.seccion}:${f.objeto}`, f.resultado]))
  }

  it('es una sola consulta y no escribe', () => {
    const sql = leer('instalacion/diagnostico_solo_lectura.sql').replace(/--.*$/gm, '')
    expect(sql.trim().match(/;/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/i)
  })

  it('reconoce el estado de producción, y después del correctivo lo da por actualizado', async () => {
    const db = await instalar(ANTERIORES)
    const antes = await diagnostico(db)
    expect(antes.get('tabla o vista:client_access')).toBe('NO EXISTE')
    expect(antes.get('columna:clients.documento')).toBe('NO EXISTE')
    expect(antes.get('funcion:clientes_corredores')).toMatch(/^NO EXISTE/)
    expect(antes.get('funcion:clientes_crear')).toMatch(/^version anterior/)
    expect(antes.get('funcion:clientes_asignar')).toMatch(/^version anterior/)
    expect(antes.get('registros:clients')).toBe('0')
    await db.exec(leer(CORRECTIVO))
    const despues = await diagnostico(db)
    expect(despues.get('tabla o vista:client_access')).toBe('existe')
    for (const [k, v] of despues) if (k.startsWith('funcion:')) expect(`${k} ${v}`).toMatch(/igual al repositorio actual/)
  }, 180_000)
})
