// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import ReservasPage from '@/pages/ReservasPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, cora: string
let n = 990700000

const q = <T,>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows[0])
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrirComo(id: string, url: string) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><ClientesProvider><ReservasProvider>
        <MemoryRouter initialEntries={[url]}><Routes><Route path="/clientes" element={<ClientesPage />} /><Route path="/reservas" element={<ReservasPage />} /></Routes></MemoryRouter>
      </ReservasProvider></ClientesProvider></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
const unidadLibre = async () => (await q<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
const nuevoCliente = async (u: string, nombre: string) => (await rpc<{ id: string }>(u, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre, telefono: `0${++n}`, origen: 'whatsapp' }), u])).id
async function aprobada(u: string, c: string, codigo: string) {
  const op = (await rpc<{ id: string }>(u, `select public.oportunidades_crear($1, $2, null) as id`, [c, codigo])).id
  const cot = (await rpc<{ id: string }>(u, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(u, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(u, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(u, `select public.reservas_adjuntar_comprobante($1, $2, null)`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await q<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_verificar_pago($1, $2, $3::date, $4, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  return { op, r }
}
async function elegir(user: ReturnType<typeof userEvent.setup>, etiqueta: string | RegExp, opcion: string | RegExp) {
  await user.click(screen.getByLabelText(etiqueta))
  await user.click(await screen.findByRole('option', { name: opcion }))
}

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
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('Registrar desistimiento desde la app', () => {
  it('el corredor lo hace desde la ficha: ve qué ocurrirá, confirma, y la unidad queda libre', async () => {
    const user = userEvent.setup()
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Lucía Desiste')
    const { op, r } = await aprobada(carlos, c, codigo)
    await abrirComo(carlos, `/clientes?cliente=${c}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Desiste/ })
    await user.click(await within(ficha).findByRole('button', { name: 'Registrar desistimiento' }))
    const d = await screen.findByRole('dialog', { name: 'Registrar desistimiento' })
    expect(within(d).getByRole('button', { name: 'Confirmar desistimiento' })).toBeDisabled()
    await within(d).findByText(/se anula/)
    expect(within(d).getByText(/pasa a disponible/)).toBeInTheDocument()
    expect(within(d).getByText(/queda pendiente de revisión de Finanzas/)).toBeInTheDocument()
    await elegir(user, 'Motivo *', 'No obtuvo financiamiento')
    await user.type(within(d).getByLabelText(/Observaciones/), 'El banco negó el crédito')
    await user.click(within(d).getByRole('button', { name: 'Confirmar desistimiento' }))
    expect(await screen.findByText('Desistimiento registrado')).toBeInTheDocument()

    expect(await q(`select estado from public.inventory_units where codigo = $1`, [codigo])).toEqual({ estado: 'disponible' })
    expect(await q(`select estado from public.reservations where id = $1`, [r])).toEqual({ estado: 'anulada' })
    expect(await q(`select etapa from public.opportunities where id = $1`, [op])).toEqual({ etapa: 'perdida' })
    // El historial queda en la ficha.
    const ficha2 = await screen.findByRole('dialog', { name: /Lucía Desiste/ })
    expect(await within(ficha2).findByText('No obtuvo financiamiento')).toBeInTheDocument()
    expect(within(ficha2).getByText(/El banco negó el crédito · /, { exact: false, selector: 'div' })).toBeTruthy()
    expect(within(ficha2).getByText(/Pendiente de revisión de Finanzas/)).toBeInTheDocument()
    expect(within(ficha2).queryByRole('button', { name: 'Registrar desistimiento' })).not.toBeInTheDocument()
  })

  it('desde Clientes se elige cliente y operación; un contrato vigente impide confirmar', async () => {
    const user = userEvent.setup()
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Con Contrato Vigente')
    const { r } = await aprobada(carlos, c, codigo)
    await rpc(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba')`, [r, hoyGuayaquil()])
    await abrirComo(carlos, '/clientes')
    await screen.findByRole('button', { name: `Abrir ficha de Con Contrato Vigente` })
    await user.click(screen.getAllByRole('button', { name: 'Registrar desistimiento' })[0])
    const d = await screen.findByRole('dialog', { name: 'Registrar desistimiento' })
    await elegir(user, 'Cliente *', 'Con Contrato Vigente')
    expect(await within(d).findByRole('alert')).toHaveTextContent(/contrato vigente/)
    await elegir(user, 'Motivo *', 'Precio o condiciones')
    expect(within(d).getByRole('button', { name: 'Confirmar desistimiento' })).toBeDisabled()
    expect(await q(`select estado from public.reservations where id = $1`, [r])).toEqual({ estado: 'confirmada' })
  })

  it('desde Reservas, y Finanzas ve el caso por revisar', async () => {
    const user = userEvent.setup()
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Desde Reservas')
    const { r } = await aprobada(carlos, c, codigo)
    const s = await abrirComo(carlos, '/reservas')
    const fila = (await screen.findByRole('cell', { name: 'Desde Reservas' })).closest('tr')!
    expect(within(fila).queryByRole('button', { name: 'Anular' })).not.toBeInTheDocument()
    await user.click(within(fila).getByRole('button', { name: 'Desistimiento' }))
    const d = await screen.findByRole('dialog', { name: 'Registrar desistimiento' })
    await within(d).findByText(/se anula/)
    await elegir(user, 'Motivo *', 'Cambió de decisión')
    await user.click(within(d).getByRole('button', { name: 'Confirmar desistimiento' }))
    expect(await screen.findByText('Desistimiento registrado')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByRole('cell', { name: 'Desde Reservas' }).closest('tr')!).getByText('Anulada')).toBeInTheDocument())
    expect(await q(`select estado from public.reservations where id = $1`, [r])).toEqual({ estado: 'anulada' })
    s.unmount()

    const f = await abrirComo(finanzas, '/reservas')
    const seccion = await screen.findByRole('region', { name: 'Desistimientos por revisar' })
    const item = within(seccion).getByText('Desde Reservas').closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Marcar revisado' }))
    const dr = await screen.findByRole('dialog', { name: /Revisar desistimiento/ })
    await user.type(within(dr).getByLabelText('Resolución *'), 'Retención según política comercial')
    await user.click(within(dr).getByRole('button', { name: 'Marcar revisado' }))
    expect(await screen.findByText('Desistimiento marcado como revisado')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.queryByRole('region', { name: 'Desistimientos por revisar' }) ?? document.createElement('div')).queryByText('Desde Reservas')).not.toBeInTheDocument())
    f.unmount()
  })

  it('un error del servidor se muestra sin perder lo escrito ni cambiar datos', async () => {
    const user = userEvent.setup()
    const codigo = await unidadLibre()
    const c = await nuevoCliente(carlos, 'Falla Servidor')
    const { r } = await aprobada(carlos, c, codigo)
    await abrirComo(carlos, `/clientes?cliente=${c}`)
    const ficha = await screen.findByRole('dialog', { name: /Falla Servidor/ })
    await user.click(await within(ficha).findByRole('button', { name: 'Registrar desistimiento' }))
    const d = await screen.findByRole('dialog', { name: 'Registrar desistimiento' })
    await within(d).findByText(/se anula/)
    await elegir(user, 'Motivo *', 'Motivos personales')
    await user.type(within(d).getByLabelText(/Observaciones/), 'Texto que no se debe perder')
    await db.exec(`create function pg_temp.falla2() returns trigger language plpgsql as $$ begin if new.accion = 'Registrar desistimiento' then raise exception 'Fallo simulado del servidor'; end if; return new; end $$;
      create trigger falla_app before insert on public.audit_log for each row execute function pg_temp.falla2();`)
    await user.click(within(d).getByRole('button', { name: 'Confirmar desistimiento' }))
    expect(await within(d).findByText(/Fallo simulado del servidor/)).toBeInTheDocument()
    await db.exec(`drop trigger falla_app on public.audit_log`)
    expect(within(d).getByLabelText(/Observaciones/)).toHaveValue('Texto que no se debe perder')
    expect(await q(`select estado from public.reservations where id = $1`, [r])).toEqual({ estado: 'confirmada' })
    expect(await q(`select estado from public.inventory_units where codigo = $1`, [codigo])).toEqual({ estado: 'reservado' })
  })

  it('sin permiso no aparece la acción', async () => {
    const c = await nuevoCliente(carlos, 'Sin Acción')
    await aprobada(carlos, c, await unidadLibre())
    await abrirComo(legal, `/clientes?cliente=${c}`)
    const ficha = await screen.findByRole('dialog', { name: /Sin Acción/ })
    await within(ficha).findByText('Reserva aprobada')
    expect(within(ficha).queryByRole('button', { name: 'Registrar desistimiento' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar desistimiento', hidden: true })).not.toBeInTheDocument()
    expect(cora).toBeTruthy()
  })
})
