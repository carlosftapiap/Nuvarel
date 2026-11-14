// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { aCotizacion } from '../../src/features/cotizaciones/remoto'
import { cronogramaPorMes, generarPlan, hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cargarInventario } from '../../src/features/inventario/remoto'
import { datosPglite } from './datos-pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, vera: string
let n = 990500000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

async function oportunidad() {
  const codigo = await unidadLibre()
  const cliente = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Cliente ${codigo}`, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'instagram' }), vera])).id
  const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id
  return { codigo, cliente, op }
}
const emitir = async (op: string, extras: unknown) => (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir_extraordinarias($1, 0, 30, '', $2::jsonb) as id`, [op, JSON.stringify(extras)])).id
const plan = async (id: string) => (await uno<{ plan: { cuotasTotal: string | number; meses: number; cuotaMensual: number; ultimaCuota: number; contraEntrega: number; reserva: number; precioFinal: number; extraordinarias?: { mes: number; monto: number }[] } }>(`select plan from public.quotes where id = $1`, [id])).plan

async function contratoDe(q: string, monto = 600) {
  await rpc(vera, `select public.reservas_solicitar_acordada($1, $2)`, [q, monto])
  const r = (await uno<{ id: string }>(`select id from public.reservations where quote_id = $1`, [q])).id
  await rpc(vera, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-EXTRA', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, monto, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato con extraordinarias') as id`, [r, '2026-11-10'])).id
}
const cuotasDe = async (c: string) => (await db.query<{ numero: number; concepto: string; vencimiento: string | null; monto: string }>(`select numero, concepto, to_char(vencimiento, 'YYYY-MM-DD') as vencimiento, monto from public.installments where contract_id = $1 order by numero`, [c])).rows

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible' where edificio = 1`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('cuotas extraordinarias en la base de datos', () => {
  it('la cotización guarda las condiciones y coincide con el cálculo de la app, centavo a centavo', async () => {
    const { op, codigo } = await oportunidad()
    const q = await emitir(op, [{ mes: 12, monto: 1000.37 }, { mes: 6, monto: 2500 }])
    const p = await plan(q)
    expect(p.extraordinarias).toEqual([{ mes: 6, monto: 2500 }, { mes: 12, monto: 1000.37 }])

    const inv = await cargarInventario(datosPglite(db, vera))
    const u = inv.units.find((x) => x.codigo === codigo)!
    const app = generarPlan(u, inv.params, { fechaReserva: hoyGuayaquil(), extraordinarias: p.extraordinarias })
    expect(Number(p.cuotaMensual)).toBe(app.cuotaMensual)
    expect(Number(p.ultimaCuota)).toBe(app.ultimaCuota)

    const [fila] = await datosPglite(db, vera).select<Record<string, unknown>>('quotes', { filtros: { id: q } })
    const c = aCotizacion(fila, inv.units)!
    expect(c.plan.cronograma.filter((x) => x.tipo === 'extraordinaria').map((x) => x.monto)).toEqual([2500, 1000.37])
    expect(c.plan.cronograma.at(-1)!.saldo).toBe(0)
    expect(cronogramaPorMes(c.plan, c.fecha)).toHaveLength(p.meses)
  })

  it('rechaza valores no válidos y no deja cotización a medias', async () => {
    const { op } = await oportunidad()
    const antes = (await uno<{ n: number }>(`select count(*)::int as n from public.quotes`)).n
    await expect(emitir(op, [{ mes: 1, monto: -5 }])).rejects.toThrow(/mayor a cero/)
    await expect(emitir(op, [{ mes: 0, monto: 5 }])).rejects.toThrow(/mes/)
    await expect(emitir(op, [{ mes: 99, monto: 5 }])).rejects.toThrow(/mes/)
    await expect(emitir(op, [{ mes: 1, monto: 10.555 }])).rejects.toThrow(/dos decimales/)
    await expect(emitir(op, [{ mes: 1, monto: 99999999 }])).rejects.toThrow(/dejar saldo/)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.quotes`)).n).toBe(antes)
  })

  it('pasan al contrato en orden de fecha, suman el precio y no crean pagos', async () => {
    const { op } = await oportunidad()
    const q = await emitir(op, [{ mes: 6, monto: 2500 }, { mes: 6, monto: 100 }, { mes: 1, monto: 300.5 }])
    const p = await plan(q)
    const c = await contratoDe(q)
    const cuotas = await cuotasDe(c)
    const conceptos = cuotas.map((x) => x.concepto)
    expect(conceptos[0]).toMatch(/^Reserva/)
    expect(conceptos[1]).toMatch(/^Pago a la firma/)
    expect(conceptos.slice(2, 4)).toEqual([`Cuota 1 de ${p.meses}`, 'Cuota extraordinaria 1 de 3'])
    const i6 = conceptos.indexOf(`Cuota 6 de ${p.meses}`)
    expect(conceptos.slice(i6, i6 + 3)).toEqual([`Cuota 6 de ${p.meses}`, 'Cuota extraordinaria 2 de 3', 'Cuota extraordinaria 3 de 3'])
    expect(conceptos.at(-1)).toMatch(/^Saldo/)
    expect(cuotas[i6 + 1].vencimiento).toBe('2027-05-10')
    expect(cuotas[i6 + 1].vencimiento).toBe(cuotas[i6].vencimiento)
    const numeros = cuotas.map((x) => x.numero)
    expect(new Set(numeros).size).toBe(numeros.length)
    expect([...numeros].sort((a, b) => a - b)).toEqual(numeros)

    const total = cuotas.reduce((t, x) => t + Number(x.monto), 0)
    expect(Math.round(total * 100) / 100).toBe(Number(p.precioFinal))
    const entrada = cuotas.filter((x) => x.concepto.startsWith('Cuota')).reduce((t, x) => t + Number(x.monto), 0)
    expect(Math.round(entrada * 100) / 100).toBe(Number(p.cuotasTotal))

    // Programada no es pagada: el único pago es la reserva que Finanzas verificó.
    const pagos = (await db.query<{ monto: string }>(`select monto from public.payments where contract_id = $1`, [c])).rows
    expect(pagos.map((x) => Number(x.monto))).toEqual([600])
    const vencidas = await uno<{ pagado: string }>(`select pagado from public.installment_status where contract_id = $1 and concepto = 'Cuota extraordinaria 1 de 3'`, [c])
    expect(Number(vencidas.pagado)).toBe(0)
  })

  it('un plan sin extraordinarias produce el mismo cronograma de siempre', async () => {
    const { op } = await oportunidad()
    const q = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    const p = await plan(q)
    expect(p.extraordinarias).toBeUndefined()
    const cuotas = await cuotasDe(await contratoDe(q))
    expect(cuotas.map((x) => x.numero)).toEqual([0, 1, ...Array.from({ length: p.meses }, (_, i) => i + 2), p.meses + 2])
    expect(cuotas.some((x) => /extraordinaria/.test(x.concepto))).toBe(false)
  })

  it('la cotización ya emitida no se edita desde la app ni con acceso directo: cambia con una versión nueva', async () => {
    const { op } = await oportunidad()
    const q1 = await emitir(op, [{ mes: 3, monto: 1000 }])
    await como(db, vera, () => db.query(`update public.quotes set plan = '{}'::jsonb where id = $1`, [q1])).catch(() => {})
    expect((await plan(q1)).extraordinarias).toEqual([{ mes: 3, monto: 1000 }])
    const q2 = await emitir(op, [{ mes: 4, monto: 2000 }])
    expect((await plan(q2)).extraordinarias).toEqual([{ mes: 4, monto: 2000 }])
    expect((await plan(q1)).extraordinarias).toEqual([{ mes: 3, monto: 1000 }])
  })

  it('los documentos reciben las extraordinarias; el número de cuotas mensuales no cambia', async () => {
    const { op } = await oportunidad()
    const q = await emitir(op, [{ mes: 2, monto: 1000 }])
    const p = await plan(q)
    const c = await contratoDe(q)
    const d = (await rpc<{ d: { pago: { num_cuotas: number; cuotas: unknown[]; extraordinarias: { concepto: string; monto: number }[]; cuota_mensual: number; total_cuotas: number } } }>(legal, `select public.contratos_datos_documento($1, '{}'::jsonb) as d`, [c])).d
    expect(d.pago.num_cuotas).toBe(p.meses)
    expect(d.pago.cuotas).toHaveLength(p.meses + 1)
    expect(d.pago.extraordinarias).toMatchObject([{ concepto: 'Cuota extraordinaria 1 de 1', monto: 1000 }])
    expect(Number(d.pago.cuota_mensual)).toBe(Number(p.cuotaMensual))
    expect(Number(d.pago.total_cuotas)).toBe(Number(p.cuotasTotal))
  })
})
