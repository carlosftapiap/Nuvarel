import { useCallback, useState } from 'react'
import type { Permiso } from '@/app/permissions'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import type { Almacen } from './almacen'
import type { DatosObra, Frente } from './model'
import { cargarObra } from './remoto'

/** Lo que cada pestaña necesita para leer y guardar. La base vuelve a comprobar cada permiso. */
export interface ContextoBase {
  datos: Datos
  obra: DatosObra
  recargar: () => Promise<void>
  usuarioId: string
  usuario: string
  can: (p: Permiso) => boolean
  almacen: Almacen
}
export interface ContextoObra extends ContextoBase { frente: Frente }

export function useObra(datos: Datos) {
  const [obra, setObra] = useState<DatosObra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recargar = useCallback(async () => {
    try {
      setObra(await cargarObra(datos))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [datos])
  useRefresco(recargar)
  return { obra, error, recargar }
}
