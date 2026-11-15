import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { crearCliente, estadoInicialClientes } from '@/features/clientes/service'
import { ClientesProvider } from '@/features/clientes/store'
import type { ClientesState } from '@/features/clientes/model'
import type { ClienteInput } from '@/features/clientes/service'
import type { Actor } from '@/features/inventario/types'
import { InventoryProvider } from '@/features/inventario/store'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '../ClientesPage'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL ??= vi.fn(() => 'blob:x')
  URL.revokeObjectURL ??= vi.fn()
})

function conDatos(): ClientesState {
  const actor: Actor = { id: 'u-admin', nombre: 'Administración', rol: 'administrador', alcance: { tipo: 'empresa', usuarios: [] } }
  const inv = createInitialState()
  const entrada = (nombre: string, telefono: string): ClienteInput => ({
    nombre, telefono, email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [], presupuesto: null, proposito: null, formaPago: null,
    asesorId: 'u-admin', asesor: 'Administración',
  } as ClienteInput)
  let s = estadoInicialClientes()
  s = crearCliente(s, entrada('Ana Activa', '0990000001'), actor, inv).state
  s = crearCliente(s, entrada('Beto Seguimiento', '0990000002'), actor, inv).state
  s = crearCliente(s, entrada('Carla Perdida', '0990000003'), actor, inv).state
  return {
    ...s,
    clientes: s.clientes.map((c) => c.nombre.startsWith('Beto') ? { ...c, etapa: 'seguimiento' as const } : c.nombre.startsWith('Carla') ? { ...c, etapa: 'perdido' as const, motivoPerdida: 'Compró en otro proyecto' } : c),
  }
}

function renderPagina(clientes: ClientesState) {
  return render(
    <SessionProvider initialRol="administrador">
      <InventoryProvider initialState={createInitialState()}>
        <ClientesProvider initialState={clientes}>
          <ReservasProvider>
            <MemoryRouter initialEntries={['/clientes']}>
              <Routes><Route path="/clientes" element={<ClientesPage />} /></Routes>
            </MemoryRouter>
          </ReservasProvider>
        </ClientesProvider>
      </InventoryProvider>
    </SessionProvider>,
  )
}

describe('Clientes: lista de trabajo, filtros de un clic y vistas', () => {
  it('la vista inicial es la lista de trabajo; cada filtro muestra cuántos clientes tiene', () => {
    renderPagina(conDatos())
    const grupo = screen.getByRole('group', { name: 'Filtros rápidos de clientes' })
    expect(within(grupo).getByRole('button', { name: /^Activos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(grupo).getByRole('button', { name: /^Activos/ })).toHaveTextContent('2')
    expect(within(grupo).getByRole('button', { name: /^Perdidos/ })).toHaveTextContent('1')
    expect(within(grupo).getByRole('button', { name: /^Todos/ })).toHaveTextContent('3')
    // Ana (Nuevo) y Beto (Seguimiento futuro) no tienen próxima gestión; Ana además está por contactar.
    expect(within(grupo).getByRole('button', { name: /^Sin próxima gestión/ })).toHaveTextContent('2')
    expect(within(grupo).getByRole('button', { name: /^Por contactar/ })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Lista de trabajo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByText('Carla Perdida')).not.toBeInTheDocument()
  })

  it('pulsar Perdidos filtra a los perdidos; pulsar Todos los devuelve', async () => {
    const user = userEvent.setup()
    renderPagina(conDatos())
    await user.click(screen.getByRole('button', { name: /^Perdidos/ }))
    expect(screen.getByRole('button', { name: /^Perdidos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Carla Perdida')).toBeInTheDocument()
    expect(screen.queryByText('Ana Activa')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Todos/ }))
    expect(screen.getByText('Ana Activa')).toBeInTheDocument()
    expect(screen.getByText('Carla Perdida')).toBeInTheDocument()
  })

  it('el filtro por etapa y el de nombre funcionan juntos', async () => {
    const user = userEvent.setup()
    renderPagina(conDatos())
    await user.type(screen.getByLabelText('Buscar cliente'), 'ana')
    expect(screen.getByText('Ana Activa')).toBeInTheDocument()
    expect(screen.queryByText('Beto Seguimiento')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Buscar cliente'))
    await user.click(screen.getByLabelText('Filtrar por etapa'))
    await user.click(await screen.findByRole('option', { name: 'Seguimiento futuro' }))
    expect(screen.getByText('Beto Seguimiento')).toBeInTheDocument()
    expect(screen.queryByText('Ana Activa')).not.toBeInTheDocument()
  })

  it('sin coincidencias muestra el estado vacío y «Limpiar filtros» lo resuelve', async () => {
    const user = userEvent.setup()
    renderPagina(conDatos())
    await user.type(screen.getByLabelText('Buscar cliente'), 'zzz')
    expect(screen.getByText('No hay clientes que coincidan')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.queryByText('No hay clientes que coincidan')).not.toBeInTheDocument()
    expect(screen.getByText('Ana Activa')).toBeInTheDocument()
  })

  it('la última vista elegida se recuerda al volver a abrir la página', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPagina(conDatos())
    await user.click(screen.getByRole('button', { name: 'Embudo' }))
    expect(localStorage.getItem('amura.clientes.vista')).toBe('embudo')
    expect(screen.getByRole('region', { name: 'Nuevo: 1 clientes' })).toBeInTheDocument()
    unmount()
    renderPagina(conDatos())
    expect(screen.getByRole('button', { name: 'Embudo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('cada fila trae WhatsApp, llamada y seguimiento sin abrir la ficha', () => {
    renderPagina(conDatos())
    const fila = screen.getByRole('button', { name: 'Abrir ficha de Ana Activa' }).closest('tr')!
    expect(within(fila).getByRole('link', { name: 'WhatsApp a Ana Activa' })).toHaveAttribute('href', expect.stringMatching(/^https:\/\/wa\.me\/5939/))
    expect(within(fila).getByRole('link', { name: 'Llamar a Ana Activa' })).toHaveAttribute('href', expect.stringMatching(/^tel:/))
    expect(within(fila).getByRole('button', { name: 'Seguimiento de Ana Activa' })).toBeInTheDocument()
  })

  it('programar la siguiente gestión desde la lista: tipo, fecha y qué hacer, sin abrir la ficha', async () => {
    const user = userEvent.setup()
    renderPagina(conDatos())
    await user.click(screen.getByRole('button', { name: 'Seguimiento de Ana Activa' }))
    const pop = await screen.findByRole('dialog', { name: 'Seguimiento de Ana Activa' })
    await user.click(within(pop).getByRole('button', { name: 'Guardar gestión' }))
    expect(within(pop).getByRole('alert')).toHaveTextContent(/qué hay que hacer/)
    await user.click(within(pop).getByRole('button', { name: 'Visita' }))
    await user.click(within(pop).getByRole('button', { name: 'Confirmar la visita' }))
    await user.click(within(pop).getByRole('button', { name: 'Guardar gestión' }))
    expect(await screen.findByText(/Próxima gestión con Ana Activa: visita/)).toBeInTheDocument()
    const fila = screen.getByRole('button', { name: 'Abrir ficha de Ana Activa' }).closest('tr')!
    expect(within(fila).getByText('Confirmar la visita')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Seguimiento de Ana Activa' })).not.toBeInTheDocument()
  })

  it('la lista se abre filtrada desde el inicio (?filtro=)', () => {
    render(
      <SessionProvider initialRol="administrador">
        <InventoryProvider initialState={createInitialState()}>
          <ClientesProvider initialState={conDatos()}>
            <ReservasProvider>
              <MemoryRouter initialEntries={['/clientes?filtro=perdidos']}>
                <Routes><Route path="/clientes" element={<ClientesPage />} /></Routes>
              </MemoryRouter>
            </ReservasProvider>
          </ClientesProvider>
        </InventoryProvider>
      </SessionProvider>,
    )
    expect(screen.getByRole('button', { name: /^Perdidos/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Carla Perdida')).toBeInTheDocument()
    expect(screen.queryByText('Ana Activa')).not.toBeInTheDocument()
  })
})
