// @vitest-environment node
// Fase 3: Oficial de Cumplimiento, expediente del cliente y revisión obligatoria antes de la firma.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string, legal: string, oficial: string, finanzas: string, gerente: string
let cliente: string, contrato: string, hoy: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
let n = 0
const archivo = (prefijo: string) => JSON.stringify({ ruta: `${prefijo}/${crypto.randomUUID()}-doc${++n}.pdf`, nombre: `doc${n}.pdf`, mime: 'application/pdf', tamano: 1024, hash: 'b'.repeat(64) })
const cargar = (quien: string, tipo: string, persona: { client?: string; buyer?: string } = { client: cliente }) =>
  rpc<{ id: string }>(quien, `select public.expediente_cargar($1, $2, $3, $4::jsonb, null) as id`,
    [persona.client ?? null, persona.buyer ?? null, tipo, archivo(persona.client ? `clientes/${persona.client}` : `compradores/${persona.buyer}`)]).then((r) => r.rows[0].id)
const requisitos = async (quien = legal) => (await rpc<{ r: { tipo: string; estado: string; documento: string | null; persona: string }[] }>(quien, `select public.cumplimiento_requisitos($1) as r`, [contrato])).rows[0].r
const estado = async () => (await uno<{ e: string | null }>(`select public.cumplimiento_estado($1) as e`, [contrato])).e
const firmar = (quien = legal) => rpc(quien, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contratos/firmado.pdf')`, [contrato, hoy])
const NATURAL = ['pn_cedula', 'pn_votacion', 'pn_servicio_basico', 'pn_origen_fondos', 'pn_conozca_cliente']

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  legal = await crearUsuario(db, 'Lorena Legal', 'legal')
  oficial = await crearUsuario(db, 'Óscar Cumplimiento', 'oficial_cumplimiento')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  hoy = (await uno<{ hoy: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as hoy`)).hoy
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  cliente = (await db.query<{ id: string }>(
    `insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Cumplimiento', '1715000509', '0990000050', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [cliente, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-CU-1', $4::date, $4::date + 60, 'E1-PB-A2', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3)
     returning id`, [vera, cliente, op, hoy])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  const reserva = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
  await como(db, vera, () => db.query(`select public.reservas_fijar_monto($1, 1000, 'Reserva acordada con el cliente')`, [reserva]))
  await como(db, vera, () => db.query(`select public.reservas_reportar_pago($1::uuid, 1000, $2::date, 'Banco de prueba', 'TRF-RES-CU', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva, hoy]))
  await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
  await como(db, finanzas, () => db.query(`select public.reservas_confirmar_pago($1, 1000, $2::date, 'TRF-RES-CU', true, 'Ingreso confirmado en banco')`, [reserva, hoy]))
  await como(db, gerente, () => db.query(`select public.reservas_aprobar($1, 'Aprobada en comité de prueba')`, [reserva]))
  contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato con revisión de cumplimiento') as id`, [reserva, hoy])).rows[0].id
})

describe('rol Oficial de Cumplimiento', () => {
  it('ve Clientes y Ventas, revisa el expediente, y no tiene cobranzas, precios, comisiones ni configuración', async () => {
    const p = (await db.query<{ permiso: string }>(`select permiso from public.role_permissions where role_id = 'oficial_cumplimiento' order by 1`)).rows.map((r) => r.permiso)
    expect(p).toEqual(['clientes.ver', 'cumplimiento.revisar', 'cumplimiento.ver', 'reservas.ver', 'ventas.documentos_ver', 'ventas.ver'])
    expect((await rpc(oficial, `select id from public.clients`)).rows).toHaveLength(1)
    expect((await rpc(oficial, `select id from public.contracts`)).rows).toHaveLength(1)
    expect((await rpc(oficial, `select id from public.payments`)).rows).toHaveLength(0)
    expect((await rpc(oficial, `select id from public.comprobantes_pago`)).rows).toHaveLength(0)
  })

  it('no modifica pagos, precios ni contratos', async () => {
    await expect(rpc(oficial, `select public.cobranzas_confirmar_pago(gen_random_uuid(), true, 'x')`)).rejects.toThrow(/permiso/i)
    await expect(rpc(oficial, `select public.contratos_formalizar($1, $2::date, 'Firma', 'x.pdf')`, [contrato, hoy])).rejects.toThrow(/permiso/i)
    await expect(rpc(oficial, `select public.contratos_anular($1, 'Intento de anulación', 'x.pdf')`, [contrato])).rejects.toThrow(/permiso/i)
  })
})

describe('expediente del cliente', () => {
  it('lista los documentos obligatorios de persona natural; todos faltan al inicio', async () => {
    const r = await requisitos()
    expect(r.map((x) => x.tipo)).toEqual(NATURAL)
    expect(new Set(r.map((x) => x.estado))).toEqual(new Set(['falta']))
  })

  it('carga quien edita clientes o datos del comprador, en su alcance; Finanzas no ve el expediente', async () => {
    await expect(cargar(finanzas, 'pn_cedula')).rejects.toThrow(/Sin permiso/)
    await expect(cargar(oficial, 'pn_cedula')).rejects.toThrow(/Sin permiso/)
    const id = await cargar(vera, 'pn_cedula')
    expect(await uno(`select estado, cargado_por from public.expediente_documentos where id = $1`, [id])).toEqual({ estado: 'cargado', cargado_por: vera })
    expect((await rpc(finanzas, `select id from public.expediente_documentos`)).rows).toHaveLength(0)
    expect((await rpc(oficial, `select id from public.expediente_documentos`)).rows).toHaveLength(1)
    // La ruta del archivo debe ser de esa persona.
    await expect(rpc(vera, `select public.expediente_cargar($1, null, 'pn_votacion', $2::jsonb, null)`, [cliente, archivo(`clientes/${crypto.randomUUID()}`)])).rejects.toThrow(/no corresponde/)
  })

  it('solo suben archivos quienes pueden cargar, y en la carpeta de su persona', async () => {
    const ruta = `clientes/${cliente}/x.pdf`
    expect((await rpc<{ v: boolean }>(vera, `select public.expediente_puede_subir($1) as v`, [ruta])).rows[0].v).toBe(true)
    expect((await rpc<{ v: boolean }>(finanzas, `select public.expediente_puede_subir($1) as v`, [ruta])).rows[0].v).toBe(false)
    expect((await rpc<{ v: boolean }>(vera, `select public.expediente_puede_subir($1) as v`, ['otra/carpeta/x.pdf'])).rows[0].v).toBe(false)
  })

  it('volver a cargar el mismo tipo crea otra versión; la anterior queda reemplazada, no se borra', async () => {
    const anterior = (await uno<{ id: string }>(`select id from public.expediente_documentos where tipo = 'pn_cedula'`)).id
    const nuevo = await cargar(vera, 'pn_cedula')
    expect(await uno(`select estado from public.expediente_documentos where id = $1`, [anterior])).toEqual({ estado: 'reemplazado' })
    expect(await uno(`select reemplaza from public.expediente_documentos where id = $1`, [nuevo])).toEqual({ reemplaza: anterior })
    expect((await requisitos()).find((x) => x.tipo === 'pn_cedula')).toMatchObject({ documento: nuevo, estado: 'cargado' })
  })

  it('Cumplimiento observa (con comentario), aprueba o rechaza; nadie más', async () => {
    const id = (await requisitos()).find((x) => x.tipo === 'pn_cedula')!.documento!
    await expect(rpc(vera, `select public.expediente_revisar($1, 'aprobado', null)`, [id])).rejects.toThrow(/Sin permiso/)
    await expect(rpc(oficial, `select public.expediente_revisar($1, 'observado', '')`, [id])).rejects.toThrow(/observación/)
    await rpc(oficial, `select public.expediente_revisar($1, 'observado', 'La foto está borrosa')`, [id])
    expect(await uno(`select estado, observacion, revisado_por from public.expediente_documentos where id = $1`, [id])).toEqual({ estado: 'observado', observacion: 'La foto está borrosa', revisado_por: oficial })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Revisar documento del expediente' and actor_id = $1`, [oficial])).n).toBe(1)
  })

  it('descargar deja auditoría; Cumplimiento y quien lo subió pueden, Finanzas no', async () => {
    const id = (await requisitos()).find((x) => x.tipo === 'pn_cedula')!.documento!
    const r = (await rpc<{ id: string; ruta: string }>(oficial, `select * from public.expediente_registrar_descarga($1::uuid[])`, [[id]])).rows
    expect(r).toHaveLength(1)
    expect(r[0].ruta.startsWith(`clientes/${cliente}/`)).toBe(true)
    await rpc(vera, `select * from public.expediente_registrar_descarga($1::uuid[])`, [[id]])
    await expect(rpc(finanzas, `select * from public.expediente_registrar_descarga($1::uuid[])`, [[id]])).rejects.toThrow(/Sin permiso/)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Descargar documento del expediente'`)).n).toBe(2)
  })

  it('el tipo de persona cambia la lista de obligatorios', async () => {
    await rpc(vera, `select public.expediente_definir_tipo_persona($1, null, 'juridica')`, [cliente])
    expect((await requisitos()).map((x) => x.tipo)).toEqual(['pj_ruc', 'pj_constitucion', 'pj_nombramiento', 'pj_cedula_representante', 'pj_accionistas', 'pj_origen_fondos', 'pj_conozca_cliente'])
    await rpc(vera, `select public.expediente_definir_tipo_persona($1, null, 'natural')`, [cliente])
    expect((await requisitos()).map((x) => x.tipo)).toEqual(NATURAL)
  })
})

describe('revisión antes de la firma', () => {
  it('sin aprobación de Cumplimiento no se firma, ni desde la app ni llamando la función base', async () => {
    await expect(firmar()).rejects.toThrow(/Falta la aprobación de Cumplimiento/)
    await expect(rpc(legal, `select public.contratos_firmar($1, 'Firma directa', 'x.pdf')`, [contrato])).rejects.toThrow(/Falta la aprobación de Cumplimiento/)
    expect(await uno(`select estado from public.contracts where id = $1`, [contrato])).toEqual({ estado: 'borrador' })
  })

  it('Legal envía solo con todos los obligatorios cargados y no rechazados', async () => {
    await expect(rpc(vera, `select public.cumplimiento_enviar($1, null)`, [contrato])).rejects.toThrow(/permiso/i)
    await expect(rpc(legal, `select public.cumplimiento_enviar($1, null)`, [contrato])).rejects.toThrow(/Faltan 4 documento/)
    for (const t of NATURAL.slice(1)) await cargar(legal, t)
    await rpc(legal, `select public.cumplimiento_enviar($1, 'Expediente completo')`, [contrato])
    expect(await estado()).toBe('pendiente')
    await expect(rpc(legal, `select public.cumplimiento_enviar($1, null)`, [contrato])).rejects.toThrow(/ya está en revisión/)
  })

  it('quien envía no resuelve; aprobar exige todos los documentos aprobados; observar exige comentario', async () => {
    await expect(rpc(legal, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [contrato])).rejects.toThrow(/permiso/i)
    await expect(rpc(oficial, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [contrato])).rejects.toThrow(/sin aprobar/)
    await expect(rpc(oficial, `select public.cumplimiento_resolver($1, 'observado', '')`, [contrato])).rejects.toThrow(/observaciones/)
    await rpc(oficial, `select public.cumplimiento_resolver($1, 'observado', 'Falta firma en el formulario Conozca a su Cliente')`, [contrato])
    expect(await estado()).toBe('observado')
    await expect(firmar()).rejects.toThrow(/Falta la aprobación de Cumplimiento/)
  })

  it('corregido y reenviado, Cumplimiento aprueba y recién entonces se firma; el historial queda completo', async () => {
    await cargar(legal, 'pn_conozca_cliente')
    for (const r of await requisitos()) await rpc(oficial, `select public.expediente_revisar($1, 'aprobado', null)`, [r.documento])
    await rpc(legal, `select public.cumplimiento_enviar($1, 'Formulario corregido')`, [contrato])
    await rpc(oficial, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [contrato])
    await firmar()
    expect(await uno(`select estado from public.contracts where id = $1`, [contrato])).toEqual({ estado: 'firmado' })
    const h = (await rpc<{ estado: string; registrado_por: string }>(legal, `select estado, registrado_por from public.cumplimiento_revisiones where contract_id = $1 order by registrado_en`, [contrato])).rows
    expect(h).toEqual([
      { estado: 'pendiente', registrado_por: legal }, { estado: 'observado', registrado_por: oficial },
      { estado: 'pendiente', registrado_por: legal }, { estado: 'aprobado', registrado_por: oficial },
    ])
    expect((await rpc(finanzas, `select id from public.cumplimiento_revisiones`)).rows).toHaveLength(1 * 4)
  })
})

describe('comprador sin ficha de cliente', () => {
  it('sus documentos se cargan a su nombre y cuentan para el expediente del contrato', async () => {
    const otro = (await db.query<{ id: string }>(`insert into public.contract_buyers (contract_id, rol, nombre, documento, creado_por) values ($1, 'comprador', 'Comprador Adicional', '1700000001', $2) returning id`, [contrato, legal])).rows[0].id
    expect((await requisitos()).filter((x) => x.persona === 'Comprador Adicional').map((x) => x.estado)).toEqual(['falta', 'falta', 'falta', 'falta', 'falta'])
    const id = await cargar(legal, 'pn_cedula', { buyer: otro })
    expect((await requisitos()).find((x) => x.persona === 'Comprador Adicional' && x.tipo === 'pn_cedula')).toMatchObject({ documento: id, estado: 'cargado' })
  })
})

describe('condiciones aprobadas (fases 2 y 3)', () => {
  it('un corredor carga documentos solo de sus clientes; no los revisa ni borra versiones', async () => {
    const corredor = await crearUsuario(db, 'Carla Corredora', 'corredor')
    const suyo = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, origen_detalle, asesor_id, created_by, atribucion_usuario_id) values ('Cliente de Carla', '1715000608', '0990000060', 'corredor', 'Carla', $1, $1, $1) returning id`, [corredor])).rows[0].id
    const primero = await cargar(corredor, 'pn_cedula', { client: suyo })
    const segundo = await cargar(corredor, 'pn_cedula', { client: suyo })
    expect((await db.query(`select id, estado from public.expediente_documentos where client_id = $1 order by cargado_en`, [suyo])).rows).toEqual([{ id: primero, estado: 'reemplazado' }, { id: segundo, estado: 'cargado' }])
    await expect(cargar(corredor, 'pn_cedula', { client: cliente })).rejects.toThrow(/fuera de tu alcance/)
    expect((await rpc<{ v: boolean }>(corredor, `select public.expediente_puede_subir($1) as v`, [`clientes/${cliente}/x.pdf`])).rows[0].v).toBe(false)
    await expect(rpc(corredor, `select public.expediente_revisar($1, 'aprobado', null)`, [segundo])).rejects.toThrow(/Sin permiso/)
    await rpc(corredor, `delete from public.expediente_documentos where id = $1`, [primero])
    expect(await uno(`select estado from public.expediente_documentos where id = $1`, [primero])).toEqual({ estado: 'reemplazado' })
  })

  it('quien carga un documento no lo revisa, y quien prepara el expediente no lo aprueba', async () => {
    const id = await cargar(admin, 'pn_votacion', { client: cliente })
    await expect(rpc(admin, `select public.expediente_revisar($1, 'aprobado', null)`, [id])).rejects.toThrow(/Quien carga un documento no puede revisarlo/)
    await rpc(oficial, `select public.expediente_revisar($1, 'aprobado', null)`, [id])
    // Otro contrato del mismo cliente (anulado, para no chocar con el vigente de la reserva): el administrador cargó un documento y no puede aprobar el expediente.
    const borrador = (await db.query<{ id: string }>(`insert into public.contracts (codigo, reservation_id, client_id, codigo_unidad, precio, estado, fecha_contrato, created_by)
      select 'CON-SEP-1', reservation_id, client_id, codigo_unidad, precio, 'anulado', fecha_contrato, created_by from public.contracts where id = $1 returning id`, [contrato])).rows[0].id
    await db.query(`insert into public.cumplimiento_revisiones (contract_id, estado, registrado_por) values ($1, 'pendiente', $2)`, [borrador, legal])
    await expect(rpc(admin, `select public.cumplimiento_resolver($1, 'aprobado', null)`, [borrador])).rejects.toThrow(/preparó el expediente/)
  })

  it('los parámetros de pago solo se amplían al Oficial; otros perfiles sin acceso comercial no los leen', async () => {
    const constructor = await crearUsuario(db, 'Constructor', 'constructor')
    expect((await rpc(oficial, `select id from public.pricing_params`)).rows).toHaveLength(1)
    expect((await rpc(constructor, `select id from public.pricing_params`)).rows).toHaveLength(0)
  })

  it('la lista de documentos es provisional, configurable por administración y versionada', async () => {
    expect(await uno(`select version, provisional from public.expediente_catalogo order by version desc limit 1`)).toEqual({ version: 1, provisional: true })
    await expect(rpc(oficial, `select public.expediente_catalogo_definir('pn_referencia', 'natural', 'Referencia bancaria', true, 6, true, true, 'Pedido de Cumplimiento')`)).rejects.toThrow(/administración/)
    const v = (await rpc<{ v: number }>(admin, `select public.expediente_catalogo_definir('pn_referencia', 'natural', 'Referencia bancaria', true, 6, true, true, 'Pedido de Cumplimiento') as v`)).rows[0].v
    expect(v).toBe(2)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.expediente_tipos_historial where version = 1`)).n).toBe(12)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.expediente_tipos_historial where version = 2`)).n).toBe(13)
    expect((await requisitos()).map((x) => x.tipo)).toContain('pn_referencia')
    // Desactivar no borra: queda en el historial y sale de la lista.
    await rpc(admin, `select public.expediente_catalogo_definir('pn_referencia', 'natural', 'Referencia bancaria', true, 6, false, true, 'Se retira por decisión de Jarval')`)
    expect((await requisitos()).map((x) => x.tipo)).not.toContain('pn_referencia')
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Definir catálogo de documentos del expediente'`)).n).toBe(2)
  })
})
