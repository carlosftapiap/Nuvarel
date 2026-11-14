// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { cargarCobranza } from '../../src/features/cobranza/api'
import type { Cliente, ClientesState } from '../../src/features/clientes/model'
import { cargarClientes, importarClientes, persistirCambios, revisarImportacion, verificarImportacion } from '../../src/features/clientes/remoto'
import { actualizarCliente, completarProxima, crearCliente, moverEtapa, programarProxima, registrarActividad, vincularCotizacion, type ClienteInput } from '../../src/features/clientes/service'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import type { Actor } from '../../src/features/inventario/types'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario, aprobarCumplimiento, celularPrueba } from './db'

let db: PGlite
let admin: string, gerente: string, sofia: string, cora: string, carlos: string, vera: string, finanzas: string, jarval: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, params: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, params)).rows[0])
const visibles = (u: string) => como(db, u, async () => (await db.query<{ nombre: string }>(`select nombre from public.clients order by nombre`)).rows.map((r) => r.nombre))
const cliente = (id: string) => uno<{ etapa: string; asesor_id: string; atribucion_usuario_id: string; version: number; proxima_tipo: string | null; motivo_perdida: string; unidades_interes: string[]; nombre: string }>(`select * from public.clients where id = $1`, [id])
const version = async (id: string) => (await cliente(id)).version

async function actorDe(id: string): Promise<Actor> {
  const s = await rpc<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(id, `select public.mi_sesion() as s`)
  return { id: s.s.id, nombre: s.s.nombre, rol: s.s.rol, permisos: s.s.permisos, alcance: { tipo: s.s.alcance, usuarios: s.s.usuariosAlcance } }
}

let telefono = 990100000
const entrada = (u: string, o: Partial<ClienteInput> = {}): ClienteInput => ({
  nombre: 'Cliente de prueba', telefono: celularPrueba(++telefono), email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [],
  presupuesto: null, proposito: null, formaPago: null, asesorId: u, asesor: 'Asesor', ...o,
})

/** Crea el cliente por el mismo camino que la app: regla pura, función del servidor y lectura desde la base. */
async function crear(u: string, o: Partial<ClienteInput> = {}) {
  const datos = datosPglite(db, u)
  const actor = await actorDe(u)
  const prev = (await cargarClientes(datos)).state
  const r = crearCliente(prev, entrada(u, o), actor)
  await persistirCambios(datos, prev, r.state)
  return r.cliente.id
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor', { equipo: equipo.id })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  vera = await crearUsuario(db, 'Vera', 'asesor', { equipo: equipo.id })
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  jarval = await crearUsuario(db, 'Jarval', 'jarval')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo in ('E1-PB-A2', 'E1-P1-A1', 'E1-P1-A2')`)
}, 60_000)

describe('persistencia', () => {
  it('crear un cliente lo deja en la base y otra sesión del mismo usuario lo lee', async () => {
    const id = await crear(cora, { nombre: 'Lucía Persistente', telefono: '0991112233', origen: 'instagram' })
    expect((await cliente(id)).nombre).toBe('Lucía Persistente')
    const otraSesion = (await cargarClientes(datosPglite(db, cora))).state.clientes.find((c) => c.id === id)!
    expect(otraSesion).toMatchObject({ nombre: 'Lucía Persistente', telefono: '+593991112233', origen: 'instagram', etapa: 'nuevo', asesorId: cora, version: 1 })
    expect(otraSesion.atribucion.usuarioId).toBe(cora)
    expect(otraSesion.actividades.map((a) => a.descripcion)).toEqual(['Cliente registrado · origen instagram'])
  })

  it('una llamada queda guardada y pasa al cliente a Contactado una sola vez', async () => {
    const id = await crear(cora, { nombre: 'Marta Llamada' })
    const datos = datosPglite(db, cora)
    const actor = await actorDe(cora)
    const prev = (await cargarClientes(datos)).state
    const next = registrarActividad(prev, id, { tipo: 'llamada', descripcion: 'Busca 2 habitaciones', fecha: hoyGuayaquil() }, actor)
    await persistirCambios(datos, prev, next)
    const c = (await cargarClientes(datos)).state.clientes.find((x) => x.id === id)!
    expect(c.etapa).toBe('contactado')
    expect(c.actividades.filter((a) => a.tipo === 'llamada').map((a) => a.descripcion)).toEqual(['Busca 2 habitaciones'])
    expect(c.actividades.filter((a) => a.tipo === 'etapa')).toHaveLength(1)
    expect(c.actividades.filter((a) => a.tipo === 'llamada')[0].usuario).toBe('Cora Corredora')
  })

  it('repetir el registro de una actividad no la duplica', async () => {
    const id = await crear(cora, { nombre: 'Rita Repetida' })
    const act = (await uno<{ id: string }>(`select gen_random_uuid() as id`)).id
    const hoy = hoyGuayaquil()
    for (let i = 0; i < 2; i++) await rpc(cora, `select public.clientes_registrar_actividad($1, $2, 'nota', $3::date, 'Nota única', null)`, [act, id, hoy])
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.client_activities where client_id = $1 and tipo = 'nota' and descripcion = 'Nota única'`, [id])
    expect(n.n).toBe(1)
  })

  it('mover de etapa persiste y deja historial; dos personas con la misma versión no se pisan', async () => {
    const id = await crear(cora, { nombre: 'Eva Etapa', unidadesInteres: ['E1-PB-A2'] })
    const datos = datosPglite(db, cora)
    const actor = await actorDe(cora)
    const prev = (await cargarClientes(datos)).state
    await persistirCambios(datos, prev, moverEtapa(prev, id, 'calificado', actor))
    expect((await cliente(id)).etapa).toBe('calificado')
    // La segunda persona trabaja con la versión anterior, ya vencida.
    await expect(persistirCambios(datos, prev, moverEtapa(prev, id, 'visita', actor))).rejects.toThrow(/Otra persona modificó/)
    expect((await cliente(id)).etapa).toBe('calificado')
  })
})

describe('varias escrituras en una misma acción', () => {
  const recargar = async (u: string, id: string) => (await cargarClientes(datosPglite(db, u))).state.clientes.find((x) => x.id === id)!

  it('completar la próxima actividad de un cliente nuevo guarda el historial, avanza la etapa y limpia la agenda', async () => {
    const id = await crear(cora, { nombre: 'Agenda completa' })
    const datos = datosPglite(db, cora)
    const actor = await actorDe(cora)
    let prev = (await cargarClientes(datos)).state
    await persistirCambios(datos, prev, programarProxima(prev, id, { tipo: 'llamada', descripcion: 'Llamar el lunes', fecha: '2026-12-01' }, actor))
    expect((await recargar(cora, id)).proxima).toMatchObject({ tipo: 'llamada', descripcion: 'Llamar el lunes', fecha: '2026-12-01' })
    prev = (await cargarClientes(datos)).state
    await persistirCambios(datos, prev, completarProxima(prev, id, 'Interesada', actor))
    const c = await recargar(cora, id)
    expect(c).toMatchObject({ etapa: 'contactado', proxima: null })
    expect(c.actividades.some((a) => a.tipo === 'llamada' && a.descripcion === 'Llamar el lunes · resultado: Interesada')).toBe(true)
  })

  it('vincular una cotización guarda el interés, la referencia y la etapa', async () => {
    const id = await crear(vera, { nombre: 'Cotización vinculada' })
    const datos = datosPglite(db, vera)
    const prev = (await cargarClientes(datos)).state
    await persistirCambios(datos, prev, vincularCotizacion(prev, id, { numero: 'COT-LOCAL-1', codigo: 'E1-PB-A2', precioFinal: 170000 }, await actorDe(vera)))
    const c = await recargar(vera, id)
    expect(c).toMatchObject({ etapa: 'cotizacion', unidadesInteres: ['E1-PB-A2'], cotizaciones: ['COT-LOCAL-1'] })
  })

  it('editar datos y reasignar en un mismo guardado aplica ambos', async () => {
    const id = await crear(admin, { nombre: 'Doble cambio' })
    const datos = datosPglite(db, admin)
    const prev = (await cargarClientes(datos)).state
    const c = prev.clientes.find((x) => x.id === id)!
    await persistirCambios(datos, prev, actualizarCliente(prev, id, { ...c, presupuesto: 150000, asesorId: vera, asesor: 'Vera', motivoAsignacion: 'Cambio de cartera' }, await actorDe(admin)))
    expect(await recargar(admin, id)).toMatchObject({ presupuesto: 150000, asesorId: vera })
  })
})

describe('permisos y RLS con usuarios de prueba', () => {
  let deCora: string
  beforeAll(async () => {
    deCora = await crear(cora, { nombre: 'Alcance de Cora' })
    await crear(carlos, { nombre: 'Alcance de Carlos' })
    await crear(vera, { nombre: 'Alcance de Vera' })
  })

  it('un corredor ve solo sus clientes', async () => {
    const lista = await visibles(carlos)
    expect(lista).toContain('Alcance de Carlos')
    expect(lista).not.toContain('Alcance de Cora')
    expect(lista).not.toContain('Alcance de Vera')
  })

  it('un supervisor ve los de su equipo y no los de otros', async () => {
    const lista = await visibles(sofia)
    expect(lista).toEqual(expect.arrayContaining(['Alcance de Cora', 'Alcance de Vera']))
    expect(lista).not.toContain('Alcance de Carlos')
  })

  it('administración y gerencia ven todos; quien no tiene clientes.ver no ve ninguno', async () => {
    expect(await visibles(admin)).toEqual(expect.arrayContaining(['Alcance de Cora', 'Alcance de Carlos', 'Alcance de Vera']))
    expect(await visibles(gerente)).toEqual(expect.arrayContaining(['Alcance de Cora', 'Alcance de Carlos', 'Alcance de Vera']))
    expect(await visibles(jarval)).toEqual([])
  })

  it('las actividades y negociaciones siguen el mismo alcance', async () => {
    const n = await como(db, carlos, async () => (await db.query(`select 1 from public.client_activities where client_id = $1`, [deCora])).rows.length)
    expect(n).toBe(0)
    await rpc(cora, `select public.oportunidades_crear($1, 'E1-P1-A2', null)`, [deCora])
    const o = await como(db, carlos, async () => (await db.query(`select 1 from public.opportunities where client_id = $1`, [deCora])).rows.length)
    expect(o).toBe(0)
  })

  it('no se puede escribir directo en las tablas, ni siquiera en un cliente propio', async () => {
    await expect(como(db, cora, () => db.query(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by) values ('Directo', '1715099998', '0990009999', 'whatsapp', $1, $1)`, [cora]))).rejects.toThrow(/row-level security/)
    await expect(como(db, cora, () => db.query(`update public.clients set nombre = 'Cambiado' where id = $1`, [deCora]))).rejects.toThrow(/row-level security/)
    await expect(como(db, cora, () => db.query(`insert into public.client_activities (client_id, tipo, fecha, descripcion, user_id) values ($1, 'nota', (now() at time zone 'America/Guayaquil')::date, 'Directa', $2)`, [deCora, cora]))).rejects.toThrow(/row-level security/)
    await expect(como(db, cora, () => db.query(`insert into public.opportunities (client_id, responsable_id, created_by) values ($1, $2, $2)`, [deCora, cora]))).rejects.toThrow(/row-level security/)
    const op = await uno<{ id: string }>(`select id from public.opportunities where client_id = $1`, [deCora])
    await expect(como(db, cora, () => db.query(`update public.opportunities set responsable_id = $1 where id = $2`, [carlos, op.id]))).rejects.toThrow(/permiso|row-level security/)
    await expect(como(db, admin, () => db.query(`update public.clients set etapa = 'visita' where id = $1`, [deCora]))).rejects.toThrow(/row-level security/)
    expect((await cliente(deCora)).nombre).toBe('Alcance de Cora')
  })

  it('sin sesión (anon) no se ejecutan las funciones', async () => {
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select public.clientes_crear(gen_random_uuid(), '{}'::jsonb, gen_random_uuid())`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.clientes_personas()`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })

  it('las funciones internas no se pueden llamar directamente', async () => {
    await expect(rpc(cora, `select public.clientes_nota($1, 'nota', 'Falsa')`, [deCora])).rejects.toThrow(/permission denied/)
    await expect(rpc(cora, `select public.clientes_tomar($1, null)`, [deCora])).rejects.toThrow(/permission denied/)
  })

  it('un corredor no modifica clientes ajenos aunque conozca el identificador', async () => {
    await expect(rpc(carlos, `select public.clientes_mover_etapa($1, null, 'contactado', null, null)`, [deCora])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(carlos, `select public.clientes_registrar_actividad(gen_random_uuid(), $1, 'nota', (now() at time zone 'America/Guayaquil')::date, 'Ajena', null)`, [deCora])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(carlos, `select public.clientes_editar($1, null, '{"nombre": "Robado", "telefono": "0990007777", "origen": "whatsapp"}'::jsonb)`, [deCora])).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(carlos, `select public.oportunidades_crear($1, 'E1-PB-A2', null)`, [deCora])).rejects.toThrow(/fuera de tu alcance/)
  })

  it('quien no tiene permiso no puede registrar clientes', async () => {
    await expect(rpc(jarval, `select public.clientes_crear(gen_random_uuid(), '{"nombre": "Sin permiso", "telefono": "0990006666", "origen": "whatsapp"}'::jsonb, $1)`, [jarval])).rejects.toThrow(/Sin permiso/)
  })

  it('el servidor valida los datos aunque la app no lo haga', async () => {
    await expect(rpc(cora, `select public.clientes_crear(gen_random_uuid(), '{"nombre": "Yo", "telefono": "0990005555", "origen": "whatsapp"}'::jsonb, $1)`, [cora])).rejects.toThrow(/nombre/)
    await expect(rpc(cora, `select public.clientes_crear(gen_random_uuid(), '{"nombre": "Sin contacto", "origen": "whatsapp"}'::jsonb, $1)`, [cora])).rejects.toThrow(/teléfono o un correo/)
    await expect(rpc(cora, `select public.clientes_crear(gen_random_uuid(), '{"nombre": "Unidad falsa", "telefono": "0990005554", "origen": "whatsapp", "unidades_interes": ["NO-EXISTE"]}'::jsonb, $1)`, [cora])).rejects.toThrow(/no existen en el inventario/)
  })
})

describe('asignación', () => {
  it('administración asigna a un corredor: registra motivo y responsable anterior, y la atribución no cambia', async () => {
    const id = await crear(admin, { nombre: 'Asignado a corredor' })
    const datos = datosPglite(db, admin)
    const prev = (await cargarClientes(datos)).state
    const c = prev.clientes.find((x) => x.id === id)!
    const entradaActual: ClienteInput = { ...c, asesorId: carlos, asesor: 'Carlos Corredor', motivoAsignacion: 'Corredor de la zona' }
    await persistirCambios(datos, prev, actualizarCliente(prev, id, entradaActual, await actorDe(admin)))
    const fila = await cliente(id)
    expect(fila.asesor_id).toBe(carlos)
    expect(fila.atribucion_usuario_id).toBe(admin)
    const a = await uno<{ motivo: string; antes: { asesor_id: string }; despues: { asesor_id: string }; actor_id: string }>(`select * from public.audit_log where entidad_id = $1 and accion = 'Reasignar cliente'`, [id])
    expect(a).toMatchObject({ motivo: 'Corredor de la zona', actor_id: admin, antes: { asesor_id: admin }, despues: { asesor_id: carlos } })
    expect(await visibles(carlos)).toContain('Asignado a corredor')
    const h = (await cargarClientes(datosPglite(db, carlos))).state.clientes.find((x) => x.id === id)!
    expect(h.actividades.some((x) => /Asesor reasignado: Admin → Carlos Corredor · motivo: Corredor de la zona/.test(x.descripcion))).toBe(true)
    expect(h.atribucion.nombre).toBe('Admin')
  })

  it('exige motivo, permiso y alcance', async () => {
    const id = await crear(cora, { nombre: 'Por reasignar' })
    await expect(rpc(sofia, `select public.clientes_asignar($1, null, $2, 'no')`, [id, vera])).rejects.toThrow(/motivo/)
    await expect(rpc(cora, `select public.clientes_asignar($1, null, $2, 'Quiero cederlo')`, [id, vera])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(sofia, `select public.clientes_asignar($1, null, $2, 'Fuera de mi equipo')`, [id, carlos])).rejects.toThrow(/Sin permiso/)
    await rpc(sofia, `select public.clientes_asignar($1, null, $2, 'Cambio dentro del equipo')`, [id, vera])
    expect((await cliente(id)).asesor_id).toBe(vera)
  })

  it('no se asigna a una persona inactiva', async () => {
    const id = await crear(admin, { nombre: 'Para inactivo' })
    const inactivo = await crearUsuario(db, 'Inactivo', 'corredor')
    await db.query(`update public.profiles set estado = 'inactivo' where id = $1`, [inactivo])
    await expect(rpc(admin, `select public.clientes_asignar($1, null, $2, 'Asignación de prueba')`, [id, inactivo])).rejects.toThrow(/activo/)
  })

  it('un corredor no se crea clientes a nombre de otra persona', async () => {
    await expect(rpc(cora, `select public.clientes_crear(gen_random_uuid(), '{"nombre": "A nombre de otro", "telefono": "0990004444", "origen": "whatsapp"}'::jsonb, $1)`, [carlos])).rejects.toThrow(/Sin permiso/)
  })
})

describe('duplicados', () => {
  it('el teléfono y el correo no se repiten, aunque el otro cliente sea de otro equipo y con otro formato', async () => {
    await crear(cora, { nombre: 'Original', telefono: '0992223344', email: 'original@correo.com' })
    await expect(crear(carlos, { nombre: 'Copia', telefono: '+593 99 222 3344' })).rejects.toThrow(/^Este celular ya se encuentra registrado en AMURA\.$/)
    await expect(crear(carlos, { nombre: 'Copia', telefono: '0992220000', email: 'ORIGINAL@correo.com' })).rejects.toThrow(/Este cliente ya se encuentra registrado en AMURA/)
    expect(await visibles(carlos)).not.toContain('Copia')
  })
})

describe('etapas', () => {
  it('perdido exige motivo y seguimiento una fecha futura', async () => {
    const id = await crear(cora, { nombre: 'Reglas de etapa' })
    await expect(rpc(cora, `select public.clientes_mover_etapa($1, null, 'perdido', 'no', null)`, [id])).rejects.toThrow(/motivo/)
    await expect(rpc(cora, `select public.clientes_mover_etapa($1, null, 'seguimiento', null, (now() at time zone 'America/Guayaquil')::date)`, [id])).rejects.toThrow(/fecha futura/)
    await expect(rpc(cora, `select public.clientes_mover_etapa($1, null, 'inventada', null, null)`, [id])).rejects.toThrow(/Etapa no válida/)
    await rpc(cora, `select public.clientes_mover_etapa($1, null, 'seguimiento', null, (now() at time zone 'America/Guayaquil')::date + 30)`, [id])
    expect(await cliente(id)).toMatchObject({ etapa: 'seguimiento', proxima_tipo: 'llamada' })
  })

  it('cotización y negociación exigen interés en un departamento', async () => {
    const id = await crear(cora, { nombre: 'Sin interés' })
    await expect(rpc(cora, `select public.clientes_mover_etapa($1, null, 'negociacion', null, null)`, [id])).rejects.toThrow(/departamento de interés/)
  })

  it('nadie marca Reserva a mano, ni siquiera administración, ni desde la app ni por la función', async () => {
    const id = await crear(admin, { nombre: 'Reserva manual', unidadesInteres: ['E1-PB-A2'] })
    await expect(rpc(admin, `select public.clientes_mover_etapa($1, null, 'reserva', null, null)`, [id])).rejects.toThrow(/solo cambia al aprobar/)
    await expect(como(db, admin, () => db.query(`update public.clients set etapa = 'reserva' where id = $1`, [id]))).rejects.toThrow(/solo cambia al aprobar/)
    expect((await cliente(id)).etapa).toBe('nuevo')
  })

  it('la app no envía la transición a Reserva: la base conserva la etapa', async () => {
    const id = await crear(admin, { nombre: 'Reserva desde app', unidadesInteres: ['E1-PB-A2'] })
    const datos = datosPglite(db, admin)
    const prev = (await cargarClientes(datos)).state
    const next: ClientesState = { ...prev, clientes: prev.clientes.map((c) => (c.id === id ? { ...c, etapa: 'reserva' as const } : c)) }
    await persistirCambios(datos, prev, next)
    expect((await cliente(id)).etapa).toBe('nuevo')
  })
})

describe('varias negociaciones por cliente', () => {
  it('abre una por unidad o tipología sin duplicar, y hereda el asesor principal', async () => {
    const id = await crear(cora, { nombre: 'Varias negociaciones' })
    const a = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A1', null) as id`, [id])
    const repetida = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A1', null) as id`, [id])
    expect(repetida.id).toBe(a.id)
    const b = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, null, '1 hab') as id`, [id])
    const { rows } = await db.query<{ id: string; responsable_id: string; etapa: string }>(`select id, responsable_id, etapa from public.opportunities where client_id = $1`, [id])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.responsable_id === cora && r.etapa === 'calificacion')).toBe(true)
    expect(b.id).not.toBe(a.id)
    expect((await cliente(id)).unidades_interes).toEqual(['E1-P1-A1'])
    expect((await cliente(id)).etapa).toBe('nuevo')
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.clients where nombre = 'Varias negociaciones'`)
    expect(n.n).toBe(1)
  })

  it('crear un cliente no abre ninguna negociación', async () => {
    const id = await crear(cora, { nombre: 'Sin negociación automática', unidadesInteres: ['E1-PB-A2'] })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.opportunities where client_id = $1`, [id])).n).toBe(0)
  })

  it('exige unidad o tipología, y no abre negociaciones de un cliente perdido', async () => {
    const id = await crear(cora, { nombre: 'Perdido sin negociación' })
    await expect(rpc(cora, `select public.oportunidades_crear($1, null, null)`, [id])).rejects.toThrow(/unidad o una tipología/)
    await expect(rpc(cora, `select public.oportunidades_crear($1, 'E1-PB-A2', '1 hab')`, [id])).rejects.toThrow(/unidad o una tipología/)
    await rpc(cora, `select public.clientes_mover_etapa($1, null, 'perdido', 'Compró en otro proyecto', null)`, [id])
    await expect(rpc(cora, `select public.oportunidades_crear($1, 'E1-PB-A2', null)`, [id])).rejects.toThrow(/perdido/)
  })

  it('una negociación por tipología se vincula a una unidad, y cerrar una no toca las demás ni la etapa', async () => {
    const id = await crear(cora, { nombre: 'Tipología a unidad' })
    await rpc(cora, `select public.clientes_mover_etapa($1, null, 'calificado', null, null)`, [id])
    const t = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, null, '2 hab') as id`, [id])
    const u = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A2', null) as id`, [id])
    await expect(rpc(cora, `select public.oportunidades_vincular_unidad($1, 'E1-P1-A2')`, [t.id])).rejects.toThrow(/ya tiene una negociación abierta/)
    await rpc(cora, `select public.oportunidades_vincular_unidad($1, 'E1-P1-A1')`, [t.id])
    await rpc(cora, `select public.oportunidades_cerrar($1, 'Prefiere otra ubicación')`, [u.id])
    const estados = await db.query<{ id: string; etapa: string; codigo_unidad: string }>(`select id, etapa, codigo_unidad from public.opportunities where client_id = $1 order by created_at`, [id])
    expect(estados.rows.map((r) => r.etapa)).toEqual(['calificacion', 'perdida'])
    expect(estados.rows[0].codigo_unidad).toBe('E1-P1-A1')
    expect((await cliente(id)).etapa).toBe('calificado')
  })

  it('una transferencia autorizada no mueve al asesor principal, y reasignar al asesor no mueve la negociación', async () => {
    const id = await crear(cora, { nombre: 'Transferencia' })
    const o = await rpc<{ id: string }>(cora, `select public.oportunidades_crear($1, 'E1-P1-A1', null) as id`, [id])
    await expect(rpc(cora, `select public.oportunidades_transferir($1, $2, 'Quiero cederla')`, [o.id, vera])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(sofia, `select public.oportunidades_transferir($1, $2, 'no')`, [o.id, vera])).rejects.toThrow(/motivo/)
    await expect(rpc(sofia, `select public.oportunidades_transferir($1, $2, 'Fuera de mi equipo')`, [o.id, carlos])).rejects.toThrow(/Sin permiso/)
    await rpc(sofia, `select public.oportunidades_transferir($1, $2, 'Vera conoce este edificio')`, [o.id, vera])
    expect((await uno<{ responsable_id: string }>(`select responsable_id from public.opportunities where id = $1`, [o.id])).responsable_id).toBe(vera)
    expect(await cliente(id)).toMatchObject({ asesor_id: cora, atribucion_usuario_id: cora })
    const a = await uno<{ motivo: string; antes: { responsable_id: string }; despues: { responsable_id: string } }>(`select * from public.audit_log where entidad_id = $1 and accion = 'Reasignar oportunidad'`, [o.id])
    expect(a).toMatchObject({ motivo: 'Vera conoce este edificio', antes: { responsable_id: cora }, despues: { responsable_id: vera } })

    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Reorganización de cartera')`, [id, carlos])
    expect((await uno<{ responsable_id: string }>(`select responsable_id from public.opportunities where id = $1`, [o.id])).responsable_id).toBe(vera)
  })

  it('marcar perdido cierra las negociaciones sin reserva con el mismo motivo', async () => {
    const id = await crear(cora, { nombre: 'Perdido con negociación' })
    await rpc(cora, `select public.oportunidades_crear($1, 'E1-P1-A1', null)`, [id])
    await rpc(cora, `select public.clientes_mover_etapa($1, null, 'perdido', 'Sin crédito aprobado', null)`, [id])
    const o = await uno<{ etapa: string; motivo_perdida: string }>(`select etapa, motivo_perdida from public.opportunities where client_id = $1`, [id])
    expect(o).toEqual({ etapa: 'perdida', motivo_perdida: 'Sin crédito aprobado' })
  })
})

describe('compatibilidad con cotizaciones, reservas y cobranzas', () => {
  let id: string, opA: string, opB: string, reservaA: string, reservaB: string, cotA: string
  const hoy = () => hoyGuayaquil()

  async function cotizarYReservar(oportunidad: string) {
    const q = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [oportunidad])).id
    await rpc(vera, `select public.cotizaciones_aceptar($1, 'Cliente acepta la cotización')`, [q])
    const r = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar($1) as id`, [q])).id
    await rpc(vera, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
    return { q, r }
  }
  /** Desistimiento de una reserva aprobada con dinero: lo registra un asesor, lo autoriza Gerencia y lo revisa Finanzas. */
  async function desistirAprobada(opp: string, cliente: string) {
    const d = (await rpc<{ id: string }>(vera, `select public.desistimientos_registrar($1, $2, 'cambio_decision', 'Cambio de decisión en prueba') as id`, [cliente, opp])).id
    await rpc(gerente, `select public.desistimientos_autorizar($1, 'Autorizado en prueba')`, [d])
    await rpc(finanzas, `select public.desistimientos_revisar_finanzas($1, 'Retención según política comercial')`, [d])
  }

  async function aprobar(r: string) {
    const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado en banco')`, [r, m.monto_reserva, hoy(), `BAN-${r.slice(0, 8)}`])
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité de prueba')`, [r])
  }

  beforeAll(async () => {
    await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
    await db.query(`update public.inventory_units set estado = 'disponible', reserva_id = null where codigo in ('E1-P2-A1', 'E1-P2-A2')`)
    id = await crear(vera, { nombre: 'Flujo completo', email: 'flujo@correo.com', documento: '1710034065' })
    await rpc(vera, `select public.clientes_mover_etapa($1, null, 'contactado', null, null)`, [id])
    opA = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, 'E1-P2-A1', null) as id`, [id])).id
    opB = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, 'E1-P2-A2', null) as id`, [id])).id
  })

  it('emitir una cotización avanza al cliente desde una etapa anterior, sin duplicar actividades', async () => {
    const r = await cotizarYReservar(opA)
    cotA = r.q; reservaA = r.r
    expect((await cliente(id)).etapa).toBe('cotizacion')
    const q = await uno<{ client_id: string; opportunity_id: string }>(`select client_id, opportunity_id from public.quotes where id = $1`, [cotA])
    expect(q).toEqual({ client_id: id, opportunity_id: opA })
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.client_activities where client_id = $1 and descripcion like '%cotización emitida'`, [id])
    expect(n.n).toBe(1)
    const c = (await cargarClientes(datosPglite(db, vera))).state.clientes.find((x) => x.id === id)!
    expect(c.cotizaciones).toHaveLength(1)
  })

  it('una segunda cotización no retrocede a un cliente que ya está en Negociación', async () => {
    await rpc(vera, `select public.clientes_mover_etapa($1, null, 'negociacion', null, null)`, [id])
    const r = await cotizarYReservar(opB)
    reservaB = r.r
    expect((await cliente(id)).etapa).toBe('negociacion')
  })

  it('con una reserva en curso no se puede dar por perdido ni retroceder al cliente', async () => {
    await expect(rpc(vera, `select public.clientes_mover_etapa($1, null, 'perdido', 'Intento de perderlo', null)`, [id])).rejects.toThrow(/reserva o contrato en curso/)
    await expect(rpc(vera, `select public.clientes_mover_etapa($1, null, 'contactado', null, null)`, [id])).rejects.toThrow(/reserva o contrato en curso/)
    await expect(rpc(vera, `select public.oportunidades_cerrar($1, 'Intento de cerrarla')`, [opA])).rejects.toThrow(/reserva o contrato en curso/)
  })

  it('solo aprobar una reserva lleva al cliente a Reserva, y después la etapa queda protegida', async () => {
    await aprobar(reservaA)
    expect((await cliente(id)).etapa).toBe('reserva')
    await expect(rpc(vera, `select public.clientes_mover_etapa($1, null, 'negociacion', null, null)`, [id])).rejects.toThrow(/solo cambia al aprobar/)
    await expect(rpc(admin, `select public.clientes_mover_etapa($1, null, 'perdido', 'Intento de administración', null)`, [id])).rejects.toThrow(/solo cambia al aprobar/)
  })

  it('desistir de una de dos reservas confirmadas no retrocede al cliente', async () => {
    await aprobar(reservaB)
    await desistirAprobada(opB, id)
    expect((await cliente(id)).etapa).toBe('reserva')
    const oB = await uno<{ etapa: string }>(`select etapa from public.opportunities where id = $1`, [opB])
    expect(oB.etapa).toBe('perdida')
  })

  it('desistir de la única reserva confirmada lleva al cliente a Perdido, y no se puede anular directo', async () => {
    const otro = await crear(vera, { nombre: 'Una sola reserva', email: 'una@correo.com', documento: '1710034073' })
    const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, 'E1-P2-A2', null) as id`, [otro])).id
    const { r } = await cotizarYReservar(op)
    await aprobar(r)
    expect((await cliente(otro)).etapa).toBe('reserva')
    await expect(rpc(gerente, `select public.reservas_anular($1, 'Cliente desiste de la compra')`, [r])).rejects.toThrow(/requiere autorización/)
    await desistirAprobada(op, otro)
    expect((await cliente(otro)).etapa).toBe('perdido')
  })

  it('el contrato y la cobranza siguen funcionando y leen el cliente de la base', async () => {
    const c = (await rpc<{ id: string }>(admin, `select public.contratos_crear($1, $2::date, 'Contrato de prueba de clientes') as id`, [reservaA, hoy()])).id
    await aprobarCumplimiento(db)
    await rpc(admin, `select public.contratos_firmar($1, 'Firma de prueba', 'contratos/firmado.pdf')`, [c])
    expect((await uno<{ etapa: string }>(`select etapa from public.opportunities where id = $1`, [opA])).etapa).toBe('cobranza')
    expect((await cliente(id)).etapa).toBe('reserva')
    const cobranza = await cargarCobranza(datosPglite(db, admin))
    expect(cobranza.contratos.find((x) => x.id === c)).toMatchObject({ cliente: 'Flujo completo', responsable: 'Vera' })
    await expect(rpc(gerente, `select public.reservas_anular($1, 'Intento de anular con contrato')`, [reservaA])).rejects.toThrow(/ya tiene contrato/)
  })

  it('los corredores no leen perfiles ajenos, pero sí los nombres de sus clientes', async () => {
    const creado = await crear(admin, { nombre: 'Nombre visible' })
    await rpc(admin, `select public.clientes_asignar($1, null, $2, 'Asignación de cartera')`, [creado, carlos])
    const perfiles = await como(db, carlos, async () => (await db.query<{ id: string }>(`select id from public.profiles`)).rows.map((r) => r.id))
    expect(perfiles).toEqual([carlos])
    const c = (await cargarClientes(datosPglite(db, carlos))).state.clientes.find((x) => x.id === creado)!
    expect(c.atribucion.nombre).toBe('Admin')
    const personas = await como(db, carlos, async () => (await db.query<{ nombre: string }>(`select nombre from public.clientes_personas()`)).rows.map((r) => r.nombre))
    // Solo personas relacionadas con sus clientes: quien no tiene relación no aparece.
    expect(personas).toContain('Admin')
    expect(personas).not.toContain('Jarval')
  })
})

describe('importación desde el navegador', () => {
  const local = (o: Partial<Cliente>): Cliente => ({
    id: `cli-local-${Math.random().toString(36).slice(2)}`, nombre: 'Local', telefono: '', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [],
    presupuesto: null, proposito: null, formaPago: null, asesorId: 'u-demo-no-uuid', asesor: 'Asesor demo', atribucion: { usuarioId: 'u-demo-no-uuid', nombre: 'Asesor demo', fecha: '2026-10-01' },
    etapa: 'nuevo', motivoPerdida: '', fechaRetomar: null, proxima: null,
    actividades: [{ id: 'act-1', tipo: 'llamada', fecha: '2026-10-02', descripcion: 'Llamada local', usuario: 'Asesor demo', registradaEn: '2026-10-02T10:00:00Z' }],
    cotizaciones: [], creadoPor: { id: 'u-demo-no-uuid', nombre: 'Asesor demo', rol: 'asesor' }, creadoEn: '2026-10-01T10:00:00Z', actualizadoEn: '2026-10-02T10:00:00Z', ...o,
  })
  let filas: Cliente[]

  beforeAll(async () => {
    await crear(carlos, { nombre: 'Ya en otro equipo', telefono: '0993334455' })
    await crear(cora, { nombre: 'Ya en mi cartera', telefono: '0993334466' })
    filas = [
      local({ nombre: 'Nuevo local', telefono: '0994440001', unidadesInteres: ['E1-P1-A1', 'NO-EXISTE'], proxima: { tipo: 'visita', descripcion: 'Mostrar piso', fecha: '2026-12-01' } }),
      local({ nombre: 'Reserva local', telefono: '0994440002', etapa: 'reserva' }),
      local({ nombre: 'Perdido local', telefono: '0994440003', etapa: 'perdido', motivoPerdida: 'Compró en otro proyecto' }),
      local({ nombre: 'Copia de otro equipo', telefono: '+593 99 333 4455' }),
      local({ nombre: 'Copia de mi cartera', telefono: '0993334466' }),
      local({ nombre: 'Repetido uno', telefono: '0994440005', email: 'repetido@correo.com' }),
      local({ nombre: 'Repetido dos', telefono: '0994440006', email: 'REPETIDO@correo.com' }),
      local({ nombre: 'Con error', telefono: '0994440004', etapa: 'perdido', motivoPerdida: 'x' }),
    ]
  })

  it('la vista previa detecta duplicados sin escribir ni revelar datos de otro equipo', async () => {
    const antes = (await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n
    const r = await revisarImportacion(datosPglite(db, cora), filas)
    const de = (nombre: string) => r.find((x) => x.origen_id === filas.find((f) => f.nombre === nombre)!.id)!
    expect(de('Nuevo local').estado).toBe('nuevo')
    expect(de('Copia de otro equipo')).toMatchObject({ estado: 'duplicado', detalle: 'Ya está registrado por otro equipo' })
    expect(de('Copia de mi cartera')).toMatchObject({ estado: 'duplicado', detalle: 'Ya existe: Ya en mi cartera' })
    expect(de('Repetido uno').estado).toBe('nuevo')
    expect(de('Repetido dos')).toMatchObject({ estado: 'duplicado', detalle: 'Repetido en los datos de este navegador' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.clients`)).n).toBe(antes)
  })

  it('importa con su historial; una fila con error no detiene a las demás', async () => {
    const r = await importarClientes(datosPglite(db, cora), filas)
    const de = (nombre: string) => r.find((x) => x.origen_id === filas.find((f) => f.nombre === nombre)!.id)!
    expect(de('Nuevo local').estado).toBe('importado')
    expect(de('Copia de otro equipo').estado).toBe('duplicado')
    expect(de('Repetido dos').estado).toBe('duplicado')
    expect(de('Con error').estado).toBe('error')
    const c = (await cargarClientes(datosPglite(db, cora))).state.clientes.find((x) => x.nombre === 'Nuevo local')!
    // Un asesor de la demostración no existe en la base: el cliente queda a nombre de quien importa.
    expect(c.asesorId).toBe(cora)
    expect(c.unidadesInteres).toEqual(['E1-P1-A1'])
    expect(c.proxima).toMatchObject({ tipo: 'visita', fecha: '2026-12-01' })
    expect(c.creadoEn.slice(0, 10)).toBe('2026-10-01')
    expect(c.actividades.some((a) => a.descripcion === 'Llamada local (registró: Asesor demo)' && a.fecha === '2026-10-02')).toBe(true)
  })

  it('una reserva local no se importa como Reserva, y un perdido conserva su motivo', async () => {
    const lista = (await cargarClientes(datosPglite(db, cora))).state.clientes
    expect(lista.find((x) => x.nombre === 'Reserva local')).toMatchObject({ etapa: 'negociacion' })
    expect(lista.find((x) => x.nombre === 'Reserva local')!.actividades.some((a) => /estaba en Reserva local/.test(a.descripcion))).toBe(true)
    expect(lista.find((x) => x.nombre === 'Perdido local')).toMatchObject({ etapa: 'perdido', motivoPerdida: 'Compró en otro proyecto' })
  })

  it('repetirla no duplica nada y la verificación confirma lo guardado', async () => {
    const contar = async () => (await uno<{ c: number; a: number }>(`select (select count(*)::int from public.clients) as c, (select count(*)::int from public.client_activities) as a`))
    const antes = await contar()
    const r = await importarClientes(datosPglite(db, cora), filas)
    expect(r.find((x) => x.origen_id === filas[0].id)!.estado).toBe('ya_importado')
    expect(await contar()).toEqual(antes)
    const guardados = filas.filter((f) => ['Nuevo local', 'Reserva local', 'Perdido local', 'Repetido uno'].includes(f.nombre))
    expect(await verificarImportacion(datosPglite(db, cora), guardados)).toEqual([])
    // Los que no se guardaron se señalan.
    expect(await verificarImportacion(datosPglite(db, cora), filas.filter((f) => f.nombre === 'Con error'))).toEqual(['Con error'])
  })

  it('sin permiso no se importa ni se revisa, y solo se ve el registro propio de importación', async () => {
    await expect(revisarImportacion(datosPglite(db, jarval), filas)).rejects.toThrow(/Sin permiso/)
    await expect(importarClientes(datosPglite(db, jarval), filas)).rejects.toThrow(/Sin permiso/)
    const propias = await como(db, carlos, async () => (await db.query(`select 1 from public.client_imports`)).rows.length)
    expect(propias).toBe(0)
  })
})

describe('instalación de la migración', () => {
  it('sobre una base sin el cambio del Gantt conserva los datos y se puede repetir', async () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../migrations/20261031000000_clientes_crm.sql'), 'utf8')
    const base = await crearDb({ hasta: '20261029060000_financiamiento_catalogo.sql' })
    const u = await crearUsuario(base, 'Vera', 'asesor')
    const c = (await base.query<{ id: string }>(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id, etapa, unidades_interes) values ('Existente', '0998880001', 'whatsapp', $1, $1, $1, 'visita', '{E1-PB-A2}') returning id`, [u])).rows[0].id
    await base.query(`insert into public.client_activities (client_id, tipo, fecha, descripcion, user_id) values ($1, 'llamada', (now() at time zone 'America/Guayaquil')::date, 'Antes de migrar', $2)`, [c, u])
    await base.exec(sql)
    await base.exec(sql)
    const f = (await base.query<{ nombre: string; etapa: string; version: number; atribucion_usuario_id: string; unidades_interes: string[] }>(`select nombre, etapa, version, atribucion_usuario_id, unidades_interes from public.clients where id = $1`, [c])).rows[0]
    expect(f).toEqual({ nombre: 'Existente', etapa: 'visita', version: 1, atribucion_usuario_id: u, unidades_interes: ['E1-PB-A2'] })
    await base.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`)
    const cargado = (await cargarClientes(datosPglite(base, u))).state.clientes
    expect(cargado).toHaveLength(1)
    expect(cargado[0].actividades.map((a) => a.descripcion)).toEqual(['Antes de migrar'])
    // El cambio del Gantt sigue sin aplicarse: esta migración no depende de él.
    const columna = await base.query(`select 1 from information_schema.columns where table_name = 'plan_activities' and column_name = 'responsable_externo'`)
    expect(columna.rows).toHaveLength(0)
  }, 60_000)
})

describe('lectura por páginas', () => {
  it('trae todas las filas aunque el servidor limite cada respuesta', async () => {
    const datos = datosPglite(db, admin)
    const limitado: typeof datos = { ...datos, select: (t, o) => datos.select(t, { ...o, limite: Math.min(o?.limite ?? 2, 2) }) }
    const todas = (await cargarClientes(datos)).state.clientes.length
    expect(todas).toBeGreaterThan(4)
    expect((await cargarClientes(limitado)).state.clientes).toHaveLength(todas)
    expect(await version((await cargarClientes(limitado)).state.clientes[0].id)).toBeGreaterThan(0)
  }, 60_000)
})
