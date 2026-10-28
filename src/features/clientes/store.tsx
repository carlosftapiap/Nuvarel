import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ClientesState } from './model'
import { estadoInicialClientes } from './service'

/** Clientes persistidos en el navegador hasta conectar Supabase. No se cargan datos de ejemplo. */
const KEY = 'amura.clientes.v1'

function cargar(): ClientesState {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as ClientesState) : null
    return saved?.version === 1 && Array.isArray(saved.clientes) ? saved : estadoInicialClientes()
  } catch {
    return estadoInicialClientes()
  }
}

interface Value {
  state: ClientesState
  update: (fn: (s: ClientesState) => ClientesState) => void
}

const Ctx = createContext<Value | null>(null)

export function ClientesProvider({ children, initialState }: { children: ReactNode; initialState?: ClientesState }) {
  const [state, setState] = useState<ClientesState>(() => initialState ?? cargar())
  const ref = useRef(state)
  useEffect(() => {
    ref.current = state
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin almacenamiento */ }
  }, [state])
  const update = useCallback((fn: (s: ClientesState) => ClientesState) => {
    const next = fn(ref.current)
    ref.current = next
    setState(next)
  }, [])
  const value = useMemo(() => ({ state, update }), [state, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useClientes() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useClientes debe usarse dentro de ClientesProvider')
  return ctx
}
