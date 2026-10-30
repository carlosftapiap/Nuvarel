import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConexion } from '@/app/auth'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import type { ReservasState } from './model'
import { cargarReservas } from './remoto'
import { estadoInicialReservas } from './service'

/** Reservas. Sin Supabase: almacén local en el navegador. Con Supabase: se leen de la base y cada paso lo ejecuta el servidor. */
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
  remoto: boolean
  datos: Datos | null
  cargando: boolean
  error: string | null
  recargar: () => Promise<void>
}

const Ctx = createContext<Value | null>(null)

export function ReservasProvider({ children }: { children: ReactNode }) {
  const { remoto, datos } = useConexion()
  if (remoto && datos) return <ReservasRemoto datos={datos}>{children}</ReservasRemoto>
  return <ReservasLocal>{children}</ReservasLocal>
}

function ReservasLocal({ children }: { children: ReactNode }) {
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
  const value = useMemo<Value>(() => ({ state, update, remoto: false, datos: null, cargando: false, error: null, recargar: async () => {} }), [state, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function ReservasRemoto({ children, datos }: { children: ReactNode; datos: Datos }) {
  const [state, setState] = useState<ReservasState>(estadoInicialReservas)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lectura = useRef(0)
  const recargar = useCallback(async () => {
    const n = ++lectura.current
    try {
      const s = await cargarReservas(datos)
      if (n !== lectura.current) return
      setState(s)
      setError(null)
    } catch (e) {
      if (n === lectura.current) setError(`No se pudieron cargar las reservas: ${(e as Error).message}`)
    } finally {
      if (n === lectura.current) setCargando(false)
    }
  }, [datos])
  useRefresco(recargar)
  const value = useMemo<Value>(() => ({
    state, update: () => { throw new Error('Con Supabase, las reservas solo cambian con su flujo en el servidor.') }, remoto: true, datos, cargando, error, recargar,
  }), [state, datos, cargando, error, recargar])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useReservas() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReservas debe usarse dentro de ReservasProvider')
  return ctx
}
