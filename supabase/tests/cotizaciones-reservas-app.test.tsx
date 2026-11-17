// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import CotizacionesPage from '@/pages/CotizacionesPage'
import ReservasPage from '@/pages/ReservasPage'
import { almacenPrueba, archivoPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario, prepararReservasParaPago } from './db'

// Cada pantalla lee varias tablas de Postgres real; con toda la suite en paralelo tarda más que la espera por defecto.
configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, cora: string, carlos: string, cliente: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}

/** Muestra a dónde llevó la navegación (p. ej. el recorrido de Atender cliente). */
function Ubicacion() {
  const l = useLocation()
  return <p>{l.pathname + l.search}</p>
}

/** Emite como el recorrido único (Atender cliente → Financiamiento): abre o reutiliza la negociación y emite. */
async function emitirComo(usuario: string, vigenciaDias: number) {
  const d = datosPglite(db, usuario)
  const oportunidad = await d.rpc<string>('oportunidades_crear', { p_client: cliente, p_unidad: 'E1-PB-A2', p_tipologia: null })
  return d.rpc<string>('cotizaciones_emitir', { p_opportunity: oportunidad, p_descuento_pct: 0, p_vigencia_dias: vigenciaDias, p_observaciones: '' })
}

async function abrirComo(id: string, url: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider>
          <ClientesProvider>
            <ReservasProvider>
              <MemoryRouter initialEntries={[url]}>
                <Routes>
                  <Route path="/clientes" element={<ClientesPage />} />
                  <Route path="/cotizaciones" element={<CotizacionesPage />} />
                  <Route path="/reservas" element={<ReservasPage />} />
                  <Route path="/venta" element={<Ubicacion />} />
                </Routes>
              </MemoryRouter>
            </ReservasProvider>
          </ClientesProvider>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const estado = () => uno<{ reserva: string; unidad: string; etapa: string }>(
  `select r.estado as reserva, u.estado as unidad, c.etapa from public.reservations r join public.inventory_units u on u.codigo = r.codigo_unidad join public.clients c on c.id = r.client_id where r.client_id = $1`, [cliente])

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL ??= vi.fn(() => 'blob:x')
  URL.revokeObjectURL ??= vi.fn()
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Finanzas', 'finanzas', { alcance: 'empresa' })
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
  cliente = (await como(db, cora, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Andrea Mora", "documento": "1712345675", "telefono": "0995556677", "email": "andrea@correo.com", "origen": "instagram"}'::jsonb, $1) as id`, [cora]))).rows[0].id
}, 60_000)

describe('Cotizaciones y Reservas sobre la misma base de datos', () => {
  it('cotizar abre el recorrido único; la emisión usa los datos de la ficha y una sola negociación', async () => {
    // Cotizaciones es historial: un enlace para cotizar lleva a Atender cliente con el cliente y el departamento.
    const s = await abrirComo(cora, `/cotizaciones?cliente=${cliente}&unidad=E1-PB-A2`)
    expect(await screen.findByText(`/venta?cliente=${cliente}&unidad=E1-PB-A2`)).toBeInTheDocument()
    s.unmount()

    await emitirComo(cora, 15)
    const q = await uno<{ client_id: string; opportunity_id: string; estado: string; cliente: { documento: string }; precio_final: string }>(`select * from public.quotes where client_id = $1`, [cliente])
    expect(q).toMatchObject({ client_id: cliente, estado: 'emitida', cliente: { documento: '1712345675' } })
    expect(q.opportunity_id).toBeTruthy()
    expect((await uno<{ etapa: string }>(`select etapa from public.clients where id = $1`, [cliente])).etapa).toBe('cotizacion')

    // Una segunda cotización usa la misma negociación.
    await emitirComo(cora, 30)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.opportunities where client_id = $1`, [cliente])).n).toBe(1)
    expect((await uno<{ n: number; v: number }>(`select count(*)::int as n, max(version)::int as v from public.quotes where client_id = $1`, [cliente]))).toEqual({ n: 2, v: 2 })

    // El historial muestra ambas, con su PDF, y no escribe nada en el navegador.
    const h = await abrirComo(cora, '/cotizaciones')
    expect(await screen.findByRole('button', { name: /Descargar COT-\d{4}-0001/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Descargar COT-\d{4}-0002/ })).toBeInTheDocument()
    expect(localStorage.getItem('amura.cotizaciones.v1')).toBeNull()
    h.unmount()
  })

  it('un enlace para cotizar solo un departamento abre Atender cliente, donde se elige al cliente registrado', async () => {
    await abrirComo(cora, '/cotizaciones?unidad=E1-PB-A2')
    expect(await screen.findByText('/venta?unidad=E1-PB-A2')).toBeInTheDocument()
  })

  it('otro corredor no ve las cotizaciones ni las reservas de ese cliente', async () => {
    await abrirComo(carlos, '/cotizaciones')
    expect(await screen.findByText('Aún no hay cotizaciones.')).toBeInTheDocument()
    expect(screen.queryByText(/Andrea Mora/)).not.toBeInTheDocument()
  })

  it('el corredor solicita la reserva: no bloquea la unidad ni cambia al cliente a Reserva', async () => {
    const user = userEvent.setup()
    const s = await abrirComo(cora, '/cotizaciones')
    const boton = await screen.findAllByRole('button', { name: /Cliente acepta: solicitar reserva/ })
    await user.click(boton[0])
    expect(await screen.findByText(/Solicitud de reserva creada/)).toBeInTheDocument()
    expect(await estado()).toEqual({ reserva: 'solicitada', unidad: 'disponible', etapa: 'cotizacion' })
    s.unmount()
  })

  it('Finanzas no puede verificar sin comprobante; el corredor lo registra', async () => {
    const user = userEvent.setup()
    await prepararReservasParaPago(db)
    const f = await abrirComo(finanzas, '/reservas')
    expect(await screen.findByText('Falta el comprobante')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Verificar pago/ })).not.toBeInTheDocument()
    f.unmount()

    const s = await abrirComo(cora, '/reservas')
    await user.click(await screen.findByRole('button', { name: /Registrar pago/ }))
    const dlg = await screen.findByRole('dialog', { name: /Registrar pago/ })
    await user.type(within(dlg).getByLabelText('Banco *'), 'Banco Pichincha')
    fireEvent.change(within(dlg).getByLabelText(/Foto o PDF/), { target: { files: [archivoPrueba()] } })
    await user.type(within(dlg).getByLabelText(/Número de transferencia/), 'TRF-778899')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText(/Pago de RES-.* registrado/)).toBeInTheDocument()
    expect((await estado()).reserva).toBe('solicitada')
    // El corredor no ve botones de verificar ni aprobar.
    expect(screen.queryByRole('button', { name: /Verificar pago/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument()
    s.unmount()
  })

  it('Finanzas verifica el ingreso y la reserva normal se confirma sola: reserva, unidad y cliente cambian juntos', async () => {
    const user = userEvent.setup()
    await prepararReservasParaPago(db)
    const f = await abrirComo(finanzas, '/reservas')
    await user.click(await screen.findByRole('button', { name: /Verificar pago/ }))
    const dlg = await screen.findByRole('dialog', { name: /Verificar pago/ })
    expect(within(dlg).getByLabelText(/Comprobante/)).toHaveValue('TRF-778899')
    const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where client_id = $1`, [cliente])
    await user.type(within(dlg).getByLabelText(/Monto recibido/), String(m.monto_reserva).replace('.', ','))
    await user.click(within(dlg).getByLabelText(/Verifiqué el ingreso/))
    await prepararReservasParaPago(db)
    await user.click(within(dlg).getByRole('button', { name: 'Verificar ingreso' }))
    expect(await screen.findByText(/verificado · reserva confirmada y unidad reservada/)).toBeInTheDocument()
    expect(await estado()).toEqual({ reserva: 'confirmada', unidad: 'reservado', etapa: 'reserva' })
    f.unmount()

    // Sin excepciones, Gerencia no tiene nada que autorizar.
    const g = await abrirComo(gerente, '/reservas')
    await screen.findByText('Excepciones por autorizar')
    expect(screen.queryByRole('button', { name: /Autorizar excepción/ })).not.toBeInTheDocument()
    g.unmount()
  })

  it('Clientes muestra la misma etapa, y el asesor no la puede cambiar', async () => {
    await abrirComo(cora, `/clientes?cliente=${cliente}`)
    const ficha = await screen.findByRole('dialog', { name: /Andrea Mora/ })
    expect(within(ficha).getByRole('button', { name: 'Reserva' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(ficha).getByRole('button', { name: 'Negociación' })).toBeDisabled()
    // La cotización queda en el historial (Actividad) y la negociación aprobada, en Operaciones.
    await userEvent.click(within(ficha).getByRole('tab', { name: 'Actividad' }))
    expect(within(ficha).getByText(/COT-\d{4}-0001 · E1-PB-A2/)).toBeInTheDocument()
    await userEvent.click(within(ficha).getByRole('tab', { name: 'Operaciones' }))
    expect(within(ficha).getByText('Reserva aprobada')).toBeInTheDocument()
  })

  it('ninguna de estas pantallas escribió en el almacenamiento local', () => {
    expect(localStorage.getItem('amura.reservas.v1')).toBeNull()
    expect(localStorage.getItem('amura.cotizaciones.v1')).toBeNull()
    expect(localStorage.getItem('amura.clientes.v1')).toBeNull()
  })
})
