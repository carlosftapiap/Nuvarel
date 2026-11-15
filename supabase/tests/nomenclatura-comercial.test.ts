// Nomenclatura comercial (0015): Edificio A y B, departamentos A001–A505 y B001–B507; el código interno no cambia.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { crearDb } from './db'

const RAIZ = path.resolve(__dirname, '..')
const MIGRACION = fs.readFileSync(path.join(RAIZ, 'migrations', '20261124000000_nomenclatura_comercial.sql'), 'utf8')
const REVERSION = fs.readFileSync(path.join(RAIZ, 'sql_produccion', 'reversion', '0015_revertir_nomenclatura_comercial.sql'), 'utf8')
const VERIFICACION = fs.readFileSync(path.join(RAIZ, 'sql_produccion', 'verificacion', 'verificar_nomenclatura_comercial.sql'), 'utf8')

let db: PGlite
const verificar = async () => Object.fromEntries((await db.query<{ control: string; valor: string }>(VERIFICACION)).rows.map((r) => [r.control, r.valor]))
const numeros = async () => (await db.query<{ codigo: string; dpt: string }>(`select codigo, dpt from public.inventory_units order by codigo`)).rows
const definicion = async (firma: string) => (await db.query<{ d: string }>(`select pg_get_functiondef(to_regprocedure($1)) as d`, [firma])).rows[0].d
const auditorias = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'nomenclatura_comercial'`)).rows[0].n

beforeAll(async () => { db = await crearDb() }, 120_000)

describe('migración 0015', () => {
  it('numera las 72 unidades A001–A505 y B001–B507 sin tocar el código interno', async () => {
    const filas = await numeros()
    expect(filas).toHaveLength(72)
    const de = (codigo: string) => filas.find((f) => f.codigo === codigo)?.dpt
    expect([de('E1-PB-A1'), de('E1-P1-A5'), de('E1-P5-A5'), de('E2-PB-A1'), de('E2-P1-A1'), de('E2-P5-A7')]).toEqual(['A001', 'A105', 'A505', 'B001', 'B101', 'B507'])
    expect(filas.every((f) => /^E[12]-(PB|P[1-5])-A[1-7]$/.test(f.codigo) && /^[AB][0-5]0[1-7]$/.test(f.dpt))).toBe(true)
    const v = await verificar()
    expect(v).toMatchObject({ unidades: '72', numeros_unicos: '72', 'formato_nuevo (A001-B507)': '72', 'coherentes con edificio, piso y posicion': '72', restriccion: 'sí', edificio_contratos: 'texto', referencias_huerfanas: '0' })
  })

  it('los contratos nuevos reciben el edificio como letra y los mensajes de precios usan A y B', async () => {
    expect(await definicion('public.contratos_datos_documento(uuid, jsonb)')).toContain(`'edificio', case u.edificio when 1 then 'A' when 2 then 'B'`)
    // Conserva los cambios de migraciones anteriores (nombres y apellidos, cuotas extraordinarias).
    const contrato = await definicion('public.contratos_datos_documento(uuid, jsonb)')
    expect(contrato).toContain(`'primer_apellido'`)
    expect(contrato).toContain(`'extraordinarias'`)
    expect(await definicion('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)')).toContain('Los meses del Edificio A deben')
    expect((await db.query(`select nombre from public.obra_frentes where codigo in ('edificio1', 'edificio2') order by codigo`)).rows).toEqual([{ nombre: 'Edificio A' }, { nombre: 'Edificio B' }])
  })

  it('un número que no corresponde a su edificio, piso y posición se rechaza', async () => {
    await expect(db.query(`update public.inventory_units set dpt = 'A999' where codigo = 'E1-PB-A1'`)).rejects.toThrow(/inventory_units_dpt_comercial/)
    await expect(db.query(`update public.inventory_units set dpt = 'B001' where codigo = 'E1-PB-A1'`)).rejects.toThrow()
  })

  it('se puede repetir sin cambios ni auditorías duplicadas', async () => {
    const antes = await numeros()
    const n = await auditorias()
    await db.exec(MIGRACION)
    expect(await numeros()).toEqual(antes)
    expect(await auditorias()).toBe(n)
  })

  it('la reversión vuelve a 1001–2507 con la misma huella, y 0015 se puede aplicar otra vez', async () => {
    const despues = await verificar()
    await db.exec(REVERSION)
    const revertida = await verificar()
    expect(revertida).toMatchObject({ 'formato_anterior (1001-2507)': '72', restriccion: 'no', edificio_contratos: 'numero' })
    expect(revertida.huella_sin_numero).toBe(despues.huella_sin_numero)
    expect((await numeros()).find((f) => f.codigo === 'E2-P1-A1')?.dpt).toBe('2101')
    expect(await definicion('public.contratos_datos_documento(uuid, jsonb)')).toContain(`'edificio', u.edificio,`)

    await db.exec(MIGRACION)
    const otraVez = await verificar()
    expect(otraVez.huella_sin_numero).toBe(despues.huella_sin_numero)
    expect(otraVez['formato_nuevo (A001-B507)']).toBe('72')
  })
})
