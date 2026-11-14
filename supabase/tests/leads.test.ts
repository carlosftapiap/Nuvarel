// @vitest-environment node
// Captación de leads: ingreso, duplicados por celular, rotación entre participantes con horario de Ecuador, vacaciones y pausa,
// bandeja de pendientes, primer contacto, alcance por equipos y seguridad. No crea comisiones ni toca el inventario.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, supA: string, supB: string, uno: string, dos: string, tres: string, carlos: string
let n = 993300000

// Lunes 16 de noviembre de 2026 a las 10:00 de Ecuador (15:00 UTC); 22:00 del lunes; sábado 21 a las 10:00.
const LUNES_10 = '2026-11-16T15:00:00Z'
const LUNES_22 = '2026-11-17T03:00:00Z'
const SABADO_10 = '2026-11-21T15:00:00Z'
const mas = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString()

const uno_ = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
interface Resultado { lead: string; estado: string; repetido: boolean }
const lead = (extra: Record<string, unknown> = {}) => ({ fuente: 'web', nombre: `Prospecto ${++n}`, telefono: celularPrueba(n), consentimiento: true, consentimiento_version: 'v1-2026-11', ...extra })
const ingresar = async (p: Record<string, unknown>, ahora = LUNES_10) => (await uno_<{ r: Resultado }>(`select public.leads_ingresar($1::jsonb, $2::timestamptz) as r`, [JSON.stringify(p), ahora])).r
const fila = (id: string) => uno_<{ estado: string; client_id: string | null; asignado_a: string | null; asignacion: string | null; primer_contacto_en: string | null }>(
  `select estado, client_id, asignado_a, asignacion, primer_contacto_en from public.leads where id = $1`, [id])
const configurar = (u: string, cfg: Record<string, unknown>, quien = admin) =>
  rpc(quien, `select public.leads_configurar_participante($1, $2::jsonb, 'Configuración de prueba')`, [u, JSON.stringify(cfg)])
const pendientes = (ahora: string) => uno_<{ n: number }>(`select public.leads_asignar_pendientes($1::timestamptz) as n`, [ahora]).then((r) => r.n)
const L_V = { activo: true, dias: [1, 2, 3, 4, 5], hora_inicio: '09:00', hora_fin: '18:00' }

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gina Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  supA = await crearUsuario(db, 'Sara Supervisora', 'supervisor')
  supB = await crearUsuario(db, 'Saúl Supervisor', 'supervisor')
  const eqA = (await uno_<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Uno', $1) returning id`, [supA])).id
  const eqB = (await uno_<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Dos', $1) returning id`, [supB])).id
  uno = await crearUsuario(db, 'Ana Uno', 'asesor', { equipo: eqA })
  dos = await crearUsuario(db, 'Beto Dos', 'asesor', { equipo: eqA })
  tres = await crearUsuario(db, 'Ciro Tres', 'asesor', { equipo: eqB })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
}, 60_000)

describe('configuración: solo el administrador', () => {
  it('gerencia, supervisores y vendedores no configuran ni consultan la distribución', async () => {
    for (const u of [gerente, supA, uno, finanzas]) {
      await expect(configurar(uno, L_V, u)).rejects.toThrow(/Solo el administrador/)
      await expect(rpc(u, `select * from public.leads_disponibilidad()`)).rejects.toThrow(/Solo el administrador/)
    }
  })

  it('participan vendedores y supervisores activos; un corredor no', async () => {
    await expect(configurar(carlos, L_V)).rejects.toThrow(/Solo participan vendedores y supervisores/)
    await expect(configurar(uno, { ...L_V, hora_inicio: '18:00', hora_fin: '09:00' })).rejects.toThrow(/hora de inicio/)
    await expect(configurar(uno, { ...L_V, pausado: true })).rejects.toThrow(/motivo de la pausa/)
    await expect(configurar(uno, { ...L_V, vacaciones_desde: '2026-11-20' })).rejects.toThrow(/inicio y el fin de las vacaciones/)
    const lista = await como(db, admin, async () => (await db.query<{ nombre: string; rol: string; equipo: string | null; estado: string }>(`select nombre, rol, equipo, estado from public.leads_disponibilidad($1::timestamptz)`, [LUNES_10])).rows)
    expect(lista.map((x) => x.nombre)).toEqual(['Ana Uno', 'Beto Dos', 'Ciro Tres', 'Sara Supervisora', 'Saúl Supervisor'])
    expect(lista.every((x) => x.estado === 'no_participa')).toBe(true)
    expect(lista.find((x) => x.nombre === 'Ana Uno')).toMatchObject({ rol: 'asesor', equipo: 'Equipo Uno' })
  })

  it('el cambio queda en la auditoría con el motivo', async () => {
    await configurar(uno, L_V)
    expect(await uno_(`select accion, motivo from public.audit_log where entidad = 'usuario' and entidad_id = $1 order by fecha desc limit 1`, [uno]))
      .toEqual({ accion: 'Configurar distribución de leads', motivo: 'Configuración de prueba' })
  })
})

describe('ingreso y rotación', () => {
  it('reparte por turnos entre los habilitados disponibles: Uno, Tres, Uno, Tres', async () => {
    await configurar(uno, L_V)
    await configurar(tres, L_V)
    await configurar(dos, { ...L_V, activo: false })
    const asignados: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await ingresar(lead(), mas(LUNES_10, i))
      expect(r.estado).toBe('asignado')
      asignados.push((await fila(r.lead)).asignado_a!)
    }
    expect(asignados).toEqual([uno, tres, uno, tres])
  })

  it('el lead entra a Clientes como prospecto nuevo, con responsable, primer contacto para hoy y aviso al vendedor', async () => {
    const p = lead({ fuente: 'facebook', campana: 'Lanzamiento noviembre', email: 'Prospecto@Correo.com', mensaje: 'Quiero información de 2 dormitorios', unidad_interes: 'E1-PB-A2', presupuesto: 120000 })
    const r = await ingresar(p, mas(LUNES_10, 10))
    const l = await fila(r.lead)
    const c = await uno_<Record<string, unknown>>(`select etapa::text, origen, origen_detalle, asesor_id, created_by, documento, telefono, email, unidades_interes, presupuesto, proxima_tipo, proxima_descripcion, proxima_fecha::text from public.clients where id = $1`, [l.client_id])
    expect(c).toMatchObject({ etapa: 'nuevo', origen: 'facebook', origen_detalle: 'Lanzamiento noviembre', asesor_id: l.asignado_a, created_by: l.asignado_a, documento: '',
      telefono: `+593${String(p.telefono).slice(1)}`, email: 'prospecto@correo.com', unidades_interes: ['E1-PB-A2'], proxima_tipo: 'llamada', proxima_fecha: '2026-11-16' })
    expect(String(c.proxima_descripcion)).toBe('Primer contacto: prospecto de Facebook · Lanzamiento noviembre')
    expect(await uno_(`select evento, destinatario_usuario from public.cobranza_alertas where entidad = 'lead' and entidad_id = $1`, [r.lead]))
      .toEqual({ evento: 'lead_asignado', destinatario_usuario: l.asignado_a })
    expect(await uno_(`select motivo from public.client_assignment_history where client_id = $1`, [l.client_id])).toEqual({ motivo: 'Lead de Facebook asignado por rotación automática' })
    // Asignar no es contactar.
    expect(l.primer_contacto_en).toBeNull()
  })

  it('el mismo envío repetido no se registra dos veces', async () => {
    const p = lead({ fuente: 'instagram', externo_id: 'leadgen-123' })
    const a = await ingresar(p, mas(LUNES_10, 20))
    const b = await ingresar({ ...p, nombre: 'Otro nombre' }, mas(LUNES_10, 21))
    expect(b).toEqual({ lead: a.lead, estado: a.estado, repetido: true })
    expect(await uno_(`select count(*)::int as n from public.leads where externo_id = 'leadgen-123'`)).toEqual({ n: 1 })
  })

  it('valida en el servidor: celular, nombre, correo, consentimiento y fuente', async () => {
    await expect(ingresar(lead({ telefono: '0291234567' }))).rejects.toThrow(/celular no es válido/)
    await expect(ingresar(lead({ nombre: 'A' }))).rejects.toThrow(/nombre completo/)
    await expect(ingresar(lead({ email: 'sin-arroba' }))).rejects.toThrow(/correo no es válido/)
    await expect(ingresar(lead({ consentimiento: false }))).rejects.toThrow(/tratamiento de tus datos/)
    await expect(ingresar(lead({ fuente: 'tiktok' }))).rejects.toThrow(/Fuente de lead no válida/)
  })

  it('limita los envíos seguidos desde un mismo origen de red', async () => {
    for (let i = 0; i < 5; i++) await ingresar(lead({ ip_hash: 'ip-abc' }), mas(LUNES_10, 30 + i))
    await expect(ingresar(lead({ ip_hash: 'ip-abc' }), mas(LUNES_10, 36))).rejects.toThrow(/Demasiados envíos/)
    await ingresar(lead({ ip_hash: 'ip-abc' }), mas(LUNES_10, 50))
  })
})

describe('duplicados por celular', () => {
  it('un cliente existente no se duplica ni cambia de vendedor: queda la consulta y se avisa al responsable', async () => {
    const tel = celularPrueba(++n)
    const existente = (await rpc<{ id: string }>(dos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Cliente de Beto', telefono: tel, origen: 'whatsapp' }), dos])).id
    const turnosAntes = await uno_<{ t: string }>(`select string_agg(user_id::text || ':' || coalesce(turno::text, '-'), ',' order by user_id) as t from public.leads_participantes`)
    const clientesAntes = (await uno_<{ n: number }>(`select count(*)::int as n from public.clients`)).n
    // Mismo número escrito con +593: es el mismo celular.
    const r = await ingresar(lead({ telefono: `+593 ${tel.slice(1, 3)} ${tel.slice(3)}`, fuente: 'facebook', mensaje: 'Sigo interesado' }), mas(LUNES_10, 60))
    expect(r.estado).toBe('duplicado')
    expect(await fila(r.lead)).toMatchObject({ estado: 'duplicado', client_id: existente, asignado_a: dos, asignacion: 'responsable' })
    expect((await uno_<{ n: number }>(`select count(*)::int as n from public.clients`)).n).toBe(clientesAntes)
    expect(await uno_(`select asesor_id from public.clients where id = $1`, [existente])).toEqual({ asesor_id: dos })
    expect(await uno_(`select evento, destinatario_usuario from public.cobranza_alertas where entidad = 'lead' and entidad_id = $1`, [r.lead])).toEqual({ evento: 'lead_consulta', destinatario_usuario: dos })
    // Un duplicado no consume turno de la rotación.
    expect(await uno_(`select string_agg(user_id::text || ':' || coalesce(turno::text, '-'), ',' order by user_id) as t from public.leads_participantes`)).toEqual(turnosAntes)
  })

  it('también reconoce al cliente por su correo', async () => {
    await rpc(dos, `select public.clientes_crear(null, $1::jsonb, $2)`, [JSON.stringify({ nombre: 'Cliente con correo', telefono: celularPrueba(++n), email: 'unico@correo.com', origen: 'visita' }), dos])
    const r = await ingresar(lead({ email: 'UNICO@correo.com' }), mas(LUNES_10, 61))
    expect((await fila(r.lead)).asignado_a).toBe(dos)
    expect(r.estado).toBe('duplicado')
  })

  it('si el cliente se registró mientras el lead esperaba, al asignarse queda como su consulta', async () => {
    await configurar(uno, { ...L_V, activo: false })
    await configurar(tres, { ...L_V, activo: false })
    const tel = celularPrueba(++n)
    const r = await ingresar(lead({ telefono: tel }), mas(LUNES_10, 62))
    expect(r.estado).toBe('pendiente')
    const c = (await rpc<{ id: string }>(tres, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Registrado a mano', telefono: tel, origen: 'visita' }), tres])).id
    await pendientes(mas(LUNES_10, 63))
    expect(await fila(r.lead)).toMatchObject({ estado: 'duplicado', client_id: c, asignado_a: tres })
  })
})

describe('horarios, vacaciones, pausa y bandeja de pendientes', () => {
  it('fuera de horario o en fin de semana el lead espera; se asigna por orden de llegada cuando hay disponibilidad', async () => {
    await configurar(uno, L_V)
    await configurar(tres, L_V)
    const noche = await ingresar(lead(), LUNES_22)
    const sabado = await ingresar(lead(), SABADO_10)
    expect([noche.estado, sabado.estado]).toEqual(['pendiente', 'pendiente'])
    // El lunes siguiente a las 10:00: primero el de la noche, después el del sábado.
    expect(await pendientes('2026-11-23T15:00:00Z')).toBeGreaterThanOrEqual(2)
    const a = await fila(noche.lead), b = await fila(sabado.lead)
    expect([a.estado, b.estado]).toEqual(['asignado', 'asignado'])
    expect(a.asignado_a).not.toBe(b.asignado_a)
    expect(await uno_<{ n: number }>(`select count(*)::int as n from public.leads where estado = 'pendiente'`)).toEqual({ n: 0 })
  })

  it('un vendedor de vacaciones no recibe; al terminar vuelve solo, y conserva sus clientes', async () => {
    await configurar(uno, { ...L_V, vacaciones_desde: '2026-11-16', vacaciones_hasta: '2026-11-20' })
    await configurar(tres, { ...L_V, activo: false })
    const clientesDeUno = (await uno_<{ n: number }>(`select count(*)::int as n from public.clients where asesor_id = $1`, [uno])).n
    const r = await ingresar(lead(), '2026-11-18T15:00:00Z')
    expect(r.estado).toBe('pendiente')
    expect((await uno_<{ n: number }>(`select count(*)::int as n from public.clients where asesor_id = $1`, [uno])).n).toBe(clientesDeUno)
    // El lunes 23 ya terminó: se asigna sin cambiar la configuración.
    await pendientes('2026-11-23T15:00:00Z')
    expect(await fila(r.lead)).toMatchObject({ estado: 'asignado', asignado_a: uno })
  })

  it('la pausa manual se mantiene hasta que el administrador la quita', async () => {
    await configurar(uno, { ...L_V, pausado: true, pausa_motivo: 'Capacitación' })
    const r = await ingresar(lead(), '2026-11-24T15:00:00Z')
    await pendientes('2026-11-30T15:00:00Z')
    expect((await fila(r.lead)).estado).toBe('pendiente')
    await configurar(uno, L_V)
    // Configurar asigna los pendientes en ese momento (el reloj real); el programador lo hace en horario.
    await pendientes('2026-11-30T15:00:00Z')
    expect(await fila(r.lead)).toMatchObject({ estado: 'asignado', asignado_a: uno })
  })

  it('el supervisor que vende también puede participar y recibir prospectos', async () => {
    await configurar(uno, { ...L_V, activo: false })
    await configurar(supA, L_V)
    const r = await ingresar(lead(), '2026-12-01T15:00:00Z')
    const l = await fila(r.lead)
    expect(l.asignado_a).toBe(supA)
    expect(await uno_(`select asesor_id from public.clients where id = $1`, [l.client_id])).toEqual({ asesor_id: supA })
    await configurar(supA, { ...L_V, activo: false })
  })

  it('el administrador asigna a mano un pendiente, con motivo; nadie más puede', async () => {
    const r = await ingresar(lead(), '2026-12-05T15:00:00Z')
    expect(r.estado).toBe('pendiente')
    await expect(rpc(gerente, `select public.leads_asignar_manual($1, $2, 'Lo atiende Beto')`, [r.lead, dos])).rejects.toThrow(/Solo el administrador/)
    await expect(rpc(admin, `select public.leads_asignar_manual($1, $2, 'Lo atiende Carlos')`, [r.lead, carlos])).rejects.toThrow(/vendedor o supervisor activo/)
    await rpc(admin, `select public.leads_asignar_manual($1, $2, 'Nadie de turno el sábado')`, [r.lead, dos])
    expect(await fila(r.lead)).toMatchObject({ estado: 'asignado', asignado_a: dos, asignacion: 'manual' })
    await expect(rpc(admin, `select public.leads_asignar_manual($1, $2, 'Otra vez')`, [r.lead, uno])).rejects.toThrow(/ya no está pendiente/)
  })
})

describe('seguimiento y alcance', () => {
  it('el primer contacto se registra con la primera llamada, mensaje o visita; una nota no cuenta', async () => {
    await configurar(tres, L_V)
    const r = await ingresar(lead(), '2026-12-07T15:00:00Z')
    const l = await fila(r.lead)
    expect(l.asignado_a).toBe(tres)
    await rpc(tres, `select public.clientes_registrar_actividad(null, $1, 'nota', (now() at time zone 'America/Guayaquil')::date, 'Revisé la ficha', null)`, [l.client_id])
    expect((await fila(r.lead)).primer_contacto_en).toBeNull()
    await rpc(tres, `select public.clientes_registrar_actividad(null, $1, 'mensaje', (now() at time zone 'America/Guayaquil')::date, 'Contacto por WhatsApp', null)`, [l.client_id])
    expect((await fila(r.lead)).primer_contacto_en).not.toBeNull()
    expect(await uno_(`select primer_contacto_tipo from public.leads where id = $1`, [r.lead])).toEqual({ primer_contacto_tipo: 'mensaje' })
  })

  it('cada vendedor ve sus leads, el supervisor los de su equipo y el administrador todos, incluidos los pendientes', async () => {
    const ver = async (u: string) => (await como(db, u, async () => (await db.query<{ asignado_a: string | null; estado: string }>(`select asignado_a, estado from public.leads`)).rows))
    const deUno = await ver(uno), deSupA = await ver(supA), deSupB = await ver(supB), todos = await ver(admin)
    expect(deUno.length).toBeGreaterThan(0)
    expect(deUno.every((x) => x.asignado_a === uno)).toBe(true)
    expect(deSupA.every((x) => [uno, dos, supA].includes(x.asignado_a!))).toBe(true)
    expect(deSupA.some((x) => x.asignado_a === tres)).toBe(false)
    expect(deSupB.every((x) => [tres, supB].includes(x.asignado_a!))).toBe(true)
    expect(todos.length).toBe((await uno_<{ n: number }>(`select count(*)::int as n from public.leads`)).n)
    await ingresar(lead(), '2026-12-12T15:00:00Z') // sábado: queda pendiente
    expect((await ver(admin)).some((x) => x.estado === 'pendiente')).toBe(true)
    expect((await ver(gerente)).some((x) => x.estado === 'pendiente')).toBe(false)
  })

  it('el ingreso es solo del servidor: un usuario de la app no puede registrar leads ni asignar la bandeja directamente', async () => {
    await expect(rpc(uno, `select public.leads_ingresar($1::jsonb)`, [JSON.stringify(lead())])).rejects.toThrow(/permission denied/)
    await expect(rpc(admin, `select public.leads_asignar_pendientes()`)).rejects.toThrow(/permission denied/)
    await expect(rpc(uno, `insert into public.leads (fuente, nombre, telefono, consentimiento, consentimiento_version) values ('web', 'Directo', '0991111111', true, 'v1')`)).rejects.toThrow(/row-level security|permission denied/)
    expect(await rpc(admin, `select public.leads_asignar_ahora() as n`)).toMatchObject({ n: expect.any(Number) })
  })

  it('un vendedor puede registrar a mano un cliente que llegó por Facebook o la página web', async () => {
    const id = (await rpc<{ id: string }>(uno, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Escribió por Facebook', telefono: celularPrueba(++n), origen: 'facebook' }), uno])).id
    expect(await uno_(`select origen from public.clients where id = $1`, [id])).toEqual({ origen: 'facebook' })
  })

  it('la captación no crea comisiones ni cambia el inventario', async () => {
    const antes = await uno_(`select (select count(*)::int from public.comisiones) as comisiones, (select md5(string_agg(codigo || estado || coalesce(reserva_id::text, ''), ',' order by codigo)) from public.inventory_units) as inventario`)
    await configurar(uno, L_V)
    await ingresar(lead({ unidad_interes: 'E1-PB-A2' }), '2026-12-14T15:00:00Z')
    expect(await uno_(`select (select count(*)::int from public.comisiones) as comisiones, (select md5(string_agg(codigo || estado || coalesce(reserva_id::text, ''), ',' order by codigo)) from public.inventory_units) as inventario`)).toEqual(antes)
  })
})
