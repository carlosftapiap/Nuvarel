// @vitest-environment node
// Clientes únicos por documento, solicitudes de reasignación con historial y alcance del Supervisor sobre su equipo.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, supA: string, supB: string, vendA: string, vendA2: string, vendB: string
let cliente: string
const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = Record<string, unknown>>(quien: string, sql: string, p: unknown[] = []) => como(db, quien, async () => (await db.query<T>(sql, p)).rows[0])
const crear = (quien: string, datos: Record<string, unknown>) =>
  rpc<{ id: string }>(quien, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ origen: 'whatsapp', ...datos }), quien]).then((r) => r.id)
const ids = async (quien: string, tabla: string) => (await como(db, quien, () => db.query<{ id: string }>(`select id from public.${tabla}`))).rows.map((r) => r.id)

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gina Gerencia', 'gerencia')
  supA = await crearUsuario(db, 'Sara Supervisora', 'supervisor')
  supB = await crearUsuario(db, 'Saúl Supervisor', 'supervisor')
  vendA = await crearUsuario(db, 'Carlos Pérez', 'asesor')
  vendA2 = await crearUsuario(db, 'Ana Andrade', 'asesor')
  vendB = await crearUsuario(db, 'Beto Bravo', 'asesor')
  for (const [nombre, sup, miembros] of [['Equipo Norte', supA, [vendA, vendA2]], ['Equipo Sur', supB, [vendB]]] as const) {
    const t = (await rpc<{ id: string }>(admin, `select public.config_guardar_equipo(null, $1, $2, '{}'::uuid[], 'Alta de equipo') as id`, [nombre, sup])).id
    for (const m of miembros) await db.query(`update public.profiles set equipo_id = $1 where id = $2`, [t, m])
  }
}, 60_000)

describe('documento único', () => {
  it('valida la cédula ecuatoriana', async () => {
    expect(await uno(`select public.cedula_valida('0915677082') as v`)).toEqual({ v: true })
    expect(await uno(`select public.cedula_valida('0915677083') as v`)).toEqual({ v: false })
    await expect(crear(vendA, { nombre: 'Cédula Mala', telefono: '0991111111', documento: '0915677083' })).rejects.toThrow(/cédula 0915677083 no es válida/)
  })

  it('el Vendedor B no puede registrar al cliente del Vendedor A, aunque escriba el documento distinto', async () => {
    cliente = await crear(vendA, { nombre: 'Lucía Torres', telefono: '0992222222', documento: '0915677082' })
    await expect(crear(vendB, { nombre: 'LUCIA TORRES', telefono: '0993333333', documento: '091567708-2' }))
      .rejects.toThrow('Este cliente ya se encuentra registrado en AMURA y lo atiende otro vendedor. Puedes solicitar su revisión o reasignación.')
    // El RUC de persona natural es la misma persona.
    await expect(crear(vendB, { nombre: 'Lucía T.', telefono: '0994444444', documento: '0915677082001' })).rejects.toThrow(/ya se encuentra registrado/)
    expect(await uno(`select count(*)::int as n from public.clients where documento_clave = 'CI:0915677082'`)).toEqual({ n: 1 })
  })

  it('a quien puede ver al cliente le dice el vendedor responsable real; a los demás, nada personal', async () => {
    await expect(crear(supA, { nombre: 'Otra Lucía', telefono: '0995555555', documento: '0915677082' }))
      .rejects.toThrow('Este cliente ya se encuentra registrado en AMURA (Lucía Torres) y está asignado al vendedor Carlos Pérez.')
    const v = await rpc<{ r: Record<string, unknown> }>(vendB, `select public.clientes_verificar_documento('0915677082', null, null, null) as r`)
    expect(v.r).toMatchObject({ tipo: 'cedula', valido: true, existe: true, visible: false, cliente_id: null })
    expect(String(v.r.mensaje)).not.toMatch(/Lucía|Carlos/)
  })

  it('también detiene el duplicado por teléfono, y al editar', async () => {
    await expect(crear(vendB, { nombre: 'Por Teléfono', telefono: '+593 99 222 2222' })).rejects.toThrow(/ya se encuentra registrado/)
    const propio = await crear(vendB, { nombre: 'Beto Cliente', telefono: '0996666666' })
    const { version } = await uno<{ version: number }>(`select version from public.clients where id = $1`, [propio])
    await expect(rpc(vendB, `select public.clientes_editar($1, $2, $3::jsonb)`, [propio, version, JSON.stringify({ nombre: 'Beto Cliente', telefono: '0996666666', origen: 'whatsapp', documento: '0915677082' })]))
      .rejects.toThrow(/ya se encuentra registrado/)
  })

  it('un cliente antiguo con cédula inválida se sigue editando: solo se valida un documento nuevo o cambiado', async () => {
    await db.query(`alter table public.clients disable trigger clients_unicos`)
    const antiguo = await crear(vendA2, { nombre: 'Cliente Antiguo', telefono: '0991313131', documento: '0915677088' })
    await db.query(`alter table public.clients enable trigger clients_unicos`)
    const { version } = await uno<{ version: number }>(`select version from public.clients where id = $1`, [antiguo])
    await rpc(vendA2, `select public.clientes_editar($1, $2, $3::jsonb)`,
      [antiguo, version, JSON.stringify({ nombre: 'Cliente Antiguo', telefono: '0991515151', origen: 'whatsapp', documento: '0915677088' })])
    expect(await uno(`select telefono, documento from public.clients where id = $1`, [antiguo])).toEqual({ telefono: '+593991515151', documento: '0915677088' })
  })
})

describe('equipo del Supervisor', () => {
  it('ve a sus vendedores y sus clientes, no los de otro equipo', async () => {
    const perfiles = (await como(db, supA, () => db.query<{ nombre: string }>(`select nombre from public.profiles order by nombre`))).rows.map((r) => r.nombre)
    expect(perfiles).toEqual(['Ana Andrade', 'Carlos Pérez', 'Sara Supervisora'])
    expect(await ids(supA, 'clients')).toContain(cliente)
    expect(await ids(supB, 'clients')).not.toContain(cliente)
  })
})

describe('reasignación con solicitud e historial', () => {
  let solicitud: string
  it('el Vendedor B la solicita sin ver al cliente', async () => {
    solicitud = (await rpc<{ id: string }>(vendB, `select public.clientes_solicitar_reasignacion('0915677082', null, null, 'El cliente llamó directamente y pide que lo atienda yo') as id`)).id
    await expect(rpc(vendB, `select public.clientes_solicitar_reasignacion('0915677082', null, null, 'Otra vez la misma solicitud')`)).rejects.toThrow(/pendiente/)
    expect((await como(db, vendB, () => db.query(`select estado from public.client_reassignment_requests`))).rows).toEqual([{ estado: 'pendiente' }])
    expect(await ids(vendB, 'clients')).not.toContain(cliente)
    // Quien la pidió ve su solicitud sin el nombre del cliente ni del vendedor que lo atiende.
    expect((await como(db, vendB, () => db.query(`select cliente from public.clientes_reasignaciones()`))).rows)
      .toEqual([{ cliente: 'Cliente de otro equipo' }])
  })

  it('un Supervisor que no tiene a ambos vendedores no la resuelve; el vendedor no se la aprueba', async () => {
    await expect(rpc(supA, `select public.clientes_resolver_reasignacion($1, true, 'Aprobado por supervisor')`, [solicitud])).rejects.toThrow(/ambos vendedores/)
    await expect(rpc(vendB, `select public.clientes_resolver_reasignacion($1, true, 'Me lo apruebo')`, [solicitud])).rejects.toThrow(/Sin permiso/)
    const lista = (await como(db, supA, () => db.query(`select cliente, solicitante, puede_resolver from public.clientes_reasignaciones()`))).rows
    expect(lista).toEqual([{ cliente: 'Lucía Torres', solicitante: 'Beto Bravo', puede_resolver: false }])
  })

  it('Gerencia la aprueba: cambia el responsable y queda el historial con autor, fecha y motivo', async () => {
    await rpc(gerente, `select public.clientes_resolver_reasignacion($1, true, 'Cliente pidió cambio de vendedor')`, [solicitud])
    expect(await uno(`select asesor_id from public.clients where id = $1`, [cliente])).toEqual({ asesor_id: vendB })
    const h = await uno<{ motivo: string }>(
      `select asesor_anterior, asesor_nuevo, registrado_por, solicitud_id, motivo from public.client_assignment_history where client_id = $1 and asesor_anterior is not null`, [cliente])
    expect(h).toMatchObject({ asesor_anterior: vendA, asesor_nuevo: vendB, registrado_por: gerente, solicitud_id: solicitud })
    expect(h.motivo).toMatch(/Cliente pidió cambio de vendedor/)
    const t = (await rpc<{ t: Record<string, unknown> }>(gerente, `select public.clientes_trazabilidad($1) as t`, [cliente])).t
    expect(t).toMatchObject({ creado_por: 'Carlos Pérez', responsable: 'Beto Bravo', equipo: 'Equipo Sur', supervisor: 'Saúl Supervisor' })
    expect(t.reasignaciones).toEqual([expect.objectContaining({ anterior: 'Carlos Pérez', nuevo: 'Beto Bravo', por: 'Gina Gerencia' })])
    expect(await ids(supB, 'clients')).toContain(cliente)
    expect((await como(db, vendB, () => db.query(`select estado from public.client_reassignment_requests`))).rows).toEqual([{ estado: 'aprobada' }])
  })

  it('ningún vendedor cambia el responsable por fuera de la solicitud', async () => {
    // El vendedor anterior ya no ve al cliente; el nuevo no puede pasarlo a otro.
    const r = await como(db, vendA, () => db.query(`update public.clients set asesor_id = $1 where id = $2`, [vendA, cliente]))
    expect(r.affectedRows ?? 0).toBe(0)
    await expect(como(db, vendB, () => db.query(`update public.clients set asesor_id = $1 where id = $2`, [vendA, cliente]))).rejects.toThrow(/Sin permiso para reasignar/)
    expect(await uno(`select asesor_id from public.clients where id = $1`, [cliente])).toEqual({ asesor_id: vendB })
  })
})
