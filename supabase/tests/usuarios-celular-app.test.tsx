// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { SessionProvider } from '@/app/session'
import UsuariosRemoto from '@/features/config/remoto/UsuariosRemoto'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, vera: string

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin Pantalla', 'administrador')
  vera = await crearUsuario(db, 'Vera Pantalla', 'asesor')
}, 120_000)
afterEach(cleanup)

async function pantalla() {
  const s = await como(db, admin, async () => (await db.query<{ s: { permisos: string[]; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  render(
    <SessionProvider actorRemoto={{ id: admin, nombre: 'Admin Pantalla', rol: 'administrador', permisos: s.permisos, alcance: { tipo: 'empresa', usuarios: s.usuariosAlcance } }}>
      <UsuariosRemoto datos={datosPglite(db, admin)} acciones={{ crearUsuario: vi.fn(async () => {}), cambiarClave: vi.fn(async () => {}) }} />
    </SessionProvider>,
  )
  await screen.findByRole('heading', { name: /\d+ usuarios/ })
}
const fila = (texto: string) => screen.getAllByText(texto)[0].closest('tr')!

describe('Configuración > Usuarios · celular / WhatsApp', () => {
  it('el administrador edita el celular: valida, muestra el formato final y queda visible en la lista', async () => {
    await pantalla()
    fireEvent.click(within(fila('Vera Pantalla')).getByRole('button', { name: 'Editar' }))
    const campo = await screen.findByLabelText(/Celular \/ WhatsApp/)
    fireEvent.change(campo, { target: { value: '099' } })
    expect(screen.getByText(/Escribe 09XXXXXXXX/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    fireEvent.change(campo, { target: { value: '0991234567' } })
    expect(screen.getByText('Se guardará como +593991234567')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Celular guardado: +593991234567')).toBeInTheDocument()
    expect(within(fila('Vera Pantalla')).getByText('Cel. +593991234567')).toBeInTheDocument()
    expect((await db.query<{ celular: string }>(`select celular from public.usuarios_contacto where user_id = $1`, [vera])).rows[0].celular).toBe('+593991234567')
  })

  it('el celular es opcional: editar sin escribirlo no lo exige', async () => {
    await pantalla()
    fireEvent.click(within(fila('Admin Pantalla')).queryByRole('button', { name: 'Editar' }) ?? within(fila('Vera Pantalla')).getByRole('button', { name: 'Editar' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })
})
