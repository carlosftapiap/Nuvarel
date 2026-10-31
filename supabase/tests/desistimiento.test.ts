// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, gerente2: string, finanzas: string, legal: string, sofia: string, carlos: string, cora: string, jarval: string
let n = 990600000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const unidad = (c: string) => uno<{ estado: string; reserva_id: string | null }>(`select estado, reserva_id from public.inventory_units where codigo = $1`, [c])
const cliente = (id: string) => uno<{ etapa: string; motivo_perdida: string }>(`select etapa, motivo_perdida from public.clients where id = $1`, [id])
const reserva = (id: string) => uno<{ estado: string; motivo_anulacion: string }>(`select estado, motivo_anulacion from public.reservations where id = $1`, [id])
const oportunidad = (id: string) => uno<{ etapa: string; motivo_perdida: string }>(`select etapa, motivo_perdida from public.opportunities where id = $1`, [id])
const fila = (id: string) => uno<Record<string, unknown>>(`select * from public.desistimientos where id = $1`, [id])
const desistir = (u: string, c: string, o: string | null, motivo = 'cambio_decision', obs = '') =>
  rpc<{ id: string }>(u, `select public.desistimientos_registrar($1, $2, $3, $4) as id`, [c, o, motivo, obs]).then((r) => r.id)
const autorizar = (u: string, id: string) => rpc<{ r: string }>(u, `select public.desistimientos_autorizar($1, 'Autorización de prueba') as r`, [id]).then((x) => x.r)
const revisar = (u: string, id: string) => rpc<{ r: string }>(u, `select public.desistimientos_revisar_finanzas($1, 'Retención según política comercial') as r`, [id]).then((x) => x.r)
const rechazar = (u: string, id: string) => rpc(u, `select public.desistimientos_rechazar($1, 'El cliente sigue interesado')`, [id])

const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
const nuevoCliente = async (u: string, nombre: string) => (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: `0${++n}`, origen: 'whatsapp' }), u])).id
const abrir = async (u: string, c: string, codigo: string) => (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
async function solicitada(u: string, c: string, codigo: string) {
  const op = await abrir(u, c, codigo)
  const q = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [q])).id
  return { op, q, r }
}
/** Reserva aprobada por el flujo autorizado: con ingreso verificado y la unidad reservada. */
async function aprobada(u: string, c: string, codigo: string) {
  const f = await solicitada(u, c, codigo)
  await rpc(u, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [f.r, `TRF-${f.r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [f.r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [f.r, m.monto_reserva, hoyGuayaquil(), `BAN-${f.r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [f.r])
  return { ...f, monto: Number(m.monto_reserva) }
}
/** El flujo siempre exige ingreso para aprobar, así que este caso solo se construye en la prueba, directamente. */
async function aprobadaSinDinero(u: string, c: string, codigo: string) {
  const f = await aprobada(u, c, codigo)
  await db.query(`update public.reservations set pago_monto = null, monto_recibido = null, comprobante = null where id = $1`, [f.r])
  return f
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  gerente2 = await crearUsuario(db, 'Gerencia Dos', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor', { equipo: equipo.id })
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  jarval = await crearUsuario(db, 'Jarval', 'jarval')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('cliente interesado que nunca reserva', () => {
  it('sin negociación: se aplica en el acto, pasa a Perdido y conserva su ficha', async () => {
    const c = await nuevoCliente(carlos, 'Sin operación')
    const id = await desistir(carlos, c, null, 'personal', 'Se muda de ciudad')
    expect(await cliente(c)).toMatchObject({ etapa: 'perdido', motivo_perdida: 'Desistimiento: Motivos personales' })
    expect(await fila(id)).toMatchObject({ nivel: 'directo', estado: 'aplicado', reservation_id: null, codigo_unidad: null, observaciones: 'Se muda de ciudad', registrado_por: carlos, registrado_nombre: 'Carlos Corredor' })
    await expect(desistir(carlos, c, null)).rejects.toThrow(/ya está marcado/)
  })

  it('con negociación: la cierra, anula sus cotizaciones y la unidad no cambia', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Sin reserva')
    const op = await abrir(carlos, c, codigo)
    const q = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    const antes = await unidad(codigo)
    const id = await desistir(carlos, c, op, 'precio')
    expect(await oportunidad(op)).toEqual({ etapa: 'perdida', motivo_perdida: 'Desistimiento: Precio o condiciones' })
    expect(await unidad(codigo)).toEqual(antes)
    expect(await uno(`select estado from public.quotes where id = $1`, [q])).toEqual({ estado: 'anulada' })
    expect(await fila(id)).toMatchObject({ nivel: 'directo', estado: 'aplicado', unidad_detalle: 'Sin reserva propia: la unidad no cambia' })
  })

  it('con negociaciones abiertas exige elegir cuál', async () => {
    const c = await nuevoCliente(carlos, 'Debe elegir')
    await abrir(carlos, c, await unidadLibre())
    await expect(desistir(carlos, c, null)).rejects.toThrow(/elige de cuál/)
  })
})

describe('reserva solicitada', () => {
  it('sin pago ni comprobante: el corredor la cancela sin autorización, y la unidad no cambia', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Solicitud')
    const f = await solicitada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    expect((await reserva(f.r)).estado).toBe('anulada')
    expect((await unidad(codigo)).estado).toBe('disponible')
    expect(await fila(id)).toMatchObject({ nivel: 'directo', estado: 'aplicado', reservation_id: f.r })
  })

  it('con comprobante: pasa a Gerencia y Finanzas, aunque no esté aprobada', async () => {
    const c = await nuevoCliente(carlos, 'Con comprobante')
    const f = await solicitada(carlos, c, await unidadLibre())
    await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-999', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [f.r])
    const d = await fila(await desistir(carlos, c, f.op))
    expect(d).toMatchObject({ nivel: 'gerencia_y_finanzas', estado: 'pendiente', revision_financiera: 'pendiente' })
    expect((await reserva(f.r)).estado).toBe('solicitada')
  })
})

describe('reserva aprobada sin dinero recibido', () => {
  it('el corredor solicita: nada cambia hasta que un supervisor autoriza; entonces se libera', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Aprobada sin dinero')
    const f = await aprobadaSinDinero(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op, 'precio')

    // Solicitud pendiente: la unidad sigue reservada.
    expect(await fila(id)).toMatchObject({ nivel: 'supervisor_o_gerencia', estado: 'pendiente', revision_financiera: 'no_aplica' })
    expect((await unidad(codigo)).estado).toBe('reservado')
    expect((await reserva(f.r)).estado).toBe('confirmada')
    expect((await oportunidad(f.op)).etapa).toBe('aprobacion')
    expect((await cliente(c)).etapa).toBe('reserva')

    await expect(autorizar(carlos, id)).rejects.toThrow(/Quien registra/)
    await expect(autorizar(finanzas, id)).rejects.toThrow(/Sin permiso/)
    expect(await autorizar(sofia, id)).toBe('aplicado')
    expect((await unidad(codigo))).toEqual({ estado: 'disponible', reserva_id: null })
    expect((await reserva(f.r)).estado).toBe('anulada')
    expect(await fila(id)).toMatchObject({ estado: 'aplicado', autorizado_por: sofia, autorizado_nombre: 'Sofia', autorizacion_nota: 'Autorización de prueba', unidad_antes: 'reservado', unidad_despues: 'disponible' })
  })

  it('un supervisor de otro equipo no puede', async () => {
    const otro = await crearUsuario(db, 'Otro Supervisor', 'supervisor')
    const c = await nuevoCliente(carlos, 'Otro equipo')
    const f = await aprobadaSinDinero(carlos, c, await unidadLibre())
    const id = await desistir(carlos, c, f.op)
    await expect(autorizar(otro, id)).rejects.toThrow(/fuera de tu alcance/)
    expect(await autorizar(gerente, id)).toBe('aplicado')
  })
})

describe('reserva aprobada con dinero recibido', () => {
  it('requiere Gerencia y Finanzas, en cualquier orden; el supervisor no alcanza; no crea pagos', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Con dinero')
    const f = await aprobada(carlos, c, codigo)
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n
    const id = await desistir(carlos, c, f.op, 'sin_financiamiento', 'El banco negó el crédito')

    const d = await fila(id)
    expect(d).toMatchObject({ nivel: 'gerencia_y_finanzas', estado: 'pendiente', revision_financiera: 'pendiente' })
    expect(Number(d.monto_recibido)).toBe(f.monto)
    await expect(autorizar(sofia, id)).rejects.toThrow(/la autoriza Gerencia/)

    // Solo Gerencia: aún no se aplica.
    expect(await autorizar(gerente, id)).toBe('pendiente')
    expect((await unidad(codigo)).estado).toBe('reservado')
    expect((await reserva(f.r)).estado).toBe('confirmada')
    await expect(autorizar(gerente2, id)).rejects.toThrow(/ya está autorizada/)
    await expect(revisar(carlos, id)).rejects.toThrow(/Sin permiso/)

    // Finanzas completa: se aplica en la misma operación.
    expect(await revisar(finanzas, id)).toBe('aplicado')
    expect(await unidad(codigo)).toEqual({ estado: 'disponible', reserva_id: null })
    expect((await reserva(f.r)).estado).toBe('anulada')
    expect((await cliente(c)).etapa).toBe('perdido')
    expect(await fila(id)).toMatchObject({ estado: 'aplicado', revision_financiera: 'revisada', revisada_por: finanzas, revision_nota: 'Retención según política comercial', autorizado_por: gerente })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(pagos)
  })

  it('primero Finanzas y luego Gerencia también funciona', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Finanzas primero')
    const f = await aprobada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    expect(await revisar(finanzas, id)).toBe('pendiente')
    expect((await unidad(codigo)).estado).toBe('reservado')
    expect(await autorizar(gerente, id)).toBe('aplicado')
    expect((await unidad(codigo)).estado).toBe('disponible')
  })

  it('Gerencia y Finanzas deben ser personas distintas, aunque tenga ambos permisos', async () => {
    const c = await nuevoCliente(carlos, 'Misma persona')
    const f = await aprobada(carlos, c, await unidadLibre())
    const id = await desistir(carlos, c, f.op)
    expect(await autorizar(admin, id)).toBe('pendiente')
    await expect(revisar(admin, id)).rejects.toThrow(/Quien autorizó/)
    expect(await revisar(finanzas, id)).toBe('aplicado')
  })

  it('quien registra no decide su propia solicitud, ni siendo Gerencia', async () => {
    const c = await nuevoCliente(gerente, 'Registra Gerencia')
    const f = await aprobada(carlos, await nuevoCliente(carlos, 'Auxiliar'), await unidadLibre())
    expect(f.r).toBeTruthy()
    const g = await aprobadaConDuenio(c)
    const id = await desistir(gerente, c, g.op)
    await expect(autorizar(gerente, id)).rejects.toThrow(/Quien registra/)
    await expect(rechazar(gerente, id)).rejects.toThrow(/Quien registra/)
    expect(await autorizar(gerente2, id)).toBe('pendiente')
  })
})
async function aprobadaConDuenio(c: string) {
  // El gerente que crea el cliente no puede aprobar su propia solicitud de pago: verifica Finanzas y aprueba otro gerente.
  const codigo = await unidadLibre()
  const f = await solicitada(gerente, c, codigo)
  await rpc(gerente, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-G', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [f.r])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [f.r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-G', true, 'Ingreso confirmado')`, [f.r, m.monto_reserva, hoyGuayaquil()])
  await rpc(gerente2, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [f.r])
  return f
}

describe('solicitud rechazada y en pausa', () => {
  it('rechazada: el departamento sigue reservado, la operación continúa y se puede volver a solicitar', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Rechazada')
    const f = await aprobada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    await expect(rechazar(sofia, id)).rejects.toThrow(/Sin permiso/)
    await rechazar(gerente, id)
    expect(await unidad(codigo)).toEqual({ estado: 'reservado', reserva_id: f.r })
    expect((await reserva(f.r)).estado).toBe('confirmada')
    expect((await oportunidad(f.op)).etapa).toBe('aprobacion')
    expect((await cliente(c)).etapa).toBe('reserva')
    expect(await fila(id)).toMatchObject({ estado: 'rechazado', rechazado_por: gerente, motivo_rechazo: 'El cliente sigue interesado', revision_financiera: 'no_aplica' })
    await expect(autorizar(gerente2, id)).rejects.toThrow(/ya está rechazado/)
    const otra = await desistir(carlos, c, f.op)
    expect((await fila(otra)).estado).toBe('pendiente')
  })

  it('mientras está pendiente no se puede duplicar, generar contrato ni avanzar la reserva', async () => {
    const c = await nuevoCliente(carlos, 'En pausa')
    const f = await aprobada(carlos, c, await unidadLibre())
    await desistir(carlos, c, f.op)
    await expect(desistir(carlos, c, f.op)).rejects.toThrow(/Ya hay una solicitud pendiente/)
    await expect(rpc(legal, `select public.contratos_crear($1, $2::date, 'Contrato en pausa')`, [f.r, hoyGuayaquil()])).rejects.toThrow(/solicitud de anulación pendiente/)
    const p = await rpc<{ p: { bloqueo: string } }>(carlos, `select public.desistimientos_previsualizar($1, $2) as p`, [c, f.op])
    expect(p.p.bloqueo).toMatch(/solicitud pendiente/)
    const c2 = await nuevoCliente(carlos, 'En pausa 2')
    const g = await solicitada(carlos, c2, await unidadLibre())
    await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-P', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [g.r])
    await desistir(carlos, c2, g.op)
    const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [g.r])
    await expect(rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-P', true, 'Ingreso confirmado')`, [g.r, m.monto_reserva, hoyGuayaquil()])).rejects.toThrow(/solicitud de anulación pendiente/)
  })
})

describe('anulación directa', () => {
  it('solo sirve para una solicitud sin pago ni comprobante', async () => {
    const c = await nuevoCliente(carlos, 'Directa')
    const f = await solicitada(carlos, c, await unidadLibre())
    await expect(rpc(carlos, `select public.reservas_anular($1, 'Intento directo')`, [f.r])).rejects.toThrow(/Sin permiso/)
    await rpc(gerente, `select public.reservas_anular($1, 'Cliente no continúa')`, [f.r])
    expect((await reserva(f.r)).estado).toBe('anulada')
    expect((await oportunidad(f.op)).etapa).toBe('cotizacion')

    const c2 = await nuevoCliente(carlos, 'Directa aprobada')
    const codigo = await unidadLibre()
    const g = await aprobada(carlos, c2, codigo)
    await expect(rpc(gerente, `select public.reservas_anular($1, 'Saltarse la autorización')`, [g.r])).rejects.toThrow(/requiere autorización/)
    expect((await unidad(codigo)).estado).toBe('reservado')
  })
})

describe('la unidad solo se libera si corresponde', () => {
  it('contrato vigente: se rechaza y no cambia nada; anulado el contrato, sigue la autorización', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Con contrato')
    const f = await aprobada(carlos, c, codigo)
    const k = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [f.r, hoyGuayaquil()])).id
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'x.pdf')`, [k, hoyGuayaquil()])
    await expect(desistir(carlos, c, f.op)).rejects.toThrow(/contrato vigente/)
    expect((await reserva(f.r)).estado).toBe('confirmada')
    expect((await unidad(codigo)).estado).toBe('promesa')
    expect((await oportunidad(f.op)).etapa).toBe('cobranza')
    const prev = await rpc<{ p: { bloqueo: string } }>(carlos, `select public.desistimientos_previsualizar($1, $2) as p`, [c, f.op])
    expect(prev.p.bloqueo).toMatch(/contrato vigente/)

    await rpc(legal, `select public.contratos_anular($1, 'Cliente desiste de la compra', 'actas/x.pdf')`, [k])
    const id = await desistir(carlos, c, f.op)
    expect((await fila(id)).nivel).toBe('gerencia_y_finanzas')
    expect((await unidad(codigo)).estado).toBe('reservado')
    await autorizar(gerente, id)
    await revisar(finanzas, id)
    expect((await unidad(codigo)).estado).toBe('disponible')
    expect(await uno(`select estado from public.contracts where id = $1`, [k])).toEqual({ estado: 'anulado' })
  })

  it('otra reserva activa: desistir de una negociación sin reserva no toca la unidad ni la reserva del otro cliente', async () => {
    const codigo = await unidadLibre()
    const a = await nuevoCliente(carlos, 'Interesado')
    const opA = await abrir(carlos, a, codigo)
    const b = await nuevoCliente(cora, 'Con reserva')
    const f = await aprobada(cora, b, codigo)
    await desistir(carlos, a, opA)
    expect(await unidad(codigo)).toEqual({ estado: 'reservado', reserva_id: f.r })
    expect((await reserva(f.r)).estado).toBe('confirmada')
  })

  it('bloqueada por Gerencia con solicitud: sigue bloqueada', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Unidad bloqueada')
    const f = await solicitada(carlos, c, codigo)
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'bloqueado', 'Retención de Gerencia', null)`, [codigo])
    const d = await fila(await desistir(carlos, c, f.op))
    expect((await unidad(codigo)).estado).toBe('bloqueado')
    expect(d).toMatchObject({ unidad_antes: 'bloqueado', unidad_despues: 'bloqueado', unidad_detalle: 'La unidad sigue bloqueada por Gerencia' })
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'disponible', 'Fin de la retención', null)`, [codigo])
  })

  it('bloqueada antes de una reserva aprobada: vuelve a bloqueada, no a disponible', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Bloqueo previo')
    const f = await solicitada(carlos, c, codigo)
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'bloqueado', 'Retención de Gerencia', null)`, [codigo])
    await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-B', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [f.r])
    const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [f.r])
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-B', true, 'Ingreso confirmado')`, [f.r, m.monto_reserva, hoyGuayaquil()])
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [f.r])
    const id = await desistir(carlos, c, f.op)
    await autorizar(gerente2, id)
    await revisar(finanzas, id)
    expect(await unidad(codigo)).toEqual({ estado: 'bloqueado', reserva_id: null })
    expect((await fila(id)).unidad_detalle).toMatch(/vuelve a estar bloqueada/)
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'disponible', 'Fin de la retención', null)`, [codigo])
  })

  it('una vez liberada, otro cliente la puede cotizar y reservar', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Libera')
    const f = await aprobada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    await autorizar(gerente, id)
    await revisar(finanzas, id)
    const g = await solicitada(cora, await nuevoCliente(cora, 'Nuevo comprador'), codigo)
    expect((await reserva(g.r)).estado).toBe('solicitada')
  })
})

describe('cliente con varias oportunidades', () => {
  it('cierra solo la elegida; la reservada, su unidad y la etapa siguen', async () => {
    const c = await nuevoCliente(carlos, 'Dos negociaciones')
    const u1 = await unidadLibre()
    const a = await aprobada(carlos, c, u1)
    const b = await abrir(carlos, c, await unidadLibre())
    await desistir(carlos, c, b)
    expect((await oportunidad(b)).etapa).toBe('perdida')
    expect((await oportunidad(a.op)).etapa).toBe('aprobacion')
    expect((await cliente(c)).etapa).toBe('reserva')
    expect((await unidad(u1)).estado).toBe('reservado')
  })

  it('al aplicar en la reservada con otra abierta, vuelve a Negociación y no a Perdido', async () => {
    const c = await nuevoCliente(carlos, 'Reserva y otra')
    const u1 = await unidadLibre()
    const a = await aprobada(carlos, c, u1)
    const b = await abrir(carlos, c, await unidadLibre())
    const id = await desistir(carlos, c, a.op)
    await autorizar(gerente, id)
    await revisar(finanzas, id)
    expect((await unidad(u1)).estado).toBe('disponible')
    expect((await cliente(c)).etapa).toBe('negociacion')
    expect((await oportunidad(b)).etapa).toBe('calificacion')
  })

  it('con otra reserva confirmada, el cliente sigue en Reserva', async () => {
    const c = await nuevoCliente(carlos, 'Dos reservas')
    const a = await aprobada(carlos, c, await unidadLibre())
    const b = await aprobada(carlos, c, await unidadLibre())
    const id = await desistir(carlos, c, a.op)
    await autorizar(gerente, id)
    await revisar(finanzas, id)
    expect((await cliente(c)).etapa).toBe('reserva')
    expect((await reserva(b.r)).estado).toBe('confirmada')
  })
})

describe('permisos', () => {
  it('sin permiso se rechaza y no cambia nada', async () => {
    const c = await nuevoCliente(carlos, 'Sin permiso')
    const f = await solicitada(carlos, c, await unidadLibre())
    for (const u of [jarval, finanzas, legal]) {
      await expect(desistir(u, c, f.op)).rejects.toThrow(/Sin permiso/)
      await expect(rpc(u, `select public.desistimientos_previsualizar($1, $2)`, [c, f.op])).rejects.toThrow(/Sin permiso/)
    }
    expect((await reserva(f.r)).estado).toBe('solicitada')
  })

  it('otro corredor no puede, aunque conozca los identificadores', async () => {
    const c = await nuevoCliente(carlos, 'De Carlos')
    const f = await aprobada(carlos, c, await unidadLibre())
    await expect(desistir(cora, c, f.op)).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(cora, `select public.desistimientos_previsualizar($1, $2)`, [c, f.op])).rejects.toThrow(/fuera de tu alcance/)
    const id = await desistir(carlos, c, f.op)
    await expect(autorizar(cora, id)).rejects.toThrow(/fuera de tu alcance/)
    await expect(rechazar(cora, id)).rejects.toThrow(/fuera de tu alcance/)
    await expect(revisar(cora, id)).rejects.toThrow(/Sin permiso/)
  })

  it('una negociación de otro cliente se rechaza', async () => {
    const a = await nuevoCliente(carlos, 'Cliente A')
    const b = await nuevoCliente(carlos, 'Cliente B')
    const op = await abrir(carlos, b, await unidadLibre())
    await expect(desistir(carlos, a, op)).rejects.toThrow(/no corresponde/)
    expect((await oportunidad(op)).etapa).toBe('calificacion')
  })

  it('valida el motivo; "Otro" exige explicación', async () => {
    const c = await nuevoCliente(carlos, 'Motivo')
    await expect(desistir(carlos, c, null, 'inventado')).rejects.toThrow(/motivo/)
    await expect(desistir(carlos, c, null, 'otro', 'no')).rejects.toThrow(/observaciones/)
    await desistir(carlos, c, null, 'otro', 'Decidió esperar un año')
  })

  it('nadie escribe directo en la tabla ni usa las funciones internas', async () => {
    const c = await nuevoCliente(carlos, 'Directo')
    await expect(como(db, admin, () => db.query(`insert into public.desistimientos (client_id, motivo, nivel, registrado_nombre) values ($1, 'otro', 'directo', 'x')`, [c]))).rejects.toThrow(/row-level security/)
    await expect(rpc(admin, `select public.desistimiento_aplicar(gen_random_uuid())`)).rejects.toThrow(/permission denied/)
    await expect(rpc(admin, `select public.desistimiento_recibido(null, null)`)).rejects.toThrow(/permission denied/)
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select public.desistimientos_registrar($1, null, 'otro', 'desde anon')`, [c])).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })
})

describe('todo o nada', () => {
  it('si algo falla al aplicar, la autorización tampoco queda y no hay cambios parciales', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Falla atómica')
    const f = await aprobada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    expect(await revisar(finanzas, id)).toBe('pendiente')
    const foto = async () => JSON.stringify({ u: await unidad(codigo), r: await reserva(f.r), o: await oportunidad(f.op), c: await cliente(c), d: await fila(id),
      q: await uno(`select estado from public.quotes where id = $1`, [f.q]),
      a: await uno(`select count(*)::int as n from public.client_activities where client_id = $1`, [c]),
      h: await uno(`select count(*)::int as n from public.inventory_status_history where codigo = $1`, [codigo]),
      l: await uno(`select count(*)::int as n from public.audit_log`) })
    const antes = await foto()
    await db.exec(`create function pg_temp.falla() returns trigger language plpgsql as $$ begin if new.accion = 'Aplicar desistimiento' then raise exception 'Fallo simulado'; end if; return new; end $$;
      create trigger falla_prueba before insert on public.audit_log for each row execute function pg_temp.falla();`)
    await expect(autorizar(gerente, id)).rejects.toThrow(/Fallo simulado/)
    await db.exec(`drop trigger falla_prueba on public.audit_log`)
    expect(await foto()).toBe(antes)
    expect(await autorizar(gerente, id)).toBe('aplicado')
    expect((await unidad(codigo)).estado).toBe('disponible')
  })
})

describe('historial y auditoría', () => {
  it('nada se borra y queda quién solicitó, quién autorizó, cuándo, por qué y qué cambió', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Historial')
    const f = await aprobada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op, 'compro_otro', 'Compró en el proyecto vecino')
    await autorizar(gerente, id)
    await revisar(finanzas, id)
    for (const [t, x] of [['clients', c], ['opportunities', f.op], ['quotes', f.q], ['reservations', f.r], ['desistimientos', id]]) {
      expect((await db.query(`select 1 from public.${t} where id = $1`, [x])).rows).toHaveLength(1)
    }
    const acciones = (await db.query<{ accion: string; actor_id: string; motivo: string }>(`select accion, actor_id, motivo from public.audit_log where entidad_id = $1 order by fecha`, [c])).rows
    expect(acciones.map((a) => a.accion)).toEqual(expect.arrayContaining(['Registrar desistimiento', 'Autorizar anulación por desistimiento', 'Revisar desistimiento', 'Aplicar desistimiento']))
    expect(acciones.find((a) => a.accion === 'Registrar desistimiento')).toMatchObject({ actor_id: carlos, motivo: 'Desistimiento: Compró en otro proyecto' })
    expect(acciones.find((a) => a.accion === 'Autorizar anulación por desistimiento')?.actor_id).toBe(gerente)
    expect(acciones.find((a) => a.accion === 'Revisar desistimiento')?.actor_id).toBe(finanzas)
    const a = await uno<{ antes: Record<string, unknown>; despues: Record<string, unknown>; fecha: string }>(`select * from public.audit_log where accion = 'Aplicar desistimiento' and entidad_id = $1`, [c])
    expect(a.antes).toMatchObject({ etapa_cliente: 'reserva', reserva_estado: 'confirmada', unidad: codigo, unidad_estado: 'reservado' })
    expect(a.despues).toMatchObject({ etapa_cliente: 'perdido', unidad_estado: 'disponible', observaciones: 'Compró en el proyecto vecino' })
    expect(a.fecha).toBeTruthy()
    expect((await db.query(`select 1 from public.audit_log where accion = 'Anular reserva por desistimiento' and entidad_id = $1`, [f.r])).rows).toHaveLength(1)
    expect(await uno(`select de, a, user_id from public.inventory_status_history where reserva_id = $1 and a = 'disponible'`, [f.r])).toEqual({ de: 'reservado', a: 'disponible', user_id: finanzas })
    const notas = (await db.query<{ descripcion: string }>(`select descripcion from public.client_activities where client_id = $1`, [c])).rows.map((x) => x.descripcion).join('\n')
    expect(notas).toMatch(/Solicitud de anulación por desistimiento: Compró en otro proyecto.*Compró en el proyecto vecino/)
    expect(notas).toMatch(/Anulación autorizada por Gerencia/)
    expect(notas).toMatch(/Revisión de Finanzas por Finanzas/)
    expect(notas).toMatch(/Desistimiento aplicado/)
  })

  it('el corredor y Finanzas consultan el historial según su alcance; otro corredor no', async () => {
    const c = await nuevoCliente(carlos, 'Consulta')
    const id = await desistir(carlos, c, null)
    const ve = (u: string) => como(db, u, async () => (await db.query(`select 1 from public.desistimientos where id = $1`, [id])).rows.length)
    expect(await ve(carlos)).toBe(1)
    expect(await ve(finanzas)).toBe(1)
    expect(await ve(cora)).toBe(0)
  })
})

describe('origen comercial en el contrato', () => {
  it('conserva origen, detalle, corredor y atribución, y no cambia al reasignar', async () => {
    const c = (await rpc<{ id: string }>(admin, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Traído por corredor', telefono: `0${++n}`, origen: 'corredor', origen_detalle: 'Cora Corredora', corredor_origen_id: cora }), carlos])).id
    const f = await aprobada(carlos, c, await unidadLibre())
    const k = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [f.r, hoyGuayaquil()])).id
    const datos = () => uno(`select origen, origen_detalle, corredor_origen_id, atribucion_usuario_id, asesor_id from public.contracts where id = $1`, [k])
    const antes = await datos()
    expect(antes).toEqual({ origen: 'corredor', origen_detalle: 'Cora Corredora', corredor_origen_id: cora, atribucion_usuario_id: admin, asesor_id: carlos })
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Cambio de cartera')`, [c, cora])
    expect(await datos()).toEqual(antes)
  })
})
