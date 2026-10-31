import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DirectorioState } from './model'
import { directorioInicial } from './service'

/** Directorio en memoria. Las cuentas reales, roles y equipos están en Supabase; nada se guarda en el navegador. */
interface Value {
  state: DirectorioState
  update: (fn: (s: DirectorioState) => DirectorioState) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const DirectorioContext = createContext<Value | null>(null)
const Ctx = DirectorioContext

export function DirectorioProvider({ children, initialState }: { children: ReactNode; initialState?: DirectorioState }) {
  const [state, setState] = useState<DirectorioState>(() => initialState ?? directorioInicial())
  const ref = useRef(state)
  useEffect(() => {
    ref.current = state
  }, [state])
  const update = useCallback((fn: (s: DirectorioState) => DirectorioState) => {
    const next = fn(ref.current)
    ref.current = next
    setState(next)
  }, [])
  const value = useMemo(() => ({ state, update }), [state, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDirectorio() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDirectorio debe usarse dentro de DirectorioProvider')
  return ctx
}
