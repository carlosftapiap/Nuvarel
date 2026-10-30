import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Actor, Rol } from '@/features/inventario/types'
import { DirectorioContext } from '@/features/config/store'
import { actorDe, ID_ADMIN_INICIAL, permisosEfectivos } from '@/features/config/service'
import { can as canActor, rolLabel, type Permiso } from './permissions'

/**
 * Sesión. Mientras no se conecte Supabase Auth, se elige un usuario del directorio para trabajar como él (modo demostración).
 * La identidad es el identificador del usuario; sus permisos y alcance salen de su rol, excepciones y equipos.
 */
interface SessionValue {
  actor: Actor
  usuarioId: string
  setUsuario: (id: string) => void
  can: (permiso: Permiso) => boolean
}

const KEY = 'amura.demo.usuario'
const SessionContext = createContext<SessionValue | null>(null)

function leerUsuario() {
  try { return localStorage.getItem(KEY) ?? ID_ADMIN_INICIAL } catch { return ID_ADMIN_INICIAL }
}

/**
 * `actorRemoto`: usuario autenticado en Supabase (identidad, permisos y alcance desde la base de datos).
 * `initialRol` crea una sesión fija por plantilla de rol (usado en pruebas aisladas).
 */
export function SessionProvider({ children, initialRol, actorRemoto }: { children: ReactNode; initialRol?: Rol; actorRemoto?: Actor }) {
  const dir = useContext(DirectorioContext)
  const [uid, setUid] = useState<string>(() => leerUsuario())
  const setUsuario = useCallback((id: string) => {
    setUid(id)
    try { localStorage.setItem(KEY, id) } catch { /* ignorar */ }
  }, [])

  const value = useMemo<SessionValue>(() => {
    let actor: Actor
    if (actorRemoto) {
      actor = actorRemoto
    } else if (initialRol || !dir) {
      const rol = initialRol ?? 'administrador'
      actor = { id: `demo-${rol}`, nombre: `${rolLabel(rol)} (demo)`, rol }
    } else {
      const activos = dir.state.usuarios.filter((u) => u.estado === 'activo')
      const u = activos.find((x) => x.id === uid)
        ?? activos.find((x) => permisosEfectivos(dir.state, x).includes('config.usuarios'))
        ?? activos[0]
      actor = actorDe(dir.state, u)
    }
    return { actor, usuarioId: actor.id, setUsuario, can: (p) => canActor(actor, p) }
  }, [initialRol, actorRemoto, dir, uid, setUsuario])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider')
  return ctx
}
