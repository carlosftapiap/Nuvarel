import { useCallback, useEffect, useRef, useState } from 'react'
import { useConexion } from '@/app/auth'
import { useRefresco } from '@/features/conexion/refresco'
import { useInventory } from '@/features/inventario/store'
import type { Cotizacion, DatosPersona } from './cotizacion'
import { cargarCotizaciones, emitirCotizacion, type EmitirInput } from './remoto'

const KEY = 'amura.cotizaciones.v1'
const KEY_ASESOR = 'amura.cotizaciones.asesor'

function leer<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Cotizaciones emitidas. Sin Supabase se guardan en el navegador; con Supabase se leen de la base y las emite el servidor. */
export function useCotizaciones() {
  const { remoto, datos } = useConexion()
  const { state: inv } = useInventory()
  const conectado = remoto && !!datos
  const [lista, setLista] = useState<Cotizacion[]>(() => (conectado ? [] : leer(KEY, [] as Cotizacion[])))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // Conectado no se escribe aquí: la copia local anterior se conserva intacta.
    if (conectado) return
    try { localStorage.setItem(KEY, JSON.stringify(lista)) } catch { /* sin almacenamiento */ }
  }, [lista, conectado])
  const units = useRef(inv.units)
  units.current = inv.units
  const recargar = useCallback(async () => {
    if (!datos) return
    try {
      setLista(await cargarCotizaciones(datos, units.current))
      setError(null)
    } catch (e) {
      setError(`No se pudieron cargar las cotizaciones: ${(e as Error).message}`)
    }
  }, [datos])
  useRefresco(recargar, conectado)
  const agregar = useCallback((c: Cotizacion) => setLista((l) => [c, ...l]), [])
  const emitir = useCallback(async (input: EmitirInput) => {
    const c = await emitirCotizacion(datos!, input, units.current)
    await recargar()
    return c
  }, [datos, recargar])
  return { lista, agregar, emitir, recargar, error, remoto: conectado }
}

export const ASESOR_VACIO: DatosPersona = { nombre: '', email: '', telefono: '' }

export function leerAsesor(): DatosPersona {
  return { ...ASESOR_VACIO, ...leer(KEY_ASESOR, ASESOR_VACIO) }
}

export function guardarAsesor(a: DatosPersona) {
  try { localStorage.setItem(KEY_ASESOR, JSON.stringify(a)) } catch { /* ignorar */ }
}
