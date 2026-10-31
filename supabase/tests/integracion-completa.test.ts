// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cargarVentas } from '../../src/features/ventas/remoto'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, vera: string, nuevo: string
const hoy = hoyGuayaquil()
const CODIGO = 'E1-P3-A2'

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const unidad = () => uno<{ estado: string }>(`select estado from public.inventory_units where codigo = $1`, [CODIGO]).then((x) => x.estado)
interface Tramo { id: string; estado: string; cumple: boolean; monto: number }
interface Comision { contrato: string; estado: string; corredor: string | null; porcentaje: number; monto_total: number; tramos: Tramo[] }
const comision = async (u: string, codigo: string) =>
  (await rpc<{ j: { comisiones: Comision[] } }>(u, `select public.comisiones_listar() as j`)).j.comisiones.find((c) => c.contrato === codigo)
const corredorFila = async (u: string, id: string) =>
  (await rpc<{ j: { id: string; clientes: number; ventas: number; acceso: string | null }[] }>(u, `select public.corredores_listar() as j`)).j.find((c) => c.id === id)

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Andrés Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gabriela Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  nuevo = await crearUsuario(db, 'Nora Corredora', 'corredor')
  // Las cuentas nacen sin perfil comercial; se vinculan o se crea al registrar su primer cliente.
  await db.query(`delete from public.corredores`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('AMURA de principio a fin, con cada rol y sin atajos', () => {
  let corredor: string, cliente: string, op: string, cot: string, reserva: string, contrato: string, codigoContrato: string, precio: number

  it('Inventario: gerencia valida la disponibilidad; administración cambia el precio y queda oficial', async () => {
    await expect(rpc(vera, `select public.inventario_cambiar_estado($1, 'disponible', 'Intento de vendedora')`, [CODIGO])).rejects.toThrow(/Sin permiso/)
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'disponible', 'Disponibilidad validada')`, [CODIGO])
    await rpc(admin, `select public.inventario_ajustar_precio('fijar', 2300, 'Precio aprobado por administración', array[$1])`, [CODIGO])
    expect(await unidad()).toBe('disponible')
    expect(Number((await uno<{ usd_m2: string }>(`select usd_m2 from public.inventory_units where codigo = $1`, [CODIGO])).usd_m2)).toBe(2300)
  })

  it('Corredores: gerencia crea el perfil sin cuenta ni invitación', async () => {
    corredor = (await rpc<{ id: string }>(gerente, `select public.corredores_crear($1::jsonb, 'Alta de aliado comercial') as id`, [JSON.stringify({ nombre: 'Aliado Inmobiliario', licencia: 'LIC-1' })])).id
    expect(await corredorFila(gerente, corredor)).toMatchObject({ clientes: 0, ventas: 0, acceso: null })
  })

  it('Clientes: se registra con su corredor de origen y la vendedora como asesora', async () => {
    cliente = (await rpc<{ id: string }>(gerente, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Compradora Real', telefono: '0991112000', origen: 'corredor', origen_detalle: 'Aliado Inmobiliario', corredor_origen_id: corredor }), vera])).id
    expect((await corredorFila(gerente, corredor))?.clientes).toBe(1)
    expect(await como(db, vera, async () => (await db.query(`select 1 from public.clients where id = $1`, [cliente])).rows.length)).toBe(1)
  })

  it('Cotizaciones: la vendedora cotiza con el precio de Inventario y el cliente acepta', async () => {
    op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, CODIGO])).id
    cot = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(vera, `select public.cotizaciones_aceptar($1, 'Cliente acepta la cotización')`, [cot])
    const q = await uno<{ precio_final: string; plan: { reserva: number; cuotasTotal: number; contraEntrega: number } }>(`select precio_final, plan from public.quotes where id = $1`, [cot])
    precio = Number(q.precio_final)
    expect(precio).toBe(Math.round(2300 * 72.53))
    expect(q.plan.reserva + q.plan.cuotasTotal + q.plan.contraEntrega).toBeCloseTo(precio, 2)
  })

  it('Reservas: USD 500 por defecto, editable; Finanzas verifica, Gerencia aprueba y la unidad queda reservada', async () => {
    reserva = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [cot])).id
    expect(Number((await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [reserva])).monto_reserva)).toBe(500)
    await expect(rpc(vera, `select public.reservas_fijar_monto($1, $2, 'Por encima del seis por ciento')`, [reserva, precio])).rejects.toThrow(/no superar el 6/)
    await rpc(vera, `select public.reservas_fijar_monto($1, 600, 'Acordado con la clienta')`, [reserva])
    await rpc(vera, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-600', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva])
    expect(await unidad()).toBe('disponible')
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 600, $2::date, 'BAN-600', true, 'Ingreso confirmado')`, [reserva, hoy])
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [reserva])
    expect(await unidad()).toBe('reservado')
    expect((await uno<{ etapa: string }>(`select etapa from public.clients where id = $1`, [cliente])).etapa).toBe('reserva')
    await expect(rpc(admin, `select public.inventario_ajustar_precio('fijar', 2500, 'Precio con reserva vigente', array[$1])`, [CODIGO])).rejects.toThrow()
  })

  it('Ventas: el contrato imputa la reserva al 6 %; al firmar, unidad prometida y comisión con porcentaje fijado', async () => {
    contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [reserva, hoy])).id
    codigoContrato = (await uno<{ codigo: string }>(`select codigo from public.contracts where id = $1`, [contrato])).codigo
    const cuotas = (await db.query<{ numero: number; monto: number; concepto: string }>(`select numero, monto::float as monto, concepto from public.installments where contract_id = $1 order by numero`, [contrato])).rows
    const sum = (f: (c: { concepto: string }) => boolean) => Math.round(cuotas.filter(f).reduce((t, c) => t + c.monto, 0) * 100) / 100
    expect(cuotas[0]).toMatchObject({ concepto: 'Reserva (se acredita al 6%)', monto: 600 })
    expect(sum((c) => /Reserva|firma/.test(c.concepto))).toBe(Math.round(precio * 6) / 100)
    expect(sum((c) => /^Cuota/.test(c.concepto))).toBe(Math.round(precio * 14) / 100)
    expect(sum((c) => /Saldo/.test(c.concepto))).toBe(Math.round(precio * 80) / 100)
    expect((await comision(gerente, codigoContrato))?.estado).toBe('calculada')

    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contrato.pdf')`, [contrato, hoy])
    expect(await unidad()).toBe('promesa')
    const c = (await comision(gerente, codigoContrato))!
    expect(c).toMatchObject({ estado: 'vigente', corredor: 'Aliado Inmobiliario', porcentaje: 2.6 })
    expect(c.monto_total).toBeCloseTo(Math.round(precio * 2.6) / 100, 2)
    expect((await corredorFila(gerente, corredor))?.ventas).toBe(1)
    // Ventas muestra al corredor comercial por su nombre.
    const v = (await cargarVentas(datosPglite(db, gerente))).ventas.find((x) => x.id === contrato)!
    expect(v).toMatchObject({ corredorOrigen: 'Aliado Inmobiliario', asesor: 'Vera Vendedora' })
  })

  it('Cobranzas: un pago sin verificar no cuenta; verificado, alimenta las condiciones de Comisiones', async () => {
    const t = () => comision(gerente, codigoContrato).then((c) => c!.tramos[0])
    const id1 = (await t()).id
    await rpc(finanzas, `select public.comisiones_registrar_honorario($1, 500, $2::date, 'FACT-1')`, [id1, hoy])
    expect((await t()).cumple).toBe(false)
    const falta = Math.round((precio * 0.1 - 600) * 100) / 100
    const p = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', 'PAGO-10', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [contrato, falta, hoy])).id
    expect((await t()).cumple).toBe(false)
    await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [p])
    expect((await t()).cumple).toBe(true)
  })

  it('Comisiones: sin política no se liquida; con aprobación, habilita Gerencia y confirma Finanzas', async () => {
    const id1 = (await comision(gerente, codigoContrato))!.tramos[0].id
    await expect(rpc(gerente, `select public.comisiones_habilitar($1, 'Sin política aprobada')`, [id1])).rejects.toThrow(/aprobación formal/)
    await rpc(admin, `select public.comisiones_aprobar_politica('Acta de Dirección', 'Dirección aprobó la política')`)
    await rpc(gerente, `select public.comisiones_habilitar($1, 'Conciliado con Administración')`, [id1])
    await rpc(finanzas, `select public.comisiones_confirmar_pago($1, $2::date, 'Aliado Inmobiliario', 'TRF-COM-1', true)`, [id1, hoy])
    expect((await comision(gerente, codigoContrato))!.tramos.map((t) => t.estado)).toEqual(['pagada', 'pendiente'])
  })

  it('Escritura: la unidad queda vendida y el segundo tramo cumple su hito', async () => {
    await rpc(legal, `select public.contratos_registrar_hito($1, 'escritura', $2::date, 'NOT-1', 'Escritura inscrita')`, [contrato, hoy])
    expect(await unidad()).toBe('vendido')
    const id2 = (await comision(gerente, codigoContrato))!.tramos[1].id
    await rpc(finanzas, `select public.comisiones_registrar_honorario($1, 500, $2::date, 'FACT-2')`, [id2, hoy])
    expect((await comision(gerente, codigoContrato))!.tramos[1].cumple).toBe(true)
  })

  it('El corredor con cuenta vinculada ve su comisión, aunque su perfil tenga otro identificador', async () => {
    expect(await comision(nuevo, codigoContrato)).toBeUndefined()
    await rpc(admin, `select public.corredores_vincular_acceso($1, $2, 'Le damos acceso a la aplicación')`, [corredor, nuevo])
    const propia = (await comision(nuevo, codigoContrato))!
    expect(propia.tramos[0].estado).toBe('pagada')
    expect(propia.corredor).toBe('Aliado Inmobiliario')
  })

  it('Un corredor con cuenta y sin perfil lo obtiene al registrar su primer cliente, y queda como origen', async () => {
    const otro = await crearUsuario(db, 'Omar Corredor', 'corredor')
    await db.query(`delete from public.corredores where usuario_id = $1`, [otro])
    const c = (await rpc<{ id: string }>(otro, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Cliente de Omar', telefono: '0991112999', origen: 'corredor', origen_detalle: 'Omar' }), otro])).id
    const f = await uno<{ corredor_origen_id: string; usuario_id: string }>(`select k.corredor_origen_id, r.usuario_id from public.clients k join public.corredores r on r.id = k.corredor_origen_id where k.id = $1`, [c])
    expect(f.usuario_id).toBe(otro)
  })

  it('La forma de pago no se puede cambiar por fuera de la política', async () => {
    await expect(db.query(`update public.pricing_params set reserva_pct = 7 where id = 1`)).rejects.toThrow(/pricing_params_politica_entrada/)
  })
})
