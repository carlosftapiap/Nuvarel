import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

const MIGRACION = path.join(__dirname, '..', 'migrations', '20261031120000_avance_obra.sql')

let db: PGlite
let admin: string, gerencia: string, constructor: string, vendedor: string, finanzas: string, legal: string, jarval: string
let F: Record<string, string>

const q = <T = Record<string, unknown>>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows)
const uno = async <T = Record<string, unknown>>(u: string, sql: string, p: unknown[] = []) => (await q<T>(u, sql, p))[0]
const dueno = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows

const guardar = async (u: string, frente: string, datos: Record<string, unknown>, extra: { id?: string; version?: number; motivo?: string } = {}) =>
  (await uno<{ r: string }>(u, `select public.obra_actividad_guardar($1::uuid, $2::uuid, $3::int, $4::jsonb, $5) as r`,
    [frente, extra.id ?? null, extra.version ?? null, JSON.stringify(datos), extra.motivo ?? 'Prueba de obra'])).r
const pesos = (u: string, frente: string, lista: { id: string; peso: number | null }[]) =>
  uno(u, `select public.obra_pesos($1::uuid, $2::jsonb, 'Ajuste de ponderaciones')`, [frente, JSON.stringify(lista)])
const aprobarPesos = (u: string, frente: string) => uno(u, `select public.obra_pesos_aprobar($1::uuid, 'Ponderaciones del responsable técnico')`, [frente])
const registrar = async (u: string, act: string, fecha: string, avance: number, obs = '') =>
  (await uno<{ r: string }>(u, `select public.obra_avance_guardar($1::uuid, $2::date, $3::numeric, null, 'Juan Paez', $4) as r`, [act, fecha, avance, obs])).r
const frenteAvance = async (frente: string, modo = 'validado') =>
  (await dueno<{ v: string | null }>(`select public.obra_avance_frente($1::uuid, $2) as v`, [frente, modo]))[0].v
const hoy = () => new Date().toISOString().slice(0, 10)
const ayer = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerencia = await crearUsuario(db, 'Gerente', 'gerencia')
  constructor = await crearUsuario(db, 'Juan Paez', 'constructor')
  vendedor = await crearUsuario(db, 'Vera', 'asesor')
  finanzas = await crearUsuario(db, 'Fina', 'finanzas')
  legal = await crearUsuario(db, 'Lega', 'legal')
  jarval = await crearUsuario(db, 'Jar', 'jarval')
  F = Object.fromEntries((await dueno<{ id: string; codigo: string }>(`select id, codigo from public.obra_frentes`)).map((f) => [f.codigo, f.id]))
}, 120_000)

describe('estructura y permisos', () => {
  it('hay cuatro frentes independientes y ninguna fecha ni ponderación inventada', async () => {
    expect(Object.keys(F).sort()).toEqual(['edificio1', 'edificio2', 'terreno', 'urbanismo'])
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades`))[0].n).toBe(0)
    const nombres = await dueno<{ nombre: string }>(`select nombre from public.obra_frentes order by orden`)
    expect(nombres.map((f) => f.nombre)).toEqual(['Terreno y precarga', 'Urbanismo y áreas comunes', 'Edificio 1', 'Edificio 2'])
    const ctx = (await dueno<{ contexto: string }>(`select contexto from public.obra_frentes where codigo = 'terreno'`))[0].contexto
    expect(ctx).toMatch(/octubre de 2026/)
    expect(ctx).toMatch(/12 meses/)
  })

  it('cada perfil recibe solo lo que le corresponde', async () => {
    const permisos = async (rol: string) => (await dueno<{ permiso: string }>(`select permiso from public.role_permissions where role_id = $1 and permiso like 'obra.%' order by 1`, [rol])).map((r) => r.permiso)
    expect(await permisos('constructor')).toEqual(['obra.avance', 'obra.documentos', 'obra.editar', 'obra.exportar', 'obra.importar', 'obra.resumen', 'obra.ver'])
    expect(await permisos('gerencia')).toEqual(['obra.documentos', 'obra.exportar', 'obra.resumen', 'obra.validar', 'obra.ver'])
    expect(await permisos('asesor')).toEqual(['obra.resumen'])
    expect(await permisos('corredor')).toEqual(['obra.resumen'])
    expect(await permisos('supervisor')).toEqual(['obra.resumen'])
    expect(await permisos('finanzas')).toEqual(['obra.exportar', 'obra.resumen', 'obra.ver'])
    expect(await permisos('legal')).toEqual(['obra.documentos', 'obra.resumen'])
    expect((await permisos('administrador')).length).toBe(8)
    // El constructor no ve nada comercial.
    const comercial = await dueno<{ permiso: string }>(`select permiso from public.role_permissions where role_id = 'constructor' and permiso !~ '^(obra|inventario\\.tecnico)'`)
    expect(comercial).toEqual([])
  })

  it('el detalle técnico solo lo lee quien tiene obra.ver; el resumen, quien tiene obra.resumen', async () => {
    expect((await q(vendedor, `select * from public.obra_frentes`)).length).toBe(0)
    expect((await q(legal, `select * from public.obra_frentes`)).length).toBe(0)
    expect((await q(constructor, `select * from public.obra_frentes`)).length).toBe(4)
    expect((await q(finanzas, `select * from public.obra_frentes`)).length).toBe(4)
    const r = await q<{ nombre: string; avance_validado: string | null; pesos_aprobados: boolean }>(vendedor, `select * from public.obra_resumen()`)
    expect(r.map((x) => x.nombre)).toEqual(['Terreno y precarga', 'Urbanismo y áreas comunes', 'Edificio 1', 'Edificio 2'])
    expect(r.every((x) => x.avance_validado === null && x.pesos_aprobados === false)).toBe(true)
    expect(Object.keys(r[0]).sort()).not.toContain('contexto')
  })

  it('sin permiso de obra no hay ni resumen', async () => {
    const sin = await crearUsuario(db, 'Sin permisos', 'asesor')
    await db.query(`delete from public.role_permissions where role_id = 'asesor' and permiso = 'obra.resumen'`)
    await expect(q(sin, `select * from public.obra_resumen()`)).rejects.toThrow(/No tienes permiso/)
    await db.query(`insert into public.role_permissions (role_id, permiso) values ('asesor', 'obra.resumen')`)
  })

  it('nadie escribe directamente en las tablas: todo pasa por funciones', async () => {
    await expect(q(constructor, `insert into public.obra_actividades (frente_id, codigo, nombre) values ($1, 'X', 'Directa')`, [F.edificio1])).rejects.toThrow()
    await expect(q(admin, `insert into public.obra_avances (actividad_id, fecha_corte, avance, registrado_nombre) values (gen_random_uuid(), (now() at time zone 'America/Guayaquil')::date, 10, 'x')`)).rejects.toThrow()
    await expect(q(constructor, `update public.obra_frentes set pesos_aprobados_en = now()`)).resolves.toEqual([])
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_frentes where pesos_aprobados_en is not null`))[0].n).toBe(0)
  })
})

describe('plantillas y actividades', () => {
  it('la plantilla del edificio carga las 12 etapas editables, sin fechas ni ponderaciones, y solo en un frente vacío', async () => {
    const n = (await uno<{ r: number }>(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Cargar etapas del edificio') as r`, [F.edificio1])).r
    expect(n).toBeGreaterThan(40)
    const etapas = await q<{ nombre: string }>(constructor, `select nombre from public.obra_actividades where frente_id = $1 and parent_id is null order by orden`, [F.edificio1])
    expect(etapas.map((e) => e.nombre)).toEqual([
      'Preparación y replanteo', 'Cimentación', 'Estructura', 'Mampostería', 'Instalaciones hidrosanitarias', 'Instalaciones eléctricas y especiales',
      'Cubiertas e impermeabilización', 'Enlucidos y revestimientos', 'Carpintería y ventanería', 'Acabados', 'Sistemas y equipamiento', 'Pruebas, inspecciones y entrega',
    ])
    const vacios = await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades where frente_id = $1 and (peso is not null or plan_inicio is not null or plan_fin is not null or real_inicio is not null or avance_validado is not null)`, [F.edificio1])
    expect(vacios[0].n).toBe(0)
    await expect(uno(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Otra vez')`, [F.edificio1])).rejects.toThrow(/solo se carga en un frente vacío/)
    await expect(uno(vendedor, `select public.obra_plantilla_cargar($1::uuid, 'Sin permiso')`, [F.edificio2])).rejects.toThrow(/No tienes permiso/)
    const sub = await q<{ nombre: string }>(constructor, `select s.nombre from public.obra_actividades s join public.obra_actividades p on p.id = s.parent_id where p.frente_id = $1 and p.nombre = 'Cimentación' order by s.orden`, [F.edificio1])
    expect(sub.map((s) => s.nombre)).toEqual(['Excavación', 'Preparación', 'Acero', 'Encofrado', 'Fundición de losa'])
  })

  it('el Edificio 2 tiene su propio cronograma, independiente del Edificio 1', async () => {
    await uno(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Etapas del Edificio 2')`, [F.edificio2])
    const mismo = await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades a join public.obra_actividades b on b.id = a.parent_id where a.frente_id <> b.frente_id`)
    expect(mismo[0].n).toBe(0)
    const cuenta = async (f: string) => (await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades where frente_id = $1`, [f]))[0].n
    expect(await cuenta(F.edificio1)).toBe(await cuenta(F.edificio2))
  })

  it('el terreno y el urbanismo también parten de su plantilla', async () => {
    await uno(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Etapas del terreno')`, [F.terreno])
    await uno(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Etapas de urbanismo')`, [F.urbanismo])
    const t = await q<{ nombre: string }>(constructor, `select nombre from public.obra_actividades where frente_id = $1 and parent_id is null order by orden`, [F.terreno])
    expect(t.map((x) => x.nombre)).toEqual(['Precarga del terreno', 'Validación geotécnica y definición de cimentación'])
    const u = await q<{ nombre: string }>(constructor, `select nombre from public.obra_actividades where frente_id = $1 and parent_id is null order by orden`, [F.urbanismo])
    expect(u.map((x) => x.nombre)).toContain('Club y áreas comunes')
    expect(u.map((x) => x.nombre)).toContain('Garita y cerramientos')
  })

  it('crear, editar y reorganizar actividades: fechas vacías permitidas, validaciones y control de versión', async () => {
    const ed = F.edificio1
    const id = await guardar(constructor, ed, { codigo: 'X-01', nombre: 'Actividad nueva' })
    const a = (await dueno<{ version: number; plan_inicio: string | null; estado: string }>(`select version, plan_inicio, estado from public.obra_actividades where id = $1`, [id]))[0]
    expect(a).toMatchObject({ version: 1, plan_inicio: null, estado: 'por_programar' })
    await guardar(constructor, ed, { codigo: 'X-01', nombre: 'Actividad nueva', plan_inicio: '2027-02-01', plan_fin: '2027-02-10', observaciones: 'Con fechas' }, { id, version: 1 })
    const b = (await dueno<{ version: number; duracion_dias: number }>(`select version, duracion_dias from public.obra_actividades where id = $1`, [id]))[0]
    expect(b).toEqual({ version: 2, duracion_dias: 10 })
    await expect(guardar(constructor, ed, { codigo: 'X-01', nombre: 'Otra vez' }, { id, version: 1 })).rejects.toThrow(/Otra persona modificó/)
    await expect(guardar(constructor, ed, { codigo: 'X-02', nombre: 'Fechas mal', plan_inicio: '2027-03-10', plan_fin: '2027-03-01' })).rejects.toThrow(/anterior al inicio/)
    await expect(guardar(constructor, ed, { codigo: 'X-01', nombre: 'Repetida' })).rejects.toThrow(/Ya existe una actividad con ese código/)
    await expect(guardar(constructor, ed, { codigo: 'X-03', nombre: 'Peso malo', peso: 150 })).rejects.toThrow(/entre 0 y 100/)
    await expect(guardar(constructor, ed, { codigo: 'X-04', nombre: 'Sin motivo' }, { motivo: 'no' })).rejects.toThrow(/motivo/)
    await expect(guardar(vendedor, ed, { codigo: 'X-05', nombre: 'Vendedor' })).rejects.toThrow(/No tienes permiso/)
    await expect(guardar(gerencia, ed, { codigo: 'X-06', nombre: 'Gerencia no edita' })).rejects.toThrow(/No tienes permiso/)
    await expect(guardar(constructor, ed, { codigo: 'X-07', nombre: 'Usuario y externo', responsable_id: constructor, responsable_texto: 'Contratista' })).rejects.toThrow(/no ambos/)
    // Una actividad de otro frente no puede ser su superior.
    const otra = (await dueno<{ id: string }>(`select id from public.obra_actividades where frente_id = $1 limit 1`, [F.edificio2]))[0].id
    await expect(guardar(constructor, ed, { codigo: 'X-08', nombre: 'Superior ajena', parent_id: otra })).rejects.toThrow(/mismo frente/)
    // Reorganizar: mover bajo una etapa y rechazar ciclos.
    const etapa = (await dueno<{ id: string }>(`select id from public.obra_actividades where frente_id = $1 and nombre = 'Estructura'`, [ed]))[0].id
    await uno(constructor, `select public.obra_reordenar($1::uuid, $2::jsonb, 'Mover bajo Estructura')`, [ed, JSON.stringify([{ id, parent_id: etapa, orden: 999 }])])
    expect((await dueno<{ parent_id: string }>(`select parent_id from public.obra_actividades where id = $1`, [id]))[0].parent_id).toBe(etapa)
    await expect(uno(constructor, `select public.obra_reordenar($1::uuid, $2::jsonb, 'Ciclo')`, [ed, JSON.stringify([{ id: etapa, parent_id: id }])])).rejects.toThrow(/dentro de sí misma/)
  })

  it('las dependencias rechazan ciclos', async () => {
    const [a, b, c] = await Promise.all(['D-01', 'D-02', 'D-03'].map((c) => guardar(constructor, F.urbanismo, { codigo: c, nombre: `Dependencia ${c}` })))
    const dep = (p: string, s: string, agregar = true) => uno(constructor, `select public.obra_dependencia($1::uuid, $2::uuid, $3, 'Secuencia de obra')`, [p, s, agregar])
    await dep(a, b); await dep(b, c)
    await expect(dep(c, a)).rejects.toThrow(/ciclo/)
    await expect(dep(a, a)).rejects.toThrow()
    await dep(b, c, false)
    await dep(c, a)
    expect((await q<{ n: number }>(constructor, `select count(*)::int n from public.obra_dependencias where sucesora_id = $1`, [a]))[0].n).toBe(1)
  })
})

describe('ponderaciones, avances y validación', () => {
  let pre: { e1: string; a: string; b: string; e2: string }

  beforeAll(async () => {
    // Un frente con estructura propia para controlar los números: etapa 1 (60 %) con dos subactividades, etapa 2 (40 %) hoja.
    const f = F.terreno
    await dueno(`delete from public.obra_historial where frente_id = $1`, [f])
    await dueno(`update public.obra_actividades set parent_id = null where frente_id = $1`, [f])
    await dueno(`delete from public.obra_dependencias where predecesora_id in (select id from public.obra_actividades where frente_id = $1)`, [f])
    await dueno(`delete from public.obra_actividades where frente_id = $1`, [f])
    const e1 = await guardar(constructor, f, { codigo: 'P-1', nombre: 'Etapa uno' })
    const a = await guardar(constructor, f, { codigo: 'P-1.1', nombre: 'Sub a', parent_id: e1 })
    const b = await guardar(constructor, f, { codigo: 'P-1.2', nombre: 'Sub b', parent_id: e1 })
    const e2 = await guardar(constructor, f, { codigo: 'P-2', nombre: 'Etapa dos' })
    pre = { e1, a, b, e2 }
  })

  it('sin ponderaciones aprobadas no hay avance global: ni siquiera con avances validados', async () => {
    expect(await frenteAvance(F.terreno)).toBeNull()
    await expect(aprobarPesos(gerencia, F.terreno)).rejects.toThrow(/Faltan ponderaciones/)
    await pesos(constructor, F.terreno, [{ id: pre.e1, peso: 60 }, { id: pre.e2, peso: 30 }, { id: pre.a, peso: 50 }, { id: pre.b, peso: 50 }])
    await expect(aprobarPesos(gerencia, F.terreno)).rejects.toThrow(/deben sumar 100/)
  })

  it('solo Gerencia o Administración aprueban las ponderaciones, y cualquier cambio las vuelve a dejar pendientes', async () => {
    await pesos(constructor, F.terreno, [{ id: pre.e2, peso: 40 }])
    await expect(aprobarPesos(constructor, F.terreno)).rejects.toThrow(/No tienes permiso/)
    await expect(aprobarPesos(vendedor, F.terreno)).rejects.toThrow(/No tienes permiso/)
    await aprobarPesos(gerencia, F.terreno)
    const f = (await dueno<{ pesos_aprobados_nombre: string }>(`select pesos_aprobados_nombre from public.obra_frentes where id = $1`, [F.terreno]))[0]
    expect(f.pesos_aprobados_nombre).toBe('Gerente')
    await pesos(constructor, F.terreno, [{ id: pre.e2, peso: 35 }, { id: pre.e1, peso: 65 }])
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_frentes where id = $1 and pesos_aprobados_en is not null`, [F.terreno]))[0].n).toBe(0)
    await pesos(constructor, F.terreno, [{ id: pre.e2, peso: 40 }, { id: pre.e1, peso: 60 }])
    await aprobarPesos(admin, F.terreno)
    const hist = await dueno<{ accion: string }>(`select accion from public.obra_historial where frente_id = $1 order by fecha`, [F.terreno])
    expect(hist.map((h) => h.accion)).toContain('Ponderaciones sin aprobar')
    expect(hist.map((h) => h.accion)).toContain('Aprobar ponderaciones')
  })

  it('lo guardado cuenta de inmediato, sin segunda aprobación, y conserva quién y el valor anterior', async () => {
    const id = await registrar(constructor, pre.a, ayer(), 80, 'Primer reporte')
    expect((await dueno<Record<string, unknown>>(`select estado, avance_anterior, registrado_nombre, responsable_nombre from public.obra_avances where id = $1`, [id]))[0])
      .toEqual({ estado: 'validado', avance_anterior: null, registrado_nombre: 'Juan Paez', responsable_nombre: 'Juan Paez' })
    const act = (await dueno<{ avance_validado: string; estado: string; responsable_texto: string; real_inicio: string | null; real_fin: string | null }>(`select avance_validado, estado, responsable_texto, real_inicio, real_fin from public.obra_actividades where id = $1`, [pre.a]))[0]
    expect(Number(act.avance_validado)).toBe(80)
    expect(act).toMatchObject({ estado: 'en_ejecucion', responsable_texto: 'Juan Paez', real_fin: null })
    expect(act.real_inicio).not.toBeNull()
  })

  it('las funciones anteriores quedan cerradas para todos', async () => {
    for (const u of [admin, gerencia, constructor]) {
      await expect(uno(u, `select public.obra_avance_registrar($1::uuid, $2::date, 10, '', '')`, [pre.b, ayer()])).rejects.toThrow(/permission denied/)
      await expect(uno(u, `select public.obra_avance_validar($1::uuid, true, '')`, [pre.b])).rejects.toThrow(/permission denied/)
    }
  })

  it('el responsable es obligatorio; puede ser un usuario o una persona externa', async () => {
    const con = (resp: string | null, texto: string) => uno(constructor, `select public.obra_avance_guardar($1::uuid, $2::date, 10, $3::uuid, $4, '')`, [pre.b, ayer(), resp, texto])
    await expect(con(null, '')).rejects.toThrow(/responsable/)
    await expect(con('00000000-0000-0000-0000-000000000000', '')).rejects.toThrow(/no existe/)
    await con(constructor, 'se ignora')
    const a = (await dueno<{ responsable_id: string; responsable_texto: string }>(`select responsable_id, responsable_texto from public.obra_actividades where id = $1`, [pre.b]))[0]
    expect(a).toEqual({ responsable_id: constructor, responsable_texto: '' })
    await registrar(admin, pre.b, ayer(), 40)
  })

  it('reglas de registro: hojas, fechas, rango, y correcciones con historial', async () => {
    await expect(registrar(constructor, pre.e1, ayer(), 10)).rejects.toThrow(/se calcula con sus subactividades/)
    const pasado = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    await expect(registrar(constructor, pre.e2, pasado, 10)).rejects.toThrow(/futura/)
    await expect(registrar(constructor, pre.e2, ayer(), 101)).rejects.toThrow(/entre 0 y 100/)
    await expect(registrar(vendedor, pre.e2, ayer(), 10)).rejects.toThrow(/No tienes permiso/)
    await expect(registrar(gerencia, pre.e2, ayer(), 10)).rejects.toThrow(/No tienes permiso/)
    await registrar(constructor, pre.e2, ayer(), 20)
    // Corregir a la baja no exige observaciones, y queda como corrección con su valor anterior.
    await registrar(constructor, pre.a, hoy(), 70)
    expect(Number((await dueno<{ v: string }>(`select avance_validado v from public.obra_actividades where id = $1`, [pre.a]))[0].v)).toBe(70)
    const hist = await dueno<{ avance: string; avance_anterior: string | null }>(`select avance, avance_anterior from public.obra_avances where actividad_id = $1 order by registrado_en`, [pre.a])
    expect(hist.map((h) => [Number(h.avance), h.avance_anterior === null ? null : Number(h.avance_anterior)])).toEqual([[80, null], [70, 80]])
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_historial where actividad_id = $1 and accion = 'Corregir avance'`, [pre.a]))[0].n).toBe(1)
  })

  it('el estado sigue al porcentaje: 0 sin iniciar, 1 a 99 en ejecución, 100 completada', async () => {
    const estado = async () => (await dueno<{ estado: string; real_fin: string | null }>(`select estado, real_fin from public.obra_actividades where id = $1`, [pre.e2]))[0]
    await registrar(constructor, pre.e2, hoy(), 100)
    const c = await estado()
    expect(c.estado).toBe('completada')
    expect(c.real_fin).not.toBeNull()
    await registrar(constructor, pre.e2, hoy(), 0)
    expect(await estado()).toEqual({ estado: 'por_programar', real_fin: null })
    await registrar(constructor, pre.e2, hoy(), 20)
    expect((await estado()).estado).toBe('en_ejecucion')
  })

  it('el avance de cada frente usa las ponderaciones aprobadas', async () => {
    // a = 70, b = 40 → etapa 1 = 55; etapa 2 = 20 → frente = 0.6 × 55 + 0.4 × 20 = 41
    expect(Number(await frenteAvance(F.terreno))).toBeCloseTo(41, 2)
    // Los demás frentes siguen sin ponderaciones: el ponderado no da cifra.
    expect(await frenteAvance(F.edificio1)).toBeNull()
    expect(await frenteAvance(F.edificio2)).toBeNull()
  })

  it('el resumen muestra el avance actual, y lo ve quien solo tiene obra.resumen', async () => {
    for (const u of [vendedor, legal, jarval, finanzas, constructor]) {
      const t = (await q<{ codigo: string; avance_validado: string | null; pesos_aprobados: boolean; actividades: number; actividades_con_avance: number; ultimo_corte: string | null }>(u, `select * from public.obra_resumen() where codigo = 'terreno'`))[0]
      expect(Number(t.avance_validado)).toBeCloseTo(41, 2)
      expect(t.pesos_aprobados).toBe(true)
      expect(t.actividades).toBe(3)
      expect(t.actividades_con_avance).toBe(3)
      expect(t.ultimo_corte).not.toBeNull()
    }
  })

  it('una actividad cancelada sale del cálculo y de la suma de pesos', async () => {
    const nueva = await guardar(constructor, F.terreno, { codigo: 'P-3', nombre: 'Extra', peso: 10 })
    expect(await frenteAvance(F.terreno)).toBeNull() // la estructura cambió: pesos sin aprobar
    await guardar(constructor, F.terreno, { codigo: 'P-3', nombre: 'Extra', peso: 10, estado: 'cancelada' }, { id: nueva, version: 1 })
    await aprobarPesos(gerencia, F.terreno)
    expect(Number(await frenteAvance(F.terreno))).toBeCloseTo(41, 2)
  })
})

describe('cronograma aprobado, controles técnicos y evidencias', () => {
  it('aprobar el cronograma guarda una versión y reemplaza la anterior; exige fechas', async () => {
    await expect(uno(gerencia, `select public.obra_cronograma_aprobar($1::uuid, 'Sin fechas')`, [F.edificio2])).rejects.toThrow(/fechas previstas/)
    const act = (await dueno<{ id: string; version: number }>(`select id, version from public.obra_actividades where frente_id = $1 and parent_id is null order by orden limit 1`, [F.edificio2]))[0]
    await guardar(constructor, F.edificio2, { codigo: 'E-01', nombre: 'Preparación y replanteo', plan_inicio: '2027-01-04', plan_fin: '2027-02-05', peso: 8 }, { id: act.id, version: act.version })
    await expect(uno(constructor, `select public.obra_cronograma_aprobar($1::uuid, 'El constructor no aprueba')`, [F.edificio2])).rejects.toThrow(/No tienes permiso/)
    expect((await uno<{ r: number }>(gerencia, `select public.obra_cronograma_aprobar($1::uuid, 'Cronograma aprobado en comité') as r`, [F.edificio2])).r).toBe(1)
    expect((await uno<{ r: number }>(admin, `select public.obra_cronograma_aprobar($1::uuid, 'Se ajustó el inicio') as r`, [F.edificio2])).r).toBe(2)
    const v = await q<{ version: number; estado: string }>(constructor, `select version, estado from public.obra_cronogramas where frente_id = $1 order by version`, [F.edificio2])
    expect(v).toEqual([{ version: 1, estado: 'reemplazado' }, { version: 2, estado: 'aprobado' }])
    const snap = (await dueno<{ actividades: { plan_inicio: string }[] }>(`select actividades from public.obra_cronogramas where frente_id = $1 and version = 1`, [F.edificio2]))[0]
    expect(snap.actividades.some((a) => a.plan_inicio === '2027-01-04')).toBe(true)
  })

  it('controles técnicos de la precarga: asentamientos con fecha, valor y unidad', async () => {
    const pre = (await dueno<{ id: string }>(`select id from public.obra_actividades where frente_id = $1 and codigo = 'P-1.1'`, [F.terreno]))[0].id
    await uno(constructor, `select public.obra_control_registrar($1::uuid, $2::uuid, $3::date, 'Asentamiento', 12.5, 'mm', 'Placa 3')`, [F.terreno, pre, ayer()])
    const c = await q<{ tipo: string; valor: string; unidad: string; registrado_nombre: string }>(gerencia, `select tipo, valor, unidad, registrado_nombre from public.obra_controles where frente_id = $1`, [F.terreno])
    expect(c.map((x) => [x.tipo, Number(x.valor), x.unidad, x.registrado_nombre])).toEqual([['Asentamiento', 12.5, 'mm', 'Juan Paez']])
    await expect(uno(vendedor, `select public.obra_control_registrar($1::uuid, null, (now() at time zone 'America/Guayaquil')::date, 'Asentamiento', 1, 'mm', '')`, [F.terreno])).rejects.toThrow(/No tienes permiso/)
    expect((await q(vendedor, `select * from public.obra_controles`)).length).toBe(0)
  })

  it('las evidencias se registran con ruta del frente, se retiran con motivo y se ven según el perfil', async () => {
    const act = (await dueno<{ id: string }>(`select id from public.obra_actividades where frente_id = $1 and codigo = 'P-1.1'`, [F.terreno]))[0].id
    const ev = (tipo: string, ruta: string, extra: { tamano?: number } = {}) => uno<{ r: string }>(constructor,
      `select public.obra_evidencia_registrar($1::uuid, $2::uuid, null, $3, 'archivo', 'detalle', $4, 'image/jpeg', $5::bigint, (now() at time zone 'America/Guayaquil')::date) as r`,
      [F.terreno, act, tipo, ruta, extra.tamano ?? 1000])
    const foto = (await ev('foto', `${F.terreno}/${act}/1-foto.jpg`)).r
    await ev('informe', `${F.terreno}/${act}/2-informe.pdf`)
    await expect(ev('foto', `${F.edificio1}/x/otra.jpg`)).rejects.toThrow(/no corresponde al frente/)
    await expect(ev('foto', `${F.terreno}/${act}/grande.jpg`, { tamano: 30_000_000 })).rejects.toThrow(/25 MB/)
    await expect(ev('video', `${F.terreno}/${act}/v.mp4`)).rejects.toThrow(/Tipo de evidencia/)
    await expect(uno(vendedor, `select public.obra_evidencia_registrar($1::uuid, null, null, 'foto', 'a', '', $2, 'image/jpeg', 10, (now() at time zone 'America/Guayaquil')::date)`, [F.terreno, `${F.terreno}/x.jpg`])).rejects.toThrow(/No tienes permiso/)
    // Legal ve el informe pero no la fotografía; el vendedor no ve nada.
    expect((await q<{ tipo: string }>(legal, `select tipo from public.obra_evidencias order by tipo`)).map((e) => e.tipo)).toEqual(['informe'])
    expect((await q(vendedor, `select * from public.obra_evidencias`)).length).toBe(0)
    expect((await q(finanzas, `select * from public.obra_evidencias`)).length).toBe(2)
    await expect(uno(gerencia, `select public.obra_evidencia_retirar($1::uuid, 'Foto repetida')`, [foto])).rejects.toThrow(/No tienes permiso/)
    await uno(constructor, `select public.obra_evidencia_retirar($1::uuid, 'Foto repetida')`, [foto])
    const r = (await dueno<{ retirado_motivo: string; ruta: string }>(`select retirado_motivo, ruta from public.obra_evidencias where id = $1`, [foto]))[0]
    expect(r.retirado_motivo).toBe('Foto repetida')
    expect(r.ruta).toContain('1-foto.jpg') // la fila y el archivo se conservan
  })
})

describe('importación desde Excel', () => {
  const filas = [
    { codigo: 'IM-1', nombre: 'Etapa importada', peso: 50, plan_inicio: '2027-05-03', plan_fin: '2027-06-04', responsable_texto: 'Contratista Andes' },
    { codigo: 'IM-1.1', parent_codigo: 'IM-1', nombre: 'Subactividad uno', peso: 100 },
    { codigo: 'IM-2', nombre: 'Segunda etapa', peso: 50, observaciones: 'Sin fechas todavía' },
  ]
  const importar = (u: string, f: string, lista: unknown[]) => uno<{ r: { creadas: number; actualizadas: number } }>(u, `select public.obra_importar($1::uuid, $2::jsonb, 'Cronograma entregado por el constructor') as r`, [f, JSON.stringify(lista)])

  it('crea, no duplica al repetir y respeta jerarquía y fechas vacías', async () => {
    expect((await importar(constructor, F.urbanismo, filas)).r).toEqual({ creadas: 3, actualizadas: 0 })
    expect((await importar(constructor, F.urbanismo, filas)).r).toEqual({ creadas: 0, actualizadas: 3 })
    const n = (await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades where frente_id = $1 and codigo like 'IM-%'`, [F.urbanismo]))[0].n
    expect(n).toBe(3)
    const sub = (await dueno<{ padre: string }>(`select p.codigo padre from public.obra_actividades s join public.obra_actividades p on p.id = s.parent_id where s.codigo = 'IM-1.1' and s.frente_id = $1`, [F.urbanismo]))[0]
    expect(sub.padre).toBe('IM-1')
    const im2 = (await dueno<{ plan_inicio: string | null }>(`select plan_inicio from public.obra_actividades where codigo = 'IM-2' and frente_id = $1`, [F.urbanismo]))[0]
    expect(im2.plan_inicio).toBeNull()
  })

  it('es todo o nada: una fila inválida no guarda ninguna, con el número de fila en el mensaje', async () => {
    const antes = (await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades`))[0].n
    await expect(importar(constructor, F.edificio1, [{ codigo: 'OK-1', nombre: 'Buena' }, { codigo: 'MAL-1', nombre: 'Mala', plan_inicio: '2027-09-10', plan_fin: '2027-09-01' }])).rejects.toThrow(/Fila 2 \(MAL-1\)/)
    await expect(importar(constructor, F.edificio1, [{ codigo: 'DUP', nombre: 'Primera' }, { codigo: 'DUP', nombre: 'Segunda' }])).rejects.toThrow(/repetido/)
    await expect(importar(constructor, F.edificio1, [{ codigo: 'HUERFANA', parent_codigo: 'NO-EXISTE', nombre: 'Sin padre' }])).rejects.toThrow(/no existe/)
    await expect(importar(constructor, F.edificio1, [{ codigo: 'FECHA', nombre: 'Fecha mala', plan_inicio: 'mañana' }])).rejects.toThrow(/formato no válido/)
    await expect(importar(constructor, F.edificio1, [{ codigo: 'A', nombre: 'Corta', estado: 'inventado' }])).rejects.toThrow(/estado no válido/)
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades`))[0].n).toBe(antes)
    await expect(importar(vendedor, F.edificio1, filas)).rejects.toThrow(/No tienes permiso/)
    await expect(importar(gerencia, F.edificio1, filas)).rejects.toThrow(/No tienes permiso/)
  })

  it('no toca los avances registrados', async () => {
    const a = (await dueno<{ id: string }>(`select id from public.obra_actividades where codigo = 'IM-2' and frente_id = $1`, [F.urbanismo]))[0].id
    await registrar(constructor, a, ayer(), 15)
    await importar(constructor, F.urbanismo, filas)
    const act = (await dueno<{ avance_registrado: string }>(`select avance_registrado from public.obra_actividades where id = $1`, [a]))[0]
    expect(Number(act.avance_registrado)).toBe(15)
  })
})

describe('historial y auditoría', () => {
  it('cada cambio deja quién, cuándo, por qué y el antes y después; también en la auditoría general', async () => {
    const h = await q<{ usuario: string; accion: string; motivo: string }>(constructor, `select usuario, accion, motivo from public.obra_historial where frente_id = $1 and accion = 'Registrar avance'`, [F.terreno])
    expect(h.length).toBeGreaterThanOrEqual(3)
    expect(h.every((x) => x.usuario === 'Juan Paez' || x.usuario === 'Admin')).toBe(true)
    const aud = await dueno<{ n: number }>(`select count(*)::int n from public.audit_log where accion like 'obra:%'`)
    expect(aud[0].n).toBeGreaterThan(20)
    expect((await q(vendedor, `select * from public.obra_historial`)).length).toBe(0)
  })
})

describe('la migración', () => {
  it('se puede repetir sin cambiar nada y no depende de Storage', async () => {
    const antes = (await dueno(`select codigo, pesos_aprobados_en from public.obra_frentes order by codigo`))
    const n = (await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades`))[0].n
    await db.exec(fs.readFileSync(MIGRACION, 'utf8'))
    expect(await dueno(`select codigo, pesos_aprobados_en from public.obra_frentes order by codigo`)).toEqual(antes)
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_actividades`))[0].n).toBe(n)
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_plantillas`))[0].n).toBe(97)
  })
})
