import { useEffect } from 'react'

/** Cada cuánto se traen los cambios de otras personas mientras la pantalla está visible. */
const REFRESCO_MS = 60_000

/** Carga al montar y vuelve a leer al regresar a la pestaña y cada cierto tiempo. */
export function useRefresco(recargar: () => void | Promise<void>, activo = true) {
  useEffect(() => {
    if (!activo) return
    void recargar()
    const alVolver = () => { if (document.visibilityState === 'visible') void recargar() }
    window.addEventListener('focus', alVolver)
    const t = setInterval(alVolver, REFRESCO_MS)
    return () => { window.removeEventListener('focus', alVolver); clearInterval(t) }
  }, [recargar, activo])
}
