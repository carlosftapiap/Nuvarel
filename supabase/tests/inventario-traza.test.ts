// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cargarInventario } from '../../src/features/inventario/remoto'
import { trazaAjuste } from '../../src/features/inventario/service'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Andrés Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gabriela Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('historial con la base real', () => {
  it('reconoce quién propuso y quién aprobó sin migraciones nuevas, y un ajuste directo queda sin propuesta', async () => {
    const propuesta = await rpc<{ id: string }>(gerente, `select public.precios_proponer('fijar', 2300, 'Ajuste de comité', array['E1-PB-A1'], null, null, null, 'Departamento 1001') as id`)
    await rpc(admin, `select public.precios_resolver_propuesta($1, true, 'Conforme')`, [propuesta.id])
    await rpc(admin, `select public.inventario_ajustar_precio('fijar', 2400, 'Ajuste directo de lista', array['E1-PB-A2'])`)
    const s = await cargarInventario(datosPglite(db, admin))
    const conPropuesta = s.priceHistory.find((h) => h.cambios.some((c) => c.codigo === 'E1-PB-A1'))!
    expect(conPropuesta.cambios[0]).toMatchObject({ antesUsdM2: 2230, despuesUsdM2: 2300 })
    expect(trazaAjuste(conPropuesta, s.propuestas)).toMatchObject({
      propuso: { usuario: 'Gabriela Gerencia' }, aprobo: { usuario: 'Andrés Admin', comentario: 'Conforme' },
    })
    const directo = s.priceHistory.find((h) => h.cambios.some((c) => c.codigo === 'E1-PB-A2'))!
    expect(trazaAjuste(directo, s.propuestas)).toMatchObject({ propuso: null, aprobo: { usuario: 'Andrés Admin' } })
  })
})

describe('imputación de la reserva en el contrato', () => {
  it('con reserva de 500: reserva + firma = 6 %, el cronograma suma el precio y la reserva cuenta una sola vez', async () => {
    const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Reserva Configurable', telefono: '0991000200', origen: 'whatsapp' }), carlos])).id
    const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, 'E2-P1-A1', null) as id`, [c])).id
    const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
    const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
    await rpc(carlos, `select public.reservas_fijar_monto($1, 500, 'Reserva acordada con el cliente')`, [r])
    await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-500', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r])
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 500, $2::date, 'BAN-500', true, 'Ingreso confirmado')`, [r, hoyGuayaquil()])
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
    const k = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoyGuayaquil()])).id

    const { precio } = (await db.query<{ precio: number }>(`select precio::float as precio from public.contracts where id = $1`, [k])).rows[0]
    const cuotas = (await db.query<{ concepto: string; monto: number }>(`select concepto, monto::float as monto from public.installments where contract_id = $1 order by numero`, [k])).rows
    expect(cuotas[0]).toEqual({ concepto: 'Reserva (se acredita al 6%)', monto: 500 })
    expect(cuotas[1].concepto).toBe('Pago a la firma (completa el 6%)')
    expect(Math.round((cuotas[0].monto + cuotas[1].monto) * 100) / 100).toBe(Math.round(precio * 6) / 100)
    expect(Math.round(cuotas.reduce((t, x) => t + x.monto, 0) * 100) / 100).toBe(precio)
    const pagos = (await db.query<{ monto: number }>(`select monto::float as monto from public.payments where contract_id = $1 and estado = 'verificado'`, [k])).rows
    expect(pagos).toEqual([{ monto: 500 }])
  })
})
