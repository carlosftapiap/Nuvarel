// @vitest-environment node
// Prueba integral A103 en una base local aislada (PGlite) con datos ficticios. No toca producción.
// Cotización aceptada → Orden de contrato → Reserva USD 500 → pagador y comprobante → Cumplimiento → Finanzas →
// reserva confirmada → contrato con cronograma (6 % + 14 % + 80 %) → promesa bloqueada hasta que Legal apruebe la plantilla.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { etiquetasDeTexto } from '@/features/contratos/plantilla'
import { VARIABLES_FIRMAS } from '@/features/contratos/docxTexto'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string, finanzas: string, oficial: string, legal: string, gerente: string
let hoy: string, unidad: string, precio: number, cotizacion: string, reserva: string, contrato: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
const r2 = (n: number) => Math.round(n * 100) / 100

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Prueba', 'administrador')
  vera = await crearUsuario(db, 'Vera Prueba', 'asesor')
  finanzas = await crearUsuario(db, 'Fina Prueba', 'finanzas', { alcance: 'empresa' })
  oficial = await crearUsuario(db, 'Olga Prueba', 'oficial_cumplimiento')
  legal = await crearUsuario(db, 'Lola Prueba', 'legal')
  gerente = await crearUsuario(db, 'Gema Prueba', 'gerencia')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor de la prueba A103')`)
}, 120_000)

describe('A103 de punta a punta (base local, datos ficticios)', () => {
  // Precio de referencia de la prueba (producción, 2026-11-17). La base local no tiene los ajustes de precio hechos en producción:
  // si el precio de lista local difiere, la reserva pasa por la autorización de Gerencia, como en la aplicación.
  it('A103 existe en el inventario y se cotiza al precio de referencia USD 119.729', async () => {
    const u = await uno<{ codigo: string; precio: string }>(
      `select codigo, public.precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, (select patio_usd_m2 from public.pricing_params where id = 1)) as precio
         from public.inventory_units where dpt = 'A103'`)
    unidad = u.codigo
    expect(Number(u.precio)).toBeGreaterThan(0)
    precio = 119729
  })

  it('cotización aceptada y orden de contrato antes de solicitar la reserva', async () => {
    const meses = (await uno<{ meses: number }>(`select meses from public.cuotas_calendario(1, $1::date)`, [hoy])).meses
    const cuotasTotal = r2(precio * 0.14)
    const cuota = r2(cuotasTotal / meses)
    const plan = { reserva: r2(precio * 0.06), reservaPct: 6, meses, cuotaMensual: cuota, ultimaCuota: r2(cuotasTotal - cuota * (meses - 1)), contraEntrega: r2(precio * 0.8), cuotasTotal, diaPago: 'ultimo' }
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [unidad])
    const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Prueba A103', $1, $2, 'whatsapp', $3, $3, $3) returning id`, [cedulaPrueba(103103), celularPrueba(103103), vera])).rows[0].id
    const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, $2, $3, $3) returning id`, [cliente, unidad, vera])).rows[0].id
    cotizacion = (await db.query<{ id: string }>(
      `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
       values ('COT-PRUEBA-A103', $4::date, $4::date + 60, $5, '{}', '{}', 0, $6, $6, $7::jsonb, $1, $2, $3) returning id`,
      [vera, cliente, op, hoy, unidad, precio, JSON.stringify(plan)])).rows[0].id
    await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [cotizacion])
    await rpc(vera, `select public.ordenes_contrato_registrar($1, $2::jsonb, $3, 'Vera Prueba')`, [cotizacion, JSON.stringify({ unidad: 'A103', precio }), 'a'.repeat(64)])
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.ordenes_contrato where quote_id = $1`, [cotizacion])).n).toBe(1)
  })

  it('reserva de USD 500: pendiente de Cumplimiento, con pagador y comprobante, sin contrato ni promesa', async () => {
    reserva = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [cotizacion])).rows[0].id
    await rpc(vera, `select public.reservas_fijar_monto($1, 500, 'Reserva acordada con el cliente')`, [reserva])
    await rpc(vera, `select public.reservas_registrar_pagador($1, 'Cliente Prueba A103', $2, 'titular', null)`, [reserva, cedulaPrueba(103103)])
    const archivo = JSON.stringify({ ruta: `reservas/${reserva}/${crypto.randomUUID()}-tr.pdf`, nombre: 'tr.pdf', mime: 'application/pdf', tamano: 1024, hash: 'a'.repeat(64) })
    await rpc(vera, `select public.reservas_reportar_pago($1, 500, $2::date, 'Banco de prueba', 'TRF-A103', $3::jsonb)`, [reserva, hoy, archivo])
    expect(await uno(`select estado, cumplimiento_estado from public.reservations where id = $1`, [reserva])).toEqual({ estado: 'solicitada', cumplimiento_estado: 'pendiente' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.contracts where reservation_id = $1`, [reserva])).n).toBe(0)
  })

  it('Finanzas no acepta el pago sin Cumplimiento; con la aprobación, la reserva queda confirmada', async () => {
    const confirmar = `select public.reservas_confirmar_pago($1, 500, $2::date, 'TRF-A103', true, 'Ingreso verificado en banco')`
    await expect(rpc(finanzas, confirmar, [reserva, hoy])).rejects.toThrow(/Cumplimiento debe aprobar/)
    await rpc(oficial, `select public.reservas_cumplimiento_resolver($1, 'aprobado', null)`, [reserva])
    await rpc(finanzas, confirmar, [reserva, hoy])
    let e = await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [reserva])
    if (e.estado === 'pago_verificado') {
      await rpc(gerente, `select public.reservas_aprobar($1, 'Excepción revisada en la prueba A103')`, [reserva])
      e = await uno<{ estado: string }>(`select estado from public.reservations where id = $1`, [reserva])
    }
    expect(e.estado).toBe('confirmada')
    expect((await uno<{ estado: string }>(`select estado::text from public.inventory_units where codigo = $1`, [unidad])).estado).toBe('reservado')
  })

  it('el contrato genera el cronograma: 500 + 6.683,74 = 6 %; 14 % en cuotas; 80 % = 95.783,20; suma el precio', async () => {
    contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la prueba A103') as id`, [reserva, hoy])).rows[0].id
    const c = await uno<{ reserva: string; firma: string; cuotas: string; saldo: string; total: string; n: number }>(
      `select sum(monto) filter (where numero = 0) as reserva, sum(monto) filter (where concepto like 'Pago a la firma%') as firma,
              sum(monto) filter (where concepto like 'Cuota %') as cuotas, sum(monto) filter (where concepto like 'Saldo contra entrega%') as saldo,
              sum(monto) as total, count(*) filter (where concepto like 'Cuota %')::int as n
         from public.installments where contract_id = $1`, [contrato])
    expect(Number(c.reserva)).toBe(500)
    expect(Number(c.firma)).toBe(6683.74)
    expect(Number(c.cuotas)).toBe(16762.06)
    expect(Number(c.saldo)).toBe(95783.2)
    expect(r2(Number(c.reserva) + Number(c.firma) + Number(c.cuotas))).toBe(23945.8)
    expect(Number(c.total)).toBe(119729)
    expect(c.n).toBeGreaterThan(0)
  })

  it('antes de la firma, ninguna cuota es exigible; la reserva cuenta como primer pago verificado', async () => {
    const s = await uno<{ exigibles: number }>(`select count(*) filter (where exigible)::int as exigibles from public.installment_status where contract_id = $1`, [contrato])
    expect(s.exigibles).toBe(0)
    const p = await uno<{ n: number; monto: string }>(`select count(*)::int as n, sum(monto) as monto from public.payments where contract_id = $1 and estado = 'verificado'`, [contrato])
    expect(p).toMatchObject({ n: 1 })
    expect(Number(p.monto)).toBe(500)
    // Relación que evita contar dos veces la reserva: el pago copiado al contrato lleva el código de su reserva.
    const copia = await uno<{ motivo: string; codigo: string }>(`select p.motivo, r.codigo from public.payments p join public.contracts c on c.id = p.contract_id join public.reservations r on r.id = c.reservation_id where p.contract_id = $1`, [contrato])
    expect(copia.motivo).toBe(`Reserva ${copia.codigo}`)
  })

  it('promesa: Legal guarda el borrador de plantilla, pero no se emite hasta que la apruebe', async () => {
    const cuerpo = fs.readFileSync(path.resolve(__dirname, '../plantillas/promesa_compraventa_AMURA_borrador.txt'), 'utf8')
    const { variables } = etiquetasDeTexto(cuerpo)
    const claves = [...new Set([...variables, ...VARIABLES_FIRMAS])]
    const vars = claves.map((k) => ({ clave: k, etiqueta: k, origen: k.includes('.') ? 'catalogo' : 'manual', obligatorio: k.includes('.') }))
    const plantilla = (await rpc<{ id: string }>(legal, `select public.contratos_plantilla_guardar(null, $2::uuid, $1::jsonb, 'Borrador para revisión jurídica') as id`, [JSON.stringify({
      nombre: 'Promesa AMURA (borrador)', tipo_documento: 'promesa_compraventa', tipo_operacion: 'general', formato: 'texto', cuerpo, variables: vars,
    }), crypto.randomUUID()])).rows[0].id
    expect((await uno<{ estado: string }>(`select estado from public.contract_templates where id = $1`, [plantilla])).estado).toBe('borrador')
    await expect(rpc(legal, `select public.contratos_documento_registrar($1, $2, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'Intento de emisión')`, [contrato, plantilla]))
      .rejects.toThrow(/no está aprobada por Legal/)
  })
})
