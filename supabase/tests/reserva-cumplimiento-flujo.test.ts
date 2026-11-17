// @vitest-environment node
// Cumplimiento antes del pago de la reserva (migración 20261202000000), en una base local aislada.
// Cumplimiento (administrador u Oficial) revisa. Finanzas solo verifica con la operación aprobada y el pagador registrado.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string, finanzas: string, oficial: string, supervisor: string
let hoy: string, reserva: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
const estado = () => uno<{ cumplimiento_estado: string; estado: string; prorrogas: number; horas: number }>(
  `select cumplimiento_estado, estado, prorrogas, extract(epoch from (apartado_hasta - now()))::int / 3600 as horas from public.reservations where id = $1`, [reserva])
/** Otra solicitud de reserva independiente (cliente, oportunidad y cotización propios) para los casos de rechazo y vencimiento. */
async function nuevaReserva(unidad: string, n: number) {
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [unidad])
  const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ($1, $2, $3, 'whatsapp', $4, $4, $4) returning id`, [`Cliente Prueba ${n}`, cedulaPrueba(9000 + n), celularPrueba(9000 + n), vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`, [cliente, unidad, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ($5, $4::date, $4::date + 60, $6, '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, cliente, op, hoy, `COT-CU-R${n}`, unidad])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  const id = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [q])).rows[0].id
  await rpc(vera, `select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [id])
  return id
}
const estadoDe = (id: string) => uno<{ estado: string; cumplimiento_estado: string; motivo_anulacion: string }>(`select estado, cumplimiento_estado, motivo_anulacion from public.reservations where id = $1`, [id])

const comprobante = () => JSON.stringify({ ruta: `reservas/${reserva}/${crypto.randomUUID()}-tr.pdf`, nombre: 'transferencia.pdf', mime: 'application/pdf', tamano: 1024, hash: 'd'.repeat(64) })

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  finanzas = await crearUsuario(db, 'Fina', 'finanzas', { alcance: 'empresa' })
  oficial = await crearUsuario(db, 'Olga', 'oficial_cumplimiento')
  supervisor = await crearUsuario(db, 'Sara', 'supervisor')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Cumplimiento', '1715000707', '0990000070', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [cliente, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-CU-1', $4::date, $4::date + 60, 'E1-PB-A2', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, cliente, op, hoy])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  reserva = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [q])).rows[0].id
  await rpc(vera, `select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [reserva])
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
})

describe('reserva con Cumplimiento: solicitud, revisión y pago', () => {
  it('al solicitar, la operación queda pendiente de Cumplimiento con 48 horas de apartado', async () => {
    const e = await estado()
    expect(e).toMatchObject({ cumplimiento_estado: 'pendiente', estado: 'solicitada' })
    expect(e.horas).toBeGreaterThanOrEqual(47)
    expect(e.horas).toBeLessThanOrEqual(48)
  })

  it('un vendedor o un supervisor no pueden aprobar ni observar documentación', async () => {
    await expect(rpc(vera, `select public.reservas_cumplimiento_resolver($1, 'aprobado', null)`, [reserva])).rejects.toThrow(/Sin permiso para revisar Cumplimiento/)
    await expect(rpc(supervisor, `select public.reservas_cumplimiento_resolver($1, 'observado', 'Falta firma')`, [reserva])).rejects.toThrow(/Sin permiso para revisar Cumplimiento/)
    expect((await estado()).cumplimiento_estado).toBe('pendiente')
  })

  it('el comprobante se registra antes de la aprobación y no cuenta como reserva confirmada', async () => {
    await rpc(vera, `select public.reservas_reportar_pago($1, 1000, $2::date, 'Banco de prueba', 'TRF-CU-1', $3::jsonb)`, [reserva, hoy, comprobante()])
    expect((await estado()).estado).toBe('solicitada')
  })

  it('Finanzas no verifica mientras Cumplimiento no aprueba, y el administrador tampoco puede saltarlo', async () => {
    const intento = `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-CU-1', true, 'Ingreso confirmado en banco')`
    await expect(rpc(finanzas, intento, [reserva, hoy])).rejects.toThrow(/Cumplimiento debe aprobar la operación/)
    await expect(rpc(admin, intento, [reserva, hoy])).rejects.toThrow(/Cumplimiento debe aprobar la operación/)
    expect((await estado()).estado).toBe('solicitada')
  })

  it('observar da 48 horas más y el vendedor corrige; el motivo es obligatorio', async () => {
    await expect(rpc(oficial, `select public.reservas_cumplimiento_resolver($1, 'rechazado', '')`, [reserva])).rejects.toThrow(/motivo/)
    await rpc(oficial, `select public.reservas_cumplimiento_resolver($1, 'observado', 'Falta la firma en el formulario de origen de fondos')`, [reserva])
    const obs = await estado()
    expect(obs.cumplimiento_estado).toBe('observado')
    expect(obs.horas).toBeGreaterThanOrEqual(47)
    await rpc(vera, `select public.reservas_cumplimiento_reenviar($1, 'Formulario firmado')`, [reserva])
    expect((await estado()).cumplimiento_estado).toBe('pendiente')
  })

  it('una sola prórroga, autorizada por el supervisor, y solo para observados', async () => {
    await expect(rpc(supervisor, `select public.reservas_cumplimiento_prorrogar($1, 'Prórroga por firma pendiente')`, [reserva])).rejects.toThrow(/observados/)
    await rpc(oficial, `select public.reservas_cumplimiento_resolver($1, 'observado', 'Falta la firma')`, [reserva])
    await expect(rpc(oficial, `select public.reservas_cumplimiento_prorrogar($1, 'Prórroga por firma pendiente')`, [reserva])).rejects.toThrow(/Solo un supervisor/)
    await rpc(supervisor, `select public.reservas_cumplimiento_prorrogar($1, 'Prórroga por firma pendiente')`, [reserva])
    expect((await estado()).prorrogas).toBe(1)
    await expect(rpc(supervisor, `select public.reservas_cumplimiento_prorrogar($1, 'Segunda prórroga')`, [reserva])).rejects.toThrow(/única prórroga/)
    await rpc(vera, `select public.reservas_cumplimiento_reenviar($1, 'Firma corregida')`, [reserva])
  })

  it('quien solicitó no puede aprobar su propia reserva, aunque tenga el permiso', async () => {
    const dueno = await crearUsuario(db, 'Dueño Reserva', 'administrador')
    await db.query(`update public.reservations set created_by = $1 where id = $2`, [dueno, reserva])
    await expect(rpc(dueno, `select public.reservas_cumplimiento_resolver($1, 'aprobado', null)`, [reserva])).rejects.toThrow(/no puede revisarla/)
    await db.query(`update public.reservations set created_by = $1 where id = $2`, [vera, reserva])
  })

  it('el pagador es obligatorio para verificar; Cumplimiento aprueba y Finanzas verifica', async () => {
    await rpc(oficial, `select public.reservas_cumplimiento_resolver($1, 'aprobado', null)`, [reserva])
    expect((await estado()).cumplimiento_estado).toBe('aprobado')
    await expect(rpc(finanzas, `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-CU-1', true, 'Ingreso confirmado en banco')`, [reserva, hoy])).rejects.toThrow(/Registra el pagador/)
    await rpc(vera, `select public.reservas_registrar_pagador($1, 'Juan Pérez', '0900000001', 'titular', 'PAGO-1')`, [reserva])
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-CU-1', true, 'Ingreso confirmado en banco')`, [reserva, hoy])
    expect((await estado()).estado).toBe('confirmada')
  })

  it('después de la aprobación no cambia el precio ni el monto sin nueva revisión', async () => {
    await expect(db.query(`update public.reservations set precio_acordado = precio_acordado + 1 where id = $1`, [reserva])).rejects.toThrow(/nueva revisión/)
  })
})

describe('reserva con Cumplimiento: rechazo y liberación', () => {
  it('rechazo: la reserva queda anulada con su motivo, el comprobante se conserva y no hay devolución automática', async () => {
    const id = await nuevaReserva('E1-P1-A2', 1)
    const ruta = JSON.stringify({ ruta: `reservas/${id}/${crypto.randomUUID()}-tr.pdf`, nombre: 'tr.pdf', mime: 'application/pdf', tamano: 1024, hash: 'e'.repeat(64) })
    await rpc(vera, `select public.reservas_reportar_pago($1, 1000, $2::date, 'Banco de prueba', 'TRF-RECH-1', $3::jsonb)`, [id, hoy, ruta])
    await rpc(admin, `select public.reservas_cumplimiento_resolver($1, 'rechazado', 'Origen de fondos no justificado')`, [id])
    expect(await estadoDe(id)).toEqual({ estado: 'anulada', cumplimiento_estado: 'rechazado', motivo_anulacion: 'Origen de fondos no justificado' })
    const comp = await uno<{ n: number; estado: string }>(`select count(*)::int as n, min(estado) as estado from public.comprobantes_pago where reservation_id = $1`, [id])
    expect(comp).toEqual({ n: 1, estado: 'reportado' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.reservas_cumplimiento_historial where reserva_id = $1 and estado = 'rechazado'`, [id])).n).toBe(1)
    await expect(rpc(finanzas, `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-RECH-1', true, 'Intento')`, [id, hoy])).rejects.toThrow(/ya está anulada/)
  })

  it('liberación automática: sin pagos reportados se anula al vencer; con un comprobante reportado no se libera', async () => {
    const libre = await nuevaReserva('E1-P1-A3', 2)
    const conPago = await nuevaReserva('E1-P1-A4', 3)
    const ruta = JSON.stringify({ ruta: `reservas/${conPago}/${crypto.randomUUID()}-tr.pdf`, nombre: 'tr.pdf', mime: 'application/pdf', tamano: 1024, hash: 'f'.repeat(64) })
    await rpc(vera, `select public.reservas_reportar_pago($1, 1000, $2::date, 'Banco de prueba', 'TRF-LIB-1', $3::jsonb)`, [conPago, hoy, ruta])
    expect((await uno<{ n: number }>(`select public.reservas_liberar_apartados_vencidos() as n`)).n).toBe(0)
    await db.query(`update public.reservations set apartado_hasta = now() - interval '1 hour' where id in ($1, $2)`, [libre, conPago])
    expect((await uno<{ n: number }>(`select public.reservas_liberar_apartados_vencidos() as n`)).n).toBe(1)
    expect((await estadoDe(libre)).estado).toBe('anulada')
    expect((await estadoDe(conPago)).estado).toBe('solicitada')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.reservas_cumplimiento_historial where reserva_id = $1 and estado = 'vencido'`, [libre])).n).toBe(1)
  })

  it('nadie libera a mano un apartado vigente', async () => {
    const id = await nuevaReserva('E1-P1-A5', 4)
    await expect(rpc(vera, `select public.reservas_vencer_apartado($1)`, [id])).rejects.toThrow(/todavía está vigente/)
  })
})
