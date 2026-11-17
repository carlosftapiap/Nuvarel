// @vitest-environment node
// Migración 0018: calendario fijo por edificio y día de pago del comprador, de la cotización al contrato.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { generarPlan, hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { versionDelPlan } from '../../src/features/financiamiento/condiciones'
import { cargarInventario } from '../../src/features/inventario/remoto'
import { datosPglite } from './datos-pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, vera: string
let n = 990700000

type Plan = { meses: number; cuotasTotal: number; cuotaMensual: number; ultimaCuota: number; diaPago: string; fechaFirma: string; vencimientos: string[]; ultimaFecha: string; cuotaEnFirma: boolean; calendarioAceptado: boolean }
const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function oportunidad(edificio: 1 | 2) {
  const { codigo } = await uno<{ codigo: string }>(`select codigo from public.inventory_units where edificio = $1 and estado = 'disponible'
    and codigo not in (select codigo_unidad from public.reservations where estado <> 'anulada') order by codigo limit 1`, [edificio])
  const cliente = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Cliente ${codigo}`, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'instagram' }), vera])).id
  return { codigo, op: (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id }
}
const emitir = async (op: string, firma: string, dia: string, acepta = true) =>
  (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir_calendario($1, 0, 30, '', '[]'::jsonb, $2::date, $3, $4) as id`, [op, firma, dia, acepta])).id
const plan = async (q: string) => (await uno<{ plan: Plan }>(`select plan from public.quotes where id = $1`, [q])).plan

async function contrato(q: string, firma: string) {
  await rpc(vera, `select public.reservas_solicitar_acordada($1, 600)`, [q])
  const r = (await uno<{ id: string }>(`select id from public.reservations where quote_id = $1`, [q])).id
  await rpc(vera, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-CAL', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, 600, $2::date, $3, true, 'Ingreso confirmado')`, [r, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato con calendario fijo') as id`, [r, firma])).id
  const cuotas = (await db.query<{ numero: number; concepto: string; vencimiento: string | null; monto: string }>(
    `select numero, concepto, to_char(vencimiento, 'YYYY-MM-DD') as vencimiento, monto from public.installments where contract_id = $1 order by numero`, [id])).rows
  const c = await uno<{ dia_pago: string; precio: string }>(`select dia_pago, precio from public.contracts where id = $1`, [id])
  const reserva = await uno<{ dia_pago: string }>(`select dia_pago from public.reservations where id = $1`, [r])
  return { cuotas, c, reserva }
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('0018 · calendario fijo y día de pago en la base', () => {
  it('la cotización guarda día, vencimientos y aceptación, y coincide con el simulador centavo a centavo', async () => {
    const { op, codigo } = await oportunidad(1)
    const q = await emitir(op, '2027-01-20', '10')
    const p = await plan(q)
    expect(p).toMatchObject({ meses: 35, diaPago: '10', fechaFirma: '2027-01-20', ultimaFecha: '2029-11-10', cuotaEnFirma: true, calendarioAceptado: true })
    expect(p.vencimientos.slice(0, 2)).toEqual(['2027-01-20', '2027-02-10'])
    const inv = await cargarInventario(datosPglite(db, vera))
    const app = generarPlan(inv.units.find((u) => u.codigo === codigo)!, inv.params, { fechaReserva: '2027-01-20', diaPago: '10' })
    expect(versionDelPlan(p as never)).toBe(versionDelPlan(app))
    expect(p.vencimientos).toEqual(app.vencimientos)
  })

  it('sin aceptación expresa o con un día inválido no se emite', async () => {
    const { op } = await oportunidad(1)
    await expect(emitir(op, '2027-01-20', '10', false)).rejects.toThrow(/aceptar expresamente/)
    await expect(emitir(op, '2027-01-20', '32')).rejects.toThrow(/Día de pago no válido/)
  })

  it('Edificio A: la reserva hereda el día y el contrato firmado en febrero tiene 34 cuotas hasta nov 2029', async () => {
    const { op } = await oportunidad(1)
    const q = await emitir(op, '2027-01-20', '30')
    const { cuotas, c, reserva } = await contrato(q, '2027-02-10')
    expect(reserva.dia_pago).toBe('30')
    expect(c.dia_pago).toBe('30')
    const mensuales = cuotas.filter((x) => x.concepto.startsWith('Cuota '))
    expect(mensuales).toHaveLength(34)
    expect(mensuales[0]).toMatchObject({ concepto: 'Cuota 1 de 34', vencimiento: '2027-02-28' })
    expect(mensuales[1].vencimiento).toBe('2027-03-30')
    expect(mensuales[33].vencimiento).toBe('2029-11-30')
    const p = await plan(q)
    expect(Math.round(mensuales.reduce((t, x) => t + Number(x.monto), 0) * 100) / 100).toBe(Number(p.cuotasTotal))
    expect(Math.round(cuotas.reduce((t, x) => t + Number(x.monto), 0) * 100) / 100).toBe(Number(c.precio))
    expect(cuotas.every((x) => !x.vencimiento || x.vencimiento >= '2027-02-10' || x.concepto.startsWith('Reserva'))).toBe(true)
  })

  it('el día que ya pasó en el mes de firma vence ese mismo día, separado del pago a la firma y sin duplicarse', async () => {
    const { op } = await oportunidad(1)
    const q = await emitir(op, '2027-01-20', '10')
    const { cuotas } = await contrato(q, '2027-01-20')
    const firma = cuotas.find((x) => x.concepto.startsWith('Pago a la firma'))!
    const c1 = cuotas.find((x) => x.concepto === 'Cuota 1 de 35')!
    expect([firma.vencimiento, c1.vencimiento]).toEqual(['2027-01-20', '2027-01-20'])
    expect(cuotas.filter((x) => x.concepto.startsWith('Cuota ') && x.vencimiento === '2027-01-20')).toHaveLength(1)
    expect(cuotas.find((x) => x.concepto === 'Cuota 2 de 35')!.vencimiento).toBe('2027-02-10')
  })

  it('Torre B: firma en diciembre 2026, último día del mes, 42 cuotas hasta el 31/05/2030', async () => {
    const { op } = await oportunidad(2)
    const q = await emitir(op, '2026-12-15', 'ultimo')
    const { cuotas } = await contrato(q, '2026-12-15')
    const mensuales = cuotas.filter((x) => x.concepto.startsWith('Cuota '))
    expect(mensuales).toHaveLength(42)
    expect([mensuales[0].vencimiento, mensuales[2].vencimiento, mensuales[41].vencimiento]).toEqual(['2026-12-31', '2027-02-28', '2030-05-31'])
  })
})
