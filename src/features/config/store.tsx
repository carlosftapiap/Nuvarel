import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DirectorioState } from './model'
import { directorioInicial } from './service'

/** Directorio local (usuarios, roles, equipos y auditoría) hasta conectar Supabase Auth. */
const KEY = 'amura.directorio.v1'

function cargar(): DirectorioState {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as DirectorioState) : null
    return saved?.version === 1 && Array.isArray(saved.usuarios) && saved.usuarios.length ? saved : directorioInicial()
  } catch {
    return directorioInicial()
  }
}

interface Value {
  state: DirectorioState
  update: (fn: (s: DirectorioState) => DirectorioState) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const DirectorioContext = createContext<Value | null>(null)
const Ctx = DirectorioContext

export function DirectorioProvider({ children, initialState }: { children: ReactNode; initialState?: DirectorioState }) {
  const [state, setState] = useState<DirectorioState>(() => initialState ?? cargar())
  const ref = useRef(state)
  useEffect(() => {
    ref.current = state
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin almacenamiento */ }
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
