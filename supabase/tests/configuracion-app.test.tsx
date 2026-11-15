// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import EquiposRemoto from '@/features/config/remoto/EquiposRemoto'
import ReceptorPagos from '@/features/config/remoto/ReceptorPagos'
import RolesRemoto from '@/features/config/remoto/RolesRemoto'
import UsuariosRemoto, { AuditoriaRemota } from '@/features/config/remoto/UsuariosRemoto'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import ConfiguracionPage from '@/pages/ConfiguracionPage'
import InventarioPage from '@/pages/InventarioPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, vera: string, obra: string

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrir(id: string, ui: React.ReactNode) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><MemoryRouter>{ui}</MemoryRouter></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
const escribir = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Andrés Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  obra = await crearUsuario(db, 'Omar Constructor', 'constructor')
}, 60_000)

describe('Configuración: Usuarios', () => {
  const acciones = () => ({ crearUsuario: vi.fn(async () => {}), cambiarClave: vi.fn(async () => {}) })

  it('crea un usuario solo con nombre, correo, contraseña inicial y rol; no ofrece JARVAL', async () => {
    const a = acciones()
    await abrir(admin, <UsuariosRemoto datos={datosPglite(db, admin)} acciones={a} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Crear usuario' }))
    const d = await screen.findByRole('dialog', { name: 'Crear usuario' })
    expect(within(within(d).getByLabelText('Rol')).queryByRole('option', { name: /JARVAL/ })).toBeNull()
    for (const quitado of [/Motivo/, 'Alcance de datos', 'Equipo']) expect(within(d).queryByLabelText(quitado)).toBeNull()
    const crear = within(d).getByRole('button', { name: 'Crear usuario' })
    escribir('Nombre completo', 'Nora Nueva')
    escribir('Correo electrónico', 'correo-malo')
    escribir(/Contraseña inicial/, 'Clave-Inicial-1')
    expect(crear).toBeDisabled()
    escribir('Correo electrónico', 'NORA@amura.ec')
    escribir(/Contraseña inicial/, 'corta')
    expect(crear).toBeDisabled()
    escribir(/Contraseña inicial/, 'Clave-Inicial-1')
    escribir('Rol', 'corredor')
    fireEvent.click(crear)
    expect(await screen.findByText('Usuario nora@amura.ec creado y activo. Ya puede iniciar sesión con su correo y contraseña.')).toBeInTheDocument()
    expect(a.crearUsuario).toHaveBeenCalledWith({ nombre: 'Nora Nueva', email: 'nora@amura.ec', password: 'Clave-Inicial-1', rolId: 'corredor' })
  })

  it('las opciones avanzadas cambian el alcance sin estorbar lo habitual', async () => {
    const a = acciones()
    await abrir(admin, <UsuariosRemoto datos={datosPglite(db, admin)} acciones={a} />)
    const fila = (await screen.findAllByText('Vera Vendedora'))[0].closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: 'Cambiar rol' }))
    await screen.findByRole('dialog', { name: /Cambiar rol/ })
    escribir('Alcance de datos', 'equipo')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Acceso de Vera Vendedora actualizado')).toBeInTheDocument()
    expect((await db.query(`select alcance from public.profiles where id = $1`, [vera])).rows[0]).toEqual({ alcance: 'equipo' })
  })

  it('un error del servidor se muestra dentro del formulario', async () => {
    const a = acciones()
    a.crearUsuario.mockRejectedValueOnce(new Error('Ya existe una cuenta con ese correo'))
    await abrir(admin, <UsuariosRemoto datos={datosPglite(db, admin)} acciones={a} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Crear usuario' }))
    const d = await screen.findByRole('dialog', { name: 'Crear usuario' })
    escribir('Nombre completo', 'Nora Nueva')
    escribir('Correo electrónico', 'nora@amura.ec'); escribir(/Contraseña inicial/, 'Clave-Inicial-1')
    fireEvent.click(screen.getByRole('button', { name: 'Crear usuario' }))
    expect(await within(d).findByText('Ya existe una cuenta con ese correo')).toBeInTheDocument()
  })
})

describe('Configuración: Roles y permisos', () => {
  it('muestra la matriz por módulo y acción; un cambio se guarda en la base y queda en la auditoría', async () => {
    const r = await abrir(admin, <RolesRemoto datos={datosPglite(db, admin)} />)
    fireEvent.click(await screen.findByRole('button', { name: /^Vendedor/ }))
    const matriz = await screen.findByRole('table', { name: 'Permisos por módulo y acción' })
    for (const c of ['Ver', 'Crear y editar', 'Aprobar', 'Anular', 'Otras']) expect(within(matriz).getByRole('columnheader', { name: c })).toBeInTheDocument()
    const cobranzas = within(matriz).getByRole('rowheader', { name: 'Cobranzas' }).closest('tr')!
    expect(within(cobranzas).getByRole('checkbox', { name: 'Consultar cobranzas' })).toBeChecked()
    expect(within(cobranzas).getByRole('checkbox', { name: 'Verificar y conciliar ingresos' })).not.toBeChecked()
    expect(within(cobranzas).getByRole('checkbox', { name: 'Consultar cobranzas' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const edicion = await screen.findByRole('table', { name: 'Permisos por módulo y acción' })
    fireEvent.click(within(edicion).getByRole('checkbox', { name: 'Exportar clientes' }))
    const guardar = screen.getByRole('button', { name: 'Guardar rol' })
    expect(guardar).toBeDisabled()
    escribir(/Motivo del cambio/, 'Puede exportar su cartera')
    fireEvent.click(guardar)
    expect(await screen.findByText('Rol Vendedor guardado')).toBeInTheDocument()
    expect((await db.query(`select 1 from public.role_permissions where role_id = 'asesor' and permiso = 'clientes.exportar'`)).rows).toHaveLength(1)
    r.unmount()

    await abrir(admin, <AuditoriaRemota datos={datosPglite(db, admin)} />)
    const fila = (await screen.findByText('Editar rol')).closest('tr')!
    expect(within(fila).getByText('Andrés Admin')).toBeInTheDocument()
    expect(within(fila).getByText(/Puede exportar su cartera/)).toBeInTheDocument()
    expect(within(fila).getByText(/Después:.*clientes.exportar/)).toBeInTheDocument()
  })

  it('un perfil inicial no se puede eliminar; JARVAL aparece como no disponible para cuentas nuevas', async () => {
    await abrir(admin, <RolesRemoto datos={datosPglite(db, admin)} />)
    expect((await screen.findByRole('button', { name: /JARVAL/ }))).toHaveTextContent(/no disponible para cuentas nuevas/)
    fireEvent.click(screen.getByRole('button', { name: /^Gerencia/ }))
    await screen.findByRole('heading', { name: 'Gerencia' })
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument()
  })
})

describe('Configuración: Equipos', () => {
  it('crea un equipo con supervisor y muestra a sus integrantes', async () => {
    const sup = await crearUsuario(db, 'Sofía Supervisora', 'supervisor')
    const onCambio = vi.fn()
    await abrir(admin, <EquiposRemoto datos={datosPglite(db, admin)} onCambio={onCambio} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo equipo' }))
    await screen.findByRole('dialog', { name: 'Nuevo equipo' })
    escribir('Nombre *', 'Equipo Sur')
    escribir('Supervisor', sup)
    escribir('Motivo *', 'Nuevo equipo comercial')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar equipo' }))
    expect(await screen.findByText('Equipo Equipo Sur guardado')).toBeInTheDocument()
    expect(await screen.findByText(/Supervisor: Sofía Supervisora/)).toBeInTheDocument()
    expect(onCambio).toHaveBeenCalled()
  })

  it('al asignar un vendedor a un equipo, el equipo lo muestra de inmediato', async () => {
    await abrir(admin, <ConfiguracionPage />)
    const equipo = (await screen.findByText('Equipo Sur')).closest('li')!
    expect(within(equipo).getByText(/Sin integrantes/)).toBeInTheDocument()
    const fila = (await screen.findAllByText('Vera Vendedora'))[0].closest('tr')!
    fireEvent.click(within(fila).getByRole('button', { name: 'Cambiar rol' }))
    await screen.findByRole('dialog', { name: /Cambiar rol/ })
    const sur = within(screen.getByLabelText(/^Equipo .su Supervisor/)).getByRole('option', { name: 'Equipo Sur' }) as HTMLOptionElement
    escribir(/^Equipo .su Supervisor/, sur.value)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Acceso de Vera Vendedora actualizado')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByText('Equipo Sur').closest('li')!).getByText('Vera Vendedora')).toBeInTheDocument())
    expect(within(screen.getByText('Equipo Sur').closest('li')!).queryByText(/Sin integrantes/)).toBeNull()
  })
})

describe('Configuración: Receptor de pagos', () => {
  it('avisa si falta, se define con motivo y queda en la base', async () => {
    await abrir(admin, <ReceptorPagos datos={datosPglite(db, admin)} />)
    expect(await screen.findByText(/Sin definir: Finanzas no puede verificar pagos/)).toBeInTheDocument()
    escribir('Quién recibe los pagos', 'NUVAREL')
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    escribir('Motivo *', 'Definido por administración')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Receptor de pagos: NUVAREL')).toBeInTheDocument()
    expect(await screen.findByText('Los pagos los recibe NUVAREL.')).toBeInTheDocument()
    expect((await db.query(`select receptor from public.payment_settings where id = 1`)).rows[0]).toEqual({ receptor: 'NUVAREL' })
  })
})

describe('Constructor', () => {
  it('ve solo la información técnica del inventario, sin precios', async () => {
    await abrir(obra, <InventarioPage />)
    expect(await screen.findByRole('heading', { name: 'Información técnica' })).toBeInTheDocument()
    await screen.findByText('E1-PB-A1')
    expect(screen.getAllByText('2 hab').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/\$|USD|Precio|Disponible|Reserv/)
  })

  it('el vendedor sigue viendo el inventario comercial', async () => {
    await abrir(vera, <InventarioPage />)
    expect(await screen.findByRole('heading', { name: 'Inventario inmobiliario' })).toBeInTheDocument()
    await screen.findByRole('row', { name: /A001/ })
  })
})
