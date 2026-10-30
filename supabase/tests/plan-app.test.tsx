// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import * as XLSX from 'xlsx'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import * as api from '@/features/plan/api'
import { libroPlan } from '@/features/plan/exportar'
import PlanPage from '@/pages/PlanPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[]; proyectos: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance }, proyectos: s.proyectos }
}

async function abrirComo(id: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><PlanPage /></SessionProvider>
    </ConexionProvider>,
  )
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  await db.exec(fs.readFileSync(path.resolve(__dirname, '../carga/plan_amura_inicial.sql'), 'utf8').replace('REEMPLAZAR@correo.com', 'admin@prueba.local'))
}, 60_000)

describe('Asignar responsable desde la app', () => {
  const asignarCon = async (base: PGlite, u: string, externo: string | null, responsable: string | null) => {
    const a = (await base.query<{ id: string; version: number }>(`select id, version from public.plan_activities where codigo = 'D01'`)).rows[0]
    await api.asignar(datosPglite(base, u), a, responsable, 'Motivo de la asignación', externo)
    return (await base.query<{ responsable_id: string | null; responsable_externo?: string | null }>(`select * from public.plan_activities where codigo = 'D01'`)).rows[0]
  }

  it('asigna a un usuario y a una persona externa, con los nombres reales de la función', async () => {
    expect(await asignarCon(db, admin, null, vera)).toMatchObject({ responsable_id: vera, responsable_externo: null })
    expect(await asignarCon(db, admin, 'Juan Pérez (proveedor)', null)).toMatchObject({ responsable_id: null, responsable_externo: 'Juan Pérez (proveedor)' })
    expect(await asignarCon(db, admin, null, null)).toMatchObject({ responsable_id: null, responsable_externo: null })
  })

  it('sin la migración del Gantt, asignar a un usuario sigue funcionando', async () => {
    const vieja = await crearDb({ hasta: '20261029060000_financiamiento_catalogo.sql' })
    const a2 = await crearUsuario(vieja, 'Admin', 'administrador')
    const v2 = await crearUsuario(vieja, 'Vera', 'asesor')
    await vieja.exec(fs.readFileSync(path.resolve(__dirname, '../carga/plan_amura_inicial.sql'), 'utf8').replace('REEMPLAZAR@correo.com', 'admin@prueba.local'))
    expect(await asignarCon(vieja, a2, null, v2)).toMatchObject({ responsable_id: v2 })
  }, 60_000)
})

describe('Plan de implementación conectado (Postgres real con RLS)', () => {
  it('el administrador ve las 147 actividades, los indicadores y el consolidado no habilitado por falta de pesos', async () => {
    await abrirComo(admin)
    expect(await screen.findByText(/147 actividades visibles para ti/)).toBeInTheDocument()
    const kpi = screen.getByText('Actividades operativas').parentElement!
    expect(within(kpi).getByText('147')).toBeInTheDocument()
    expect(screen.getByText('No habilitado')).toBeInTheDocument()
    expect(screen.getByText('Dependencias por confirmar', { exact: false })).toBeInTheDocument()
  })

  it('actualiza un avance desde la lista y lo guarda en la base de datos con historial', async () => {
    await abrirComo(admin)
    await screen.findByText(/147 actividades visibles/)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Actividades/ }), { button: 0 })
    fireEvent.click(screen.getByRole('tab', { name: /Actividades/ }))
    const fila = (await screen.findByText('D01')).closest('tr')!
    fireEvent.click(within(fila).getByTitle('Actualizar avance'))
    const input = await screen.findByLabelText(/Avance \(0 a 100\)/)
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/D01: actualizar avance registrado/)).toBeInTheDocument()
    const r = await db.query<{ avance: string; estado: string }>(`select avance, estado from public.plan_activities where codigo = 'D01'`)
    expect(r.rows[0]).toEqual({ avance: '50.00', estado: 'en_ejecucion' })
    const h = await db.query(`select 1 from public.plan_history h join public.plan_activities a on a.id = h.activity_id where a.codigo = 'D01' and h.accion = 'Actualizar avance' and h.user_id = $1`, [admin])
    expect(h.rows).toHaveLength(1)
  })

  it('dos sesiones: un cambio con una versión vieja se rechaza en lugar de sobrescribir', async () => {
    const d = await api.cargarPlan(datosPglite(db, admin))
    const d02 = d.actividades.find((a) => a.codigo === 'D02')!
    await api.actualizarAvance(datosPglite(db, admin), d02, 20, null)
    await expect(api.actualizarAvance(datosPglite(db, admin), d02, 30, null)).rejects.toThrow(/Otra persona modificó/)
  })

  it('una vendedora sin actividades asignadas no ve las del resto ni puede importar o configurar', async () => {
    await abrirComo(vera)
    expect(await screen.findByText(/0 actividades visibles para ti/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Importar' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Configuración del plan' })).toBeNull()
  })

  it('la exportación respeta el alcance y guarda fechas y avances tipados', async () => {
    const d = await api.cargarPlan(datosPglite(db, admin))
    const wb = libroPlan(d, d.actividades, 'Admin')
    const ws = wb.Sheets.Actividades
    const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })
    expect(filas).toHaveLength(148)
    const d01 = filas.find((f) => f[0] === 'D01')!
    expect(d01[10]).toBe(50)
    expect(ws.O2.z).toBe('dd/mm/yyyy')
    const vacio = await api.cargarPlan(datosPglite(db, vera))
    expect(libroPlan(vacio, vacio.actividades, 'Vera').Sheets.Actividades['!ref']).toBe('A1:AA1')
  })
})
