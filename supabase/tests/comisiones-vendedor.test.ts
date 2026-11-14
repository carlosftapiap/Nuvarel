// @vitest-environment node
// Comisión del vendedor (propuesta pendiente de formalización contractual): 2,60 % del precio total a nombre del responsable
// comercial de la venta; lista para pago con promesa firmada y 6 % verificado; Finanzas confirma con comprobante; pagos bloqueados
// hasta resolver el beneficiario contractual. Incluye la convivencia con el esquema anterior, la reversión y la independencia de Clientes.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { aprobarCumplimiento, cedulaPrueba, celularPrueba, como, crearDb, crearUsuario, GRANTS_SUPABASE } from './db'

const MIGRACIONES = path.resolve(__dirname, '..', 'migrations')
const NUEVA = '20261122000000_comisiones_vendedor.sql'
const REVERSION = path.resolve(__dirname, '..', 'sql_produccion', 'reversion', '0012_revertir_comisiones_vendedor.sql')

/** Estado de producción medido el 2026-11-13 (solo lectura): una versión VELKROVA quedó aplicada en parte. */
const ESTADO_PRODUCCION = `
alter table public.comision_parametros add column if not exists esquema text not null default 'velkrova';
alter table public.comision_parametros add column if not exists beneficiario text not null default 'VELKROVA';
alter table public.comision_parametros add column if not exists umbral_pago_pct numeric(5,2) not null default 6.00;
alter table public.comision_parametros add column if not exists iva_pct numeric(5,2) not null default 15.00;
alter table public.comision_parametros add column if not exists dias_habiles_pago smallint not null default 5;
alter table public.comision_parametros add constraint comision_parametros_velkrova_ck check (esquema in ('velkrova', 'dos_tramos') and umbral_pago_pct > 0 and umbral_pago_pct <= 100 and iva_pct >= 0 and iva_pct <= 100 and dias_habiles_pago between 0 and 60);
alter table public.comisiones add column if not exists esquema text;
alter table public.comisiones add column if not exists beneficiario text;
alter table public.comisiones add column if not exists umbral_pago_pct numeric(5,2);
update public.comisiones set esquema = 'dos_tramos' where esquema is null;
alter table public.comisiones alter column esquema set not null;
alter table public.comisiones alter column esquema set default 'dos_tramos';
alter table public.comisiones add constraint comisiones_esquema_ck check (esquema in ('velkrova', 'dos_tramos'));
`

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, vera: string, sara: string, carlos: string
let n = 991200000
let anterior: { id: string; codigo: string; precio: number }

interface TramoJ { id: string; numero: number; porcentaje: number; monto: number; estado: string; cumple: boolean; lista_para_pago: boolean; condiciones: { texto: string; ok: boolean }[]; pago: { beneficiario: string | null; referencia: string | null } | null }
interface ComisionJ { id: string; contrato: string; estado: string; esquema: string; beneficiario: string | null; beneficiario_id: string | null; umbral_pago_pct: number | null; porcentaje: number; monto_total: number; tramos: TramoJ[] }

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const hoy = () => hoyGuayaquil()
const listar = async (u: string) => (await rpc<{ j: { comisiones: ComisionJ[]; parametros: Record<string, unknown> } }>(u, `select public.comisiones_listar() as j`)).j
const comisionDe = async (u: string, codigo: string) => (await listar(u)).comisiones.find((c) => c.contrato === codigo)!
const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

/** Venta por el flujo real, hecha por el vendedor indicado, sin firmar. */
async function contratoBorrador(vendedor: string, nombre: string, origen: Record<string, string> = { origen: 'instagram' }) {
  const c = (await rpc<{ id: string }>(vendedor, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), ...origen }), vendedor])).id
  const op = (await rpc<{ id: string }>(vendedor, `select public.oportunidades_crear($1, $2, null) as id`, [c, await unidadLibre()])).id
  const cot = (await rpc<{ id: string }>(vendedor, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(vendedor, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(vendedor, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(vendedor, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoy(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoy()])).id
  const k = await uno<{ codigo: string; precio: string }>(`select codigo, precio from public.contracts where id = $1`, [id])
  return { id, codigo: k.codigo, precio: Number(k.precio), cliente: c }
}
const firmar = async (id: string) => { await aprobarCumplimiento(db); return rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contrato.pdf')`, [id, hoy()]) }
async function ventaFirmada(vendedor: string, nombre: string) {
  const v = await contratoBorrador(vendedor, nombre)
  await firmar(v.id)
  return v
}
const pagado = async (id: string) => Number((await uno<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.payments where contract_id = $1 and estado = 'verificado'`, [id])).t)
/** Lleva lo pagado y verificado en Cobranzas hasta el porcentaje pedido (en centavos exactos). */
async function pagarHasta(v: { id: string; precio: number }, pct: number) {
  const falta = Math.round((v.precio * pct / 100 - await pagado(v.id)) * 100) / 100
  if (falta <= 0) return
  const p = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', $4, jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [v.id, falta, hoy(), `PAGO-${v.id.slice(0, 6)}-${++n}`])).id
  await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [p])
}
const pagar = (u: string, t: string, comprobante = 'TRF-777') => rpc(u, `select public.comisiones_confirmar_pago($1, $2::date, 'Otra persona', $3, true)`, [t, hoy(), comprobante])
/** Lo que haría una migración autorizada tras formalizar el beneficiario contractual. Solo en pruebas. */
const formalizar = (si: boolean) => db.query(`update public.comision_parametros set pagos_vendedor_habilitados = $1`, [si])

beforeAll(async () => {
  // Base como producción antes de esta migración, con una venta firmada en el esquema anterior.
  db = await crearDb({ hasta: '20261121000000_supervisor_vende.sql' })
  await db.exec(ESTADO_PRODUCCION)
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  sara = await crearUsuario(db, 'Sara Supervisora', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sara])
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor', { equipo: equipo.id })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  anterior = await ventaFirmada(vera, 'Venta anterior')
  // Aplica esta migración y las siguientes.
  for (const m of fs.readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql') && f >= NUEVA).sort()) await db.exec(fs.readFileSync(path.join(MIGRACIONES, m), 'utf8'))
  await db.exec(GRANTS_SUPABASE)
  await rpc(admin, `select public.comisiones_aprobar_politica('Política de comisiones (propuesta)', 'Aprobación general de la política')`)
}, 120_000)

describe('registros existentes', () => {
  it('convierte el estado que dejó la versión VELKROVA aplicada en producción', async () => {
    expect(await uno(`select esquema, pagos_vendedor_habilitados from public.comision_parametros where id = 1`)).toEqual({ esquema: 'vendedor', pagos_vendedor_habilitados: false })
    expect(await uno(`select count(*)::int as n from public.comisiones where esquema = 'velkrova'`)).toEqual({ n: 0 })
  })

  it('la comisión firmada antes de la migración conserva sus dos tramos y sus condiciones', async () => {
    const c = await comisionDe(gerente, anterior.codigo)
    expect(c).toMatchObject({ esquema: 'dos_tramos', beneficiario: null, umbral_pago_pct: null, porcentaje: 2.6 })
    expect(c.tramos.map((t) => [t.numero, t.porcentaje, t.estado])).toEqual([[1, 50, 'pendiente'], [2, 50, 'pendiente']])
    expect(c.tramos[0].condiciones.map((x) => x.texto)).toContain('Honorario recibido por Jarva')
  })
})

describe('comisión del vendedor', () => {
  it('una venta nueva genera una sola comisión del 2,60 % del precio total, a nombre del vendedor responsable', async () => {
    const v = await contratoBorrador(vera, 'Nueva calculada')
    const c = await comisionDe(gerente, v.codigo)
    expect(c).toMatchObject({ esquema: 'vendedor', beneficiario: 'Vera Vendedora', beneficiario_id: vera, umbral_pago_pct: 6, porcentaje: 2.6, estado: 'calculada' })
    expect(c.tramos.map((t) => [t.numero, t.porcentaje, t.estado])).toEqual([[1, 100, 'calculada']])
    expect(c.monto_total).toBeCloseTo(Math.round(v.precio * 2.6) / 100, 2)
    expect(c.tramos[0].monto).toBe(c.monto_total)
    await pagarHasta(v, 6)
    // Sin promesa firmada no está lista, aunque tenga el 6 %.
    expect((await comisionDe(gerente, v.codigo)).tramos[0]).toMatchObject({ cumple: false, lista_para_pago: false })
    await firmar(v.id)
    expect((await comisionDe(gerente, v.codigo)).tramos[0]).toMatchObject({ estado: 'pendiente', cumple: true, lista_para_pago: true })
  })

  it('queda lista para pago con la promesa firmada y el 6 % verificado: no con 5,99 %, sin escritura, desembolso ni honorario', async () => {
    const v = await ventaFirmada(vera, 'Devengo')
    await pagarHasta(v, 5.99)
    let t = (await comisionDe(gerente, v.codigo)).tramos[0]
    expect(t).toMatchObject({ cumple: false, lista_para_pago: false })
    expect(t.condiciones.map((x) => x.texto)).toEqual(['Promesa de compraventa firmada', 'Pagos verificados por Finanzas de al menos 6 % del precio (5.99 % recibido)'])
    await pagarHasta(v, 6)
    t = (await comisionDe(gerente, v.codigo)).tramos[0]
    expect(t).toMatchObject({ cumple: true, lista_para_pago: true })
    expect(t.condiciones.some((x) => /escritura|desembolso|honorario/i.test(x.texto))).toBe(false)
    await expect(rpc(finanzas, `select public.comisiones_registrar_honorario($1, 100, $2::date, 'FACT-001')`, [t.id, hoy()])).rejects.toThrow(/no usa honorario/)
    await expect(rpc(gerente, `select public.comisiones_habilitar($1, 'Conciliado')`, [t.id])).rejects.toThrow(/no se habilita a mano/)
  })

  it('un pago registrado pero sin verificar por Finanzas no cuenta para el 6 %', async () => {
    const v = await ventaFirmada(vera, 'Sin verificar')
    const falta = Math.round((v.precio * 0.06 - await pagado(v.id)) * 100) / 100
    await rpc(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', 'PAGO-SV', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [v.id, falta, hoy()])
    expect((await comisionDe(gerente, v.codigo)).tramos[0].lista_para_pago).toBe(false)
  })

  it('el supervisor que vende es el beneficiario; con un corredor, el beneficiario es el responsable formal y no se duplica', async () => {
    const s = await contratoBorrador(sara, 'Venta de la supervisora')
    expect(await comisionDe(gerente, s.codigo)).toMatchObject({ beneficiario: 'Sara Supervisora', beneficiario_id: sara })
    const k = await contratoBorrador(carlos, 'Venta con corredor', { origen: 'corredor', origen_detalle: 'Carlos Corredor' })
    const responsable = (await uno<{ r: string }>(`select responsable_id as r from public.contracts where id = $1`, [k.id])).r
    expect((await comisionDe(gerente, k.codigo)).beneficiario_id).toBe(responsable)
    expect(await uno(`select count(*)::int as n from public.comisiones where contract_id = $1`, [k.id])).toEqual({ n: 1 })
  })

  it('beneficiario y porcentaje quedan fijos al formalizar: reasignar al cliente o cambiar el porcentaje no los mueve', async () => {
    const v = await ventaFirmada(vera, 'Fija')
    const version = (await uno<{ version: number }>(`select version from public.clients where id = $1`, [v.cliente])).version
    await rpc(admin, `select public.clientes_asignar($1, $2, $3, 'Reasignación posterior a la venta', false)`, [v.cliente, version, sara])
    await rpc(gerente, `select public.comisiones_definir_porcentaje(3, 'Cambio de política para ventas futuras')`)
    expect(await comisionDe(gerente, v.codigo)).toMatchObject({ beneficiario: 'Vera Vendedora', porcentaje: 2.6 })
    await rpc(gerente, `select public.comisiones_definir_porcentaje(2.6, 'Vuelve el porcentaje vigente')`)
    await expect(db.query(`update public.comisiones set beneficiario_id = $1 where contract_id = $2`, [sara, v.id])).rejects.toThrow(/beneficiario de una venta firmada no se modifican/)
  })

  it('pagos bloqueados mientras no se formalice el beneficiario contractual, aunque la política esté aprobada', async () => {
    const v = await ventaFirmada(vera, 'Bloqueada')
    await pagarHasta(v, 6)
    const t = (await comisionDe(finanzas, v.codigo)).tramos[0]
    expect(t.lista_para_pago).toBe(true)
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/pendiente de formalización contractual/)
    expect((await comisionDe(finanzas, v.codigo)).tramos[0].estado).toBe('pendiente')
    expect((await listar(finanzas)).parametros).toMatchObject({ pagos_vendedor_habilitados: false })
  })

  it('con la formalización: Finanzas confirma con comprobante, a nombre del vendedor; nadie se paga a sí mismo', async () => {
    await formalizar(true)
    try {
      const v = await ventaFirmada(vera, 'Pagada')
      await pagarHasta(v, 6)
      const t = (await comisionDe(finanzas, v.codigo)).tramos[0]
      await expect(pagar(vera, t.id)).rejects.toThrow(/Sin permiso/)
      await expect(pagar(finanzas, t.id, '')).rejects.toThrow(/comprobante/)
      await pagar(finanzas, t.id, 'TRF-2026-0001')
      const c = await comisionDe(finanzas, v.codigo)
      expect(c.tramos[0]).toMatchObject({ estado: 'pagada', lista_para_pago: false })
      expect(c.tramos[0].pago).toMatchObject({ beneficiario: 'Vera Vendedora', referencia: 'TRF-2026-0001' })
      await expect(pagar(finanzas, t.id)).rejects.toThrow(/ya está pagado/)
      const a = await uno<{ despues: Record<string, unknown> }>(`select despues from public.audit_log where accion = 'Confirmar pago de comisión' order by fecha desc limit 1`)
      expect(a.despues).toMatchObject({ estado: 'pagada', beneficiario: 'Vera Vendedora', beneficiario_id: vera })
      // El vendedor ve su comisión pagada, sin la referencia bancaria.
      expect((await comisionDe(vera, v.codigo)).tramos[0]).toMatchObject({ estado: 'pagada', pago: { beneficiario: null, referencia: null } })

      // El administrador que vende no confirma su propia comisión.
      const propia = await ventaFirmada(admin, 'Venta del administrador')
      await pagarHasta(propia, 6)
      const tp = (await comisionDe(admin, propia.codigo)).tramos[0]
      await expect(pagar(admin, tp.id)).rejects.toThrow(/su propia comisión/)
    } finally {
      await formalizar(false)
    }
  })

  it('si Cobranzas anula un pago y baja del 6 %, deja de estar lista y no se puede pagar', async () => {
    await formalizar(true)
    try {
      const v = await ventaFirmada(vera, 'Reverso de cobro')
      await pagarHasta(v, 6)
      const t = (await comisionDe(gerente, v.codigo)).tramos[0]
      const cobro = (await uno<{ id: string }>(`select id from public.payments where contract_id = $1 and referencia like 'PAGO-%' and estado = 'verificado' limit 1`, [v.id])).id
      await rpc(finanzas, `select public.cobranzas_anular_pago($1, 'Transferencia devuelta por el banco')`, [cobro])
      expect((await comisionDe(gerente, v.codigo)).tramos[0]).toMatchObject({ cumple: false, lista_para_pago: false })
      await expect(pagar(finanzas, t.id)).rejects.toThrow(/dejó de cumplir/)
    } finally {
      await formalizar(false)
    }
  })
})

describe('captación de clientes', () => {
  it('registrar y reasignar un cliente no genera comisión: solo una venta con contrato', async () => {
    const antes = (await uno<{ n: number }>(`select count(*)::int as n from public.comisiones`)).n
    const c = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Lead de Instagram', telefono: celularPrueba(++n), origen: 'instagram' }), vera])).id
    const version = (await uno<{ version: number }>(`select version from public.clients where id = $1`, [c])).version
    await rpc(admin, `select public.clientes_asignar($1, $2, $3, 'Distribución de prueba', false)`, [c, version, sara])
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comisiones`)).n).toBe(antes)
  })
})

describe('reversión', () => {
  it('restaura el esquema anterior sin borrar datos: lo nuevo vuelve a dos tramos y lo ya creado se conserva', async () => {
    const antes = (await uno<{ n: number }>(`select count(*)::int as n from public.comisiones where esquema = 'vendedor'`)).n
    await db.exec(fs.readFileSync(REVERSION, 'utf8'))
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comisiones where esquema = 'vendedor'`)).n).toBe(antes)
    const v = await contratoBorrador(vera, 'Después de revertir')
    const c = await uno<{ esquema: string; n: number }>(`select m.esquema, (select count(*)::int from public.comision_tramos t where t.comision_id = m.id) as n from public.comisiones m where m.contract_id = $1`, [v.id])
    expect(c).toEqual({ esquema: 'dos_tramos', n: 2 })
    expect((await comisionDe(gerente, v.codigo)).contrato).toBe(v.codigo)
  })
})
