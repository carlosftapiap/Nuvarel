// @vitest-environment node
import { it, expect } from 'vitest'
import { crearDb } from './db'
it('todas las migraciones se ejecutan', async () => {
  const db = await crearDb()
  const r = await db.query<{ n: number }>('select count(*)::int as n from public.inventory_units')
  expect(r.rows[0].n).toBe(72)
})
