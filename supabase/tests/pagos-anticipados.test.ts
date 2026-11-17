// @vitest-environment node
// Fase 2: los pagos cubren la entrada; el excedente solo reduce el 80 % con autorización de Finanzas.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario, aprobarCumplimiento } from './db'
import { prepararReservasParaPago } from './db'
import { aplicarPagos } from '../functions/_shared/cobranza'
import { calcularEstadoCuenta } from '../functions/_shared/estadoCuenta'

let db: PGlite
let admin: string, vera: string, finanzas: string, gerente: string, constructor: string
let contrato: string, hoy: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
interface Saldos { pagado_verificado: string; total_entrada: string; pagado_entrada: string; saldo_entrada: string; excedente_disponible: string; aplicado_financiamiento: string; saldo_financiamiento: string }
const saldos = async () => {
  const s = await uno<Saldos>(`select pagado_verificado, total_entrada, pagado_entrada, saldo_entrada, excedente_disponible, aplicado_financiamiento, saldo_financiamiento
    from public.contract_balances where contract_id = $1`, [contrato])
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])) as Record<keyof Saldos, number>
}
const cuota = (numero: number) => uno<{ pagado: string; situacion: string }>(`select pagado, situacion from public.installment_status where contract_id = $1 and numero = $2`, [contrato, numero])
const cronograma = async () => (await db.query(`select numero, concepto, vencimiento, monto from public.installments where contract_id = $1 order by numero`, [contrato])).rows
const archivo = (nombre = 'soporte.pdf') => ({ ruta: `excedentes/${contrato}/${nombre}`, nombre, mime: 'application/pdf', tamano: 2048, hash: 'a'.repeat(64) })
const autorizar = (quien: string, monto: number, motivo: string, adjunto: unknown = archivo()) =>
  como(db, quien, () => db.query<{ id: string }>(`select public.cobranzas_autorizar_excedente($1, $2, $3, $4::jsonb) as id`, [contrato, monto, motivo, adjunto === null ? null : JSON.stringify(adjunto)]))
const registrarYVerificar = async (monto: number, ref: string) => {
  const p = await como(db, finanzas, () => db.query<{ id: string }>(
    `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', $4, jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`,
    [contrato, monto, hoy, ref]))
  await como(db, admin, () => db.query(`select public.cobranzas_confirmar_pago($1, true, 'Verificado en banco')`, [p.rows[0].id]))
  return p.rows[0].id
}

beforeAll(async () => {
  db = await crearDb()
  // Escenario heredado: plazo de 30 meses desde la firma, sin calendario fijo. El calendario se prueba en calendario-fijo-db.test.ts.
  await db.query(`update public.pricing_params set meses_e1 = 30, inicio_cuotas = null where id = 1`)
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  constructor = await crearUsuario(db, 'Constructor', 'constructor')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  const cliente = (await db.query<{ id: string }>(
    `insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente anticipado', '1715000319', '0990000031', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [cliente, vera])).rows[0].id
  // Precio 172.147,20: entrada 34.429,44 (reserva 1.000, firma 9.328,83 y 30 cuotas) y saldo contra entrega 137.717,76.
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-A-1', $4::date, $4::date + 60, 'E1-PB-A2', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, cliente, op, hoy])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  const reserva = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
  await como(db, vera, () => db.query(`select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [reserva]))
  await como(db, vera, () => db.query(`select public.reservas_reportar_pago($1::uuid, 1000, $2::date, 'Banco de prueba', 'TRF-RES-A', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva, hoy]))
  await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
  await prepararReservasParaPago(db)
  await como(db, finanzas, () => db.query(`select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-RES-A', true, 'Ingreso confirmado en banco')`, [reserva, hoy]))
  await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Aprobada en comité de prueba')`, [reserva]))
  // Contrato de hace tres meses: la firma y las cuotas 1 y 2 ya vencieron.
  contrato = (await como(db, admin, () => db.query<{ id: string }>(`select public.contratos_crear($1, ($2::date - interval '3 months')::date, 'Contrato con pagos anticipados') as id`, [reserva, hoy]))).rows[0].id
  await aprobarCumplimiento(db)
  await como(db, admin, () => db.query(`select public.contratos_firmar($1, 'Firma de prueba', 'contratos/firmado.pdf')`, [contrato]))
})

describe('aplicación de pagos', () => {
  it('un pago cubre primero lo vencido, en orden de vencimiento, aunque una cuota anterior se haya reprogramado', async () => {
    // La cuota 1 (número 2) se mueve a dentro de 60 días: ya no está vencida.
    await como(db, admin, () => db.query(`select public.cobranza_reprogramar_cuota($1, 2, ($2::date + 60), 'Acuerdo con el cliente')`, [contrato, hoy]))
    await registrarYVerificar(9328.83 + 803.35, 'TRF-A-1')
    expect((await cuota(1)).situacion).toBe('pagada')
    expect((await cuota(3)).situacion).toBe('pagada')
    expect((await cuota(2)).situacion).toBe('pendiente')
  })

  it('lo que supera la entrada queda como saldo a favor y el 80 % no cambia', async () => {
    await registrarYVerificar(50000, 'TRF-A-2')
    const s = await saldos()
    expect(s.total_entrada).toBeCloseTo(34429.44, 2)
    expect(s.saldo_entrada).toBe(0)
    expect(s.aplicado_financiamiento).toBe(0)
    expect(s.saldo_financiamiento).toBeCloseTo(137717.76, 2)
    expect(s.excedente_disponible).toBeCloseTo(61132.18 - 34429.44, 2)
    expect((await uno<{ situacion: string }>(`select situacion from public.installment_status where contract_id = $1 and vencimiento is null`, [contrato])).situacion).toBe('pendiente')
  })
})

describe('autorización de Finanzas', () => {
  it('sin el permiso no se autoriza, ni desde la app ni llamando la función', async () => {
    await expect(autorizar(vera, 1000, 'Abono anticipado del cliente')).rejects.toThrow(/Sin permiso/)
    await expect(autorizar(gerente, 1000, 'Abono anticipado del cliente')).rejects.toThrow(/Sin permiso/)
  })

  it('exige motivo, documento de soporte y un monto dentro del saldo a favor', async () => {
    await expect(autorizar(finanzas, 1000, 'Corto')).rejects.toThrow(/motivo/)
    await expect(autorizar(finanzas, 1000, 'Abono anticipado del cliente', null)).rejects.toThrow(/soporte/)
    await expect(autorizar(finanzas, 1000, 'Abono anticipado del cliente', { ...archivo(), ruta: `contratos/${contrato}/x.pdf` })).rejects.toThrow(/no corresponde/)
    await expect(autorizar(finanzas, 1000, 'Abono anticipado del cliente', { ...archivo(), mime: 'text/plain' })).rejects.toThrow(/PDF/)
    await expect(autorizar(finanzas, 30000, 'Abono anticipado del cliente')).rejects.toThrow(/saldo a favor disponible/)
  })

  it('Finanzas aplica parte del excedente: baja el 80 %, cuadra el total y el cronograma queda idéntico', async () => {
    const antes = await cronograma()
    const id = (await autorizar(finanzas, 20000, 'Abono anticipado para reducir la hipoteca')).rows[0].id
    const s = await saldos()
    expect(s.aplicado_financiamiento).toBe(20000)
    expect(s.saldo_financiamiento).toBeCloseTo(117717.76, 2)
    expect(s.excedente_disponible).toBeCloseTo(61132.18 - 34429.44 - 20000, 2)
    expect(s.pagado_entrada + s.excedente_disponible + s.aplicado_financiamiento).toBeCloseTo(s.pagado_verificado, 2)
    expect(await cronograma()).toEqual(antes)
    const a = await uno<{ autorizado_por: string; soporte_ruta: string; motivo: string }>(`select autorizado_por, soporte_ruta, motivo from public.aplicaciones_excedente where id = $1`, [id])
    expect(a).toEqual({ autorizado_por: finanzas, soporte_ruta: `excedentes/${contrato}/soporte.pdf`, motivo: 'Abono anticipado para reducir la hipoteca' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Autorizar aplicación de excedente' and entidad_id = $1`, [contrato])).n).toBe(1)
  })

  it('la app (tablero, correo y estado de cuenta) aplica igual que la base', async () => {
    const cuotas = (await db.query<{ numero: number; concepto: string; vencimiento: string | null; monto: string; pagado: string }>(
      `select i.numero, i.concepto, i.vencimiento::text, i.monto, s.pagado from public.installments i join public.installment_status s on s.contract_id = i.contract_id and s.numero = i.numero where i.contract_id = $1`, [contrato])).rows
    const s = await saldos()
    const autorizado = Number((await uno<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.aplicaciones_excedente where contract_id = $1 and anulado_en is null`, [contrato])).t)
    const app = aplicarPagos(cuotas.map((q) => ({ numero: q.numero, monto: Number(q.monto), vencimiento: q.vencimiento })), s.pagado_verificado, autorizado)
    for (const q of cuotas) expect(app.pagado.get(q.numero)).toBeCloseTo(Number(q.pagado), 2)
    expect(app.excedente).toBeCloseTo(s.excedente_disponible, 2)
    const pagos = (await db.query<{ id: string; fecha: string; referencia: string; monto: string; estado: 'verificado' }>(`select id, fecha::text, referencia, monto, estado from public.payments where contract_id = $1`, [contrato])).rows
    const ec = calcularEstadoCuenta({
      hoy, contrato: { codigo: 'CON', estado: 'firmado', precio: 172147.2 },
      cuotas: cuotas.map((q) => ({ numero: q.numero, concepto: q.concepto, vencimiento: q.vencimiento, monto: Number(q.monto) })),
      pagos: pagos.map((p) => ({ ...p, monto: Number(p.monto), recibo: null, concepto: null })),
      aplicaciones: [{ monto: autorizado, autorizadoEn: hoy, motivo: 'x', anulada: false }],
    })
    expect(ec.entrada.saldo).toBeCloseTo(s.saldo_entrada, 2)
    expect(ec.financiamiento.saldo).toBeCloseTo(s.saldo_financiamiento, 2)
    expect(ec.saldoAFavor).toBeCloseTo(s.excedente_disponible, 2)
    expect(ec.totalConfirmado).toBeCloseTo(s.pagado_verificado, 2)
  })

  it('no se puede aplicar más de lo que queda disponible', async () => {
    await expect(autorizar(finanzas, 7000, 'Segundo abono anticipado')).rejects.toThrow(/saldo a favor disponible/)
  })

  it('las autorizaciones las ve quien consulta cobranzas; quien no tiene cobranzas no', async () => {
    expect((await como(db, finanzas, () => db.query(`select id from public.aplicaciones_excedente`))).rows).toHaveLength(1)
    expect((await como(db, constructor, () => db.query(`select id from public.aplicaciones_excedente`))).rows).toHaveLength(0)
  })

  it('el soporte solo lo sube quien puede autorizar, y queda vinculado', async () => {
    const ruta = `excedentes/${contrato}/otro.pdf`
    expect((await como(db, finanzas, () => db.query<{ v: boolean }>(`select public.comprobante_puede_subir($1) as v`, [ruta]))).rows[0].v).toBe(true)
    expect((await como(db, vera, () => db.query<{ v: boolean }>(`select public.comprobante_puede_subir($1) as v`, [ruta]))).rows[0].v).toBe(false)
    expect((await como(db, finanzas, () => db.query<{ v: boolean }>(`select public.comprobante_archivo_vinculado($1) as v`, [`excedentes/${contrato}/soporte.pdf`]))).rows[0].v).toBe(true)
  })
})

describe('anulación y correcciones', () => {
  it('anular exige motivo, devuelve el monto al saldo a favor y no se repite', async () => {
    const id = (await uno<{ id: string }>(`select id from public.aplicaciones_excedente where contract_id = $1`, [contrato])).id
    await expect(como(db, vera, () => db.query(`select public.cobranzas_anular_aplicacion($1, 'Error de digitación')`, [id]))).rejects.toThrow(/Sin permiso/)
    await expect(como(db, finanzas, () => db.query(`select public.cobranzas_anular_aplicacion($1, 'Error')`, [id]))).rejects.toThrow(/motivo/)
    await como(db, finanzas, () => db.query(`select public.cobranzas_anular_aplicacion($1, 'Monto equivocado en la autorización')`, [id]))
    const s = await saldos()
    expect(s.aplicado_financiamiento).toBe(0)
    expect(s.saldo_financiamiento).toBeCloseTo(137717.76, 2)
    await expect(como(db, finanzas, () => db.query(`select public.cobranzas_anular_aplicacion($1, 'Monto equivocado en la autorización')`, [id]))).rejects.toThrow(/ya está anulada/)
    // La fila se conserva con quién y por qué.
    expect(await uno(`select anulado_por, motivo_anulacion from public.aplicaciones_excedente where id = $1`, [id])).toEqual({ anulado_por: finanzas, motivo_anulacion: 'Monto equivocado en la autorización' })
  })

  it('si después se anula un pago, al 80 % nunca llega más que el excedente real', async () => {
    await autorizar(finanzas, 20000, 'Abono anticipado para reducir la hipoteca')
    const pago = (await uno<{ id: string }>(`select id from public.payments where referencia = 'TRF-A-2'`)).id
    await como(db, admin, () => db.query(`select public.cobranzas_anular_pago($1, 'Transferencia devuelta por el banco')`, [pago]))
    const s = await saldos()
    expect(s.aplicado_financiamiento).toBe(0)
    expect(s.excedente_disponible).toBe(0)
    expect(s.pagado_entrada).toBeCloseTo(s.pagado_verificado, 2)
  })
})
