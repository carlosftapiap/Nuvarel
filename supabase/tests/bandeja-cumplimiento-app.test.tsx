// @vitest-environment jsdom
// Bandeja del Oficial: ve lo pendiente, observa un documento, aprueba el contrato y deja todo en el historial.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor } from '@/features/inventario/types'
import BandejaCumplimientoPage from '@/pages/BandejaCumplimientoPage'
import { almacenPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, oficial: string, carlos: string
let cliente: string, contrato: string
const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const NATURAL = ['pn_cedula', 'pn_votacion', 'pn_servicio_basico', 'pn_origen_fondos', 'pn_conozca_cliente']

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirComo(id: string) {
  const actor = await actorDe(id)
  render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter><BandejaCumplimientoPage /></MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
  return userEvent.setup()
}

afterEach(cleanup)
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
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
  cliente = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, '{"nombre": "Andrea Mora", "documento": "1712345675", "telefono": "0995556677", "origen": "corredor", "origen_detalle": "Carlos Corredor", "forma_pago": "banco"}'::jsonb, $1) as id`, [carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [cliente])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const reserva = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [reserva])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-1', true, 'Ingreso confirmado')`, [reserva, m.monto_reserva, hoyGuayaquil()])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [reserva])
  contrato = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [reserva, hoyGuayaquil()])).id
  for (const [i, t] of NATURAL.entries()) {
    await rpc(carlos, `select public.expediente_cargar($1, null, $2, $3::jsonb, null)`,
      [cliente, t, JSON.stringify({ ruta: `clientes/${cliente}/${crypto.randomUUID()}-doc${i}.pdf`, nombre: `doc${i}.pdf`, mime: 'application/pdf', tamano: 1024, hash: 'b'.repeat(64) })])
  }
  await rpc(legal, `select public.cumplimiento_enviar($1, 'Expediente completo')`, [contrato])
}, 60_000)

describe('Bandeja de Cumplimiento', () => {
  it('quien no es de Cumplimiento no la abre', async () => {
    await abrirComo(carlos)
    expect(await screen.findByText('Sin acceso a Cumplimiento')).toBeInTheDocument()
  })

  it('el Oficial ve el contrato enviado y los cinco documentos por revisar', async () => {
    await abrirComo(oficial)
    expect(await screen.findByRole('tab', { name: 'Por revisar (6)' })).toBeInTheDocument()
    const fila = (await screen.findByRole('button', { name: 'Revisar contrato' })).closest('tr')!
    expect(within(fila).getByText(/^CON-/)).toBeInTheDocument()
    expect(within(fila).getByText('En revisión de Cumplimiento')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Revisar expediente' })).toHaveLength(5)
    expect(screen.getAllByText('Andrea Mora').length).toBeGreaterThanOrEqual(6)
  })

  it('observa un documento desde el expediente y pasa a Por corregir con su comentario', async () => {
    const user = await abrirComo(oficial)
    const fila = (await screen.findByText('Cédula de identidad')).closest('tr')!
    await user.click(within(fila).getByRole('button', { name: 'Revisar expediente' }))
    const hoja = await screen.findByRole('dialog', { name: /Expediente de Andrea Mora/ })
    const doc = (await within(hoja).findByText('Cédula de identidad')).closest('tr')!
    await user.click(within(doc).getByRole('button', { name: 'Revisar' }))
    const d = await screen.findByRole('dialog', { name: /Revisar Cédula/ })
    await user.click(within(d).getByRole('radio', { name: 'Observar' }))
    await user.type(within(d).getByLabelText(/Observación/), 'La foto está borrosa')
    await user.click(within(d).getByRole('button', { name: 'Guardar revisión' }))
    await vi.waitFor(async () => expect(await q(`select estado from public.expediente_documentos where tipo = 'pn_cedula'`)).toEqual({ estado: 'observado' }))
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('tab', { name: 'Por corregir (1)' }))
    const corregir = (await screen.findAllByText('La foto está borrosa'))[0].closest('tr')!
    expect(within(corregir).getByText('Observado')).toBeInTheDocument()
  })

  it('con todo aprobado, aprueba el contrato; queda en Aprobados y en el historial', async () => {
    // El corredor reemplaza la cédula observada; la versión anterior queda en el historial con su observación.
    await rpc(carlos, `select public.expediente_cargar($1, null, 'pn_cedula', $2::jsonb, null)`,
      [cliente, JSON.stringify({ ruta: `clientes/${cliente}/${crypto.randomUUID()}-cedula.pdf`, nombre: 'cedula.pdf', mime: 'application/pdf', tamano: 1024, hash: 'c'.repeat(64) })])
    const docs = (await db.query<{ id: string }>(`select id from public.expediente_documentos where estado not in ('aprobado', 'reemplazado')`)).rows
    for (const x of docs) await rpc(oficial, `select public.expediente_revisar($1, 'aprobado', null)`, [x.id])
    const user = await abrirComo(oficial)
    await user.click(await screen.findByRole('button', { name: 'Revisar contrato' }))
    const hoja = await screen.findByRole('dialog', { name: /Contrato CON-/ })
    await user.click(await within(hoja).findByRole('button', { name: 'Resolver revisión' }))
    const d = await screen.findByRole('dialog', { name: 'Resolver revisión de Cumplimiento' })
    await user.click(within(d).getByRole('button', { name: 'Guardar resolución' }))
    await vi.waitFor(async () => expect(await q(`select public.cumplimiento_estado($1) as e`, [contrato])).toEqual({ e: 'aprobado' }))
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('tab', { name: 'Por revisar (0)' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Aprobados (7)' }))
    expect(await screen.findByText('Aprobado por Cumplimiento')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Historial' }))
    expect(await screen.findByText('Observado (luego reemplazado)')).toBeInTheDocument()
    expect(screen.getByText(/La foto está borrosa/)).toBeInTheDocument()
    expect(screen.getAllByText('Enviado a Cumplimiento')).toHaveLength(1)
    expect(screen.getAllByText('Aprobado').length).toBeGreaterThanOrEqual(6)
  })
})
