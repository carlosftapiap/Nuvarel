// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, sofia: string, carlos: string, cora: string, jarval: string
let n = 990600000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const unidad = async (c: string) => (await uno<{ estado: string; reserva_id: string | null }>(`select estado, reserva_id from public.inventory_units where codigo = $1`, [c]))
const cliente = (id: string) => uno<{ etapa: string; motivo_perdida: string; proxima_tipo: string | null }>(`select etapa, motivo_perdida, proxima_tipo from public.clients where id = $1`, [id])
const reserva = (id: string) => uno<{ estado: string; motivo_anulacion: string }>(`select estado, motivo_anulacion from public.reservations where id = $1`, [id])
const oportunidad = (id: string) => uno<{ etapa: string; motivo_perdida: string }>(`select etapa, motivo_perdida from public.opportunities where id = $1`, [id])
const desistir = (u: string, c: string, o: string | null, motivo = 'cambio_decision', obs = '') =>
  rpc<{ id: string }>(u, `select public.desistimientos_registrar($1, $2, $3, $4) as id`, [c, o, motivo, obs]).then((r) => r.id)
const fila = (id: string) => uno<Record<string, unknown>>(`select * from public.desistimientos where id = $1`, [id])

const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
const nuevoCliente = async (u: string, nombre: string) => (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: `0${++n}`, origen: 'whatsapp' }), u])).id
const abrir = async (u: string, c: string, codigo: string) => (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
/** Cotización aceptada y reserva solicitada: no retiene la unidad. */
async function solicitada(u: string, c: string, codigo: string) {
  const op = await abrir(u, c, codigo)
  const q = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [q])).id
  return { op, q, r }
}
/** Reserva aprobada por el flujo: la unidad queda reservada. */
async function aprobada(u: string, c: string, codigo: string) {
  const f = await solicitada(u, c, codigo)
  await rpc(u, `select public.reservas_adjuntar_comprobante($1, $2, null)`, [f.r, `TRF-${f.r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [f.r])
  await rpc(finanzas, `select public.reservas_verificar_pago($1, $2, $3::date, $4, 'Ingreso confirmado')`, [f.r, m.monto_reserva, hoyGuayaquil(), `BAN-${f.r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [f.r])
  return { ...f, monto: Number(m.monto_reserva) }
}

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
  jarval = await crearUsuario(db, 'Jarval', 'jarval')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('desistimiento sin reserva', () => {
  it('sin negociación: el cliente pasa a Perdido, conserva su ficha y no toca ninguna unidad', async () => {
    const c = await nuevoCliente(carlos, 'Sin operación')
    const id = await desistir(carlos, c, null, 'personal', 'Se muda de ciudad')
    expect(await cliente(c)).toMatchObject({ etapa: 'perdido', motivo_perdida: 'Desistimiento: Motivos personales' })
    expect(await fila(id)).toMatchObject({ client_id: c, opportunity_id: null, reservation_id: null, codigo_unidad: null, motivo: 'personal', observaciones: 'Se muda de ciudad', revision_financiera: 'no_aplica', registrado_por: carlos, registrado_nombre: 'Carlos Corredor' })
    await expect(desistir(carlos, c, null)).rejects.toThrow(/ya está marcado/)
  })

  it('con negociación sin reserva: la cierra, anula sus cotizaciones y la unidad no cambia', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Sin reserva')
    const op = await abrir(carlos, c, codigo)
    const q = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    const antes = await unidad(codigo)
    const id = await desistir(carlos, c, op, 'precio')
    expect(await oportunidad(op)).toEqual({ etapa: 'perdida', motivo_perdida: 'Desistimiento: Precio o condiciones' })
    expect(await unidad(codigo)).toEqual(antes)
    expect(await uno(`select estado from public.quotes where id = $1`, [q])).toEqual({ estado: 'anulada' })
    expect(await fila(id)).toMatchObject({ reservation_id: null, codigo_unidad: codigo, unidad_detalle: 'Sin reserva propia: la unidad no cambia', revision_financiera: 'no_aplica' })
    await expect(rpc(carlos, `select public.cotizaciones_aceptar($1, 'Volver a usarla')`, [q])).rejects.toThrow(/anulada/)
  })

  it('con negociaciones abiertas exige elegir cuál', async () => {
    const c = await nuevoCliente(carlos, 'Debe elegir')
    await abrir(carlos, c, await unidadLibre())
    await expect(desistir(carlos, c, null)).rejects.toThrow(/elige de cuál/)
  })
})

describe('desistimiento con reserva', () => {
  it('reserva solicitada: se anula; la unidad no estaba retenida y sigue igual', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Solicitud')
    const f = await solicitada(carlos, c, codigo)
    const id = await desistir(carlos, c, f.op)
    expect((await reserva(f.r)).estado).toBe('anulada')
    expect((await unidad(codigo)).estado).toBe('disponible')
    expect(await fila(id)).toMatchObject({ reservation_id: f.r, unidad_antes: 'disponible', unidad_despues: 'disponible', revision_financiera: 'no_aplica' })
  })

  it('reserva confirmada: la unidad queda disponible, el cliente pasa a Perdido y el dinero queda por revisar, sin pagos nuevos', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Confirmada')
    const f = await aprobada(carlos, c, codigo)
    expect((await unidad(codigo)).estado).toBe('reservado')
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n

    const id = await desistir(carlos, c, f.op, 'sin_financiamiento', 'El banco negó el crédito')

    expect(await reserva(f.r)).toEqual({ estado: 'anulada', motivo_anulacion: 'Desistimiento: No obtuvo financiamiento' })
    expect(await unidad(codigo)).toEqual({ estado: 'disponible', reserva_id: null })
    expect(await oportunidad(f.op)).toEqual({ etapa: 'perdida', motivo_perdida: 'Desistimiento: No obtuvo financiamiento' })
    expect((await cliente(c)).etapa).toBe('perdido')
    const d = await fila(id)
    expect(d).toMatchObject({ unidad_antes: 'reservado', unidad_despues: 'disponible', unidad_detalle: 'La unidad queda disponible', revision_financiera: 'pendiente' })
    expect(Number(d.monto_recibido)).toBe(f.monto)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(pagos)
    // La unidad se puede volver a vender.
    const otro = await nuevoCliente(cora, 'Nuevo comprador')
    const g = await solicitada(cora, otro, codigo)
    expect((await reserva(g.r)).estado).toBe('solicitada')
    await desistir(cora, otro, g.op)
  })

  it('con comprobante sin verificar también queda por revisar, aunque no haya monto', async () => {
    const c = await nuevoCliente(carlos, 'Con comprobante')
    const f = await solicitada(carlos, c, await unidadLibre())
    await rpc(carlos, `select public.reservas_adjuntar_comprobante($1, 'TRF-999', null)`, [f.r])
    const d = await fila(await desistir(carlos, c, f.op))
    expect(d).toMatchObject({ revision_financiera: 'pendiente', monto_recibido: null })
  })
})

describe('la unidad solo se libera si corresponde', () => {
  it('otra reserva activa: desistir de una negociación sin reserva no toca la unidad ni la reserva del otro cliente', async () => {
    const codigo = await unidadLibre()
    const a = await nuevoCliente(carlos, 'Interesado')
    const opA = await abrir(carlos, a, codigo)
    const b = await nuevoCliente(cora, 'Con reserva')
    const f = await aprobada(cora, b, codigo)
    await desistir(carlos, a, opA)
    expect(await unidad(codigo)).toEqual({ estado: 'reservado', reserva_id: f.r })
    expect((await reserva(f.r)).estado).toBe('confirmada')
    expect((await cliente(b)).etapa).toBe('reserva')
  })

  it('contrato vigente: se rechaza y no cambia nada; al anular el contrato, ya se puede', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Con contrato')
    const f = await aprobada(carlos, c, codigo)
    const k = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [f.r, hoyGuayaquil()])).id
    await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'x.pdf')`, [k, hoyGuayaquil()])
    await expect(desistir(carlos, c, f.op)).rejects.toThrow(/contrato vigente/)
    expect((await reserva(f.r)).estado).toBe('confirmada')
    expect((await unidad(codigo)).estado).toBe('promesa')
    expect((await oportunidad(f.op)).etapa).toBe('cobranza')
    expect((await cliente(c)).etapa).toBe('reserva')
    const prev = await rpc<{ p: { bloqueo: string } }>(carlos, `select public.desistimientos_previsualizar($1, $2) as p`, [c, f.op])
    expect(prev.p.bloqueo).toMatch(/contrato vigente/)

    await rpc(legal, `select public.contratos_anular($1, 'Cliente desiste de la compra', 'actas/x.pdf')`, [k])
    await desistir(carlos, c, f.op)
    expect((await unidad(codigo)).estado).toBe('disponible')
    expect(await uno(`select estado from public.contracts where id = $1`, [k])).toEqual({ estado: 'anulado' })
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
    await rpc(carlos, `select public.reservas_adjuntar_comprobante($1, 'TRF-B', null)`, [f.r])
    const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [f.r])
    await rpc(finanzas, `select public.reservas_verificar_pago($1, $2, $3::date, 'BAN-B', 'Ingreso confirmado')`, [f.r, m.monto_reserva, hoyGuayaquil()])
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [f.r])
    expect((await unidad(codigo)).estado).toBe('reservado')
    const d = await fila(await desistir(carlos, c, f.op))
    expect(await unidad(codigo)).toEqual({ estado: 'bloqueado', reserva_id: null })
    expect(d.unidad_detalle).toMatch(/vuelve a estar bloqueada/)
    await rpc(gerente, `select public.inventario_cambiar_estado($1, 'disponible', 'Fin de la retención', null)`, [codigo])
  })

  it('la anulación de Gerencia aplica la misma regla y no pasa por encima de un bloqueo', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Anulación gerencia')
    const f = await aprobada(carlos, c, codigo)
    await rpc(gerente, `select public.reservas_anular($1, 'Cliente no continúa')`, [f.r])
    expect((await unidad(codigo)).estado).toBe('disponible')
    expect((await oportunidad(f.op)).etapa).toBe('cotizacion')
    expect((await cliente(c)).etapa).toBe('negociacion')
  })
})

describe('cliente con varias oportunidades', () => {
  it('cierra solo la elegida; el cliente y la otra siguen', async () => {
    const c = await nuevoCliente(carlos, 'Dos negociaciones')
    const u1 = await unidadLibre()
    const a = await aprobada(carlos, c, u1)
    const u2 = await unidadLibre()
    const b = await abrir(carlos, c, u2)
    // Desiste de la que no tiene reserva: la reserva y la etapa no cambian.
    await desistir(carlos, c, b)
    expect((await oportunidad(b)).etapa).toBe('perdida')
    expect((await oportunidad(a.op)).etapa).toBe('aprobacion')
    expect((await cliente(c)).etapa).toBe('reserva')
    expect((await unidad(u1)).estado).toBe('reservado')
  })

  it('al desistir de la reservada con otra abierta, vuelve a Negociación y no a Perdido', async () => {
    const c = await nuevoCliente(carlos, 'Reserva y otra')
    const u1 = await unidadLibre()
    const a = await aprobada(carlos, c, u1)
    const b = await abrir(carlos, c, await unidadLibre())
    await desistir(carlos, c, a.op)
    expect((await unidad(u1)).estado).toBe('disponible')
    expect((await cliente(c)).etapa).toBe('negociacion')
    expect((await oportunidad(b)).etapa).toBe('calificacion')
  })

  it('con otra reserva confirmada, el cliente sigue en Reserva', async () => {
    const c = await nuevoCliente(carlos, 'Dos reservas')
    const a = await aprobada(carlos, c, await unidadLibre())
    const b = await aprobada(carlos, c, await unidadLibre())
    await desistir(carlos, c, a.op)
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

  it('otro corredor no puede, aunque conozca los identificadores; su supervisor y administración sí', async () => {
    const c = await nuevoCliente(carlos, 'De Carlos')
    const f = await solicitada(carlos, c, await unidadLibre())
    await expect(desistir(cora, c, f.op)).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(cora, `select public.desistimientos_previsualizar($1, $2)`, [c, f.op])).rejects.toThrow(/fuera de tu alcance/)
    await desistir(sofia, c, f.op)
    expect((await reserva(f.r)).estado).toBe('anulada')
    const c2 = await nuevoCliente(carlos, 'Lo hace administración')
    await desistir(admin, c2, null)
    expect((await cliente(c2)).etapa).toBe('perdido')
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
    await expect(como(db, admin, () => db.query(`insert into public.desistimientos (client_id, motivo, registrado_nombre) values ($1, 'otro', 'x')`, [c]))).rejects.toThrow(/row-level security/)
    await expect(rpc(admin, `select public.desistimiento_recibido(null, null)`)).rejects.toThrow(/permission denied/)
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select public.desistimientos_registrar($1, null, 'otro', 'desde anon')`, [c])).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })

  it('el corredor no recibe permiso de anular reservas directamente', async () => {
    const c = await nuevoCliente(carlos, 'Anular directo')
    const f = await solicitada(carlos, c, await unidadLibre())
    await expect(rpc(carlos, `select public.reservas_anular($1, 'Intento directo')`, [f.r])).rejects.toThrow(/Sin permiso/)
  })
})

describe('todo o nada', () => {
  it('si algo falla al final, no queda ningún cambio parcial', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Falla atómica')
    const f = await aprobada(carlos, c, codigo)
    const foto = async () => JSON.stringify({ u: await unidad(codigo), r: await reserva(f.r), o: await oportunidad(f.op), c: await cliente(c),
      q: await uno(`select estado from public.quotes where id = $1`, [f.q]),
      d: await uno(`select count(*)::int as n from public.desistimientos where client_id = $1`, [c]),
      a: await uno(`select count(*)::int as n from public.client_activities where client_id = $1`, [c]),
      h: await uno(`select count(*)::int as n from public.inventory_status_history where codigo = $1`, [codigo]),
      l: await uno(`select count(*)::int as n from public.audit_log`) })
    const antes = await foto()
    // Falla el último paso: la auditoría del desistimiento.
    await db.exec(`create function pg_temp.falla() returns trigger language plpgsql as $$ begin if new.accion = 'Registrar desistimiento' then raise exception 'Fallo simulado'; end if; return new; end $$;
      create trigger falla_prueba before insert on public.audit_log for each row execute function pg_temp.falla();`)
    await expect(desistir(carlos, c, f.op)).rejects.toThrow(/Fallo simulado/)
    await db.exec(`drop trigger falla_prueba on public.audit_log`)
    expect(await foto()).toBe(antes)
    await desistir(carlos, c, f.op)
    expect((await unidad(codigo)).estado).toBe('disponible')
  })
})

describe('historial y auditoría', () => {
  it('nada se borra y queda quién, cuándo, por qué y qué cambió', async () => {
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Historial')
    const f = await aprobada(carlos, c, codigo)
    await desistir(carlos, c, f.op, 'compro_otro', 'Compró en el proyecto vecino')
    for (const [t, id] of [['clients', c], ['opportunities', f.op], ['quotes', f.q], ['reservations', f.r]]) {
      expect((await db.query(`select 1 from public.${t} where id = $1`, [id])).rows).toHaveLength(1)
    }
    const a = await uno<{ actor_id: string; motivo: string; antes: Record<string, unknown>; despues: Record<string, unknown>; fecha: string }>(`select * from public.audit_log where accion = 'Registrar desistimiento' and entidad_id = $1`, [c])
    expect(a).toMatchObject({ actor_id: carlos, motivo: 'Desistimiento: Compró en otro proyecto' })
    expect(a.antes).toMatchObject({ etapa_cliente: 'reserva', reserva_estado: 'confirmada', unidad: codigo, unidad_estado: 'reservado' })
    expect(a.despues).toMatchObject({ etapa_cliente: 'perdido', unidad_estado: 'disponible', observaciones: 'Compró en el proyecto vecino' })
    expect(a.fecha).toBeTruthy()
    expect((await db.query(`select 1 from public.audit_log where accion = 'Anular reserva por desistimiento' and entidad_id = $1`, [f.r])).rows).toHaveLength(1)
    const h = await uno<{ de: string; a: string; user_id: string; motivo: string }>(`select de, a, user_id, motivo from public.inventory_status_history where reserva_id = $1 and a = 'disponible'`, [f.r])
    expect(h).toMatchObject({ de: 'reservado', a: 'disponible', user_id: carlos })
    const nota = await uno<{ descripcion: string }>(`select descripcion from public.client_activities where client_id = $1 and descripcion like 'Desistimiento:%'`, [c])
    expect(nota.descripcion).toMatch(/Compró en otro proyecto.*Compró en el proyecto vecino.*pendiente de revisión de Finanzas/)
  })

  it('el corredor y Finanzas consultan el historial según su alcance; otro corredor no', async () => {
    const c = await nuevoCliente(carlos, 'Consulta')
    const id = await desistir(carlos, c, null)
    const ve = (u: string) => como(db, u, async () => (await db.query(`select 1 from public.desistimientos where id = $1`, [id])).rows.length)
    expect(await ve(carlos)).toBe(1)
    expect(await ve(finanzas)).toBe(1)
    expect(await ve(cora)).toBe(0)
  })

  it('Finanzas marca la revisión con nota, sin mover dinero; otros no pueden', async () => {
    const c = await nuevoCliente(carlos, 'Revisión')
    const f = await aprobada(carlos, c, await unidadLibre())
    const id = await desistir(carlos, c, f.op)
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n
    await expect(rpc(carlos, `select public.desistimientos_marcar_revisado($1, 'Lo reviso yo')`, [id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(finanzas, `select public.desistimientos_marcar_revisado($1, 'no')`, [id])).rejects.toThrow(/motivo/)
    await rpc(finanzas, `select public.desistimientos_marcar_revisado($1, 'Retención según política comercial')`, [id])
    expect(await fila(id)).toMatchObject({ revision_financiera: 'revisada', revision_nota: 'Retención según política comercial', revisada_por: finanzas })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(pagos)
    await expect(rpc(finanzas, `select public.desistimientos_marcar_revisado($1, 'Otra vez más')`, [id])).rejects.toThrow(/no tiene revisión pendiente/)
  })
})
