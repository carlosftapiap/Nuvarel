import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Actor, Rol } from '@/features/inventario/types'
import { can as canRol, ROLES, type Permiso } from './permissions'

/**
 * Sesión de DEMOSTRACIÓN: el rol se elige manualmente para probar permisos.
 * Con Supabase Auth el rol vendrá del perfil del usuario y la autorización se aplicará con RLS.
 */
interface SessionValue {
  actor: Actor
  setRol: (rol: Rol) => void
  can: (permiso: Permiso) => boolean
}

const KEY = 'amura.demo.rol'
const SessionContext = createContext<SessionValue | null>(null)

function leerRol(): Rol {
  try {
    const v = localStorage.getItem(KEY)
    if (v && v in ROLES) return v as Rol
  } catch { /* almacenamiento no disponible */ }
  return 'gerencia'
}

export function SessionProvider({ children, initialRol }: { children: ReactNode; initialRol?: Rol }) {
  const [rol, setRolState] = useState<Rol>(() => initialRol ?? leerRol())
  const setRol = useCallback((r: Rol) => {
    setRolState(r)
    try { localStorage.setItem(KEY, r) } catch { /* ignorar */ }
  }, [])
  const value = useMemo<SessionValue>(() => ({
    actor: { nombre: `${ROLES[rol].label} (demo)`, rol },
    setRol,
    can: (p) => canRol(rol, p),
  }), [rol, setRol])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider')
  return ctx
}
