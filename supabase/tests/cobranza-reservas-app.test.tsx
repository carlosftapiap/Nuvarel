// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor } from '@/features/inventario/types'
import CobranzaPage from '@/pages/CobranzaPage'
import { almacenPrueba, archivoPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, vera: string, omar: string
let q: string, reserva: string
const UNIDAD = 'E1-PB-A2'

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = (u: string, sql: string, p: unknown[] = []) => como(db, u, () => db.query(sql, p))
const conteo = async (t: string) => (await uno<{ n: number }>(`select count(*)::int as n from public.${t}`)).n

async function abrir(id: string) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter><CobranzaPage /></MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
}
const tarjeta = (t: string) => screen.getByText(t).parentElement!
const irAIndicadores = async () => { await userEvent.setup().click(await screen.findByRole('tab', { name: 'Indicadores' })) }
const irAReservas = async (user: ReturnType<typeof userEvent.setup>) => {
  const tab = await screen.findByRole('tab', { name: /^Reservas/ })
  await user.click(tab)
}

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  omar = await crearUsuario(db, 'Omar Vendedor', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [UNIDAD])
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  const cli = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Andrea Mora", "telefono": "0995556677", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
  const op = (await como(db, vera, () => db.query<{ id: string }>(`select public.oportunidades_crear($1, $2, null) as id`, [cli, UNIDAD]))).rows[0].id
  q = (await como(db, vera, () => db.query<{ id: string }>(`select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op]))).rows[0].id
  reserva = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar_acordada($1, 600) as id`, [q]))).rows[0].id
}, 60_000)

describe('Reservas dentro de Cobranzas', () => {
  it('una solicitud aparece desde que se crea, sin contarse como ingreso ni crear cartera', async () => {
    const user = userEvent.setup()
    const s = await abrir(finanzas)
    await irAIndicadores()
    await screen.findByText('Reservas pendientes de pago')
    expect(within(tarjeta('Reservas pendientes de pago')).getByText('1')).toBeInTheDocument()
    expect(within(tarjeta('Reservas pendientes de pago')).getByText(/\$600,00 acordados/)).toBeInTheDocument()
    expect(within(tarjeta('Pagos pendientes de verificación')).getByText('0')).toBeInTheDocument()
    expect(within(tarjeta('Total recaudado')).getByText('$0,00')).toBeInTheDocument()

    await irAReservas(user)
    const fila = (await screen.findByText('Andrea Mora')).closest('tr')!
    expect(within(fila).getByText(/^RES-/)).toBeInTheDocument()
    expect(within(fila).getAllByText('$600,00', { selector: 'td' })).toHaveLength(2)
    expect(within(fila).getByText('Pendiente de pago')).toBeInTheDocument()
    // Finanzas abre la reserva en Reservas: no cotiza.
    expect(within(fila).getByRole('link', { name: /Ver reserva/ }).getAttribute('href')).toMatch(/^\/reservas\?codigo=RES-/)

    expect(await conteo('payments')).toBe(0)
    expect(await conteo('contracts')).toBe(0)
    expect(await conteo('installments')).toBe(0)
    s.unmount()
  })

  it('el vendedor registra el pago: pasa a verificación, los indicadores se actualizan y el botón desaparece', async () => {
    const user = userEvent.setup()
    const s = await abrir(vera)
    await irAReservas(user)
    const fila = (await screen.findByText('Andrea Mora')).closest('tr')!
    expect(within(fila).getByRole('link', { name: /Ver reserva/ })).toHaveAttribute('href', `/venta?cotizacion=${q}`)
    await user.click(within(fila).getByRole('button', { name: /Registrar pago/ }))
    const dlg = await screen.findByRole('dialog', { name: /Registrar pago/ })
    await user.type(within(dlg).getByLabelText('Banco *'), 'Banco Pichincha')
    fireEvent.change(within(dlg).getByLabelText(/Foto o PDF/), { target: { files: [archivoPrueba()] } })
    await user.type(within(dlg).getByLabelText(/Número de transferencia/), 'TRF-555')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar' }))
    await screen.findByText(/Pago de RES-.* registrado/)
    expect(await uno(`select estado, comprobante, monto_recibido from public.reservations where id = $1`, [reserva])).toEqual({ estado: 'solicitada', comprobante: 'TRF-555', monto_recibido: null })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Registrar pago/ })).toBeNull())
    const filaNueva = screen.getByText('Andrea Mora').closest('tr')!
    expect(within(filaNueva).getByText('Pago por verificar')).toBeInTheDocument()
    expect(within(filaNueva).getByText(/reportado, sin confirmar/)).toBeInTheDocument()
    expect(await conteo('payments')).toBe(0)
    await user.click(screen.getByRole('tab', { name: 'Indicadores' }))
    expect(within(await screen.findByText('Pagos pendientes de verificación').then((x) => x.parentElement!)).getByText('1')).toBeInTheDocument()
    expect(within(tarjeta('Reservas pendientes de pago')).getByText('0')).toBeInTheDocument()
    expect(within(tarjeta('Total recaudado')).getByText('$0,00')).toBeInTheDocument()
    s.unmount()
  })

  it('otro vendedor no ve esa reserva', async () => {
    const user = userEvent.setup()
    const s = await abrir(omar)
    await irAReservas(user)
    expect(await screen.findByText('No hay solicitudes de reserva en tu alcance.')).toBeInTheDocument()
    expect(screen.queryByText('Andrea Mora')).toBeNull()
    s.unmount()
  })

  it('recaudado cuenta solo lo confirmado por Finanzas, una vez, también al pasar a contrato', async () => {
    const user = userEvent.setup()
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 700, $2::date, 'BAN-1', true, 'Ingreso confirmado')`, [reserva, hoyGuayaquil()])
    let s = await abrir(finanzas)
    await irAIndicadores()
    await screen.findByText('Total recaudado')
    expect(within(tarjeta('Total recaudado')).getByText('$700,00')).toBeInTheDocument()
    expect(within(tarjeta('Pagos pendientes de verificación')).getByText('0')).toBeInTheDocument()
    await irAReservas(user)
    const fila = (await screen.findByText('Andrea Mora')).closest('tr')!
    expect(within(fila).getByText('$700,00')).toBeInTheDocument()
    expect(within(fila).getByText('$0,00')).toBeInTheDocument()
    expect(within(fila).getByText(/Pago verificado · por aprobar/)).toBeInTheDocument()
    s.unmount()

    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [reserva])
    await rpc(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la reserva')`, [reserva, hoyGuayaquil()])
    expect(await conteo('payments')).toBe(1)
    s = await abrir(finanzas)
    await irAIndicadores()
    await screen.findByText('Total recaudado')
    expect(within(tarjeta('Total recaudado')).getByText('$700,00')).toBeInTheDocument()
    await irAReservas(user)
    expect(within((await screen.findByText('Andrea Mora')).closest('tr')!).getByText('Con contrato')).toBeInTheDocument()
    s.unmount()
  })
})
