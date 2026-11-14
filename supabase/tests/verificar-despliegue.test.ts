// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { crearDb, GRANTS_SUPABASE, STUB_SUPABASE } from './db'

const RAIZ = path.resolve(__dirname, '..')
const ARCHIVO = path.join(RAIZ, 'sql_produccion/VERIFICAR_DESPLIEGUE.sql')
const q = (t: string) => `'${t.replace(/'/g, "''")}'`

/** Consulta de solo lectura: compara la base con lo que deja una instalación limpia del repositorio. */
async function generar(db: PGlite) {
  const { rows } = await db.query<{ tipo: string; objeto: string; huella: string }>(`
    select 'funcion' as tipo, p.proname || '(' || replace(pg_get_function_identity_arguments(p.oid), 'public.', '') || ')' as objeto, md5(replace(p.prosrc, chr(13), '')) as huella
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    union all select 'columna', table_name || '.' || column_name, data_type from information_schema.columns where table_schema = 'public'
    union all select 'disparador', c.relname || '.' || t.tgname, '' from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
    union all select 'politica', tablename || '.' || policyname, '' from pg_policies where schemaname = 'public'
    union all select 'permiso', role_id || ':' || permiso, '' from public.role_permissions
    order by 1, 2`)
  const filas = rows.map((r) => `  (${q(r.tipo)}, ${q(r.objeto)}, ${q(r.huella)})`).join(',\n')
  return `-- AMURA · Verificación de despliegue. SOLO LECTURA: no modifica nada y no muestra datos de personas.
-- Generado desde las migraciones por supabase/tests/verificar-despliegue.test.ts. No editar a mano.
-- Compara producción con el repositorio. FALTA o DISTINTO = pendiente. ADICIONAL = existe en la base y no en el repositorio (informativo).
with esperado(tipo, objeto, huella) as (values
${filas}
), actual(tipo, objeto, huella) as (
  select 'funcion', p.proname || '(' || replace(pg_get_function_identity_arguments(p.oid), 'public.', '') || ')', md5(replace(p.prosrc, chr(13), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all select 'columna', table_name || '.' || column_name, data_type from information_schema.columns where table_schema = 'public'
  union all select 'disparador', c.relname || '.' || t.tgname, '' from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
  union all select 'politica', tablename || '.' || policyname, '' from pg_policies where schemaname = 'public'
  union all select 'permiso', role_id || ':' || permiso, '' from public.role_permissions
), diferencias as (
  select coalesce(e.tipo, a.tipo) as tipo, coalesce(e.objeto, a.objeto) as objeto,
    case when a.objeto is null then 'FALTA' when e.objeto is null then 'ADICIONAL' else 'DISTINTO' end as resultado
  from esperado e full join actual a on e.tipo = a.tipo and e.objeto = a.objeto
  where a.objeto is null or e.objeto is null or e.huella is distinct from a.huella
)
select 1 as orden, 'resumen' as tipo, resultado as objeto, count(*)::text as resultado from diferencias group by resultado
union all select 2, 'dato', 'version de PostgreSQL', split_part(version(), ' ', 2)
union all select 2, 'dato', 'receptor de pagos', coalesce((select receptor from public.payment_settings where id = 1), 'SIN DEFINIR')
union all select 2, 'dato', 'politica de liquidacion aprobada', (select liquidacion_aprobada::text from public.comision_parametros where id = 1)
union all select 2, 'dato', 'parametros de pago', (select reserva_pct || ' % firma, ' || cuotas_pct || ' % cuotas' from public.pricing_params where id = 1)
union all select 2, 'dato', 'usuarios activos: ' || rol_id, count(*)::text from public.profiles where estado = 'activo' group by rol_id
union all select 2, 'dato', 'unidades: ' || estado::text, count(*)::text from public.inventory_units group by estado
union all select 2, 'dato', 'registros: clientes', count(*)::text from public.clients
union all select 2, 'dato', 'registros: corredores', count(*)::text from public.corredores
union all select 2, 'dato', 'registros: reservas', count(*)::text from public.reservations
union all select 2, 'dato', 'registros: contratos', count(*)::text from public.contracts
union all select 2, 'dato', 'registros: pagos', count(*)::text from public.payments
union all select 2, 'dato', 'registros: comisiones', count(*)::text from public.comisiones
union all select 3, tipo, objeto, resultado from diferencias
order by 1, 2, 3;
`
}

const correr = async (db: PGlite, sql: string) => (await db.query<{ orden: number; tipo: string; objeto: string; resultado: string }>(sql)).rows
const difs = (rows: { orden: number; tipo: string; objeto: string; resultado: string }[]) => rows.filter((r) => r.orden === 3)

describe('verificación de despliegue', () => {
  let db: PGlite, sql: string
  beforeAll(async () => {
    db = await crearDb()
    sql = await generar(db)
    if (process.env.REGENERAR || !fs.existsSync(ARCHIVO)) fs.writeFileSync(ARCHIVO, sql)
  }, 120_000)

  it('el archivo está al día con las migraciones', () => {
    expect(fs.readFileSync(ARCHIVO, 'utf8').replace(/\r/g, '')).toBe(sql)
  })

  it('es una sola consulta y no escribe', () => {
    const sinComentarios = sql.replace(/^--.*$/gm, '')
    expect(sinComentarios.trim().startsWith('with esperado')).toBe(true)
    expect(sinComentarios.split(';').filter((x) => x.trim())).toHaveLength(1)
    const consulta = sinComentarios.slice(sinComentarios.indexOf('), actual('))
    expect(consulta).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i)
  })

  it('una instalación limpia no tiene diferencias y muestra los datos para desplegar', async () => {
    const rows = await correr(db, sql)
    expect(difs(rows)).toEqual([])
    expect(rows.map((r) => r.objeto)).toEqual(expect.arrayContaining(['receptor de pagos', 'politica de liquidacion aprobada', 'registros: clientes']))
  })

  it('detecta lo que falta, lo distinto y lo adicional', async () => {
    await db.exec(`
      create or replace function public.corredores_listar() returns jsonb language sql stable as $$ select '[]'::jsonb $$;
      drop function public.corredores_desvincular_acceso(uuid, text);
      create function public.sobrante() returns int language sql as $$ select 1 $$;`)
    const d = difs(await correr(db, sql))
    expect(d).toEqual(expect.arrayContaining([
      expect.objectContaining({ objeto: 'corredores_listar()', resultado: 'DISTINTO' }),
      expect.objectContaining({ objeto: 'corredores_desvincular_acceso(p_id uuid, p_motivo text)', resultado: 'FALTA' }),
      expect.objectContaining({ objeto: 'sobrante()', resultado: 'ADICIONAL' }),
    ]))
  })
})

const leer = (f: string) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
// Lo que falta en producción, en el orden del despliegue.
const PENDIENTES = ['20261112010000_correo_destinatario_efectivo.sql', '20261113000000_pagos_anticipados.sql', '20261114000000_cumplimiento.sql', '20261116000000_notificaciones.sql', '20261117000000_clientes_unicos_reasignacion.sql', '20261118000000_precios_lista_oficial.sql', '20261118010000_inventario_tres_estados.sql', '20261119000000_reserva_confirmacion_automatica.sql', '20261120000000_celular_unico_identificacion.sql', '20261121000000_supervisor_vende.sql', '20261122000000_comisiones_vendedor.sql', '20261123000000_captacion_leads.sql']
// Diferencias que devolvió verificar_despliegue.sql en producción (2026-11-11, por la CLI). Solo cambia con una nueva medición.
const MEDIDO = { migraciones: ['20261112010000_correo_destinatario_efectivo.sql'], diferencias: ['cobranza_alertas.destinatario_efectivo'] }

/** Base con todas las migraciones salvo las indicadas, como quedó producción. */
async function instalarSin(omitir: string[]) {
  const prod = new PGlite()
  await prod.exec(STUB_SUPABASE)
  for (const f of fs.readdirSync(path.join(RAIZ, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    if (omitir.includes(f)) continue
    await prod.exec(leer(`migrations/${f}`))
    if (f.startsWith('20261028120000')) await prod.exec(leer('seed.sql'))
    if (f.startsWith('20261028220000')) await prod.exec(leer('seed_roles.sql'))
  }
  await prod.exec(GRANTS_SUPABASE)
  return prod
}

describe('despliegue sobre el estado actual de producción', () => {
  it('sin las migraciones medidas como faltantes, la verificación da lo mismo que dio producción', async () => {
    expect(MEDIDO.migraciones.every((m) => PENDIENTES.includes(m))).toBe(true)
    const prod = await instalarSin(MEDIDO.migraciones)
    expect(difs(await correr(prod, fs.readFileSync(ARCHIVO, 'utf8'))).map((d) => d.objeto)).toEqual(MEDIDO.diferencias)
  }, 180_000)

  it('con datos existentes, las migraciones pendientes terminan igual que una instalación limpia y no tocan los datos', async () => {
    const prod = await instalarSin(PENDIENTES)
    const id = '11111111-1111-4111-8111-111111111111'
    await prod.query(`insert into auth.users (id, email) values ($1, 'a@b.ec')`, [id])
    await prod.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, 'Asesora', 'a@b.ec', 'activo', 'asesor')`, [id])
    await prod.query(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Existente', '0991110000', 'whatsapp', $1, $1, $1)`, [id])
    // Como en producción: una cédula de prueba con dígito verificador incorrecto se conserva tal cual.
    await prod.query(`insert into public.clients (nombre, telefono, documento, origen, asesor_id, created_by, atribucion_usuario_id) values ('Con cédula', '0991110001', '0915677083', 'whatsapp', $1, $1, $1)`, [id])
    const antes = (await prod.query(`select id, etapa, version, updated_at from public.clients`)).rows
    const jarval = '33333333-3333-4333-8333-333333333333'
    await prod.query(`insert into auth.users (id, email) values ($1, 'j@b.ec')`, [jarval])
    await prod.query(`insert into public.profiles (id, nombre, email, estado, rol_id) values ($1, 'Promotor', 'j@b.ec', 'activo', 'jarval')`, [jarval])

    // Como en producción: 5 unidades disponibles y las demás por confirmar.
    await prod.query(`update public.inventory_units set estado = 'por_confirmar'`)
    await prod.query(`update public.inventory_units set estado = 'disponible' where codigo in (select codigo from public.inventory_units order by codigo limit 5)`)

    expect(difs(await correr(prod, fs.readFileSync(ARCHIVO, 'utf8')))).not.toEqual([])

    for (const f of PENDIENTES) await prod.exec(leer(`migrations/${f}`))
    expect(difs(await correr(prod, fs.readFileSync(ARCHIVO, 'utf8')))).toEqual([])
    expect((await prod.query(`select id, etapa, version, updated_at from public.clients`)).rows).toEqual(antes)
    // Sin compromisos, las unidades por confirmar quedan disponibles; las 72 con la lista oficial del 12/11/2026.
    expect((await prod.query(`select estado, count(*)::int as n from public.inventory_units group by estado`)).rows).toEqual([{ estado: 'disponible', n: 72 }])
    const lista = (await prod.query<{ t: string; una: boolean }>(`select sum(public.precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, 230)) as t, bool_and(usd_m2 = usd_m2_lista) as una from public.inventory_units`)).rows[0]
    expect(Math.abs(Number(lista.t) - 11129497)).toBeLessThan(60)
    expect(lista.una).toBe(true)
    expect((await prod.query(`select rol_id, estado from public.profiles where id = $1`, [jarval])).rows[0]).toEqual({ rol_id: 'jarval', estado: 'activo' })
    // Se puede repetir sin efecto.
    for (const f of PENDIENTES) await prod.exec(leer(`migrations/${f}`))
    expect(difs(await correr(prod, fs.readFileSync(ARCHIVO, 'utf8')))).toEqual([])
  }, 180_000)
})
