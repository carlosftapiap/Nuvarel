// @vitest-environment node
// El script de verificación de producción (sql_produccion/verificacion/verificar_captacion_leads.sql) da el resultado
// esperado y no deja datos: se revierte completo con su excepción final.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { crearDb, crearUsuario } from './db'

const SCRIPT = path.resolve(__dirname, '..', 'sql_produccion', 'verificacion', 'verificar_captacion_leads.sql')
let db: PGlite

beforeAll(async () => {
  db = await crearDb()
  await crearUsuario(db, 'Admin', 'administrador')
  await crearUsuario(db, 'Ana Vendedora', 'asesor')
  await crearUsuario(db, 'Beto Vendedor', 'asesor')
}, 60_000)

describe('verificación de la captación en producción', () => {
  it('rotación, duplicado, pendiente y primer contacto como se espera, sin dejar datos', async () => {
    const antes = (await db.query<{ t: string }>(`select concat_ws('|', (select count(*) from public.leads), (select count(*) from public.clients), (select count(*) from public.leads_participantes), (select count(*) from public.cobranza_alertas), (select count(*) from public.audit_log)) as t`)).rows[0].t
    const error = await db.exec(fs.readFileSync(SCRIPT, 'utf8')).then(() => null, (e: Error) => e.message)
    expect(error).toMatch(/^VERIFICACION /)
    const r = JSON.parse(error!.replace(/^VERIFICACION /, ''))
    expect(r).toMatchObject({ rotacion: 'ABA', mismo_celular: 'duplicado', domingo: 'pendiente', lunes_asignados: 1, domingo_despues: 'asignado', primer_contacto: true, clientes_creados: 4, etapa: 'nuevo', comisiones: 0 })
    expect(r.avisos_encolados).toBeGreaterThanOrEqual(5)
    const despues = (await db.query<{ t: string }>(`select concat_ws('|', (select count(*) from public.leads), (select count(*) from public.clients), (select count(*) from public.leads_participantes), (select count(*) from public.cobranza_alertas), (select count(*) from public.audit_log)) as t`)).rows[0].t
    expect(despues).toBe(antes)
  })
})
