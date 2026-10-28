import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import InventarioPage from '@/pages/InventarioPage'
import { InventoryProvider } from '../store'
import type { Rol } from '../types'

// Radix usa estas APIs del navegador que jsdom no implementa.
beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

function renderPage(rol: Rol, url = '/inventario') {
  return render(
    <SessionProvider initialRol={rol}>
      <InventoryProvider>
        <MemoryRouter initialEntries={[url]}><InventarioPage /></MemoryRouter>
      </InventoryProvider>
    </SessionProvider>,
  )
}

describe('InventarioPage', () => {
  it('muestra las 72 unidades, el valor total de lista y avisos de datos por confirmar', () => {
    renderPage('asesor')
    expect(screen.getByText(/72 departamentos/)).toBeInTheDocument()
    expect(screen.getByText('1–15 de 72 unidades')).toBeInTheDocument()
    expect(screen.getByText(/72 unidades sin disponibilidad oficial/)).toBeInTheDocument()
    expect(screen.getByText(/5 bodegas con discrepancia/)).toBeInTheDocument()
    // Total de lista 11.197.345 (formato es-EC)
    expect(screen.getByText((t) => /11\.197\.345/.test(t))).toBeInTheDocument()
  })

  it('busca, abre la ficha y muestra precio y plan de pagos del PDF', async () => {
    const user = userEvent.setup()
    renderPage('asesor')
    await user.type(screen.getByLabelText('Buscar unidad'), '1002')
    expect(screen.getByText('1–1 de 1 unidades')).toBeInTheDocument()
    await user.click(screen.getByRole('row', { name: /E1-PB-A2/ }))
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).getByText(/Departamento 1002/)).toBeInTheDocument()
    expect(within(ficha).getAllByText((t) => /172\.147/.test(t)).length).toBeGreaterThan(0) // precio
    expect(within(ficha).getByText((t) => /10\.329/.test(t))).toBeInTheDocument() // reserva 6%
    expect(within(ficha).getByText((t) => /^\$?\s?803$|803/.test(t) && t.length < 12)).toBeInTheDocument() // cuota
    expect(within(ficha).getByText((t) => /137\.718/.test(t))).toBeInTheDocument() // contra entrega
    // Un asesor no puede modificar el precio
    expect(within(ficha).queryByRole('button', { name: /Modificar precio/ })).not.toBeInTheDocument()
  })

  it('gerencia propone un precio sin cambiar el oficial', async () => {
    const user = userEvent.setup()
    renderPage('gerencia', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    await user.click(within(ficha).getByRole('button', { name: /Modificar precio/ }))
    const dlg = await screen.findByRole('dialog', { name: /Modificar precio por m²/ })
    const valor = within(dlg).getByLabelText(/Nuevo precio por m²/)
    await user.clear(valor)
    await user.type(valor, '2300')
    await user.type(within(dlg).getByLabelText(/Motivo del cambio/), 'Propuesta para comité')
    await user.click(within(dlg).getByRole('button', { name: 'Enviar a aprobación' }))
    expect(await screen.findByText(/Propuesta enviada a aprobación/)).toBeInTheDocument()
    // El precio oficial sigue siendo el de la lista base: 161.831
    expect(within(screen.getByRole('dialog')).getAllByText((t) => /161\.831/.test(t)).length).toBeGreaterThan(0)
  })

  it('administración modifica el precio por m² de una unidad y queda en el historial', async () => {
    const user = userEvent.setup()
    renderPage('administrador', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    await user.click(within(ficha).getByRole('button', { name: /Modificar precio/ }))
    const dlg = await screen.findByRole('dialog', { name: /Modificar precio por m²/ })
    const valor = within(dlg).getByLabelText(/Nuevo precio por m²/)
    await user.clear(valor)
    await user.type(valor, '2300')
    // 2300 × 72,57 = 166.911
    expect(within(dlg).getAllByText((t) => /166\.911/.test(t)).length).toBeGreaterThan(0)
    const aplicar = within(dlg).getByRole('button', { name: 'Aplicar cambio' })
    expect(aplicar).toBeDisabled()
    await user.type(within(dlg).getByLabelText(/Motivo del cambio/), 'Precio aprobado por gerencia')
    await user.click(aplicar)
    expect(await screen.findByText(/Precio actualizado en 1 unidades/)).toBeInTheDocument()
    const fichaActualizada = screen.getByRole('dialog')
    expect(within(fichaActualizada).getAllByText((t) => /166\.911/.test(t)).length).toBeGreaterThan(0)
    expect(within(fichaActualizada).getByText(/Precio aprobado por gerencia/)).toBeInTheDocument()
  })
})
