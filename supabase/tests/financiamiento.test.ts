// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string

// Datos de prueba ficticios (no son tasas reales). El catálogo real se carga con fuente y fecha verificadas.
const datos = (tasa: number) => JSON.stringify({
  entidad: 'Banco de prueba', producto: 'Vivienda', tipo_tasa: 'fija', tasa_nominal: tasa, plazo_min_meses: 12, plazo_max_meses: 300,
  fuente: 'Documento de prueba unitaria', fecha_fuente: '2026-10-29',
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
}, 60_000)

describe('catálogo bancario versionado', () => {
  it('el catálogo empieza vacío: no hay tasas precargadas', async () => {
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.bank_products`)).rows[0].n).toBe(0)
  })

  it('exige fuente y fecha; una vendedora no puede cargar tasas', async () => {
    await expect(como(db, vera, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA', $1::jsonb, 'Carga de prueba')`, [datos(9)]))).rejects.toThrow(/Sin permiso/)
    const sinFuente = JSON.stringify({ ...JSON.parse(datos(9)), fuente: '' })
    await expect(como(db, admin, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA', $1::jsonb, 'Carga de prueba')`, [sinFuente]))).rejects.toThrow(/fuente/)
  })

  it('cada cambio crea una versión nueva y solo una queda vigente', async () => {
    await como(db, admin, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA', $1::jsonb, 'Tasa inicial de prueba')`, [datos(9)]))
    await como(db, admin, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA', $1::jsonb, 'Cambio de tasa de prueba')`, [datos(8.5)]))
    const { rows } = await db.query<{ version: number; vigente: boolean; tasa_nominal: string }>(`select version, vigente, tasa_nominal from public.bank_products order by version`)
    expect(rows.map((r) => [r.version, r.vigente, Number(r.tasa_nominal)])).toEqual([[1, false, 9], [2, true, 8.5]])
  })

  it('la simulación guardada conserva la versión usada aunque el catálogo cambie después', async () => {
    const v2 = (await db.query<{ id: string }>(`select id from public.bank_products where version = 2`)).rows[0].id
    const r = await como(db, vera, () => db.query<{ r: { numero: string; condiciones: { producto: { version: number; tasa_nominal: number } } } }>(
      `select public.financiamiento_guardar_simulacion('E1-PB-A2', null, 'Cliente de prueba', $1, '{"plazoMeses": 240}'::jsonb, '{"primeraCuota": 1}'::jsonb) as r`, [v2]))
    expect(r.rows[0].r.numero).toMatch(/^SIM-\d{4}-0001$/)
    await como(db, admin, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA', $1::jsonb, 'Otro cambio de tasa')`, [datos(7)]))
    const guardada = (await db.query<{ condiciones: { producto: { version: number; tasa_nominal: number } } }>(`select condiciones from public.mortgage_simulations`)).rows[0]
    expect(guardada.condiciones.producto).toMatchObject({ version: 2, tasa_nominal: 8.5 })
  })

  it('cada usuario ve solo sus simulaciones', async () => {
    const otra = await crearUsuario(db, 'Otra', 'asesor')
    expect((await como(db, otra, async () => (await db.query(`select id from public.mortgage_simulations`)).rows.length))).toBe(0)
    expect((await como(db, vera, async () => (await db.query(`select id from public.mortgage_simulations`)).rows.length))).toBe(1)
  })
})
