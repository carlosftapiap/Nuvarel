// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, sofia: string, vera: string, victor: string
let plan: string

const uno = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const act = (codigo: string) => uno<{ id: string; version: number; avance: string | null; plan_inicio: string; plan_fin: string; base_inicio: string; base_fin: string; estado: string }>(
  `select id, version, avance, plan_inicio::text, plan_fin::text, base_inicio::text, base_fin::text, estado from public.plan_activities where plan_id = $1 and codigo = $2`, [plan, codigo])
const visibles = (u: string) => como(db, u, async () => (await db.query<{ codigo: string }>(`select codigo from public.plan_activities order by codigo`)).rows.map((r) => r.codigo))

function filas() {
  return JSON.stringify([
    { fila: 15, codigo: 'D01', nombre: 'Confirmar alcance', fase_codigo: '01', responsable_id: vera, responsable_texto: 'Vera', plan_inicio: '2026-10-27', plan_fin: '2026-10-28', avance: 0, estado: 'pendiente', evidencia: 'https://ejemplo.test/acta' },
    { fila: 16, codigo: 'D02', nombre: 'Asignar responsables', fase_codigo: '01', responsable_id: victor, plan_inicio: '2026-10-29', plan_fin: '2026-10-30', avance: 0, estado: 'pendiente', predecesora: 'D01' },
    { fila: 17, codigo: 'D03', nombre: 'Crear expediente', fase_codigo: '01', responsable_texto: 'Área Comercial', estado: 'pendiente' },
  ])
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  sofia = await crearUsuario(db, 'Sofia', 'supervisor')
  const t = await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sofia])
  vera = await crearUsuario(db, 'Vera', 'asesor', { equipo: t.id })
  victor = await crearUsuario(db, 'Victor', 'asesor')
  plan = (await como(db, admin, () => uno<{ id: string }>(`select public.plan_crear('AMURA', 'PLAN-2026', 'Plan de implementación AMURA', '2026-10-27') as id`))).id
  const com = await uno<{ id: string }>(`select id from public.plan_frentes where plan_id = $1 and codigo = 'COM'`, [plan])
  await como(db, admin, () => db.query(`select public.plan_fase_guardar($1, '01', 'Dirección y expediente', $2, 1)`, [plan, com.id]))
})

describe('estructura y pesos', () => {
  it('el plan nace con los seis frentes sin pesos (no se reparten pesos iguales)', async () => {
    const { rows } = await db.query<{ codigo: string; peso: string | null }>(`select codigo, peso from public.plan_frentes where plan_id = $1 order by orden`, [plan])
    expect(rows.map((r) => r.codigo)).toEqual(['COM', 'MKT', 'LEG', 'TEC', 'FIN', 'CON'])
    expect(rows.every((r) => r.peso === null)).toBe(true)
  })
})

describe('importación', () => {
  it('sin permiso de importar no se puede importar', async () => {
    await expect(como(db, vera, () => db.query(`select public.plan_importar($1, 'Gantt_AMURA.xlsx', '1 TRABAJAR AQUI', $2::jsonb)`, [plan, filas()]))).rejects.toThrow(/Sin permiso para importar/)
  })

  it('importar dos veces no duplica actividades, dependencias ni evidencias', async () => {
    const r1 = await como(db, admin, () => uno<{ r: { nuevas: number } }>(`select public.plan_importar($1, 'Gantt_AMURA.xlsx', '1 TRABAJAR AQUI', $2::jsonb) as r`, [plan, filas()]))
    expect(r1.r).toMatchObject({ nuevas: 3, actualizadas: 0, sin_cambios: 0 })
    const r2 = await como(db, admin, () => uno<{ r: unknown }>(`select public.plan_importar($1, 'Gantt_AMURA.xlsx', '1 TRABAJAR AQUI', $2::jsonb) as r`, [plan, filas()]))
    expect(r2.r).toMatchObject({ nuevas: 0, actualizadas: 0, sin_cambios: 3 })
    const n = await uno<{ a: number; d: number; e: number; i: number }>(
      `select (select count(*)::int from public.plan_activities where plan_id = $1) a, (select count(*)::int from public.plan_dependencies where plan_id = $1) d,
              (select count(*)::int from public.plan_evidences) e, (select count(*)::int from public.plan_imports where plan_id = $1) i`, [plan])
    expect(n).toEqual({ a: 3, d: 1, e: 1, i: 2 })
  })

  it('un campo ausente no se borra y una actividad ausente del archivo no se elimina', async () => {
    await como(db, admin, () => db.query(`select public.plan_importar($1, 'parcial.xlsx', 'Hoja1', $2::jsonb)`, [plan, JSON.stringify([{ fila: 2, codigo: 'D01', nombre: 'Confirmar alcance y nombre' }])]))
    const d01 = await act('D01')
    expect(d01.plan_inicio).toBe('2026-10-27')
    expect(Number(d01.avance)).toBe(0)
    expect((await act('D03')).id).toBeTruthy()
  })

  it('una importación no puede cerrar actividades', async () => {
    await expect(como(db, admin, () => db.query(`select public.plan_importar($1, 'x.xlsx', 'H', $2::jsonb)`, [plan, JSON.stringify([{ fila: 2, codigo: 'D01', estado: 'completada', avance: 100 }])])))
      .rejects.toThrow(/no por importación/)
  })
})

describe('alcance y permisos (RLS)', () => {
  it('cada responsable ve sus actividades; el supervisor ve su equipo; el administrador ve también las sin responsable', async () => {
    expect(await visibles(vera)).toEqual(['D01'])
    expect(await visibles(victor)).toEqual(['D02'])
    expect(await visibles(sofia)).toEqual(['D01'])
    expect(await visibles(admin)).toEqual(['D01', 'D02', 'D03'])
  })

  it('un responsable no modifica actividades ajenas aunque conozca su identificador', async () => {
    const d02 = await act('D02')
    await expect(como(db, vera, () => db.query(`select public.plan_actividad_avance($1, $2, 50, null, null)`, [d02.id, d02.version]))).rejects.toThrow(/fuera de tu alcance/)
    await como(db, vera, () => db.query(`update public.plan_activities set avance = 99 where id = $1`, [d02.id])).catch(() => undefined)
    expect(Number((await act('D02')).avance)).toBe(0)
  })

  it('detecta ediciones concurrentes por versión', async () => {
    const d01 = await act('D01')
    await como(db, vera, () => db.query(`select public.plan_actividad_avance($1, $2, 30, null, null)`, [d01.id, d01.version]))
    await expect(como(db, sofia, () => db.query(`select public.plan_actividad_avance($1, $2, 40, null, null)`, [d01.id, d01.version]))).rejects.toThrow(/Otra persona modificó/)
    expect((await act('D01')).estado).toBe('en_ejecucion')
  })

  it('bajar el avance es una corrección y exige motivo', async () => {
    const d01 = await act('D01')
    await expect(como(db, vera, () => db.query(`select public.plan_actividad_avance($1, $2, 10, null, null)`, [d01.id, d01.version]))).rejects.toThrow(/motivo/)
  })
})

describe('reprogramación, dependencias y cierre', () => {
  it('reprogramar exige permiso y motivo, conserva la línea base y deja historial', async () => {
    let d01 = await act('D01')
    await expect(como(db, vera, () => db.query(`select public.plan_actividad_reprogramar($1, $2, '2026-10-27', '2026-11-05', 'Retraso del abogado')`, [d01.id, d01.version]))).rejects.toThrow(/fuera de tu alcance|Sin permiso/)
    await como(db, sofia, () => db.query(`select public.plan_actividad_reprogramar($1, $2, '2026-10-27', '2026-11-05', 'Retraso del abogado')`, [d01.id, d01.version]))
    d01 = await act('D01')
    expect(d01).toMatchObject({ plan_fin: '2026-11-05', base_inicio: '2026-10-27', base_fin: '2026-10-28' })
    const h = await uno<{ antes: { plan_fin: string }; despues: { plan_fin: string }; motivo: string; user_id: string }>(
      `select antes, despues, motivo, user_id from public.plan_history where activity_id = $1 and accion = 'Reprogramar'`, [d01.id])
    expect(h).toMatchObject({ antes: { plan_fin: '2026-10-28' }, despues: { plan_fin: '2026-11-05' }, motivo: 'Retraso del abogado', user_id: sofia })
  })

  it('muestra el impacto en las sucesoras sin moverlas', async () => {
    const d01 = await act('D01')
    const imp = await como(db, sofia, async () => (await db.query<{ codigo: string; conflicto: boolean }>(`select * from public.plan_impacto($1, '2026-11-05')`, [d01.id])).rows)
    // Sofía no ve D02 (es de Víctor, fuera de su equipo): el impacto respeta el alcance.
    expect(imp).toEqual([])
    const imp2 = await como(db, admin, async () => (await db.query<{ codigo: string; conflicto: boolean }>(`select codigo, conflicto from public.plan_impacto($1, '2026-11-05')`, [d01.id])).rows)
    expect(imp2).toEqual([{ codigo: 'D02', conflicto: true }])
    expect((await act('D02')).plan_inicio).toBe('2026-10-29')
  })

  it('rechaza ciclos y autorreferencias', async () => {
    const [d01, d02] = [await act('D01'), await act('D02')]
    await expect(como(db, admin, () => db.query(`select public.plan_dependencia($1, $2, true, 'Prueba de ciclo')`, [d02.id, d01.id]))).rejects.toThrow(/ciclo/)
    await expect(como(db, admin, () => db.query(`select public.plan_dependencia($1, $1, true, 'Prueba de ciclo')`, [d01.id]))).rejects.toThrow(/sí misma/)
  })

  it('cerrar exige 100% y fecha real; reabrir deja constancia', async () => {
    let d01 = await act('D01')
    await expect(como(db, sofia, () => db.query(`select public.plan_actividad_estado($1, $2, 'cerrar', '2026-11-04', 'Acta firmada')`, [d01.id, d01.version]))).rejects.toThrow(/100%/)
    await como(db, vera, () => db.query(`select public.plan_actividad_avance($1, $2, 100, null, null)`, [d01.id, d01.version]))
    d01 = await act('D01')
    await expect(como(db, sofia, () => db.query(`select public.plan_actividad_estado($1, $2, 'cerrar', null, 'Acta firmada')`, [d01.id, d01.version]))).rejects.toThrow(/fecha real/)
    await como(db, sofia, () => db.query(`select public.plan_actividad_estado($1, $2, 'cerrar', '2026-11-04', 'Acta firmada')`, [d01.id, d01.version]))
    d01 = await act('D01')
    expect(d01.estado).toBe('completada')
    await como(db, sofia, () => db.query(`select public.plan_actividad_estado($1, $2, 'reabrir', null, 'Falta una firma')`, [d01.id, d01.version]))
    const h = await db.query(`select accion from public.plan_history where activity_id = $1 order by fecha`, [d01.id])
    expect(h.rows.map((r) => (r as { accion: string }).accion)).toEqual(expect.arrayContaining(['Cerrar', 'Reabrir']))
  })

  it('una cancelada solo sale del cálculo con permiso de alcance', async () => {
    const d03 = await act('D03')
    await como(db, admin, () => db.query(`select public.plan_actividad_estado($1, $2, 'cancelar', null, 'Fuera de alcance')`, [d03.id, d03.version]))
    const v = (await act('D03')).version
    await expect(como(db, sofia, () => db.query(`select public.plan_actividad_estado($1, $2, 'excluir', null, 'Quitar del cálculo')`, [d03.id, v]))).rejects.toThrow(/alcance|Sin permiso/)
    await como(db, admin, () => db.query(`select public.plan_actividad_estado($1, $2, 'excluir', null, 'Quitar del cálculo')`, [d03.id, v]))
    expect(await uno(`select estado, excluida_alcance from public.plan_activities where id = $1`, [d03.id])).toEqual({ estado: 'cancelada', excluida_alcance: true })
  })
})

describe('responsable externo', () => {
  it('se puede asignar una persona fuera de la app como texto, sin usuario vinculado', async () => {
    const d03 = await act('D03')
    await como(db, admin, () => db.query(`select public.plan_actividad_asignar($1, $2, null, null, null, 'Responsable externo confirmado', 'Juan Pérez (proveedor)')`, [d03.id, d03.version]))
    const r = await uno<{ responsable_id: string | null; responsable_externo: string; responsable_texto: string }>(`select responsable_id, responsable_externo, responsable_texto from public.plan_activities where id = $1`, [d03.id])
    expect(r).toEqual({ responsable_id: null, responsable_externo: 'Juan Pérez (proveedor)', responsable_texto: 'Área Comercial' })
  })

  it('el externo se puede modificar y borrar después de guardado; el texto del cronograma no cambia', async () => {
    let d03 = await act('D03')
    await como(db, admin, () => db.query(`select public.plan_actividad_asignar($1, $2, null, null, null, 'Corrección de nombre', 'Juana Pérez (proveedora)')`, [d03.id, d03.version]))
    d03 = await act('D03')
    await como(db, admin, () => db.query(`select public.plan_actividad_asignar($1, $2, null, null, null, 'Sin responsable por ahora', null)`, [d03.id, d03.version]))
    const r = await uno<{ responsable_id: string | null; responsable_externo: string | null; responsable_texto: string }>(`select responsable_id, responsable_externo, responsable_texto from public.plan_activities where id = $1`, [d03.id])
    expect(r).toEqual({ responsable_id: null, responsable_externo: null, responsable_texto: 'Área Comercial' })
  })

  it('no admite usuario y nombre externo a la vez, ni un nombre demasiado corto', async () => {
    const d03 = await act('D03')
    await expect(como(db, admin, () => db.query(`select public.plan_actividad_asignar($1, $2, $3, null, null, 'Motivo de prueba', 'Juan Pérez')`, [d03.id, d03.version, victor]))).rejects.toThrow(/no ambos/)
    await expect(como(db, admin, () => db.query(`select public.plan_actividad_asignar($1, $2, null, null, null, 'Motivo de prueba', 'Jo')`, [d03.id, d03.version]))).rejects.toThrow(/al menos 3/)
  })
})
