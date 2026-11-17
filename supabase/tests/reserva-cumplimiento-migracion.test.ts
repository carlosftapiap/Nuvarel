// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { crearDb } from './db'
import fs from 'node:fs'
import path from 'node:path'

// Comprueba que la propuesta de Cumplimiento antes del pago se aplica sobre el esquema vigente.
// Aplica la migración sobre la base previa a ella para comprobarla en aislamiento.
// Los casos de comportamiento (apartado, observado, rechazo, prórroga, verificación bloqueada) están en docs/DISENO_RESERVA_CUMPLIMIENTO.md.
let db: PGlite

beforeAll(async () => {
  db = await crearDb({ hasta: '20261201000000_planos_carga_simple.sql' })
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../migrations/20261202000000_reserva_cumplimiento.sql'), 'utf8'))
}, 120_000)

describe('reserva con Cumplimiento · migración', () => {
  it('agrega las columnas de estado, apartado y prórroga a reservas', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'reservations'
         and column_name in ('cumplimiento_estado', 'apartado_hasta', 'prorrogas', 'cumplimiento_decidido_por', 'cumplimiento_decidido_en')`)
    expect(rows.map((r) => r.column_name).sort()).toEqual(['apartado_hasta', 'cumplimiento_decidido_en', 'cumplimiento_decidido_por', 'cumplimiento_estado', 'prorrogas'])
  })

  it('crea el historial y el permiso reservas.prorrogar', async () => {
    const tabla = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'reservas_cumplimiento_historial'`)
    expect(tabla.rows[0].n).toBe(1)
    const permiso = await db.query<{ n: number }>(`select count(*)::int as n from permissions where clave = 'reservas.prorrogar'`)
    expect(permiso.rows[0].n).toBe(1)
  })

  it('define las funciones de decisión, prórroga, reenvío y vencimiento', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select proname from pg_proc where proname in ('reservas_cumplimiento_resolver', 'reservas_cumplimiento_reenviar', 'reservas_cumplimiento_prorrogar', 'reservas_vencer_apartado', 'reservas_verificar_pago')`)
    expect(rows.map((r) => r.proname).sort()).toEqual(['reservas_cumplimiento_prorrogar', 'reservas_cumplimiento_reenviar', 'reservas_cumplimiento_resolver', 'reservas_verificar_pago', 'reservas_vencer_apartado'].sort())
  })

  it('reservas_verificar_pago exige la aprobación de Cumplimiento en su cuerpo', async () => {
    const { rows } = await db.query<{ src: string }>(`select prosrc as src from pg_proc where proname = 'reservas_verificar_pago'`)
    expect(rows[0].src).toMatch(/Cumplimiento debe aprobar la operación/)
    expect(rows[0].src).toMatch(/Quien revisó Cumplimiento no puede verificar/)
  })
})
