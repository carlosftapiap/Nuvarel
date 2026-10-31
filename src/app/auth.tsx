import type { AlmacenContratos } from '@/features/contratos/almacen'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { datosSupabase, type Datos } from '@/features/conexion/datos'
import type { Actor } from '@/features/inventario/types'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { SessionProvider } from './session'

/**
 * Autenticación con Supabase Auth. Con URL y clave publicable configuradas, todas las rutas salvo /login son privadas
 * y la identidad, los permisos y el alcance salen del perfil en la base de datos (función mi_sesion), no del navegador.
 * Sin configuración la app sigue en modo local (pruebas y demostración).
 */
export const modoRemoto = supabaseConfigured && import.meta.env.MODE !== 'test'

export interface Cuenta {
  id: string
  nombre: string
  email: string
  estado: string
  rol: string
  rolNombre: string
}

export type EstadoAuth =
  | { tipo: 'cargando' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'recuperacion' }
  | { tipo: 'sin_perfil'; email: string }
  | { tipo: 'inactivo'; email: string; estado: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; actor: Actor; cuenta: Cuenta }

interface ConexionValue {
  remoto: boolean
  datos: Datos | null
  cuenta: Cuenta | null
  estado?: EstadoAuth
  salir: () => Promise<void>
  /** En pruebas se entrega un Storage simulado; en la app se usa el de Supabase. */
  almacen?: AlmacenContratos
}

const ConexionContext = createContext<ConexionValue>({ remoto: false, datos: null, cuenta: null, salir: async () => {} })

// eslint-disable-next-line react-refresh/only-export-components
export const useConexion = () => useContext(ConexionContext)

/** Proveedor para pruebas: conecta los componentes a una fuente de datos dada (p. ej. Postgres local). */
export function ConexionProvider({ value, children }: { value: ConexionValue; children: ReactNode }) {
  return <ConexionContext.Provider value={value}>{children}</ConexionContext.Provider>
}

interface SesionRemota {
  id: string
  nombre: string
  email: string
  estado: string
  rol: string
  rolNombre: string
  alcance: 'propio' | 'equipo' | 'empresa'
  permisos: string[]
  usuariosAlcance: string[]
  proyectos: string[]
}

/** Sesión de Supabase Auth y perfil de la persona. La sesión la guarda y renueva el cliente de Supabase. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoAuth>({ tipo: 'cargando' })
  const datos = useMemo(() => datosSupabase(supabase), [])

  const cargar = useCallback(async (session: Session | null) => {
    if (!session) { setEstado({ tipo: 'sin_sesion' }); return }
    try {
      const s = await datos.rpc<SesionRemota | null>('mi_sesion')
      const email = session.user.email ?? ''
      if (!s) { setEstado({ tipo: 'sin_perfil', email }); return }
      if (s.estado !== 'activo') { setEstado({ tipo: 'inactivo', email, estado: s.estado }); return }
      const actor: Actor = {
        id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos,
        alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance }, proyectos: s.proyectos,
      }
      setEstado({ tipo: 'listo', actor, cuenta: { id: s.id, nombre: s.nombre, email: s.email, estado: s.estado, rol: s.rol, rolNombre: s.rolNombre } })
    } catch (e) {
      const m = (e as Error).message
      setEstado({ tipo: 'error', mensaje: /mi_sesion/.test(m) ? 'La base de datos no tiene la función mi_sesion. Ejecuta supabase/migrations/20261029010000_conexion_app.sql.' : m })
    }
  }, [datos])

  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(({ data }) => { if (vivo) void cargar(data.session) })
    const { data: sub } = supabase.auth.onAuthStateChange((evento, session) => {
      if (evento === 'PASSWORD_RECOVERY') { setEstado({ tipo: 'recuperacion' }); return }
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') void cargar(session)
    })
    return () => { vivo = false; sub.subscription.unsubscribe() }
  }, [cargar])

  const salir = useCallback(async () => { await supabase.auth.signOut() }, [])
  const value = useMemo<ConexionValue>(() => ({ remoto: true, datos, estado, cuenta: estado.tipo === 'listo' ? estado.cuenta : null, salir }), [datos, estado, salir])
  return <ConexionContext.Provider value={value}>{children}</ConexionContext.Provider>
}

export function MarcoAcceso({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh grid-rows-[34svh_auto] bg-white md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-none">
      <div className="relative overflow-hidden bg-[#282828]">
        <img src="/media/torres.webp" srcSet="/media/miniaturas/torres.webp 405w, /media/torres.webp 941w" sizes="(max-width: 768px) 100vw, 55vw" alt="Vista aérea de las dos torres de AMURA"
          width={941} height={1672} fetchPriority="high" className="absolute inset-0 size-full object-cover object-top" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(40,40,40,.62),rgba(40,40,40,.28)_22%,rgba(40,40,40,0)_42%,rgba(40,40,40,0)_62%,rgba(40,40,40,.86))]" aria-hidden="true" />
        <img src="/media/logo-horizontal-crema.webp" alt="AMURA Apartments" width={600} height={163} className="absolute left-5 top-4 h-10 w-auto md:left-10 md:top-8 md:h-14" />
        <div className="absolute inset-x-10 bottom-8 hidden text-[#f7f4ed] md:block">
          <p className="marca-titulo text-3xl leading-tight">Un lugar para vivir, compartir y crecer.</p>
          <small className="mt-2 block text-[11px] opacity-80">Visualización conceptual</small>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-6 px-5 py-8 [--primary:#584536] [--ring:#584536]">
        <div className="w-full max-w-sm">{children}</div>
        <p className="text-center text-[10px] text-muted-foreground">AMURA · Espacio comercial · Acceso solo para personal autorizado</p>
      </div>
    </div>
  )
}

/** Ruta privada: sin sesión lleva a /login y recuerda la página pedida. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { estado, salir } = useConexion()
  const location = useLocation()
  if (!estado || estado.tipo === 'cargando') {
    return <MarcoAcceso><p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Verificando tu sesión…</p></MarcoAcceso>
  }
  if (estado.tipo === 'sin_sesion' || estado.tipo === 'recuperacion') return <Navigate to="/login" replace state={{ desde: location.pathname + location.search }} />
  if (estado.tipo === 'listo') return <SessionProvider actorRemoto={estado.actor}>{children}</SessionProvider>
  const texto = estado.tipo === 'sin_perfil'
    ? `La cuenta ${estado.email} no tiene un perfil en AMURA. Pide al administrador que la habilite desde Configuración.`
    : estado.tipo === 'inactivo'
      ? `La cuenta ${estado.email} está ${estado.estado === 'invitado' ? 'pendiente de activación' : 'desactivada'}. Pide al administrador que active tu acceso.`
      : estado.mensaje
  return (
    <MarcoAcceso>
      <h1 className="text-base font-semibold">{estado.tipo === 'error' ? 'No se pudo cargar tu sesión' : 'Acceso no habilitado'}</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">{texto}</p>
      {estado.tipo === 'sin_perfil' && <ActivarAdministradorInicial />}
      <Button variant="outline" className="mt-6 w-full" onClick={() => void salir()}><LogOut />Cerrar sesión</Button>
    </MarcoAcceso>
  )
}

/** Procedimiento de inicialización: solo aparece si la base confirma que esta cuenta es la autorizada y aún no hay administrador. */
function ActivarAdministradorInicial() {
  const { datos } = useConexion()
  const [puede, setPuede] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!datos) return
    datos.rpc<boolean>('puede_activar_administrador_inicial').then(setPuede).catch(() => setPuede(false))
  }, [datos])
  if (!puede || !datos) return null
  const activar = async () => {
    setEnviando(true); setError(null)
    try {
      await datos.rpc('activar_administrador_inicial')
      // La sesión se vuelve a leer desde el perfil recién creado.
      window.location.reload()
    } catch (e) {
      setError((e as Error).message)
      setEnviando(false)
    }
  }
  return (
    <div className="mt-5 grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-xs text-emerald-900">Esta cuenta está autorizada como administrador inicial de AMURA. Actívala ahora; después, las altas se hacen desde Configuración.</p>
      <Button onClick={() => void activar()} disabled={enviando}>{enviando && <Loader2 className="animate-spin" />}Activar como administrador</Button>
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  )
}
