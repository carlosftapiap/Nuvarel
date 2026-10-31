// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import ComisionesPage from '@/pages/ComisionesPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string
let n = 990950000

const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function abrirComo(id: string) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><MemoryRouter><ComisionesPage /></MemoryRouter></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
async function venta(nombre: string) {
  const codigo = (await q<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
  const c = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: `0${++n}`, origen: 'whatsapp' }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoyGuayaquil()])).id
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

describe('Comisiones desde la app', () => {
  it('flujo por roles: Finanzas registra honorario, administración aprueba y habilita, Finanzas confirma, el corredor solo consulta', async () => {
    const user = userEvent.setup()
    const v = await venta('Venta Pantalla')
    // Se asegura el 10 % verificado en Cobranzas con el flujo real.
    const pagado = await q<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.payments where contract_id = $1 and estado = 'verificado'`, [v.id])
    const falta = Math.round((v.precio * 0.1 - Number(pagado.t)) * 100) / 100
    if (falta > 0) {
      const p = (await rpc<{ id: string }>(admin, `select public.cobranzas_reportar_pago($1::uuid, $2, $3::date, 'Banco de prueba', 'PAGO-UI', jsonb_build_object('ruta', 'contratos/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10)) as id`, [v.id, falta, hoyGuayaquil()])).id
      await rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, 'Ingreso conciliado')`, [p])
    }

    // Finanzas: sin política, se registra pero no se habilita.
    const f = await abrirComo(finanzas)
    expect(await screen.findByText(/Política de liquidación sin aprobación formal/)).toBeInTheDocument()
    let card = await tarjeta(v.codigo)
    let t1 = within(card).getByLabelText('Tramo 1')
    expect(within(t1).getByText('Pendiente de condiciones')).toBeInTheDocument()
    expect(within(t1).queryByRole('button', { name: 'Habilitar' })).not.toBeInTheDocument()
    await user.click(within(t1).getByRole('button', { name: 'Registrar honorario' }))
    const dh = await screen.findByRole('dialog', { name: 'Registrar honorario recibido' })
    expect(within(dh).getByRole('button', { name: 'Registrar honorario' })).toBeDisabled()
    await user.type(within(dh).getByLabelText(/Monto recibido/), '500')
    await user.type(within(dh).getByLabelText(/Referencia del ingreso/), 'FACT-77')
    await user.click(within(dh).getByRole('button', { name: 'Registrar honorario' }))
    expect(await screen.findByText('Honorario registrado')).toBeInTheDocument()
    await waitFor(async () => { within(within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')).getByText(/falta la aprobación formal/) })
    f.unmount()

    // Administración: registra la aprobación y habilita.
    const a = await abrirComo(admin)
    await user.click(await screen.findByRole('button', { name: 'Registrar aprobación' }))
    const dp = await screen.findByRole('dialog', { name: 'Registrar aprobación de la política' })
    await user.type(within(dp).getByLabelText(/Documento/), 'Acta 12')
    await user.type(within(dp).getByLabelText('Motivo *'), 'Dirección aprobó la política')
    await user.click(within(dp).getByRole('button', { name: 'Registrar aprobación' }))
    expect(await screen.findByText(/aprobada por Admin/)).toBeInTheDocument()
    card = await tarjeta(v.codigo)
    await user.click(within(within(card).getByLabelText('Tramo 1')).getByRole('button', { name: 'Habilitar' }))
    const dhab = await screen.findByRole('dialog', { name: 'Habilitar para liquidación' })
    await user.type(within(dhab).getByLabelText('Motivo *'), 'Conciliado con Administración')
    await user.click(within(dhab).getByRole('button', { name: 'Habilitar' }))
    expect(await screen.findByText('Tramo habilitado para liquidación')).toBeInTheDocument()
    // Quien habilitó no puede confirmar el pago, aunque tenga el permiso.
    await waitFor(async () => expect(within(within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')).getByText(/Lo habilitaste tú/)).toBeInTheDocument())
    expect(within(within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')).queryByRole('button', { name: 'Confirmar pago' })).not.toBeInTheDocument()
    a.unmount()

    // Finanzas: confirma expresamente.
    const f2 = await abrirComo(finanzas)
    card = await tarjeta(v.codigo)
    t1 = within(card).getByLabelText('Tramo 1')
    expect(within(t1).getByText('Habilitada para liquidación')).toBeInTheDocument()
    await user.click(within(t1).getByRole('button', { name: 'Confirmar pago' }))
    const dpago = await screen.findByRole('dialog', { name: 'Confirmar pago' })
    await user.type(within(dpago).getByLabelText(/Pagado a/), 'Carlos Corredor')
    await user.type(within(dpago).getByLabelText(/Referencia del pago/), 'TRF-1')
    expect(within(dpago).getByRole('button', { name: 'Confirmar pago' })).toBeDisabled()
    await user.click(within(dpago).getByRole('checkbox'))
    await user.click(within(dpago).getByRole('button', { name: 'Confirmar pago' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Pago confirmado')
    await waitFor(async () => expect(within(within(await tarjeta(v.codigo)).getByLabelText('Tramo 1')).getByText('Pagada')).toBeInTheDocument())
    expect(await q(`select count(*)::int as n from public.comision_movimientos where tipo = 'pago'`)).toEqual({ n: 1 })
    f2.unmount()

    // Corredor: consulta su comisión, sin acciones ni datos bancarios.
    const c = await abrirComo(carlos)
    const propia = await tarjeta(v.codigo)
    expect(within(within(propia).getByLabelText('Tramo 1')).getByText('Pagada')).toBeInTheDocument()
    expect(within(propia).queryByText(/TRF-1/)).not.toBeInTheDocument()
    expect(within(propia).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cambiar porcentaje/ })).not.toBeInTheDocument()
    c.unmount()
  })

  it('un error del servidor se muestra sin cerrar el diálogo ni cambiar datos', async () => {
    const user = userEvent.setup()
    const v = await venta('Error Pantalla')
    const a = await abrirComo(finanzas)
    const t2 = within(await tarjeta(v.codigo)).getByLabelText('Tramo 2')
    await user.click(within(t2).getByRole('button', { name: 'Registrar honorario' }))
    const d = await screen.findByRole('dialog', { name: 'Registrar honorario recibido' })
    await user.type(within(d).getByLabelText(/Monto recibido/), '-5')
    await user.type(within(d).getByLabelText(/Referencia del ingreso/), 'FACT-9')
    await user.click(within(d).getByRole('button', { name: 'Registrar honorario' }))
    expect(await within(d).findByText(/Indica el monto recibido/)).toBeInTheDocument()
    expect(within(d).getByLabelText(/Referencia del ingreso/)).toHaveValue('FACT-9')
    a.unmount()
  })
})
