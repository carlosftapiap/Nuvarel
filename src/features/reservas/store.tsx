import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ReservasState } from './model'
import { estadoInicialReservas } from './service'

/** Reservas persistidas en el navegador hasta conectar Supabase. */
const KEY = 'amura.reservas.v1'

function cargar(): ReservasState {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as ReservasState) : null
    return saved?.version === 1 && Array.isArray(saved.reservas) ? saved : estadoInicialReservas()
  } catch {
    return estadoInicialReservas()
  }
}

interface Value {
  state: ReservasState
  update: (fn: (s: ReservasState) => ReservasState) => void
}

const Ctx = createContext<Value | null>(null)

export function ReservasProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ReservasState>(() => cargar())
  const ref = useRef(state)
  useEffect(() => {
    ref.current = state
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin almacenamiento */ }
  }, [state])
  const update = useCallback((fn: (s: ReservasState) => ReservasState) => {
    const next = fn(ref.current)
    ref.current = next
    setState(next)
  }, [])
  const value = useMemo(() => ({ state, update }), [state, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReservas() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReservas debe usarse dentro de ReservasProvider')
  return ctx
}
