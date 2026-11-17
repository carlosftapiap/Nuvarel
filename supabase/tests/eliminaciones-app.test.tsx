// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import EliminacionesAdmin from '@/features/config/remoto/EliminacionesAdmin'
import { almacenPrueba, datosPglite } from './datos-pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, vera: string, reserva: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Pantalla', 'administrador')
  vera = await crearUsuario(db, 'Vera Pantalla', 'asesor')
  const hoy = (await db.query<{ h: string }>(`select ((now() at time zone 'America/Guayaquil')::date)::text as h`)).rows[0].h
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-P5-A1'`)
  const cliente = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Pantalla', $1, $2, 'whatsapp', $3, $3, $3) returning id`, [cedulaPrueba(8801), celularPrueba(8801), vera])).rows[0].id
  const op = (await db.query<{ id: string }>(`insert into public.opportunities (client_id, codigo_unidad, responsable_id, created_by) values ($1, 'E1-P5-A1', $2, $2) returning id`, [cliente, vera])).rows[0].id
  const q = (await db.query<{ id: string }>(
    `insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id, opportunity_id)
     values ('COT-PANT-1', $4::date, $4::date + 60, 'E1-P5-A1', '{}', '{}', 0, 172147.2, 172147.2,
       '{"reserva": 10328.83, "reservaPct": 6, "meses": 30, "cuotaMensual": 803.35, "ultimaCuota": 803.46, "contraEntrega": 137717.76, "cuotasTotal": 24100.61}', $1, $2, $3) returning id`, [vera, cliente, op, hoy])).rows[0].id
  await db.query(`update public.quotes set estado = 'aceptada' where id = $1`, [q])
  reserva = (await como(db, vera, () => db.query<{ id: string }>(`select public.reservas_solicitar($1) as id`, [q]))).rows[0].id
}, 120_000)
afterEach(cleanup)

describe('Configuración > Eliminaciones', () => {
  it('el administrador busca, revisa el resumen, confirma con motivo y la reserva queda cancelada', async () => {
    const actor = await actorDe(admin)
    render(
      <ConexionProvider value={{ remoto: true, datos: datosPglite(db, admin), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
        <SessionProvider actorRemoto={actor}><EliminacionesAdmin datos={datosPglite(db, admin)} /></SessionProvider>
      </ConexionProvider>,
    )
    fireEvent.change(await screen.findByLabelText(/Buscar por cliente/), { target: { value: 'Cliente Pantalla' } })
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Revisar cancelación \(1\)/ }))
    expect(await screen.findByText(/queda disponible/)).toBeInTheDocument()
    const cancelar = screen.getByRole('button', { name: 'Cancelar reservas' })
    expect(cancelar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'El cliente no continuará con la compra' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirmo/ }))
    expect(cancelar).toBeEnabled()
    fireEvent.click(cancelar)
    expect(await screen.findByText(/reserva\(s\) canceladas/)).toBeInTheDocument()
    expect((await db.query<{ estado: string }>(`select estado from public.reservations where id = $1`, [reserva])).rows[0].estado).toBe('anulada')
  })
})
