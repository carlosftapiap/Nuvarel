import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CloudOff, Loader2 } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import * as api from '@/features/cobranza/api'
import { porVerificar } from '@/features/cobranza/bandeja'
import { calcularTablero, TRAMOS_MORA } from '@/features/cobranza/tablero'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'

/** Indicadores de Finanzas con los mismos cálculos de Cobranzas: confirmado, saldo, vencido y pendiente de verificar. */
export default function DashboardFinancieroPage() {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) return <div className="module-empty"><span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Requiere la base de datos</h2></div>
  return <Panel datos={datos} />
}

function Kpi({ t, v, d, tono }: { t: string; v: string; d: string; tono?: string }) {
  return <div className="dashboard-card !p-4"><div className="text-xs text-muted-foreground">{t}</div><div className={`mt-1 text-lg font-semibold tabular-nums tracking-tight ${tono ?? ''}`}>{v}</div><div className="mt-0.5 text-xs text-muted-foreground">{d}</div></div>
}

function Panel({ datos }: { datos: Datos }) {
  const { actor } = useSession()
  const [d, setD] = useState<api.DatosCobranza | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hoy = hoyGuayaquil()
  const cargar = useCallback(async () => {
    try { setD(await api.cargarCobranza(datos)) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useRefresco(cargar)
  const t = useMemo(() => (d ? calcularTablero(d.contratos, d.cuotas, d.pagos, hoy, d.aplicaciones) : null), [d, hoy])
  if (!d || !t) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando indicadores…</p>
  const pendientes = porVerificar(d, t, actor.id)

  return (
    <div className="grid gap-4">
      <PageHeader eyebrow="Finanzas" title="Dashboard financiero" subtitle="Cobros confirmados, saldos y pagos pendientes de verificación. Lo reportado no se suma hasta confirmarlo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi t="Cobrado confirmado" v={fmtUsd2(t.cobrado + t.reservasPreFirma)} d={`Entrada de contratos firmados ${fmtUsd2(t.cobrado)} · contratos sin firmar ${fmtUsd2(t.reservasPreFirma)}`} />
        <Kpi t="Saldo pendiente de la entrada" v={fmtUsd2(t.saldo)} d={`De ${fmtUsd2(t.pactado)} pactados en contratos firmados`} />
        <Kpi t="Vencido" v={fmtUsd2(t.vencido)} d={`Por vencer ${fmtUsd2(t.porVencer)} · vence hoy ${fmtUsd2(t.venceHoy)}`} tono={t.vencido ? 'text-rose-700' : undefined} />
        <Kpi t="Pagos por verificar" v={String(pendientes.length)} d={`${fmtUsd2(pendientes.reduce((s, f) => s + f.reportado, 0))} reportados, sin confirmar`} tono={pendientes.length ? 'text-amber-700' : undefined} />
      </div>
      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <div className="dashboard-card !p-0 overflow-x-auto">
          <div className="px-4 pt-3 text-xs font-semibold">Mora por días de atraso</div>
          <table className="w-full text-xs">
            <thead className="text-xs text-muted-foreground"><tr>{TRAMOS_MORA.map((m) => <th key={m.id} className="px-4 py-2 text-right font-medium">{m.label}</th>)}</tr></thead>
            <tbody><tr>{TRAMOS_MORA.map((m) => <td key={m.id} className="px-4 py-2 text-right tabular-nums">{fmtUsd2(t.mora[m.id])}</td>)}</tr></tbody>
          </table>
        </div>
        <Kpi t="Desembolso bancario esperado (80 %)" v={fmtUsd2(t.desembolsoEsperado)} d="Saldo contra entrega de contratos firmados: no es cartera de Nuvarel" />
      </div>
      <p className="text-xs"><Link className="underline underline-offset-2" to="/pagos-por-verificar">Ir a pagos por verificar</Link> · <Link className="underline underline-offset-2" to="/cobranzas">Ir a Cobranzas</Link></p>
    </div>
  )
}
