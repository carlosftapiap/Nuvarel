// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import ComisionesPage from '@/pages/ComisionesPage'
import VentasPage from '@/pages/VentasPage'
import { datosPglite } from './datos-pglite'
import { aprobarCumplimiento, cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string
let n = 990950000

const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function abrirComo(id: string, pagina: React.ReactNode = <ComisionesPage />) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><MemoryRouter>{pagina}</MemoryRouter></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
async function venta(nombre: string) {
  const codigo = (await q<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
  const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: celularPrueba(++n), documento: cedulaPrueba(n), origen: 'whatsapp' }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoyGuayaquil()])).id
  await aprobarCumplimiento(db)
  await rpc(legal, `select public.contratos_formalizar($1, $2::date, 'Firma ante notaría', 'contrato.pdf')`, [id, hoyGuayaquil()])
  const k = await q<{ codigo: string; precio: string }>(`select codigo, precio from public.contracts where id = $1`, [id])
  return { id, codigo: k.codigo, precio: Number(k.precio) }
}
const tarjeta = (codigo: string) => screen.findByRole('listitem', { name: `Comisión de ${codigo}` })

beforeEach(() => {
  localStorage.clear()
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
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

/** Lleva lo pagado y verificado en Cobranzas al 6 % del precio, con el flujo real. */
async function pagarSeisPorCiento(v: { id: string; precio: number }) {
  const pagado = await q<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.payments where contract_id = $1 and estado = 'verificado'`, [v.id])
  const falta = Math.round((v.precio * 0.06 - Number(pagado.t)) * 100) / 100
  if (falta <= 0) return
  const p = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', $4, jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [v.id, falta, hoyGuayaquil(), `PAGO-UI-${++n}`])).id
  await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [p])
}

/** Lo que haría una migración autorizada tras formalizar el beneficiario contractual. Solo en pruebas. */
const formalizar = (si: boolean) => db.query(`update public.comision_parametros set pagos_vendedor_habilitados = $1`, [si])

describe('Comisiones desde la app', () => {
  it('comisión del vendedor: lista para pago con el 6 %, bloqueada hasta la formalización; después Finanzas confirma con comprobante', async () => {
    const user = userEvent.setup()
    const v = await venta('Venta Pantalla')
    await pagarSeisPorCiento(v)

    // Finanzas: lista para pago, pero bloqueada; no hay habilitación manual.
    const f = await abrirComo(finanzas)
    expect(await screen.findByText(/Propuesta pendiente de formalización contractual/)).toBeInTheDocument()
    let card = await tarjeta(v.codigo)
    expect(within(card).getByText('Carlos Corredor', { selector: 'b' })).toBeInTheDocument()
    let t1 = within(card).getByLabelText('Tramo 1')
    expect(within(t1).getByText('Comisión · 100 %')).toBeInTheDocument()
    expect(within(t1).getByText('Lista para pago')).toBeInTheDocument()
    expect(within(t1).getByText(/bloqueados hasta la formalización contractual/)).toBeInTheDocument()
    for (const b of ['Confirmar pago', 'Habilitar', 'Registrar honorario', 'Registrar factura']) expect(within(t1).queryByRole('button', { name: b })).not.toBeInTheDocument()
    f.unmount()

    // Con la formalización y la política aprobada, Finanzas registra el desembolso a nombre del vendedor.
    await formalizar(true)
    try {
      const a = await abrirComo(admin)
      await user.click(await screen.findByRole('button', { name: 'Registrar aprobación' }))
      const dp = await screen.findByRole('dialog', { name: 'Registrar aprobación de la política' })
      await user.type(within(dp).getByLabelText(/Documento/), 'Política de comisiones')
      await user.type(within(dp).getByLabelText('Motivo *'), 'Dirección aprobó la política')
      await user.click(within(dp).getByRole('button', { name: 'Registrar aprobación' }))
      expect(await screen.findByText(/aprobada por Admin/)).toBeInTheDocument()
      a.unmount()

      const f2 = await abrirComo(finanzas)
      card = await tarjeta(v.codigo)
      t1 = within(card).getByLabelText('Tramo 1')
      await user.click(within(t1).getByRole('button', { name: 'Confirmar pago' }))
      const dpago = await screen.findByRole('dialog', { name: 'Confirmar pago a Carlos Corredor' })
      expect(within(dpago).queryByLabelText(/Pagado a/)).not.toBeInTheDocument()
      await user.type(within(dpago).getByLabelText(/Comprobante de la transferencia/), 'TRF-1')
      expect(within(dpago).getByRole('button', { name: 'Confirmar pago' })).toBeDisabled()
      await user.click(within(dpago).getByRole('checkbox'))
      await user.click(within(dpago).getByRole('button', { name: 'Confirmar pago' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Pago confirmado')
      await waitFor(async () => expect(within(within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')).getByText('Pagada')).toBeInTheDocument())
      expect(await q(`select beneficiario, referencia from public.comision_movimientos where tipo = 'pago'`)).toEqual({ beneficiario: 'Carlos Corredor', referencia: 'TRF-1' })
      f2.unmount()
    } finally {
      await formalizar(false)
    }

    // Corredor: consulta su comisión, sin acciones ni datos bancarios.
    const c = await abrirComo(carlos)
    const propia = await tarjeta(v.codigo)
    expect(within(within(propia).getByLabelText('Tramo 1')).getByText('Pagada')).toBeInTheDocument()
    expect(within(propia).queryByText(/TRF-1/)).not.toBeInTheDocument()
    expect(within(propia).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cambiar porcentaje/ })).not.toBeInTheDocument()
    c.unmount()
  })

  it('Ventas muestra el vendedor y su comisión en la lista y en la ficha', async () => {
    const user = userEvent.setup()
    const v = await venta('Venta con comisión')
    const monto = (await q<{ m: string }>(`select monto_total as m from public.comisiones where contract_id = $1`, [v.id])).m
    const g = await abrirComo(gerente, <VentasPage />)
    const fila = await screen.findByRole('row', { name: `Abrir ${v.codigo}` })
    expect(within(fila).getByText('Carlos Corredor')).toBeInTheDocument()
    expect(within(fila).getByText(`${fmtUsd2(Number(monto))} · pendiente`)).toBeInTheDocument()
    await user.click(fila)
    expect(await screen.findByText(/Comisión del vendedor/)).toBeInTheDocument()
    g.unmount()
  })

  it('un error del servidor se muestra sin cerrar el diálogo ni cambiar datos', async () => {
    const user = userEvent.setup()
    const v = await venta('Error Pantalla')
    await pagarSeisPorCiento(v)
    await formalizar(true)
    try {
      const a = await abrirComo(finanzas)
      const t1 = within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')
      await user.click(within(t1).getByRole('button', { name: 'Confirmar pago' }))
      const d = await screen.findByRole('dialog', { name: 'Confirmar pago a Carlos Corredor' })
      const manana = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
      await user.clear(within(d).getByLabelText(/Fecha de pago/))
      await user.type(within(d).getByLabelText(/Fecha de pago/), manana)
      await user.type(within(d).getByLabelText(/Comprobante de la transferencia/), 'TRF-9')
      await user.click(within(d).getByRole('checkbox'))
      await user.click(within(d).getByRole('button', { name: 'Confirmar pago' }))
      expect(await within(d).findByText(/La fecha de pago no es válida/)).toBeInTheDocument()
      expect(within(d).getByLabelText(/Comprobante de la transferencia/)).toHaveValue('TRF-9')
      expect(await q(`select count(*)::int as n from public.comision_movimientos where tipo = 'pago'`)).toEqual({ n: 1 })
      a.unmount()
    } finally {
      await formalizar(false)
    }
  })
})
