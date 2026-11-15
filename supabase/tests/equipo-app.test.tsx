// @vitest-environment jsdom
// Supervisor con su equipo, cliente duplicado entre vendedores y reasignación con historial, en pantalla.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import EquipoPage from '@/pages/EquipoPage'
import { datosPglite } from './datos-pglite'
import { cedulaPrueba, como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, gerente: string, supA: string, supB: string, vendA: string, vendA2: string, vendB: string
let lucia: string
const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function abrir(id: string, url: string, pagina: ReactNode) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider><ClientesProvider><ReservasProvider>
          <MemoryRouter initialEntries={[url]}>{pagina}</MemoryRouter>
        </ReservasProvider></ClientesProvider></InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('amura.clientes.vista', 'tabla')
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gina Gerencia', 'gerencia')
  supA = await crearUsuario(db, 'Sara Supervisora', 'supervisor')
  supB = await crearUsuario(db, 'Saúl Supervisor', 'supervisor')
  vendA = await crearUsuario(db, 'Carlos Pérez', 'asesor')
  vendA2 = await crearUsuario(db, 'Ana Andrade', 'asesor')
  vendB = await crearUsuario(db, 'Beto Bravo', 'asesor')
  for (const [nombre, sup, miembros] of [['Equipo Norte', supA, [vendA, vendA2]], ['Equipo Sur', supB, [vendB]]] as const) {
    const t = (await rpc<{ id: string }>(admin, `select public.config_guardar_equipo(null, $1, $2, '{}'::uuid[], 'Alta de equipo') as id`, [nombre, sup])).id
    for (const m of miembros) await db.query(`update public.profiles set equipo_id = $1 where id = $2`, [t, m])
  }
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  lucia = (await rpc<{ id: string }>(vendA, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Lucía Torres', documento: '0915677082', telefono: '0992222222', origen: 'whatsapp' }), vendA])).id
  const op = (await rpc<{ id: string }>(vendA, `select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [lucia])).id
  await rpc(vendA, `select public.cotizaciones_emitir($1, 0, 30, '')`, [op])
  await rpc(vendB, `select public.clientes_crear(null, $1::jsonb, $2)`, [JSON.stringify({ nombre: 'Cliente del Sur', telefono: '0997777777', origen: 'instagram' }), vendB])
}, 60_000)

describe('Supervisor', () => {
  it('el Dashboard de equipo muestra solo a sus vendedores, con indicadores y totales', async () => {
    await abrir(supA, '/equipo', <EquipoPage vista="dashboard" />)
    const carlos = (await screen.findByText('Carlos Pérez')).closest('tr')!
    // Clientes, nuevos, cotizaciones, reservas, aprobadas, rechazadas, ventas.
    expect(within(carlos).getAllByRole('cell').slice(1, 8).map((c) => c.textContent)).toEqual(['1', '1', '1', '0', '0', '0', '0'])
    expect(screen.getByText('Ana Andrade')).toBeInTheDocument()
    expect(screen.queryByText('Beto Bravo')).toBeNull()
    expect(within(screen.getByRole('heading', { name: 'Mi equipo' }).parentElement!).getByText('Clientes asignados').closest('div')!.parentElement).toHaveTextContent('1')
  })

  it('en Mi equipo abre la gestión de un vendedor en un panel, con sus clientes y cotizaciones', async () => {
    const user = userEvent.setup()
    await abrir(supA, '/mi-equipo', <EquipoPage vista="detalle" />)
    await user.click(await screen.findByRole('button', { name: 'Ver gestión de Carlos Pérez' }))
    const panel = await screen.findByRole('dialog', { name: 'Carlos Pérez' })
    expect(await within(panel).findByRole('link', { name: 'Lucía Torres' })).toBeInTheDocument()
    expect(within(panel).getByText(/^Cotizaciones \(1\)/)).toBeInTheDocument()
    expect(screen.queryByText('Beto Bravo')).toBeNull()
  })

  it('un vendedor de otro equipo no aparece aunque se pida por la dirección', async () => {
    await abrir(supA, `/mi-equipo?vendedor=${vendB}`, <EquipoPage vista="detalle" />)
    expect(await screen.findByText('Ese vendedor no pertenece a tu equipo.')).toBeInTheDocument()
    expect(screen.queryByText('Cliente del Sur')).toBeNull()
  })

  it('sin equipo asignado explica cómo vincularlo', async () => {
    const solo = await crearUsuario(db, 'Sin Equipo', 'supervisor')
    await abrir(solo, '/equipo', <EquipoPage vista="dashboard" />)
    expect(await screen.findByText('Todavía no tienes vendedores asignados')).toBeInTheDocument()
  })

  it('una reserva registrada por el administrador cuenta para el vendedor dueño del cliente, igual que su etapa', async () => {
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A1'`)
    const bruno = (await rpc<{ id: string }>(vendA2, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: 'Bruno Jerarquía', documento: '1710034065', telefono: '0993333333', origen: 'whatsapp' }), vendA2])).id
    const op = (await rpc<{ id: string }>(vendA2, `select public.oportunidades_crear($1, 'E1-PB-A1', null) as id`, [bruno])).id
    const cot = (await rpc<{ id: string }>(admin, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(admin, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
    await rpc(admin, `select public.reservas_solicitar($1)`, [cot])
    expect(await uno(`select etapa from public.opportunities where id = $1`, [op])).toEqual({ etapa: 'solicitud_reserva' })

    await abrir(supA, '/equipo', <EquipoPage vista="dashboard" />)
    const ana = (await screen.findByText('Ana Andrade')).closest('tr')!
    // Clientes, nuevos, cotizaciones, reservas, aprobadas, rechazadas, ventas.
    expect(within(ana).getAllByRole('cell').slice(1, 8).map((c) => c.textContent)).toEqual(['1', '1', '1', '1', '0', '0', '0'])
    cleanup()
    await abrir(supA, `/mi-equipo?vendedor=${vendA2}`, <EquipoPage vista="detalle" />)
    expect(await screen.findByText(/Reserva solicitada:/)).toBeInTheDocument()
    expect(screen.getByText(/^Reservas \(1\)/)).toBeInTheDocument()
  })
})

describe('Mi equipo por supervisor', () => {
  it('el administrador ve cada equipo bajo su supervisor, con sus vendedores', async () => {
    await abrir(admin, '/mi-equipo', <EquipoPage vista="detalle" />)
    const norte = await screen.findByRole('region', { name: 'Equipo Norte' })
    expect(within(norte).getByText('Carlos Pérez')).toBeInTheDocument()
    expect(within(norte).getByText('Ana Andrade')).toBeInTheDocument()
    expect(within(norte).queryByText('Beto Bravo')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Equipo Sur' })).getByText('Beto Bravo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Sara Supervisora/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Saúl Supervisor/ })).toBeInTheDocument()
  })

  it('el filtro de supervisor deja ver solo su equipo', async () => {
    await abrir(admin, `/mi-equipo?supervisor=${supB}`, <EquipoPage vista="detalle" />)
    expect(await screen.findByText('Beto Bravo')).toBeInTheDocument()
    expect(screen.queryByText('Carlos Pérez')).toBeNull()
  })

  it('Ver gestión abre el panel del vendedor sin salir de la pantalla', async () => {
    const user = userEvent.setup()
    await abrir(supA, '/mi-equipo', <EquipoPage vista="detalle" />)
    await user.click(await screen.findByRole('button', { name: 'Ver gestión de Ana Andrade' }))
    const panel = await screen.findByRole('dialog', { name: 'Ana Andrade' })
    expect(within(panel).getByText(/^Clientes asignados \(/)).toBeInTheDocument()
    expect(within(panel).getByText('Actividad comercial reciente')).toBeInTheDocument()
  })
})

describe('cliente duplicado y reasignación', () => {
  it('el Vendedor B recibe el aviso al escribir la cédula, no puede registrarlo y pide la reasignación', async () => {
    const user = userEvent.setup()
    await abrir(vendB, '/clientes', <ClientesPage />)
    await user.click((await screen.findAllByRole('button', { name: /Nuevo cliente/ }))[0])
    const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dlg).getByLabelText('Primer nombre *'), 'Lucía')
    await user.type(within(dlg).getByLabelText('Primer apellido *'), 'Torres')
    await user.type(within(dlg).getByLabelText('Cédula, RUC o pasaporte'), '0915677082')
    await user.tab()
    const aviso = await within(dlg).findByRole('alert')
    expect(aviso).toHaveTextContent('Este cliente ya se encuentra registrado en AMURA y lo atiende otro vendedor.')
    expect(aviso).not.toHaveTextContent(/Carlos|0992222222/)
    expect(within(dlg).getByRole('button', { name: 'Registrar cliente' })).toBeDisabled()
    await user.click(within(dlg).getByRole('button', { name: 'Solicitar revisión o reasignación' }))
    await user.type(within(dlg).getByLabelText(/Por qué debes atender/), 'El cliente me escribió directamente por WhatsApp')
    await user.click(within(dlg).getByRole('button', { name: 'Enviar solicitud' }))
    expect(await within(dlg).findByText(/Solicitud enviada/)).toBeInTheDocument()
    expect(await uno(`select count(*)::int as n from public.clients where documento_clave = 'CI:0915677082'`)).toEqual({ n: 1 })
    expect(await uno(`select estado, asesor_actual from public.client_reassignment_requests`)).toEqual({ estado: 'pendiente', asesor_actual: vendA })
  })

  it('una cédula con dígitos mal escritos se avisa antes de guardar', async () => {
    const user = userEvent.setup()
    await abrir(vendA2, '/clientes', <ClientesPage />)
    await user.click((await screen.findAllByRole('button', { name: /Nuevo cliente/ }))[0])
    const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    await user.type(within(dlg).getByLabelText('Cédula, RUC o pasaporte'), '0915677083')
    expect(within(dlg).getByText(/La cédula 0915677083 no es válida/)).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Registrar cliente' })).toBeDisabled()
  })

  it('Gerencia la aprueba desde el Dashboard de equipo y la ficha muestra la trazabilidad', async () => {
    const user = userEvent.setup()
    const g = await abrir(gerente, '/equipo', <EquipoPage vista="dashboard" />)
    const fila = (await screen.findByText('El cliente me escribió directamente por WhatsApp')).closest('tr')!
    expect(within(fila).getByText('Lucía Torres')).toBeInTheDocument()
    await user.click(within(fila).getByRole('button', { name: 'Resolver' }))
    const d = await screen.findByRole('dialog', { name: /Reasignación de Lucía Torres/ })
    await user.type(within(d).getByLabelText(/Motivo de la decisión/), 'Confirmado con el cliente')
    await user.click(within(d).getByRole('button', { name: 'Aprobar reasignación' }))
    expect(await screen.findByText(/Solicitud aprobada: el cliente pasa a Beto Bravo/)).toBeInTheDocument()
    expect(await uno(`select asesor_id from public.clients where id = $1`, [lucia])).toEqual({ asesor_id: vendB })
    // La cotización conserva a quien la emitió.
    expect(await uno(`select created_by from public.quotes where client_id = $1`, [lucia])).toEqual({ created_by: vendA })
    g.unmount()

    await abrir(gerente, `/clientes?cliente=${lucia}`, <ClientesPage />)
    const traza = (await screen.findByRole('heading', { name: 'Responsable y trazabilidad' })).closest('section')!
    expect(within(traza).getByText('Beto Bravo')).toBeInTheDocument()
    expect(within(traza).getByText('Equipo Sur')).toBeInTheDocument()
    expect(within(traza).getByText('Carlos Pérez → Beto Bravo')).toBeInTheDocument()
    expect(within(traza).getByText(/Cotización .* Carlos Pérez/)).toBeInTheDocument()
  })
})

describe('el Supervisor también vende', () => {
  const venta = async (sup: string, nombre: string, documento: string, telefono: string, codigo: string) => {
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [codigo])
    const c = (await rpc<{ id: string }>(sup, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, documento, telefono, origen: 'whatsapp' }), sup])).id
    const op = (await rpc<{ id: string }>(sup, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
    const q = (await rpc<{ id: string }>(sup, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
    await rpc(sup, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [q])
    await rpc(sup, `select public.reservas_solicitar($1)`, [q])
    return c
  }
  let propioA: string

  beforeAll(async () => {
    propioA = await venta(supA, 'Cliente Propio Sara', cedulaPrueba(910001), '0994444444', 'E1-P1-A1')
    await venta(supB, 'Cliente Propio Saúl', cedulaPrueba(910002), '0995555555', 'E1-P1-A2')
  })

  it('cada supervisor vende con su propia cartera, asignada a él', async () => {
    expect(await uno(`select asesor_id from public.clients where id = $1`, [propioA])).toEqual({ asesor_id: supA })
    const cartera = async (sup: string) => (await como(db, sup, async () => (await db.query<{ nombre: string }>(`select nombre from public.clients order by nombre`)).rows)).map((r) => r.nombre)
    expect(await cartera(supA)).toContain('Cliente Propio Sara')
    expect(await cartera(supA)).not.toContain('Cliente Propio Saúl')
    expect(await cartera(supA)).not.toContain('Cliente del Sur')
    expect(await cartera(supB)).toEqual(expect.arrayContaining(['Cliente Propio Saúl', 'Cliente del Sur']))
    expect(await cartera(supB)).not.toContain('Cliente Propio Sara')
    expect(await cartera(supB)).not.toContain('Bruno Jerarquía')
  })

  it('el dashboard separa Mis ventas de Mi equipo y suma las propias una sola vez en el total', async () => {
    await abrir(supA, '/equipo', <EquipoPage vista="dashboard" />)
    const celdas = (fila: HTMLElement) => within(fila).getAllByRole('cell').slice(1, 8).map((c) => c.textContent)
    const mias = (await screen.findByText(/^Mis ventas · Sara Supervisora/)).closest('tr')!
    // Clientes, nuevos, cotizaciones, reservas, aprobadas, rechazadas, ventas.
    expect(celdas(mias)).toEqual(['1', '1', '1', '1', '0', '0', '0'])
    expect(screen.getByRole('heading', { name: 'Mis ventas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mi equipo' })).toBeInTheDocument()
    const total = screen.getByText('Total del equipo').closest('tr')!
    const vendedores = ['Carlos Pérez', 'Ana Andrade'].map((n) => celdas(screen.getByText(n).closest('tr')!).map(Number))
    expect(celdas(total).map(Number)).toEqual(celdas(mias).map((x, k) => Number(x) + vendedores[0][k] + vendedores[1][k]))
    expect(screen.queryByText(/Saúl/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Atender cliente' })).toHaveAttribute('href', '/venta')
  })

  it('en Mi equipo ve primero sus ventas y solo los vendedores de su propio equipo', async () => {
    await abrir(supB, `/mi-equipo?vendedor=${supB}`, <EquipoPage vista="detalle" />)
    const panel = await screen.findByRole('dialog', { name: 'Saúl Supervisor' })
    expect(await within(panel).findByRole('link', { name: 'Cliente Propio Saúl' })).toBeInTheDocument()
    cleanup()
    await abrir(supB, '/mi-equipo', <EquipoPage vista="detalle" />)
    expect(await screen.findByRole('button', { name: 'Ver gestión de Beto Bravo' })).toBeInTheDocument()
    expect(screen.queryByText('Sara Supervisora')).toBeNull()
    cleanup()
    await abrir(supB, `/mi-equipo?vendedor=${supA}`, <EquipoPage vista="detalle" />)
    expect(await screen.findByText('Ese vendedor no pertenece a tu equipo.')).toBeInTheDocument()
  })

  it('el equipo consolida a sus vendedores y las ventas propias del supervisor van aparte, sin duplicarse', async () => {
    await abrir(supA, '/mi-equipo', <EquipoPage vista="detalle" />)
    const norte = await screen.findByRole('region', { name: 'Equipo Norte' })
    expect(within(norte).getByRole('group', { name: 'Indicadores de Equipo Norte' }).textContent).toBe('Clientes1Cotizaciones1Reservas1Ventas0Vencidas0')
    expect(screen.getByRole('group', { name: 'Tus ventas propias' }).textContent).toBe('Clientes1Cotizaciones1Reservas1Ventas0Vencidas0')
  })

  it('no resuelve una reasignación de su propio cliente: la resuelve Gerencia', async () => {
    const sol = (await rpc<{ id: string }>(vendA, `select public.clientes_solicitar_reasignacion($1, null, null, 'Lo atendí primero en la feria') as id`, [cedulaPrueba(910001)])).id
    expect((await rpc<{ r: { id: string; puede_resolver: boolean }[] }>(supA, `select coalesce(json_agg(x), '[]') as r from public.clientes_reasignaciones() x`)).r.find((x) => x.id === sol)?.puede_resolver).toBe(false)
    await expect(rpc(supA, `select public.clientes_resolver_reasignacion($1, false, 'Es mi cliente')`, [sol])).rejects.toThrow(/Es tu propio cliente/)
    await rpc(gerente, `select public.clientes_resolver_reasignacion($1, false, 'Se queda con Sara')`, [sol])
    expect(await uno(`select estado from public.client_reassignment_requests where id = $1`, [sol])).toEqual({ estado: 'rechazada' })
  })
})
