// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { aprobarCumplimiento, cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, cora: string
let n = 990800000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const nuevoCliente = async (u: string, nombre: string) => (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'whatsapp' }), u])).id
const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

async function reservaAprobada(u: string, c: string, codigo: string) {
  const op = (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
  const cot = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(u, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return r
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('comisión base sobre el valor total de la venta', () => {
  it('empieza en 2,60 % y se calcula sobre el precio final de cada venta firmada', async () => {
    expect(await rpc<{ p: string }>(gerente, `select public.comisiones_porcentaje() as p`)).toEqual({ p: '2.60' })
    const c = await nuevoCliente(carlos, 'Venta Base')
    const r = await reservaAprobada(carlos, c, await unidadLibre())
    const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoyGuayaquil()])).id
    const k = await uno<{ id: string; codigo: string; precio: string }>(`select id, codigo, precio from public.contracts where id = $1`, [id])
    await aprobarCumplimiento(db)
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'x.pdf')`, [k.id, hoyGuayaquil()])
    const filas = await rpc<{ j: { contrato: string; monto: number; porcentaje: number }[] }>(gerente, `select public.comisiones_base_listar() as j`)
    const fila = filas.j.find((x) => x.contrato === k.codigo)!
    expect(fila.porcentaje).toBe(2.6)
    expect(fila.monto).toBeCloseTo(Math.round(Number(k.precio) * 0.026 * 100) / 100, 2)
  })

  it('solo Gerencia o administración cambia el porcentaje; queda auditado y se valida', async () => {
    await expect(rpc(carlos, `select public.comisiones_definir_porcentaje(3, 'Intento de corredor')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(finanzas, `select public.comisiones_definir_porcentaje(3, 'Intento de finanzas')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(gerente, `select public.comisiones_definir_porcentaje(150, 'Porcentaje fuera de rango')`)).rejects.toThrow(/entre 0 y 100/)
    await expect(rpc(gerente, `select public.comisiones_definir_porcentaje(3, 'no')`)).rejects.toThrow(/motivo/)
    expect(await rpc(gerente, `select public.comisiones_definir_porcentaje(3.1, 'Ajuste acordado con dirección') as p`)).toEqual({ p: '3.10' })
    expect(await rpc(admin, `select public.comisiones_porcentaje() as p`)).toEqual({ p: '3.10' })
    const a = await uno<{ antes: { porcentaje: string }; despues: { porcentaje: string }; motivo: string }>(`select antes, despues, motivo from public.audit_log where accion = 'Cambiar porcentaje de comisión base'`)
    expect(a).toMatchObject({ antes: { porcentaje: 2.6 }, despues: { porcentaje: 3.1 }, motivo: 'Ajuste acordado con dirección' })
  })

  it('el cambio afecta el monto de referencia, y una venta anulada deja de contar', async () => {
    const c = await nuevoCliente(carlos, 'Venta Anulada')
    const r = await reservaAprobada(carlos, c, await unidadLibre())
    const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato que se anulará') as id`, [r, hoyGuayaquil()])).id
    await aprobarCumplimiento(db)
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'x.pdf')`, [id, hoyGuayaquil()])
    const antes = await rpc<{ j: { contrato: string; porcentaje: number }[] }>(gerente, `select public.comisiones_base_listar() as j`)
    expect(antes.j.some((x) => x.porcentaje === 3.1)).toBe(true)
    await rpc(legal, `select public.contratos_anular($1, 'Cliente desiste de la compra', 'Carta firmada del cliente')`, [id])
    const despues = await rpc<{ j: { contrato: string }[] }>(gerente, `select public.comisiones_base_listar() as j`)
    expect(despues.j.length).toBe(antes.j.length - 1)
  })

  it('un corredor ve solo sus ventas firmadas; el cálculo no crea registros de pago', async () => {
    const otro = await rpc<{ j: unknown[] }>(cora, `select public.comisiones_base_listar() as j`)
    expect(otro.j).toEqual([])
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n
    await rpc(gerente, `select public.comisiones_base_listar()`)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(pagos)
  })
})
