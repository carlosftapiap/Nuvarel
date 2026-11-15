import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { crearCliente, estadoInicialClientes } from '@/features/clientes/service'
import { ClientesProvider } from '@/features/clientes/store'
import { ReservasProvider } from '@/features/reservas/store'
import type { ClientesState } from '@/features/clientes/model'
import { InventoryProvider } from '@/features/inventario/store'
import ClientesPage from '../ClientesPage'
import CotizacionesPage from '../CotizacionesPage'
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

/** Muestra a dónde llevó la navegación (p. ej. el recorrido de Atender cliente). */
function Ubicacion() {
  const l = useLocation()
  return <p>{l.pathname + l.search}</p>
}

function renderApp(url: string, clientes?: ClientesState, extra?: React.ReactNode) {
  return render(
    <SessionProvider initialRol="asesor">
      <InventoryProvider initialState={createInitialState()}>
        <ClientesProvider initialState={clientes}>
          <ReservasProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/clientes" element={<ClientesPage />} />
              <Route path="/cotizaciones" element={<CotizacionesPage />} />
              <Route path="/venta" element={<Ubicacion />} />
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
    await user.click(screen.getByRole('button', { name: 'Embudo' }))
    await user.click(screen.getAllByRole('button', { name: /Nuevo cliente/ })[0])
    const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dlg).getByLabelText('Primer nombre *'), 'Lucía')
    await user.type(within(dlg).getByLabelText('Primer apellido *'), 'Andrade')
    await user.type(within(dlg).getByLabelText('Celular *'), '0991112233')
    await user.type(within(dlg).getByLabelText('Presupuesto (USD)'), '170000')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar cliente' }))

    // Se abre la ficha del cliente recién creado
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    expect(within(ficha).getByText('Nuevo', { selector: 'span' })).toBeInTheDocument()
    await user.click(within(ficha).getByRole('tab', { name: 'Actividad' }))
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

  it('cotizar desde la ficha o desde un enlace abre el recorrido único de Atender cliente', async () => {
    const actor = { id: 'demo-asesor', nombre: 'Vendedor (demo)', rol: 'asesor' as const }
    const { state, cliente } = crearCliente(estadoInicialClientes(), { nombre: 'Andrea Mora', telefono: '0995556677', email: 'andrea@correo.com', origen: 'instagram', origenDetalle: '', unidadesInteres: ['E1-PB-A2'], presupuesto: 175000, proposito: 'vivir', formaPago: 'biess', asesorId: actor.id, asesor: actor.nombre }, actor, createInitialState())
    const r = renderApp(`/clientes?cliente=${cliente.id}`, state)
    const ficha = await screen.findByRole('dialog', { name: /Andrea Mora/ })
    expect(within(ficha).getByRole('link', { name: /Crear cotización/ })).toHaveAttribute('href', `/venta?cliente=${cliente.id}&unidad=E1-PB-A2`)
    r.unmount()
    renderApp(`/cotizaciones?cliente=${cliente.id}&unidad=E1-PB-A2`, state)
    expect(screen.getByText(`/venta?cliente=${cliente.id}&unidad=E1-PB-A2`)).toBeInTheDocument()
  })
})
