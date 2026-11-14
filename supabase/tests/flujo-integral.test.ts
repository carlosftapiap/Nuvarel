// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { cargarCobranza } from '../../src/features/cobranza/api'
import { cargarClientes } from '../../src/features/clientes/remoto'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { datosPglite } from './datos-pglite'
import { aprobarCumplimiento, cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, sofia: string, cora: string, carlos: string, vera: string, jarval: string
let n = 990300000

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const cuenta = (u: string, tabla: string, col: string, id: string) => como(db, u, async () => (await db.query(`select 1 from public.${tabla} where ${col} = $1`, [id])).rows.length)
const nuevoCliente = async (u: string, nombre: string, extra: Record<string, unknown> = {}) =>
  (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'whatsapp', ...extra }), extra.asesor ?? u])).id

/** Cotización aceptada, reserva verificada y aprobada: el camino autorizado completo. */
async function reservaAprobada(u: string, cliente: string, unidad: string) {
  const op = (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, unidad])).id
  const q = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [q])).id
  await rpc(u, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return { op, q, r }
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor', { equipo: equipo.id })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  jarval = await crearUsuario(db, 'Jarval', 'jarval')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo in ('E1-PB-A2', 'E1-P1-A1', 'E1-P1-A2', 'E1-P2-A1', 'E1-P2-A2')`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('reasignación de un cliente', () => {
  let c: string, op: string, q: string, tercero: string

  beforeAll(async () => {
    c = await nuevoCliente(cora, 'Cliente por reasignar', { origen: 'corredor', origen_detalle: 'Cora Corredora' })
    op = (await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A1', null) as id`, [c])).id
    q = (await rpc<{ id: string }>(cora, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    tercero = (await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A2', null) as id`, [c])).id
    await rpc(admin, `select public.oportunidades_transferir($1, $2, 'Especialista de ese edificio')`, [tercero, vera])
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Reorganización de cartera')`, [c, carlos])
  })

  it('el nuevo asesor recibe el expediente completo', async () => {
    expect(await cuenta(carlos, 'clients', 'id', c)).toBe(1)
    expect(await cuenta(carlos, 'client_activities', 'client_id', c)).toBeGreaterThan(0)
    expect(await cuenta(carlos, 'opportunities', 'id', op)).toBe(1)
    expect(await cuenta(carlos, 'quotes', 'id', q)).toBe(1)
    expect((await uno<{ responsable_id: string }>(`select responsable_id from public.opportunities where id = $1`, [op])).responsable_id).toBe(carlos)
  })

  it('el anterior pierde el acceso por RLS, aunque haya creado el cliente y la cotización', async () => {
    for (const [tabla, col, id] of [['clients', 'id', c], ['client_activities', 'client_id', c], ['opportunities', 'id', op], ['quotes', 'id', q]]) {
      expect(await cuenta(cora, tabla, col, id)).toBe(0)
    }
    await expect(rpc(cora, `select public.clientes_registrar_actividad(null, $1, 'nota', (now() at time zone 'America/Guayaquil')::date, 'Sigo aquí', null)`, [c])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(cora, `select public.cotizaciones_emitir($1, 0, 30, '')`, [op])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(cora, `select public.cotizaciones_aceptar($1, 'Intento')`, [q])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(cora, `select public.reservas_solicitar($1)`, [q])).rejects.toThrow(/fuera de tu alcance/)
  })

  it('el supervisor del asesor anterior también deja de verlo', async () => {
    expect(await cuenta(sofia, 'clients', 'id', c)).toBe(0)
  })

  it('quien tiene una negociación transferida conserva acceso mientras siga abierta', async () => {
    expect(await cuenta(vera, 'clients', 'id', c)).toBe(1)
    await rpc(vera, `select public.clientes_registrar_actividad(null, $1, 'llamada', (now() at time zone 'America/Guayaquil')::date, 'Llamada de la especialista', null)`, [c])
    await rpc(vera, `select public.oportunidades_cerrar($1, 'Prefiere otro edificio')`, [tercero])
    expect(await cuenta(vera, 'clients', 'id', c)).toBe(0)
  })

  it('conserva atribución, origen, fecha, motivo y responsables', async () => {
    const f = await uno<{ atribucion_usuario_id: string; corredor_origen_id: string; origen: string; created_by: string }>(`select * from public.clients where id = $1`, [c])
    expect(f).toMatchObject({ atribucion_usuario_id: cora, corredor_origen_id: cora, origen: 'corredor', created_by: cora })
    const a = await uno<{ actor_id: string; motivo: string; antes: { asesor_id: string }; despues: { asesor_id: string }; fecha: string }>(`select * from public.audit_log where entidad_id = $1 and accion = 'Reasignar cliente'`, [c])
    expect(a).toMatchObject({ actor_id: admin, motivo: 'Reorganización de cartera', antes: { asesor_id: cora }, despues: { asesor_id: carlos } })
    expect(a.fecha).toBeTruthy()
    const o = await uno<{ motivo: string }>(`select motivo from public.audit_log where entidad_id = $1 and accion = 'Reasignar oportunidad' order by fecha desc limit 1`, [op])
    expect(o.motivo).toBe('Reorganización de cartera')
  })

  it('administración conserva toda la trazabilidad', async () => {
    expect(await cuenta(admin, 'clients', 'id', c)).toBe(1)
    const h = await como(db, admin, async () => (await db.query(`select 1 from public.audit_log where entidad_id = $1`, [c])).rows.length)
    expect(h).toBeGreaterThan(0)
  })

  it('una autorización expresa mantiene el acceso, y se puede revocar con motivo', async () => {
    const x = await nuevoCliente(cora, 'Con acceso autorizado')
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Comparten la negociación', true)`, [x, carlos])
    expect(await cuenta(cora, 'clients', 'id', x)).toBe(1)
    const vistos = (await cargarClientes(datosPglite(db, carlos))).state.clientes.find((k) => k.id === x)!
    expect(vistos.accesos?.map((a) => a.nombre)).toEqual(['Cora Corredora'])
    await expect(rpc(carlos, `select public.clientes_revocar_acceso($1, $2, 'Sin permiso')`, [x, cora])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(admin, `select public.clientes_revocar_acceso($1, $2, 'no')`, [x, cora])).rejects.toThrow(/motivo/)
    await rpc(admin, `select public.clientes_revocar_acceso($1, $2, 'Terminó la colaboración')`, [x, cora])
    expect(await cuenta(cora, 'clients', 'id', x)).toBe(0)
    const fila = await uno<{ revocado_por: string; revocado_en: string; motivo: string }>(`select * from public.client_access where client_id = $1`, [x])
    expect(fila.revocado_por).toBe(admin)
    expect(fila.motivo).toBe('Comparten la negociación')
  })

  it('nadie se autoriza acceso sin permiso, ni escribe directo en la tabla', async () => {
    const x = await nuevoCliente(carlos, 'Ajeno para Cora')
    await expect(rpc(cora, `select public.clientes_autorizar_acceso($1, $2, 'Lo quiero ver')`, [x, cora])).rejects.toThrow(/fuera de tu alcance/)
    await expect(como(db, cora, () => db.query(`insert into public.client_access (client_id, usuario_id, motivo) values ($1, $2, 'Directo')`, [x, cora]))).rejects.toThrow(/row-level security/)
    await rpc(admin, `select public.clientes_autorizar_acceso($1, $2, 'Autorización de administración')`, [x, cora])
    expect(await cuenta(cora, 'clients', 'id', x)).toBe(1)
  })
})

describe('origen y atribución para comisiones', () => {
  it('el corredor que registra a su cliente queda como corredor de origen', async () => {
    const c = await nuevoCliente(carlos, 'Traído por Carlos', { origen: 'corredor', origen_detalle: 'Carlos Corredor' })
    expect(await uno(`select corredor_origen_id, atribucion_usuario_id from public.clients where id = $1`, [c])).toEqual({ corredor_origen_id: carlos, atribucion_usuario_id: carlos })
  })

  it('administración registra en nombre de un corredor: la atribución es de quien registró y el corredor de origen se conserva aparte', async () => {
    const c = await nuevoCliente(admin, 'Registrado por admin', { origen: 'corredor', origen_detalle: 'Cora Corredora', corredor_origen_id: cora })
    expect(await uno(`select corredor_origen_id, atribucion_usuario_id from public.clients where id = $1`, [c])).toEqual({ corredor_origen_id: cora, atribucion_usuario_id: admin })
  })

  it('un corredor no se atribuye clientes en nombre de otro, ni se indica a alguien que no es corredor', async () => {
    await expect(nuevoCliente(cora, 'En nombre de otro', { origen: 'corredor', origen_detalle: 'Carlos', corredor_origen_id: carlos })).rejects.toThrow(/otro corredor/)
    await expect(nuevoCliente(admin, 'No es corredor', { origen: 'corredor', origen_detalle: 'Vera', corredor_origen_id: vera })).rejects.toThrow(/corredor activo/)
    await expect(nuevoCliente(admin, 'Origen incoherente', { corredor_origen_id: cora })).rejects.toThrow(/solo aplica/)
  })

  it('el origen no se cambia después; solo una corrección autorizada y auditada', async () => {
    const c = await nuevoCliente(cora, 'Origen fijo', { origen: 'instagram' })
    const datos = JSON.stringify({ nombre: 'Origen fijo', telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'corredor', origen_detalle: 'Cora' })
    await expect(rpc(cora, `select public.clientes_editar($1, null, $2::jsonb)`, [c, datos])).rejects.toThrow(/no se cambia/)
    await expect(rpc(vera, `select public.clientes_corregir_origen($1, null, 'corredor', 'Cora', null, 'Sin permiso')`, [c])).rejects.toThrow(/Sin permiso/)
    await rpc(admin, `select public.clientes_corregir_origen($1, null, 'corredor', 'Cora Corredora', $2, 'Disputa resuelta por gerencia')`, [c, cora])
    expect(await uno(`select origen, corredor_origen_id from public.clients where id = $1`, [c])).toEqual({ origen: 'corredor', corredor_origen_id: cora })
    const a = await uno<{ antes: { origen: string }; motivo: string }>(`select * from public.audit_log where entidad_id = $1 and accion = 'Corregir origen de cliente'`, [c])
    expect(a).toMatchObject({ motivo: 'Disputa resuelta por gerencia', antes: { origen: 'instagram' } })
  })
})

describe('cliente → oportunidad → cotización → reserva → contrato → cobranza', () => {
  let c: string, f: { op: string; q: string; r: string }, contrato: string

  beforeAll(async () => {
    c = await nuevoCliente(carlos, 'Flujo integral', { origen: 'corredor', origen_detalle: 'Carlos Corredor', documento: '1712345675', email: 'integral@correo.com' })
    f = await reservaAprobada(carlos, c, 'E1-PB-A2')
    contrato = (await rpc<{ id: string }>(admin, `select public.contratos_crear($1, $2::date, 'Contrato del flujo integral') as id`, [f.r, hoyGuayaquil()])).id
  })

  it('cada módulo lee el mismo cliente, unidad y precio, sin copias divergentes', async () => {
    const q = await uno<{ client_id: string; opportunity_id: string; codigo: string; precio_final: string; cliente: { nombre: string; documento: string } }>(`select * from public.quotes where id = $1`, [f.q])
    const r = await uno<{ client_id: string; opportunity_id: string; codigo_unidad: string; precio_acordado: string; quote_id: string }>(`select * from public.reservations where id = $1`, [f.r])
    const k = await uno<{ client_id: string; opportunity_id: string; codigo_unidad: string; precio: string; reservation_id: string }>(`select * from public.contracts where id = $1`, [contrato])
    expect(q).toMatchObject({ client_id: c, opportunity_id: f.op, codigo: 'E1-PB-A2', cliente: { nombre: 'Flujo integral', documento: '1712345675' } })
    expect(r).toMatchObject({ client_id: c, opportunity_id: f.op, codigo_unidad: 'E1-PB-A2', quote_id: f.q })
    expect(k).toMatchObject({ client_id: c, opportunity_id: f.op, codigo_unidad: 'E1-PB-A2', reservation_id: f.r })
    expect(r.precio_acordado).toBe(q.precio_final)
    expect(k.precio).toBe(q.precio_final)
    for (const [t, col] of [['clients', 'nombre'], ['opportunities', 'client_id'], ['reservations', 'client_id'], ['contracts', 'client_id']]) {
      const v = t === 'clients' ? 'Flujo integral' : c
      expect((await uno<{ n: number }>(`select count(*)::int as n from public.${t} where ${col} = $1`, [v])).n).toBe(1)
    }
  })

  it('el historial del cliente refleja el flujo y la unidad queda reservada', async () => {
    const lista = (await cargarClientes(datosPglite(db, carlos))).state.clientes.find((x) => x.id === c)!
    expect(lista.etapa).toBe('reserva')
    expect(lista.cotizaciones).toHaveLength(1)
    expect(lista.actividades.filter((a) => a.tipo === 'cotizacion')).toHaveLength(1)
    expect((await uno<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).estado).toBe('reservado')
  })

  it('cobranza lee el mismo contrato y el dinero de la reserva ya verificado', async () => {
    await aprobarCumplimiento(db)
    await rpc(admin, `select public.contratos_firmar($1, 'Firma de prueba', 'contratos/x.pdf')`, [contrato])
    const d = await cargarCobranza(datosPglite(db, finanzas))
    expect(d.contratos.find((x) => x.id === contrato)).toMatchObject({ cliente: 'Flujo integral', responsable: 'Carlos Corredor', estado: 'firmado' })
    const pagos = d.pagos.filter((p) => p.contratoId === contrato && p.estado === 'verificado')
    expect(pagos).toHaveLength(1)
  })

  it('cada rol ve solo lo suyo en toda la cadena', async () => {
    // Otro corredor: nada.
    for (const [t, col, id] of [['clients', 'id', c], ['quotes', 'id', f.q], ['reservations', 'id', f.r], ['contracts', 'id', contrato]]) {
      expect(await cuenta(cora, t, col, id)).toBe(0)
    }
    // El corredor consulta su reserva, su contrato y sus pagos; otro corredor no (arriba).
    expect(await cuenta(carlos, 'reservations', 'id', f.r)).toBe(1)
    expect(await cuenta(carlos, 'contracts', 'id', contrato)).toBe(1)
    expect(await cuenta(carlos, 'payments', 'contract_id', contrato)).toBe(1)
    expect(await cuenta(cora, 'payments', 'contract_id', contrato)).toBe(0)
    // Finanzas ve dinero y contrato; JARVAL consulta la reserva, sin los datos del cliente.
    expect(await cuenta(finanzas, 'payments', 'contract_id', contrato)).toBe(1)
    expect(await cuenta(jarval, 'reservations', 'id', f.r)).toBe(1)
    expect(await cuenta(jarval, 'clients', 'id', c)).toBe(0)
  })

  it('quien solicita no verifica, y quien verifica no aprueba', async () => {
    const x = await nuevoCliente(gerente, 'Segregación')
    const op = (await rpc<{ id: string }>(gerente, `select public.oportunidades_crear($1, 'E1-P2-A1', null) as id`, [x])).id
    const q = (await rpc<{ id: string }>(gerente, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(gerente, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
    const r = (await rpc<{ id: string }>(gerente, `select public.reservas_solicitar($1) as id`, [q])).id
    await expect(rpc(gerente, `select public.reservas_aprobar($1, 'Aprobar sin pago')`, [r])).rejects.toThrow(/verificado por Finanzas/)
    await expect(rpc(finanzas, `select public.reservas_confirmar_pago($1, 1, $2::date, 'REF', true, 'Sin comprobante')`, [r, hoyGuayaquil()])).rejects.toThrow(/comprobante/)
    await rpc(gerente, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r])
    await expect(rpc(gerente, `select public.reservas_confirmar_pago($1, 1, $2::date, 'REF', true, 'Sin permiso')`, [r, hoyGuayaquil()])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(gerente, `select public.reservas_anular($1, 'Prueba terminada')`, [r])).rejects.toThrow(/requiere autorización/)
  })

  it('la venta conserva quién intervino aunque el cliente se reasigne después, y no crea ninguna comisión', async () => {
    const antes = await uno(`select asesor_id, responsable_id, atribucion_usuario_id, corredor_origen_id, origen, precio, codigo_unidad, client_id from public.contracts where id = $1`, [contrato])
    expect(antes).toMatchObject({ asesor_id: carlos, responsable_id: carlos, atribucion_usuario_id: carlos, corredor_origen_id: carlos, origen: 'corredor', codigo_unidad: 'E1-PB-A2', client_id: c })
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Salida del corredor')`, [c, vera])
    expect(await uno(`select asesor_id, responsable_id, atribucion_usuario_id, corredor_origen_id, origen, precio, codigo_unidad, client_id from public.contracts where id = $1`, [contrato])).toEqual(antes)
    expect((await uno<{ asesor_id: string; atribucion_usuario_id: string; corredor_origen_id: string }>(`select * from public.clients where id = $1`, [c]))).toMatchObject({ asesor_id: vera, atribucion_usuario_id: carlos, corredor_origen_id: carlos })
    const t = await uno<{ n: number }>(`select count(*)::int as n from public.comision_movimientos where tipo = 'pago'`)
    expect(t.n).toBe(0)
  })
})

describe('cierre de la importación', () => {
  const fila = (id: string) => [{ origen_id: id, nombre: 'Importado', telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'whatsapp', etapa: 'nuevo', asesor_id: 'x', actividades: [] }]

  it('administración la cierra; el equipo ya no puede usarla y administración conserva la recuperación', async () => {
    await expect(rpc(carlos, `select public.clientes_importacion_definir(false, 'Quiero cerrarla')`)).rejects.toThrow(/Solo administración/)
    await rpc(carlos, `select public.clientes_importar($1::jsonb)`, [JSON.stringify(fila('antes'))])
    await rpc(admin, `select public.clientes_importacion_definir(false, 'Migración terminada')`)
    await expect(rpc(carlos, `select public.clientes_importar($1::jsonb)`, [JSON.stringify(fila('cerrada'))])).rejects.toThrow(/cerrada/)
    await expect(rpc(carlos, `select public.clientes_importar_revisar($1::jsonb)`, [JSON.stringify(fila('cerrada'))])).rejects.toThrow(/cerrada/)
    const r = await rpc<{ r: { estado: string }[] }>(admin, `select public.clientes_importar($1::jsonb) as r`, [JSON.stringify(fila('recuperacion'))])
    expect(r.r[0].estado).toBe('importado')
    const d = await cargarClientes(datosPglite(db, carlos))
    expect(d.importacionAbierta).toBe(false)
    const a = await uno<{ motivo: string; actor_id: string }>(`select * from public.audit_log where accion = 'Definir importación de clientes'`)
    expect(a).toMatchObject({ motivo: 'Migración terminada', actor_id: admin })
  })
})
