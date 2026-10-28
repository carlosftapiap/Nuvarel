import { useCallback, useEffect, useState } from 'react'
import type { Cotizacion, DatosPersona } from './cotizacion'

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

/** Cotizaciones emitidas (persistidas en el navegador hasta conectar Supabase). */
export function useCotizaciones() {
  const [lista, setLista] = useState<Cotizacion[]>(() => leer(KEY, [] as Cotizacion[]))
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(lista)) } catch { /* sin almacenamiento */ }
  }, [lista])
  const agregar = useCallback((c: Cotizacion) => setLista((l) => [c, ...l]), [])
  return { lista, agregar }
}

export const ASESOR_VACIO: DatosPersona = { nombre: '', email: '', telefono: '' }

export function leerAsesor(): DatosPersona {
  return { ...ASESOR_VACIO, ...leer(KEY_ASESOR, ASESOR_VACIO) }
}

export function guardarAsesor(a: DatosPersona) {
  try { localStorage.setItem(KEY_ASESOR, JSON.stringify(a)) } catch { /* ignorar */ }
}
