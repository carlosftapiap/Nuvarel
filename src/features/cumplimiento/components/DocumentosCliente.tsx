import { useCallback, useEffect, useState } from 'react'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { almacenContratosSupabase } from '@/features/contratos/almacen'
import { FieldError } from '@/features/inventario/components/shared'
import { definirTipoPersona, requisitosCliente, type Requisito, type TipoPersona } from '../expediente'
import { ListaRequisitos } from './Expediente'

/** Documentos habilitantes del cliente: se cargan aquí y los revisa el Oficial de Cumplimiento. Solo con Supabase. */
export default function DocumentosCliente({ clientId, nombre, onMessage }: { clientId: string; nombre: string; onMessage: (m: string) => void }) {
  const { remoto, datos, almacen } = useConexion()
  const { can } = useSession()
  const [tipo, setTipo] = useState<TipoPersona>('natural')
  const [requisitos, setRequisitos] = useState<Requisito[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const visible = remoto && !!datos && (can('clientes.editar') || can('cumplimiento.ver'))

  const recargar = useCallback(async () => {
    if (!datos) return
    const [f] = await datos.select<Record<string, unknown>>('clients', { filtros: { id: clientId } }).catch(() => [])
    const t = (f?.tipo_persona as TipoPersona | undefined) ?? 'natural'
    setTipo(t)
    setRequisitos(await requisitosCliente(datos, clientId, nombre, t))
  }, [datos, clientId, nombre])
  useEffect(() => { if (visible) void recargar() }, [visible, recargar])

  if (!visible || !datos || requisitos === null) return null
  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null)
    try { await fn(); onMessage(ok) } catch (e) { setError((e as Error).message) }
  }

  return (
    <section aria-labelledby="cs-docs" className="grid gap-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cs-docs" className="text-sm font-semibold">Documentos del expediente</h3>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Tipo de persona
          <select aria-label="Tipo de persona" className="rounded-md border border-border bg-white px-1.5 py-0.5 text-xs" value={tipo} disabled={!can('clientes.editar')}
            onChange={(e) => void ejecutar(async () => { await definirTipoPersona(datos, { clientId, buyerId: null }, e.target.value as TipoPersona); await recargar() }, 'Tipo de persona actualizado')}>
            <option value="natural">Natural</option>
            <option value="juridica">Jurídica</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Los revisa el Oficial de Cumplimiento antes de la firma del contrato. Finanzas no tiene acceso a estos archivos.</p>
      <ListaRequisitos requisitos={requisitos} datos={datos} almacen={almacen ?? almacenContratosSupabase} ejecutar={ejecutar} onCambio={recargar} />
      <FieldError>{error}</FieldError>
    </section>
  )
}
