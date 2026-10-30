// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { generarCargaSql } from '../../src/features/plan/cargaSql'
import { crearDb, crearUsuario } from './db'

const EXCEL = 'D:/Empresas/NUVAREL/Gantt_AMURA.xlsx'
const SCRIPT = path.resolve(__dirname, '../carga/plan_amura_inicial.sql')
const normal = (s: string) => s.split('\r\n').join('\n')

describe('script de carga inicial', () => {
  let db: PGlite
  const conCorreo = () => fs.readFileSync(SCRIPT, 'utf8').replace('REEMPLAZAR@correo.com', 'admin@prueba.local')
  const conteo = async () => (await db.query<{ a: number; f: number; fr: number; d: number; e: number; h: number; c: number; r: number; p: number; cien: number }>(`
    select (select count(*)::int from public.plan_activities) a, (select count(*)::int from public.plan_fases) f, (select count(*)::int from public.plan_frentes) fr,
           (select count(*)::int from public.plan_dependencies) d, (select count(*)::int from public.plan_evidences) e, (select count(*)::int from public.plan_history) h,
           (select count(*)::int from public.plan_activities where estado = 'completada') c, (select count(*)::int from public.plan_activities where responsable_id is not null) r,
           (select count(*)::int from public.plan_activities where peso is not null) p, (select count(*)::int from public.plan_activities where avance = 100) cien`)).rows[0]

  beforeAll(async () => {
    db = await crearDb()
    await crearUsuario(db, 'Admin', 'administrador')
  })

  it.skipIf(!fs.existsSync(EXCEL))('el archivo del repositorio coincide con lo generado desde Gantt_AMURA.xlsx', () => {
    const wb = XLSX.read(fs.readFileSync(EXCEL), { type: 'buffer' })
    expect(normal(fs.readFileSync(SCRIPT, 'utf8'))).toBe(generarCargaSql(wb))
  })

  it('no se ejecuta sin indicar el correo del administrador', async () => {
    await expect(db.exec(fs.readFileSync(SCRIPT, 'utf8'))).rejects.toThrow(/Escribe en v_email/)
    await db.exec('rollback').catch(() => undefined)
    expect((await conteo()).a).toBe(0)
  })

  it('carga 147 actividades, 14 fases y 6 frentes sin inventar pesos, responsables ni cierres', async () => {
    await db.exec(conCorreo())
    const c = await conteo()
    expect(c).toMatchObject({ a: 147, f: 14, fr: 6, e: 5, h: 147, c: 0, r: 0, p: 0, cien: 4 })
    expect(c.d).toBeGreaterThan(100)
    const d01 = (await db.query(`select plan_inicio::text, plan_fin::text, base_inicio::text, base_fin::text, responsable_texto, avance from public.plan_activities where codigo = 'D01'`)).rows[0]
    expect(d01).toEqual({ plan_inicio: '2026-10-27', plan_fin: '2026-10-28', base_inicio: '2026-10-27', base_fin: '2026-10-28', responsable_texto: 'Carlos Tapia', avance: '0.00' })
  })

  it('ejecutarlo dos veces no duplica nada', async () => {
    const antes = await conteo()
    await db.exec(conCorreo())
    expect(await conteo()).toEqual(antes)
  })
})
