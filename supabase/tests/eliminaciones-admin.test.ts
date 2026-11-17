// @vitest-environment node
// Eliminaciones administrativas (migración 20261206000000) en una base local aislada.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario, prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, vera: string, vito: string, supervisor: string, finanzas: string, oficial: string, gerente: string, legal: string
let hoy: string
let n = 0

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
const cancelar = (quien: string, ids: string[], motivo = 'Cancelación administrativa de prueba') =>
  rpc(quien, `select public.admin_cancelar_reservas($1::uuid[], $2) as r`, [ids, motivo])

async function nuevoCliente(asesor = vera) {
  n++
  return (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ($1, $2, $3, 'whatsapp', $4, $4, $4) returning id`,
    [`Cliente Elim ${n}`, cedulaPrueba(7000 + n), celularPrueba(7000 + n), asesor])).rows[0].id
}

async function nuevaReserva(unidad: string, cliente: string, asesor = vera) {
  n++
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [unidad])
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`, [cliente, unidad, asesor])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ($5, $4::date, $4::date + 60, $6, '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [asesor, cliente, op, hoy, `COT-ELIM-${n}`, unidad])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  const id = (await rpc<{ id: string }>(asesor, `select public.reservas_solicitar($1) as id`, [q])).rows[0].id
  await rpc(asesor, `select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [id])
  return id
}
const reportarPago = (reserva: string, ref: string, asesor = vera) => rpc(asesor, `select public.reservas_reportar_pago($1, 1000, $2::date, 'Banco de prueba', $3, $4::jsonb)`,
  [reserva, hoy, ref, JSON.stringify({ ruta: `reservas/${reserva}/${crypto.randomUUID()}-tr.pdf`, nombre: 'tr.pdf', mime: 'application/pdf', tamano: 1024, hash: 'b'.repeat(64) })])
const estadoReserva = async (id: string) => (await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [id])).estado

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Elim', 'administrador')
  vera = await crearUsuario(db, 'Vera Elim', 'asesor')
  vito = await crearUsuario(db, 'Vito Elim', 'asesor')
  supervisor = await crearUsuario(db, 'Sara Elim', 'supervisor')
  finanzas = await crearUsuario(db, 'Fina Elim', 'finanzas', { alcance: 'empresa' })
  oficial = await crearUsuario(db, 'Olga Elim', 'oficial_cumplimiento')
  gerente = await crearUsuario(db, 'Gema Elim', 'gerencia')
  legal = await crearUsuario(db, 'Lola Elim', 'legal')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor de la prueba')`)
}, 120_000)

describe('eliminaciones administrativas · permisos', () => {
  it('ningún otro perfil puede revisar ni cancelar, aunque tenga permisos de reservas', async () => {
    const r = await nuevaReserva('E1-P2-A1', await nuevoCliente())
    for (const quien of [vera, supervisor, finanzas, oficial, gerente, legal]) {
      await expect(cancelar(quien, [r])).rejects.toThrow(/Solo el administrador/)
      await expect(rpc(quien, `select public.admin_eliminaciones_revisar($1::uuid[])`, [[r]])).rejects.toThrow(/Solo el administrador/)
    }
    expect(await estadoReserva(r)).toBe('solicitada')
    await expect(rpc(admin, `insert into public.admin_eliminaciones (tipo, motivo, actor_id, operaciones, resultado) values ('reservas', 'insercion directa no permitida', $1, '[]', '{}')`, [admin])).rejects.toThrow()
  })
})

describe('eliminaciones administrativas · reservas', () => {
  it('cancela una reserva sin pagos: queda anulada con motivo, el departamento queda disponible y se puede volver a reservar', async () => {
    const cliente = await nuevoCliente()
    const r = await nuevaReserva('E1-P2-A2', cliente)
    const resumen = (await rpc<{ r: { libera_departamento: boolean; impedimentos: string[] }[] }>(admin, `select public.admin_eliminaciones_revisar($1::uuid[]) as r`, [[r]])).rows[0].r
    expect(resumen[0]).toMatchObject({ libera_departamento: true, impedimentos: [] })
    await cancelar(admin, [r], 'El cliente desistió antes de pagar')
    expect(await uno(`select estado, motivo_anulacion from public.reservations where id = $1`, [r])).toEqual({ estado: 'anulada', motivo_anulacion: 'Cancelación administrativa: El cliente desistió antes de pagar' })
    expect((await uno<{ estado: string }>(`select estado::text from public.inventory_units where codigo = 'E1-P2-A2'`)).estado).toBe('disponible')
    const otra = await nuevaReserva('E1-P2-A2', await nuevoCliente())
    expect(await estadoReserva(otra)).toBe('solicitada')
    const log = await uno<{ tipo: string; actor_id: string; motivo: string }>(`select tipo, actor_id, motivo from public.admin_eliminaciones order by fecha desc limit 1`)
    expect(log).toEqual({ tipo: 'reservas', actor_id: admin, motivo: 'El cliente desistió antes de pagar' })
  })

  it('cancela dos reservas del mismo cliente en una sola operación', async () => {
    const cliente = await nuevoCliente()
    const a = await nuevaReserva('E1-P3-A1', cliente)
    const b = await nuevaReserva('E1-P3-A2', cliente)
    await cancelar(admin, [a, b])
    expect([await estadoReserva(a), await estadoReserva(b)]).toEqual(['anulada', 'anulada'])
    const log = await uno<{ ops: number }>(`select jsonb_array_length(operaciones) as ops from public.admin_eliminaciones order by fecha desc limit 1`)
    expect(log.ops).toBe(2)
  })

  it('todo o nada: si una reserva tiene un pago reportado, no se cancela ninguna y se explica el impedimento', async () => {
    const cliente = await nuevoCliente()
    const libre = await nuevaReserva('E1-P3-A3', cliente)
    const conPago = await nuevaReserva('E1-P3-A4', cliente)
    await reportarPago(conPago, 'TRF-ELIM-1')
    await expect(cancelar(admin, [libre, conPago])).rejects.toThrow(/No se canceló ninguna reserva.*pagos reportados/)
    expect([await estadoReserva(libre), await estadoReserva(conPago)]).toEqual(['solicitada', 'solicitada'])
    await cancelar(admin, [libre])
    expect(await estadoReserva(libre)).toBe('anulada')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago where reservation_id = $1`, [conPago])).n).toBe(1)
  })

  it('no mezcla clientes en una misma operación', async () => {
    const a = await nuevaReserva('E1-P4-A1', await nuevoCliente())
    const b = await nuevaReserva('E1-P4-A2', await nuevoCliente())
    await expect(cancelar(admin, [a, b])).rejects.toThrow(/mismo cliente/)
  })
})

describe('eliminaciones administrativas · ventas y usuarios', () => {
  it('anula una venta con cobros: conserva pagos y cuotas, cancela obligaciones futuras y no libera el departamento', async () => {
    const cliente = await nuevoCliente()
    const r = await nuevaReserva('E1-P4-A3', cliente)
    await reportarPago(r, 'TRF-ELIM-VENTA')
    await prepararReservasParaPago(db)
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-ELIM-VENTA', true, 'Ingreso confirmado')`, [r, hoy])
    if ((await estadoReserva(r)) === 'pago_verificado') await rpc(gerente, `select public.reservas_aprobar($1, 'Excepción revisada en la prueba')`, [r])
    const contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoy])).rows[0].id
    const antes = await uno<{ cuotas: number; pagos: number }>(`select (select count(*)::int from public.installments where contract_id = $1) as cuotas, (select count(*)::int from public.payments where contract_id = $1) as pagos`, [contrato])
    await expect(rpc(vera, `select public.admin_anular_venta($1, 'Intento de un vendedor', 'ACTA-1')`, [contrato])).rejects.toThrow(/Solo el administrador/)
    await rpc(admin, `select public.admin_anular_venta($1, 'Anulación acordada con el cliente', 'ACTA-ANULACION-1')`, [contrato])
    expect((await uno<{ estado: string }>(`select estado from public.contracts where id = $1`, [contrato])).estado).toBe('anulado')
    const despues = await uno<{ cuotas: number; pagos: number }>(`select (select count(*)::int from public.installments where contract_id = $1) as cuotas, (select count(*)::int from public.payments where contract_id = $1) as pagos`, [contrato])
    expect(despues).toEqual(antes)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.installment_status where contract_id = $1 and exigible`, [contrato])).n).toBe(0)
    expect((await uno<{ estado: string }>(`select estado::text from public.inventory_units where codigo = 'E1-P4-A3'`)).estado).toBe('reservado')
    expect((await uno<{ tipo: string }>(`select tipo from public.admin_eliminaciones order by fecha desc limit 1`)).tipo).toBe('venta')
  })

  it('desactiva un vendedor: sus clientes y negociaciones quedan sin vendedor, sin borrar nada', async () => {
    const cliente = await nuevoCliente(vito)
    const r = await nuevaReserva('E1-P4-A4', cliente, vito)
    const reservasAntes = (await uno<{ n: number }>(`select count(*)::int as n from public.reservations where created_by = $1`, [vito])).n
    const gestionesAntes = (await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n
    await rpc(admin, `select public.admin_desactivar_usuario($1, 'Dejó de trabajar con AMURA')`, [vito])
    expect((await uno<{ estado: string }>(`select estado from public.profiles where id = $1`, [vito])).estado).toBe('inactivo')
    expect((await uno<{ asesor_id: string | null }>(`select asesor_id from public.clients where id = $1`, [cliente])).asesor_id).toBeNull()
    const op = await uno<{ responsable_id: string | null }>(`select responsable_id from public.opportunities where client_id = $1`, [cliente])
    expect(op.responsable_id).toBeNull()
    expect((await uno<{ created_by: string }>(`select created_by from public.reservations where id = $1`, [r])).created_by).toBe(vito)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.reservations where created_by = $1`, [vito])).n).toBe(reservasAntes)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n).toBe(gestionesAntes)
    await expect(cancelar(vito, [r])).rejects.toThrow()
  })

  it('un cliente sin vendedor lo ve quien asigna, y no lo ve un vendedor', async () => {
    const v2 = await crearUsuario(db, 'Vendedor Sin Vendedor', 'asesor')
    const cliente = await nuevoCliente(v2)
    await rpc(admin, `select public.admin_desactivar_usuario($1, 'Salida de la empresa')`, [v2])
    expect((await uno<{ asesor_id: string | null }>(`select asesor_id from public.clients where id = $1`, [cliente])).asesor_id).toBeNull()
    expect((await rpc<{ n: number }>(admin, `select count(*)::int as n from public.clients where id = $1`, [cliente])).rows[0].n).toBe(1)
    expect((await rpc<{ n: number }>(vera, `select count(*)::int as n from public.clients where id = $1`, [cliente])).rows[0].n).toBe(0)
  })

  it('asignar después un cliente sin vendedor a un vendedor activo lo mueve con sus negociaciones', async () => {
    const v3 = await crearUsuario(db, 'Vendedor Reasignado', 'asesor')
    const cliente = await nuevoCliente(v3)
    const r = await nuevaReserva('E1-P5-A2', cliente, v3)
    await rpc(admin, `select public.admin_desactivar_usuario($1, 'Salida de la empresa')`, [v3])
    const v = (await uno<{ version: number }>(`select version from public.clients where id = $1`, [cliente])).version
    await rpc(admin, `select public.clientes_asignar($1, $2, $3, 'Asignación a un vendedor activo', false)`, [cliente, v, vera])
    expect((await uno<{ asesor_id: string }>(`select asesor_id from public.clients where id = $1`, [cliente])).asesor_id).toBe(vera)
    expect((await uno<{ responsable_id: string }>(`select responsable_id from public.opportunities where client_id = $1`, [cliente])).responsable_id).toBe(vera)
    expect((await uno<{ created_by: string }>(`select created_by from public.reservations where id = $1`, [r])).created_by).toBe(v3)
  })
})
