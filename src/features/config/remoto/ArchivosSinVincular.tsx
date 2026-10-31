import { useCallback, useEffect, useState } from 'react'
import { useConexion } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { almacenPagos, BUCKET_COMPROBANTES } from '@/features/cobranza/comprobantes'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'

/** Cargas que nunca se registraron. La base solo lista y permite quitar lo que ninguna operación usa, con más de 24 horas. */
export default function ArchivosSinVincular({
  datos, titulo = 'Archivos de pago sin vincular', descripcion = 'Cargas que no llegaron a registrarse hace más de 24 horas. Los comprobantes y recibos vinculados no aparecen aquí y no se pueden quitar.',
  rpcListar = 'comprobantes_sin_vincular', rpcRegistrar = 'comprobante_limpieza_registrar', bucket = BUCKET_COMPROBANTES,
}: { datos: Datos; titulo?: string; descripcion?: string; rpcListar?: string; rpcRegistrar?: string; bucket?: string }) {
  const conexion = useConexion()
  const [archivos, setArchivos] = useState<{ ruta: string; cargado_en: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    try { setArchivos(await datos.rpc<{ ruta: string; cargado_en: string }[]>(rpcListar)) } catch { setArchivos(null) }
  }, [datos, rpcListar])
  useEffect(() => { void cargar() }, [cargar])

  async function quitar(ruta: string) {
    setError(null); setAviso(null); setOcupado(true)
    try {
      const almacen = almacenPagos(conexion)
      if (!almacen?.quitar) throw new Error('El almacenamiento no está disponible.')
      await datos.rpc(rpcRegistrar, { p_ruta: ruta })
      await almacen.quitar(bucket, ruta)
      setAviso('Archivo quitado.')
    } catch (e) { setError((e as Error).message) } finally {
      await cargar()
      setOcupado(false)
    }
  }

  if (!archivos) return null
  return (
    <section aria-label={titulo} className="dashboard-card p-4">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{descripcion}</p>
      {archivos.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No hay archivos sin vincular.</p> : (
        <ul className="mt-2 grid gap-1.5 text-xs">
          {archivos.map((a) => (
            <li key={a.ruta} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{a.ruta}</span>
              <span className="text-muted-foreground">{new Date(a.cargado_en).toLocaleString('es-EC')}</span>
              <Button size="xs" variant="outline" disabled={ocupado} onClick={() => void quitar(a.ruta)}>Quitar</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 empty:hidden"><FieldError>{error}</FieldError></div>
      {aviso && <p role="status" className="mt-2 text-xs text-emerald-800">{aviso}</p>}
    </section>
  )
}
