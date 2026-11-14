import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2, Mail } from 'lucide-react'
import { MarcoAcceso, useConexion } from '@/app/auth'
import ClaveInput from '@/components/ClaveInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { traducirError } from '@/features/conexion/datos'
import { supabase } from '@/lib/supabase'

/** Inicio de sesión con Supabase Auth. No hay registro público: las cuentas las crea un administrador. */
export default function LoginPage() {
  const { estado } = useConexion()
  // Con sesión iniciada (con o sin perfil) se sale de /login siempre al inicio: cada perfil entra a su propia pantalla
  // y nunca a la ruta que dejó otra sesión. Sin perfil, la ruta privada muestra el motivo (o activa al administrador inicial).
  if (estado && ['listo', 'sin_perfil', 'inactivo', 'error'].includes(estado.tipo)) return <Navigate to="/" replace />
  return <MarcoAcceso>{estado?.tipo === 'recuperacion' ? <NuevaClave /> : <Formulario />}</MarcoAcceso>
}

function mensajeAuth(m: string) {
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.'
  if (/Email not confirmed/i.test(m)) return 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada o pide al administrador que lo confirme.'
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.'
  return traducirError(m)
}

function Formulario() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [recuperar, setRecuperar] = useState(false)

  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setAviso(null); setEnviando(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: clave })
      if (error) setError(mensajeAuth(error.message))
    } catch (err) {
      setError(mensajeAuth((err as Error).message))
    } finally {
      setEnviando(false)
    }
  }

  const enviarEnlace = async (e: FormEvent) => {
    e.preventDefault()
    setError(null); setAviso(null); setEnviando(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/login` })
      if (error) setError(mensajeAuth(error.message))
      // Mismo mensaje exista o no la cuenta: no revela qué correos están registrados.
      else setAviso('Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.')
    } finally {
      setEnviando(false)
    }
  }

  if (recuperar) {
    return (
      <form onSubmit={enviarEnlace} className="grid gap-4" noValidate={false}>
        <div>
          <h1 className="text-base font-semibold">Recuperar contraseña</h1>
          <p className="mt-1 text-xs text-muted-foreground">Te enviaremos un enlace para crear una nueva contraseña.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rec-email" className="text-xs">Correo electrónico</Label>
          <Input id="rec-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>}
        {aviso && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">{aviso}</p>}
        <Button type="submit" disabled={enviando || !email.trim()}>{enviando ? <Loader2 className="animate-spin" /> : <Mail />}Enviar enlace</Button>
        <button type="button" onClick={() => { setRecuperar(false); setError(null); setAviso(null) }} className="text-xs text-primary hover:underline">Volver a iniciar sesión</button>
      </form>
    )
  }

  return (
    <form onSubmit={entrar} className="grid gap-4">
      <div>
        <h1 className="text-base font-semibold">Iniciar sesión</h1>
        <p className="mt-1 text-xs text-muted-foreground">Espacio comercial de AMURA</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="login-email" className="text-xs">Correo electrónico</Label>
        <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="login-clave" className="text-xs">Contraseña</Label>
        <ClaveInput id="login-clave" autoComplete="current-password" value={clave} onChange={setClave} />
      </div>
      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>}
      <Button type="submit" disabled={enviando}>{enviando && <Loader2 className="animate-spin" />}{enviando ? 'Ingresando…' : 'Iniciar sesión'}</Button>
      <button type="button" onClick={() => { setRecuperar(true); setError(null) }} className="text-xs text-primary hover:underline">¿Olvidaste tu contraseña?</button>
      <p className="text-center text-xs text-muted-foreground">Las cuentas las crea el administrador. No hay registro público.</p>
    </form>
  )
}

function NuevaClave() {
  const [clave, setClave] = useState('')
  const [repetir, setRepetir] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const guardar = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (clave.length < 10) { setError('Usa al menos 10 caracteres.'); return }
    if (clave !== repetir) { setError('Las contraseñas no coinciden.'); return }
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: clave })
    setEnviando(false)
    if (error) setError(mensajeAuth(error.message))
  }
  return (
    <form onSubmit={guardar} className="grid gap-4">
      <h1 className="text-base font-semibold">Crea tu nueva contraseña</h1>
      <div className="grid gap-1.5"><Label htmlFor="nc-1" className="text-xs">Nueva contraseña</Label><ClaveInput id="nc-1" autoComplete="new-password" value={clave} onChange={setClave} /></div>
      <div className="grid gap-1.5"><Label htmlFor="nc-2" className="text-xs">Repite la contraseña</Label><ClaveInput id="nc-2" autoComplete="new-password" value={repetir} onChange={setRepetir} /></div>
      {error && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</p>}
      <Button type="submit" disabled={enviando}>{enviando && <Loader2 className="animate-spin" />}Guardar contraseña</Button>
    </form>
  )
}
