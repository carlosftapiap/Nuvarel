// @vitest-environment node
// Limpieza de datos de prueba (supabase/sql_produccion/operacion/limpieza_pruebas_*.sql) en una base local aislada.
// Clientes de prueba con reservas (una confirmada que ocupa una unidad) y un cliente real que no debe tocarse.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario, prepararReservasParaPago } from './db'

let db: PGlite
let vera: string, finanzas: string, admin: string, hoy: string
let n = 0
const SQL = (f: string) => fs.readFileSync(path.resolve(__dirname, `../sql_produccion/operacion/${f}`), 'utf8')
const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = (u: string, sql: string, p: unknown[] = []) => como(db, u, () => db.query(sql, p))
const conEsperados = (sql: string, c: number, r: number, u: number) =>
  sql.replace('v_esperado_clientes int := 11', `v_esperado_clientes int := ${c}`).replace('v_esperado_reservas int := 9', `v_esperado_reservas int := ${r}`)
    .replace('v_esperado_unidades int := 4', `v_esperado_unidades int := ${u}`)

async function clienteConReserva(nombre: string, unidad: string) {
  n++
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [unidad])
  const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ($1, $2, $3, 'whatsapp', $4, $4, $4) returning id`, [nombre, cedulaPrueba(6100 + n), celularPrueba(6100 + n), vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`, [cliente, unidad, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ($5, $4::date, $4::date + 60, $6, '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3) returning id`,
    [vera, cliente, op, hoy, `COT-LIMP-${n}`, unidad])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  const r = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
  await rpc(vera, `select public.reservas_fijar_monto($1, 500, 'Reserva acordada con el cliente')`, [r])
  return { cliente, reserva: r }
}

let prueba1: { cliente: string; reserva: string }, prueba2: { cliente: string; reserva: string }, real: { cliente: string; reserva: string }

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Limpieza', 'administrador')
  vera = await crearUsuario(db, 'Vera Limpieza', 'asesor')
  finanzas = await crearUsuario(db, 'Fina Limpieza', 'finanzas', { alcance: 'empresa' })
  hoy = (await uno<{ h: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as h`)).h
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor de la prueba')`)
  prueba1 = await clienteConReserva('PRUEBA QA Limpieza Uno', 'E2-P1-A1')
  prueba2 = await clienteConReserva('Cliente prueba Limpieza Dos', 'E2-P1-A2')
  real = await clienteConReserva('Ana Real Compradora', 'E2-P1-A3')
  // La primera reserva de prueba queda confirmada y ocupa su unidad, con comprobante y recibo.
  await rpc(vera, `select public.reservas_reportar_pago($1, 500, $2::date, 'Banco', 'TRF-LIMP-1', $3::jsonb)`, [prueba1.reserva, hoy, JSON.stringify({ ruta: `reservas/${prueba1.reserva}/x.pdf`, nombre: 'x.pdf', mime: 'application/pdf', tamano: 10, hash: 'c'.repeat(64) })])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, 500, $2::date, 'TRF-LIMP-1', true, 'Ingreso confirmado')`, [prueba1.reserva, hoy])
  // Con precio distinto del oficial queda como excepción: Gerencia la autoriza y recién entonces ocupa la unidad.
  if ((await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [prueba1.reserva])).estado === 'pago_verificado') {
    const gerente = await crearUsuario(db, 'Gema Limpieza', 'gerencia')
    await rpc(gerente, `select public.reservas_aprobar($1, 'Excepción revisada en la prueba')`, [prueba1.reserva])
  }
}, 180_000)

describe('limpieza de datos de prueba', () => {
  it('antes: la reserva de prueba confirmada ocupa su unidad', async () => {
    expect(await uno(`select estado::text as estado, reserva_id from public.inventory_units where codigo = 'E2-P1-A1'`)).toEqual({ estado: 'reservado', reserva_id: prueba1.reserva })
  })

  it('el respaldo copia exactamente lo que se limpiará', async () => {
    await db.exec(SQL('limpieza_pruebas_1_respaldo.sql'))
    expect((await uno<{ n: number }>(`select count(*)::int as n from respaldo_limpieza_20261117.clients`)).n).toBe(2)
    expect((await uno<{ n: number }>(`select count(*)::int as n from respaldo_limpieza_20261117.reservations`)).n).toBe(2)
    expect((await uno<{ n: number }>(`select count(*)::int as n from respaldo_limpieza_20261117.comprobantes_pago`)).n).toBe(1)
  })

  it('si los datos no coinciden con el diagnóstico, se detiene sin borrar nada', async () => {
    await expect(db.exec(conEsperados(SQL('limpieza_pruebas_2_limpiar.sql'), 99, 2, 1))).rejects.toThrow(/cambiaron desde el diagnóstico/)
    await db.exec('rollback').catch(() => undefined)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n).toBe(3)
  })

  it('limpia solo lo de prueba, libera la unidad y deja constancia; el cliente real queda intacto', async () => {
    const auditoriaAntes = (await uno<{ n: number }>(`select count(*)::int as n from public.audit_log`)).n
    await db.exec(conEsperados(SQL('limpieza_pruebas_2_limpiar.sql'), 2, 2, 1))
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.clients where id in ($1, $2)`, [prueba1.cliente, prueba2.cliente])).n).toBe(0)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.reservations where id in ($1, $2)`, [prueba1.reserva, prueba2.reserva])).n).toBe(0)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago where reservation_id = $1`, [prueba1.reserva])).n).toBe(0)
    expect(await uno(`select estado::text as estado, reserva_id from public.inventory_units where codigo = 'E2-P1-A1'`)).toEqual({ estado: 'disponible', reserva_id: null })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.inventory_status_history where motivo like 'Limpieza de datos de prueba%'`)).n).toBe(1)
    expect((await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [real.reserva])).estado).toBe('solicitada')
    expect((await uno<{ nombre: string }>(`select nombre from public.clients where id = $1`, [real.cliente])).nombre).toBe('Ana Real Compradora')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log`)).n).toBeGreaterThanOrEqual(auditoriaAntes)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.profiles where id in ($1, $2, $3)`, [admin, vera, finanzas])).n).toBe(3)
  })

  it('la recuperación devuelve todo lo borrado y vuelve a ocupar la unidad', async () => {
    await db.exec(SQL('limpieza_pruebas_4_recuperar.sql'))
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n).toBe(3)
    expect((await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [prueba1.reserva])).estado).toBe('confirmada')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago where reservation_id = $1`, [prueba1.reserva])).n).toBe(1)
    expect(await uno(`select estado::text as estado, reserva_id from public.inventory_units where codigo = 'E2-P1-A1'`)).toEqual({ estado: 'reservado', reserva_id: prueba1.reserva })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.inventory_status_history where motivo like 'Limpieza de datos de prueba%'`)).n).toBe(0)
  })
})
