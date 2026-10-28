import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ClientesState } from './model'
import { estadoInicialClientes } from './service'

/** Clientes persistidos en el navegador hasta conectar Supabase. No se cargan datos de ejemplo. */
const KEY = 'amura.clientes.v1'

function cargar(): ClientesState {
  try {
    const raw = localStorage.getItem(KEY)
    const saved = raw ? (JSON.parse(raw) as ClientesState) : null
    if (!(saved?.version === 1 && Array.isArray(saved.clientes))) return estadoInicialClientes()
    // Datos guardados antes de usar identificadores: quedan sin responsable para que administración los reasigne.
    return {
      ...saved,
      clientes: saved.clientes.map((c) => ({
        ...c,
        asesorId: c.asesorId ?? 'sin-asignar',
        creadoPor: { id: c.creadoPor?.id ?? 'sin-asignar', nombre: c.creadoPor?.nombre ?? '', rol: c.creadoPor?.rol ?? '' },
        atribucion: c.atribucion ?? { usuarioId: c.creadoPor?.id ?? 'sin-asignar', nombre: c.creadoPor?.nombre ?? '', fecha: c.creadoEn?.slice(0, 10) ?? '' },
      })),
    }
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
