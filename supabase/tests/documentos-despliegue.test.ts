// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { como, crearUsuario, GRANTS_SUPABASE, STUB_SUPABASE } from './db'

const RAIZ = path.resolve(__dirname, '..')
const MODULO = '20261031130000_documentos_contractuales.sql'
const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
const REVERTIR = 'instalacion/revertir_documentos_contractuales.sql'

/** Base como producción: sin este módulo y sin las otras migraciones pendientes (Plan y Avance de obra). */
async function baseSinModulo() {
  const db = new PGlite()
  await db.exec(STUB_SUPABASE)
  for (const f of fs.readdirSync(path.join(RAIZ, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    if ([MODULO, '20261030000000_plan_responsable_externo.sql', '20261031120000_avance_obra.sql', '20261031210000_obra_avance_directo.sql'].includes(f)) continue
    await db.exec(leer(`migrations/${f}`))
    if (f.startsWith('20261028120000')) await db.exec(leer('seed.sql'))
    if (f.startsWith('20261028220000')) await db.exec(leer('seed_roles.sql'))
  }
  await db.exec(`delete from public.role_permissions where permiso in ('ventas.plantillas_ver','ventas.plantillas','ventas.plantillas_aprobar','ventas.documentos_ver','ventas.documentos_generar','ventas.documentos_emitir','ventas.datos_comprador');`)
  await db.exec(GRANTS_SUPABASE)
  return db
}

const huella = async (db: PGlite) => ({
  columnas: (await db.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows,
  funciones: (await db.query(`select proname, pg_get_function_identity_arguments(oid) a, md5(prosrc) h from pg_proc where pronamespace = 'public'::regnamespace order by 1, 2`)).rows,
  politicas: (await db.query(`select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2`)).rows,
  disparadores: (await db.query(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal order by 1, 2`)).rows,
  permisos: (await db.query(`select role_id, permiso from public.role_permissions order by 1, 2`)).rows,
})
const STORAGE = `
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;
`

describe('compatibilidad con producción', () => {
  it('se aplica sin las otras migraciones pendientes, no cambia datos comerciales y se puede repetir', async () => {
    const db = await baseSinModulo()
    const sello = async () => ({
      unidades: (await db.query(`select codigo, estado, usd_m2, precio_referencia from public.inventory_units order by codigo`)).rows,
      clientes: (await db.query(`select count(*) from public.clients`)).rows,
      pct: (await db.query(`select * from public.pricing_params`)).rows,
    })
    const antes = await sello()
    await db.exec(leer(`migrations/${MODULO}`))
    expect(await sello()).toEqual(antes)
    await db.exec(leer(`migrations/${MODULO}`))
    expect(await sello()).toEqual(antes)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.obra_frentes`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n).toBe(-1)
  }, 180_000)

  it('no reescribe ninguna función ni política existente', async () => {
    const db = await baseSinModulo()
    const antes = await huella(db)
    await db.exec(leer(`migrations/${MODULO}`))
    const despues = await huella(db)
    for (const f of antes.funciones) expect(despues.funciones).toContainEqual(f)
    for (const p of antes.politicas) expect(despues.politicas).toContainEqual(p)
    for (const d of antes.disparadores) expect(despues.disparadores).toContainEqual(d)
    for (const c of antes.columnas) expect(despues.columnas).toContainEqual(c)
    for (const r of antes.permisos) expect(despues.permisos).toContainEqual(r)
  }, 180_000)
})

describe('plan de recuperación', () => {
  it('revertir deja la base exactamente como estaba', async () => {
    const db = await baseSinModulo()
    await db.exec(STORAGE)
    const antes = await huella(db)
    await db.exec(leer(`migrations/${MODULO}`))
    expect((await db.query(`select id from storage.buckets`)).rows).toHaveLength(2)
    await db.exec(leer(REVERTIR))
    expect(await huella(db)).toEqual(antes)
    expect((await db.query(`select id from storage.buckets`)).rows).toEqual([])
    expect((await db.query(`select policyname from pg_policies where schemaname = 'storage'`)).rows).toEqual([])
    // Y se puede volver a aplicar.
    await db.exec(leer(`migrations/${MODULO}`))
    expect((await db.query(`select id from storage.buckets`)).rows).toHaveLength(2)
  }, 180_000)

  it('se niega a revertir si el módulo ya tiene información', async () => {
    const db = await baseSinModulo()
    await db.exec(leer(`migrations/${MODULO}`))
    await db.query(`update public.entidad_vendedora set razon_social = 'Con datos' where id = 1`)
    await expect(db.exec(leer(REVERTIR))).rejects.toThrow(/entidad vendedora ya tiene datos/)
    await db.exec('rollback')
    expect((await db.query(`select razon_social from public.entidad_vendedora`)).rows).toEqual([{ razon_social: 'Con datos' }])
  }, 180_000)
})

describe('almacenamiento privado (políticas con un Storage simulado)', () => {
  let db: PGlite
  let legal: string, gerente: string, finanzas: string, constructor: string, corredor: string
  let contrato: string
  const pone = (u: string, bucket: string, name: string) => como(db, u, () => db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name]))
  const ve = async (u: string, bucket: string) => (await como(db, u, () => db.query<{ name: string }>(`select name from storage.objects where bucket_id = $1 order by name`, [bucket]))).rows.map((r) => r.name)

  beforeAll(async () => {
    db = await baseSinModulo()
    await db.exec(STORAGE)
    await db.exec(leer(`migrations/${MODULO}`))
    await db.exec(GRANTS_SUPABASE)
    legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
    gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
    finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
    constructor = await crearUsuario(db, 'Constructor', 'constructor')
    corredor = await crearUsuario(db, 'Corredor', 'corredor')
    await db.exec(`alter table public.contracts disable trigger all; alter table public.reservations disable trigger all;`)
    const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Comprador', '0991110000', 'whatsapp', $1, $1, $1) returning id`, [corredor])).rows[0].id
    const q = (await db.query<{ id: string }>(`select gen_random_uuid() id`)).rows[0].id
    await db.exec(`alter table public.reservations drop constraint if exists reservations_quote_id_fkey`)
    const r = (await db.query<{ id: string }>(`insert into public.reservations (codigo, codigo_unidad, client_id, created_by, quote_id, precio_acordado, monto_reserva, reserva_pct, meses, cuota_mensual, estado, vigencia_hasta) values ('RES-1', 'E1-PB-A1', $1, $2, $3, 100000, 500, 6, 30, 100, 'confirmada', (now() at time zone 'America/Guayaquil')::date + 30) returning id`, [cli, corredor, q])).rows[0].id
    contrato = (await db.query<{ id: string }>(`insert into public.contracts (codigo, reservation_id, client_id, codigo_unidad, precio, fecha_contrato, created_by) values ('CON-1', $1, $2, 'E1-PB-A1', 100000, (now() at time zone 'America/Guayaquil')::date, $3) returning id`, [r, cli, legal])).rows[0].id
    await db.exec(`alter table public.contracts enable trigger all; alter table public.reservations enable trigger all;`)
  }, 180_000)

  it('los dos buckets son privados y con límite de tamaño', async () => {
    expect((await db.query(`select id, public, file_size_limit from storage.buckets order by id`)).rows).toEqual([
      { id: 'documentos-contratos', public: false, file_size_limit: '26214400' },
      { id: 'plantillas-contratos', public: false, file_size_limit: '26214400' },
    ].map((b) => ({ ...b, file_size_limit: expect.anything() })))
  })

  it('solo quien administra plantillas sube modelos; un archivo sin registrar no lo descarga nadie', async () => {
    const familia = '11111111-1111-4111-8111-111111111111'
    const ruta = `${familia}/modelo.docx`
    for (const u of [gerente, finanzas, constructor, corredor]) await expect(pone(u, 'plantillas-contratos', ruta)).rejects.toThrow()
    await pone(legal, 'plantillas-contratos', ruta)
    expect(await ve(legal, 'plantillas-contratos')).toEqual([])
    await como(db, legal, () => db.query(`select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Modelo recibido de Legal')`, [familia, JSON.stringify({ nombre: 'Compraventa', tipo_documento: 'contrato_compraventa', formato: 'docx', archivo_ruta: ruta, archivo_nombre: 'modelo.docx', archivo_hash: 'a'.repeat(64), archivo_tamano: 100, variables: [] })]))
    expect(await ve(legal, 'plantillas-contratos')).toEqual([ruta])
    expect(await ve(gerente, 'plantillas-contratos')).toEqual([ruta])
    for (const u of [finanzas, constructor, corredor]) expect(await ve(u, 'plantillas-contratos')).toEqual([])
  })

  it('los documentos: los sube quien genera, los leen los autorizados; Constructor y Comercial no', async () => {
    const familia = '22222222-2222-4222-8222-222222222222'
    const id = (await como(db, legal, () => db.query<{ r: string }>(`select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Plantilla de texto') as r`, [familia, JSON.stringify({ nombre: 'Anexo', tipo_documento: 'anexo', formato: 'texto', cuerpo: 'Texto', variables: [] })]))).rows[0].r
    await como(db, legal, () => db.query(`select public.contratos_plantilla_aprobar($1::uuid, 'Aprobada por Legal')`, [id]))
    const ruta = `${contrato}/x/documento.pdf`
    for (const u of [gerente, finanzas, constructor, corredor]) await expect(pone(u, 'documentos-contratos', ruta)).rejects.toThrow()
    await expect(pone(legal, 'documentos-contratos', `no-es-un-contrato/x.pdf`)).rejects.toThrow()
    await pone(legal, 'documentos-contratos', ruta)
    expect(await ve(legal, 'documentos-contratos')).toEqual([])
    await como(db, legal, async () => {
      const d = (await db.query<{ d: unknown }>(`select public.contratos_datos_documento($1::uuid, '{}'::jsonb) as d`, [contrato])).rows[0].d
      await db.query(`select public.contratos_documento_registrar($1::uuid, $2::uuid, '{}'::jsonb, $3::jsonb, $4::jsonb, null, 'Documento generado')`, [contrato, id, JSON.stringify(d), JSON.stringify({ ruta, hash: 'b'.repeat(64), tamano: 10 })])
    })
    for (const u of [legal, finanzas]) expect(await ve(u, 'documentos-contratos')).toEqual([ruta])
    for (const u of [constructor, corredor]) expect(await ve(u, 'documentos-contratos')).toEqual([])
  })
})
