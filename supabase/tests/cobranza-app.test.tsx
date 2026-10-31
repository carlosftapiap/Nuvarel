// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import CobranzaPage from '@/pages/CobranzaPage'
import { almacenPrueba, archivoPrueba, datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, finanzas: string, vera: string
let contrato: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirComo(id: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><CobranzaPage /></SessionProvider>
    </ConexionProvider>,
  )
}
const abrirTab = async (nombre: RegExp) => {
  const tab = await screen.findByRole('tab', { name: nombre })
  fireEvent.mouseDown(tab, { button: 0 })
  fireEvent.click(tab)
}
const kpi = (titulo: string) => screen.getByText(titulo).parentElement!

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera', 'asesor')
  // Contrato firmado de prueba (precio 10.000): reserva 500 pagada, firma 100 y cuota 700 vencidas, cuota 700 por vencer, entrega 8.000.
  const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Cobranza', '0990000030', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const q = (await db.query<{ id: string }>(`insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id)
    values ('COT-CB-1', (now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date + 30, 'E1-PB-A2', '{}', '{}', 0, 10000, 10000, '{}', $1, $2) returning id`, [vera, cli])).rows[0].id
  const r = (await db.query<{ id: string }>(`insert into public.reservations (codigo, client_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, reserva_pct, monto_reserva, meses, cuota_mensual, estado, created_by)
    values ('RES-CB-1', $1, 'E1-PB-A2', $2, (now() at time zone 'America/Guayaquil')::date + 30, 10000, 6, 500, 2, 700, 'confirmada', $3) returning id`, [cli, q, vera])).rows[0].id
  contrato = (await db.query<{ id: string }>(`insert into public.contracts (codigo, reservation_id, client_id, codigo_unidad, precio, estado, fecha_contrato, created_by)
    values ('CON-CB-1', $1, $2, 'E1-PB-A2', 10000, 'firmado', '2026-08-01', $3) returning id`, [r, cli, admin])).rows[0].id
  await db.query(`insert into public.installments (contract_id, numero, concepto, vencimiento, monto) values
    ($1, 0, 'Reserva', '2026-08-01', 500), ($1, 1, 'Pago a la firma', '2026-09-01', 100), ($1, 2, 'Cuota 1 de 2', '2026-10-01', 700),
    ($1, 3, 'Cuota 2 de 2', ((now() at time zone 'America/Guayaquil')::date + 5), 700), ($1, 4, 'Saldo contra entrega (80%)', null, 8000)`, [contrato])
  await db.query(`insert into public.payments (contract_id, monto, fecha, referencia, estado, registrado_por, verificado_por, verificado_en) values ($1, 500, '2026-08-01', 'RES-1', 'verificado', $2, $2, now())`, [contrato, admin])
}, 60_000)

describe('Cobranza conectada a Supabase (Postgres real)', () => {
  it('el tablero separa la entrada de Nuvarel del desembolso bancario y muestra lo vencido como parte del saldo', async () => {
    await abrirComo(admin)
    await screen.findByText('Saldo por cobrar')
    expect(within(kpi('Saldo por cobrar')).getByText('$1.500,00')).toBeInTheDocument()
    expect(within(kpi('Vencido')).getByText('$800,00')).toBeInTheDocument()
    expect(within(kpi('Por vencer (7 días)')).getByText('$700,00')).toBeInTheDocument()
    expect(screen.getByText('$8.000,00')).toBeInTheDocument() // desembolso bancario esperado, aparte
  })

  it('Finanzas registra un pago: queda por verificar y no puede confirmarlo ella misma', async () => {
    await abrirComo(finanzas)
    await abrirTab(/Cartera/)
    fireEvent.click(await screen.findByText('Cliente Cobranza'))
    fireEvent.change(await screen.findByLabelText('Monto (USD)'), { target: { value: '300' } })
    fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'TRF-UI-1' } })
    fireEvent.change(screen.getByLabelText('Banco'), { target: { value: 'Banco Pichincha' } })
    fireEvent.change(screen.getByLabelText(/Foto o PDF/), { target: { files: [archivoPrueba()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
    expect(await screen.findByText('Pago registrado: queda por verificar')).toBeInTheDocument()
    expect((await screen.findAllByText('Lo verifica otra persona')).length).toBeGreaterThan(0)
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'registrado' })
  })

  it('sin receptor de pagos definido, la base impide confirmar ingresos', async () => {
    await abrirComo(admin)
    await abrirTab(/Cartera/)
    fireEvent.click(await screen.findByText('Cliente Cobranza'))
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar pago' }))
    fireEvent.click(await screen.findByLabelText(/Verifiqué el ingreso/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    expect(await screen.findByText(/Verificación de cobros deshabilitada/)).toBeInTheDocument()
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'registrado' })
  })

  it('otra persona confirma el ingreso con motivo; el abono parcial se refleja en la cuota', async () => {
    await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
    await abrirComo(admin)
    await abrirTab(/Cartera/)
    fireEvent.click(await screen.findByText('Cliente Cobranza'))
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar pago' }))
    fireEvent.click(await screen.findByLabelText(/Verifiqué el ingreso/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument()
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'verificado' })
    // 500 reserva + 300: cubre la firma (100) y deja 200 aplicado a la cuota 1 → abono parcial.
    expect(await screen.findByText('Abono parcial')).toBeInTheDocument()
  })

  it('registra una gestión de cobranza', async () => {
    await abrirComo(finanzas)
    await abrirTab(/Cartera/)
    fireEvent.click(await screen.findByText('Cliente Cobranza'))
    fireEvent.change(await screen.findByLabelText('Descripción de la gestión'), { target: { value: 'Cliente promete pagar el viernes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar gestión' }))
    expect(await screen.findByText('Gestión registrada')).toBeInTheDocument()
    expect((await db.query(`select count(*)::int as n from public.cobranza_gestiones`)).rows[0]).toEqual({ n: 1 })
  })

  it('una vendedora consulta sin acciones de pago; quien no tiene el permiso no entra', async () => {
    const r = await abrirComo(vera)
    await screen.findByRole('tab', { name: /Cartera/ })
    expect(screen.queryByText('Sin acceso a Cobranzas')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar|Verificar|Conciliar/ })).not.toBeInTheDocument()
    r.unmount()
    await abrirComo(await crearUsuario(db, 'Omar Constructor', 'constructor'))
    expect(await screen.findByText('Sin acceso a Cobranzas')).toBeInTheDocument()
  })
})
