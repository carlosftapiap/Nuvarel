import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { crearCliente, estadoInicialClientes } from '@/features/clientes/service'
import { ClientesProvider, useClientes } from '@/features/clientes/store'
import { ReservasProvider } from '@/features/reservas/store'
import type { ClientesState } from '@/features/clientes/model'
import { createInitialState } from '@/features/inventario/service'
import { InventoryProvider } from '@/features/inventario/store'
import ClientesPage from '../ClientesPage'
import CotizacionesPage from '../CotizacionesPage'

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL ??= vi.fn(() => 'blob:x')
  URL.revokeObjectURL ??= vi.fn()
})

function renderApp(url: string, clientes?: ClientesState, extra?: React.ReactNode) {
  return render(
    <SessionProvider initialRol="asesor">
      <InventoryProvider>
        <ClientesProvider initialState={clientes}>
          <ReservasProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/clientes" element={<ClientesPage />} />
              <Route path="/cotizaciones" element={<CotizacionesPage />} />
            </Routes>
            {extra}
          </MemoryRouter>
          </ReservasProvider>
        </ClientesProvider>
      </InventoryProvider>
    </SessionProvider>,
  )
}

describe('Clientes', () => {
  it('sin datos de ejemplo: el tablero empieza vacío', () => {
    renderApp('/clientes')
    expect(screen.getByText('Aún no hay clientes')).toBeInTheDocument()
  })

  it('registra un cliente, aparece en Nuevo y una llamada lo pasa a Contactado', async () => {
    const user = userEvent.setup()
    renderApp('/clientes')
    await user.click(screen.getAllByRole('button', { name: /Nuevo cliente/ })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dlg).getByLabelText('Nombre *'), 'Lucía Andrade')
    await user.type(within(dlg).getByLabelText('Teléfono'), '0991112233')
    await user.type(within(dlg).getByLabelText('Presupuesto (USD)'), '170000')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar cliente' }))

    // Se abre la ficha del cliente recién creado
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    expect(within(ficha).getByText('Nuevo', { selector: 'span' })).toBeInTheDocument()
    await user.type(within(ficha).getByPlaceholderText(/Llamada: confirma interés/), 'Primera llamada: busca 2 habitaciones')
    await user.click(within(ficha).getByRole('button', { name: 'Registrar' }))
    expect(within(ficha).getByText(/Nuevo → Contactado/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('region', { name: 'Contactado: 1 clientes' })).toBeInTheDocument()
  })

  it('Perdido pide motivo', async () => {
    const user = userEvent.setup()
    const { state, cliente } = crearCliente(estadoInicialClientes(), { nombre: 'Pedro Ruiz', telefono: '0990001111', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [], presupuesto: null, proposito: null, formaPago: null, asesorId: 'demo-asesor', asesor: 'Vendedor (demo)' }, { id: 'demo-asesor', nombre: 'Vendedor (demo)', rol: 'asesor' }, createInitialState())
    renderApp(`/clientes?cliente=${cliente.id}`, state)
    const ficha = await screen.findByRole('dialog', { name: /Pedro Ruiz/ })
    await user.click(within(ficha).getByRole('button', { name: 'Perdido' }))
    const dlg = await screen.findByRole('dialog', { name: 'Marcar como perdido' })
    await user.click(within(dlg).getByRole('button', { name: 'Confirmar' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent(/motivo/)
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Compró en otro proyecto')
    await user.click(within(dlg).getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/Pedro Ruiz → Perdido/)).toBeInTheDocument()
  })

  it('la cotización desde la ficha queda vinculada y mueve al cliente a Cotización', async () => {
    const user = userEvent.setup()
    const actor = { id: 'demo-asesor', nombre: 'Vendedor (demo)', rol: 'asesor' as const }
    const { state, cliente } = crearCliente(estadoInicialClientes(), { nombre: 'Andrea Mora', telefono: '0995556677', email: 'andrea@correo.com', origen: 'instagram', origenDetalle: '', unidadesInteres: ['E1-PB-A2'], presupuesto: 175000, proposito: 'vivir', formaPago: 'biess', asesorId: actor.id, asesor: actor.nombre }, actor, createInitialState())
    function Etapa() { const { state: s } = useClientes(); return <output aria-label="etapa">{s.clientes[0].etapa}</output> }
    renderApp(`/cotizaciones?cliente=${cliente.id}&unidad=E1-PB-A2&fecha=2026-10-28`, state, <Etapa />)
    expect(screen.getByLabelText('Nombre completo *')).toHaveValue('Andrea Mora')
    await user.type(screen.getByLabelText('Nombre *'), 'Asesor Nuvarel')
    await user.type(screen.getAllByLabelText('Correo')[1], 'asesor@nuvarel.com')
    await user.click(screen.getByRole('button', { name: '15 días' }))
    await user.click(screen.getByRole('button', { name: /Generar PDF/ }))
    expect(await screen.findByText(/COT-2026-0001 generada para Andrea Mora/)).toBeInTheDocument()
    expect(screen.getByLabelText('etapa')).toHaveTextContent('cotizacion')
  })
})
