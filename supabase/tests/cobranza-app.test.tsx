// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Cobranza', '1715000301', '0990000030', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
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

describe('Cobranzas: recorrido completo (Postgres real)', () => {
  const abrirCliente = async () => fireEvent.click((await screen.findAllByRole('button', { name: 'Cliente Cobranza' }))[0])
  const abrirSeguimiento = async () => fireEvent.click(await screen.findByText('Seguimiento y correcciones'))

  it('la pantalla principal muestra los cuatro totales y las cuotas de la entrada, sin el 80 % bancario', async () => {
    await abrirComo(admin)
    await screen.findByText('Saldo pendiente')
    expect(within(kpi('Total cobrado')).getByText('$500,00')).toBeInTheDocument()
    expect(within(kpi('Saldo pendiente')).getByText('$1.500,00')).toBeInTheDocument()
    expect(within(kpi('Valores vencidos')).getByText('$800,00')).toBeInTheDocument()
    expect(within(kpi('Próximos vencimientos')).getByText('$700,00')).toBeInTheDocument()
    for (const col of ['Cliente', 'Departamento', 'Cuota', 'Vencimiento', 'Valor', 'Pagado', 'Saldo', 'Estado']) expect(screen.getByRole('columnheader', { name: col })).toBeInTheDocument()
    expect(screen.queryByText('$8.000,00')).toBeNull()
    await abrirTab(/Indicadores/)
    expect(await screen.findByText('$8.000,00')).toBeInTheDocument() // desembolso bancario esperado, aparte
  })

  it('al elegir un cliente se ve su cronograma; los vencidos se filtran con un clic', async () => {
    await abrirComo(admin)
    fireEvent.click((await screen.findByText('Valores vencidos')).closest('button')!)
    expect(screen.getByLabelText('Mostrar')).toHaveValue('vencidas')
    expect(screen.getAllByText('Vencida').length).toBeGreaterThan(0)
    await abrirCliente()
    expect(await screen.findByText('Cronograma de la entrada del 20 %')).toBeInTheDocument()
    expect(screen.getByText(/No es cartera de Nuvarel/)).toBeInTheDocument()
  })

  it('registra un pago parcial con comprobante: queda por verificar y no cuenta como cobrado', async () => {
    await abrirComo(finanzas)
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar pago' }))
    const dlg = await screen.findByRole('dialog', { name: 'Registrar pago' })
    const guardar = within(dlg).getByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()
    fireEvent.change(within(dlg).getByLabelText('Cliente *'), { target: { value: contrato } })
    expect(within(dlg).getByLabelText('Cuota')).toHaveTextContent('Pago a la firma')
    fireEvent.change(within(dlg).getByLabelText(/Valor pagado/), { target: { value: '60' } })
    expect(within(dlg).getByText(/Pago parcial: la cuota quedará con saldo \$40,00/)).toBeInTheDocument()
    fireEvent.change(within(dlg).getByLabelText('Banco *'), { target: { value: 'Banco Pichincha' } })
    fireEvent.change(within(dlg).getByLabelText(/Número de transferencia/), { target: { value: 'TRF-UI-1' } })
    expect(guardar).toBeDisabled()
    fireEvent.change(within(dlg).getByLabelText(/Comprobante/), { target: { files: [archivoPrueba()] } })
    fireEvent.click(guardar)
    expect(await screen.findByText('Pago registrado: queda por verificar')).toBeInTheDocument()
    expect(await screen.findByText(/Pagos por verificar \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Lo verifica otra persona')).toBeInTheDocument()
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'registrado' })
    expect(within(kpi('Total cobrado')).getByText('$500,00')).toBeInTheDocument()
    expect(within(kpi('Saldo pendiente')).getByText('$1.500,00')).toBeInTheDocument()
  })

  it('el mismo número de transferencia no se registra dos veces', async () => {
    await abrirComo(finanzas)
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar pago' }))
    const dlg = await screen.findByRole('dialog', { name: 'Registrar pago' })
    fireEvent.change(within(dlg).getByLabelText('Cliente *'), { target: { value: contrato } })
    expect(within(dlg).getByLabelText('Cuota')).toHaveTextContent('ya tiene 1 pago por verificar')
    fireEvent.change(within(dlg).getByLabelText(/Valor pagado/), { target: { value: '60' } })
    fireEvent.change(within(dlg).getByLabelText('Banco *'), { target: { value: 'Banco Pichincha' } })
    fireEvent.change(within(dlg).getByLabelText(/Número de transferencia/), { target: { value: 'TRF-UI-1' } })
    fireEvent.change(within(dlg).getByLabelText(/Comprobante/), { target: { files: [archivoPrueba()] } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Guardar' }))
    expect(await within(dlg).findByRole('alert')).toBeInTheDocument()
    expect((await db.query(`select count(*)::int as n from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ n: 1 })
  })

  it('quien registró no puede confirmar su propio pago, ni en la pantalla ni en la base', async () => {
    await abrirComo(finanzas)
    fireEvent.click(await screen.findByRole('button', { name: 'Ver pago' }))
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Confirmar pago' })).toBeNull()
    const pago = (await db.query<{ id: string }>(`select id from public.payments where referencia = 'TRF-UI-1'`)).rows[0].id
    await expect(como(db, finanzas, () => db.query(`select public.cobranzas_confirmar_pago($1, true, '')`, [pago]))).rejects.toThrow()
  })

  it('sin receptor de pagos definido, la base impide confirmar ingresos', async () => {
    await abrirComo(admin)
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar pago' }))
    fireEvent.click(await screen.findByLabelText(/Verifiqué el ingreso/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    expect(await screen.findByText(/Verificación de cobros deshabilitada/)).toBeInTheDocument()
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'registrado' })
  })

  it('otra persona confirma: el saldo se actualiza y se emite el recibo numerado de NUVAREL S.A.S., que se puede descargar', async () => {
    await como(db, admin, () => db.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
    await abrirComo(admin)
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar pago' }))
    fireEvent.click(await screen.findByLabelText(/Verifiqué el ingreso/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pago' }))
    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument()
    expect((await db.query(`select estado from public.payments where referencia = 'TRF-UI-1'`)).rows[0]).toEqual({ estado: 'verificado' })
    await waitFor(() => expect(within(kpi('Total cobrado')).getByText('$560,00')).toBeInTheDocument())
    expect(within(kpi('Saldo pendiente')).getByText('$1.440,00')).toBeInTheDocument()
    expect(screen.getAllByText('Abono parcial').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Pagos por verificar/)).toBeNull()
    const v = (await db.query<{ numero: string; emisor: string; monto: number }>(`select numero, emisor, monto::float as monto from public.recibos_pago where referencia = 'TRF-UI-1'`)).rows
    expect(v).toHaveLength(1)
    expect(v[0].emisor).toBe('NUVAREL S.A.S.')
    expect(v[0].monto).toBe(60)
    await abrirCliente()
    const descargar = await screen.findByRole('button', { name: `Recibo ${v[0].numero}` })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    fireEvent.click(descargar)
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
  })

  it('las correcciones están aparte: anular exige motivo, deja historial y devuelve el saldo', async () => {
    await abrirComo(admin)
    await abrirCliente()
    await abrirSeguimiento()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Anular' }))[0])
    await screen.findByRole('dialog', { name: /Anular el pago/ })
    expect(screen.getByRole('button', { name: 'Anular pago' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Transferencia devuelta por el banco' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anular pago' }))
    expect(await screen.findByText('Pago anulado')).toBeInTheDocument()
    const pagos = (await db.query<{ estado: string }>(`select estado from public.payments where contract_id = $1 and estado = 'anulado'`, [contrato])).rows
    expect(pagos).toHaveLength(1)
    expect(screen.getAllByText('Anulado').length).toBeGreaterThan(0)
  })

  it('registra una gestión de cobranza desde el seguimiento', async () => {
    await abrirComo(finanzas)
    await abrirCliente()
    await abrirSeguimiento()
    fireEvent.change(await screen.findByLabelText('Descripción de la gestión'), { target: { value: 'Cliente promete pagar el viernes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar gestión' }))
    expect(await screen.findByText('Gestión registrada')).toBeInTheDocument()
    expect((await db.query(`select count(*)::int as n from public.cobranza_gestiones`)).rows[0]).toEqual({ n: 1 })
  })

  it('una vendedora consulta sin acciones de pago; quien no tiene el permiso no entra', async () => {
    const r = await abrirComo(vera)
    await screen.findByRole('tab', { name: 'Cuotas' })
    expect(screen.queryByText('Sin acceso a Cobranzas')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar|Verificar|Conciliar|Revisar/ })).not.toBeInTheDocument()
    r.unmount()
    await abrirComo(await crearUsuario(db, 'Omar Constructor', 'constructor'))
    expect(await screen.findByText('Sin acceso a Cobranzas')).toBeInTheDocument()
  })
})
