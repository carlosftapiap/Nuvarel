// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import DatosLocalesAviso from '@/components/DatosLocalesAviso'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import VentasPage from '@/pages/VentasPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario, aprobarCumplimiento } from './db'
import { prepararReservasParaPago } from './db'

// Cada pantalla lee varias tablas de Postgres real; con toda la suite en paralelo tarda más que la espera por defecto.
configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, reserva: string

const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirComo(id: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider>
          <MemoryRouter><VentasPage /></MemoryRouter>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

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
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, '{"nombre": "Andrea Mora", "documento": "1712345675", "telefono": "0995556677", "origen": "corredor", "origen_detalle": "Carlos Corredor", "forma_pago": "banco"}'::jsonb, $1) as id`, [carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [c])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  reserva = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', 'TRF-1', jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [reserva])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [reserva])
  await prepararReservasParaPago(db)
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-1', true, 'Ingreso confirmado')`, [reserva, m.monto_reserva, hoyGuayaquil()])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [reserva])
}, 60_000)

describe('Ventas y contratos conectado a la base de datos', () => {
  it('sin contrato: la reserva aprobada aparece por contratar; solo Legal puede generarlo', async () => {
    const f = await abrirComo(finanzas)
    expect(await screen.findByText('Reservas aprobadas por contratar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generar contrato/ })).not.toBeInTheDocument()
    f.unmount()
  })

  it('Legal genera el contrato por el servidor: precio y datos vienen de la reserva', async () => {
    const user = userEvent.setup()
    const s = await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: /Generar contrato/ }))
    const dlg = await screen.findByRole('dialog', { name: /Generar contrato de RES-/ })
    expect(within(dlg).queryByLabelText(/Precio/)).not.toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Generar contrato' })).toBeDisabled()
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Reserva aprobada por gerencia')
    await user.click(within(dlg).getByRole('button', { name: 'Generar contrato' }))
    expect(await screen.findByText(/generado · pendiente de firma/)).toBeInTheDocument()
    expect(screen.queryByText('Reservas aprobadas por contratar')).not.toBeInTheDocument()
    expect(await q<{ estado: string; reservation_id: string }>(`select estado, reservation_id from public.contracts`)).toEqual({ estado: 'borrador', reservation_id: reserva })
    s.unmount()
  })

  it('la ficha muestra venta, origen, responsables, condiciones, cronograma e historial', async () => {
    const user = userEvent.setup()
    const s = await abrirComo(finanzas)
    await user.click(await screen.findByRole('row', { name: /Abrir CON-/ }))
    const f = await screen.findByRole('dialog', { name: /CON-/ })
    expect(within(f).getAllByText('Andrea Mora').length).toBeGreaterThan(0)
    expect(within(f).getByText('1712345675')).toBeInTheDocument()
    expect(within(f).getByText(/Edificio A/)).toBeInTheDocument()
    for (const t of ['Asesor principal', 'Responsable de la negociación', 'Corredor de origen', 'Atribución de captación']) {
      const fila = within(f).getByText(t).parentElement!
      expect(fila).toHaveTextContent('Carlos Corredor')
    }
    expect(within(f).getByText(/^COT-\d{4}-0001/)).toBeInTheDocument()
    expect(within(f).getByText(/^RES-\d{4}-0001/)).toBeInTheDocument()
    expect(within(f).getByText('Crédito bancario')).toBeInTheDocument()
    expect(within(f).getByText('Cuota 1 de 36')).toBeInTheDocument()
    expect(within(f).getByText(/Se vuelve exigible al firmar/)).toBeInTheDocument()
    expect(within(f).getByRole('link', { name: 'Ver en Cobranzas' })).toBeInTheDocument()
    expect(await within(f).findByText('Generar contrato', { selector: 'b' })).toBeInTheDocument()
    expect(within(f).getByText('Confirmar reserva automáticamente', { selector: 'b' })).toBeInTheDocument()
    // Finanzas consulta, pero no firma ni anula.
    expect(within(f).queryByRole('button', { name: /Registrar firma/ })).not.toBeInTheDocument()
    expect(within(f).queryByRole('button', { name: /Anular contrato/ })).not.toBeInTheDocument()
    s.unmount()
  })

  it('Legal no ve pagos en el cronograma (no tiene ese permiso), registra la firma y un error del servidor no pierde lo escrito', async () => {
    await aprobarCumplimiento(db)
    const user = userEvent.setup()
    const s = await abrirComo(legal)
    await user.click(await screen.findByRole('row', { name: /Abrir CON-/ }))
    const f = await screen.findByRole('dialog', { name: /CON-/ })
    expect(within(f).queryByText('Pendiente', { selector: 'th' })).not.toBeInTheDocument()
    expect(within(f).queryByRole('link', { name: 'Ver en Cobranzas' })).not.toBeInTheDocument()
    // La firma se habilita al leer la aprobación de Cumplimiento.
    await vi.waitFor(() => expect(within(f).getByRole('button', { name: /Registrar firma/ })).toBeEnabled())
    await user.click(within(f).getByRole('button', { name: /Registrar firma/ }))
    const d = await screen.findByRole('dialog', { name: /Registrar firma de/ })
    await user.type(within(d).getByLabelText(/Enlace o referencia/), 'contratos/CON-1-firmado.pdf')
    await user.type(within(d).getByLabelText('Motivo *'), 'Firmado ante notaría')
    await user.clear(within(d).getByLabelText('Fecha de firma *'))
    await user.type(within(d).getByLabelText('Fecha de firma *'), '2099-01-01')
    await user.click(within(d).getByRole('button', { name: 'Registrar firma' }))
    expect(await within(d).findByRole('alert')).toHaveTextContent(/no puede ser futura/)
    expect(within(d).getByLabelText('Motivo *')).toHaveValue('Firmado ante notaría')
    await user.clear(within(d).getByLabelText('Fecha de firma *'))
    await user.type(within(d).getByLabelText('Fecha de firma *'), hoyGuayaquil())
    await user.click(within(d).getByRole('button', { name: 'Registrar firma' }))
    expect(await screen.findByText(/CON-.* firmado/)).toBeInTheDocument()
    expect((await q<{ estado: string }>(`select estado from public.contracts`)).estado).toBe('firmado')
    expect((await q<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).estado).toBe('vendido')
    expect(await within(within(f).getByRole('region', { name: 'Hitos' })).findByText('Contrato firmado')).toBeInTheDocument()
    expect(within(within(f).getByRole('region', { name: 'Documentos' })).getByText('Contrato firmado')).toBeInTheDocument()
    s.unmount()
  })

  it('Legal registra un hito y un documento, y puede revertir o retirar sin borrar', async () => {
    const user = userEvent.setup()
    const s = await abrirComo(legal)
    await user.click(await screen.findByRole('row', { name: /Abrir CON-/ }))
    const f = await screen.findByRole('dialog', { name: /CON-/ })
    await user.click(within(f).getByRole('button', { name: 'Registrar hito' }))
    const d = await screen.findByRole('dialog', { name: /Registrar hito de/ })
    await user.type(within(d).getByLabelText('Motivo *'), 'Escritura firmada en notaría')
    await user.click(within(d).getByRole('button', { name: 'Registrar hito' }))
    expect(await within(f).findByText('Escritura', { selector: 'b' })).toBeInTheDocument()
    expect((await q<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).estado).toBe('vendido')
    await user.click(within(f).getByRole('button', { name: 'Revertir' }))
    const r = await screen.findByRole('dialog', { name: /Revertir Escritura/ })
    await user.type(within(r).getByLabelText('Motivo *'), 'Error de notaría')
    await user.click(within(r).getByRole('button', { name: 'Revertir' }))
    expect(await within(f).findByText(/Revertido: Error de notaría/)).toBeInTheDocument()
    expect((await q<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).estado).toBe('vendido')
    expect((await q<{ n: number }>(`select count(*)::int as n from public.contract_milestones where hito = 'escritura'`)).n).toBe(1)
    s.unmount()
  })

  it('anular deja la venta como historia y la reserva vuelve a estar por contratar', async () => {
    const user = userEvent.setup()
    const s = await abrirComo(legal)
    await user.click(await screen.findByRole('row', { name: /Abrir CON-/ }))
    const f = await screen.findByRole('dialog', { name: /CON-/ })
    await user.click(within(f).getByRole('button', { name: 'Anular contrato' }))
    const d = await screen.findByRole('dialog', { name: /Anular CON-/ })
    expect(within(d).getByRole('button', { name: 'Anular contrato' })).toBeDisabled()
    await user.type(within(d).getByLabelText('Motivo *'), 'Cliente desiste de la compra')
    await user.type(within(d).getByLabelText(/respalda/), 'actas/anulacion.pdf')
    await user.click(within(d).getByRole('button', { name: 'Anular contrato' }))
    expect(await within(f).findByText(/Anulado el/)).toBeInTheDocument()
    expect(within(f).queryByRole('button', { name: /Registrar/ })).not.toBeInTheDocument()
    expect((await q<{ estado: string }>(`select estado from public.inventory_units where codigo = 'E1-PB-A2'`)).estado).toBe('reservado')
    expect(await screen.findByText(/Contrato anterior anulado/, undefined, { })).toBeInTheDocument()
    s.unmount()
  })

  it('el corredor consulta sus ventas sin acciones; otro corredor no las ve', async () => {
    const r = await abrirComo(carlos)
    expect((await screen.findAllByText('Andrea Mora')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Generar contrato/ })).not.toBeInTheDocument()
    r.unmount()
    await abrirComo(await crearUsuario(db, 'Otro Corredor', 'corredor'))
    expect(await screen.findByText('Sin contratos')).toBeInTheDocument()
    expect(screen.queryByText('Andrea Mora')).not.toBeInTheDocument()
  })

  it('sin Supabase avisa que requiere la base de datos', () => {
    render(<SessionProvider initialRol="administrador"><InventoryProvider><MemoryRouter><VentasPage /></MemoryRouter></InventoryProvider></SessionProvider>)
    expect(screen.getByText('Requiere la base de datos')).toBeInTheDocument()
  })
})

describe('Datos guardados solo en el navegador', () => {
  const conectado = (solo: string) => render(
    <ConexionProvider value={{ remoto: true, datos: null, cuenta: null, salir: async () => {} }}><DatosLocalesAviso solo={solo} /></ConexionProvider>,
  )
  const cotizaciones = JSON.stringify([{ numero: 'COT-2026-0007', fecha: '2026-10-05', cliente: { nombre: 'Cliente Local' }, unidad: { dpt: '1002' }, creadaPor: { nombre: 'Vera' } }, { numero: 'COT-2026-0008', fecha: '2026-10-20', cliente: { nombre: 'Otro Local' }, unidad: { dpt: '1003' }, creadaPor: { nombre: 'Vera' } }])
  const reservas = JSON.stringify({ version: 1, reservas: [{ codigo: 'RES-2026-0003', clienteNombre: 'Cliente Local', unidad: 'E1-PB-A2', estado: 'confirmada', creadaEn: '2026-10-07T10:00:00Z', creadaPor: { nombre: 'Vera' } }] })

  it('sin registros no muestra nada', () => {
    conectado('amura.cotizaciones.v1')
    expect(screen.queryByText(/Este navegador guarda/)).not.toBeInTheDocument()
  })

  it('muestra cantidad, fechas y referencias, sin borrar ni cambiar nada, y descarga una copia exacta', async () => {
    const user = userEvent.setup()
    localStorage.setItem('amura.cotizaciones.v1', cotizaciones)
    localStorage.setItem('amura.reservas.v1', reservas)
    conectado('amura.cotizaciones.v1')
    expect(screen.getByText(/Este navegador guarda 2 cotizaciones/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver registros' }))
    const d = await screen.findByRole('dialog', { name: /Datos guardados solo en este navegador/ })
    const cot = within(d).getByRole('region', { name: 'Cotizaciones' })
    expect(within(cot).getByText('Cotizaciones: 2')).toBeInTheDocument()
    expect(within(cot).getByText(/Del 05\/10\/2026 al 20\/10\/2026/)).toBeInTheDocument()
    expect(within(cot).getByText('COT-2026-0007')).toBeInTheDocument()
    expect(within(d).getByRole('region', { name: 'Reservas' })).toHaveTextContent('RES-2026-0003')
    await user.click(within(d).getByRole('button', { name: 'Descargar copia' }))
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    const texto = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(blob) })
    const copia = JSON.parse(texto)
    expect(copia['amura.cotizaciones.v1']).toEqual(JSON.parse(cotizaciones))
    expect(copia['amura.reservas.v1']).toEqual(JSON.parse(reservas))
    expect(localStorage.getItem('amura.cotizaciones.v1')).toBe(cotizaciones)
    expect(localStorage.getItem('amura.reservas.v1')).toBe(reservas)
  })

  it('datos dañados no rompen la pantalla', () => {
    localStorage.setItem('amura.cotizaciones.v1', '{no es json')
    conectado('amura.cotizaciones.v1')
    expect(screen.queryByText(/Este navegador guarda/)).not.toBeInTheDocument()
    expect(localStorage.getItem('amura.cotizaciones.v1')).toBe('{no es json')
  })
})
