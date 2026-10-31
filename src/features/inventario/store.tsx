import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConexion } from '@/app/auth'
import type { Datos } from '@/features/conexion/datos'
import { cargarInventario, persistirCambios } from './remoto'
import { estadoSinDatos } from './service'
import type { InventoryState } from './types'

/**
 * Inventario. Con Supabase: se carga desde la base y cada cambio se guarda con su función del servidor;
 * si el servidor lo rechaza, se muestra el motivo y se recarga el inventario real.
 * Sin Supabase no hay datos: la aplicación no guarda ni trae inventario propio.
 * Toda mutación pasa por las funciones puras de service.ts / excel.ts, que validan reglas antes de guardar.
 */

interface InventoryValue {
  state: InventoryState
  /** Aplica una transición; lanza el error de validación o permisos al llamador. */
  update: (fn: (s: InventoryState) => InventoryState) => void
  /** Último error al guardar en Supabase (null si todo está guardado). */
  error: string | null
  /** Relee de la base lo que cambió otro módulo (p. ej. una reserva aprobada). */
  recargar: () => Promise<void>
}

const InventoryContext = createContext<InventoryValue | null>(null)

export function InventoryProvider({ children, initialState }: { children: ReactNode; initialState?: InventoryState }) {
  const { remoto, datos } = useConexion()
  if (remoto && datos && !initialState) return <InventarioRemoto datos={datos}>{children}</InventarioRemoto>
  return <InventarioLocal initialState={initialState}>{children}</InventarioLocal>
}

function InventarioLocal({ children, initialState }: { children: ReactNode; initialState?: InventoryState }) {
  const [state, setState] = useState<InventoryState>(() => initialState ?? estadoSinDatos())
  const ref = useRef(state)
  useEffect(() => { ref.current = state }, [state])
  const update = useCallback((fn: (s: InventoryState) => InventoryState) => {
    // Se calcula fuera del setter para que los errores de validación lleguen al formulario que llamó.
    const next = fn(ref.current)
    ref.current = next
    setState(next)
  }, [])
  const value = useMemo(() => ({ state, update, error: null, recargar: async () => {} }), [state, update])
  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>
}

function InventarioRemoto({ children, datos }: { children: ReactNode; datos: Datos }) {
  const [state, setState] = useState<InventoryState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<InventoryState | null>(null)

  const recargar = useCallback(async () => {
    try {
      const s = await cargarInventario(datos)
      ref.current = s
      setState(s)
    } catch (e) {
      setError(`No se pudo cargar el inventario: ${(e as Error).message}`)
    }
  }, [datos])
  useEffect(() => { void recargar() }, [recargar])

  const update = useCallback((fn: (s: InventoryState) => InventoryState) => {
    const prev = ref.current
    if (!prev) throw new Error('El inventario todavía se está cargando.')
    // Validaciones de reglas: si fallan, lanzan aquí y no cambia nada.
    const next = fn(prev)
    if (next === prev) return
    ref.current = next
    setState(next)
    setError(null)
    persistirCambios(datos, prev, next)
      .then(recargar)
      .catch((e: Error) => {
        setError(`No se guardó en Supabase: ${e.message}. Se recargó el inventario guardado.`)
        void recargar()
      })
  }, [datos, recargar])

  const value = useMemo(() => (state ? { state, update, error, recargar } : null), [state, update, error, recargar])
  if (!value) {
    return error
      ? <p role="alert" className="p-6 text-sm text-rose-700">{error}</p>
      : <p className="p-6 text-sm text-muted-foreground">Cargando inventario…</p>
  }
  return (
    <InventoryContext.Provider value={value}>
      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
      {children}
    </InventoryContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useInventory() {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory debe usarse dentro de InventoryProvider')
  return ctx
}
