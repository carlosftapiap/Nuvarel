import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/** Supabase Auth simulado: no hay red ni cuentas reales; se prueba el comportamiento de la app. */
type Cb = (evento: string, session: unknown) => void
const sb = vi.hoisted(() => {
  const estado = { session: null as unknown, cb: null as Cb | null, perfil: null as unknown }
  const sesion = (email: string) => ({ user: { id: 'u1', email }, access_token: 't' })
  return {
    estado,
    supabase: {
      auth: {
        getSession: vi.fn(async () => ({ data: { session: estado.session } })),
        onAuthStateChange: vi.fn((cb: Cb) => { estado.cb = cb; return { data: { subscription: { unsubscribe: () => {} } } } }),
        signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
          if (password !== 'clave-correcta') return { error: { message: 'Invalid login credentials' } }
          estado.session = sesion(email)
          estado.cb?.('SIGNED_IN', estado.session)
          return { error: null }
        }),
        resetPasswordForEmail: vi.fn(async () => ({ error: null })),
        updateUser: vi.fn(async () => ({ error: null })),
        signOut: vi.fn(async () => { estado.session = null; estado.cb?.('SIGNED_OUT', null) }),
      },
      rpc: vi.fn(async (fn: string) => (fn === 'mi_sesion' ? { data: estado.perfil, error: null } : { data: null, error: { message: 'no' } })),
    },
  }
})
vi.mock('@/lib/supabase', () => ({ supabase: sb.supabase, supabaseConfigured: true }))

const { AuthProvider, RequireAuth, useConexion } = await import('@/app/auth')
const { useSession } = await import('@/app/session')
const { default: LoginPage } = await import('@/pages/LoginPage')

function Privada() {
  const { actor, can } = useSession()
  const { salir } = useConexion()
  const { pathname } = useLocation()
  return <div><p>Dashboard de {actor.nombre}</p><p>Ruta {pathname}</p><p>{can('config.usuarios') ? 'Puede administrar usuarios' : 'Sin administración'}</p><button onClick={() => void salir()}>Salir</button></div>
}

const app = (ruta = '/') => render(
  <MemoryRouter initialEntries={[ruta]}>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<RequireAuth><Privada /></RequireAuth>} />
      </Routes>
    </AuthProvider>
  </MemoryRouter>,
)

const perfilAdmin = { id: 'u1', nombre: 'Carlos Tapia', email: 'admin@empresa.test', estado: 'activo', rol: 'administrador', rolNombre: 'Administrador', alcance: 'empresa', permisos: ['dashboard.ver', 'config.usuarios'], usuariosAlcance: ['u1'], proyectos: ['AMURA'] }

beforeEach(() => {
  sb.estado.session = null
  sb.estado.perfil = perfilAdmin
  vi.clearAllMocks()
})

describe('inicio de sesión y rutas protegidas', () => {
  it('sin sesión, una ruta privada lleva a /login', async () => {
    app('/plan')
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(screen.queryByText(/Dashboard/)).toBeNull()
  })

  it('credenciales incorrectas muestran un error claro', async () => {
    app('/login')
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), { target: { value: 'admin@empresa.test' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'otra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.')
  })

  it('mostrar u ocultar la contraseña', async () => {
    app('/login')
    const clave = await screen.findByLabelText('Contraseña')
    expect(clave).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(clave).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(clave).toHaveAttribute('type', 'password')
  })

  it('al iniciar sesión entra al inicio de su perfil, no a la ruta que quedó de otra sesión, con los permisos de la base', async () => {
    app('/plan')
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), { target: { value: 'Admin@Empresa.test ' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-correcta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('Dashboard de Carlos Tapia')).toBeInTheDocument()
    expect(screen.getByText('Puede administrar usuarios')).toBeInTheDocument()
    expect(screen.getByText('Ruta /')).toBeInTheDocument()
    expect(sb.supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@empresa.test', password: 'clave-correcta' })
  })

  it('si otra cuenta inicia sesión en el mismo navegador, se descartan los datos cargados del usuario anterior', async () => {
    let montajes = 0
    function ConDatos() {
      const [cargado] = useState(() => { montajes += 1; return montajes })
      const { actor } = useSession()
      return <p>{actor.nombre} · carga {cargado}</p>
    }
    sb.estado.session = { user: { id: 'u1', email: 'admin@empresa.test' } }
    render(<MemoryRouter><AuthProvider><Routes><Route path="/*" element={<RequireAuth><ConDatos /></RequireAuth>} /></Routes></AuthProvider></MemoryRouter>)
    expect(await screen.findByText('Carlos Tapia · carga 1')).toBeInTheDocument()
    // Otra pestaña entra con la cuenta de un vendedor: Supabase avisa SIGNED_IN con la nueva sesión.
    sb.estado.perfil = { ...perfilAdmin, id: 'u2', nombre: 'Vera Vendedora', rol: 'asesor', permisos: ['dashboard.ver'] }
    await act(async () => { sb.estado.cb?.('SIGNED_IN', { user: { id: 'u2', email: 'vera@empresa.test' } }) })
    expect(await screen.findByText('Vera Vendedora · carga 2')).toBeInTheDocument()
  })

  it('cerrar sesión vuelve a /login', async () => {
    sb.estado.session = { user: { id: 'u1', email: 'admin@empresa.test' } }
    app('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }))
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('una cuenta sin perfil o desactivada no entra aunque la contraseña sea correcta', async () => {
    sb.estado.session = { user: { id: 'u1', email: 'x@empresa.test' } }
    sb.estado.perfil = null
    const { unmount } = app('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene un perfil en AMURA')
    unmount()
    sb.estado.perfil = { ...perfilAdmin, estado: 'inactivo', permisos: [] }
    app('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('desactivada')
  })

  it('una cuenta sin perfil que inicia sesión sale de /login y ve la activación del administrador inicial', async () => {
    sb.estado.perfil = null
    sb.supabase.rpc.mockImplementation(async (fn: string) => ({ data: fn === 'puede_activar_administrador_inicial' ? true : null, error: null }))
    app('/login')
    fireEvent.change(await screen.findByLabelText('Correo electrónico'), { target: { value: 'carlosftapiap@gmail.com' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-correcta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('button', { name: 'Activar como administrador' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('no tiene un perfil en AMURA')
  })

  it('recuperar contraseña envía el enlace sin revelar si el correo existe', async () => {
    app('/login')
    fireEvent.click(await screen.findByRole('button', { name: '¿Olvidaste tu contraseña?' }))
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'alguien@empresa.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Si el correo está registrado')
    expect(sb.supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('alguien@empresa.test', expect.objectContaining({ redirectTo: expect.stringMatching(/\/login$/) }))
  })

  it('el enlace de recuperación pide la nueva contraseña y valida su longitud', async () => {
    // Sin sesión previa: el enlace de recuperación llega en una ventana sin sesión iniciada.
    app('/login')
    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    sb.estado.cb!('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'admin@empresa.test' } })
    fireEvent.change(await screen.findByLabelText('Nueva contraseña'), { target: { value: 'corta' } })
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'corta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('al menos 10')
    expect(sb.supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('el enlace de contraseña muestra el formulario aunque el perfil termine de cargar después', async () => {
    // El enlace deja una sesión guardada: mi_sesion sigue en curso cuando llega PASSWORD_RECOVERY.
    sb.estado.session = { user: { id: 'u1', email: 'admin@empresa.test' }, access_token: 't' }
    sb.supabase.rpc.mockImplementation(async () => ({ data: perfilAdmin, error: null }) as never)
    let responder: (r: { data: unknown; error: null }) => void = () => {}
    sb.supabase.rpc.mockImplementationOnce(() => new Promise((r) => { responder = r }) as never)
    app('/login')
    await vi.waitFor(() => expect(sb.supabase.rpc).toHaveBeenCalled())
    await act(async () => { sb.estado.cb!('PASSWORD_RECOVERY', sb.estado.session) })
    await act(async () => { responder({ data: perfilAdmin, error: null }) })
    expect(await screen.findByLabelText('Nueva contraseña')).toBeInTheDocument()
    expect(screen.queryByText(/Dashboard/)).toBeNull()

    // Guardada la contraseña, entra a la aplicación.
    await act(async () => { sb.estado.cb!('USER_UPDATED', sb.estado.session) })
    expect(await screen.findByText('Dashboard de Carlos Tapia')).toBeInTheDocument()
  })
})
