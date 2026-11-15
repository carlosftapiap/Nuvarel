import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { InventoryProvider } from '@/features/inventario/store'
import { ClientesProvider } from '@/features/clientes/store'
import { ReservasProvider } from '@/features/reservas/store'
import type { Rol } from '@/features/inventario/types'
import CotizacionesPage from '../CotizacionesPage'
import FinanciamientoPage from '../FinanciamientoPage'
import PreciosPage from '../PreciosPage'

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

function renderAt(ui: React.ReactNode, rol: Rol, url: string) {
  return render(
    <SessionProvider initialRol={rol}>
      <InventoryProvider initialState={createInitialState()}>
        <ClientesProvider>
          <ReservasProvider>
            <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
          </ReservasProvider>
        </ClientesProvider>
      </InventoryProvider>
    </SessionProvider>,
  )
}

describe('Financiamiento', () => {
  it('muestra la entrada del 20% y el cronograma de E2-PB-A3 (42 cuotas)', () => {
    renderAt(<FinanciamientoPage />, 'asesor', '/financiamiento?unidad=E2-PB-A3')
    expect(screen.getByText('Cronograma de pagos')).toBeInTheDocument()
    expect(screen.getByText('Cuota 42 de 42')).toBeInTheDocument()
    expect(screen.getAllByText((t) => /136.444/.test(t)).length).toBeGreaterThan(0) // precio final
    expect(screen.getByText((t) => /^42 cuotas: 41 de /.test(t))).toBeInTheDocument()
    expect(screen.getByText('Los descuentos los autoriza gerencia.')).toBeInTheDocument()
  })

  it('una reserva menor al 6% genera un pago adicional a la firma, sin cobrarla dos veces', async () => {
    const user = userEvent.setup()
    renderAt(<FinanciamientoPage />, 'asesor', '/financiamiento?unidad=E2-PB-A3')
    await user.type(screen.getByLabelText('Reserva (USD)'), '1000')
    const caja = screen.getByText('Pago adicional a la firma').parentElement!
    const valor = caja.children[1].textContent ?? ''
    // 6% del precio final (8.186,66) menos la reserva de 1.000
    expect(valor).toBe('$7.186,66')
    expect(screen.getByText('Reserva (se acredita al 6%)')).toBeInTheDocument()
  })

  it('sin Supabase el crédito solo admite escenario manual y avisa los seguros faltantes', async () => {
    const user = userEvent.setup()
    renderAt(<FinanciamientoPage />, 'asesor', '/financiamiento?unidad=E2-PB-A3')
    await user.click(screen.getByRole('tab', { name: /Crédito hipotecario/ }))
    expect(await screen.findByText(/Ingresa la tasa del escenario manual/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Tasa anual (%)'), '9')
    expect(await screen.findByText('Cuota mensual estimada')).toBeInTheDocument()
    expect(screen.getByText(/no son gratuitos/)).toBeInTheDocument()
    expect(screen.getByText(/Escenario manual ingresado por el asesor/)).toBeInTheDocument()
  })
})

describe('Precios', () => {
  it('gerencia simula un ajuste, ve el impacto y lo envía a aprobación sin cambiar el oficial', async () => {
    const user = userEvent.setup()
    renderAt(<PreciosPage />, 'gerencia', '/precios')
    await user.type(screen.getByLabelText(/Porcentaje/), '2')
    // Sin elegir el edificio no hay simulación ni se puede preparar el cambio.
    expect(screen.getByText(/Elige el edificio para simular/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar a aprobación' })).toBeDisabled()
    await user.click(screen.getByLabelText('Edificio'))
    await user.click(await screen.findByRole('option', { name: 'Ambos edificios' }))
    expect(screen.getByText('Impacto por departamento')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(70) // 72 unidades + encabezado
    await user.type(screen.getByLabelText('Motivo del cambio'), 'Subida general de prueba')
    await user.click(screen.getByRole('button', { name: 'Enviar a aprobación' }))
    expect(await screen.findByText(/Propuesta enviada a aprobación/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Propuestas \(1\)/ })).toBeInTheDocument()
    // El valor oficial del inventario no cambia
    expect(screen.getAllByText((t) => /11\.197\.345/.test(t)).length).toBeGreaterThan(0)
  })

  it('los corredores no ven la competencia', () => {
    renderAt(<PreciosPage />, 'corredor', '/precios')
    expect(screen.queryByRole('tab', { name: /Competencia/ })).not.toBeInTheDocument()
  })
})

describe('Cotizaciones', () => {
  const pantalla = (
    <Routes>
      <Route path="/cotizaciones" element={<CotizacionesPage />} />
      <Route path="/venta" element={<Ubicacion />} />
    </Routes>
  )

  it('es el historial: para emitir abre el recorrido único de Atender cliente', () => {
    renderAt(pantalla, 'asesor', '/cotizaciones')
    expect(screen.getByRole('heading', { name: 'Aún no hay cotizaciones.' })).toBeInTheDocument()
    for (const l of screen.getAllByRole('link', { name: /Nueva cotización/ })) expect(l).toHaveAttribute('href', '/venta')
    expect(screen.queryByRole('button', { name: /Generar PDF/ })).toBeNull()
    expect(screen.getByText(/La simulación de crédito es referencial/)).toBeInTheDocument()
  })

  it('un enlace para cotizar un departamento lleva a Atender cliente con ese departamento', () => {
    renderAt(pantalla, 'asesor', '/cotizaciones?unidad=E1-PB-A2&fecha=2026-10-28')
    expect(screen.getByText('/venta?unidad=E1-PB-A2')).toBeInTheDocument()
  })
})
