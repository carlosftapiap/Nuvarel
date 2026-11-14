// @vitest-environment jsdom
// Captación de leads en pantalla: Configuración → Distribución de leads (solo administrador), ficha del cliente con
// «Contactar por WhatsApp» (el contacto se registra solo si se confirma) e indicadores con el alcance de cada perfil.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import PanelLeads from '@/features/leads/PanelLeads'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import ConfiguracionPage from '@/pages/ConfiguracionPage'
import { datosPglite } from './datos-pglite'
import { celularPrueba, como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, sup: string, ana: string, beto: string
let n = 993600000
const LUNES_10 = '2026-11-16T15:00:00Z'
// Domingo: nadie atiende, así cada lead queda pendiente y la prueba lo asigna a quien corresponde.
const DOMINGO = '2026-11-15T15:00:00Z'
const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const ingresar = async (extra: Record<string, unknown> = {}, ahora = LUNES_10) =>
  (await uno<{ r: { lead: string; estado: string } }>(`select public.leads_ingresar($1::jsonb, $2::timestamptz) as r`,
    [JSON.stringify({ fuente: 'facebook', nombre: `Prospecto Pantalla ${++n}`, telefono: celularPrueba(n), consentimiento: true, consentimiento_version: 'v1', campana: 'Lanzamiento', ...extra }), ahora])).r

async function abrir(id: string, pagina: ReactNode, url = '/') {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider initialState={createInitialState()}><ClientesProvider><ReservasProvider>
          <MemoryRouter initialEntries={[url]}>{pagina}</MemoryRouter>
        </ReservasProvider></ClientesProvider></InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('amura.clientes.vista', 'tabla')
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gina Gerencia', 'gerencia')
  sup = await crearUsuario(db, 'Sara Supervisora', 'supervisor')
  const eq = (await uno<{ id: string }>(`insert into public.teams (nombre, supervisor_id) values ('Equipo Norte', $1) returning id`, [sup])).id
  ana = await crearUsuario(db, 'Ana Vendedora', 'asesor', { equipo: eq })
  beto = await crearUsuario(db, 'Beto Vendedor', 'asesor', { equipo: eq })
}, 60_000)

describe('Configuración → Distribución de leads', () => {
  it('solo el administrador la ve; Gerencia no', async () => {
    await abrir(gerente, <ConfiguracionPage />, '/configuracion')
    await screen.findByRole('tab', { name: 'Usuarios' }).catch(() => null)
    expect(screen.queryByRole('tab', { name: 'Distribución de leads' })).toBeNull()
  })

  it('el administrador activa vendedores, define su horario y pausa, y asigna a mano un pendiente', async () => {
    const user = userEvent.setup()
    await abrir(admin, <ConfiguracionPage />, '/configuracion')
    await user.click(await screen.findByRole('tab', { name: 'Distribución de leads' }))
    const seccion = (await screen.findByRole('heading', { name: 'Distribución de leads' })).closest('section')!
    const filaAna = (await within(seccion).findByText('Ana Vendedora')).closest('tr')!
    expect(within(filaAna).getByText('No recibe leads')).toBeInTheDocument()
    expect(within(filaAna).getByText('Equipo Norte')).toBeInTheDocument()

    await user.click(within(filaAna).getByRole('checkbox', { name: 'Recibe leads: Ana Vendedora' }))
    expect(await within(seccion).findByText(/Ana Vendedora recibe leads cuando esté disponible/)).toBeInTheDocument()
    expect(await uno(`select activo, dias, hora_inicio::text from public.leads_participantes where user_id = $1`, [ana])).toEqual({ activo: true, dias: [1, 2, 3, 4, 5], hora_inicio: '09:00:00' })

    await user.click(within(seccion).getByRole('button', { name: 'Editar horario de Beto Vendedor' }))
    const dlg = await screen.findByRole('dialog', { name: 'Disponibilidad de Beto Vendedor' })
    await user.click(within(dlg).getByRole('checkbox', { name: 'Recibe leads' }))
    await user.click(within(dlg).getByRole('checkbox', { name: 'Sáb' }))
    await user.click(within(dlg).getByRole('checkbox', { name: /Pausar la recepción/ }))
    expect(within(dlg).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await user.type(within(dlg).getByLabelText('Motivo de la pausa *'), 'Capacitación de producto')
    await user.click(within(dlg).getByRole('button', { name: 'Guardar' }))
    expect(await within(seccion).findByText('Disponibilidad de Beto Vendedor guardada')).toBeInTheDocument()
    expect(await uno(`select activo, dias, pausado, pausa_motivo from public.leads_participantes where user_id = $1`, [beto]))
      .toEqual({ activo: true, dias: [1, 2, 3, 4, 5, 6], pausado: true, pausa_motivo: 'Capacitación de producto' })
    await waitFor(() => expect(within(within(seccion).getByText('Beto Vendedor').closest('tr')!).getByText('Pausado')).toBeInTheDocument())

    // Bandeja de pendientes: asignación manual con motivo. El lead llega un domingo (nadie atiende) y después de configurar:
    // al guardar, la base asigna los pendientes con la hora real, y la prueba no debe depender de ella.
    const pendiente = await ingresar({ nombre: 'Lead Sin Turno' }, DOMINGO)
    expect(pendiente.estado).toBe('pendiente')
    cleanup()
    await abrir(admin, <ConfiguracionPage />, '/configuracion')
    await user.click(await screen.findByRole('tab', { name: 'Distribución de leads' }))
    const bandeja = (await screen.findByRole('heading', { name: 'Distribución de leads' })).closest('section')!
    const item = (await within(bandeja).findByText('Lead Sin Turno')).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Asignar a…' }))
    const dm = await screen.findByRole('dialog', { name: 'Asignar a Lead Sin Turno' })
    await user.selectOptions(within(dm).getByLabelText('Vendedor *'), ana)
    await user.type(within(dm).getByLabelText('Motivo *'), 'Llegó fuera de horario')
    await user.click(within(dm).getByRole('button', { name: 'Asignar' }))
    expect(await within(bandeja).findByText('Lead de Lead Sin Turno asignado')).toBeInTheDocument()
    expect(await uno(`select estado, asignado_a, asignacion from public.leads where id = $1`, [pendiente.lead])).toEqual({ estado: 'asignado', asignado_a: ana, asignacion: 'manual' })
    expect(within(bandeja).queryByText('Lead Sin Turno')).toBeNull()
  })
})

describe('ficha del cliente', () => {
  it('muestra cómo llegó y abre WhatsApp; el contacto se registra solo al confirmarlo', async () => {
    const user = userEvent.setup()
    const r = await ingresar({ nombre: 'Lucía Prospecto', mensaje: 'Quiero un departamento de 2 dormitorios' }, DOMINGO)
    await rpc(admin, `select public.leads_asignar_manual($1, $2, 'Prueba de la ficha')`, [r.lead, ana])
    const l = await uno<{ client_id: string; estado: string }>(`select client_id, estado from public.leads where id = $1`, [r.lead])
    const tel = (await uno<{ telefono: string }>(`select telefono from public.clients where id = $1`, [l.client_id])).telefono

    await abrir(ana, <ClientesPage />, `/clientes?cliente=${l.client_id}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Prospecto/ })
    const captacion = (await within(ficha).findByRole('heading', { name: 'Captación' })).closest('section')!
    expect(within(captacion).getByText(/Facebook/)).toBeInTheDocument()
    expect(within(captacion).getByText('Quiero un departamento de 2 dormitorios')).toBeInTheDocument()
    expect(within(captacion).getByText('Sin primer contacto todavía')).toBeInTheDocument()

    await user.click(within(ficha).getByRole('button', { name: 'Contactar por WhatsApp' }))
    let dlg = await screen.findByRole('dialog', { name: 'Contactar por WhatsApp' })
    const enlace = within(dlg).getByRole('link', { name: 'Abrir WhatsApp' })
    expect(enlace.getAttribute('href')).toMatch(new RegExp(`^https://wa\\.me/${tel.slice(1)}\\?text=Hola%20Luc%C3%ADa`))
    expect(enlace).toHaveAttribute('target', '_blank')
    enlace.addEventListener('click', (e) => e.preventDefault())
    await user.click(enlace)
    await user.click(within(dlg).getByRole('button', { name: 'Todavía no' }))
    expect(await uno(`select count(*)::int as n from public.client_activities where client_id = $1 and tipo = 'mensaje'`, [l.client_id])).toEqual({ n: 0 })

    await user.click(within(ficha).getByRole('button', { name: 'Contactar por WhatsApp' }))
    dlg = await screen.findByRole('dialog', { name: 'Contactar por WhatsApp' })
    const otro = within(dlg).getByRole('link', { name: 'Abrir WhatsApp' })
    otro.addEventListener('click', (e) => e.preventDefault())
    await user.click(otro)
    await user.click(within(dlg).getByRole('button', { name: 'Sí, registrar el contacto' }))
    await waitFor(async () => expect(await uno(`select count(*)::int as n from public.client_activities where client_id = $1 and tipo = 'mensaje'`, [l.client_id])).toEqual({ n: 1 }))
    await waitFor(async () => expect((await uno<{ p: string | null }>(`select primer_contacto_en as p from public.leads where id = $1`, [r.lead])).p).not.toBeNull())
    expect(await uno(`select proxima_descripcion from public.clients where id = $1`, [l.client_id])).toEqual({ proxima_descripcion: null })
  })
})

describe('indicadores por perfil', () => {
  it('el administrador ve el proyecto completo; el vendedor, solo sus prospectos por contactar', async () => {
    const user = userEvent.setup()
    const a = await ingresar({ nombre: 'Para Ana', fuente: 'instagram', campana: 'Historias' }, DOMINGO)
    await rpc(admin, `select public.leads_asignar_manual($1, $2, 'Indicadores de prueba')`, [a.lead, ana])
    const b = await ingresar({ nombre: 'Para Beto', campana: 'Lanzamiento' }, DOMINGO)
    await rpc(admin, `select public.leads_asignar_manual($1, $2, 'Indicadores de prueba')`, [b.lead, beto])

    await abrir(admin, <PanelLeads />)
    const panel = await screen.findByRole('region', { name: 'Captación de leads' })
    await user.click(within(panel).getByRole('button', { name: 'Todo' }))
    const recibidos = (await uno<{ n: number }>(`select count(*)::int as n from public.leads`)).n
    expect(within(panel).getByText('Leads recibidos').parentElement).toHaveTextContent(String(recibidos))
    expect(within(panel).getByText('Instagram')).toBeInTheDocument()
    expect(within(panel).getByText('Historias')).toBeInTheDocument()
    expect(within(panel).getByText('Beto Vendedor')).toBeInTheDocument()
    cleanup()

    await abrir(ana, <PanelLeads />)
    const propio = await screen.findByRole('region', { name: 'Tus prospectos' })
    await user.click(within(propio).getByRole('button', { name: 'Todo' }))
    expect(within(propio).getByRole('link', { name: /Para Ana/ })).toHaveAttribute('href', expect.stringMatching(/^\/clientes\?cliente=/))
    expect(within(propio).queryByText('Para Beto')).toBeNull()
    expect(within(propio).queryByText('Beto Vendedor')).toBeNull()
    cleanup()

    await abrir(sup, <PanelLeads />)
    const equipo = await screen.findByRole('region', { name: 'Leads de tu equipo' })
    await user.click(within(equipo).getByRole('button', { name: 'Todo' }))
    expect(within(equipo).getByText('Ana Vendedora')).toBeInTheDocument()
    expect(within(equipo).getByText('Beto Vendedor')).toBeInTheDocument()
  })
})
