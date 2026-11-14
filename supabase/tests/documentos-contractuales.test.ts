// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { hoyGuayaquil } from '../../src/features/financiamiento/plan'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

const MIGRACION = path.join(__dirname, '..', 'migrations', '20261031130000_documentos_contractuales.sql')

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, constructor: string, carlos: string, sofia: string
let n = 990600000
let cedulas = 0
const cedula = () => cedulaPrueba(++cedulas)

const uno = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rows = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows
const rpc = <T = Record<string, unknown>>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const q = <T = Record<string, unknown>>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows)
const sha = (c: string) => c.repeat(64).slice(0, 64)

const unidadLibre = async () => (await uno<{ codigo: string }>(
  `select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo

async function contratoNuevo() {
  const codigo = await unidadLibre()
  const cliente = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Comprador ${codigo}`, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'corredor', origen_detalle: 'Carlos' }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoyGuayaquil()])).id
  return { id, cliente, codigo }
}

const VARIABLES = [
  { clave: 'comprador.nombre', origen: 'catalogo', obligatorio: true },
  { clave: 'comprador.documento', origen: 'catalogo', obligatorio: true },
  { clave: 'comprador.domicilio', origen: 'catalogo', obligatorio: true },
  { clave: 'unidad.departamento', origen: 'catalogo', obligatorio: true },
  { clave: 'precio.total', origen: 'catalogo', obligatorio: true },
  { clave: 'precio.total_letras', origen: 'catalogo', obligatorio: true },
  { clave: 'pago.cuotas', origen: 'catalogo', obligatorio: true },
  { clave: 'vendedora.razon_social', origen: 'catalogo', obligatorio: true },
  { clave: 'lugar_firma', etiqueta: 'Lugar de firma', origen: 'manual', obligatorio: true },
]
const datosPlantilla = (extra: Record<string, unknown> = {}) => ({
  nombre: 'Compraventa con financiamiento', tipo_documento: 'contrato_compraventa', tipo_operacion: 'financiamiento_bancario', formato: 'docx',
  archivo_nombre: 'modelo.docx', archivo_hash: sha('a'), archivo_tamano: 12000, variables: VARIABLES, notas: 'Modelo entregado por Legal', ...extra,
})
const nuevaPlantilla = async (extra: Record<string, unknown> = {}, usuario = legal) => {
  const familia = (await uno<{ id: string }>(`select gen_random_uuid() as id`)).id
  const id = (await rpc<{ r: string }>(usuario, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Modelo recibido de Legal') as r`,
    [familia, JSON.stringify(datosPlantilla({ archivo_ruta: `${familia}/${familia.slice(0, 8)}-modelo.docx`, ...extra }))])).r
  return { id, familia }
}
const aprobada = async (extra: Record<string, unknown> = {}) => {
  const p = await nuevaPlantilla(extra)
  await rpc(legal, `select public.contratos_plantilla_aprobar($1::uuid, 'Aprobada por Legal')`, [p.id])
  return p
}
const datosDoc = async (contrato: string, manuales: Record<string, unknown> = {}, u = legal) =>
  (await rpc<{ r: Record<string, unknown> }>(u, `select public.contratos_datos_documento($1::uuid, $2::jsonb) as r`, [contrato, JSON.stringify(manuales)])).r
const registrar = (u: string, contrato: string, plantilla: string, datos: unknown, manuales: Record<string, unknown> = { lugar_firma: 'Quito' }, hash = 'b') =>
  rpc<{ r: string }>(u, `select public.contratos_documento_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, 'Generado desde la pantalla de Ventas') as r`,
    [contrato, plantilla, JSON.stringify(manuales), JSON.stringify(datos), JSON.stringify({ ruta: `${contrato}/${hash}-doc.pdf`, hash: sha(hash), tamano: 5000 }),
      JSON.stringify({ ruta: `${contrato}/${hash}-doc.docx`, hash: sha(hash + 'c'), tamano: 9000 })]).then((x) => x.r)

/** Deja un contrato con todos los datos obligatorios completos y devuelve lo necesario para generar. */
const ENTIDAD = { razon_social: 'Inmobiliaria Jarval S.A.', ruc: '1791234567001', domicilio: 'Quito', representante_nombre: 'Representante Legal', representante_cargo: 'Gerente general' }
async function contratoCompleto() {
  await rpc(legal, `select public.contratos_entidad_guardar($1::jsonb, 'Datos de la parte vendedora')`, [JSON.stringify(ENTIDAD)])
  const c = await contratoNuevo()
  await rpc(legal, `select public.contratos_comprador_principal_guardar($1::uuid, $2::jsonb, 'Datos de la cédula presentada')`,
    [c.id, JSON.stringify({ documento: cedula(), domicilio: 'Av. Amazonas N21-45, Quito', ciudad: 'Quito', estado_civil: 'casado', nacionalidad: 'ecuatoriana' })])
  return c
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  constructor = await crearUsuario(db, 'Juan Paez', 'constructor')
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const equipo = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor', { equipo: equipo.id })
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 180_000)

describe('permisos por perfil', () => {
  const permisos = async (rol: string) => (await rows<{ permiso: string }>(`select permiso from public.role_permissions where role_id = $1 and permiso in ('ventas.plantillas_ver','ventas.plantillas','ventas.plantillas_aprobar','ventas.documentos_ver','ventas.documentos_generar','ventas.documentos_emitir','ventas.datos_comprador') order by 1`, [rol])).map((r) => r.permiso)
  it('Legal administra plantillas y prepara; Gerencia emite; Finanzas consulta; Comercial y Constructor no tienen acceso', async () => {
    expect(await permisos('legal')).toEqual(['ventas.datos_comprador', 'ventas.documentos_generar', 'ventas.documentos_ver', 'ventas.plantillas', 'ventas.plantillas_aprobar', 'ventas.plantillas_ver'])
    expect(await permisos('gerencia')).toEqual(['ventas.documentos_emitir', 'ventas.documentos_ver', 'ventas.plantillas_ver'])
    expect(await permisos('finanzas')).toEqual(['ventas.documentos_ver'])
    expect((await permisos('administrador')).length).toBe(7)
    for (const rol of ['asesor', 'corredor', 'supervisor', 'constructor', 'jarval']) expect(await permisos(rol)).toEqual([])
  })
})

describe('entidad vendedora', () => {
  it('nace vacía, la administra Legal y la valida el servidor', async () => {
    expect((await q(legal, `select razon_social, ruc from public.entidad_vendedora`))[0]).toEqual({ razon_social: '', ruc: '' })
    await expect(rpc(carlos, `select public.contratos_entidad_guardar('{}'::jsonb, 'Intento sin permiso')`)).rejects.toThrow(/No tienes permiso/)
    await expect(rpc(gerente, `select public.contratos_entidad_guardar('{}'::jsonb, 'Gerencia no la administra')`)).rejects.toThrow(/No tienes permiso/)
    await expect(rpc(legal, `select public.contratos_entidad_guardar('{"ruc":"123"}'::jsonb, 'RUC incompleto')`)).rejects.toThrow(/13 dígitos/)
    await expect(rpc(legal, `select public.contratos_entidad_guardar('{"email":"mal"}'::jsonb, 'Correo no válido')`)).rejects.toThrow(/correo/)
    await expect(rpc(legal, `select public.contratos_entidad_guardar('{}'::jsonb, 'no')`)).rejects.toThrow(/motivo/)
    expect(await q(constructor, `select * from public.entidad_vendedora`)).toEqual([])
    expect(await q(carlos, `select * from public.entidad_vendedora`)).toEqual([])
  })
})

describe('plantillas', () => {
  it('Legal sube un modelo Word como borrador, con sus variables, y queda guardado con su historial', async () => {
    const p = await nuevaPlantilla()
    const t = (await q<{ estado: string; version: number; formato: string; archivo_hash: string; variables: unknown[]; creada_nombre: string }>(legal, `select estado, version, formato, archivo_hash, variables, creada_nombre from public.contract_templates where id = $1`, [p.id]))[0]
    expect(t).toMatchObject({ estado: 'borrador', version: 1, formato: 'docx', archivo_hash: sha('a'), creada_nombre: 'Legal' })
    expect(t.variables).toHaveLength(VARIABLES.length)
    const ev = await q<{ accion: string; usuario: string }>(legal, `select accion, usuario from public.contract_template_events where plantilla_id = $1`, [p.id])
    expect(ev).toEqual([{ accion: 'Crear plantilla', usuario: 'Legal' }])
  })

  it('valida variables y datos: catálogo desconocido, repetidas, sin archivo, texto vacío', async () => {
    const familia = (await uno<{ id: string }>(`select gen_random_uuid() as id`)).id
    const guardar = (extra: Record<string, unknown>) => rpc(legal, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Prueba de validación') as r`, [familia, JSON.stringify(datosPlantilla({ archivo_ruta: `${familia}/x.docx`, ...extra }))])
    await expect(guardar({ variables: [{ clave: 'comprador.inventado', origen: 'catalogo' }] })).rejects.toThrow(/no existe en el catálogo/)
    await expect(guardar({ variables: [{ clave: 'lugar', origen: 'manual' }, { clave: 'lugar', origen: 'manual' }] })).rejects.toThrow(/repetida/)
    await expect(guardar({ variables: [{ clave: 'con espacio', origen: 'manual' }] })).rejects.toThrow(/no válida/)
    await expect(guardar({ archivo_hash: 'corto' })).rejects.toThrow(/Sube el modelo en Word/)
    await expect(guardar({ archivo_ruta: `${(await uno<{ id: string }>(`select gen_random_uuid() as id`)).id}/x.docx` })).rejects.toThrow(/no corresponde a la plantilla/)
    await expect(guardar({ formato: 'texto', cuerpo: '   ' })).rejects.toThrow(/no puede estar vacío/)
    await expect(guardar({ tipo_documento: 'poema' })).rejects.toThrow()
    await expect(rpc(carlos, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Sin permiso de plantillas')`, [familia, JSON.stringify(datosPlantilla({ archivo_ruta: `${familia}/x.docx` }))])).rejects.toThrow(/No tienes permiso/)
  })

  it('también se puede crear una plantilla de texto dentro de la aplicación', async () => {
    const familia = (await uno<{ id: string }>(`select gen_random_uuid() as id`)).id
    const id = (await rpc<{ r: string }>(legal, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Texto entregado por Legal') as r`,
      [familia, JSON.stringify({ nombre: 'Reserva de unidad', tipo_documento: 'contrato_reserva', formato: 'texto', cuerpo: 'Reserva de {unidad.departamento} por {comprador.nombre}', variables: [{ clave: 'comprador.nombre', origen: 'catalogo' }] })])).r
    expect((await uno<{ formato: string; cuerpo: string }>(`select formato, cuerpo from public.contract_templates where id = $1`, [id])).formato).toBe('texto')
  })

  it('un borrador se edita; un segundo borrador de la misma plantilla no se abre; aprobar la deja inmutable', async () => {
    const p = await nuevaPlantilla()
    await rpc(legal, `select public.contratos_plantilla_guardar($1::uuid, null, $2::jsonb, 'Ajuste de variables') as r`, [p.id, JSON.stringify(datosPlantilla({ nombre: 'Compraventa (ajustada)', archivo_ruta: `${p.familia}/${p.familia.slice(0, 8)}-modelo.docx` }))])
    expect((await uno<{ nombre: string }>(`select nombre from public.contract_templates where id = $1`, [p.id])).nombre).toBe('Compraventa (ajustada)')
    await expect(rpc(legal, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Otro borrador') as r`, [p.familia, JSON.stringify(datosPlantilla({ archivo_ruta: `${p.familia}/otro.docx` }))])).rejects.toThrow(/borrador abierto/)
    await expect(rpc(gerente, `select public.contratos_plantilla_aprobar($1::uuid, 'Gerencia no aprueba')`, [p.id])).rejects.toThrow(/No tienes permiso/)
    await rpc(legal, `select public.contratos_plantilla_aprobar($1::uuid, 'Revisada y aprobada por Legal')`, [p.id])
    const t = await uno<{ estado: string; aprobada_nombre: string }>(`select estado, aprobada_nombre from public.contract_templates where id = $1`, [p.id])
    expect(t).toEqual({ estado: 'aprobada', aprobada_nombre: 'Legal' })
    await expect(rpc(legal, `select public.contratos_plantilla_guardar($1::uuid, null, $2::jsonb, 'Editar aprobada') as r`, [p.id, JSON.stringify(datosPlantilla({ archivo_ruta: `${p.familia}/x.docx` }))])).rejects.toThrow(/Solo se edita un borrador/)
    // Ni siquiera el dueño de la base puede alterar el contenido de una versión aprobada.
    await expect(db.query(`update public.contract_templates set cuerpo = 'x', nombre = 'Cambiado' where id = $1`, [p.id])).rejects.toThrow(/no se edita/)
    await expect(db.query(`delete from public.contract_templates where id = $1`, [p.id])).rejects.toThrow(/no se borran/)
  })

  it('una nueva versión aprobada retira la anterior y las dos se conservan; retirar exige motivo', async () => {
    const p = await aprobada()
    const v2 = (await rpc<{ r: string }>(legal, `select public.contratos_plantilla_guardar(null, $1::uuid, $2::jsonb, 'Nueva versión con cláusula corregida') as r`, [p.familia, JSON.stringify(datosPlantilla({ archivo_ruta: `${p.familia}/v2.docx`, archivo_hash: sha('d') }))])).r
    expect((await uno<{ version: number }>(`select version from public.contract_templates where id = $1`, [v2])).version).toBe(2)
    await rpc(legal, `select public.contratos_plantilla_aprobar($1::uuid, 'Versión 2 aprobada')`, [v2])
    const vs = await q<{ version: number; estado: string; retirada_motivo: string | null }>(legal, `select version, estado, retirada_motivo from public.contract_templates where familia_id = $1 order by version`, [p.familia])
    expect(vs).toEqual([{ version: 1, estado: 'retirada', retirada_motivo: 'Sustituida por la versión 2' }, { version: 2, estado: 'aprobada', retirada_motivo: null }])
    await expect(rpc(legal, `select public.contratos_plantilla_retirar($1::uuid, 'no')`, [v2])).rejects.toThrow(/motivo/)
    await rpc(legal, `select public.contratos_plantilla_retirar($1::uuid, 'Se sustituirá por un nuevo modelo')`, [v2])
    await expect(rpc(legal, `select public.contratos_plantilla_retirar($1::uuid, 'Ya retirada')`, [v2])).rejects.toThrow(/Solo se retira una plantilla aprobada/)
    await expect(db.query(`update public.contract_templates set estado = 'aprobada' where id = $1`, [v2])).rejects.toThrow(/no se reactiva/)
    const ev = (await q<{ accion: string }>(legal, `select accion from public.contract_template_events where plantilla_id = $1 order by fecha`, [v2])).map((e) => e.accion)
    expect(ev).toEqual(['Crear versión 2', 'Aprobar versión 2', 'Retirar versión 2'])
  })

  it('quién ve qué plantillas: Gerencia y Legal las consultan; Comercial, Finanzas y Constructor no', async () => {
    const p = await nuevaPlantilla()
    expect((await q(gerente, `select id from public.contract_templates where id = $1`, [p.id])).length).toBe(1)
    expect((await q(legal, `select id from public.contract_templates where id = $1`, [p.id])).length).toBe(1)
    for (const u of [carlos, finanzas, constructor, sofia]) expect(await q(u, `select id from public.contract_templates`)).toEqual([])
    await expect(q(gerente, `update public.contract_templates set nombre = 'Hackeado' where id = $1`, [p.id])).resolves.toEqual([])
    expect((await uno<{ nombre: string }>(`select nombre from public.contract_templates where id = $1`, [p.id])).nombre).not.toBe('Hackeado')
    await expect(q(legal, `insert into public.contract_templates (familia_id, version, nombre, tipo_documento, formato, cuerpo, creada_nombre) values (gen_random_uuid(), 1, 'Directa', 'otro', 'texto', 'x', 'x')`)).rejects.toThrow()
  })
})

describe('compradores y apoderados', () => {
  it('Legal completa los datos legales del principal y agrega un comprador adicional y un apoderado, con auditoría', async () => {
    const c = await contratoNuevo()
    await expect(rpc(carlos, `select public.contratos_comprador_principal_guardar($1::uuid, '{}'::jsonb, 'Comercial no completa datos legales')`, [c.id])).rejects.toThrow(/No tienes permiso/)
    await expect(rpc(legal, `select public.contratos_comprador_principal_guardar($1::uuid, '{"estado_civil":"complicado"}'::jsonb, 'Estado civil inválido')`, [c.id])).rejects.toThrow(/Estado civil/)
    const doc = cedula()
    await rpc(legal, `select public.contratos_comprador_principal_guardar($1::uuid, $2::jsonb, 'Datos según la cédula')`, [c.id, JSON.stringify({ documento: doc, domicilio: 'Av. 6 de Diciembre N34-10', ciudad: 'Quito', estado_civil: 'casado', nacionalidad: 'ecuatoriana' })])
    const adicional = (await rpc<{ r: string }>(legal, `select public.contratos_comprador_guardar($1::uuid, null, $2::jsonb, 'Cónyuge que compra en conjunto') as r`,
      [c.id, JSON.stringify({ rol: 'comprador', nombre: 'María Elena Salazar Ruiz', documento: '1712345678', nacionalidad: 'ecuatoriana', estado_civil: 'casado', domicilio: 'Av. 6 de Diciembre N34-10', porcentaje: 50 })])).r
    await rpc(legal, `select public.contratos_comprador_guardar($1::uuid, null, $2::jsonb, 'Poder especial del comprador') as r`,
      [c.id, JSON.stringify({ rol: 'apoderado', nombre: 'Pablo Andrade Mora', documento: '1798765432', poder_detalle: 'Poder especial otorgado ante la Notaría 12 de Quito' })])
    const d = await datosDoc(c.id) as { comprador: Record<string, string>; compradores: unknown[]; compradores_adicionales: unknown[]; apoderados: { representa_a: string; poder_detalle: string }[] }
    expect(d.comprador).toMatchObject({ documento: doc, domicilio: 'Av. 6 de Diciembre N34-10', estado_civil: 'casado' })
    expect(d.compradores).toHaveLength(2)
    expect(d.compradores_adicionales).toHaveLength(1)
    expect(d.apoderados[0]).toMatchObject({ representa_a: d.comprador.nombre, poder_detalle: 'Poder especial otorgado ante la Notaría 12 de Quito' })
    // Retirar conserva el registro.
    await rpc(legal, `select public.contratos_comprador_retirar($1::uuid, 'Ya no compra en conjunto')`, [adicional])
    expect(((await datosDoc(c.id)) as { compradores: unknown[] }).compradores).toHaveLength(1)
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_buyers where contract_id = $1`, [c.id])).n).toBe(2)
    const aud = await uno<{ n: number }>(`select count(*)::int n from public.contract_document_events where contract_id = $1`, [c.id])
    expect(aud.n).toBeGreaterThanOrEqual(4)
    await expect(rpc(legal, `select public.contratos_comprador_guardar($1::uuid, null, $2::jsonb, 'Sin rol válido') as r`, [c.id, JSON.stringify({ rol: 'testigo', nombre: 'Nombre Largo' })])).rejects.toThrow(/comprador o apoderado/)
  })
})

describe('generación de documentos', () => {
  it('muestra exactamente qué datos faltan y permite completarlos desde la pantalla autorizada', async () => {
    const p = await aprobada()
    const c = await contratoNuevo()
    const d = await datosDoc(c.id)
    const faltan = (await rpc<{ r: { clave: string; etiqueta: string }[] }>(legal, `select public.contratos_faltantes($1::uuid, $2::jsonb) as r`, [p.id, JSON.stringify(d)])).r
    // La cédula ya viene de la ficha: sin ella no se puede reservar.
    expect(faltan.map((f) => f.clave).sort()).toEqual(['comprador.domicilio', 'lugar_firma', 'vendedora.razon_social'])
    await expect(registrar(legal, c.id, p.id, d, {})).rejects.toThrow(/Faltan datos obligatorios: .*(Cédula|Domicilio)/)
    // El domicilio y la cédula se corrigen en el comprador, la razón social en la entidad vendedora y el lugar es un dato manual.
    await rpc(legal, `select public.contratos_comprador_principal_guardar($1::uuid, $2::jsonb, 'Datos según la cédula')`, [c.id, JSON.stringify({ documento: cedula(), domicilio: 'Quito' })])
    await rpc(legal, `select public.contratos_entidad_guardar($1::jsonb, 'Datos de la parte vendedora')`, [JSON.stringify({ razon_social: 'Inmobiliaria Jarval S.A.', ruc: '1791234567001', domicilio: 'Quito', representante_nombre: 'Representante Legal', representante_cargo: 'Gerente general' })])
    const d2 = await datosDoc(c.id, { lugar_firma: 'Quito' })
    expect((await rpc<{ r: unknown[] }>(legal, `select public.contratos_faltantes($1::uuid, $2::jsonb) as r`, [p.id, JSON.stringify(d2)])).r).toEqual([])
  })

  it('genera el documento con los datos reales, conserva el snapshot y no toca precio, cuotas ni estados', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const antes = {
      contrato: await uno(`select estado, precio, fecha_contrato, codigo_unidad, fecha_firma from public.contracts where id = $1`, [c.id]),
      cuotas: await rows(`select numero, concepto, vencimiento, monto from public.installments where contract_id = $1 order by numero`, [c.id]),
      unidad: await uno(`select estado from public.inventory_units where codigo = $1`, [c.codigo]),
    }
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' }) as { pago: { cuotas: unknown[]; reserva: number; saldo: number }; precio: { total: number }; unidad: { codigo: string } }
    expect(d.unidad.codigo).toBe(c.codigo)
    expect(d.pago.cuotas.length).toBeGreaterThan(20)
    expect(d.precio.total).toBe(Number((antes.contrato as { precio: string }).precio))
    const v = await registrar(legal, c.id, p.id, d)
    const doc = await uno<{ estado: string; numero: number; plantilla_version: number; generado_nombre: string; pdf_hash: string; datos: typeof d }>(`select estado, numero, plantilla_version, generado_nombre, pdf_hash, datos from public.contract_document_versions where id = $1`, [v])
    expect(doc).toMatchObject({ estado: 'borrador', numero: 1, plantilla_version: 1, generado_nombre: 'Legal', pdf_hash: sha('b') })
    expect(doc.datos).toEqual(JSON.parse(JSON.stringify(d)))
    expect(await uno(`select estado, precio, fecha_contrato, codigo_unidad, fecha_firma from public.contracts where id = $1`, [c.id])).toEqual(antes.contrato)
    expect(await rows(`select numero, concepto, vencimiento, monto from public.installments where contract_id = $1 order by numero`, [c.id])).toEqual(antes.cuotas)
    expect(await uno(`select estado from public.inventory_units where codigo = $1`, [c.codigo])).toEqual(antes.unidad)
  })

  it('rechaza datos desactualizados, rutas ajenas, hashes inválidos y quien no tiene permiso', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    await expect(registrar(legal, c.id, p.id, { ...d, comprador: { ...(d.comprador as object), nombre: 'Otro Nombre' } })).rejects.toThrow(/cambiaron/)
    await expect(rpc(legal, `select public.contratos_documento_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, null, 'Ruta ajena al contrato') as r`,
      [c.id, p.id, JSON.stringify({ lugar_firma: 'Quito' }), JSON.stringify(d), JSON.stringify({ ruta: 'otro/doc.pdf', hash: sha('b') })])).rejects.toThrow(/PDF no es válido/)
    await expect(rpc(legal, `select public.contratos_documento_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, null, 'Hash mal formado') as r`,
      [c.id, p.id, JSON.stringify({ lugar_firma: 'Quito' }), JSON.stringify(d), JSON.stringify({ ruta: `${c.id}/x.pdf`, hash: 'abc' })])).rejects.toThrow(/PDF no es válido/)
    for (const u of [carlos, constructor, finanzas, gerente]) await expect(registrar(u, c.id, p.id, d)).rejects.toThrow(/No tienes permiso/)
    await expect(datosDoc(c.id, {}, carlos)).rejects.toThrow(/No tienes permiso/)
    await expect(datosDoc(c.id, {}, constructor)).rejects.toThrow(/No tienes permiso/)
  })

  it('una plantilla en borrador o retirada no puede emitir documentos', async () => {
    const c = await contratoCompleto()
    const borrador = await nuevaPlantilla()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    await expect(registrar(legal, c.id, borrador.id, d)).rejects.toThrow(/no está aprobada/)
    const p = await aprobada()
    await rpc(legal, `select public.contratos_plantilla_retirar($1::uuid, 'Se detectó un error en la cláusula quinta')`, [p.id])
    await expect(registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, 'e')).rejects.toThrow(/no está aprobada/)
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_document_versions where contract_id = $1`, [c.id])).n).toBe(0)
  })

  it('el flujo de estados: Gerencia emite, el adjunto no firma por sí solo y Legal valida; después queda fijo', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    const v = await registrar(legal, c.id, p.id, d)
    await expect(rpc(legal, `select public.contratos_documento_emitir($1::uuid, 'Legal no emite')`, [v])).rejects.toThrow(/No tienes permiso/)
    await expect(rpc(legal, `select public.contratos_documento_adjuntar_firmado($1::uuid, $2::jsonb, $3::date, 'Aún no emitido')`,
      [v, JSON.stringify({ ruta: `${c.id}/firmado.pdf`, hash: sha('f'), nombre: 'firmado.pdf', mime: 'application/pdf', tamano: 9000 }), hoyGuayaquil()])).rejects.toThrow(/emitido y pendiente de firma/)
    await rpc(gerente, `select public.contratos_documento_emitir($1::uuid, 'Revisado: se autoriza la emisión')`, [v])
    expect((await uno<{ estado: string; emitido_nombre: string }>(`select estado, emitido_nombre from public.contract_document_versions where id = $1`, [v]))).toEqual({ estado: 'pendiente_firma', emitido_nombre: 'Gerencia' })
    await expect(rpc(gerente, `select public.contratos_documento_emitir($1::uuid, 'Emitir dos veces')`, [v])).rejects.toThrow(/en borrador/)
    // Adjuntar valida el archivo pero no firma.
    const adj = (ruta: string, hash = 'f') => rpc(legal, `select public.contratos_documento_adjuntar_firmado($1::uuid, $2::jsonb, $3::date, 'Contrato suscrito por las partes')`,
      [v, JSON.stringify({ ruta, hash: sha(hash), nombre: 'contrato-firmado.pdf', mime: 'application/pdf', tamano: 9000 }), hoyGuayaquil()])
    await expect(adj('otro-contrato/firmado.pdf')).rejects.toThrow(/archivo firmado no es válido/)
    await expect(adj(`${c.id}/b-doc.pdf`)).rejects.toThrow(/distinto del documento generado/)
    await expect(rpc(legal, `select public.contratos_documento_adjuntar_firmado($1::uuid, $2::jsonb, ((now() at time zone 'America/Guayaquil')::date + 5), 'Fecha futura')`, [v, JSON.stringify({ ruta: `${c.id}/f.pdf`, hash: sha('f'), nombre: 'f.pdf' })])).rejects.toThrow(/futura/)
    await expect(rpc(legal, `select public.contratos_documento_validar_firma($1::uuid, 'Sin adjunto aún')`, [v])).rejects.toThrow(/Adjunta primero/)
    await adj(`${c.id}/${v}/firmado.pdf`)
    const tras = await uno<{ estado: string; firmado_hash: string; firmado_cargado_nombre: string; firma_validada_en: string | null }>(`select estado, firmado_hash, firmado_cargado_nombre, firma_validada_en from public.contract_document_versions where id = $1`, [v])
    expect(tras).toMatchObject({ estado: 'pendiente_firma', firmado_hash: sha('f'), firmado_cargado_nombre: 'Legal', firma_validada_en: null })
    expect((await uno<{ estado: string }>(`select estado from public.contracts where id = $1`, [c.id])).estado).toBe('borrador')
    await expect(rpc(carlos, `select public.contratos_documento_validar_firma($1::uuid, 'Comercial no valida')`, [v])).rejects.toThrow(/No tienes permiso/)
    await rpc(legal, `select public.contratos_documento_validar_firma($1::uuid, 'Firmas verificadas contra el original')`, [v])
    expect((await uno<{ estado: string; firma_validada_nombre: string }>(`select estado, firma_validada_nombre from public.contract_document_versions where id = $1`, [v]))).toEqual({ estado: 'firmado', firma_validada_nombre: 'Legal' })
    // El estado comercial del contrato no cambió solo: se registra con su propio procedimiento.
    expect((await uno<{ estado: string }>(`select estado from public.contracts where id = $1`, [c.id])).estado).toBe('borrador')
    // Fijo: ni el contenido, ni el archivo firmado, ni el estado hacia atrás.
    await expect(db.query(`update public.contract_document_versions set datos = '{}'::jsonb where id = $1`, [v])).rejects.toThrow(/no se modifica/)
    await expect(db.query(`update public.contract_document_versions set pdf_hash = $2 where id = $1`, [v, sha('9')])).rejects.toThrow(/no se modifica/)
    await expect(db.query(`update public.contract_document_versions set firmado_hash = $2 where id = $1`, [v, sha('9')])).rejects.toThrow(/firmado y validado/)
    await expect(db.query(`update public.contract_document_versions set estado = 'borrador' where id = $1`, [v])).rejects.toThrow(/solo puede anularse/)
    await expect(db.query(`delete from public.contract_document_versions where id = $1`, [v])).rejects.toThrow(/no se borran/)
    // Con un documento firmado no se genera otro sin anularlo antes, con motivo.
    await expect(registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '7')).rejects.toThrow(/Ya hay un documento firmado/)
    await expect(rpc(legal, `select public.contratos_documento_anular($1::uuid, 'no')`, [v])).rejects.toThrow(/motivo/)
    await rpc(legal, `select public.contratos_documento_anular($1::uuid, 'Se detectó un error en la superficie indicada')`, [v])
    const v2 = await registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '7')
    expect((await uno<{ numero: number }>(`select numero from public.contract_document_versions where id = $1`, [v2])).numero).toBe(2)
    const hist = await q<{ numero: number; estado: string }>(legal, `select numero, estado from public.contract_document_versions where contract_id = $1 order by numero`, [c.id])
    expect(hist).toEqual([{ numero: 1, estado: 'anulado' }, { numero: 2, estado: 'borrador' }])
  })

  it('generar una nueva versión anula la anterior sin firmar y deja la trazabilidad completa', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    const v1 = await registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '1')
    const v2 = await registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '2')
    const estados = await rows<{ id: string; estado: string; numero: number; anulado_motivo: string | null }>(`select id, estado, numero, anulado_motivo from public.contract_document_versions where contract_id = $1 order by numero`, [c.id])
    expect(estados.map((e) => [e.numero, e.estado])).toEqual([[1, 'anulado'], [2, 'borrador']])
    expect(estados[0].anulado_motivo).toMatch(/Sustituido/)
    expect(estados[0].id).toBe(v1); expect(estados[1].id).toBe(v2)
    const ev = (await q<{ accion: string; usuario: string }>(legal, `select accion, usuario from public.contract_document_events where contract_id = $1 order by fecha, id`, [c.id])).map((e) => e.accion)
    expect(ev).toEqual(expect.arrayContaining(['Generar documento', 'Anular versión sustituida']))
    expect((await uno<{ n: number }>(`select count(*)::int n from public.audit_log where accion like 'documento contractual:%'`)).n).toBeGreaterThanOrEqual(3)
  })

  it('los documentos históricos no cambian cuando se actualizan los datos del cliente', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    const v = await registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '8')
    const antes = (await uno<{ datos: unknown }>(`select datos from public.contract_document_versions where id = $1`, [v])).datos
    await rpc(legal, `select public.contratos_comprador_principal_guardar($1::uuid, $2::jsonb, 'El comprador cambió de domicilio')`, [c.id, JSON.stringify({ documento: cedula(), domicilio: 'Cumbayá, calle Los Pinos', ciudad: 'Quito' })])
    await db.query(`update public.clients set telefono = '0999999999' where id = $1`, [c.cliente])
    expect((await uno<{ datos: unknown }>(`select datos from public.contract_document_versions where id = $1`, [v])).datos).toEqual(antes)
    expect(((await datosDoc(c.id, { lugar_firma: 'Quito' })) as { comprador: { domicilio: string } }).comprador.domicilio).toBe('Cumbayá, calle Los Pinos')
  })
})

describe('acceso a documentos por rol', () => {
  it('Legal, Gerencia, Finanzas y Administración consultan; Comercial y Constructor no ven nada', async () => {
    const p = await aprobada()
    const c = await contratoCompleto()
    const d = await datosDoc(c.id, { lugar_firma: 'Quito' })
    await registrar(legal, c.id, p.id, d, { lugar_firma: 'Quito' }, '6')
    for (const u of [legal, gerente, finanzas, admin]) {
      expect((await q(u, `select id from public.contract_document_versions where contract_id = $1`, [c.id])).length).toBe(1)
      expect((await q(u, `select id from public.contract_document_events where contract_id = $1`, [c.id])).length).toBeGreaterThan(0)
    }
    for (const u of [carlos, sofia, constructor]) {
      expect(await q(u, `select id from public.contract_document_versions`)).toEqual([])
      expect(await q(u, `select id from public.contract_buyers`)).toEqual([])
      expect(await q(u, `select id from public.contract_document_events`)).toEqual([])
    }
    await expect(q(legal, `insert into public.contract_document_versions (contract_id, plantilla_id, plantilla_nombre, plantilla_version, tipo_documento, numero, datos, pdf_ruta, pdf_hash, generado_nombre, generado_motivo)
      values ($1, $2, 'x', 1, 'x', 99, '{}', 'x/y.pdf', $3, 'x', 'directo')`, [c.id, p.id, sha('a')])).rejects.toThrow()
    await expect(rpc(constructor, `select public.contratos_plantilla_aprobar($1::uuid, 'Constructor no aprueba')`, [p.id])).rejects.toThrow(/No tienes permiso/)
  })

  it('un contrato fuera del alcance de quien llama no se puede tocar aunque tenga el permiso', async () => {
    const c = await contratoNuevo()
    const otroLegal = await crearUsuario(db, 'Legal Externo', 'legal', { alcance: 'propio' })
    await expect(rpc(otroLegal, `select public.contratos_comprador_principal_guardar($1::uuid, '{}'::jsonb, 'Fuera de mi alcance')`, [c.id])).rejects.toThrow(/fuera de tu alcance/)
    await expect(datosDoc(c.id, {}, otroLegal)).rejects.toThrow(/fuera de tu alcance/)
  })
})

describe('la migración', () => {
  it('es aditiva y se puede repetir sin cambiar datos', async () => {
    const antes = {
      plantillas: (await uno<{ n: number }>(`select count(*)::int n from public.contract_templates`)).n,
      docs: (await uno<{ n: number }>(`select count(*)::int n from public.contract_document_versions`)).n,
      entidad: await uno(`select razon_social, ruc from public.entidad_vendedora`),
      campos: (await uno<{ n: number }>(`select count(*)::int n from public.contract_fields`)).n,
    }
    await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_templates`)).n).toBe(antes.plantillas)
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_document_versions`)).n).toBe(antes.docs)
    expect(await uno(`select razon_social, ruc from public.entidad_vendedora`)).toEqual(antes.entidad)
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_fields`)).n).toBe(antes.campos)
  })
})
