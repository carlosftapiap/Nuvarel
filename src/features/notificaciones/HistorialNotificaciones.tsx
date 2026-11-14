import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import { cn } from '@/lib/utils'

/** Historial de avisos por evento: destinatario, evento, enlace, estado del envío y a quién se entregó de verdad (modo prueba). */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))

const EVENTOS: Record<string, string> = {
  reserva_por_aprobar: 'Reserva con excepción por autorizar',
  reserva_confirmada: 'Reserva confirmada',
  pago_por_verificar: 'Pago por verificar',
  contrato_por_documentar: 'Contrato por documentar',
  expediente_por_revisar: 'Expediente por revisar',
  expediente_observado: 'Expediente observado',
  expediente_rechazado: 'Expediente rechazado',
  expediente_aprobado: 'Expediente aprobado',
  contrato_por_firmar: 'Contrato listo para firma',
  contrato_anulado: 'Contrato anulado',
  pago_anulado: 'Pago anulado',
  excedente_aplicado: 'Excedente aplicado',
  excedente_anulado: 'Excedente anulado',
  movimiento_por_autorizar: 'Devolución o retención por autorizar',
  recordatorio_reserva_por_aprobar: 'Recordatorio: excepción por autorizar',
  recordatorio_contrato_por_documentar: 'Recordatorio: contrato sin enviar',
  recordatorio_expediente_por_revisar: 'Recordatorio: expediente por revisar',
  recordatorio_contrato_por_firmar: 'Recordatorio: contrato sin firma',
}
const ESTADO: Record<string, { label: string; tono: string }> = {
  pendiente: { label: 'Por enviar', tono: 'bg-slate-50 text-slate-700 ring-slate-200' },
  enviada: { label: 'Enviada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  fallida: { label: 'Fallida', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
  cancelada: { label: 'Cancelada', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

interface Aviso {
  id: string; evento: string; asunto: string; destinatario: string; efectivo: string | null; enlace: string | null; estado: string
  intentos: number; error: string | null; creadaEn: string; enviadaEn: string | null
}

const cargarAvisos = (d: Datos): Promise<Aviso[]> =>
  d.select<Fila>('cobranza_alertas', { orden: [{ columna: 'creada_en', asc: false }], limite: 300 })
    .then((f) => f.filter((a) => a.evento).map((a) => ({
      id: String(a.id), evento: String(a.evento), asunto: String(a.asunto), destinatario: String(a.destinatario), efectivo: s(a.destinatario_efectivo),
      enlace: s(a.enlace), estado: String(a.estado), intentos: Number(a.intentos ?? 0), error: s(a.error), creadaEn: String(a.creada_en), enviadaEn: s(a.enviada_en),
    })))

export default function HistorialNotificaciones({ datos }: { datos: Datos }) {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState('todos')
  const cargar = useCallback(async () => {
    try { setAvisos(await cargarAvisos(datos)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])
  const visibles = useMemo(() => (avisos ?? []).filter((a) => estado === 'todos' || a.estado === estado), [avisos, estado])

  if (error) return <p className="text-sm text-rose-700">{error}</p>
  if (!avisos) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando notificaciones…</p>
  return (
    <section className="dashboard-card grid gap-3 p-5" aria-labelledby="notif-titulo">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="notif-titulo" className="text-sm font-semibold">Notificaciones internas</h2>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">Estado
          <select aria-label="Estado del envío" className="rounded-md border border-border bg-white px-1.5 py-0.5 text-xs" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="todos">Todos</option>
            {Object.entries(ESTADO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => void cargar()}><RefreshCw />Actualizar</Button>
      </div>
      <p className="text-xs text-muted-foreground">Se generan con cada hecho y se envían en la tarea programada. En modo prueba todo se entrega solo al buzón de pruebas: la columna «Entregado a» lo muestra.</p>
      {visibles.length === 0 ? <p className="text-xs text-muted-foreground">Sin notificaciones.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-xs text-muted-foreground"><tr>
              <th className="px-3 py-1.5 text-left font-medium">Creada</th><th className="px-2 py-1.5 text-left font-medium">Evento</th><th className="px-2 py-1.5 text-left font-medium">Asunto</th>
              <th className="px-2 py-1.5 text-left font-medium">Destinatario</th><th className="px-2 py-1.5 text-left font-medium">Entregado a</th><th className="px-3 py-1.5 text-left font-medium">Estado</th>
            </tr></thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{new Date(a.creadaEn).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</td>
                  <td className="px-2 py-1.5">{EVENTOS[a.evento] ?? a.evento}</td>
                  <td className="px-2 py-1.5">{a.enlace ? <Link className="underline underline-offset-2" to={a.enlace}>{a.asunto}</Link> : a.asunto}</td>
                  <td className="px-2 py-1.5">{a.destinatario}</td>
                  <td className="px-2 py-1.5">{a.efectivo ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', ESTADO[a.estado]?.tono)}>{ESTADO[a.estado]?.label ?? a.estado}</span>
                    {a.error && <div className="text-xs text-muted-foreground">{a.error}</div>}
                    {a.intentos > 0 && <div className="text-xs text-muted-foreground">{a.intentos} intento(s)</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
