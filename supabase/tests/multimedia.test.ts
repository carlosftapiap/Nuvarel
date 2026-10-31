import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { MEDIOS_BASE } from '../../src/features/marca/medios'
import { como, crearDb, crearUsuario, GRANTS_SUPABASE } from './db'

const MIGRACION = path.resolve(__dirname, '../migrations/20261031220000_multimedia_proyecto.sql')
const TORRES = 'a1000000-0000-4000-8000-000000000002'
const VIDEO = 'a1000000-0000-4000-8000-000000000001'
const HASH = 'a'.repeat(64)

// Storage de Supabase, con las columnas que usan las políticas de la migración.
const STORAGE = `
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner_id text default auth.uid()::text, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
`

let db: PGlite
let admin: string, vera: string, inactivo: string
let n = 0

const ruta = (nombre: string) => `archivos/00000000-0000-4000-8000-${String(++n).padStart(12, '0')}-${nombre}`
const cargar = (u: string, name: string, mime: string, size: number) => como(db, u, () => db.query(`insert into storage.objects (bucket_id, name, metadata) values ('multimedia-proyecto', $1, $2)`, [name, JSON.stringify({ mimetype: mime, size })]))
const ve = async (u: string, name: string) => (await como(db, u, () => db.query(`select 1 from storage.objects where bucket_id = 'multimedia-proyecto' and name = $1`, [name]))).rows.length === 1
const quita = async (u: string, name: string) => (await como(db, u, () => db.query(`delete from storage.objects where bucket_id = 'multimedia-proyecto' and name = $1 returning 1`, [name]))).rows.length === 1
const rpc = <T = unknown>(u: string, fn: string, args: unknown[], tipos = '') => como(db, u, async () => (await db.query<{ r: T }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})${tipos} as r`, args)).rows[0]?.r)
const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]

/** Sube imagen y miniatura como lo hace la app y devuelve los datos de la carga. */
async function imagen(u = admin, tamano = 1000) {
  const principal = ruta('foto.webp')
  const mini = ruta('mini.webp')
  await cargar(u, principal, 'image/webp', tamano)
  await cargar(u, mini, 'image/webp', 200)
  return { ruta: principal, miniatura_ruta: mini, mime: 'image/webp', tamano, ancho: 800, alto: 600, hash: HASH, nombre: 'foto.webp' }
}
const crear = async (titulo = 'Nueva foto') => rpc<string>(admin, 'medio_crear', ['imagen', titulo, 'Descripción', true, true, JSON.stringify(await imagen())])

beforeAll(async () => {
  db = await crearDb()
  await db.exec(STORAGE)
  await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
  await db.exec(GRANTS_SUPABASE)
  admin = await crearUsuario(db, 'Ana Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  inactivo = await crearUsuario(db, 'Iván Inactivo', 'asesor')
  await db.query(`update public.profiles set estado = 'inactivo' where id = $1`, [inactivo])
}, 120_000)

describe('material actual', () => {
  it('conserva las cuatro imágenes y el video como versión 1, igual que la app sin migración', async () => {
    const filas = (await db.query<{ id: string; titulo: string; ruta: string; miniatura_ruta: string; ruta_vertical: string | null; numero: number }>(
      `select m.id, m.titulo, v.ruta, v.miniatura_ruta, v.ruta_vertical, v.numero from public.medios_proyecto m join public.medio_versiones v on v.id = m.version_vigente where m.id::text like 'a1000000-%' order by m.orden`)).rows
    expect(filas.map((f) => f.ruta)).toEqual(MEDIOS_BASE.map((m) => m.src))
    expect(filas.map((f) => f.miniatura_ruta)).toEqual(MEDIOS_BASE.map((m) => m.miniatura))
    expect(filas.map((f) => f.titulo)).toEqual(MEDIOS_BASE.map((m) => m.titulo))
    expect(filas.every((f) => f.numero === 1)).toBe(true)
    for (const f of filas) expect(fs.existsSync(path.resolve(__dirname, '../../public', f.ruta.slice(1)))).toBe(true)
  })

  it('repetir la migración no pisa lo que cambió el administrador', async () => {
    const id = await crear('Foto para repetir')
    await rpc(admin, 'medio_actualizar', [TORRES, 'Torres editado', 'Otra', true, true, true])
    await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
    await db.exec(GRANTS_SUPABASE)
    expect((await uno<{ titulo: string }>(`select titulo from public.medios_proyecto where id = $1`, [TORRES])).titulo).toBe('Torres editado')
    expect(await uno(`select id from public.medios_proyecto where id = $1`, [id])).toBeTruthy()
    await rpc(admin, 'medio_actualizar', [TORRES, 'Torres AMURA', 'Dos torres de seis niveles: 30 apartamentos en el Edificio 1 y 42 en el Edificio 2.', true, true, true])
  })

  it('crea un bucket privado propio, y no toca el de comprobantes', async () => {
    const b = await uno<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'multimedia-proyecto'`)
    expect(b.public).toBe(false)
    expect(Number(b.file_size_limit)).toBe(52428800)
    expect(b.allowed_mime_types).not.toContain('application/pdf')
    const politicas = (await db.query<{ policyname: string; qual: string | null; with_check: string | null }>(`select policyname, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects'`)).rows
    expect(politicas.map((p) => p.policyname).sort()).toEqual(['multimedia proyecto cargar', 'multimedia proyecto consultar', 'multimedia proyecto limpiar'])
    for (const p of politicas) expect(`${p.qual ?? ''}${p.with_check ?? ''}`).not.toContain('comprobantes')
  })
})

describe('permisos', () => {
  it('solo el administrador tiene el permiso', async () => {
    const roles = (await db.query<{ role_id: string }>(`select role_id from public.role_permissions where permiso = 'config.multimedia'`)).rows.map((r) => r.role_id)
    expect(roles).toEqual(['administrador'])
  })

  it('el vendedor lee lo publicado y no puede modificar nada, ni directamente ni por funciones', async () => {
    const titulos = (await como(db, vera, () => db.query<{ titulo: string }>(`select titulo from public.medios_proyecto`))).rows.map((f) => f.titulo)
    expect(titulos).toContain('Torres AMURA')
    await expect(como(db, vera, () => db.query(`update public.medios_proyecto set titulo = 'Hackeado' where id = '${TORRES}' returning 1`)).then((r) => r.rows.length)).resolves.toBe(0)
    await expect(como(db, vera, () => db.query(`delete from public.medio_versiones returning 1`)).then((r) => r.rows.length)).resolves.toBe(0)
    await expect(como(db, vera, () => db.query(`insert into public.medios_proyecto (tipo, titulo) values ('imagen', 'Intruso')`))).rejects.toThrow()
    const carga = JSON.stringify({ ruta: ruta('x.webp'), miniatura_ruta: ruta('y.webp'), mime: 'image/webp', hash: HASH })
    await expect(rpc(vera, 'medio_crear', ['imagen', 'Intruso', '', true, true, carga])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_reemplazar', [TORRES, carga])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_actualizar', [TORRES, 'Hackeado', '', true, true, false])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_destacar', [VIDEO])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_reordenar', [[TORRES]])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_eliminar', [TORRES])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medio_restaurar_version', [TORRES, 'a2000000-0000-4000-8000-000000000002'])).rejects.toThrow(/administrador/)
    await expect(rpc(vera, 'medios_sin_vincular', [])).rejects.toThrow(/administrador/)
  })

  it('un usuario inactivo no ve contenidos ni archivos', async () => {
    expect((await como(db, inactivo, () => db.query(`select 1 from public.medios_proyecto`))).rows).toEqual([])
    const id = await crear('Foto para inactivo')
    const v = await uno<{ ruta: string }>(`select v.ruta from public.medio_versiones v where v.medio_id = $1`, [id])
    expect(await ve(vera, v.ruta)).toBe(true)
    expect(await ve(inactivo, v.ruta)).toBe(false)
  })

  it('las funciones internas no se pueden llamar desde la aplicación', async () => {
    const carga = JSON.stringify(await imagen())
    await expect(rpc(admin, 'medio_version_agregar', [TORRES, 'imagen', carga])).rejects.toThrow(/permission denied/)
    await expect(rpc(admin, 'medio_archivo_comprobar', ['archivos/x', ['image/webp'], 10])).rejects.toThrow(/permission denied/)
  })
})

describe('versiones', () => {
  it('reemplazar conserva la versión anterior y su archivo; restaurar la devuelve; todo queda auditado', async () => {
    const id = await crear('Foto con versiones')
    const v1 = await uno<{ id: string; ruta: string }>(`select v.id, v.ruta from public.medio_versiones v where v.medio_id = $1`, [id])
    const v2 = await rpc<string>(admin, 'medio_reemplazar', [id, JSON.stringify(await imagen())])
    expect((await uno<{ version_vigente: string }>(`select version_vigente from public.medios_proyecto where id = $1`, [id])).version_vigente).toBe(v2)
    expect((await db.query(`select numero from public.medio_versiones where medio_id = $1 order by numero`, [id])).rows).toEqual([{ numero: 1 }, { numero: 2 }])

    // El vendedor solo ve la versión vigente; el administrador, todas.
    expect(await ve(vera, v1.ruta)).toBe(false)
    expect(await ve(admin, v1.ruta)).toBe(true)
    expect((await como(db, vera, () => db.query(`select id from public.medio_versiones where medio_id = $1`, [id]))).rows).toEqual([{ id: v2 }])
    expect((await como(db, admin, () => db.query(`select id from public.medio_versiones where medio_id = $1`, [id]))).rows).toHaveLength(2)

    // El archivo anterior no se puede borrar.
    expect(await quita(admin, v1.ruta)).toBe(false)

    await rpc(admin, 'medio_restaurar_version', [id, v1.id])
    expect((await uno<{ version_vigente: string }>(`select version_vigente from public.medios_proyecto where id = $1`, [id])).version_vigente).toBe(v1.id)
    expect(await ve(vera, v1.ruta)).toBe(true)
    const acciones = (await db.query<{ accion: string; actor_id: string }>(`select accion, actor_id from public.audit_log where entidad = 'multimedia' and entidad_id = $1 order by fecha, accion`, [id])).rows
    expect(acciones.map((a) => a.accion).sort()).toEqual(['Cargar contenido multimedia', 'Reemplazar contenido multimedia', 'Restaurar versión multimedia'])
    expect(acciones.every((a) => a.actor_id === admin)).toBe(true)
  })

  it('el material actual también se reemplaza y se puede volver al original', async () => {
    const v2 = await rpc<string>(admin, 'medio_reemplazar', [TORRES, JSON.stringify(await imagen())])
    expect(v2).toBeTruthy()
    await rpc(admin, 'medio_restaurar_version', [TORRES, 'a2000000-0000-4000-8000-000000000002'])
    const f = await uno<{ ruta: string }>(`select v.ruta from public.medios_proyecto m join public.medio_versiones v on v.id = m.version_vigente where m.id = $1`, [TORRES])
    expect(f.ruta).toBe('/media/torres.webp')
  })

  it('no acepta una versión de otro contenido', async () => {
    const id = await crear('Foto ajena')
    await expect(rpc(admin, 'medio_restaurar_version', [id, 'a2000000-0000-4000-8000-000000000002'])).rejects.toThrow(/no pertenece/)
  })
})

describe('validación de archivos', () => {
  it('rechaza formato, tamaño, ruta y huella no válidos, usando lo que registró Storage', async () => {
    const buena = await imagen()
    const pdf = ruta('falso.webp')
    await cargar(admin, pdf, 'application/pdf', 100)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, ruta: pdf })])).rejects.toThrow(/Formato/)
    const grande = ruta('grande.webp')
    await cargar(admin, grande, 'image/webp', 15728641)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, ruta: grande })])).rejects.toThrow(/tamaño/)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, mime: 'application/pdf' })])).rejects.toThrow(/Formato/)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, hash: 'x' })])).rejects.toThrow(/Huella/)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, ruta: '/media/torres.webp' })])).rejects.toThrow(/ruta/)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, ruta: 'comprobantes/uno.pdf' })])).rejects.toThrow(/ruta/)
    await expect(rpc(admin, 'medio_reemplazar', [VIDEO, JSON.stringify(buena)])).rejects.toThrow(/Formato/)
  })

  it('un archivo que no existe en Storage, o de otra persona, no se registra', async () => {
    const buena = await imagen()
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify({ ...buena, ruta: ruta('inexistente.webp') })])).rejects.toThrow(/tu usuario/)
    const otro = await crearUsuario(db, 'Otra Admin', 'administrador')
    const ajena = await imagen(otro)
    await expect(rpc(admin, 'medio_reemplazar', [TORRES, JSON.stringify(ajena)])).rejects.toThrow(/tu usuario/)
  })

  it('un archivo ya vinculado no se reutiliza', async () => {
    const carga = await imagen()
    const id = await rpc<string>(admin, 'medio_crear', ['imagen', 'Foto única', '', true, true, JSON.stringify(carga)])
    await expect(rpc(admin, 'medio_reemplazar', [id, JSON.stringify(carga)])).rejects.toThrow(/otra versión/)
  })
})

describe('Storage', () => {
  it('el vendedor no sube ni borra; el administrador solo quita cargas sin vincular', async () => {
    const r = ruta('vendedor.webp')
    await expect(cargar(vera, r, 'image/webp', 10)).rejects.toThrow(/row-level security/)
    const suelta = ruta('suelta.webp')
    await cargar(admin, suelta, 'image/webp', 10)
    expect(await quita(vera, suelta)).toBe(false)
    expect(await ve(vera, suelta)).toBe(false)
    expect(await ve(admin, suelta)).toBe(true)
    expect(await quita(admin, suelta)).toBe(true)
    await expect(cargar(admin, 'fuera/de/lugar.webp', 'image/webp', 10)).rejects.toThrow(/row-level security/)
  })

  it('lista las cargas interrumpidas de más de 24 horas y deja constancia al quitarlas', async () => {
    const vieja = ruta('vieja.webp')
    await cargar(admin, vieja, 'image/webp', 10)
    await db.query(`update storage.objects set created_at = now() - interval '2 days' where name = $1`, [vieja])
    const lista = await rpc<{ ruta: string }[]>(admin, 'medios_sin_vincular', [])
    expect(lista.map((a) => a.ruta)).toEqual([vieja])
    await rpc(admin, 'medio_limpieza_registrar', [vieja])
    expect((await uno<{ accion: string }>(`select accion from public.audit_log where entidad_id = $1`, [vieja])).accion).toBe('Quitar archivo multimedia sin vincular')
    expect(await quita(admin, vieja)).toBe(true)
    const v = await uno<{ ruta: string }>(`select ruta from public.medio_versiones where ruta like 'archivos/%' limit 1`)
    await expect(rpc(admin, 'medio_limpieza_registrar', [v.ruta])).rejects.toThrow(/no se puede quitar/)
  })
})

describe('publicación', () => {
  it('ocultar y eliminar retiran el contenido al vendedor sin borrar nada; recuperar vuelve oculto', async () => {
    const id = await crear('Foto oculta')
    const { ruta: archivo } = await uno<{ ruta: string }>(`select ruta from public.medio_versiones where medio_id = $1`, [id])
    const veFila = async () => (await como(db, vera, () => db.query(`select 1 from public.medios_proyecto where id = $1`, [id]))).rows.length === 1
    expect(await veFila()).toBe(true)
    await rpc(admin, 'medio_actualizar', [id, 'Foto oculta', '', true, true, false])
    expect(await veFila()).toBe(false)
    expect(await ve(vera, archivo)).toBe(false)
    await rpc(admin, 'medio_actualizar', [id, 'Foto oculta', '', false, false, true])
    expect(await veFila()).toBe(false)
    await rpc(admin, 'medio_actualizar', [id, 'Foto oculta', '', true, false, true])
    expect(await veFila()).toBe(true)

    await rpc(admin, 'medio_eliminar', [id])
    expect(await veFila()).toBe(false)
    expect(await ve(admin, archivo)).toBe(true)
    expect((await db.query(`select 1 from public.medio_versiones where medio_id = $1`, [id])).rows).toHaveLength(1)
    await expect(rpc(admin, 'medio_reemplazar', [id, JSON.stringify(await imagen())])).rejects.toThrow(/ya no existe/)

    await rpc(admin, 'medio_recuperar', [id])
    expect((await uno<{ activo: boolean; eliminado_en: string | null }>(`select activo, eliminado_en from public.medios_proyecto where id = $1`, [id]))).toEqual({ activo: false, eliminado_en: null })
    expect(await veFila()).toBe(false)
  })

  it('el banner tiene un solo contenido, y lo pierde al ocultarlo o sacarlo del Dashboard', async () => {
    const destacado = async () => (await db.query<{ id: string }>(`select id from public.medios_proyecto where destacado`)).rows.map((f) => f.id)
    expect(await destacado()).toEqual([TORRES])
    await rpc(admin, 'medio_destacar', [VIDEO])
    expect(await destacado()).toEqual([VIDEO])
    await rpc(admin, 'medio_actualizar', [VIDEO, 'Video promocional de AMURA', 'Presentación del proyecto en 24 segundos.', false, true, true])
    expect(await destacado()).toEqual([])
    await rpc(admin, 'medio_destacar', [VIDEO])
    expect((await uno<{ en_dashboard: boolean; destacado: boolean }>(`select en_dashboard, destacado from public.medios_proyecto where id = $1`, [VIDEO]))).toEqual({ en_dashboard: true, destacado: true })
    const id = await crear('Foto no visible')
    await rpc(admin, 'medio_actualizar', [id, 'Foto no visible', '', true, true, false])
    await expect(rpc(admin, 'medio_destacar', [id])).rejects.toThrow(/visible/)
    await rpc(admin, 'medio_destacar', [TORRES])
  })

  it('cambia el orden de presentación', async () => {
    await rpc(admin, 'medio_reordenar', [[TORRES, VIDEO]])
    const f = (await db.query<{ id: string; orden: number }>(`select id, orden from public.medios_proyecto where id in ('${TORRES}', '${VIDEO}') order by orden`)).rows
    expect(f).toEqual([{ id: TORRES, orden: 1 }, { id: VIDEO, orden: 2 }])
  })
})
