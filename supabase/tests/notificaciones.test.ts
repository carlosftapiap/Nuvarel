// @vitest-environment node
// Fase 5: avisos internos por evento, sin duplicados, con enlace al registro, destinatario e historial de envío.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'
import { completarEnlaces } from '../functions/_shared/cobranza'

let db: PGlite
let admin: string, vera: string, finanzas: string, gerente: string, legal: string, lea: string, oficial: string
let reserva: string, contrato: string, hoy: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
interface Aviso { evento: string; destinatario: string; destinatario_usuario: string; enlace: string; asunto: string; cuerpo: string; estado: string; entidad_id: string }
const avisos = async (evento: string) => (await db.query<Aviso>(`select * from public.cobranza_alertas where evento = $1 order by destinatario`, [evento])).rows
const correo = (n: string) => `${n.toLowerCase().replace(/\s+/g, '.')}@prueba.local`
let n = 0
const archivo = (prefijo: string) => JSON.stringify({ ruta: `${prefijo}/${crypto.randomUUID()}-doc${++n}.pdf`, nombre: `doc${n}.pdf`, mime: 'application/pdf', tamano: 1024, hash: 'c'.repeat(64) })

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  finanzas = await crearUsuario(db, 'Fina', 'finanzas', { alcance: 'empresa' })
  gerente = await crearUsuario(db, 'Gema', 'gerencia')
  legal = await crearUsuario(db, 'Lola', 'legal')
  lea = await crearUsuario(db, 'Lea', 'legal')
  oficial = await crearUsuario(db, 'Olga', 'oficial_cumplimiento')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Avisos', '1715000707', '0990000070', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [cliente, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-AV-1', $4::date, $4::date + 60, 'E1-PB-A2', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, cliente, op, hoy])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  reserva = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [q])).rows[0].id
  await rpc(vera, `select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [reserva])
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
})

describe('avisos por evento', () => {
  it('un comprobante registrado avisa a quien verifica pagos, con enlace y sin avisar a quien lo registró', async () => {
    await rpc(vera, `select public.reservas_reportar_pago($1::uuid, 1000, $2::date, 'Banco de prueba', 'TRF-AV-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva, hoy])
    const a = await avisos('pago_por_verificar')
    expect(a.map((x) => x.destinatario)).toEqual([correo('Fina')])
    expect(a[0]).toMatchObject({ destinatario_usuario: finanzas, enlace: '/cobranzas', estado: 'pendiente' })
    expect(a[0].cuerpo).toContain('{{APP}}/cobranzas')
    expect(a[0].cuerpo).toContain('TRF-AV-1')
  })

  it('una reserva normal se confirma al verificar el pago: avisa a Legal y al vendedor, no a Gerencia', async () => {
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-AV-1', true, 'Ingreso confirmado en banco')`, [reserva, hoy])
    expect(await avisos('reserva_por_aprobar')).toHaveLength(0)
    const a = await avisos('reserva_confirmada')
    expect(a.map((x) => x.destinatario_usuario)).toEqual(expect.arrayContaining([legal, lea, vera]))
    expect(a.map((x) => x.destinatario_usuario)).not.toContain(gerente)
    expect(a[0].asunto).toBe('[AMURA] Reserva confirmada · E1-PB-A2')
    expect(a[0].enlace).toBe('/ventas')
  })

  it('el contrato nuevo avisa a Legal; quien lo crea no se avisa a sí mismo ni pasa a administración', async () => {
    contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato con avisos') as id`, [reserva, hoy])).rows[0].id
    const a = await avisos('contrato_por_documentar')
    expect(a.map((x) => x.destinatario_usuario)).toEqual([lea])
    expect(a[0].enlace).toBe(`/ventas?contrato=${contrato}`)
  })

  it('el expediente avisa en cada paso: por revisar, observado, aprobado y listo para firma', async () => {
    for (const t of ['pn_cedula', 'pn_votacion', 'pn_servicio_basico', 'pn_origen_fondos', 'pn_conozca_cliente']) {
      await rpc(legal, `select public.expediente_cargar((select client_id from public.contracts where id = $1), null, $2, $3::jsonb, null)`,
        [contrato, t, archivo(`clientes/${(await uno<{ c: string }>(`select client_id as c from public.contracts where id = $1`, [contrato])).c}`)])
    }
    await rpc(legal, `select public.cumplimiento_enviar($1, 'Expediente completo')`, [contrato])
    expect((await avisos('expediente_por_revisar')).map((x) => x.destinatario_usuario)).toEqual([oficial])
    await rpc(oficial, `select public.cumplimiento_resolver($1, 'observado', 'Falta firma en el formulario')`, [contrato])
    const obs = await avisos('expediente_observado')
    expect(obs.map((x) => x.destinatario_usuario).sort()).toEqual([legal, lea].sort())
    expect(obs[0].cuerpo).toContain('Falta firma en el formulario')
    for (const r of (await rpc<{ r: { documento: string }[] }>(oficial, `select public.cumplimiento_requisitos($1) as r`, [contrato])).rows[0].r) {
      await rpc(oficial, `select public.expediente_revisar($1, 'aprobado', null)`, [r.documento])
    }
    await rpc(legal, `select public.cumplimiento_enviar($1, 'Corregido')`, [contrato])
    expect(await avisos('expediente_por_revisar')).toHaveLength(2)
    await rpc(oficial, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [contrato])
    expect((await avisos('expediente_aprobado')).length).toBeGreaterThan(0)
    expect((await avisos('contrato_por_firmar')).map((x) => x.destinatario).sort()).toEqual([correo('Lea'), correo('Lola')].sort())
  })

  it('acciones críticas: pago anulado y excedente aplicado avisan a Finanzas', async () => {
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contratos/firmado.pdf')`, [contrato, hoy])
    const p = (await rpc<{ id: string }>(vera, `select public.cobranzas_reportar_pago($1::uuid, 50000, $2::date, 'Banco', 'TRF-AV-2', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [contrato, hoy]).catch(() => null))
    const pago = p?.rows[0].id ?? (await rpc<{ id: string }>(finanzas, `select public.cobranzas_reportar_pago($1::uuid, 50000, $2::date, 'Banco', 'TRF-AV-2', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [contrato, hoy])).rows[0].id
    await rpc(admin, `select public.cobranzas_confirmar_pago($1, true, 'Verificado en banco')`, [pago])
    await rpc(finanzas, `select public.cobranzas_autorizar_excedente($1, 1000, 'Abono anticipado del cliente', $2::jsonb)`, [contrato, JSON.stringify({ ruta: `excedentes/${contrato}/s.pdf`, nombre: 's.pdf', mime: 'application/pdf', tamano: 10 })])
    // Quien autorizó no recibe su propio aviso; administración siempre se entera de las acciones críticas.
    expect((await avisos('excedente_aplicado')).map((x) => x.destinatario_usuario)).toEqual([admin])
    await rpc(admin, `select public.cobranzas_anular_pago($1, 'Transferencia devuelta por el banco')`, [pago])
    expect((await avisos('pago_anulado')).map((x) => x.destinatario_usuario)).toEqual([finanzas])
  })

  it('el mismo hecho no genera dos avisos', async () => {
    await db.query(`update public.reservations set estado = 'pago_verificado' where id = $1`, [reserva])
    const antes = (await avisos('reserva_por_aprobar')).length
    expect(antes).toBe(1)
    await db.query(`update public.reservations set estado = 'confirmada' where id = $1`, [reserva])
    await db.query(`update public.reservations set estado = 'pago_verificado' where id = $1`, [reserva])
    expect(await avisos('reserva_por_aprobar')).toHaveLength(antes)
  })
})

describe('recordatorios diarios', () => {
  it('lo que sigue esperando se recuerda una sola vez por estado', async () => {
    const r2 = (await db.query<{ id: string }>(`insert into public.reservations (codigo, client_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, reserva_pct, monto_reserva, meses, cuota_mensual, estado, created_by, pago_verificado_en)
      select 'RES-AV-2', client_id, (select codigo from public.inventory_units where codigo <> 'E1-PB-A2' order by codigo limit 1), quote_id, vigencia_hasta, precio_acordado, reserva_pct, monto_reserva, meses, cuota_mensual, 'pago_verificado', created_by, now() - interval '5 days' from public.reservations where id = $1 returning id`, [reserva])).rows[0].id
    const primera = (await uno<{ n: number }>(`select public.notificaciones_recordatorios($1::date) as n`, [hoy])).n
    expect(primera).toBeGreaterThan(0)
    expect((await avisos('recordatorio_reserva_por_aprobar')).map((x) => x.entidad_id)).toEqual([r2])
    expect((await uno<{ n: number }>(`select public.notificaciones_recordatorios($1::date) as n`, [hoy])).n).toBe(0)
  })

  it('los usuarios no pueden llamar los recordatorios ni encolar avisos', async () => {
    await expect(rpc(admin, `select public.notificaciones_recordatorios(current_date)`)).rejects.toThrow(/permission denied/)
    await expect(rpc(admin, `select public.notif_encolar('x', 'x', 'x', 'x', 'cobranzas.ver', null, 'x', 'x', '[]', '/', null)`)).rejects.toThrow(/permission denied/)
  })
})

describe('quién ve el historial', () => {
  it('administración (auditoría) ve todo; cada persona sus propios avisos; Cobranzas no ve avisos de otros eventos', async () => {
    const total = (await uno<{ n: number }>(`select count(*)::int as n from public.cobranza_alertas where evento is not null`)).n
    expect((await rpc(admin, `select id from public.cobranza_alertas where evento is not null`)).rows).toHaveLength(total)
    const propios = (await uno<{ n: number }>(`select count(*)::int as n from public.cobranza_alertas where destinatario_usuario = $1`, [oficial])).n
    expect((await rpc(oficial, `select id from public.cobranza_alertas`)).rows).toHaveLength(propios)
    const deVera = (await uno<{ n: number }>(`select count(*)::int as n from public.cobranza_alertas where destinatario_usuario = $1`, [vera])).n
    expect((await rpc(vera, `select id from public.cobranza_alertas where evento is not null`)).rows).toHaveLength(deVera)
  })

  it('al enviar, el enlace se completa con la dirección de la app', () => {
    expect(completarEnlaces('<a href="{{APP}}/ventas?contrato=1">x</a>', 'https://amura.test/')).toBe('<a href="https://amura.test/ventas?contrato=1">x</a>')
  })
})
