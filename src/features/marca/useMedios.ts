import { useEffect, useState } from 'react'
import { useConexion } from '@/app/auth'
import { almacenPagos } from '@/features/cobranza/comprobantes'
import { cargarPublicados, RENOVAR_MS } from './biblioteca'
import { MEDIOS_BASE, paraUbicacion, type Medio, type UbicacionMedio } from './medios'

/**
 * Lo publicado para esta pantalla; null mientras carga.
 * Si la biblioteca aún no está activa en la base de datos, se muestra el material incluido en la app.
 * Renueva las direcciones firmadas antes de que venzan, por si la pantalla sigue abierta todo el día.
 */
export function useMedios(donde: UbicacionMedio): Medio[] | null {
  const conexion = useConexion()
  const { datos } = conexion
  const [medios, setMedios] = useState<Medio[] | null>(datos ? null : MEDIOS_BASE)
  useEffect(() => {
    if (!datos) return
    let vivo = true
    const cargar = () => cargarPublicados(datos, almacenPagos(conexion)).catch(() => MEDIOS_BASE).then((m) => { if (vivo) setMedios(m) })
    void cargar()
    const reloj = setInterval(() => void cargar(), RENOVAR_MS)
    return () => { vivo = false; clearInterval(reloj) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la conexión cambia con la sesión, igual que `datos`.
  }, [datos])
  return medios && paraUbicacion(medios, donde)
}
