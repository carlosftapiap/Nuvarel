// Respaldo lógico de producción por la CLI de Supabase (solo lectura), para cuando no se dispone de la contraseña de la base.
// Exporta cada tabla del esquema public en JSON y una instantánea del esquema (funciones, políticas, restricciones,
// disparadores e índices), con un manifiesto de filas y SHA-256. Verifica después que los conteos coinciden con la base.
// El respaldo contiene datos de clientes: se guarda FUERA del repositorio (por omisión D:\Empresas\NUVAREL\Respaldos-Supabase).
// Uso: node scripts/respaldo-logico.mjs [carpeta-destino]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const destinoBase = process.argv[2] ?? 'D:/Empresas/NUVAREL/Respaldos-Supabase'
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const carpeta = path.join(destinoBase, `logico-${sello}`)
fs.mkdirSync(carpeta, { recursive: true })
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-'))

/** Ejecuta una consulta de solo lectura y devuelve sus filas. */
function consultar(sql) {
  const archivo = path.join(temporal, 'q.sql')
  fs.writeFileSync(archivo, sql)
  const salida = execFileSync('npx', ['-y', 'supabase', 'db', 'query', '--linked', '--read-only', '-f', archivo], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, shell: true })
  const json = JSON.parse(salida.slice(salida.indexOf('{')))
  if (json.error || json._tag === 'Error') throw new Error(JSON.stringify(json.error ?? json))
  return json.rows
}
const sha = (s) => createHash('sha256').update(s).digest('hex')
const ident = (t) => `"${t.replace(/"/g, '""')}"`

const tablas = consultar(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`).map((r) => r.t)
const manifiesto = { proyecto: 'sjjjlnqgcaqtkmzdcmog', creado: new Date().toISOString(), tablas: {}, esquema: null }

// Por grupos de 8 tablas: menos llamadas a la CLI.
for (let i = 0; i < tablas.length; i += 8) {
  const grupo = tablas.slice(i, i + 8)
  const sql = grupo.map((t) => `select '${t}' as tabla, (select count(*) from public.${ident(t)}) as n, coalesce((select json_agg(x) from public.${ident(t)} x), '[]'::json) as filas`).join('\nunion all\n')
  for (const r of consultar(sql)) {
    const contenido = JSON.stringify(r.filas)
    fs.writeFileSync(path.join(carpeta, `${r.tabla}.json`), contenido)
    manifiesto.tablas[r.tabla] = { filas: Number(r.n), exportadas: r.filas.length, sha256: sha(contenido) }
  }
}

const esquema = consultar(`select json_build_object(
  'funciones', (select json_agg(json_build_object('firma', p.oid::regprocedure::text, 'definicion', pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'),
  'politicas', (select json_agg(row_to_json(x) order by x.tablename, x.policyname) from pg_policies x where x.schemaname = 'public'),
  'restricciones', (select json_agg(json_build_object('tabla', c.conrelid::regclass::text, 'nombre', c.conname, 'definicion', pg_get_constraintdef(c.oid)) order by 1) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'),
  'disparadores', (select json_agg(json_build_object('tabla', t.tgrelid::regclass::text, 'nombre', t.tgname, 'definicion', pg_get_triggerdef(t.oid)) order by 1) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal),
  'indices', (select json_agg(json_build_object('tabla', tablename, 'nombre', indexname, 'definicion', indexdef) order by 1) from pg_indexes where schemaname = 'public'),
  'extensiones', (select json_agg(extname order by extname) from pg_extension)) as e`)[0].e
const textoEsquema = JSON.stringify(esquema)
fs.writeFileSync(path.join(carpeta, '_esquema.json'), textoEsquema)
manifiesto.esquema = { funciones: esquema.funciones?.length ?? 0, politicas: esquema.politicas?.length ?? 0, sha256: sha(textoEsquema) }

// Verificación: cada archivo se vuelve a leer y se compara con el manifiesto y con un conteo nuevo en la base.
const conteos = consultar(tablas.map((t) => `select '${t}' as tabla, (select count(*) from public.${ident(t)}) as n`).join('\nunion all\n'))
const diferencias = []
for (const { tabla, n } of conteos) {
  const m = manifiesto.tablas[tabla]
  const leido = fs.readFileSync(path.join(carpeta, `${tabla}.json`), 'utf8')
  if (!m || sha(leido) !== m.sha256 || JSON.parse(leido).length !== m.filas || Number(n) !== m.filas) diferencias.push({ tabla, esperado: m?.filas, base: Number(n) })
}
manifiesto.verificacion = { fecha: new Date().toISOString(), tablas: tablas.length, filas: Object.values(manifiesto.tablas).reduce((t, x) => t + x.filas, 0), diferencias }
fs.writeFileSync(path.join(carpeta, '_manifiesto.json'), JSON.stringify(manifiesto, null, 2))
fs.rmSync(temporal, { recursive: true, force: true })
console.log(JSON.stringify({ carpeta, tablas: tablas.length, filas: manifiesto.verificacion.filas, funciones: manifiesto.esquema.funciones, diferencias }, null, 2))
if (diferencias.length) process.exit(1)
