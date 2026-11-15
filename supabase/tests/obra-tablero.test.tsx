// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import type { Almacen } from '@/features/obra/almacen'
import ObraPage from '@/pages/ObraPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 20_000 })

let db: PGlite
let gerente: string, constructor: string, vendedor: string
let F: Record<string, string>
const almacen: Almacen = { subir: async () => {}, urlFirmada: async (r) => `https://firmado.test/${r}` }
const dueno = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows)
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function abrirComo(id: string) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter><ObraPage almacen={almacen} /></MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
}

afterEach(() => cleanup())

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  constructor = await crearUsuario(db, 'Juan Paez', 'constructor')
  vendedor = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  F = Object.fromEntries((await dueno<{ id: string; codigo: string }>(`select id, codigo from public.obra_frentes`)).map((f) => [f.codigo, f.id]))
  // Etapas de partida del edificio 1 (la plantilla), sin fechas ni ponderaciones.
  await rpc(constructor, `select public.obra_plantilla_cargar($1::uuid, 'Etapas de partida del Edificio A')`, [F.edificio1])
}, 120_000)

describe('Avance de obra', () => {
  const avance = (nombre: string) => screen.getByRole('img', { name: new RegExp(`^${nombre}: `) })

  it('muestra cuatro tarjetas con su avance actual y estado, sin validación', async () => {
    await abrirComo(constructor)
    const grupo = await screen.findByRole('group', { name: 'Frentes de obra' })
    expect(within(grupo).getAllByRole('button', { name: /^Actualizar avance de / })).toHaveLength(4)
    expect(avance('Edificio A')).toHaveAccessibleName('Edificio A: 0 por ciento')
    expect(within(grupo).getAllByText('Avance actual')).toHaveLength(4)
    expect(within(grupo).getAllByText('Sin iniciar')).toHaveLength(4)
    for (const t of ['Por validar', 'Validar etapa', 'Devolver', 'Validada', 'Aprobaciones']) expect(screen.queryByText(t)).toBeNull()
    expect(screen.queryByText(/V .* · R /)).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Opciones avanzadas' })).toBeInTheDocument()
  }, 60_000)

  it('frente → actividad → guardar: el porcentaje cambia de inmediato, sin aprobación', async () => {
    const user = userEvent.setup()
    await abrirComo(constructor)
    await user.click(await screen.findByRole('button', { name: 'Actualizar avance de Edificio A' }))
    const dlg = await screen.findByRole('dialog', { name: /Actualizar avance · Edificio A/ })
    const guardar = within(dlg).getByRole('button', { name: 'Guardar avance' })
    expect(guardar).toBeDisabled()
    const { id, nombre } = (await dueno<{ id: string; nombre: string }>(`select a.id, a.nombre from public.obra_actividades a where a.frente_id = $1 and not exists (select 1 from public.obra_actividades h where h.parent_id = a.id) order by a.codigo limit 1`, [F.edificio1]))[0]
    await user.selectOptions(within(dlg).getByLabelText('Actividad *'), id)
    expect(within(dlg).getByLabelText('Responsable *')).toHaveDisplayValue('Juan Paez')
    expect(within(dlg).getByLabelText('Fecha *')).toHaveValue(new Intl.DateTimeFormat('en-CA').format(new Date()))
    await user.type(within(dlg).getByLabelText('Porcentaje de avance *'), '100')
    await user.click(guardar)
    expect(await screen.findByText(new RegExp(`${nombre}: avance guardado`))).toBeInTheDocument()
    expect((await dueno<{ estado: string; avance_validado: string }>(`select estado, avance_validado from public.obra_actividades where id = $1`, [id]))[0]).toEqual({ estado: 'completada', avance_validado: '100.00' })
    expect((await dueno<{ n: number }>(`select count(*)::int n from public.obra_avances where estado = 'pendiente'`))[0].n).toBe(0)
    const fila = screen.getAllByText(nombre).find((x) => x.closest('li'))!.closest('li')!
    expect(within(fila).getByText('Completada')).toBeInTheDocument()
    expect(Number(/(\d+) por ciento/.exec(avance('Edificio A').getAttribute('aria-label')!)![1])).toBeGreaterThan(0)
    expect(within(within(screen.getByRole('group', { name: 'Frentes de obra' })).getByRole('region', { name: 'Edificio A' })).getByText('En ejecución')).toBeInTheDocument()
  }, 60_000)

  it('el responsable es obligatorio y el historial conserva quién y el valor anterior', async () => {
    const user = userEvent.setup()
    await abrirComo(constructor)
    await user.click(await screen.findByRole('button', { name: 'Actualizar avance de Edificio A' }))
    const dlg = await screen.findByRole('dialog', { name: /Actualizar avance/ })
    const { id } = (await dueno<{ id: string }>(`select a.id from public.obra_actividades a where a.frente_id = $1 and not exists (select 1 from public.obra_actividades h where h.parent_id = a.id) order by a.codigo limit 1`, [F.edificio1]))[0]
    await user.selectOptions(within(dlg).getByLabelText('Actividad *'), id)
    await user.type(within(dlg).getByLabelText('Porcentaje de avance *'), '60')
    await user.selectOptions(within(dlg).getByLabelText('Responsable *'), 'otra')
    expect(within(dlg).getByRole('button', { name: 'Guardar avance' })).toBeDisabled()
    await user.type(within(dlg).getByLabelText('Nombre del responsable'), 'Contratista Andes')
    await user.click(within(dlg).getByRole('button', { name: 'Guardar avance' }))
    await screen.findByText(/avance guardado \(60 %\)/)
    await user.click(screen.getByText(/Historial de avances/))
    const celda = await screen.findAllByText('Contratista Andes')
    const tr = celda.map((c) => c.closest('tr')).find(Boolean)!
    expect(within(tr).getByText('Juan Paez')).toBeInTheDocument()
    expect(within(tr).getByText(/antes 100 %/)).toBeInTheDocument()
  }, 60_000)

  it('quien no registra solo consulta, y las opciones técnicas quedan aparte', async () => {
    const g = await abrirComo(gerente)
    expect(await screen.findByRole('group', { name: 'Frentes de obra' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actualizar avance de / })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Opciones avanzadas' })).toBeInTheDocument()
    g.unmount()
    await abrirComo(vendedor)
    expect(await screen.findByText('Avance de la construcción')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Actualizar/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Opciones avanzadas' })).toBeNull()
  }, 60_000)
})

describe('avances que esperaban validación', () => {
  it('la migración los incorpora y el resumen deja de mostrar 0 %', async () => {
    const { readFileSync } = await import('node:fs')
    const base = await crearDb({ hasta: '20261031200000_storage_comprobantes.sql' })
    const c = await crearUsuario(base, 'Juan', 'constructor')
    const f = (await base.query<{ id: string }>(`select id from public.obra_frentes where codigo = 'terreno'`)).rows[0].id
    const a1 = (await como(base, c, () => base.query<{ r: string }>(`select public.obra_actividad_guardar($1::uuid, null, null, '{"codigo":"T-1","nombre":"Etapa uno"}'::jsonb, 'Etapa de partida') as r`, [f]))).rows[0].r
    const a2 = (await como(base, c, () => base.query<{ r: string }>(`select public.obra_actividad_guardar($1::uuid, null, null, '{"codigo":"T-2","nombre":"Etapa dos"}'::jsonb, 'Etapa de partida') as r`, [f]))).rows[0].r
    const sinPermiso = await crearUsuario(base, 'Ex constructor', 'constructor')
    const a3 = (await como(base, c, () => base.query<{ r: string }>(`select public.obra_actividad_guardar($1::uuid, null, null, '{"codigo":"T-3","nombre":"Etapa tres"}'::jsonb, 'Etapa de partida') as r`, [f]))).rows[0].r
    for (const a of [a1, a2]) await como(base, c, () => base.query(`select public.obra_avance_registrar($1::uuid, (now() at time zone 'America/Guayaquil')::date, 100, '', '')`, [a]))
    await como(base, sinPermiso, () => base.query(`select public.obra_avance_registrar($1::uuid, (now() at time zone 'America/Guayaquil')::date, 100, '', '')`, [a3]))
    // Dejó de estar autorizado después de registrar.
    await base.query(`update public.profiles set rol_id = 'asesor' where id = $1`, [sinPermiso])
    expect((await base.query<{ v: string | null }>(`select avance_validado v from public.obra_actividades where id = $1`, [a1])).rows[0].v).toBeNull()
    await base.exec(readFileSync(`${process.cwd()}/supabase/migrations/20261031210000_obra_avance_directo.sql`, 'utf8'))
    const fila = (await base.query<Record<string, unknown>>(`select v.estado, a.avance_validado, v.registrado_nombre, v.validacion_nota from public.obra_avances v join public.obra_actividades a on a.id = v.actividad_id where a.id = $1`, [a1])).rows[0]
    expect(fila).toMatchObject({ registrado_nombre: 'Juan', validacion_nota: 'Aprobación eliminada', avance_validado: '100.00' })
    expect((await base.query(`select estado from public.obra_actividades where id = $1`, [a1])).rows).toEqual([{ estado: 'completada' }])
    const r = await como(base, c, () => base.query<{ avance_validado: string }>(`select avance_validado from public.obra_resumen() where codigo = 'terreno'`))
    // Dos etapas al 100 % y una que no se incorpora: (100 + 100 + 0) / 3.
    expect(Number(r.rows[0].avance_validado)).toBeCloseTo(66.67, 2)
    expect((await base.query(`select v.estado, v.avance, a.avance_validado from public.obra_avances v join public.obra_actividades a on a.id = v.actividad_id where a.id = $1`, [a3])).rows).toEqual([{ estado: 'pendiente', avance: '100.00', avance_validado: null }])
  }, 120_000)
})
