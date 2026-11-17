// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario, aprobarCumplimiento } from './db'
import { prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, vera: string, finanzas: string, gerente: string
let clienteId: string, contrato: string, reservaId: string
let hoy: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const balance = () => uno<{ pagado_verificado: string; saldo: string; saldo_exigible: string; vencido: string; saldo_a_favor: string; estado_contrato: string; precio: string }>(
  `select pagado_verificado, saldo, saldo_exigible, vencido, saldo_a_favor, estado_contrato, precio from public.contract_balances where contract_id = $1`, [contrato])
const cuota = (numero: number) => uno<{ pagado: string; pendiente: string; situacion: string; vencimiento: string; vencimiento_original: string | null; monto: string }>(
  `select pagado, pendiente, situacion, vencimiento::text, vencimiento_original::text, monto from public.installment_status where contract_id = $1 and numero = $2`, [contrato, numero])

beforeAll(async () => {
  db = await crearDb()
  // Escenario heredado: plazo de 30 meses desde la firma, sin calendario fijo. El calendario se prueba en calendario-fijo-db.test.ts.
  await db.query(`update public.pricing_params set meses_e1 = 30, inicio_cuotas = null where id = 1`)
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  clienteId = (await db.query<{ id: string }>(
    `insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente de cobranza', '1715000202', '0990000020', 'whatsapp', $1, $1, $1) returning id`,
    [vera])).rows[0].id
  // Cotización aceptada del ejemplo: precio final 172.147,20 (6% = 10.328,83; cuotas 14%; entrega 80%).
  const op = (await db.query<{ id: string }>(
    `insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [clienteId, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-C-1', (now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date + 60, 'E1-PB-A2', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, clienteId, op])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  reservaId = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
})

describe('reserva configurable y cronograma al firmar', () => {
  it('la reserva se fija en 1.000 (monto configurable, nunca mayor al 6%)', async () => {
    await expect(como(db, vera, () => db.query(`select public.reservas_fijar_monto($1, 99999, 'Monto de prueba excesivo')`, [reservaId]))).rejects.toThrow(/no superar el 6%/)
    await como(db, vera, () => db.query(`select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [reservaId]))
    expect((await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [reservaId])).monto_reserva).toBe('1000.00')
  })

  it('verificación y aprobación de la reserva con su comprobante', async () => {
    await como(db, vera, () => db.query(`select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-RES-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reservaId]))
    await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
    await prepararReservasParaPago(db)
    await como(db, finanzas, () => db.query(`select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-RES-1', true, 'Ingreso confirmado en banco')`, [reservaId, hoy]))
    await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Aprobada en comité de prueba')`, [reservaId]))
    expect((await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [reservaId])).estado).toBe('confirmada')
  })

  it('crear el contrato separa reserva, pago a la firma y cuotas; suma el precio exacto', async () => {
    contrato = (await como(db, admin, () => db.query<{ id: string }>(`select public.contratos_crear($1, '2026-08-01', 'Contrato de prueba de cobranza') as id`, [reservaId]))).rows[0].id
    const cs = await db.query<{ numero: number; concepto: string; monto: string }>(`select numero, concepto, monto from public.installments where contract_id = $1 order by numero`, [contrato])
    expect(cs.rows[0]).toMatchObject({ numero: 0, monto: '1000.00' })
    expect(cs.rows[1]).toMatchObject({ numero: 1, monto: '9328.83' })
    expect(cs.rows).toHaveLength(33)
    const suma = cs.rows.reduce((t, r) => t + Number(r.monto), 0)
    expect(Math.round(suma * 100) / 100).toBe(172147.2)
  })

  it('en borrador el dinero recibido cuenta, pero nada es exigible ni vencido', async () => {
    const b = await balance()
    expect(b).toMatchObject({ estado_contrato: 'borrador', pagado_verificado: '1000.00' })
    expect(Number(b.saldo_exigible)).toBe(0)
    expect(Number(b.vencido)).toBe(0)
    expect((await cuota(0))?.situacion).toBe('pagada')
  })

  it('al firmar el cronograma pasa a ser exigible y las cuotas vencidas aparecen', async () => {
    await aprobarCumplimiento(db)
    await como(db, admin, () => db.query(`select public.contratos_firmar($1, 'Firma de prueba', 'contratos/firmado.pdf')`, [contrato]))
    const b = await balance()
    expect(b.estado_contrato).toBe('firmado')
    expect(Number(b.saldo_exigible)).toBeCloseTo(171147.2, 2)
    expect(Number(b.vencido)).toBeGreaterThan(0)
  })
})

describe('pagos parciales, sobreaplicación, duplicados y anulaciones', () => {
  const registrar = (monto: number, ref: string) => como(db, finanzas, () => db.query<{ id: string }>(
    `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', $4, jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [contrato, monto, hoy, ref]))
  const verificar = (id: string) => como(db, admin, () => db.query(`select public.cobranzas_confirmar_pago($1, true, 'Verificado en banco')`, [id]))

  it('la firma se paga completa y su situación queda pagada', async () => {
    const p = await registrar(9328.83, 'TRF-FIRMA-1')
    await verificar(p.rows[0].id)
    expect((await cuota(1))?.situacion).toBe('pagada')
  })

  it('no se registra dos veces el mismo comprobante en el mismo contrato', async () => {
    await expect(registrar(500, 'trf-firma-1')).rejects.toThrow(/Ya existe un pago con la referencia/)
  })

  it('un pago parcial de una cuota deja el saldo pendiente y la situación parcial', async () => {
    const p = await registrar(500, 'TRF-P-1')
    await verificar(p.rows[0].id)
    const c = await cuota(2)
    expect(c).toMatchObject({ situacion: 'parcial' })
    expect(Number(c?.pagado)).toBe(500)
    expect(Number(c?.pendiente)).toBeCloseTo(303.35, 2)
  })

  it('un excedente cubre la entrada y queda como saldo a favor: no reduce el 80 % sin autorización', async () => {
    const p = await registrar(200000, 'TRF-EXC-1')
    await verificar(p.rows[0].id)
    const b = await balance()
    expect(Number(b.saldo_a_favor)).toBeCloseTo(38681.63, 2)
    // Solo queda exigible el saldo contra entrega, intacto.
    expect(Number(b.saldo_exigible)).toBeCloseTo(137717.76, 2)
    const e = await uno<{ saldo_entrada: string; excedente_disponible: string; aplicado_financiamiento: string; saldo_financiamiento: string }>(
      `select saldo_entrada, excedente_disponible, aplicado_financiamiento, saldo_financiamiento from public.contract_balances where contract_id = $1`, [contrato])
    expect(e).toEqual({ saldo_entrada: '0.00', excedente_disponible: '176399.39', aplicado_financiamiento: '0', saldo_financiamiento: '137717.76' })
  })

  it('anular un pago corrige los saldos y deja constancia', async () => {
    const id = (await uno<{ id: string }>(`select id from public.payments where referencia = 'TRF-EXC-1'`)).id
    await expect(como(db, vera, () => db.query(`select public.cobranzas_anular_pago($1, 'Intento de anulación')`, [id]))).rejects.toThrow(/Sin permiso/)
    await como(db, admin, () => db.query(`select public.cobranzas_anular_pago($1, 'Duplicado de prueba')`, [id]))
    expect(Number((await balance()).saldo_a_favor)).toBe(0)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Anular pago' and entidad_id = $1`, [id])).n).toBe(1)
  })
})

describe('reprogramación, gestiones y compromisos', () => {
  it('reprogramar exige motivo, conserva la fecha original y no cambia pagos', async () => {
    const antes = await balance()
    await expect(como(db, admin, () => db.query(`select public.cobranza_reprogramar_cuota($1, 3, '2027-01-15', 'mot')`, [contrato]))).rejects.toThrow(/Motivo obligatorio/)
    await como(db, admin, () => db.query(`select public.cobranza_reprogramar_cuota($1, 3, '2027-01-15', 'Acuerdo con el cliente por flujo')`, [contrato]))
    const c = await cuota(3)
    expect(c).toMatchObject({ vencimiento: '2027-01-15', vencimiento_original: '2026-10-01' })
    expect((await balance()).pagado_verificado).toBe(antes.pagado_verificado)
  })

  it('registrar gestiones y compromisos; cerrar un compromiso con motivo', async () => {
    await como(db, finanzas, () => db.query(`select public.cobranza_registrar_gestion($1, 2, 'llamada', 'Cliente pidió plazo')`, [contrato]))
    const comp = await como(db, finanzas, () => db.query<{ id: string }>(
      `select public.cobranza_registrar_compromiso($1, 2, 500, '2026-10-20', 'Compromiso de pago de prueba') as id`, [contrato]))
    await como(db, finanzas, () => db.query(`select public.cobranza_cerrar_compromiso($1, 'incumplido', 'No pagó en la fecha')`, [comp.rows[0].id]))
    const e = await uno<{ estado: string }>(`select estado from public.cobranza_compromisos where id = $1`, [comp.rows[0].id])
    expect(e.estado).toBe('incumplido')
  })
})

describe('permisos y visibilidad', () => {
  it('una vendedora consulta el cronograma de su venta, pero no registra gestiones ni pagos; otra no lo ve', async () => {
    expect((await como(db, vera, async () => (await db.query(`select id from public.installments where contract_id = $1`, [contrato])).rows.length))).toBeGreaterThan(0)
    const otra = await crearUsuario(db, 'Otra Vendedora', 'asesor')
    expect((await como(db, otra, async () => (await db.query(`select id from public.installments`)).rows.length))).toBe(0)
    await expect(como(db, vera, () => db.query(`select public.cobranza_registrar_gestion($1, 2, 'llamada', 'Intento no autorizado')`, [contrato]))).rejects.toThrow(/Sin permiso/)
    await expect(como(db, vera, () => db.query(`select public.cobranzas_reportar_pago($1::uuid, 10, $2::date, 'Banco de prueba', 'TRF-VEN', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [contrato, hoy]))).rejects.toThrow(/Sin permiso/)
  })

  it('las alertas solo las escribe el servidor: un usuario no puede insertarlas', async () => {
    await expect(como(db, admin, () => db.query(
      `insert into public.cobranza_alertas (dedupe_key, tipo, destinatario, asunto, cuerpo) values ('manual', 'prueba', 'x@y.test', 'x', 'x')`)))
      .rejects.toThrow(/row-level security/)
  })
})
