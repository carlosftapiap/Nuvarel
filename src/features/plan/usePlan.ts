import { useCallback, useEffect, useRef, useState } from 'react'
import { useConexion } from '@/app/auth'
import { cargarPlan, type DatosPlan } from './api'

const KEY = 'amura.plan.seleccionado'
const leer = () => { try { return localStorage.getItem(KEY) } catch { return null } }

/**
 * Datos del plan desde Supabase. Se recargan tras cada cambio, al volver a la ventana y cada minuto,
 * para que varias sesiones vean los mismos registros. Los conflictos de edición los detecta el servidor por versión.
 */
export function usePlan() {
  const { datos } = useConexion()
  const [planId, setPlanIdState] = useState<string | null>(leer)
  const [data, setData] = useState<DatosPlan | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const pedido = useRef(0)

  const recargar = useCallback(async () => {
    if (!datos) return
    const n = ++pedido.current
    try {
      const d = await cargarPlan(datos, planId)
      if (n === pedido.current) { setData(d); setError(null) }
    } catch (e) {
      if (n === pedido.current) setError((e as Error).message)
    } finally {
      if (n === pedido.current) setCargando(false)
    }
  }, [datos, planId])

  useEffect(() => { void recargar() }, [recargar])
  useEffect(() => {
    const foco = () => { if (document.visibilityState === 'visible') void recargar() }
    document.addEventListener('visibilitychange', foco)
    const t = window.setInterval(foco, 60_000)
    return () => { document.removeEventListener('visibilitychange', foco); window.clearInterval(t) }
  }, [recargar])

  const setPlanId = useCallback((id: string) => {
    setPlanIdState(id)
    try { localStorage.setItem(KEY, id) } catch { /* sin almacenamiento */ }
  }, [])

  /** Ejecuta un cambio en el servidor, informa el resultado y recarga (también si falló, por si otra persona cambió algo). */
  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setAviso(null)
    try {
      await fn()
      setAviso(ok)
      setError(null)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      await recargar()
    }
  }, [recargar])

  return { datos, data, cargando, error, aviso, setError, setAviso, recargar, ejecutar, planId: data?.plan?.id ?? planId, setPlanId }
}
