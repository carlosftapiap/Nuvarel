// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { aprobarCumplimiento, cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, cora: string
let n = 990900000

interface TramoJ { id: string; numero: number; monto: number; estado: string; cumple: boolean; condiciones: { texto: string; ok: boolean }[]; honorario: unknown; pago: { beneficiario: string | null; referencia: string | null } | null }
interface ComisionJ { id: string; contrato: string; estado: string; porcentaje: number; monto_total: number; ajustes: number; por_recuperar: number; tramos: TramoJ[]; movimientos: { id: string; tipo: string; monto: number; revertido_en: string | null }[] }

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const hoy = () => hoyGuayaquil()
const listar = async (u: string) => (await rpc<{ j: { comisiones: ComisionJ[]; politica: { aprobada: boolean } } }>(u, `select public.comisiones_listar() as j`)).j
const comisionDe = async (u: string, codigo: string) => (await listar(u)).comisiones.find((c) => c.contrato === codigo)
const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

/** Venta por el flujo real, sin firmar. El ingreso de la reserva queda como primer pago verificado. */
async function contratoBorrador(nombre: string) {
  const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'corredor', origen_detalle: 'Carlos Corredor' }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [c, await unidadLibre()])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoy(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoy()])).id
  const k = await uno<{ codigo: string; precio: string }>(`select codigo, precio from public.contracts where id = $1`, [id])
  return { id, codigo: k.codigo, precio: Number(k.precio), cliente: c, reserva: r }
}
const firmar = async (id: string) => { await aprobarCumplimiento(db); return rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contrato.pdf')`, [id, hoy()]) }
async function ventaFirmada(nombre: string) {
  const v = await contratoBorrador(nombre)
  await firmar(v.id)
  return v
}
/** Lleva lo pagado y verificado en Cobranzas hasta el porcentaje pedido. */
async function pagarHasta(v: { id: string; precio: number }, pct: number) {
  const { rows } = await db.query<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.payments where contract_id = $1 and estado = 'verificado'`, [v.id])
  const falta = Math.round((v.precio * pct / 100 - Number(rows[0].t)) * 100) / 100
  if (falta <= 0) return
  const p = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', $4, jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [v.id, falta, hoy(), `PAGO-${v.id.slice(0, 6)}-${++n}`])).id
  await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [p])
  return p
}
const honorario = (t: string) => rpc(finanzas, `select public.comisiones_registrar_honorario($1, 100, $2::date, 'FACT-001')`, [t, hoy()])
const habilitar = (u: string, t: string) => rpc(u, `select public.comisiones_habilitar($1, 'Conciliado con Administración')`, [t])
const pagar = (u: string, t: string, confirmo = true) => rpc(u, `select public.comisiones_confirmar_pago($1, $2::date, 'Carlos Corredor', 'TRF-555', $3)`, [t, hoy(), confirmo])
const aprobarPolitica = () => rpc(admin, `select public.comisiones_aprobar_politica('Acta de Dirección 12', 'Dirección aprobó la política')`)

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  // Esquema anterior de dos tramos: sigue vigente para las comisiones creadas antes de la comisión del vendedor.
  await db.query(`update public.comision_parametros set esquema = 'dos_tramos'`)
}, 60_000)

describe('cálculo y porcentaje histórico', () => {
  it('al generar el contrato queda calculada; al firmar pasa a pendiente, sin pagos automáticos', async () => {
    const v = await contratoBorrador('Calculada')
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.comision_movimientos`)).n
    const c = (await comisionDe(gerente, v.codigo))!
    expect(c.estado).toBe('calculada')
    expect(c.tramos.map((t) => t.estado)).toEqual(['calculada', 'calculada'])
    await firmar(v.id)
    const f = (await comisionDe(gerente, v.codigo))!
    expect(f.estado).toBe('vigente')
    expect(f.tramos.map((t) => t.estado)).toEqual(['pendiente', 'pendiente'])
    expect(f.monto_total).toBeCloseTo(Math.round(v.precio * 2.6) / 100, 2)
    expect(f.tramos[0].monto + f.tramos[1].monto).toBeCloseTo(f.monto_total, 2)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comision_movimientos`)).n).toBe(pagos)
  })

  it('el porcentaje se fija al firmar: cambiarlo luego solo afecta a lo no firmado', async () => {
    const firmada = await ventaFirmada('Firmada Antes')
    const borrador = await contratoBorrador('Borrador Antes')
    await rpc(gerente, `select public.comisiones_definir_porcentaje(3, 'Cambio acordado con dirección')`)
    expect((await comisionDe(gerente, firmada.codigo))!.porcentaje).toBe(2.6)
    await firmar(borrador.id)
    const b = (await comisionDe(gerente, borrador.codigo))!
    expect(b.porcentaje).toBe(3)
    expect(b.monto_total).toBeCloseTo(Math.round(borrador.precio * 3) / 100, 2)
    await rpc(gerente, `select public.comisiones_definir_porcentaje(2.6, 'Regreso al porcentaje base')`)
    expect((await comisionDe(gerente, borrador.codigo))!.porcentaje).toBe(3)
  })

  it('nada cambia el porcentaje de una venta firmada, ni se borra el historial, ni hay dos comisiones por contrato', async () => {
    const v = await ventaFirmada('Protegida')
    await expect(db.query(`update public.comisiones set porcentaje = 9 where contract_id = $1`, [v.id])).rejects.toThrow(/no se modifican/)
    await expect(db.query(`delete from public.comisiones where contract_id = $1`, [v.id])).rejects.toThrow(/no se borra/)
    await expect(db.query(`insert into public.comisiones (contract_id, precio_base, porcentaje, monto_total) values ($1, 1, 1, 1)`, [v.id])).rejects.toThrow(/duplicate key|unique/)
    await db.query(`select public.comision_sincronizar($1, 999, true)`, [v.id])
    expect(Number((await uno<{ precio_base: string }>(`select precio_base from public.comisiones where contract_id = $1`, [v.id])).precio_base)).toBe(v.precio)
  })
})

describe('condiciones conectadas con Contratos y Cobranzas', () => {
  it('tramo 1: exige 10 % verificado y honorario; un pago sin verificar no cuenta', async () => {
    const v = await ventaFirmada('Tramo Uno')
    await db.query(`update public.payments set monto = 1 where contract_id = $1`, [v.id])
    let t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    expect(t.condiciones.map((c) => c.ok)).toEqual([true, false, false])
    expect(t.cumple).toBe(false)
    const parcial = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', 'PARCIAL-5', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [v.id, Math.round(v.precio * 0.05 * 100) / 100, hoy()])).id
    await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [parcial])
    await honorario(t.id)
    t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    expect(t.condiciones[1].ok).toBe(false)
    expect(t.cumple).toBe(false)
    await rpc(finanzas, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', 'SIN-VERIF', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [v.id, v.precio, hoy()])
    t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    expect(t.condiciones[1].ok).toBe(false)
    await pagarHasta(v, 10)
    t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    expect(t.condiciones.map((c) => c.ok)).toEqual([true, true, true])
    expect(t.cumple).toBe(true)
  })

  it('tramo 2: exige escritura o desembolso; revertir el hito deja de cumplirlo', async () => {
    const v = await ventaFirmada('Tramo Dos')
    const t = (await comisionDe(gerente, v.codigo))!.tramos[1]
    await honorario(t.id)
    expect((await comisionDe(gerente, v.codigo))!.tramos[1].cumple).toBe(false)
    const h = (await rpc<{ id: string }>(legal, `select public.contratos_registrar_hito($1, 'desembolso', $2::date, 'BAN-1', 'Banco desembolsó') as id`, [v.id, hoy()])).id
    expect((await comisionDe(gerente, v.codigo))!.tramos[1].cumple).toBe(true)
    await rpc(legal, `select public.contratos_revertir_hito($1, 'Registrado por error')`, [h])
    expect((await comisionDe(gerente, v.codigo))!.tramos[1].cumple).toBe(false)
  })
})

describe('política, habilitación y pago', () => {
  it('sin política aprobada no se habilita, aunque cumpla las condiciones', async () => {
    const v = await ventaFirmada('Sin Política')
    await pagarHasta(v, 10)
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await honorario(t.id)
    expect((await listar(gerente)).politica.aprobada).toBe(false)
    await expect(habilitar(admin, t.id)).rejects.toThrow(/aprobación formal/)
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/no está habilitado/)
    expect((await comisionDe(gerente, v.codigo))!.tramos[0].estado).toBe('pendiente')
  })

  it('solo administración o Gerencia aprueba la política, con respaldo', async () => {
    await expect(rpc(finanzas, `select public.comisiones_aprobar_politica('Acta', 'Intento de Finanzas')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(carlos, `select public.comisiones_aprobar_politica('Acta', 'Intento del corredor')`)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(admin, `select public.comisiones_aprobar_politica('', 'Sin documento alguno')`)).rejects.toThrow(/documento/)
    await aprobarPolitica()
    expect((await listar(gerente)).politica.aprobada).toBe(true)
  })

  it('flujo completo con controles: habilita uno, confirma otro, no se paga dos veces, y el reverso deja historia', async () => {
    const v = await ventaFirmada('Flujo Completo')
    await pagarHasta(v, 10)
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await expect(habilitar(admin, t.id)).rejects.toThrow(/no cumple/)
    await expect(rpc(carlos, `select public.comisiones_registrar_honorario($1, 1, $2::date, 'XXX')`, [t.id, hoy()])).rejects.toThrow(/Sin permiso/)
    await honorario(t.id)
    await expect(habilitar(finanzas, t.id)).rejects.toThrow(/Sin permiso/)
    await habilitar(admin, t.id)
    expect((await comisionDe(gerente, v.codigo))!.tramos[0].estado).toBe('habilitada')

    await expect(pagar(carlos, t.id)).rejects.toThrow(/Sin permiso/)
    await expect(pagar(admin, t.id)).rejects.toThrow(/Quien habilitó/)
    await expect(pagar(finanzas, t.id, false)).rejects.toThrow(/Confirma/)
    await pagar(finanzas, t.id)
    const pagada = (await comisionDe(finanzas, v.codigo))!
    expect(pagada.tramos[0].estado).toBe('pagada')
    expect(pagada.tramos[0].pago).toMatchObject({ beneficiario: 'Carlos Corredor', referencia: 'TRF-555' })
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/ya está pagado/)
    await expect(db.query(`insert into public.comision_movimientos (comision_id, tramo_id, tipo, monto, motivo) values ($1, $2, 'pago', 1, 'Duplicado directo')`, [pagada.id, t.id])).rejects.toThrow(/duplicate key|unique/)

    await expect(rpc(finanzas, `select public.comisiones_reversar_pago($1, 'Intento de Finanzas')`, [t.id])).rejects.toThrow(/Sin permiso/)
    await rpc(gerente, `select public.comisiones_reversar_pago($1, 'Transferencia devuelta por el banco')`, [t.id])
    const rev = (await comisionDe(finanzas, v.codigo))!
    expect(rev.tramos[0].estado).toBe('pendiente')
    expect(rev.tramos[0].pago).toBeNull()
    expect(rev.movimientos.map((m) => m.tipo)).toEqual(['pago', 'reverso_pago'])
    expect(rev.movimientos[0].revertido_en).toBeTruthy()
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/no está habilitado/)
    // Vuelve a pasar por habilitar: el pago queda otra vez como único vigente.
    await habilitar(gerente, t.id)
    await pagar(finanzas, t.id)
    expect((await comisionDe(finanzas, v.codigo))!.movimientos.map((m) => m.tipo)).toEqual(['pago', 'reverso_pago', 'pago'])
  })

  it('si deja de cumplir después de habilitar, no se puede pagar', async () => {
    const v = await ventaFirmada('Deja De Cumplir')
    const t = (await comisionDe(gerente, v.codigo))!.tramos[1]
    await honorario(t.id)
    const h = (await rpc<{ id: string }>(legal, `select public.contratos_registrar_hito($1, 'escritura', $2::date, 'NOT-1', 'Escritura inscrita') as id`, [v.id, hoy()])).id
    await habilitar(admin, t.id)
    await rpc(legal, `select public.contratos_revertir_hito($1, 'Registrado por error')`, [h])
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/dejó de cumplir/)
    expect((await comisionDe(gerente, v.codigo))!.tramos[1].estado).toBe('habilitada')
  })

  it('el honorario se corrige antes de habilitar, y no después', async () => {
    const v = await ventaFirmada('Corrige Honorario')
    await pagarHasta(v, 10)
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await honorario(t.id)
    await expect(honorario(t.id)).rejects.toThrow(/ya tiene honorario/)
    await rpc(finanzas, `select public.comisiones_quitar_honorario($1, 'Monto equivocado')`, [t.id])
    await honorario(t.id)
    await habilitar(admin, t.id)
    await expect(rpc(finanzas, `select public.comisiones_quitar_honorario($1, 'Ya habilitado')`, [t.id])).rejects.toThrow(/habilitado o pagado/)
  })

  it('revocar la política impide pagar lo ya habilitado', async () => {
    const v = await ventaFirmada('Revocada')
    await pagarHasta(v, 10)
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await honorario(t.id)
    await habilitar(admin, t.id)
    await rpc(admin, `select public.comisiones_revocar_politica('Dirección pidió revisarla')`)
    await expect(pagar(finanzas, t.id)).rejects.toThrow(/aprobación vigente/)
    await aprobarPolitica()
  })
})

describe('anulación, ajustes y recuperación', () => {
  it('contrato anulado: lo no pagado se anula, lo pagado queda por recuperar y no se mueve dinero', async () => {
    const v = await ventaFirmada('Se Cae')
    await pagarHasta(v, 10)
    const c0 = (await comisionDe(gerente, v.codigo))!
    await honorario(c0.tramos[0].id)
    await habilitar(admin, c0.tramos[0].id)
    await pagar(finanzas, c0.tramos[0].id)
    await rpc(legal, `select public.contratos_anular($1, 'Cliente desiste de la compra', 'Carta firmada')`, [v.id])
    const c = (await comisionDe(finanzas, v.codigo))!
    expect(c.estado).toBe('anulada')
    expect(c.tramos.map((t) => t.estado)).toEqual(['pagada', 'anulada'])
    expect(c.por_recuperar).toBeCloseTo(c0.tramos[0].monto, 2)
    const m = c.movimientos.find((x) => x.tipo === 'por_recuperar')!
    expect(m.monto).toBeCloseTo(-c0.tramos[0].monto, 2)
    await expect(pagar(finanzas, c.tramos[1].id)).rejects.toThrow(/anulada/)
    await expect(rpc(gerente, `select public.comisiones_reversar_pago($1, 'Intento sobre anulada')`, [c.tramos[0].id])).rejects.toThrow(/anulada/)
    await expect(rpc(carlos, `select public.comisiones_registrar_recuperacion($1, 'Intento del corredor')`, [m.id])).rejects.toThrow(/Sin permiso/)
    await rpc(finanzas, `select public.comisiones_registrar_recuperacion($1, 'Descontado de la siguiente comisión')`, [m.id])
    expect((await comisionDe(finanzas, v.codigo))!.por_recuperar).toBe(0)
    await expect(rpc(finanzas, `select public.comisiones_registrar_recuperacion($1, 'Otra vez la misma')`, [m.id])).rejects.toThrow(/ya figura/)
  })

  it('anular un borrador no deja nada por recuperar; el contrato nuevo tiene su propia comisión', async () => {
    const v = await contratoBorrador('Borrador Anulado')
    await rpc(legal, `select public.contratos_anular($1, 'Borrador descartado', '')`, [v.id])
    const c = (await comisionDe(gerente, v.codigo))!
    expect(c.estado).toBe('anulada')
    expect(c.por_recuperar).toBe(0)
    const id2 = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato nuevo') as id`, [v.reserva, hoy()])).id
    const k2 = await uno<{ codigo: string }>(`select codigo from public.contracts where id = $1`, [id2])
    expect((await comisionDe(gerente, k2.codigo))!.estado).toBe('calculada')
  })

  it('un ajuste exige permiso, motivo y respaldo, y no cambia el histórico', async () => {
    const v = await ventaFirmada('Ajuste')
    const c = (await comisionDe(gerente, v.codigo))!
    await expect(rpc(finanzas, `select public.comisiones_ajustar($1, -10, 'Corrección de valor', 'Acta 3')`, [c.id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(gerente, `select public.comisiones_ajustar($1, 0, 'Corrección de valor', 'Acta 3')`, [c.id])).rejects.toThrow(/monto/)
    await expect(rpc(gerente, `select public.comisiones_ajustar($1, -10, 'Corrección de valor', '')`, [c.id])).rejects.toThrow(/documento/)
    await rpc(gerente, `select public.comisiones_ajustar($1, -10.5, 'Corrección de valor', 'Acta 3')`, [c.id])
    const d = (await comisionDe(gerente, v.codigo))!
    expect(d.ajustes).toBe(-10.5)
    expect(d.monto_total).toBe(c.monto_total)
    expect(d.tramos.map((t) => t.monto)).toEqual(c.tramos.map((t) => t.monto))
  })

  it('todo queda en la auditoría con su autor', async () => {
    const acciones = (await db.query<{ accion: string }>(`select distinct accion from public.audit_log where entidad = 'comision' or entidad = 'comisiones'`)).rows.map((r) => r.accion)
    expect(acciones).toEqual(expect.arrayContaining(['Registrar honorario recibido', 'Habilitar tramo de comisión', 'Confirmar pago de comisión', 'Reversar pago de comisión', 'Ajustar comisión', 'Anular comisión', 'Aprobar política de liquidación', 'Registrar recuperación de comisión']))
    const a = await uno<{ actor_id: string }>(`select actor_id from public.audit_log where accion = 'Confirmar pago de comisión' limit 1`)
    expect(a.actor_id).toBe(finanzas)
  })
})

describe('quién ve qué', () => {
  it('el corredor ve lo suyo sin referencias ni honorarios, y no ve lo de otro; nadie lee las tablas directo', async () => {
    const v = await ventaFirmada('Del Corredor')
    await pagarHasta(v, 10)
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await honorario(t.id)
    await habilitar(admin, t.id)
    await pagar(finanzas, t.id)
    const propia = (await comisionDe(carlos, v.codigo))!
    expect(propia.tramos[0].estado).toBe('pagada')
    expect(propia.tramos[0].honorario).toBeNull()
    expect(propia.tramos[0].pago).toMatchObject({ beneficiario: null, referencia: null })
    expect(propia.movimientos).toEqual([])
    expect(await comisionDe(cora, v.codigo)).toBeUndefined()
    await expect(rpc(cora, `select public.comisiones_registrar_honorario($1, 1, $2::date, 'XXX')`, [t.id, hoy()])).rejects.toThrow(/Sin permiso/)
    expect((await como(db, carlos, async () => (await db.query(`select 1 from public.comisiones`)).rows.length))).toBe(0)
    await expect(como(db, admin, () => db.query(`update public.comision_tramos set estado = 'pagada'`).then((r) => r.affectedRows))).resolves.toBe(0)
  })

  it('un cambio de asesor no le quita la comisión de vista a quien vendió', async () => {
    const v = await ventaFirmada('Reasignada')
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Cambio de cartera')`, [v.cliente, cora])
    expect(await comisionDe(carlos, v.codigo)).toBeTruthy()
  })

  it('Finanzas con alcance propio no puede tocar una comisión ajena, aunque tenga el permiso', async () => {
    const finanzasPropio = await crearUsuario(db, 'Finanzas Propia', 'finanzas', { alcance: 'propio' })
    const v = await ventaFirmada('Ajena Finanzas')
    const t = (await comisionDe(gerente, v.codigo))!.tramos[0]
    await expect(rpc(finanzasPropio, `select public.comisiones_registrar_honorario($1, 1, $2::date, 'FACT-AJENA')`, [t.id, hoy()])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(finanzasPropio, `select public.comisiones_habilitar($1, 'Intento sobre comisión ajena')`, [t.id])).rejects.toThrow(/Sin permiso/)
    expect(await comisionDe(finanzasPropio, v.codigo)).toBeUndefined()
  })

  it('las funciones internas no son accesibles', async () => {
    await expect(rpc(admin, `select public.comision_sincronizar(gen_random_uuid(), 1, true)`)).rejects.toThrow(/permission denied/)
    await expect(rpc(admin, `select public.comision_anular(gen_random_uuid(), 'x')`)).rejects.toThrow(/permission denied/)
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select public.comisiones_listar()`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })
})
