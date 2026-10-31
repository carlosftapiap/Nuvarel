import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { crearDb, crearUsuario, como } from './db'

const MIGRACION = path.join(__dirname, '..', 'migrations', '20261031110000_datos_en_base.sql')
const ANTERIOR = '20261031100000_perfiles_permisos.sql'

let db: PGlite
let admin: string, corredor: string

beforeAll(async () => {
  // Estado de producción antes de esta migración: todas las anteriores y las unidades de la lista.
  db = await crearDb({ hasta: ANTERIOR })
  admin = await crearUsuario(db, 'Admin', 'administrador')
  corredor = await crearUsuario(db, 'Cor', 'corredor')
}, 120_000)

describe('datos de negocio en la base', () => {
  it('la migración completa las 72 unidades, la lista base y la competencia de 60 filas', async () => {
    await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
    const u = (await db.query<{ n: number; sin: number }>(`select count(*)::int n, count(*) filter (where precio_referencia is null or usd_m2_lista is null)::int sin from public.inventory_units`)).rows[0]
    expect(u).toEqual({ n: 72, sin: 0 })
    const e3 = (await db.query<{ precio_referencia: string; usd_m2_lista: string }>(`select precio_referencia, usd_m2_lista from public.inventory_units where codigo = 'E1-PB-A3'`)).rows[0]
    expect(Number(e3.precio_referencia)).toBe(128549.5)
    expect(Number(e3.usd_m2_lista)).toBe(2230)
    const p = (await db.query<{ lista_base: Record<string, number> }>(`select lista_base from public.pricing_params where id = 1`)).rows[0]
    expect(p.lista_base).toEqual({ patio_usd_m2: 230, reserva_pct: 6, cuotas_pct: 14, meses_e1: 30, meses_e2: 42 })
    const c = (await db.query<{ n: number }>(`select count(*)::int n from public.competencia_unidades`)).rows[0]
    expect(c.n).toBe(60)
  })

  it('se puede repetir sin cambiar nada', async () => {
    const antes = (await db.query(`select codigo, precio_referencia, usd_m2_lista from public.inventory_units order by codigo`)).rows
    await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
    expect((await db.query(`select codigo, precio_referencia, usd_m2_lista from public.inventory_units order by codigo`)).rows).toEqual(antes)
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.competencia_unidades`)).rows[0].n).toBe(60)
  })

  it('la competencia solo la ve quien tiene precios.competencia', async () => {
    const ver = (u: string) => como(db, u, async () => (await db.query(`select count(*)::int n from public.competencia_unidades`)).rows[0] as { n: number })
    expect((await ver(corredor)).n).toBe(0)
    expect((await ver(admin)).n).toBe(60)
  })
})
