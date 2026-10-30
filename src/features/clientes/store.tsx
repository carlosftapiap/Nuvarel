import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConexion } from '@/app/auth'
import type { Datos } from '@/features/conexion/datos'
import type { Cliente, ClientesState, Oportunidad } from './model'
import { cargarClientes, persistirCambios, type Persona } from './remoto'
import { estadoInicialClientes } from './service'

/**
 * Clientes. Sin Supabase: almacén local en el navegador. Con Supabase: se carga desde la base y cada cambio
 * se guarda con su función del servidor; si el servidor lo rechaza, se muestra el motivo y se recargan los datos reales.
 * Toda mutación pasa por las funciones puras de service.ts, que validan reglas antes de guardar.
 */
const KEY = 'amura.clientes.v1'
const KEY_ARCHIVO = 'amura.clientes.v1.importados'
/** Cada cuánto se traen los cambios de otras personas mientras la pantalla está visible. */
const REFRESCO_MS = 60_000

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

/** Clientes guardados solo en este navegador, pendientes de pasar a la base de datos. */
// eslint-disable-next-line react-refresh/only-export-components
export const leerClientesLocales = (): Cliente[] => cargar().clientes

/** Tras verificar la importación, conserva la copia local con otro nombre: nunca se borra. */
// eslint-disable-next-line react-refresh/only-export-components
export function archivarClientesLocales() {
  const raw = localStorage.getItem(KEY)
  if (!raw) return
  localStorage.setItem(KEY_ARCHIVO, raw)
  localStorage.removeItem(KEY)
}

interface Value {
  state: ClientesState
  /** Aplica una transición. Las reglas fallan aquí mismo; un rechazo del servidor se muestra como aviso general. */
  update: (fn: (s: ClientesState) => ClientesState) => void
  /** Igual que update, pero espera a que el servidor confirme: si lo rechaza, el error llega a quien llamó. */
  guardar: (fn: (s: ClientesState) => ClientesState) => Promise<void>
  remoto: boolean
  datos: Datos | null
  cargando: boolean
  faltaMigracion: boolean
  error: string | null
  oportunidades: Oportunidad[]
  asignables: Persona[]
  corredores: Persona[]
  importacionAbierta: boolean
  recargar: () => Promise<void>
}

const Ctx = createContext<Value | null>(null)

export function ClientesProvider({ children, initialState }: { children: ReactNode; initialState?: ClientesState }) {
  const { remoto, datos } = useConexion()
  if (remoto && datos && !initialState) return <ClientesRemoto datos={datos}>{children}</ClientesRemoto>
  return <ClientesLocal initialState={initialState}>{children}</ClientesLocal>
}

function ClientesLocal({ children, initialState }: { children: ReactNode; initialState?: ClientesState }) {
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
  const value = useMemo<Value>(() => ({
    state, update, guardar: async (fn) => update(fn),
    remoto: false, datos: null, cargando: false, faltaMigracion: false, error: null, oportunidades: [], asignables: [], corredores: [], importacionAbierta: false, recargar: async () => {},
  }), [state, update])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function ClientesRemoto({ children, datos }: { children: ReactNode; datos: Datos }) {
  const [state, setState] = useState<ClientesState>(estadoInicialClientes)
  const [oportunidades, setOportunidades] = useState<Oportunidad[]>([])
  const [asignables, setAsignables] = useState<Persona[]>([])
  const [corredores, setCorredores] = useState<Persona[]>([])
  const [importacionAbierta, setImportacionAbierta] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef(state)
  // Una lectura que empezó antes de un cambio no debe pisar lo que se acaba de guardar.
  const lectura = useRef(0)
  const guardando = useRef(0)

  const recargar = useCallback(async () => {
    const n = ++lectura.current
    try {
      const d = await cargarClientes(datos)
      if (n !== lectura.current || guardando.current > 0) return
      ref.current = d.state
      setState(d.state)
      setOportunidades(d.oportunidades)
      setAsignables(d.asignables)
      setCorredores(d.corredores)
      setImportacionAbierta(d.importacionAbierta)
      setFaltaMigracion(d.faltaMigracion)
    } catch (e) {
      if (n === lectura.current) setError(`No se pudieron cargar los clientes: ${(e as Error).message}`)
    } finally {
      if (n === lectura.current) setCargando(false)
    }
  }, [datos])

  useEffect(() => {
    void recargar()
    const alVolver = () => { if (document.visibilityState === 'visible' && guardando.current === 0) void recargar() }
    window.addEventListener('focus', alVolver)
    const t = setInterval(alVolver, REFRESCO_MS)
    return () => { window.removeEventListener('focus', alVolver); clearInterval(t) }
  }, [recargar])

  const guardar = useCallback(async (fn: (s: ClientesState) => ClientesState) => {
    const prev = ref.current
    // Validaciones de reglas: si fallan, lanzan aquí y no cambia nada.
    const next = fn(prev)
    if (next === prev) return
    ref.current = next
    setState(next)
    setError(null)
    guardando.current++
    try {
      await persistirCambios(datos, prev, next)
      guardando.current--
      await recargar()
    } catch (e) {
      guardando.current--
      await recargar()
      throw e
    }
  }, [datos, recargar])

  const update = useCallback((fn: (s: ClientesState) => ClientesState) => {
    const prev = ref.current
    const next = fn(prev)
    void guardar(() => next).catch((e: Error) => setError(`No se guardó en Supabase: ${e.message}. Se recargaron los clientes guardados.`))
  }, [guardar])

  const value = useMemo<Value>(() => ({
    state, update, guardar, remoto: true, datos, cargando, faltaMigracion, error, oportunidades, asignables, corredores, importacionAbierta, recargar,
  }), [state, update, guardar, datos, cargando, faltaMigracion, error, oportunidades, asignables, corredores, importacionAbierta, recargar])
  return (
    <Ctx.Provider value={value}>
      {error && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useClientes() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useClientes debe usarse dentro de ClientesProvider')
  return ctx
}
