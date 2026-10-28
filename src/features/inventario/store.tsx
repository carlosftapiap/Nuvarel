import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createInitialState } from './service'
import type { InventoryState } from './types'

/**
 * Almacén local del inventario (persistido en el navegador) mientras se conecta Supabase.
 * Toda mutación pasa por las funciones puras de service.ts / excel.ts, que validan permisos y reglas.
 */
const KEY = 'amura.inventario.v1'

function cargar(): InventoryState {
  const base = createInitialState()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as InventoryState
    if (saved?.version !== 1 || !Array.isArray(saved.units) || saved.units.length !== base.units.length) return base
    // Los datos físicos nuevos de la semilla prevalecen sólo si el código coincide; precios/estados vienen del almacenamiento.
    const porCodigo = new Map(saved.units.map((u) => [u.codigo, u]))
    if (base.units.some((u) => !porCodigo.has(u.codigo))) return base
    return { ...base, ...saved, units: base.units.map((u) => ({ ...u, ...porCodigo.get(u.codigo)! })) }
  } catch {
    return base
  }
}

interface InventoryValue {
  state: InventoryState
  /** Aplica una transición; lanza el error de validación o permisos al llamador. */
  update: (fn: (s: InventoryState) => InventoryState) => void
}

const InventoryContext = createContext<InventoryValue | null>(null)

export function InventoryProvider({ children, initialState }: { children: ReactNode; initialState?: InventoryState }) {
  const [state, setState] = useState<InventoryState>(() => initialState ?? cargar())
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* sin almacenamiento */ }
  }, [state])
  const ref = useRef(state)
  useEffect(() => { ref.current = state }, [state])
  const update = useCallback((fn: (s: InventoryState) => InventoryState) => {
    // Se calcula fuera del setter para que los errores de validación lleguen al formulario que llamó.
    const next = fn(ref.current)
    ref.current = next
    setState(next)
  }, [])
  const value = useMemo(() => ({ state, update }), [state, update])
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventory() {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory debe usarse dentro de InventoryProvider')
  return ctx
}
