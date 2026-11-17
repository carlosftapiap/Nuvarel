// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import FinanciamientoPage from '@/pages/FinanciamientoPage'
import VentaPage from '@/pages/VentaPage'
import { almacenPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let vera: string, cliente: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrir(url: string) {
  const actor = await actorDe(vera)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, vera), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><ClientesProvider><ReservasProvider>
        <MemoryRouter initialEntries={[url]}><Routes>
          <Route path="/venta" element={<VentaPage />} />
          <Route path="/financiamiento" element={<FinanciamientoPage />} />
        </Routes></MemoryRouter>
      </ReservasProvider></ClientesProvider></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
const boton = (name: RegExp) => screen.findByRole('button', { name })
const cuantas = async (tabla: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${tabla}`)).rows[0].n

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  URL.createObjectURL ??= vi.fn(() => 'blob:x')
  URL.revokeObjectURL ??= vi.fn()
})

beforeAll(async () => {
  db = await crearDb()
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  cliente = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Andrea Mora", "telefono": "0995556677", "documento": "1725566770", "email": "andrea@correo.com", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
}, 60_000)

describe('Un solo Financiamiento para Atender cliente y el menú', () => {
  it('Atender → cliente → departamento → Financiamiento → extraordinaria de $10.000 → volver → editar: todo permanece', async () => {
    const user = userEvent.setup()
    const s = await abrir('/venta?unidad=E1-PB-A2')
    // Atender cliente ya no tiene el formulario financiero.
    await screen.findByLabelText('Buscar cliente existente')
    expect(screen.queryByRole('button', { name: /Continuar en Financiamiento/ })).toBeNull()
    expect(screen.queryByLabelText(/Reserva \(USD\)/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Emitir cotización/ })).toBeNull()
    await user.click(await boton(/Andrea Mora/))
    await user.click(await boton(/Continuar en Financiamiento/))

    // La misma pantalla del menú, con la operación: no se vuelve a pedir cliente ni departamento.
    expect(await screen.findByRole('tab', { name: '1. Entrada del 20%' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '2. Crédito hipotecario 80%' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '3. Cotización integral' })).toBeInTheDocument()
    const op = screen.getByRole('region', { name: 'Operación' })
    const pasos = within(within(op).getByRole('list', { name: 'Pasos de la venta' })).getAllByRole('listitem')
    expect(pasos.map((li) => li.querySelector('.font-medium')?.textContent)).toEqual(['Cliente', 'Departamento', 'Cotización', 'Reserva', 'Venta'])
    expect(within(op).getByText(/Ahora te toca/)).toBeInTheDocument()
    expect(screen.getByText(/Andrea Mora · Departamento/)).toBeInTheDocument()
    expect(within(op).getByRole('button', { name: /Emitir cotización y descargar PDF/ })).toBeDisabled()

    await user.type(screen.getByLabelText(/Reserva \(USD\)/), '600')
    await user.click(await boton(/Agregar cuota extraordinaria/))
    await user.type(screen.getByLabelText(/^Mes \(1 a/), '6')
    await user.type(screen.getByLabelText('Monto (USD)'), '10000')
    await user.click(await boton(/Usar este plan y continuar cotización/))
    expect(await screen.findByText(/Plan confirmado · versión/)).toBeInTheDocument()

    // Simular y confirmar no crea nada.
    expect(await cuantas('quotes')).toBe(0)
    expect(await cuantas('reservations')).toBe(0)

    await user.click(screen.getByRole('link', { name: /Atender cliente/ }))
    expect(await screen.findByText(/Plan confirmado · versión/)).toBeInTheDocument()
    expect(screen.getByText('Extraordinaria · mes 6')).toBeInTheDocument()
    await user.click(await boton(/Editar financiamiento/))

    expect(await screen.findByLabelText(/Reserva \(USD\)/)).toHaveValue('600')
    expect(screen.getByLabelText(/^Mes \(1 a/)).toHaveValue('6')
    expect(screen.getByLabelText('Monto (USD)')).toHaveValue('10000')
    expect(await screen.findByText(/Plan confirmado · versión/)).toBeInTheDocument()
    s.unmount()

    // Actualizar el navegador tampoco lo pierde.
    const r = await abrir('/financiamiento?operacion=1')
    expect(await screen.findByLabelText('Monto (USD)')).toHaveValue('10000')

    // Un cambio en las condiciones exige confirmar de nuevo antes de emitir.
    const monto = screen.getByLabelText('Monto (USD)')
    await user.clear(monto)
    await user.type(monto, '8000')
    expect(await screen.findByText(/Cambiaste las condiciones/)).toBeInTheDocument()
    expect(await boton(/Emitir cotización y descargar PDF/)).toBeDisabled()

    await user.click(await boton(/Usar este plan/))
    const acepta = await screen.findByRole('checkbox', { name: /acepta este calendario de pagos/ })
    if (!(acepta as HTMLInputElement).checked) await user.click(acepta)
    const emitir = await boton(/Emitir cotización y descargar PDF/)
    await waitFor(() => expect(emitir).toBeEnabled())
    // Dos pulsaciones seguidas emiten una sola cotización.
    await user.dblClick(emitir)
    expect(await screen.findByText(/COT-\d{4}-\d+ emitida y descargada/)).toBeInTheDocument()
    const q = (await db.query<{ plan: { extraordinarias: unknown } }>(`select plan from public.quotes where client_id = $1`, [cliente])).rows
    expect(q).toHaveLength(1)
    expect(q[0].plan.extraordinarias).toEqual([{ mes: 6, monto: 8000 }])
    // Lo emitido queda identificado: la versión de la base es la que se confirmó.
    expect(screen.getByText(/Plan de la cotización COT-.* versión/)).toBeInTheDocument()
    expect(screen.queryByText(/plan distinto del confirmado/)).toBeNull()
    // Emitida la cotización, la guía marca tres etapas terminadas, está en Reserva y destaca «Solicitar reserva».
    const guia = within(screen.getByRole('region', { name: 'Operación' })).getByRole('list', { name: 'Pasos de la venta' })
    expect(guia.querySelectorAll('.bg-emerald-600')).toHaveLength(3)
    expect(guia.querySelector('[aria-current="step"]')?.textContent).toMatch(/Reserva/)
    expect(screen.getByRole('button', { name: /Solicitar reserva/ }).closest('[data-guia="siguiente"]')).not.toBeNull()
    r.unmount()
  })

  it('Cliente → Departamento → Financiamiento → Cotización → otro cliente; cambiar no borra nada guardado', async () => {
    const user = userEvent.setup()
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A5'`)
    const sello = async () => [await cuantas('clients'), await cuantas('quotes'), await cuantas('reservations')]
    const antes = await sello()
    const s = await abrir('/venta')

    // Empieza directamente por el cliente; el formulario va antes de la galería y de las ventas iniciadas.
    const buscador = await screen.findByLabelText('Buscar cliente existente')
    expect(screen.queryByRole('button', { name: /Nueva operación/ })).toBeNull()
    expect(screen.getByText('Selecciona o registra un cliente para comenzar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Registrar nuevo cliente/ })).toBeInTheDocument()
    const galeria = screen.getByRole('region', { name: 'Presentación del proyecto AMURA' })
    expect(buscador.compareDocumentPosition(galeria) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Cliente: pasa al paso 2. Solo con el cliente elegido, cambiarlo no pide confirmación.
    await user.click(await boton(/^Andrea Mora/))
    await waitFor(() => expect(document.activeElement?.id).toBe('ve-picker'))
    await user.click(await boton(/Cambiar cliente/))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByLabelText('Buscar cliente existente'))

    // Con departamento elegido hay algo que perder: pide confirmar y cancelar lo conserva.
    await user.click(await boton(/^Andrea Mora/))
    await waitFor(() => expect(document.activeElement?.id).toBe('ve-picker'))
    await user.click(screen.getByRole('combobox', { name: 'Departamento disponible' }))
    await user.click(await screen.findByRole('option', { name: /^A005/ }))
    const seguir = await boton(/Continuar en Financiamiento/)
    await waitFor(() => expect(document.activeElement).toBe(seguir))
    await user.click(await boton(/Cambiar cliente/))
    const dlg = await screen.findByRole('dialog', { name: /Descartar esta venta/ })
    await user.click(within(dlg).getByRole('button', { name: 'Seguir con esta venta' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: /Continuar en Financiamiento/ })).toBeInTheDocument()

    // Descartar reinicia el formulario, lleva al buscador y no toca lo guardado.
    await user.click(await boton(/Cambiar cliente/))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Descartar y elegir otro cliente' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Buscar cliente existente')))
    expect(screen.queryByRole('button', { name: /Continuar en Financiamiento/ })).toBeNull()
    expect(await sello()).toEqual(antes)

    // Recorrido completo.
    await user.click(await boton(/^Andrea Mora/))
    await waitFor(() => expect(document.activeElement?.id).toBe('ve-picker'))
    await user.click(screen.getByRole('combobox', { name: 'Departamento disponible' }))
    await user.click(await screen.findByRole('option', { name: /^A005/ }))
    await user.click(await boton(/Continuar en Financiamiento/))
    await user.click(await boton(/Usar este plan/))
    const acepta = await screen.findByRole('checkbox', { name: /acepta este calendario de pagos/ })
    if (!(acepta as HTMLInputElement).checked) await user.click(acepta)
    const emitir = await boton(/Emitir cotización y descargar PDF/)
    await waitFor(() => expect(emitir).toBeEnabled())
    await user.click(emitir)
    expect(await screen.findByText(/COT-\d{4}-\d+ emitida y descargada/)).toBeInTheDocument()
    expect(await boton(/^Solicitar reserva$/)).toBeInTheDocument()
    const despues = await sello()
    expect(despues[1]).toBe(antes[1] + 1)

    // Al regresar: lo emitido está guardado, no pide confirmar y sigue en las ventas iniciadas.
    await user.click(screen.getByRole('link', { name: /Atender cliente/ }))
    await user.click(await boton(/Atender a otro cliente/))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByLabelText('Buscar cliente existente')).toBeInTheDocument()
    expect(await boton(/Continuar operación de Andrea Mora, A005/)).toBeInTheDocument()
    expect(await sello()).toEqual(despues)
    s.unmount()
  })

  it('el ingreso directo simula sin cliente, sin bloque Operación, y conserva todo al vincular', async () => {
    const user = userEvent.setup()
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A4'`)
    const antes = await cuantas('quotes')
    const s = await abrir('/financiamiento?unidad=E1-PB-A4')
    expect(await screen.findByRole('tab', { name: '1. Entrada del 20%' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Operación' })).toBeNull()
    expect(screen.getByText('Entrada total (20%)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Crear cotización/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Excel/ })).toBeInTheDocument()
    await user.click(await boton(/Agregar cuota extraordinaria/))
    await user.type(screen.getByLabelText(/^Mes \(1 a/), '3')
    await user.type(screen.getByLabelText('Monto (USD)'), '5000')

    await user.selectOptions(await screen.findByLabelText('Cliente'), cliente)
    await user.click(await boton(/Vincular y abrir la operación/))
    expect(await screen.findByRole('region', { name: 'Operación' })).toBeInTheDocument()
    expect(screen.getByText(/Andrea Mora · Departamento/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monto (USD)')).toHaveValue('5000')
    expect(await cuantas('quotes')).toBe(antes)
    s.unmount()
  })
})
