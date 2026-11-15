import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import InventarioPage from '@/pages/InventarioPage'
import { aprobarPropuesta, crearPropuesta, marcarReservada } from '../service'
import { InventoryProvider } from '../store'
import type { Actor, InventoryState, Rol } from '../types'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'

// Radix usa estas APIs del navegador que jsdom no implementa.
beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

function renderPage(rol: Rol, url = '/inventario', initialState?: InventoryState) {
  return render(
    <SessionProvider initialRol={rol}>
      <InventoryProvider initialState={initialState ?? createInitialState()}>
        <MemoryRouter initialEntries={[url]}><InventarioPage /></MemoryRouter>
      </InventoryProvider>
    </SessionProvider>,
  )
}
const gerencia: Actor = { id: 'u-g', nombre: 'Gerencia', rol: 'gerencia' }
const conReserva = () => {
  return marcarReservada(createInitialState(), 'E1-PB-A1', 'RES-1', gerencia)
}
const simular = async (user: ReturnType<typeof userEvent.setup>, ficha: HTMLElement, valor: string) => {
  const campo = within(ficha).getByLabelText('Simular nuevo USD/m²')
  await user.clear(campo)
  await user.type(campo, valor)
}

describe('InventarioPage', () => {
  it('un enlace con B007 abre la misma unidad técnica y acepta Edificio B como filtro', () => {
    renderPage('administrador','/inventario?unidad=B007&edificio=B')
    expect(screen.getByRole('dialog')).toHaveTextContent('Departamento B007')
  })
  it('con ?vista=mapa abre directamente el mapa por edificio', () => {
    renderPage('asesor', '/inventario?vista=mapa')
    expect(screen.getByRole('heading', { name: 'Edificio B' })).toBeInTheDocument()
  })

  it('muestra las 72 unidades, el valor total y los pendientes por separado', () => {
    renderPage('asesor')
    expect(screen.getByText(/72 departamentos/)).toBeInTheDocument()
    expect(screen.getByText('1–15 de 72 unidades')).toBeInTheDocument()
    const nota = screen.getByRole('note', { name: 'Pendientes del inventario' })
    expect(within(nota).queryByText('Disponibilidad pendiente de validar:')).not.toBeInTheDocument()
    expect(within(nota).getByText('Precios pendientes de aprobación:')).toBeInTheDocument()
    expect(within(nota).getByText('Documentación incompleta:')).toBeInTheDocument()
    expect(screen.getAllByText('Disponible').length).toBeGreaterThan(0)
    expect(screen.queryByText(/pendiente de validar/i)).not.toBeInTheDocument()
    expect(screen.getByText((t) => /11\.197\.345/.test(t))).toBeInTheDocument()
    expect(screen.queryByText('Por confirmar')).not.toBeInTheDocument()
  })

  it('los indicadores cuentan por estado y filtran al pulsarlos', async () => {
    const user = userEvent.setup()
    renderPage('asesor', '/inventario', conReserva())
    const grupo = screen.getByRole('group', { name: 'Unidades por estado' })
    expect(within(grupo).getByRole('button', { name: /Total/ })).toHaveTextContent('72')
    await user.click(within(grupo).getByRole('button', { name: /Reservadas/ }))
    expect(within(grupo).getByRole('button', { name: /Reservadas/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1–1 de 1 unidad')).toBeInTheDocument()
    await user.click(within(grupo).getByRole('button', { name: /Vendidas/ }))
    expect(screen.getAllByText('No hay unidades con estos filtros.').length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('button', { name: 'Limpiar filtros' })[0])
    expect(screen.getByText('1–15 de 72 unidades')).toBeInTheDocument()
  })

  it('la ficha muestra pago a la firma, reserva acreditada y cuotas que cuadran con el total', async () => {
    const user = userEvent.setup()
    renderPage('asesor')
    await user.type(screen.getByLabelText('Buscar unidad'), '1002')
    expect(screen.getByText('1–1 de 1 unidad')).toBeInTheDocument()
    await user.click(screen.getByRole('row', { name: /A002/ }))
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).getByText(/Departamento A002/)).toBeInTheDocument()
    expect(within(ficha).getByText('Pago a la firma 6 %')).toBeInTheDocument()
    expect(within(ficha).queryByText(/^Reserva · /)).not.toBeInTheDocument()
    // La reserva predeterminada es USD 500 y se descuenta del pago a la firma: 10.328,83 − 500.
    expect(within(ficha).getByLabelText('Reserva (USD)')).toHaveValue('500')
    expect(within(ficha).getByText((t) => /9\.828,83/.test(t))).toBeInTheDocument()
    // Sin permiso no hay simulador.
    expect(within(ficha).queryByLabelText('Simular nuevo USD/m²')).not.toBeInTheDocument()
    expect(within(ficha).getByRole('heading', { name: /Precio de venta/ })).toHaveTextContent(/Referencial/)
  })

  it('simular USD 2.300 en el 1001 muestra $166.911 frente a $161.831, sin guardar; cancelar no cambia nada', async () => {
    const user = userEvent.setup()
    renderPage('administrador', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).queryByText('Cambios sin guardar')).not.toBeInTheDocument()
    expect(within(ficha).queryByRole('button', { name: 'Guardar precio' })).not.toBeInTheDocument()
    await simular(user, ficha, '2300')
    expect(within(ficha).getByText('Cambios sin guardar')).toBeInTheDocument()
    const vista = within(ficha).getByLabelText('Vista previa del precio')
    expect(within(vista).getByText((t) => /166\.911/.test(t))).toBeInTheDocument()
    expect(within(vista).getByText((t) => /161\.831/.test(t))).toBeInTheDocument()
    expect(within(vista).getByText(/\+.*5\.080.*3,14/)).toBeInTheDocument()
    expect(within(vista).getByText('Pago a la firma')).toBeInTheDocument()
    expect(within(vista).getByText('Saldo contra entrega')).toBeInTheDocument()
    await user.click(within(vista).getByRole('button', { name: 'Cancelar' }))
    expect(within(ficha).queryByText('Cambios sin guardar')).not.toBeInTheDocument()
    expect(within(ficha).getByLabelText('Simular nuevo USD/m²')).toHaveValue('')
    // Precio oficial intacto.
    expect(within(ficha).getByText('Sin cambios desde la lista base del 28/10/2026.')).toBeInTheDocument()
  })

  it('con el campo vacío no hay $0 → $0, y el mismo valor no es un cambio', async () => {
    const user = userEvent.setup()
    renderPage('administrador', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).queryByLabelText('Vista previa del precio')).not.toBeInTheDocument()
    await simular(user, ficha, '2230')
    expect(within(ficha).getByText(/no hay cambios/)).toBeInTheDocument()
    expect(within(ficha).queryByText('Cambios sin guardar')).not.toBeInTheDocument()
    await simular(user, ficha, '10')
    expect(within(ficha).getByRole('alert')).toHaveTextContent(/entre 500 y 10000/)
  })

  it('administración guarda: se refleja en ficha, tabla y total, queda como Aprobado y en el historial', async () => {
    const user = userEvent.setup()
    renderPage('administrador', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    await simular(user, ficha, '2300')
    const guardar = within(ficha).getByRole('button', { name: 'Guardar precio' })
    expect(guardar).toBeDisabled()
    await user.type(within(ficha).getByLabelText('Motivo del cambio'), 'Precio aprobado por gerencia')
    await user.click(guardar)
    expect(await within(ficha).findByRole('status')).toHaveTextContent(/precio actualizado a .*166\.911/)
    expect(within(ficha).getAllByText((t) => /166\.911/.test(t)).length).toBeGreaterThan(0)
    expect(within(ficha).getByText(/Precio aprobado por gerencia/)).toBeInTheDocument()
    expect(within(ficha).getByText(/Precio por m² · /)).toBeInTheDocument()
    expect(within(ficha).getByText('Aprobado')).toBeInTheDocument()
    await user.click(within(ficha).getByRole('button', { name: 'Cerrar ficha' }))
    const fila = await screen.findByRole('row', { name: /A001/ })
    expect(within(fila).getByText((t) => /166\.911/.test(t))).toBeInTheDocument()
    expect(within(fila).getByText(/Aprobado/)).toBeInTheDocument()
    expect(screen.getByText((t) => /11\.202\.425/.test(t))).toBeInTheDocument()
  })

  it('gerencia propone desde la ficha: el precio oficial no cambia y se explica por qué', async () => {
    const user = userEvent.setup()
    renderPage('gerencia', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    await simular(user, ficha, '2300')
    expect(within(ficha).getByText(/Quién propone y quién aprueba/)).toBeInTheDocument()
    await user.type(within(ficha).getByLabelText('Motivo del cambio'), 'Propuesta para comité')
    await user.click(within(ficha).getByRole('button', { name: 'Enviar a aprobación' }))
    expect(await within(ficha).findByRole('status')).toHaveTextContent(/propuesta enviada a aprobación/)
    expect(within(ficha).getAllByText((t) => /161\.831/.test(t)).length).toBeGreaterThan(0)
    expect(within(ficha).queryByText((t) => /166\.911/.test(t))).not.toBeInTheDocument()
  })

  it('una unidad reservada no se libera a mano ni cambia de precio, y se dice por qué', async () => {
    renderPage('administrador', '/inventario?unidad=E1-PB-A1', conReserva())
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).getByText(/Precio congelado/)).toBeInTheDocument()
    expect(within(ficha).queryByLabelText('Simular nuevo USD/m²')).not.toBeInTheDocument()
    expect(within(ficha).getByText(/se libera anulándola en Reservas/)).toBeInTheDocument()
    expect(within(ficha).queryByText('Solicitar cambio de estado')).not.toBeInTheDocument()
  })

  it('el estado no se cambia a mano: la ficha explica que lo fijan Reservas y Contratos', async () => {
    renderPage('administrador', '/inventario?unidad=E1-PB-A1')
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).getByText(/Pasa a reservado cuando se aprueba una reserva/)).toBeInTheDocument()
    expect(within(ficha).queryByText('Solicitar cambio de estado')).not.toBeInTheDocument()
  })

  it('un ajuste masivo no empieza con todo elegido, y muestra afectadas y excluidas con su motivo', async () => {
    const user = userEvent.setup()
    renderPage('administrador', '/inventario', conReserva())
    await user.click(screen.getByRole('button', { name: 'Ajustar precios' }))
    const dlg = await screen.findByRole('dialog', { name: /Modificar precio por m²/ })
    await user.type(within(dlg).getByLabelText(/Porcentaje/), '2')
    expect(within(dlg).getByText(/Elige el edificio para ver/)).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Aplicar cambio' })).toBeDisabled()
    await user.click(within(dlg).getByLabelText('Edificio'))
    await user.click(await screen.findByRole('option', { name: 'Edificio A' }))
    expect(within(dlg).getByText(/29 unidades/)).toBeInTheDocument()
    expect(within(dlg).getByText('1 excluida')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Unidades excluidas')).toHaveTextContent(/Departamento A001: Precio congelado/)
    await user.type(within(dlg).getByLabelText(/Motivo del cambio/), 'Ajuste del edificio 1')
    await user.click(within(dlg).getByRole('button', { name: 'Aplicar cambio' }))
    expect(await screen.findByText(/Precio actualizado en 29 unidades/)).toBeInTheDocument()
  })

  it('el historial muestra por separado quién propuso y quién aprobó, y los documentos pendientes no figuran como validados', async () => {
    const user = userEvent.setup()
    const admin: Actor = { id: 'u-a', nombre: 'Andrés Admin', rol: 'administrador' }
    let s = crearPropuesta(createInitialState(), { alcance: { codigos: ['E1-PB-A1'] }, modo: 'fijar', valor: 2300, motivo: 'Ajuste de comité' }, gerencia)
    s = aprobarPropuesta(s, s.propuestas[0].id, 'Conforme', admin)
    renderPage('administrador', '/inventario?unidad=E1-PB-A1', s)
    const ficha = await screen.findByRole('dialog')
    expect(within(ficha).getByText(/Propuso:/)).toHaveTextContent('Gerencia')
    expect(within(ficha).getByText(/Aprobó:/)).toHaveTextContent('Andrés Admin')
    expect(within(ficha).getAllByText('Pendiente').length).toBeGreaterThanOrEqual(2)
    expect(within(ficha).queryByText('Validado')).not.toBeInTheDocument()
    await user.click(within(ficha).getByRole('button', { name: 'Cerrar ficha' }))
    await user.click(screen.getByRole('tab', { name: /Historial/ }))
    expect(screen.getByText(/Propuso:/)).toHaveTextContent('Gerencia')
    expect(screen.getByText(/Aprobó:/)).toHaveTextContent('Andrés Admin')
    expect(screen.getByText(/Total .*161\.831.*166\.911/)).toBeInTheDocument()
  })

  it('conserva filtros y página al abrir y cerrar una ficha', async () => {
    const user = userEvent.setup()
    renderPage('asesor')
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }))
    expect(screen.getByText('16–30 de 72 unidades')).toBeInTheDocument()
    await user.click(screen.getAllByRole('row', { name: /Abrir ficha/ })[0])
    const ficha = await screen.findByRole('dialog')
    await user.click(within(ficha).getByRole('button', { name: 'Cerrar ficha' }))
    expect(screen.getByText('16–30 de 72 unidades')).toBeInTheDocument()
  })
})
