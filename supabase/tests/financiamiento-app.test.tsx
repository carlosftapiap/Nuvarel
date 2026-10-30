// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import FinanciamientoPage from '@/pages/FinanciamientoPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}

async function abrirComo(id: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider>
          <MemoryRouter initialEntries={['/financiamiento?unidad=E1-PB-A2']}><FinanciamientoPage /></MemoryRouter>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

const abrirTab = async (nombre: RegExp) => {
  const tab = await screen.findByRole('tab', { name: nombre })
  fireEvent.mouseDown(tab, { button: 0 })
  fireEvent.click(tab)
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  // Producto de PRUEBA con tasas ficticias por tramo (no son tasas reales).
  await como(db, admin, () => db.query(`select public.financiamiento_guardar_producto('PRUEBA-TRAMOS', $1::jsonb, 'Carga de prueba')`, [JSON.stringify({
    entidad: 'Entidad de prueba', producto: 'Vivienda por tramos', tipo_tasa: 'fija', plazo_min_meses: 60, plazo_max_meses: 300,
    tramos: [
      { montoMin: null, montoMax: 100000, plazoMinMeses: null, plazoMaxMeses: 300, tasaNominal: 6 },
      { montoMin: 100000.01, montoMax: null, plazoMinMeses: null, plazoMaxMeses: 300, tasaNominal: 8.5 },
    ],
    fuente: 'Documento de prueba unitaria', fecha_fuente: '2026-10-29',
  })]))
}, 60_000)

describe('Financiamiento conectado a Supabase (Postgres real)', () => {
  it('el producto del catálogo aplica la tasa del tramo, valida el plazo y se compara con otros escenarios', async () => {
    await abrirComo(vera)
    await abrirTab(/Crédito hipotecario/)
    const select = await screen.findByLabelText('Banco o BIESS y producto')
    await screen.findByRole('option', { name: /Entidad de prueba/ })
    fireEvent.change(select, { target: { value: within(select).getByRole('option', { name: /Entidad de prueba/ }).getAttribute('value') } })
    expect(await screen.findByText(/tasa por tramos de monto y plazo/)).toBeInTheDocument()
    // Saldo contra entrega de E1-PB-A2 (> 100.000) usa el tramo de 8,5%.
    expect(screen.getByText('8,50% nominal')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Plazo (años)'), { target: { value: '30' } })
    expect(await screen.findByText(/el plazo debe estar entre 60 y 300 meses/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Plazo (años)'), { target: { value: '20' } })
    fireEvent.click(await screen.findByRole('button', { name: /Agregar al comparador \(0\/3\)/ }))
    fireEvent.change(screen.getByLabelText('Plazo (años)'), { target: { value: '15' } })
    fireEvent.click(await screen.findByRole('button', { name: /Agregar al comparador \(1\/3\)/ }))
    const tabla = (await screen.findByText('Comparación de escenarios')).parentElement!
    expect(within(tabla).getAllByRole('row')).toHaveLength(3) // encabezado + 2 escenarios
  })

  it('guarda la cotización integral con la versión del producto y descarga el PDF', async () => {
    await abrirComo(vera)
    await abrirTab(/Crédito hipotecario/)
    const select = await screen.findByLabelText('Banco o BIESS y producto')
    await screen.findByRole('option', { name: /Entidad de prueba/ })
    fireEvent.change(select, { target: { value: within(select).getByRole('option', { name: /Entidad de prueba/ }).getAttribute('value') } })
    await screen.findByText('Cuota mensual estimada')
    await abrirTab(/Cotización integral/)
    fireEvent.change(await screen.findByLabelText('Cliente *'), { target: { value: 'Cliente de prueba' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y descargar PDF' }))
    expect(await screen.findByText(/Cotización SIM-\d{4}-0001 guardada y descargada/)).toBeInTheDocument()
    const g = (await db.query<{ condiciones: { producto: { version: number; clave: string } } }>(`select condiciones from public.mortgage_simulations`)).rows[0]
    expect(g.condiciones.producto).toMatchObject({ version: 1, clave: 'PRUEBA-TRAMOS' })
  })

  it('una vendedora no ve el botón del catálogo bancario', async () => {
    await abrirComo(vera)
    await abrirTab(/Crédito hipotecario/)
    await screen.findByLabelText('Banco o BIESS y producto')
    expect(screen.queryByRole('button', { name: /Catálogo bancario/ })).not.toBeInTheDocument()
  })
})
