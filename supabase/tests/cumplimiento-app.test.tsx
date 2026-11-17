// @vitest-environment jsdom
// Fase 3 en pantalla: Legal arma el expediente y lo envía; Cumplimiento revisa y aprueba; recién entonces se registra la firma.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import VentasPage from '@/pages/VentasPage'
import { almacenPrueba, archivoPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, oficial: string, carlos: string
const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirFicha(id: string) {
  const actor = await actorDe(id)
  const r = render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider>
          <MemoryRouter><VentasPage almacen={almacenPrueba} /></MemoryRouter>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('row', { name: /Abrir CON-/ }))
  const f = await screen.findByRole('dialog', { name: /CON-/ })
  await within(f).findByText(/Cédula de identidad/)
  return { r, f, user }
}

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  oficial = await crearUsuario(db, 'Olga Cumplimiento', 'oficial_cumplimiento')
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, '{"nombre": "Andrea Mora", "documento": "1712345675", "telefono": "0995556677", "origen": "corredor", "origen_detalle": "Carlos Corredor", "forma_pago": "banco"}'::jsonb, $1) as id`, [carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [c])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const reserva = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [reserva])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-1', true, 'Ingreso confirmado')`, [reserva, m.monto_reserva, hoyGuayaquil()])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [reserva])
  await rpc(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [reserva, hoyGuayaquil()])
}, 60_000)

describe('Cumplimiento en Ventas y contratos', () => {
  it('Legal carga los documentos obligatorios y envía el expediente; la firma sigue bloqueada', async () => {
    const { r, f, user } = await abrirFicha(legal)
    expect(within(f).getAllByText('Sin enviar a Cumplimiento').length).toBeGreaterThan(0)
    expect(within(f).getByRole('button', { name: /Registrar firma/ })).toBeDisabled()
    expect(within(f).getByRole('button', { name: 'Enviar a Cumplimiento' })).toBeDisabled()
    for (let i = 0; i < 5; i++) {
      await user.click(within(f).getAllByRole('button', { name: 'Cargar' })[0])
      const d = await screen.findByRole('dialog', { name: /^Cargar / })
      await user.upload(within(d).getByLabelText(/Documento \*/), archivoPrueba())
      await user.click(within(d).getByRole('button', { name: 'Guardar' }))
      await vi.waitFor(() => expect(within(f).queryAllByRole('button', { name: 'Cargar' })).toHaveLength(4 - i))
    }
    expect((await q<{ n: number }>(`select count(*)::int as n from public.expediente_documentos where estado = 'cargado'`)).n).toBe(5)
    await user.click(within(f).getByRole('button', { name: 'Enviar a Cumplimiento' }))
    const d = await screen.findByRole('dialog', { name: 'Enviar a Cumplimiento' })
    await user.click(within(d).getByRole('button', { name: 'Enviar' }))
    expect((await within(f).findAllByText('En revisión de Cumplimiento')).length).toBeGreaterThan(0)
    expect(within(f).getByRole('button', { name: /Registrar firma/ })).toBeDisabled()
    r.unmount()
  })

  it('Finanzas ve el estado, pero no descarga ni carga documentos', async () => {
    const { r, f } = await abrirFicha(finanzas)
    expect(within(f).getAllByText('En revisión de Cumplimiento').length).toBeGreaterThan(0)
    expect(within(f).queryByRole('button', { name: /Descargar/ })).toBeNull()
    expect(within(f).queryByRole('button', { name: /Cargar|Reemplazar/ })).toBeNull()
    expect(within(f).queryByRole('button', { name: 'Resolver revisión' })).toBeNull()
    r.unmount()
  })

  it('Cumplimiento descarga el expediente (con auditoría), aprueba cada documento y resuelve', async () => {
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { r, f, user } = await abrirFicha(oficial)
    await user.click(within(f).getByRole('button', { name: /Descargar todo/ }))
    await vi.waitFor(() => expect(clic).toHaveBeenCalledTimes(5))
    expect((await q<{ n: number }>(`select count(*)::int as n from public.audit_log where accion = 'Descargar documento del expediente' and actor_id = $1`, [oficial])).n).toBe(5)
    clic.mockRestore()
    for (let i = 0; i < 5; i++) {
      await user.click(within(f).getAllByRole('button', { name: 'Revisar' })[0])
      const d = await screen.findByRole('dialog', { name: /^Revisar / })
      await user.click(within(d).getByRole('button', { name: 'Guardar revisión' }))
      await vi.waitFor(() => expect(within(f).queryAllByRole('button', { name: 'Revisar' })).toHaveLength(4 - i))
    }
    await user.click(within(f).getByRole('button', { name: 'Resolver revisión' }))
    const d = await screen.findByRole('dialog', { name: 'Resolver revisión de Cumplimiento' })
    await user.click(within(d).getByRole('button', { name: 'Guardar resolución' }))
    expect((await within(f).findAllByText('Aprobado por Cumplimiento')).length).toBeGreaterThan(0)
    expect(within(f).queryByRole('button', { name: /Registrar firma/ })).toBeNull()
    r.unmount()
  })

  it('con la aprobación, Legal ya puede registrar la firma', async () => {
    const { r, f } = await abrirFicha(legal)
    await vi.waitFor(() => expect(within(f).getByRole('button', { name: /Registrar firma/ })).toBeEnabled())
    expect(within(f).getAllByText(/Olga Cumplimiento/).length).toBeGreaterThan(0)
    r.unmount()
  })
})
