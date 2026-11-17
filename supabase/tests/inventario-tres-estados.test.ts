// @vitest-environment node
// Lista oficial de precios del 12/11/2026 e inventario con tres estados: disponible, reservado y vendido.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { cedulaPrueba, como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, oficial: string, vendA: string, vendB: string
const uno = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = Record<string, unknown>>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const estado = async (codigo: string) => (await uno<{ estado: string }>(`select estado from public.inventory_units where codigo = $1`, [codigo])).estado
const NATURAL = ['pn_cedula', 'pn_votacion', 'pn_servicio_basico', 'pn_origen_fondos', 'pn_conozca_cliente']
let n = 0

/** Cliente, oportunidad y cotización aceptada por el vendedor sobre la unidad. */
async function cotizada(vendedor: string, unidad: string) {
  n += 1
  const cliente = (await rpc<{ id: string }>(vendedor, `select public.clientes_crear(null, $1::jsonb, $2) as id`,
    [JSON.stringify({ nombre: `Cliente ${n}`, documento: cedulaPrueba(n + 40), telefono: `09920000${String(n).padStart(2, '0')}`, origen: 'whatsapp' }), vendedor])).id
  const op = (await rpc<{ id: string }>(vendedor, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, unidad])).id
  const cot = (await rpc<{ id: string }>(vendedor, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(vendedor, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  return { cliente, op, cot }
}

/** Reserva solicitada, con el pago verificado por Finanzas y aprobada por Gerencia. */
async function aprobada(vendedor: string, unidad: string) {
  const c = await cotizada(vendedor, unidad)
  const r = (await rpc<{ id: string }>(vendedor, `select public.reservas_solicitar($1) as id`, [c.cot])).id
  await rpc(vendedor, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-' || $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, n])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-' || $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), n])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return { ...c, r }
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  oficial = await crearUsuario(db, 'Olga Cumplimiento', 'oficial_cumplimiento')
  vendA = await crearUsuario(db, 'Vendedor A', 'asesor')
  vendB = await crearUsuario(db, 'Vendedor B', 'asesor')
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('lista oficial de precios', () => {
  it('las 72 unidades tienen el precio de la tabla del 12/11/2026, con una sola lista', async () => {
    const r = await uno<{ n: number; total: string; una: boolean }>(
      `select count(*)::int as n, sum(public.precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, 230)) as total, bool_and(usd_m2 = usd_m2_lista) as una from public.inventory_units`)
    expect(r.n).toBe(72)
    expect(Math.abs(Number(r.total) - (11129497 - 35438))).toBeLessThan(60) // 0017 cambia seis unidades: -35.438 USD
    expect(r.una).toBe(true)
    // Muestras de la tabla: precio total (departamento + patio a USD 230/m²).
    const precio = async (c: string) => Math.round(Number((await uno<{ p: string }>(`select precio_referencia as p from public.inventory_units where codigo = $1`, [c])).p))
    expect(await precio('E1-PB-A1')).toBe(161831)
    expect(await precio('E1-PB-A2')).toBe(172147)
    expect(await precio('E1-P1-A5')).toBe(178628)
    expect(await precio('E2-PB-A2')).toBe(175048)
    expect(await precio('E2-P3-A7')).toBe(127213)
    expect(await precio('E2-P5-A6')).toBe(170216)
  })
})

describe('tres estados de inventario', () => {
  it('solo existen disponible, reservado y vendido; nadie los cambia a mano', async () => {
    expect((await db.query<{ estado: string }>(`select distinct estado from public.inventory_units`)).rows.map((x) => x.estado)).toEqual(['disponible'])
    await expect(db.query(`update public.inventory_units set estado = 'bloqueado' where codigo = 'E1-P5-A5'`)).rejects.toThrow(/inventory_units_estado_tres/)
    await expect(rpc(gerente, `select public.inventario_cambiar_estado('E1-P5-A5', 'vendido', 'Intento manual')`)).rejects.toThrow(/lo asignan Reservas/)
    expect(await estado('E1-P5-A5')).toBe('disponible')
  })

  it('una unidad disponible se reserva; reservada no admite otra reserva; vendida tampoco', async () => {
    const otra = await cotizada(vendB, 'E1-P2-A1')
    const a = await aprobada(vendA, 'E1-P2-A1')
    expect(await estado('E1-P2-A1')).toBe('reservado')
    // La cotización de otro cliente, emitida cuando estaba disponible, ya no reserva.
    await expect(rpc(vendB, `select public.reservas_solicitar($1)`, [otra.cot])).rejects.toThrow(/no puede reservarse \(reservado\)/)
    await expect(cotizada(vendB, 'E1-P2-A1')).rejects.toThrow(/no puede cotizarse/)

    // Venta formalizada: contrato, Cumplimiento aprobado y firma.
    const contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [a.r, hoyGuayaquil()])).id
    expect(await estado('E1-P2-A1')).toBe('reservado')
    for (const [i, t] of NATURAL.entries()) {
      await rpc(vendA, `select public.expediente_cargar($1, null, $2, $3::jsonb, null)`,
        [a.cliente, t, JSON.stringify({ ruta: `clientes/${a.cliente}/${crypto.randomUUID()}-doc${i}.pdf`, nombre: `doc${i}.pdf`, mime: 'application/pdf', tamano: 1024, hash: 'b'.repeat(64) })])
    }
    await rpc(legal, `select public.cumplimiento_enviar($1, 'Expediente completo')`, [contrato])
    for (const x of (await db.query<{ id: string }>(`select id from public.expediente_documentos where client_id = $1`, [a.cliente])).rows) {
      await rpc(oficial, `select public.expediente_revisar($1, 'aprobado', null)`, [x.id])
    }
    await rpc(oficial, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [contrato])
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma de prueba', 'Contrato firmado de prueba')`, [contrato, hoyGuayaquil()])
    expect(await estado('E1-P2-A1')).toBe('vendido')
    await expect(rpc(vendB, `select public.reservas_solicitar($1)`, [otra.cot])).rejects.toThrow(/no puede reservarse \(vendido\)/)
    await expect(cotizada(vendB, 'E1-P2-A1')).rejects.toThrow(/no puede cotizarse/)
    // La escritura es un hito: no cambia el estado de la unidad.
    await rpc(legal, `select public.contratos_registrar_hito($1, 'escritura', $2::date, 'ESC-1', 'Escritura de prueba')`, [contrato, hoyGuayaquil()])
    expect(await estado('E1-P2-A1')).toBe('vendido')
  })

  it('una reserva desistida libera la unidad si no hay otro compromiso', async () => {
    const a = await aprobada(vendA, 'E1-P3-A1')
    expect(await estado('E1-P3-A1')).toBe('reservado')
    const d = (await rpc<{ id: string }>(vendA, `select public.desistimientos_registrar($1, $2, 'cambio_decision', 'Cambio de decisión en prueba') as id`, [a.cliente, a.op])).id
    await rpc(gerente, `select public.desistimientos_autorizar($1, 'Autorizado en prueba')`, [d])
    await rpc(finanzas, `select public.desistimientos_revisar_finanzas($1, 'Retención según política comercial')`, [d])
    expect(await uno(`select estado, reserva_id from public.inventory_units where codigo = 'E1-P3-A1'`)).toEqual({ estado: 'disponible', reserva_id: null })
    // Vuelve a poder reservarse.
    await aprobada(vendB, 'E1-P3-A1')
    expect(await estado('E1-P3-A1')).toBe('reservado')
  })
})
