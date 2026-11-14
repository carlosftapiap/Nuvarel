// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { SessionProvider } from '@/app/session'
import UsuariosRemoto from '@/features/config/remoto/UsuariosRemoto'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, vera: string

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Carlos Tapia', 'administrador')
  vera = await crearUsuario(db, 'Vera', 'asesor')
  await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'pendiente@empresa.test')`)
}, 60_000)

async function pantalla(acciones = { crearUsuario: vi.fn(async () => {}), cambiarClave: vi.fn(async () => {}) }) {
  const s = await como(db, admin, async () => (await db.query<{ s: { permisos: string[]; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  render(
    <SessionProvider actorRemoto={{ id: admin, nombre: 'Carlos Tapia', rol: 'administrador', permisos: s.permisos, alcance: { tipo: 'empresa', usuarios: s.usuariosAlcance } }}>
      <UsuariosRemoto datos={datosPglite(db, admin)} acciones={acciones} />
    </SessionProvider>,
  )
  await screen.findByRole('heading', { name: /\d+ usuarios/ })
  return acciones
}

// Una cuenta sin perfil muestra su correo como nombre y como correo.
const fila = (texto: string) => screen.getAllByText(texto)[0].closest('tr')!

describe('Configuración · usuarios reales (Postgres con RLS)', () => {
  it('lista las cuentas con su estado; la propia no tiene acciones de rol ni estado', async () => {
    await pantalla()
    expect(within(fila('pendiente@empresa.test')).getByText('Sin perfil (sin acceso)')).toBeInTheDocument()
    expect(within(fila('Vera')).getByText('Activo')).toBeInTheDocument()
    expect(within(fila('Carlos Tapia')).queryByRole('button', { name: 'Cambiar rol' })).toBeNull()
    expect(within(fila('Carlos Tapia')).queryByRole('button', { name: 'Desactivar' })).toBeNull()
  })

  it('cambia el rol sin pasos de más y queda en la base y en la auditoría', async () => {
    await pantalla()
    fireEvent.click(within(fila('Vera')).getByRole('button', { name: 'Cambiar rol' }))
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Acceso de Vera actualizado')).toBeInTheDocument()
    expect((await db.query(`select rol_id from public.profiles where id = $1`, [vera])).rows[0]).toEqual({ rol_id: 'supervisor' })
    const log = (await db.query<{ motivo: string; actor_id: string }>(`select motivo, actor_id from public.audit_log where entidad_id = $1 order by fecha desc limit 1`, [vera])).rows[0]
    expect(log.motivo).toMatch(/Cambio de acceso/)
    expect(log.actor_id).toBeTruthy()
  })

  it('desactiva, vuelve a activar y habilita cuentas', async () => {
    await pantalla()
    fireEvent.click(within(fila('Vera')).getByRole('button', { name: 'Desactivar' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByText('Vera: acceso desactivado')).toBeInTheDocument()
    expect((await db.query(`select estado from public.profiles where id = $1`, [vera])).rows[0]).toEqual({ estado: 'inactivo' })
    await waitFor(() => expect(within(fila('Vera')).getByText('Desactivado')).toBeInTheDocument())
    fireEvent.click(within(fila('Vera')).getByRole('button', { name: 'Activar' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Activar' }))
    expect(await screen.findByText('Vera: acceso activado')).toBeInTheDocument()
    fireEvent.click(within(fila('pendiente@empresa.test')).getByRole('button', { name: 'Habilitar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Persona Nueva' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'finanzas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Cuenta pendiente@empresa.test habilitada')).toBeInTheDocument()
  })

  it('restablece la contraseña de otra cuenta sin correos; la propia no se ofrece', async () => {
    const acciones = await pantalla()
    expect(within(fila('Carlos Tapia')).queryByRole('button', { name: /Restablecer contraseña/ })).toBeNull()
    fireEvent.click(within(fila('Persona Nueva')).getByRole('button', { name: /Restablecer contraseña/ }))
    const guardar = await screen.findByRole('button', { name: 'Guardar contraseña' })
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/), { target: { value: 'corta' } })
    expect(guardar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/), { target: { value: 'Otra-Clave-22' } })
    fireEvent.click(guardar)
    expect(await screen.findByText('Contraseña de Persona Nueva actualizada')).toBeInTheDocument()
    expect(acciones.cambiarClave).toHaveBeenCalledWith(expect.objectContaining({ password: 'Otra-Clave-22' }))
  })
})
