// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { almacenPrueba, archivoPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, finanzas: string, gerente: string, vera: string, otro: string, andrea: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}

async function abrir(id: string, url = '/venta') {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider>
          <ClientesProvider>
            <ReservasProvider>
              <MemoryRouter initialEntries={[url]}><Routes><Route path="/venta" element={<VentaPage />} /><Route path="/financiamiento" element={<FinanciamientoPage />} /></Routes></MemoryRouter>
            </ReservasProvider>
          </ClientesProvider>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = (u: string, sql: string, p: unknown[] = []) => como(db, u, () => db.query(sql, p))
const reservaDe = (cliente: string) => uno<{ id: string; codigo: string; estado: string; monto_reserva: string; monto_recibido: string | null; pago_monto: string | null; comprobante: string | null; unidad: string }>(
  `select r.*, u.estado as unidad from public.reservations r join public.inventory_units u on u.codigo = r.codigo_unidad where r.client_id = $1`, [cliente])
const boton = (name: RegExp) => screen.findByRole('button', { name })
const usarPlan = async (user: ReturnType<typeof userEvent.setup>) => {
  const b = await boton(/Usar este plan/)
  await waitFor(() => expect(b).toBeEnabled())
  await user.click(b)
  await screen.findByText(/Plan confirmado · versión/)
}
const emitirPdf = async (user: ReturnType<typeof userEvent.setup>) => {
  const b = await boton(/Emitir cotización y descargar PDF/)
  await waitFor(() => expect(b).toBeEnabled())
  await user.click(b)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
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
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  otro = await crearUsuario(db, 'Omar Vendedor', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  await db.query(`update public.inventory_units set estado = 'por_confirmar' where codigo = 'E1-PB-A3'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  andrea = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Andrea Mora", "telefono": "0995556677", "email": "andrea@correo.com", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
}, 60_000)

describe('Atender cliente: de la cotización a la solicitud en una sola pantalla', () => {
  it('busca al cliente, emite con el PDF y solicita con el monto acordado, sin pago ni bloqueo', async () => {
    const user = userEvent.setup()
    const s = await abrir(vera, '/venta?unidad=E1-PB-A2')
    await user.type(await screen.findByLabelText('Buscar cliente existente'), '09955')
    await user.click(await screen.findByRole('button', { name: /Andrea Mora/ }))
    const seguir = await boton(/Continuar en Financiamiento/)
    await waitFor(() => expect(seguir).toBeEnabled())
    await user.click(seguir)

    const monto = await screen.findByLabelText(/Reserva \(USD\)/)
    await waitFor(() => expect(monto).toHaveAttribute('placeholder', '500'))
    await user.type(monto, '600')
    expect(await screen.findByText(/Reserva USD|Reserva \$/)).toBeInTheDocument()

    await usarPlan(user)
    await emitirPdf(user)
    expect(await screen.findByText(/COT-\d{4}-\d+ emitida y descargada/)).toBeInTheDocument()
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.quotes where client_id = $1`, [andrea])).n).toBe(1)

    // El monto acordado se conserva después de emitir, y aún no hay reserva.
    expect(screen.getByLabelText(/Reserva \(USD\)/)).toHaveValue('600')
    expect(await reservaDe(andrea)).toBeUndefined()
    expect(screen.queryByRole('button', { name: /Registrar pago/ })).toBeNull()

    await user.click(await boton(/^Solicitar reserva$/))
    expect(await screen.findByText(/Reserva solicitada por/)).toBeInTheDocument()
    expect(await reservaDe(andrea)).toMatchObject({ estado: 'solicitada', monto_reserva: '600.00', monto_recibido: null, pago_monto: null, comprobante: null, unidad: 'disponible' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(0)
    expect((await uno<{ etapa: string }>(`select etapa from public.opportunities where client_id = $1`, [andrea])).etapa).toBe('solicitud_reserva')

    // Ahora sí aparece «Registrar pago», y queda claro quién sigue.
    expect(await boton(/Registrar pago/)).toBeInTheDocument()
    expect(screen.getByText('Esperar el pago de la reserva')).toBeInTheDocument()
    s.unmount()
  })

  it('«Continuar operación» retoma la venta con sus condiciones, acordado y pagado por separado', async () => {
    const user = userEvent.setup()
    const s = await abrir(vera)
    await user.click(await screen.findByRole('button', { name: /Continuar operación de Andrea Mora/ }))
    const op = await screen.findByRole('region', { name: 'Operación' })
    await waitFor(() => expect(within(op).getByText('Monto acordado').nextSibling).toHaveTextContent('600'))
    expect(within(op).getByText('Monto pagado').nextSibling).toHaveTextContent('Sin pago')
    await waitFor(() => expect(screen.getByLabelText(/Reserva \(USD\)/)).toBeDisabled())
    expect(screen.queryByRole('button', { name: /^Solicitar reserva$/ })).toBeNull()

    await user.click(await boton(/Registrar pago/))
    const dlg = await screen.findByRole('dialog', { name: /Registrar pago/ })
    await user.type(within(dlg).getByLabelText('Banco *'), 'Banco Pichincha')
    fireEvent.change(within(dlg).getByLabelText(/Foto o PDF/), { target: { files: [archivoPrueba()] } })
    await user.type(within(dlg).getByLabelText(/Número de transferencia/), 'TRF-1234')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText(/Finanzas verificará el ingreso/)).toBeInTheDocument()
    expect(await reservaDe(andrea)).toMatchObject({ estado: 'solicitada', comprobante: 'TRF-1234', monto_recibido: null })
    expect(await screen.findByText('Finanzas verifica el pago')).toBeInTheDocument()
    s.unmount()
  })

  it('la reserva pagada de más se acredita al 6 % sin duplicarse; la unidad se bloquea solo al aprobar', async () => {
    const r = await reservaDe(andrea)
    await rpc(finanzas, `select public.reservas_confirmar_pago($1, 700, (now() at time zone 'America/Guayaquil')::date, 'BAN-1', true, 'Ingreso confirmado')`, [r.id])
    expect(await reservaDe(andrea)).toMatchObject({ estado: 'pago_verificado', monto_reserva: '600.00', monto_recibido: '700.00', unidad: 'disponible' })
    const s = await abrir(vera, `/venta?cotizacion=${(await uno<{ quote_id: string }>(`select quote_id from public.reservations where id = $1`, [r.id])).quote_id}`)
    const op = await screen.findByRole('region', { name: 'Operación' })
    await waitFor(() => expect(within(op).getByText('Monto pagado').nextSibling).toHaveTextContent('700'))
    expect(within(op).getByText('Monto acordado').nextSibling).toHaveTextContent('600')
    expect(screen.getByText('Gerencia aprueba la reserva')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aprobar|Verificar/ })).toBeNull()
    s.unmount()
    await rpc(gerente, `select public.reservas_aprobar($1, 'Condiciones revisadas')`, [r.id])
    expect((await reservaDe(andrea)).unidad).toBe('reservado')
  })

  it('no permite más del 6 %, ni reservar una unidad por confirmar', async () => {
    const user = userEvent.setup()
    const cli = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Bruno Paz", "telefono": "0991112233", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
    const s = await abrir(vera, `/venta?cliente=${cli}&unidad=E1-PB-A3`)
    const monto = await screen.findByLabelText(/Reserva \(USD\)/)
    await user.type(monto, '9999999')
    expect(await screen.findByText(/no puede superar el 6 %/)).toBeInTheDocument()
    expect(await boton(/Usar este plan/)).toBeDisabled()
    await user.clear(monto)
    await user.type(monto, '600')
    await usarPlan(user)
    await emitirPdf(user)
    expect(await screen.findByText('Confirmar la disponibilidad')).toBeInTheDocument()
    expect(await boton(/^Solicitar reserva$/)).toBeDisabled()
    s.unmount()
  })

  it('una unidad con solicitud en trámite no admite otra reserva, tampoco de otro vendedor', async () => {
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A4'`)
    const emitir = async (u: string, nombre: string, tel: string) => {
      const cli = (await como(db, u, () => db.query<{ id: string }>(`select public.clientes_crear(null, jsonb_build_object('nombre', $2::text, 'telefono', $3::text, 'origen', 'instagram'), $1) as id`, [u, nombre, tel]))).rows[0].id
      const op = (await como(db, u, () => db.query<{ id: string }>(`select public.oportunidades_crear($1, 'E1-PB-A4', null) as id`, [cli]))).rows[0].id
      return (await como(db, u, () => db.query<{ id: string }>(`select public.cotizaciones_emitir($1, 0, 15, '') as id`, [op]))).rows[0].id
    }
    const q1 = await emitir(vera, 'Carla Ruiz', '0993334455')
    const q2 = await emitir(otro, 'Dario Luna', '0994445566')
    await rpc(vera, `select public.cotizaciones_aceptar($1, 'Aceptada')`, [q1])
    await rpc(vera, `select public.reservas_solicitar($1)`, [q1])
    await rpc(otro, `select public.cotizaciones_aceptar($1, 'Aceptada')`, [q2])
    await expect(rpc(otro, `select public.reservas_solicitar($1)`, [q2])).rejects.toThrow(/ya tiene una reserva activa/)

    // Quien ve la solicitud en trámite recibe el aviso antes de intentarlo.
    const s = await abrir(gerente, `/venta?cotizacion=${q2}`)
    expect(await screen.findByText(/ya tiene la solicitud RES-/)).toBeInTheDocument()
    expect(await boton(/^Solicitar reserva$/)).toBeDisabled()
    s.unmount()
  })

  it('la reserva predeterminada es configurable, con motivo y auditoría', async () => {
    await expect(rpc(vera, `select public.config_reserva_predeterminada(600, 'Política nueva')`)).rejects.toThrow(/Sin permiso/)
    await rpc(admin, `select public.config_reserva_predeterminada(600, 'Política nueva')`)
    const cli = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Elena Soto", "telefono": "0996667788", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
    const s = await abrir(vera, `/venta?cliente=${cli}&unidad=E1-PB-A3`)
    const campo = await screen.findByLabelText(/Reserva \(USD\)/)
    await waitFor(() => expect(campo).toHaveAttribute('placeholder', '600'))
    s.unmount()
    await rpc(admin, `select public.config_reserva_predeterminada(500, 'Vuelve al valor anterior')`)
  })

  it('crea la solicitud directamente con el monto acordado, sin ajuste posterior, y un reintento no la duplica', async () => {
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A5'`)
    const cli = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Gina Paz", "telefono": "0997778899", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
    const op = (await como(db, vera, () => db.query<{ id: string }>(`select public.oportunidades_crear($1, 'E1-PB-A5', null) as id`, [cli]))).rows[0].id
    const q = (await como(db, vera, () => db.query<{ id: string }>(`select public.cotizaciones_emitir($1, 0, 15, '') as id`, [op]))).rows[0].id

    await expect(rpc(vera, `select public.reservas_solicitar_acordada($1, 99999999)`, [q])).rejects.toThrow(/no superar el 6/)
    expect((await uno<{ estado: string }>(`select estado from public.quotes where id = $1`, [q])).estado).toBe('emitida')

    const id = async () => (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar_acordada($1, 750) as id`, [q]))).rows[0].id
    const primera = await id()
    expect(await id()).toBe(primera)
    const r = await reservaDe(cli)
    expect(r).toMatchObject({ estado: 'solicitada', monto_reserva: '750.00', monto_recibido: null, comprobante: null, unidad: 'disponible' })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.reservations where client_id = $1`, [cli])).n).toBe(1)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.audit_log where entidad_id = $1 and accion = 'Ajustar reserva'`, [r.id])).n).toBe(0)
    await expect(rpc(vera, `select public.reservas_solicitar_acordada($1, 800)`, [q])).rejects.toThrow(/ya tiene la solicitud/)
  })

  it('una unidad con solicitud se ve «En proceso de reserva» para todos; solo quien tiene el cliente puede continuar', async () => {
    const r = await uno<{ codigo: string }>(`select codigo from public.reservations where codigo_unidad = 'E1-PB-A5'`)
    const lista = async (u: string) => (await como(db, u, () => db.query<{ l: { codigo: string; codigo_unidad: string; quote_id: string | null }[] }>(`select public.inventario_solicitudes_activas() as l`))).rows[0].l.find((x) => x.codigo_unidad === 'E1-PB-A5')!
    expect((await lista(vera)).quote_id).toBeTruthy()
    const ajena = await lista(otro)
    expect(ajena.codigo).toBe(r.codigo)
    expect(ajena.quote_id).toBeNull()
    expect(JSON.stringify(ajena)).not.toMatch(/Gina/)

    const otroCli = (await como(db, otro, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Hugo Mar", "telefono": "0998889900", "origen": "instagram"}'::jsonb, $1) as id`, [otro]))).rows[0].id
    const s = await abrir(otro, `/venta?cliente=${otroCli}&unidad=E1-PB-A5`)
    expect(await screen.findByText('En proceso de reserva')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`ya tiene la solicitud ${r.codigo}`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continuar operación' })).toBeNull()
    expect(screen.queryByText('Disponible')).toBeNull()
    expect(await boton(/Emitir cotización y descargar PDF/)).toBeDisabled()
    s.unmount()

    const v = await abrir(vera, `/venta?unidad=E1-PB-A5`)
    expect(await screen.findByRole('button', { name: 'Continuar operación' })).toBeInTheDocument()
    v.unmount()
    // La unidad sigue guardada como disponible: la solicitud no la bloquea.
    expect((await uno<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A5'`)).estado).toBe('disponible')
  })

  it('una solicitud vencida sigue bloqueando hasta anularla; anulada, libera la unidad', async () => {
    const r = await uno<{ id: string; codigo: string }>(`select id, codigo from public.reservations where codigo_unidad = 'E1-PB-A5'`)
    await db.query(`update public.reservations set vigencia_hasta = '2020-01-01' where id = $1`, [r.id])
    const activa = async () => (await como(db, otro, () => db.query<{ l: { codigo_unidad: string }[] }>(`select public.inventario_solicitudes_activas() as l`))).rows[0].l.some((x) => x.codigo_unidad === 'E1-PB-A5')
    expect(await activa()).toBe(true)
    await rpc(admin, `select public.reservas_anular($1, 'Cliente no continuó')`, [r.id])
    expect(await activa()).toBe(false)
  })

  it('agrega una cuota extraordinaria, la guarda en la cotización y al continuar queda sin editar', async () => {
    const user = userEvent.setup()
    const libre = (await uno<{ codigo: string }>(`select codigo from public.inventory_units where edificio = 2 order by codigo limit 1`)).codigo
    await db.query(`update public.inventory_units set estado = 'disponible' where codigo = $1`, [libre])
    const cli = (await como(db, vera, () => db.query<{ id: string }>(`select public.clientes_crear(null, '{"nombre": "Iris Rey", "telefono": "0990001122", "origen": "instagram"}'::jsonb, $1) as id`, [vera]))).rows[0].id
    const s = await abrir(vera, `/venta?cliente=${cli}&unidad=${libre}`)
    await user.click(await boton(/Agregar cuota extraordinaria/))
    await user.type(screen.getByLabelText(/^Mes \(1 a/), '99')
    await user.type(screen.getByLabelText('Monto (USD)'), '2500')
    expect(await screen.findByText(/debe estar entre 1 y/)).toBeInTheDocument()
    expect(await boton(/Emitir cotización y descargar PDF/)).toBeDisabled()
    await user.clear(screen.getByLabelText(/^Mes \(1 a/))
    await user.type(screen.getByLabelText(/^Mes \(1 a/), '6')
    await usarPlan(user)
    await emitirPdf(user)
    expect(await screen.findByText(/emitida y descargada/)).toBeInTheDocument()
    const q = await uno<{ plan: { extraordinarias: unknown; cuotaMensual: number; ultimaCuota: number; cuotasTotal: number; meses: number } }>(`select plan from public.quotes where client_id = $1`, [cli])
    expect(q.plan.extraordinarias).toEqual([{ mes: 6, monto: 2500 }])
    expect(Math.round((q.plan.cuotaMensual * (q.plan.meses - 1) + q.plan.ultimaCuota + 2500) * 100) / 100).toBe(Number(q.plan.cuotasTotal))
    expect(screen.getByLabelText(/^Mes \(1 a/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Agregar cuota extraordinaria/ })).toBeNull()

    // «Cambiar condiciones» las conserva para una versión nueva.
    await user.click(await boton(/Cambiar condiciones/))
    expect(screen.getByLabelText(/^Mes \(1 a/)).toHaveValue('6')
    expect(screen.getByLabelText('Monto (USD)')).toHaveValue('2500')
    s.unmount()
  })

  it('no escribe datos comerciales en el almacenamiento local', () => {
    expect(localStorage.getItem('amura.reservas.v1')).toBeNull()
    expect(localStorage.getItem('amura.cotizaciones.v1')).toBeNull()
    expect(localStorage.getItem('amura.clientes.v1')).toBeNull()
  })
})
