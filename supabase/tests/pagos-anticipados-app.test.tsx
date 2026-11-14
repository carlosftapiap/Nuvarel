// @vitest-environment jsdom
// Fase 2 en la pantalla de Cobranzas: saldo a favor, autorización de Finanzas y estado de cuenta PDF.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Actor } from '@/features/inventario/types'
import CobranzaPage from '@/pages/CobranzaPage'
import { construirEstadoCuentaPdf } from '@/features/cobranza/estadoCuenta'
import { calcularEstadoCuenta } from '../functions/_shared/estadoCuenta'
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
  render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen: almacenPrueba }}>
      <SessionProvider actorRemoto={actor}><CobranzaPage /></SessionProvider>
    </ConexionProvider>,
  )
  // La entrada está pagada: el contrato solo aparece al mostrar todas las cuotas.
  fireEvent.change(await screen.findByLabelText('Mostrar'), { target: { value: 'todas' } })
  fireEvent.click((await screen.findAllByRole('button', { name: 'Cliente Anticipado' }))[0])
  await screen.findByText('Saldo contra entrega (80 %)')
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  document.body.innerHTML = ''
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera', 'asesor')
  // Precio 10.000: entrada 2.000 y saldo contra entrega 8.000. Pagado y verificado 3.000: 1.000 de saldo a favor.
  const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Anticipado', '1715000400', '0990000040', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const q = (await db.query<{ id: string }>(`insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id)
    values ('COT-PA-1', (now() at time zone 'America/Guayaquil')::date, (now() at time zone 'America/Guayaquil')::date + 30, 'E1-PB-A2', '{}', '{}', 0, 10000, 10000, '{}', $1, $2) returning id`, [vera, cli])).rows[0].id
  const r = (await db.query<{ id: string }>(`insert into public.reservations (codigo, client_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, reserva_pct, monto_reserva, meses, cuota_mensual, estado, created_by)
    values ('RES-PA-1', $1, 'E1-PB-A2', $2, (now() at time zone 'America/Guayaquil')::date + 30, 10000, 6, 500, 2, 750, 'confirmada', $3) returning id`, [cli, q, vera])).rows[0].id
  contrato = (await db.query<{ id: string }>(`insert into public.contracts (codigo, reservation_id, client_id, codigo_unidad, precio, estado, fecha_contrato, created_by)
    values ('CON-PA-1', $1, $2, 'E1-PB-A2', 10000, 'firmado', '2026-08-01', $3) returning id`, [r, cli, admin])).rows[0].id
  await db.query(`insert into public.installments (contract_id, numero, concepto, vencimiento, monto) values
    ($1, 0, 'Reserva', '2026-08-01', 500), ($1, 1, 'Cuota 1 de 2', '2026-09-01', 750), ($1, 2, 'Cuota 2 de 2', '2026-10-01', 750), ($1, 3, 'Saldo contra entrega (80%)', null, 8000)`, [contrato])
  await db.query(`insert into public.payments (contract_id, monto, fecha, referencia, estado, registrado_por, verificado_por, verificado_en) values
    ($1, 500, '2026-08-01', 'RES-PA', 'verificado', $2, $2, now()), ($1, 2500, '2026-09-01', 'TRF-PA-1', 'verificado', $2, $2, now())`, [contrato, admin])
}, 60_000)

describe('Cobranzas: pagos anticipados', () => {
  it('el excedente se muestra como saldo a favor y el 80 % queda completo', async () => {
    await abrirComo(finanzas)
    expect(screen.getByText(/Saldo a favor sin aplicar: \$1\.000,00/)).toBeInTheDocument()
    expect(screen.getByText(/pendiente \$8\.000,00/)).toBeInTheDocument()
  })

  it('una vendedora no ve la opción de aplicar el excedente', async () => {
    await abrirComo(vera)
    expect(screen.queryByRole('button', { name: 'Aplicar saldo a favor' })).toBeNull()
  })

  it('Finanzas aplica parte del saldo a favor con motivo y soporte; queda en el historial', async () => {
    await abrirComo(finanzas)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar saldo a favor' }))
    const dlg = await screen.findByRole('dialog', { name: 'Aplicar saldo a favor al 80 %' })
    const boton = within(dlg).getByRole('button', { name: 'Autorizar aplicación' })
    fireEvent.change(within(dlg).getByLabelText(/Monto a aplicar/), { target: { value: '1500' } })
    expect(within(dlg).getByText(/El máximo disponible es \$1\.000,00/)).toBeInTheDocument()
    fireEvent.change(within(dlg).getByLabelText(/Monto a aplicar/), { target: { value: '600' } })
    fireEvent.change(within(dlg).getByLabelText(/Motivo/), { target: { value: 'Abono anticipado para reducir la hipoteca' } })
    expect(boton).toBeDisabled()
    fireEvent.change(within(dlg).getByLabelText(/Documento de soporte/), { target: { files: [archivoPrueba()] } })
    fireEvent.click(boton)
    expect(await screen.findByText('Excedente aplicado al saldo contra entrega')).toBeInTheDocument()
    expect(await screen.findByText(/pendiente \$7\.400,00/)).toBeInTheDocument()
    expect(screen.getByText(/Saldo a favor sin aplicar: \$400,00/)).toBeInTheDocument()
    expect(screen.getByText('Abono anticipado para reducir la hipoteca')).toBeInTheDocument()
    const a = (await db.query<{ autorizado_por: string; monto: string; soporte_ruta: string }>(`select autorizado_por, monto, soporte_ruta from public.aplicaciones_excedente where contract_id = $1`, [contrato])).rows
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ autorizado_por: finanzas, monto: '600.00' })
    expect(a[0].soporte_ruta.startsWith(`excedentes/${contrato}/`)).toBe(true)
  })

  it('el estado de cuenta se descarga como PDF desde el detalle del contrato', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await abrirComo(vera)
    fireEvent.click(screen.getByRole('button', { name: 'Estado de cuenta' }))
    await vi.waitFor(() => expect(clic).toHaveBeenCalledTimes(1))
    clic.mockRestore()
  })
})

describe('estado de cuenta', () => {
  const e = calcularEstadoCuenta({
    hoy: '2026-11-11', contrato: { codigo: 'CON-X', estado: 'firmado', precio: 10000 },
    cuotas: [{ numero: 0, concepto: 'Reserva', vencimiento: '2026-08-01', monto: 500 }, { numero: 1, concepto: 'Cuota 1 de 2', vencimiento: '2026-09-01', monto: 750 },
      { numero: 2, concepto: 'Cuota 2 de 2', vencimiento: '2026-12-01', monto: 750 }, { numero: 3, concepto: 'Saldo contra entrega (80%)', vencimiento: null, monto: 8000 }],
    pagos: [
      { id: 'p1', fecha: '2026-08-01', referencia: 'RES', monto: 500, estado: 'verificado', recibo: 'RP-2026-0001', concepto: 'Reserva' },
      { id: 'p2', fecha: '2026-09-02', referencia: 'TRF-1', monto: 2500, estado: 'verificado', recibo: 'RP-2026-0002', concepto: 'Cuota 1 de 2' },
      { id: 'p3', fecha: '2026-11-10', referencia: 'TRF-2', monto: 300, estado: 'registrado', recibo: null, concepto: null },
      { id: 'p4', fecha: '2026-10-10', referencia: 'TRF-R', monto: 999, estado: 'rechazado', recibo: null, concepto: null },
    ],
    aplicaciones: [{ monto: 600, autorizadoEn: '2026-10-01T10:00:00Z', motivo: 'Abono', anulada: false }, { monto: 400, autorizadoEn: '2026-10-02T10:00:00Z', motivo: 'Error', anulada: true }],
  })

  it('separa entrada, pagos confirmados, pendientes, saldo a favor y 80 %; solo suma lo verificado', () => {
    expect(e.entrada).toMatchObject({ pactado: 2000, pagado: 2000, saldo: 0, vencido: 0 })
    expect(e.totalConfirmado).toBe(3000)
    expect(e.pagosPendientes.map((p) => p.referencia)).toEqual(['TRF-2'])
    expect(e.pagosConfirmados.map((p) => p.referencia)).toEqual(['RES', 'TRF-1'])
    expect(e.financiamiento).toMatchObject({ monto: 8000, aplicado: 600, saldo: 7400 })
    expect(e.financiamiento.aplicaciones).toHaveLength(1)
    expect(e.saldoAFavor).toBe(400)
    expect(e.entrada.pagado + e.financiamiento.aplicado + e.saldoAFavor).toBe(e.totalConfirmado)
  })

  it('el PDF lleva el título, la fecha de corte y la leyenda', () => {
    const doc = construirEstadoCuentaPdf(e, {
      emisor: 'NUVAREL S.A.S.', emisorRuc: '1790000000001', emisorDireccion: 'Quito', cliente: 'Ana Pérez', documento: '1700000000', departamento: '101', codigoUnidad: 'E1-PB-A2',
      codigoContrato: 'CON-X', precio: 10000, estado: 'Firmado',
    }, null)
    const texto = new TextDecoder('latin1').decode(doc.output('arraybuffer'))
    for (const t of ['ESTADO DE CUENTA', 'Corte al 11/11/2026', 'RP-2026-0002', 'no se suman', 'No es una factura']) expect(texto).toContain(t)
  })
})
