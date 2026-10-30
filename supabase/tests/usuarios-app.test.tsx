// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

async function pantalla(acciones = { enviarRecuperacion: vi.fn(async () => {}), invitar: vi.fn(async () => {}) }) {
  const s = await como(db, admin, async () => (await db.query<{ s: { permisos: string[]; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  render(
    <SessionProvider actorRemoto={{ id: admin, nombre: 'Carlos Tapia', rol: 'administrador', permisos: s.permisos, alcance: { tipo: 'empresa', usuarios: s.usuariosAlcance } }}>
      <UsuariosRemoto datos={datosPglite(db, admin)} acciones={acciones} />
    </SessionProvider>,
  )
  await screen.findByText(/cuentas en Supabase Authentication/)
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
  })

  it('cambia el rol con motivo y queda en la base de datos', async () => {
    await pantalla()
    fireEvent.click(within(fila('Vera')).getByRole('button', { name: 'Cambiar rol' }))
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'supervisor' } })
    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Ascenso aprobado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Rol de Vera actualizado')).toBeInTheDocument()
    expect((await db.query(`select rol_id from public.profiles where id = $1`, [vera])).rows[0]).toEqual({ rol_id: 'supervisor' })
  })

  it('desactiva y habilita cuentas', async () => {
    await pantalla()
    fireEvent.click(within(fila('Vera')).getByRole('button', { name: 'Desactivar' }))
    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Licencia temporal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Vera: acceso desactivado')).toBeInTheDocument()
    fireEvent.click(within(fila('pendiente@empresa.test')).getByRole('button', { name: 'Habilitar' }))
    fireEvent.change(screen.getByLabelText('Nombre visible'), { target: { value: 'Persona Nueva' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'finanzas' } })
    fireEvent.change(screen.getByLabelText('Motivo *'), { target: { value: 'Alta de Finanzas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText('Cuenta pendiente@empresa.test habilitada')).toBeInTheDocument()
    const r = await db.query(`select p.nombre, p.rol_id, p.estado from public.profiles p join auth.users u on u.id = p.id where u.email = 'pendiente@empresa.test'`)
    expect(r.rows[0]).toEqual({ nombre: 'Persona Nueva', rol_id: 'finanzas', estado: 'activo' })
  })

  it('envía la recuperación de contraseña de una cuenta', async () => {
    const acciones = await pantalla()
    fireEvent.click(within(fila('Persona Nueva')).getByRole('button', { name: /Recuperar clave/ }))
    expect(await screen.findByText('Se envió el enlace de recuperación a pendiente@empresa.test')).toBeInTheDocument()
    expect(acciones.enviarRecuperacion).toHaveBeenCalledWith('pendiente@empresa.test')
  })
})
