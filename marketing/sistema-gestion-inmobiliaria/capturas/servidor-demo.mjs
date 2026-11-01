// Base demostrativa EN MEMORIA para capturar las pantallas reales del software.
// Usa las migraciones reales con Postgres local (PGlite). No se conecta a Supabase ni a producción:
// al cerrar este proceso, todos los datos desaparecen. Personas y operaciones son ficticias.
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SB = path.resolve(AQUI, '../../../supabase')
const leer = (f) => fs.readFileSync(path.join(SB, f), 'utf8')
const PARSERS = { 1700: (v) => Number(v), 1082: (v) => v, 1114: (v) => v, 1184: (v) => v }
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador no válido: ${s}`); return s }

const db = new PGlite()
await db.exec(`
create role anon nologin; create role authenticated nologin; create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; grant select on auth.users to authenticated;`)
for (const m of fs.readdirSync(path.join(SB, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(leer(`migrations/${m}`))
  if (m.startsWith('20261028120000')) await db.exec(leer('seed.sql'))
  if (m.startsWith('20261028220000')) await db.exec(leer('seed_roles.sql'))
}
await db.exec(`grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;`)

let turno = Promise.resolve()
const como = (u, fn) => {
  const r = turno.catch(() => {}).then(async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${u}', false);`)
    try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
  })
  turno = r
  return r
}
const sql = (u, q, p = []) => como(u, () => db.query(q, p, { parsers: PARSERS }))
const uno = async (u, q, p) => (await sql(u, q, p)).rows[0]
const avisos = []
const intento = async (titulo, fn) => { try { return await fn() } catch (e) { avisos.push(`${titulo}: ${e.message}`); return null } }

async function usuario(nombre, rol) {
  const id = (await db.query('select gen_random_uuid() as id')).rows[0].id
  const email = `${nombre.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ +/g, '.')}@ejemplo.ec`
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  await db.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, $2, $3, 'activo', $4)`, [id, nombre, email, rol])
  return id
}

/* --------------------------------------------------------- datos demostrativos */

const admin = await usuario('Gerencia General', 'administrador')
const gerente = await usuario('Gerencia Comercial', 'gerencia')
const finanzas = await usuario('Área de Finanzas', 'finanzas')
const finanzas2 = await usuario('Tesorería', 'finanzas')
const vendedor1 = await usuario('Asesor Comercial Uno', 'asesor')
const vendedor2 = await usuario('Asesor Comercial Dos', 'asesor')
const obra = await usuario('Residente de Obra', 'constructor')
const USUARIOS = { admin, gerente, finanzas, vendedor1, obra }

await db.exec(`update public.inventory_units set estado = 'disponible'`)
await sql(admin, `select public.config_definir_receptor('NUVAREL', 'Configuración demostrativa')`)
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
const unidades = (await db.query(`select codigo from public.inventory_units order by edificio desc, piso desc, posicion`)).rows.map((u) => u.codigo)
let iu = 0
const unidad = () => unidades[(iu += 3) % unidades.length]

const NOMBRES = ['Valeria Montalvo', 'Andrés Cevallos', 'Paola Intriago', 'Diego Almeida', 'Carolina Zambrano', 'Felipe Barragán', 'Lucía Benítez', 'Martín Espinel',
  'Gabriela Terán', 'Roberto Salazar', 'Daniela Vinueza', 'Javier Paredes', 'Sofía Andrade', 'Esteban Moncayo', 'Camila Ruales', 'Ricardo Viteri', 'Natalia Proaño', 'Fernando Guerra']
const ORIGENES = ['instagram', 'whatsapp', 'referido', 'instagram', 'whatsapp']
let n = 0
const adj = (pre, id) => JSON.stringify({ ruta: `${pre}/${id}/${++n}.pdf`, nombre: 'comprobante-demo.pdf', mime: 'application/pdf', tamano: 10, hash: 'demo' })

async function cliente(i) {
  const v = i % 2 ? vendedor2 : vendedor1
  const id = (await uno(v, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: NOMBRES[i], telefono: `09900${String(10000 + i)}`, email: `cliente${i + 1}@ejemplo.ec`, origen: ORIGENES[i % 5], origen_detalle: ORIGENES[i % 5] === 'referido' ? 'Cliente referido' : '' }), v])).id
  await intento('actividad', () => sql(v, `select public.clientes_registrar_actividad(null, $1, 'llamada', $2::date, 'Primer contacto: interés en departamentos de 2 habitaciones.', null)`, [id, hoy]))
  return { id, v }
}
async function cotizar({ id, v }) {
  const op = (await uno(v, `select public.oportunidades_crear($1, $2, null) as id`, [id, unidad()])).id
  return (await uno(v, `select public.cotizaciones_emitir($1, 0, 15, '') as id`, [op])).id
}
async function solicitud(c) {
  const q = await cotizar(c)
  await sql(c.v, `select public.cotizaciones_aceptar($1, 'Cliente acepta la propuesta')`, [q])
  return (await uno(c.v, `select public.reservas_solicitar($1) as id`, [q])).id
}
async function conPago(c) {
  const r = await solicitud(c)
  const m = (await uno(admin, `select monto_reserva from public.reservations where id = $1`, [r])).monto_reserva
  await sql(c.v, `select public.reservas_reportar_pago($1::uuid, $2, $3::date, 'Banco Demo', $4, $5::jsonb)`, [r, m, hoy, `TRF-${r.slice(0, 6)}`, adj('reservas', r)])
  return { r, m }
}
async function verificada(c) {
  const p = await conPago(c)
  await sql(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [p.r, p.m, hoy, `BAN-${p.r.slice(0, 6)}`])
  return p.r
}
async function aprobada(c) {
  const r = await verificada(c)
  await sql(gerente, `select public.reservas_aprobar($1, 'Aprobada por gerencia')`, [r])
  return r
}
async function contratoFirmado(c, pagos) {
  const r = await aprobada(c)
  const k = (await uno(admin, `select public.contratos_crear($1, $2::date, 'Contrato demostrativo') as id`, [r, hoy])).id
  await sql(admin, `select public.contratos_firmar($1, 'Firma demostrativa', 'contratos/demo.pdf')`, [k])
  const cuotas = (await db.query(`select monto from public.installments where contract_id = $1 and monto > 0 order by numero offset 1 limit $2`, [k, pagos], { parsers: PARSERS })).rows
  for (const q of cuotas) {
    const p = (await uno(finanzas, `select public.cobranzas_reportar_pago($1, $2, $3::date, 'Banco Demo', $4, $5::jsonb) as id`, [k, q.monto, hoy, `TRF-${++n}`, adj('contratos', k)])).id
    await sql(finanzas2, `select public.cobranzas_confirmar_pago($1, true, '')`, [p])
  }
}

const clientes = []
for (let i = 0; i < NOMBRES.length; i++) clientes.push(await cliente(i))
const etapas = [(c) => contratoFirmado(c, 3), (c) => contratoFirmado(c, 2), (c) => contratoFirmado(c, 1), aprobada, aprobada, verificada, verificada, conPago, conPago, solicitud, cotizar, cotizar, cotizar]
for (let i = 0; i < etapas.length; i++) await intento(`venta ${i}`, () => etapas[i](clientes[i]))

// Plan de implementación del proyecto, con responsables genéricos en lugar de nombres.
await intento('plan', async () => {
  await db.exec(leer('carga/plan_amura_inicial.sql').replace('REEMPLAZAR@correo.com', 'gerencia.general@ejemplo.ec'))
  await db.exec(`alter table public.plan_activities disable trigger user;
    update public.plan_activities set responsable_texto = 'Equipo del proyecto', aprobador_texto = 'Gerencia';
    update public.plan_activities a set avance = v.pct, estado = case when v.pct > 0 then 'en_ejecucion' else 'pendiente' end
      from (select id, case when row_number() over (order by codigo) <= 60 then 100 when row_number() over (order by codigo) <= 95 then 45 else 0 end as pct from public.plan_activities) v where v.id = a.id;
    alter table public.plan_activities enable trigger user;`)
})

// Avance de obra por frente.
const frentes = (await db.query(`select id, codigo from public.obra_frentes order by codigo`)).rows
const PCT = { edificio1: 62, edificio2: 38 }
for (const f of frentes) {
  await intento(`obra ${f.codigo}`, () => sql(obra, `select public.obra_plantilla_cargar($1::uuid, 'Etapas de partida del frente')`, [f.id]))
  const acts = (await db.query(`select id from public.obra_actividades where frente_id = $1 order by orden`, [f.id])).rows
  const meta = PCT[f.codigo] ?? 75
  for (let i = 0; i < acts.length; i++) {
    const av = Math.max(0, Math.min(100, Math.round(meta * 2 - (i / Math.max(1, acts.length - 1)) * meta * 2)))
    await intento(`avance ${f.codigo}`, () => sql(obra, `select public.obra_avance_guardar($1, $2::date, $3, null, 'Residente de Obra', 'Registro demostrativo')`, [acts[i].id, hoy, av]))
  }
}
await db.exec(`update public.medios_proyecto set activo = activo`)

const resumen = {}
for (const t of ['clients', 'quotes', 'reservations', 'contracts', 'payments', 'plan_activities', 'obra_actividades', 'obra_avances']) resumen[t] = await intento(t, async () => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n)
console.log('Datos demostrativos:', JSON.stringify(resumen))
if (avisos.length) console.log('Avisos:\n' + [...new Set(avisos)].slice(0, 25).join('\n'))

/* ------------------------------------------------------------ acceso para las pantallas */

async function atender(b) {
  const u = USUARIOS[b.perfil] ?? admin
  if (b.op === 'sesion') return (await uno(u, `select public.mi_sesion() as s`)).s
  if (b.op === 'rpc') {
    const nombres = Object.keys(b.args ?? {})
    const lista = nombres.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
    const valores = nombres.map((k) => { const v = b.args[k]; return v !== null && typeof v === 'object' && (!Array.isArray(v) || v.some((x) => x !== null && typeof x === 'object')) ? JSON.stringify(v) : v })
    const conj = (await db.query(`select bool_or(proretset) as s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [b.fn])).rows[0]?.s
    if (conj) return (await sql(u, `select * from public.${ident(b.fn)}(${lista})`, valores)).rows
    return (await sql(u, `select public.${ident(b.fn)}(${lista}) as r`, valores)).rows[0]?.r ?? null
  }
  const o = b.opts ?? {}
  const partes = []; const params = []
  for (const [k, v] of Object.entries(o.filtros ?? {})) { if (v === null) partes.push(`${ident(k)} is null`); else { params.push(v); partes.push(`${ident(k)} = $${params.length}`) } }
  const orden = o.orden?.length ? ` order by ${o.orden.map((x) => `${ident(x.columna)} ${x.asc === false ? 'desc' : 'asc'}`).join(', ')}` : ''
  return (await sql(u, `select * from public.${ident(b.tabla)}${partes.length ? ` where ${partes.join(' and ')}` : ''}${orden}${o.limite ? ` limit ${Number(o.limite)}` : ''}${o.desde ? ` offset ${Number(o.desde)}` : ''}`, params)).rows
}

http.createServer((req, res) => {
  let cuerpo = ''
  req.on('data', (c) => { cuerpo += c })
  req.on('end', async () => {
    res.setHeader('content-type', 'application/json')
    try { res.end(JSON.stringify({ r: await atender(JSON.parse(cuerpo)) })) } catch (e) { res.end(JSON.stringify({ error: e.message })) }
  })
}).listen(5199, '127.0.0.1', () => console.log('LISTO en 127.0.0.1:5199'))
