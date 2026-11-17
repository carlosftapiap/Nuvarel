// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario, GRANTS_SUPABASE } from './db'

const STORAGE = `
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner_id text default auth.uid()::text, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
`

let db: PGlite
let admin: string, vendedor: string
let n = 0
const hash = () => String(++n).padStart(64, '0')
const ruta = (e: number, piso: string) => `E${e}/${piso}/plano-${++n}.pdf`

const rpc = <T = unknown>(u: string, fn: string, args: unknown[], tipos: string) =>
  como(db, u, async () => (await db.query<{ r: T }>(`select public.${fn}(${tipos}) as r`, args)).rows[0]?.r)

async function subir(u: string, r: string) {
  await como(db, u, () => db.query(`insert into storage.objects (bucket_id, name) values ('planos-amura', $1)`, [r]))
}

type Res = { id: string; estado: string; inconsistencias: string[]; reemplazo: string | null }
async function registrar(o: { tipo?: 'piso' | 'unidad'; edificio: number; piso: string; unidad?: string | null; nivel?: string | null; unidades?: string[]; sha?: string; reemplazar?: boolean; usuario?: string }) {
  const r = ruta(o.edificio, o.piso)
  const u = o.usuario ?? admin
  await subir(u, r)
  return rpc<Res>(u, 'planos_registrar',
    [o.tipo ?? 'piso', o.edificio, o.piso, o.unidad ?? null, o.nivel ?? null, o.unidades ?? [], r, o.sha ?? hash(), 1, 'plano.pdf', o.reemplazar ?? false],
    '$1, $2::smallint, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11::boolean')
}
const eliminar = (id: string, u = admin) => rpc(u, 'planos_eliminar', [id], '$1::uuid')
const estadoDe = async (id: string) => (await db.query<{ estado: string }>(`select estado from planos where id = $1`, [id])).rows[0]?.estado

beforeAll(async () => {
  // Producción: 0021 ya ejecutada; luego 0022. Se aplica con Storage simulado para que el bucket y sus políticas existan.
  db = await crearDb({ hasta: '20261130000000_planos.sql' })
  await db.exec(STORAGE)
  const fs = await import('node:fs')
  const path = await import('node:path')
  for (const m of ['20261130000000_planos.sql', '20261201000000_planos_carga_simple.sql']) {
    await db.exec(fs.readFileSync(path.resolve(__dirname, `../migrations/${m}`), 'utf8'))
  }
  await db.exec(GRANTS_SUPABASE)
  await db.exec(`revoke insert, update, delete on public.planos from authenticated`)
  admin = await crearUsuario(db, 'Ana Admin', 'administrador')
  vendedor = await crearUsuario(db, 'Vera Vendedora', 'asesor')
}, 120_000)

describe('planos · carga directa y validación contra el inventario', () => {
  it('plano de piso consistente: queda disponible al cargarlo', async () => {
    const r = await registrar({ edificio: 2, piso: '2', nivel: 'P-2', unidades: ['B-201', 'B-202', 'B-203', 'B-204', 'B-205', 'B-206', 'B-207'] })
    expect(r.inconsistencias).toEqual([])
    expect(r.estado).toBe('publicado')
  })

  it('segundo plano del mismo piso sin confirmación: no reemplaza y no cambia nada', async () => {
    await expect(registrar({ edificio: 2, piso: '2', unidades: ['B-201', 'B-202', 'B-203', 'B-204', 'B-205', 'B-206', 'B-207'] })).rejects.toThrow(/Confirma que quieres reemplazarlo/)
    const { rows } = await db.query<{ estado: string }>(`select estado from planos where edificio = 2 and piso = '2' and estado = 'publicado'`)
    expect(rows).toHaveLength(1)
  })

  it('con confirmación, reemplaza: el anterior queda «reemplazado» y se conserva', async () => {
    const anterior = (await db.query<{ id: string }>(`select id from planos where edificio = 2 and piso = '2' and estado = 'publicado'`)).rows[0].id
    const r = await registrar({ edificio: 2, piso: '2', unidades: ['B-201', 'B-202', 'B-203', 'B-204', 'B-205', 'B-206', 'B-207'], reemplazar: true })
    expect(r.estado).toBe('publicado')
    expect(r.reemplazo).toBe(anterior)
    expect(await estadoDe(anterior)).toBe('reemplazado')
  })

  it('caso real Torre B planta baja: B-101…B-107 → bloqueado, no disponible para vendedores', async () => {
    const r = await registrar({ edificio: 2, piso: 'PB', nivel: 'PB', unidades: ['B-101', 'B-102', 'B-103', 'B-104', 'B-105', 'B-106', 'B-107'] })
    expect(r.estado).toBe('en_revision')
    expect(r.inconsistencias.join(' ')).toMatch(/no están en ese piso del inventario: B101/)
    expect(r.inconsistencias.join(' ')).toMatch(/Faltan en el plano .*B001/)
  })

  it('caso real «P-3» con B-401…B-407 cargado como piso 3: bloqueado', async () => {
    const r = await registrar({ edificio: 2, piso: '3', nivel: 'P-3', unidades: ['B-401', 'B-402', 'B-403', 'B-404', 'B-405', 'B-406', 'B-407'] })
    expect(r.estado).toBe('en_revision')
  })

  it('nivel escrito distinto del piso elegido: bloqueado', async () => {
    const r = await registrar({ edificio: 2, piso: '5', nivel: 'P-4', unidades: ['B-501', 'B-502', 'B-503', 'B-504', 'B-505', 'B-506', 'B-507'] })
    expect(r.estado).toBe('en_revision')
    expect(r.inconsistencias[0]).toMatch(/nivel «P-4»/)
  })

  it('archivo duplicado: el segundo queda bloqueado', async () => {
    const sha = 'f'.repeat(64)
    const a = await registrar({ edificio: 1, piso: '1', nivel: 'P-1', unidades: ['A101', 'A102', 'A103', 'A104', 'A105'], sha })
    expect(a.estado).toBe('publicado')
    const b = await registrar({ edificio: 1, piso: '2', nivel: 'P-2', unidades: ['A201', 'A202', 'A203', 'A204', 'A205'], sha })
    expect(b.estado).toBe('en_revision')
    expect(b.inconsistencias.join(' ')).toMatch(/idéntico a otro plano/)
  })

  it('carga sin numeración del plano: disponible, porque no hay nada que contradecir', async () => {
    const r = await registrar({ edificio: 1, piso: '3' })
    expect(r.estado).toBe('publicado')
    const { rows } = await db.query<{ nivel_en_plano: string | null; unidades_en_plano: string[] }>(`select nivel_en_plano, unidades_en_plano from planos where id = $1`, [r.id])
    expect(rows[0]).toEqual({ nivel_en_plano: null, unidades_en_plano: [] })
  })

  it('plano de departamento: debe mostrar solo esa unidad y pertenecer a ese piso', async () => {
    const ok = await registrar({ tipo: 'unidad', edificio: 1, piso: 'PB', unidad: 'E1-PB-A2', nivel: 'PB', unidades: ['A002'] })
    expect(ok.estado).toBe('publicado')
    const mal = await registrar({ tipo: 'unidad', edificio: 1, piso: 'PB', unidad: 'E1-PB-A2', nivel: 'PB', unidades: ['A003'] })
    expect(mal.estado).toBe('en_revision')
    const otroPiso = await registrar({ tipo: 'unidad', edificio: 1, piso: '1', unidad: 'E1-PB-A2', nivel: 'P-1', unidades: ['A002'] })
    expect(otroPiso.inconsistencias.join(' ')).toMatch(/otro edificio o piso/)
  })
})

describe('planos · permisos y visibilidad', () => {
  it('un vendedor no carga ni elimina', async () => {
    await expect(como(db, vendedor, () => db.query(`insert into storage.objects (bucket_id, name) values ('planos-amura', 'E1/PB/x.pdf')`))).rejects.toThrow()
    await expect(rpc(vendedor, 'planos_registrar', ['piso', 1, 'PB', null, 'PB', ['A001'], 'E1/PB/x.pdf', hash(), 1, 'x.pdf', false], '$1, $2::smallint, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11::boolean')).rejects.toThrow(/administrador/)
    const r = await registrar({ edificio: 1, piso: '5', nivel: 'P-5', unidades: ['A501', 'A502', 'A503', 'A504', 'A505'] })
    await expect(eliminar(r.id, vendedor)).rejects.toThrow(/administrador/)
  })

  it('un vendedor solo ve planos disponibles y solo descarga sus archivos', async () => {
    const visibles = await como(db, vendedor, () => db.query<{ estado: string; ruta: string }>(`select estado, ruta from planos`))
    expect(visibles.rows.length).toBeGreaterThan(0)
    expect(new Set(visibles.rows.map((x) => x.estado))).toEqual(new Set(['publicado']))
    const archivos = await como(db, vendedor, () => db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'planos-amura'`))
    const publicadas = new Set(visibles.rows.map((x) => x.ruta))
    expect(archivos.rows.length).toBe(publicadas.size)
    for (const a of archivos.rows) expect(publicadas.has(a.name)).toBe(true)
  })

  it('nadie edita ni borra la tabla directamente', async () => {
    await expect(como(db, admin, () => db.query(`update planos set estado = 'publicado'`))).rejects.toThrow()
    await expect(como(db, admin, () => db.query(`delete from planos`))).rejects.toThrow()
  })
})

describe('planos · eliminar', () => {
  it('eliminar retira el plano de vendedores, conserva el registro y pide que no se repita', async () => {
    const r = await registrar({ edificio: 1, piso: '4', nivel: 'P-4', unidades: ['A401', 'A402', 'A403', 'A404', 'A405'] })
    expect(r.estado).toBe('publicado')
    await eliminar(r.id)
    expect(await estadoDe(r.id)).toBe('eliminado')
    const visibles = await como(db, vendedor, () => db.query<{ id: string }>(`select id from planos where id = $1`, [r.id]))
    expect(visibles.rows).toHaveLength(0)
    await expect(eliminar(r.id)).rejects.toThrow(/ya fue retirado/)
  })

  it('eliminar un plano bloqueado también funciona', async () => {
    const r = await registrar({ edificio: 2, piso: '4', nivel: 'P-3', unidades: ['B-401'] })
    expect(r.estado).toBe('en_revision')
    await eliminar(r.id)
    expect(await estadoDe(r.id)).toBe('eliminado')
  })
})
