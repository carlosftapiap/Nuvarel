// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

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
    `insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id)
     values ('Cliente de prueba', '0990000001', 'whatsapp', $1, $1, $1) returning id`, [vendedora])
  clienteId = c.rows[0].id
})

/** Cotización aceptada por el cliente, lista para solicitar reserva. */
async function cotizacion(unidad: string, usuario: string) {
  const op = await db.query<{ id: string }>(
    `insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`,
    [clienteId, unidad, usuario])
  const numero = `COT-T-${Math.random().toString(36).slice(2, 8)}`
  const q = await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ($1, current_date, current_date + 15, $2, '{}', '{}', 0, 172147.2, 172147.2,
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
      `select public.reservas_verificar_pago($1, 10328.83, (now() at time zone 'America/Guayaquil')::date, 'TRF-1', 'motivo de prueba')`, [r.rows[0].id])))
      .rejects.toThrow(/Verificación de cobros deshabilitada/)
  })

  it('definir el receptor exige permiso; con permiso, el ingreso se verifica', async () => {
    await expect(como(db, vendedora, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Intento de prueba')`))).rejects.toThrow()
    await como(db, admin, () => db.query(`select public.config_definir_receptor('FIDUCIARIA', 'Definido en comité de prueba')`))
    const { rows } = await db.query<{ id: string }>(`select id from public.reservations where estado = 'solicitada' limit 1`)
    // El comprobante del cliente debe estar registrado antes de que Finanzas verifique el ingreso.
    await como(db, vendedora, () => db.query(`select public.reservas_adjuntar_comprobante($1, 'TRF-1', 'comprobantes/trf-1.pdf')`, [rows[0].id]))
    await como(db, finanzas, () => db.query(
      `select public.reservas_verificar_pago($1, 10328.83, (now() at time zone 'America/Guayaquil')::date, 'TRF-1', 'Ingreso confirmado en banco')`, [rows[0].id]))
    const st = await db.query(`select estado, pago_receptor from public.reservations where id = $1`, [rows[0].id])
    expect(st.rows[0]).toMatchObject({ estado: 'pago_verificado', pago_receptor: 'FIDUCIARIA' })
  })

  it('el cambio de etapa del cliente no confirma una reserva', async () => {
    await expect(como(db, vendedora, () => db.query(`update public.clients set etapa = 'reserva' where id = $1`, [clienteId])))
      .rejects.toThrow(/solo cambia al aprobar/)
  })

  it('gerencia aprueba: reserva e inventario cambian juntos; otra solicitud sobre la misma unidad se rechaza', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.reservations where estado = 'pago_verificado' limit 1`)
    await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Aprobada en comité de prueba')`, [rows[0].id]))
    const u = await db.query(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)
    expect(u.rows[0].estado).toBe('reservado')
    const quote = await cotizacion('E1-PB-A2', otraVendedora)
    await expect(como(db, otraVendedora, () => db.query(`select public.reservas_solicitar($1)`, [quote]))).rejects.toThrow(/no puede reservarse|ya tiene una reserva/)
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
  it('registra la aprobación con actor y motivo', async () => {
    const { rows } = await db.query(`select motivo, actor_id from public.audit_log where accion = 'Aprobar reserva'`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].motivo).toMatch(/comité/)
  })
})
