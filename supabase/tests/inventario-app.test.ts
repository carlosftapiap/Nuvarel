import fs from 'node:fs'
import path from 'node:path'
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { datosPglite } from './datos-pglite'
import { crearDb, crearUsuario } from './db'
import { cargarInventario, persistirCambios } from '../../src/features/inventario/remoto'
import { actualizarParametros, aplicarCambioPrecio, aprobarPropuesta, cambiarEstado, crearPropuesta } from '../../src/features/inventario/service'
import type { Actor } from '../../src/features/inventario/types'

let db: PGlite
let admin: string, vera: string
const actorAdmin = (): Actor => ({ id: admin, nombre: 'Admin', rol: 'administrador', permisos: undefined })

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
}, 60_000)

describe('inventario conectado a Supabase', () => {
  it('carga las 72 unidades con su estado, precios e historial reales', async () => {
    const s = await cargarInventario(datosPglite(db, admin))
    expect(s.units).toHaveLength(72)
    expect(s.units[0]).toMatchObject({ codigo: 'E1-PB-A1', estado: 'por_confirmar' })
    expect(s.units[0].precioReferencia).toBeGreaterThan(0)
    expect(s.params.meses).toEqual({ 1: 30, 2: 42 })
  })

  it('cambiar el estado guarda en la base con motivo y queda en el historial', async () => {
    const datos = datosPglite(db, admin)
    const prev = await cargarInventario(datos)
    const next = cambiarEstado(prev, 'E1-PB-A1', 'bloqueado', 'Retención por comité', actorAdmin())
    await persistirCambios(datos, prev, next)
    const fila = (await db.query<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A1'`)).rows[0]
    expect(fila.estado).toBe('bloqueado')
    const h = await db.query<{ motivo: string }>(`select motivo from public.inventory_status_history where codigo = 'E1-PB-A1' order by fecha desc limit 1`)
    expect(h.rows[0]).toEqual({ motivo: 'Retención por comité' })
  })

  it('cambiar un precio guarda el valor nuevo y el registro de precios', async () => {
    const datos = datosPglite(db, admin)
    const prev = await cargarInventario(datos)
    const next = aplicarCambioPrecio(prev, { alcance: { codigos: ['E1-PB-A1'] }, modo: 'fijar', valor: 2300, motivo: 'Ajuste de prueba aprobado' }, actorAdmin())
    await persistirCambios(datos, prev, next)
    const fila = (await db.query<{ usd_m2: string }>(`select usd_m2 from public.inventory_units where codigo = 'E1-PB-A1'`)).rows[0]
    expect(Number(fila.usd_m2)).toBe(2300)
    expect((await db.query(`select 1 from public.inventory_price_history where motivo = 'Ajuste de prueba aprobado'`)).rows).toHaveLength(1)
  })

  it('una vendedora no puede cambiar precios: la app y la base lo rechazan', async () => {
    const datos = datosPglite(db, vera)
    const prev = await cargarInventario(datos)
    const vendedora: Actor = { id: vera, nombre: 'Vera', rol: 'asesor' }
    expect(() => aplicarCambioPrecio(prev, { alcance: { codigos: ['E1-PB-A2'] }, modo: 'fijar', valor: 999, motivo: 'Intento no autorizado' }, vendedora)).toThrow(/Aprobar cambios de precio|permiso/)
    await expect(datos.rpc('inventario_ajustar_precio', { p_modo: 'fijar', p_valor: 999, p_motivo: 'Intento no autorizado', p_codigos: ['E1-PB-A2'] })).rejects.toThrow(/Sin permiso/)
    const fila = (await db.query<{ usd_m2: string }>(`select usd_m2 from public.inventory_units where codigo = 'E1-PB-A2'`)).rows[0]
    expect(Number(fila.usd_m2)).not.toBe(999)
  })

  it('parámetros de pago se guardan con validación y auditoría', async () => {
    const datos = datosPglite(db, admin)
    const prev = await cargarInventario(datos)
    const next = actualizarParametros(prev, { ...prev.params, patioUsdM2: 240 }, 'Ajuste aprobado en comité', actorAdmin())
    await persistirCambios(datos, prev, next)
    const p = (await db.query<{ patio_usd_m2: string }>(`select patio_usd_m2 from public.pricing_params where id = 1`)).rows[0]
    expect(p).toEqual({ patio_usd_m2: '240.00' })
    // La entrada es política fija: 6 % + 14 %.
    await expect(datos.rpc('inventario_actualizar_parametros', { p_patio: 240, p_reserva: 7, p_cuotas: 13, p_meses_e1: 30, p_meses_e2: 42, p_motivo: 'Cambio fuera de política' })).rejects.toThrow()
    await expect(datos.rpc('inventario_actualizar_parametros', { p_patio: 230, p_reserva: 60, p_cuotas: 60, p_meses_e1: 30, p_meses_e2: 42, p_motivo: 'Prueba de validación' })).rejects.toThrow(/superar el 100%/)
  })

  it('una propuesta se crea pendiente y al aprobarla el servidor aplica el precio una sola vez', async () => {
    const admin2 = datosPglite(db, admin)
    const prev = await cargarInventario(admin2)
    const conPropuesta = aplicarPropuesta(prev)
    await persistirCambios(admin2, prev, conPropuesta)
    const pendientes = (await db.query(`select estado from public.price_proposals`)).rows
    expect(pendientes).toEqual([{ estado: 'pendiente' }])
    const sin = await cargarInventario(admin2)
    const id = sin.propuestas[0].id
    const aprobada = aprobarPropuesta(sin, id, 'Aprobada en comité', actorAdmin())
    await persistirCambios(admin2, sin, aprobada)
    const u = (await db.query<{ usd_m2: string }>(`select usd_m2 from public.inventory_units where codigo = 'E2-P1-A1'`)).rows[0]
    expect(Number(u.usd_m2)).toBe(2400)
    expect((await db.query(`select estado from public.price_proposals`)).rows).toEqual([{ estado: 'aprobada' }])
    expect((await db.query(`select 1 from public.inventory_price_history where motivo like '%propuesta aprobada%'`)).rows).toHaveLength(1)
  })
})

function aplicarPropuesta(state: Awaited<ReturnType<typeof cargarInventario>>) {
  return crearPropuesta(state, { alcance: { codigos: ['E2-P1-A1'] }, modo: 'fijar', valor: 2400, motivo: 'Propuesta de prueba de precio' }, actorAdmin())
}
