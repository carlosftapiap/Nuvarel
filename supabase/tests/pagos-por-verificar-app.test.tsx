// @vitest-environment jsdom
// Bandeja de Finanzas: el comprobante que registra el vendedor aparece por verificar; Finanzas lo confirma con las reglas de siempre.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import PagosPorVerificarPage from '@/pages/PagosPorVerificarPage'
import { almacenPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario, prepararReservasParaPago } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, vera: string, finanzas: string
let reserva: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirComo(id: string) {
  const actor = await actorDe(id)
  render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter><PagosPorVerificarPage /></MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  finanzas = await crearUsuario(db, 'Fina Finanzas', 'finanzas', { alcance: 'empresa' })
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
  const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Bandeja', '1715000905', '0990000090', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-PB-A2', $2, $2) returning id`, [cli, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(`insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
    values ('COT-BJ-1', current_date, current_date + 30, 'E1-PB-A2', '{}', '{}', 0, 100000, 100000, '{"reserva": 6000, "reservaPct": 6, "meses": 10, "cuotaMensual": 1400, "ultimaCuota": 1400, "contraEntrega": 80000, "cuotasTotal": 14000}', $1, $2, $3) returning id`, [vera, cli, op])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  reserva = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
  await como(db, vera, () => db.query(`select public.reservas_fijar_monto($1, 500, 'Reserva acordada')`, [reserva]))
  await como(db, vera, () => db.query(`select public.reservas_reportar_pago($1::uuid, 500, (now() at time zone 'America/Guayaquil')::date, 'Banco Pichincha', 'TRF-BANDEJA-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'nombre', 'comprobante.pdf', 'mime', 'application/pdf', 'tamano', 10), 'transferencia')`, [reserva]))
}, 60_000)

describe('Pagos por verificar', () => {
  it('Finanzas ve el comprobante del vendedor, con reportado, confirmado y saldo por separado', async () => {
    await prepararReservasParaPago(db)
    await abrirComo(finanzas)
    const fila = (await screen.findByText('Cliente Bandeja')).closest('tr')!
    expect(within(fila).getByText(/Reserva RES-/)).toBeInTheDocument()
    const montos = within(fila).getAllByText(/\$/).map((x) => x.textContent)
    expect(montos).toEqual(['$500,00', '$0,00', '$500,00'])
    expect(within(fila).getByText('comprobante.pdf')).toBeInTheDocument()
    expect(within(fila).getByText('Por verificar')).toBeInTheDocument()
    expect(within(fila).getByRole('button', { name: 'Revisar pago' })).toBeInTheDocument()
  })

  it('el vendedor que lo registró no puede decidirlo', async () => {
    // El vendedor no tiene verificación: ni siquiera abre la bandeja.
    await abrirComo(vera)
    expect(await screen.findByText('Sin acceso a la verificación de pagos')).toBeInTheDocument()
  })

  it('Finanzas lo confirma desde la bandeja y desaparece de la lista', async () => {
    await prepararReservasParaPago(db)
    await abrirComo(finanzas)
    fireEvent.click(within((await screen.findByText('Cliente Bandeja')).closest('tr')!).getByRole('button', { name: 'Revisar pago' }))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(within(dlg).getByRole('checkbox'))
    await prepararReservasParaPago(db)
    fireEvent.click(within(dlg).getByRole('button', { name: /Confirmar/ }))
    expect(await screen.findByText('No hay pagos esperando verificación.')).toBeInTheDocument()
    expect((await db.query(`select estado from public.reservations where id = $1`, [reserva])).rows[0]).toEqual({ estado: 'pago_verificado' })
    expect((await db.query(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [reserva])).rows[0]).toEqual({ n: 1 })
  })
})
