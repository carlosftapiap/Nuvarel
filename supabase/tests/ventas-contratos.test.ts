// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { cargarCobranza } from '../../src/features/cobranza/api'
import { calcularTablero } from '../../src/features/cobranza/tablero'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cargarVentas, historial } from '../../src/features/ventas/remoto'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, sofia: string, cora: string, carlos: string
let n = 990400000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const unidad = async (c: string) => (await uno<{ estado: string }>(`select estado from public.inventory_units where codigo = $1`, [c])).estado
const contrato = (id: string) => uno<Record<string, unknown>>(`select * from public.contracts where id = $1`, [id])
/** Una unidad disponible y sin reserva activa: una solicitud no cambia el estado de la unidad, pero la ocupa. */
const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

/** Reserva aprobada por el camino autorizado, para un cliente nuevo de Carlos. */
async function reservaAprobada(extra: Record<string, unknown> = {}) {
  const codigo = await unidadLibre()
  const cliente = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Cliente ${codigo}`, telefono: `0${++n}`, origen: 'corredor', origen_detalle: 'Carlos Corredor', ...extra }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id
  const q = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [q])).id
  await rpc(carlos, `select public.reservas_adjuntar_comprobante($1, $2, null)`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_verificar_pago($1, $2, $3::date, $4, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return { cliente, op, q, r, codigo }
}
const crearContrato = async (r: string, u = legal) => (await rpc<{ id: string }>(u, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoyGuayaquil()])).id
const firmar = (id: string, u = legal) => rpc(u, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contratos/firmado.pdf')`, [id, hoyGuayaquil()])

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor', { equipo: equipo.id })
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('crear el contrato', () => {
  it('solo desde una reserva aprobada, por el servidor, y con permiso', async () => {
    const f = await reservaAprobada()
    await expect(rpc(carlos, `select public.contratos_crear($1, current_date, 'Sin permiso')`, [f.r])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(finanzas, `select public.contratos_crear($1, current_date, 'Sin permiso')`, [f.r])).rejects.toThrow(/Sin permiso/)
    await expect(como(db, legal, () => db.query(`insert into public.contracts (codigo, reservation_id, client_id, codigo_unidad, precio, fecha_contrato) values ('CON-X', $1, $2, $3, 1, current_date)`, [f.r, f.cliente, f.codigo]))).rejects.toThrow(/row-level security/)
    const id = await crearContrato(f.r)
    expect(await contrato(id)).toMatchObject({ estado: 'borrador', reservation_id: f.r, client_id: f.cliente, codigo_unidad: f.codigo, fecha_firma: null })
    await expect(crearContrato(f.r)).rejects.toThrow(/ya tiene contrato/)
  })

  it('no se genera si la reserva no está aprobada', async () => {
    const codigo = await unidadLibre()
    const cliente = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Sin aprobar', telefono: `0${++n}`, origen: 'whatsapp' }), carlos])).id
    const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id
    const q = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
    const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [q])).id
    await expect(crearContrato(r)).rejects.toThrow(/reserva aprobada/)
    await rpc(gerente, `select public.reservas_anular($1, 'Prueba terminada')`, [r])
  })
})

describe('firma, documentos e hitos', () => {
  let f: Awaited<ReturnType<typeof reservaAprobada>>, id: string
  beforeAll(async () => {
    f = await reservaAprobada()
    id = await crearContrato(f.r)
  })

  it('firmar exige permiso, evidencia y una fecha no futura', async () => {
    await expect(rpc(gerente, `select public.contratos_formalizar($1, current_date, 'Sin permiso', 'x.pdf')`, [id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(legal, `select public.contratos_formalizar($1, '2099-01-01', 'Fecha futura', 'x.pdf')`, [id])).rejects.toThrow(/no puede ser futura/)
    await expect(rpc(legal, `select public.contratos_formalizar($1, current_date, 'Sin evidencia', '')`, [id])).rejects.toThrow(/evidencia/)
    await expect(rpc(legal, `select public.contratos_formalizar($1, current_date, 'no', 'x.pdf')`, [id])).rejects.toThrow(/motivo/)
    expect((await contrato(id)).estado).toBe('borrador')
    expect(await unidad(f.codigo)).toBe('reservado')
  })

  it('al firmar: fecha, unidad en promesa, negociación en cobranza, documento e hito', async () => {
    await firmar(id)
    const c = await contrato(id)
    expect(c).toMatchObject({ estado: 'firmado', firmado_por: legal })
    expect(String(c.fecha_firma).slice(0, 10)).toBeTruthy()
    expect(await unidad(f.codigo)).toBe('promesa')
    expect((await uno<{ etapa: string }>(`select etapa from public.opportunities where id = $1`, [f.op])).etapa).toBe('cobranza')
    const d = await uno<{ tipo: string; referencia: string }>(`select tipo, referencia from public.contract_documents where contract_id = $1`, [id])
    expect(d).toEqual({ tipo: 'contrato_firmado', referencia: 'contratos/firmado.pdf' })
    const h = await uno<{ hito: string; registrado_por: string }>(`select hito, registrado_por from public.contract_milestones where contract_id = $1`, [id])
    expect(h).toEqual({ hito: 'contrato_firmado', registrado_por: legal })
    await expect(firmar(id)).rejects.toThrow(/no está en borrador/)
  })

  it('el camino anterior de firma también deja fecha e hito', async () => {
    const g = await reservaAprobada()
    const k = await crearContrato(g.r)
    await rpc(legal, `select public.contratos_firmar($1, 'Firma por la función base', 'x.pdf')`, [k])
    expect((await contrato(k)).fecha_firma).toBeTruthy()
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.contract_milestones where contract_id = $1`, [k])).n).toBe(1)
  })

  it('documentos: se registran con permiso y se retiran con motivo, sin borrarse', async () => {
    await expect(rpc(carlos, `select public.contratos_registrar_documento($1, 'anexo', 'anexo.pdf', '')`, [id])).rejects.toThrow(/Sin permiso/)
    const d = (await rpc<{ id: string }>(legal, `select public.contratos_registrar_documento($1, 'anexo', 'anexo.pdf', 'Anexo de parqueo') as id`, [id])).id
    await expect(rpc(legal, `select public.contratos_retirar_documento($1, 'no')`, [d])).rejects.toThrow(/motivo/)
    await rpc(legal, `select public.contratos_retirar_documento($1, 'Versión incorrecta')`, [d])
    expect(await uno(`select motivo_retiro, retirado_por from public.contract_documents where id = $1`, [d])).toEqual({ motivo_retiro: 'Versión incorrecta', retirado_por: legal })
  })

  it('escritura vende la unidad y se puede revertir sin perder historia', async () => {
    await expect(rpc(gerente, `select public.contratos_registrar_hito($1, 'escritura', current_date, 'N-1', 'Sin permiso')`, [id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(legal, `select public.contratos_registrar_hito($1, 'inventado', current_date, '', 'Hito falso')`, [id])).rejects.toThrow(/Hito no válido/)
    const h = (await rpc<{ id: string }>(legal, `select public.contratos_registrar_hito($1, 'escritura', current_date, 'Notaría 1', 'Escritura firmada') as id`, [id])).id
    expect(await unidad(f.codigo)).toBe('vendido')
    await expect(rpc(legal, `select public.contratos_registrar_hito($1, 'escritura', current_date, '', 'Dos veces')`, [id])).rejects.toThrow(/ya está registrado/)
    await expect(rpc(legal, `select public.contratos_anular($1, 'Con escritura', 'x.pdf')`, [id])).rejects.toThrow(/revierte primero/)
    await rpc(legal, `select public.contratos_revertir_hito($1, 'Error de notaría')`, [h])
    expect(await unidad(f.codigo)).toBe('promesa')
    expect(await uno(`select motivo_reversion, revertido_por from public.contract_milestones where id = $1`, [h])).toEqual({ motivo_reversion: 'Error de notaría', revertido_por: legal })
    const firma = await uno<{ id: string }>(`select id from public.contract_milestones where contract_id = $1 and hito = 'contrato_firmado'`, [id])
    await expect(rpc(legal, `select public.contratos_revertir_hito($1, 'Revertir firma')`, [firma.id])).rejects.toThrow(/anula el contrato/)
    const hist = await uno<{ n: number }>(`select count(*)::int as n from public.inventory_status_history where codigo = $1 and motivo ilike '%escritura%'`, [f.codigo])
    expect(hist.n).toBe(2)
  })

  it('entrega avanza la negociación y desembolso solo deja constancia', async () => {
    await rpc(legal, `select public.contratos_registrar_hito($1, 'desembolso', current_date, 'Banco', 'Crédito desembolsado')`, [id])
    expect(await unidad(f.codigo)).toBe('promesa')
    const e = (await rpc<{ id: string }>(legal, `select public.contratos_registrar_hito($1, 'entrega', current_date, 'Acta', 'Unidad entregada') as id`, [id])).id
    expect((await uno<{ etapa: string }>(`select etapa from public.opportunities where id = $1`, [f.op])).etapa).toBe('entrega')
    await rpc(legal, `select public.contratos_revertir_hito($1, 'Entrega reprogramada')`, [e])
    expect((await uno<{ etapa: string }>(`select etapa from public.opportunities where id = $1`, [f.op])).etapa).toBe('cobranza')
  })

  it('nadie escribe directo en hitos, documentos ni contratos', async () => {
    await expect(como(db, admin, () => db.query(`insert into public.contract_milestones (contract_id, hito, fecha, motivo) values ($1, 'escritura', current_date, 'Directo')`, [id]))).rejects.toThrow(/row-level security/)
    await expect(como(db, admin, () => db.query(`insert into public.contract_documents (contract_id, tipo, referencia) values ($1, 'otro', 'directo')`, [id]))).rejects.toThrow(/row-level security/)
    const r = await como(db, admin, () => db.query(`update public.contracts set precio = 1 where id = $1`, [id]))
    expect(r.affectedRows ?? 0).toBe(0)
    expect(Number((await contrato(id)).precio)).toBeGreaterThan(1)
  })
})

describe('datos históricos de la venta', () => {
  let f: Awaited<ReturnType<typeof reservaAprobada>>, id: string
  beforeAll(async () => {
    f = await reservaAprobada({ documento: '1712345678' })
    id = await crearContrato(f.r)
    await firmar(id)
  })

  it('guarda cliente, unidad, precio, origen, corredor, asesor, responsable y atribución', async () => {
    expect(await contrato(id)).toMatchObject({
      client_id: f.cliente, codigo_unidad: f.codigo, opportunity_id: f.op,
      asesor_id: carlos, responsable_id: carlos, atribucion_usuario_id: carlos, corredor_origen_id: carlos, origen: 'corredor', origen_detalle: 'Carlos Corredor',
    })
  })

  it('no se modifican: ni desde una función con privilegios, ni al reasignar al cliente', async () => {
    await expect(db.query(`update public.contracts set precio = 1 where id = $1`, [id])).rejects.toThrow(/no se modifican/)
    await expect(db.query(`update public.contracts set corredor_origen_id = $2 where id = $1`, [id, cora])).rejects.toThrow(/no se modifican/)
    await expect(db.query(`update public.contracts set fecha_firma = '2020-01-01' where id = $1`, [id])).rejects.toThrow(/fecha de firma no se modifica/)
    await expect(db.query(`update public.contracts set estado = 'borrador' where id = $1`, [id])).rejects.toThrow(/no vuelve a borrador/)
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Cambio de cartera')`, [f.cliente, cora])
    expect(await contrato(id)).toMatchObject({ asesor_id: carlos, responsable_id: carlos, atribucion_usuario_id: carlos, corredor_origen_id: carlos })
    expect((await uno<{ asesor_id: string }>(`select asesor_id from public.clients where id = $1`, [f.cliente])).asesor_id).toBe(cora)
  })

  it('la vista para Comisiones entrega todo sin duplicarlo y sin crear comisiones', async () => {
    const v = await rpc<Record<string, unknown>>(finanzas, `select * from public.ventas_historicas where contract_id = $1`, [id])
    expect(v).toMatchObject({ client_id: f.cliente, codigo_unidad: f.codigo, estado_contractual: 'firmado', corredor_origen_id: carlos, asesor_id: carlos, responsable_id: carlos, atribucion_usuario_id: carlos, origen: 'corredor' })
    expect(v.fecha_formalizacion).toBeTruthy()
    expect(Object.keys(v.hitos as object)).toEqual(['contrato_firmado'])
    expect(Number(v.pct_pagado)).toBeGreaterThan(0)
    expect(Number(v.pct_pagado)).toBeLessThan(10)
    const t = await uno<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name like '%comision%'`)
    expect(t.n).toBe(0)
  })

  it('el historial reúne contrato, reserva y cotización, con responsables, solo para quien tiene acceso', async () => {
    const h = await historial(datosPglite(db, legal), id)
    const acciones = h.map((e) => e.accion)
    expect(acciones).toEqual(expect.arrayContaining(['Firmar contrato', 'Generar contrato', 'Aprobar reserva', 'Solicitar reserva', 'Cotización aceptada', 'Emitir cotización']))
    expect(h.find((e) => e.accion === 'Firmar contrato')?.usuario).toBe('Legal')
    expect(await historial(datosPglite(db, carlos), id)).toEqual([])
  })
})

describe('anulación y reverso', () => {
  it('sin borrar nada: contrato, cuotas y pagos quedan; la unidad vuelve a reservada y se puede generar otro', async () => {
    const f = await reservaAprobada()
    const id = await crearContrato(f.r)
    await firmar(id)
    const cuotas = (await uno<{ n: number }>(`select count(*)::int as n from public.installments where contract_id = $1`, [id])).n
    await rpc(finanzas, `select public.cobranza_registrar_compromiso($1, null, 100, current_date + 5, 'Promete pagar')`, [id])

    await expect(rpc(gerente, `select public.contratos_anular($1, 'Sin permiso', 'x.pdf')`, [id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(legal, `select public.contratos_anular($1, 'no', 'x.pdf')`, [id])).rejects.toThrow(/motivo/)
    await expect(rpc(legal, `select public.contratos_anular($1, 'Sin respaldo', '')`, [id])).rejects.toThrow(/respalda/)
    await rpc(legal, `select public.contratos_anular($1, 'Cliente desiste de la compra', 'actas/anulacion.pdf')`, [id])

    expect(await contrato(id)).toMatchObject({ estado: 'anulado', anulado_por: legal, motivo_anulacion: 'Cliente desiste de la compra' })
    expect(await unidad(f.codigo)).toBe('reservado')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.installments where contract_id = $1`, [id])).n).toBe(cuotas)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments where contract_id = $1 and estado = 'verificado'`, [id])).n).toBe(1)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.cobranza_compromisos where contract_id = $1 and estado = 'pendiente'`, [id])).n).toBe(0)
    expect((await uno<{ motivo_reversion: string }>(`select motivo_reversion from public.contract_milestones where contract_id = $1`, [id])).motivo_reversion).toMatch(/Contrato anulado/)
    expect((await uno<{ tipo: string }>(`select tipo from public.contract_documents where contract_id = $1 and tipo = 'anulacion'`, [id])).tipo).toBe('anulacion')

    // Un contrato anulado no vuelve a cambiar.
    await expect(firmar(id)).rejects.toThrow(/no está en borrador/)
    await expect(rpc(legal, `select public.contratos_anular($1, 'Otra vez más', 'x.pdf')`, [id])).rejects.toThrow(/ya está anulado/)
    await expect(db.query(`update public.contracts set estado = 'firmado' where id = $1`, [id])).rejects.toThrow(/anulado no cambia/)

    // Cobranzas deja de exigirlo.
    const d = await cargarCobranza(datosPglite(db, finanzas))
    const tablero = calcularTablero(d.contratos, d.cuotas, d.pagos, hoyGuayaquil())
    expect(tablero.contratos.some((r) => r.contrato.id === id)).toBe(false)
    expect(d.contratos.some((c) => c.id === id)).toBe(true)

    // La reserva sigue aprobada: se genera otro contrato, con los datos conservados.
    const v = await cargarVentas(datosPglite(db, legal))
    expect(v.porContratar.find((r) => r.id === f.r)?.contratoAnulado).toBe((await contrato(id)).codigo)
    const nuevo = await crearContrato(f.r)
    expect(nuevo).not.toBe(id)
    expect(await contrato(nuevo)).toMatchObject({ estado: 'borrador', reservation_id: f.r })
    await firmar(nuevo)
    expect(await unidad(f.codigo)).toBe('promesa')
  })

  it('con pagos por verificar no se anula', async () => {
    const f = await reservaAprobada()
    const id = await crearContrato(f.r)
    await rpc(finanzas, `select public.cobranzas_registrar_pago($1, 100, $2::date, 'TRF-PEND', null)`, [id, hoyGuayaquil()])
    await expect(rpc(legal, `select public.contratos_anular($1, 'Con pago pendiente', '')`, [id])).rejects.toThrow(/pagos por verificar/)
  })

  it('después de anular el contrato, la reserva se anula con su flujo y libera la unidad y al cliente', async () => {
    const f = await reservaAprobada()
    const id = await crearContrato(f.r)
    await expect(rpc(gerente, `select public.reservas_anular($1, 'Con contrato vigente')`, [f.r])).rejects.toThrow(/ya tiene contrato/)
    await rpc(legal, `select public.contratos_anular($1, 'Borrador descartado', '')`, [id])
    await rpc(gerente, `select public.reservas_anular($1, 'Cliente desiste de la compra')`, [f.r])
    expect(await unidad(f.codigo)).toBe('disponible')
    expect((await uno<{ etapa: string }>(`select etapa from public.clients where id = $1`, [f.cliente])).etapa).toBe('negociacion')
  })
})

describe('permisos en Ventas', () => {
  let id: string, cliente: string
  beforeAll(async () => {
    const f = await reservaAprobada()
    cliente = f.cliente
    id = await crearContrato(f.r)
  })
  const ve = (u: string) => como(db, u, async () => (await db.query(`select 1 from public.contracts where id = $1`, [id])).rows.length)

  it('corredor: no ve contratos; Finanzas, Legal, Gerencia y supervisor del equipo sí', async () => {
    expect(await ve(carlos)).toBe(0)
    expect(await ve(cora)).toBe(0)
    expect(await ve(legal)).toBe(1)
    expect(await ve(finanzas)).toBe(1)
    expect(await ve(gerente)).toBe(1)
    expect(await ve(sofia)).toBe(1)
  })

  it('hitos y documentos siguen el acceso al contrato', async () => {
    await rpc(legal, `select public.contratos_registrar_documento($1, 'borrador', 'borrador.pdf', '')`, [id])
    const contar = (u: string) => como(db, u, async () => (await db.query(`select 1 from public.contract_documents where contract_id = $1`, [id])).rows.length)
    expect(await contar(carlos)).toBe(0)
    expect(await contar(legal)).toBe(1)
  })

  it('un supervisor sin permiso de formalizar no firma, aunque vea el contrato', async () => {
    await expect(firmar(id, sofia)).rejects.toThrow(/Sin permiso/)
  })

  it('una excepción de permiso no da acceso a un contrato fuera de alcance', async () => {
    await db.query(`insert into public.user_permission_overrides values ($1, 'ventas.formalizar', 'permitir')`, [cora])
    await expect(firmar(id, cora)).rejects.toThrow(/fuera de tu alcance/)
    await db.query(`delete from public.user_permission_overrides where user_id = $1`, [cora])
    expect(cliente).toBeTruthy()
  })

  it('la lectura de Ventas muestra origen y responsables, sin datos del cliente para quien no los puede ver', async () => {
    const d = await cargarVentas(datosPglite(db, legal))
    const v = d.ventas.find((x) => x.id === id)!
    expect(v).toMatchObject({ asesor: 'Carlos Corredor', responsable: 'Carlos Corredor', corredorOrigen: 'Carlos Corredor', atribucion: 'Carlos Corredor', origen: 'corredor', estado: 'borrador' })
    expect(v.cliente?.nombre).toMatch(/^Cliente /)
    expect(v.condiciones?.meses).toBeGreaterThan(0)
    expect(v.cuotas.length).toBeGreaterThan(2)
    const j = await crearUsuario(db, 'Jarval', 'jarval')
    const dj = await cargarVentas(datosPglite(db, j))
    expect(dj.ventas.find((x) => x.id === id)?.cliente).toBeNull()
  })
})
