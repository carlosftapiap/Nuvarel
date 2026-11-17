// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, gerente: string, vendedora: string, otraVendedora: string, finanzas: string
let clienteId: string

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  vendedora = await crearUsuario(db, 'Vera', 'asesor')
  otraVendedora = await crearUsuario(db, 'Otra', 'asesor')
  finanzas = await crearUsuario(db, 'Finanzas', 'asesor', { alcance: 'empresa' })
  await db.query(`insert into public.user_permission_overrides values ($1, 'reservas.verificar_pago', 'permitir')`, [finanzas])
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo in ('E1-PB-A2','E1-P1-A1')`)
  const c = await db.query<{ id: string }>(
    `insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente de prueba', '1715000012', '0990000001', 'whatsapp', $1, $1, $1) returning id`, [vendedora])
  clienteId = c.rows[0].id
})

/** El vendedor registra el comprobante del cliente. */
const pagar = (reserva: string) => como(db, vendedora, () => db.query(`select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-' || left(gen_random_uuid()::text, 6), jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva]))

/** Cotización aceptada por el cliente, lista para solicitar reserva. */
async function cotizacion(unidad: string, usuario: string) {
  const op = await db.query<{ id: string }>(
    `insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`,
    [clienteId, unidad, usuario])
  const numero = `COT-T-${Math.random().toString(36).slice(2, 8)}`
  const q = await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ($1, (now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date + 15, $2, '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.35, "contraEntrega": 137717.76}', $3, $4, $5)
     returning id`, [numero, unidad, usuario, clienteId, op.rows[0].id])
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q.rows[0].id])
  return q.rows[0].id
}

describe('permisos en la base de datos', () => {
  it('una vendedora no tiene permiso para aprobar precios ni confirmar reservas', async () => {
    const ok = await como(db, vendedora, async () => (await db.query<{ ok: boolean }>(`select public.tiene_permiso('precios.aprobar') as ok`)).rows[0].ok)
    expect(ok).toBe(false)
    await expect(como(db, vendedora, () => db.query(`select public.reservas_aprobar(gen_random_uuid(), 'motivo de prueba')`))).rejects.toThrow(/permiso|inexistente/)
  })

  it('un vendedor solo ve sus clientes', async () => {
    const otra = await como(db, otraVendedora, async () => (await db.query(`select id from public.clients`)).rows.length)
    const propia = await como(db, vendedora, async () => (await db.query(`select id from public.clients`)).rows.length)
    expect(otra).toBe(0)
    expect(propia).toBe(1)
  })

  it('un vendedor no cambia el precio de una unidad directamente', async () => {
    await como(db, vendedora, () => db.query(`update public.inventory_units set usd_m2 = 1 where codigo = 'E1-PB-A2'`)).catch(() => undefined)
    const { rows } = await db.query(`select usd_m2 from public.inventory_units where codigo = 'E1-PB-A2'`)
    expect(Number(rows[0].usd_m2)).toBe(2230)
  })

  it('el catálogo del servidor incluye config.cobros', async () => {
    const { rows } = await db.query(`select count(*)::int as n from public.permissions where clave = 'config.cobros'`)
    expect(rows[0].n).toBe(1)
  })
})

describe('reservas: pago verificado, aprobación y simultaneidad', () => {
  it('sin receptor de pagos definido no se verifica ningún ingreso', async () => {
    const quote = await cotizacion('E1-PB-A2', vendedora)
    const r = await como(db, vendedora, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [quote]))
    await expect(como(db, finanzas, () => db.query(
      `select public.reservas_confirmar_pago($1, 10328.83, (now() at time zone 'America/Guayaquil')::date, 'TRF-1', true, 'motivo de prueba')`, [r.rows[0].id])))
      .rejects.toThrow(/Verificación de cobros deshabilitada/)
  })

  it('el cambio de etapa del cliente no confirma una reserva', async () => {
    await expect(como(db, vendedora, () => db.query(`update public.clients set etapa = 'reserva' where id = $1`, [clienteId])))
      .rejects.toThrow(/solo cambia al aprobar/)
  })

  it('reserva normal: al verificar el ingreso se confirma sola, la unidad queda reservada y otra solicitud se rechaza', async () => {
    await expect(como(db, vendedora, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Intento de prueba')`))).rejects.toThrow()
    await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Definido en comité de prueba')`))
    const { rows } = await db.query<{ id: string }>(`select id from public.reservations where estado = 'solicitada' limit 1`)
    // El comprobante del cliente debe estar registrado antes de que Finanzas verifique el ingreso.
    await pagar(rows[0].id)
    await prepararReservasParaPago(db)
    await como(db, finanzas, () => db.query(
      `select public.reservas_confirmar_pago($1, 10328.83, (now() at time zone 'America/Guayaquil')::date, 'TRF-1', true, 'Ingreso confirmado en banco')`, [rows[0].id]))
    const st = await db.query(`select estado, pago_receptor, aprobado_por, fecha_confirmacion is not null as fecha from public.reservations where id = $1`, [rows[0].id])
    expect(st.rows[0]).toMatchObject({ estado: 'confirmada', pago_receptor: 'NUVAREL', aprobado_por: null, fecha: true })
    expect((await db.query(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).rows[0].estado).toBe('reservado')
    expect((await db.query(`select etapa from public.clients where id = $1`, [clienteId])).rows[0].etapa).toBe('reserva')
    const a = await db.query(`select motivo from public.audit_log where accion = 'Confirmar reserva automáticamente' and entidad_id = $1`, [rows[0].id])
    expect(a.rows).toHaveLength(1)
    // Aprobar una reserva ya confirmada no hace nada; otra solicitud sobre la unidad se rechaza.
    await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Doble clic de prueba')`, [rows[0].id]))
    expect((await db.query(`select count(*)::int as n from public.audit_log where accion = 'Aprobar reserva' and entidad_id = $1`, [rows[0].id])).rows[0].n).toBe(0)
    const quote = await cotizacion('E1-PB-A2', otraVendedora)
    await expect(como(db, otraVendedora, () => db.query(`select public.reservas_solicitar($1)`, [quote]))).rejects.toThrow(/no puede reservarse|ya tiene una reserva/)
  })

  it('con un precio distinto del oficial queda como excepción: Gerencia la autoriza y recién entonces se reserva la unidad', async () => {
    const quote = await cotizacion('E1-P2-A2', vendedora)
    const r = (await como(db, vendedora, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [quote]))).rows[0].id
    await pagar(r)
    await prepararReservasParaPago(db)
    await como(db, finanzas, () => db.query(
      `select public.reservas_confirmar_pago($1, 10328.83, (now() at time zone 'America/Guayaquil')::date, 'TRF-2', true, 'Ingreso confirmado en banco')`, [r]))
    expect((await db.query(`select estado from public.reservations where id = $1`, [r])).rows[0].estado).toBe('pago_verificado')
    expect((await db.query(`select estado from public.inventory_units where codigo = 'E1-P2-A2'`)).rows[0].estado).toBe('disponible')
    const exc = await como(db, gerente, async () => (await db.query<{ e: string[] }>(`select public.reservas_excepciones($1) as e`, [r])).rows[0].e)
    expect(exc.join(' ')).toMatch(/Precio distinto del oficial/)
    await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Precio especial aprobado en comité de prueba')`, [r]))
    expect((await db.query(`select estado, aprobado_por from public.reservations where id = $1`, [r])).rows[0]).toEqual({ estado: 'confirmada', aprobado_por: gerente })
    expect((await db.query(`select estado from public.inventory_units where codigo = 'E1-P2-A2'`)).rows[0].estado).toBe('reservado')
  })

  it('solicitudes simultáneas sobre la misma unidad: solo una reserva activa', async () => {
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-P1-A1'`)
    const a = await cotizacion('E1-P1-A1', vendedora)
    const b = await cotizacion('E1-P1-A1', otraVendedora)
    const results = await Promise.allSettled([
      como(db, vendedora, () => db.query(`select public.reservas_solicitar($1)`, [a])),
      como(db, otraVendedora, () => db.query(`select public.reservas_solicitar($1)`, [b])),
    ])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1)
    const n = await db.query(`select count(*)::int as n from public.reservations where codigo_unidad = 'E1-P1-A1' and estado in ('solicitada','pago_verificado','confirmada')`)
    expect(n.rows[0].n).toBe(1)
  })
})

describe('auditoría', () => {
  it('registra la autorización de la excepción con actor y motivo', async () => {
    const { rows } = await db.query(`select motivo, actor_id from public.audit_log where accion = 'Aprobar reserva'`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toMatchObject({ actor_id: gerente })
    expect(rows[0].motivo).toMatch(/comité/)
  })
})
