import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/features/inventario/components/shared'
import type { Cliente } from '../model'
import { definirImportacion, importarClientes, revisarImportacion, verificarImportacion, type EstadoImportacion, type ResultadoImportacion } from '../remoto'
import { archivarClientesLocales, leerClientesLocales, useClientes } from '../store'

const TEXTO: Record<EstadoImportacion, { label: string; tono: string }> = {
  nuevo: { label: 'Se importará', tono: 'text-emerald-700' },
  importado: { label: 'Importado', tono: 'text-emerald-700' },
  ya_importado: { label: 'Ya estaba importado', tono: 'text-muted-foreground' },
  duplicado: { label: 'Duplicado: no se importa', tono: 'text-amber-700' },
  error: { label: 'Con error', tono: 'text-rose-700' },
}

/** Aviso y asistente para pasar a la base de datos los clientes guardados solo en este navegador. */
export default function ImportarLocal({ onMessage }: { onMessage: (m: string) => void }) {
  const { remoto, datos, faltaMigracion, recargar, importacionAbierta } = useClientes()
  const { can } = useSession()
  const [locales, setLocales] = useState<Cliente[]>(() => (remoto ? leerClientesLocales() : []))
  const [abierto, setAbierto] = useState(false)
  // Cerrada la importación ordinaria, solo administración conserva la recuperación.
  if (!remoto || !datos || !can('clientes.editar') || locales.length === 0 || (!importacionAbierta && !can('config.usuarios'))) return null
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>Hay {locales.length} cliente{locales.length === 1 ? '' : 's'} guardado{locales.length === 1 ? '' : 's'} solo en este navegador. Pásalos a la base de datos para que el equipo los vea.</span>
        <Button size="xs" variant="outline" className="ml-auto" disabled={faltaMigracion} onClick={() => setAbierto(true)}>Revisar e importar</Button>
      </div>
      {abierto && (
        <ImportarDialog clientes={locales} onClose={() => setAbierto(false)} onImportado={recargar}
          onArchivado={() => { archivarClientesLocales(); setLocales([]); setAbierto(false); onMessage('Importación verificada. La copia local quedó archivada en este navegador.') }} />
      )}
    </>
  )
}

function ImportarDialog({ clientes, onClose, onImportado, onArchivado }: { clientes: Cliente[]; onClose: () => void; onImportado: () => Promise<void>; onArchivado: () => void }) {
  const { datos, importacionAbierta, recargar } = useClientes()
  const { can } = useSession()
  const [filas, setFilas] = useState<ResultadoImportacion[] | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null: todavía no se ha verificado; lista vacía: todo comprobado en la base de datos.
  const [sinVerificar, setSinVerificar] = useState<string[] | null>(null)

  const guardadosEn = (r: ResultadoImportacion[]) => clientes.filter((c) => ['importado', 'ya_importado'].includes(r.find((x) => x.origen_id === c.id)?.estado ?? ''))

  useEffect(() => {
    let vivo = true
    const revisar = async () => {
      const r = await revisarImportacion(datos!, clientes)
      if (vivo) setFilas(r)
      // Si no queda nada por importar (p. ej. al reabrir tras importar), se comprueba de una vez para poder archivar.
      if (!r.some((f) => f.estado === 'nuevo')) {
        const pendientes = await verificarImportacion(datos!, guardadosEn(r))
        if (vivo) setSinVerificar(pendientes)
      }
    }
    revisar().catch((e: Error) => { if (vivo) setError(e.message) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, clientes])

  const porId = useMemo(() => new Map((filas ?? []).map((f) => [f.origen_id, f])), [filas])
  const porImportar = (filas ?? []).filter((f) => f.estado === 'nuevo').length
  const conReserva = clientes.filter((c) => c.etapa === 'reserva' && porId.get(c.id)?.estado === 'nuevo').length
  // Solo se archiva si todo está en la base o quedó descartado por ser un duplicado que ya existe en ella.
  const importables = clientes.filter((c) => ['nuevo', 'importado', 'ya_importado'].includes(porId.get(c.id)?.estado ?? ''))
  const puedeArchivar = sinVerificar?.length === 0 && !(filas ?? []).some((f) => f.estado === 'error' || f.estado === 'nuevo')

  const importar = async () => {
    setEnviando(true); setError(null)
    try {
      const r = await importarClientes(datos!, clientes)
      setFilas(r)
      await onImportado()
      setSinVerificar(await verificarImportacion(datos!, guardadosEn(r)))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar clientes de este navegador</DialogTitle>
          <DialogDescription>Revisa la lista antes de confirmar. Repetir la importación no duplica clientes y la copia local no se borra.</DialogDescription>
        </DialogHeader>
        <FieldError>{error}</FieldError>
        {!filas && !error && <p className="text-sm text-muted-foreground">Revisando duplicados…</p>}
        {filas && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted text-[11px] text-muted-foreground"><tr><th className="px-3 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Contacto</th><th className="px-3 py-2 text-left font-medium">Resultado</th></tr></thead>
              <tbody>
                {clientes.map((c) => {
                  const f = porId.get(c.id)
                  const t = f ? TEXTO[f.estado] : null
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium">{c.nombre}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{c.telefono || c.email}</td>
                      <td className={`px-3 py-1.5 ${t?.tono ?? ''}`}>{t?.label}{f?.detalle ? ` · ${f.detalle}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {conReserva > 0 && <p className="text-[11px] text-amber-800">{conReserva} cliente{conReserva === 1 ? '' : 's'} en Reserva local pasará{conReserva === 1 ? '' : 'n'} a Negociación: la reserva solo se confirma en el módulo Reservas.</p>}
        {importables.length > 0 && !sinVerificar && <p className="text-[11px] text-muted-foreground">Si el asesor original no existe en la base de datos o no tienes permiso para asignarle, el cliente quedará a tu nombre.</p>}
        {sinVerificar && sinVerificar.length > 0 && <FieldError>{`No se pudo comprobar: ${sinVerificar.join(', ')}. La copia local se conserva; vuelve a intentarlo.`}</FieldError>}
        {sinVerificar?.length === 0 && <p role="status" className="text-xs text-emerald-800">Comprobado en la base de datos: los clientes importados y su historial quedaron guardados.</p>}
        {can('config.usuarios') && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[11px] text-muted-foreground">
            {importacionAbierta ? 'Importación abierta para todo el equipo. Ciérrala al terminar la migración; administración podrá seguir usándola.' : 'Importación cerrada para el equipo: solo administración puede usarla.'}
            <Button size="xs" variant="outline" className="ml-auto" disabled={enviando}
              onClick={() => { setError(null); definirImportacion(datos!, !importacionAbierta, importacionAbierta ? 'Migración de clientes locales terminada' : 'Recuperación de datos locales').then(recargar).catch((e: Error) => setError(e.message)) }}>
              {importacionAbierta ? 'Cerrar importación' : 'Reabrir importación'}
            </Button>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          {puedeArchivar
            ? <Button onClick={onArchivado}>Archivar copia local</Button>
            : <Button disabled={!porImportar || enviando} onClick={() => void importar()}>{enviando ? 'Importando…' : `Importar ${porImportar} cliente${porImportar === 1 ? '' : 's'}`}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
