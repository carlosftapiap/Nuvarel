import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck, CloudOff, Loader2, Lock } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import * as api from '@/features/cobranza/api'
import { porVerificar, type FilaPorVerificar } from '@/features/cobranza/bandeja'
import { almacenPagos, MEDIOS_PAGO } from '@/features/cobranza/comprobantes'
import RevisionPago from '@/features/cobranza/components/RevisionPago'
import { calcularTablero } from '@/features/cobranza/tablero'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'

/** Pantalla de inicio de Finanzas: comprobantes reportados que esperan verificación. Confirmar o rechazar usa las reglas de siempre. */
export default function PagosPorVerificarPage() {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  if (!remoto || !datos) {
    return <div className="module-empty"><span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Requiere la base de datos</h2></div>
  }
  if (!can('cobranzas.verificar') && !can('reservas.verificar_pago')) {
    return <div className="module-empty"><span className="module-empty-icon"><Lock className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Sin acceso a la verificación de pagos</h2></div>
  }
  return <Bandeja datos={datos} />
}

function Bandeja({ datos }: { datos: Datos }) {
  const { actor } = useSession()
  const conexion = useConexion()
  const [d, setD] = useState<api.DatosCobranza | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<FilaPorVerificar | null>(null)
  const hoy = hoyGuayaquil()

  const cargar = useCallback(async () => {
    try { setD(await api.cargarCobranza(datos)) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useRefresco(cargar)

  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setError(null); setAviso(null)
    try { await fn(); setAviso(ok); await cargar(); return true } catch (e) { setError((e as Error).message); await cargar(); return false }
  }, [cargar])

  const filas = useMemo(() => (d ? porVerificar(d, calcularTablero(d.contratos, d.cuotas, d.pagos, hoy, d.aplicaciones), actor.id) : []), [d, hoy, actor.id])
  if (!d) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando pagos por verificar…</p>
  const total = filas.reduce((t, f) => t + f.reportado, 0)

  return (
    <div className="grid gap-4">
      <PageHeader eyebrow="Finanzas" title="Pagos por verificar" subtitle="Comprobantes reportados que esperan tu confirmación. Un pago reportado no está confirmado hasta que lo verificas en el banco." />
      {aviso && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      <FieldError>{error}</FieldError>
      <p className="text-sm"><b>{filas.length}</b> comprobante(s) por verificar · {fmtUsd2(total)} reportados</p>
      {filas.length === 0 ? (
        <div className="module-empty"><span className="module-empty-icon"><ClipboardCheck className="size-7" aria-hidden="true" /></span><p className="text-sm text-muted-foreground">No hay pagos esperando verificación.</p></div>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-xs text-muted-foreground"><tr>
              <th className="px-4 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Proyecto y unidad</th><th className="px-2 py-2 text-left font-medium">Reserva o contrato</th>
              <th className="px-2 py-2 text-right font-medium">Reportado</th><th className="px-2 py-2 text-right font-medium">Confirmado</th><th className="px-2 py-2 text-right font-medium">Saldo pendiente</th>
              <th className="px-2 py-2 text-left font-medium">Fecha del pago</th><th className="px-2 py-2 text-left font-medium">Comprobante</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.comprobante.id} className="border-t border-border align-top">
                  <td className="px-4 py-2 font-medium">{f.cliente}</td>
                  <td className="px-2 py-2">{f.unidad}</td>
                  <td className="px-2 py-2">{f.tipo === 'reserva' ? `Reserva ${f.numero}` : `Contrato ${f.numero}`}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.reportado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.confirmado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtUsd2(f.saldo)}</td>
                  <td className="px-2 py-2 tabular-nums">{fmtFechaCorta(f.fecha)}<div className="text-xs text-muted-foreground">{MEDIOS_PAGO[f.comprobante.medio].label} · ref. {f.comprobante.referencia}</div></td>
                  <td className="px-2 py-2">{f.comprobante.archivoNombre ?? (f.comprobante.ruta ? 'Adjunto' : 'Sin archivo')}</td>
                  <td className="px-2 py-2"><span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">Por verificar</span></td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Button size="xs" variant={f.propio ? 'outline' : 'default'} onClick={() => { setError(null); setAviso(null); setAbierto(f) }}>{f.propio ? 'Ver pago' : 'Revisar pago'}</Button>
                    {f.propio && <div className="mt-1 text-xs text-muted-foreground">Lo registraste tú: lo verifica otra persona</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {abierto && (
        <RevisionPago
          pago={{ tipo: abierto.tipo, id: abierto.id, titulo: `${abierto.tipo === 'reserva' ? 'Pago de' : 'Pago del contrato'} ${abierto.numero} · ${abierto.cliente}`, monto: abierto.reportado, referencia: abierto.comprobante.referencia, fecha: abierto.fecha, pendiente: true, propio: abierto.propio }}
          comprobantes={d.comprobantes.filter((k) => (abierto.tipo === 'reserva' ? k.reservaId : k.pagoId) === abierto.id)}
          recibo={null} datos={datos} almacen={almacenPagos(conexion)} ejecutar={ejecutar} onClose={() => setAbierto(null)} />
      )}
    </div>
  )
}
