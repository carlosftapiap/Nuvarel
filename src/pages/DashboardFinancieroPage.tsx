import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CloudOff, Loader2, Wallet } from 'lucide-react'
import { CabeceraPanel, KpiColor, TituloSeccion } from '@/components/CabeceraPanel'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import * as api from '@/features/cobranza/api'
import { porVerificar } from '@/features/cobranza/bandeja'
import { calcularTablero, TRAMOS_MORA } from '@/features/cobranza/tablero'
import { calcularIngresos, type Monto } from '@/features/cobranza/ingresos'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'

/** Indicadores de Finanzas con los mismos cálculos de Cobranzas: confirmado, saldo, vencido y pendiente de verificar. */
export default function DashboardFinancieroPage() {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) return <div className="module-empty"><span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Requiere la base de datos</h2></div>
  return <Panel datos={datos} />
}

/** Detalle de un indicador: si hay operaciones de prueba, se separan de las comerciales. */
const detalle = (m: Monto, texto: string) => (m.prueba > 0 ? `Comerciales ${fmtUsd2(m.comercial)} · prueba ${fmtUsd2(m.prueba)}` : texto)

/** Colores de la mora: del tramo más leve al más grave. */
const COLOR_MORA = ['bg-amber-300', 'bg-orange-400', 'bg-orange-500', 'bg-rose-500', 'bg-rose-700'] as const

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
  const ing = useMemo(() => (d ? calcularIngresos(d) : null), [d])
  if (!d || !t || !ing) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando indicadores…</p>
  const pendientes = porVerificar(d, t, actor.id)
  const maxMora = Math.max(1, ...TRAMOS_MORA.map((m) => t.mora[m.id]))
  const totalMora = TRAMOS_MORA.reduce((s, m) => s + t.mora[m.id], 0)

  return (
    <div className="grid gap-5">
      <CabeceraPanel eyebrow="Finanzas" title="Dashboard financiero" subtitle="Cobros confirmados, saldos y pagos pendientes de verificación. Lo reportado no se suma hasta confirmarlo."
        acciones={<><Link to="/pagos-por-verificar" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium">Pagos por verificar</Link><Link to="/cobranzas" className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium">Cobranzas</Link></>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiColor tono="verde" t="Reservas cobradas" v={fmtUsd2(ing.reservas.total)} d={detalle(ing.reservas, 'Ingresos de reserva verificados por Finanzas')} />
        <KpiColor tono="verde" t="Cuotas cobradas" v={fmtUsd2(ing.cuotas.total)} d={detalle(ing.cuotas, 'Pagos de contrato verificados, sin la reserva ya contada')} />
        <KpiColor tono="indigo" t="Total recibido" v={fmtUsd2(ing.recibido.total)} d={detalle(ing.recibido, 'Cada pago verificado cuenta una sola vez')} />
        <KpiColor tono="ambar" t="Pagos por verificar" v={pendientes.length} d={`${fmtUsd2(pendientes.reduce((s, f) => s + f.reportado, 0))} reportados, sin confirmar`} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiColor tono="indigo" t="Saldo por cobrar" v={fmtUsd2(t.saldo)} d={`Entrada pendiente de ${fmtUsd2(t.pactado)} pactados en contratos firmados`} />
        <KpiColor tono="rojo" t="Cuotas vencidas" v={fmtUsd2(t.vencido)} d={`Por vencer ${fmtUsd2(t.porVencer)} · vence hoy ${fmtUsd2(t.venceHoy)}`} alerta={t.vencido > 0} />
        <KpiColor tono="ambar" t="Devuelto" v={fmtUsd2(ing.devuelto)} d={`Pendiente de devolución ${fmtUsd2(ing.pendienteDevolucion)}`} />
        <KpiColor tono="verde" t="Recibido neto" v={fmtUsd2(ing.recibido.total - ing.devuelto)} d="Total recibido menos devoluciones autorizadas" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="mora-tit" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <TituloSeccion id="mora-tit" tono="rojo">Mora por días de atraso</TituloSeccion>
            <span className="text-xs text-slate-500">Total en mora {fmtUsd2(totalMora)}</span>
          </div>
          <ul className="mt-4 grid gap-3">
            {TRAMOS_MORA.map((m, k) => {
              const v = t.mora[m.id]
              const pct = Math.round((v / maxMora) * 100)
              return (
                <li key={m.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-sm">
                  <span className="font-medium text-slate-700">{m.label}</span>
                  <span className="h-3 overflow-hidden rounded-full bg-slate-100" role="presentation">
                    <span className={cn('block h-full rounded-full transition-[width] duration-500', v ? COLOR_MORA[k] : 'bg-transparent')} style={{ width: `${v ? Math.max(pct, 3) : 0}%` }} />
                  </span>
                  <span className={cn('text-right font-semibold tabular-nums', v ? 'text-slate-900' : 'text-slate-400')}>{fmtUsd2(v)}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-labelledby="desembolso-tit" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-5 text-white shadow-[0_16px_40px_-20px_#7c3aed]">
          <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
          <div className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-violet-100"><Wallet className="size-4" aria-hidden="true" />Banco</div>
          <h2 id="desembolso-tit" className="relative mt-2 text-sm font-medium text-violet-50">Desembolso bancario esperado (80 %)</h2>
          <div className="relative mt-1 font-display text-3xl font-bold tabular-nums">{fmtUsd2(t.desembolsoEsperado)}</div>
          <p className="relative mt-2 text-xs text-violet-100">Saldo contra entrega de contratos firmados. No es cartera de Nuvarel.</p>
        </section>
      </div>

      {pendientes.length > 0 && (
        <Link to="/pagos-por-verificar" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400 text-amber-950"><AlertTriangle className="size-[18px]" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm text-amber-950">{pendientes.length} {pendientes.length === 1 ? 'pago espera' : 'pagos esperan'} verificación</strong><span className="block text-xs text-amber-900">Lo reportado no se suma hasta confirmarlo.</span></span>
          <span className="text-sm font-semibold text-amber-900">Verificar →</span>
        </Link>
      )}
    </div>
  )
}
