// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let vera: string

async function abrir(url = '/clientes') {
  const s = await como(db, vera, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, vera), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider><ClientesProvider><ReservasProvider>
          <MemoryRouter initialEntries={[url]}><ClientesPage /></MemoryRouter>
        </ReservasProvider></ClientesProvider></InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

interface FilaCliente { id: string; nombre: string; primer_nombre: string | null; segundo_nombre: string | null; primer_apellido: string | null; segundo_apellido: string | null; version: number }
const cliente = async (telefono: string) => (await db.query<FilaCliente>(`select * from public.clients where telefono = $1`, [telefono])).rows[0]
const rpc = (sql: string, p: unknown[] = []) => como(db, vera, () => db.query(sql, p))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('amura.clientes.vista', 'tablero')
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
}, 60_000)

describe('nombres y apellidos del cliente', () => {
  it('el formulario exige primer nombre y primer apellido, y guarda los cuatro campos en la base', async () => {
    const user = userEvent.setup()
    const s = await abrir()
    await user.click((await screen.findAllByRole('button', { name: /Nuevo cliente/ }))[0])
    const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
    expect(within(dlg).queryByLabelText('Nombre *')).toBeNull()
    await user.type(within(dlg).getByLabelText('Teléfono'), '0991000001')
    await user.click(within(dlg).getByRole('button', { name: 'Registrar cliente' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(/primer nombre/)
    expect(await cliente('0991000001')).toBeUndefined()

    await user.type(within(dlg).getByLabelText('Primer nombre *'), 'María')
    await user.type(within(dlg).getByLabelText('Primer apellido *'), 'Pérez')
    await user.type(within(dlg).getByLabelText('Segundo apellido'), 'de la  Torre')
    expect(within(dlg).getByText('María Pérez de la Torre')).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Registrar cliente' }))
    await screen.findByRole('dialog', { name: /María Pérez de la Torre/ })
    expect(await cliente('0991000001')).toMatchObject({ nombre: 'María Pérez de la Torre', primer_nombre: 'María', segundo_nombre: null, primer_apellido: 'Pérez', segundo_apellido: 'de la Torre' })
    s.unmount()
  }, 60_000)

  it('el servidor valida y genera el nombre aunque la app envíe otro', async () => {
    const crear = (d: object) => rpc(`select public.clientes_crear(null, $1::jsonb, $2)`, [JSON.stringify({ telefono: '0991000002', origen: 'instagram', ...d }), vera])
    await expect(crear({ primer_nombre: 'Ana', primer_apellido: ' ' })).rejects.toThrow(/primer apellido/)
    await expect(crear({ primer_nombre: '', primer_apellido: '' })).rejects.toThrow(/primer nombre/)
    await crear({ nombre: 'Otro Texto', primer_nombre: ' Ana ', segundo_nombre: 'Luz', primer_apellido: 'Ruiz' })
    expect(await cliente('0991000002')).toMatchObject({ nombre: 'Ana Luz Ruiz', primer_nombre: 'Ana', segundo_nombre: 'Luz', primer_apellido: 'Ruiz', segundo_apellido: null })
  })

  it('un cliente antiguo conserva su nombre, se edita sin dividirlo y luego se puede completar', async () => {
    await rpc(`select public.clientes_crear(null, '{"nombre": "José María de la Vega", "telefono": "0991000003", "origen": "instagram"}'::jsonb, $1)`, [vera])
    const antes = await cliente('0991000003')
    expect(antes).toMatchObject({ nombre: 'José María de la Vega', primer_nombre: null, primer_apellido: null })

    const editar = (d: object, v: number) => rpc(`select public.clientes_editar($1, $2, $3::jsonb)`, [antes.id, v, JSON.stringify({ nombre: 'José María de la Vega', telefono: '0991000003', email: 'jose@correo.com', origen: 'instagram', ...d })])
    await editar({ primer_nombre: '', segundo_nombre: '', primer_apellido: '', segundo_apellido: '' }, antes.version)
    const editado = await cliente('0991000003')
    expect(editado).toMatchObject({ nombre: 'José María de la Vega', primer_nombre: null })

    await editar({ primer_nombre: 'José', segundo_nombre: 'María', primer_apellido: 'de la Vega' }, editado.version)
    const completo = await cliente('0991000003')
    expect(completo).toMatchObject({ nombre: 'José María de la Vega', primer_nombre: 'José', segundo_nombre: 'María', primer_apellido: 'de la Vega' })

    // Ya completo, no puede quedar sin ellos.
    await expect(editar({ primer_nombre: '', primer_apellido: '' }, completo.version)).rejects.toThrow(/primer nombre/)
  })

  it('los documentos nuevos reciben los campos; el nombre completo sigue disponible', async () => {
    const src = (await db.query<{ d: string }>(`select pg_get_functiondef('public.contratos_datos_documento(uuid, jsonb)'::regprocedure) as d`)).rows[0].d
    expect(src).toMatch(/'primer_apellido', coalesce\(cl\.primer_apellido/)
    expect(src).toMatch(/'nombre', cl\.nombre/)
    const campos = await db.query<{ clave: string }>(`select clave from public.contract_fields where clave like 'comprador.%nombre' or clave like 'comprador.%apellido' order by clave`)
    expect(campos.rows.map((c) => c.clave)).toEqual(['comprador.nombre', 'comprador.primer_apellido', 'comprador.primer_nombre', 'comprador.segundo_apellido', 'comprador.segundo_nombre'])
  })
})
