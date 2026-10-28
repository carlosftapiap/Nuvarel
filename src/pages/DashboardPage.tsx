import { useMemo, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, ArrowRight, Building2, ChevronRight, Info, Plus, Ruler, Wallet, type LucideIcon } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { tieneDiscrepancia } from '@/features/inventario/data/data-quality'
import { ESTADO_ORDEN, ESTADOS } from '@/features/inventario/estados'
import { fmtNum, fmtUsd } from '@/features/inventario/pricing'
import { resumenInventario } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'

// Solo datos reales: provienen del módulo de Inventario (lista base del 28/10/2026).

interface MetricData {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  color: string
  soft: string
}

interface AlertData {
  title: string
  detail: string
  icon: LucideIcon
  color: string
  soft: string
  to: string
}

interface RingRow { key: string; label: string; value: number; color: string }

function ProjectIllustration() {
  return (
    <svg className="banner-art" viewBox="0 0 260 170" fill="none" aria-hidden="true">
      <circle cx="147" cy="89" r="76" fill="#e1eaff" />
      <circle cx="218" cy="35" r="13" fill="#b9cbff" />
      <path d="M20 151H249" stroke="#bbccf4" strokeWidth="1.5" />
      <path d="M75 151V42L123 21L171 42V151" fill="#f8faff" stroke="#6b92ed" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M123 21V151M75 42L123 61L171 42M75 68L123 87L171 68M75 94L123 113L171 94M75 120L123 139L171 120" stroke="#8aabf3" strokeWidth="1.3" />
      <path d="M157 151V83L191 69L225 83V151" fill="#d4e2ff" stroke="#6b92ed" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M191 69V151M157 102L191 116L225 102M157 124L191 138L225 124M174 90V145M208 90V145" stroke="#8aabf3" strokeWidth="1.2" />
    </svg>
  )
}

function MetricCard({ label, value, hint, icon: Icon, color, soft }: MetricData) {
  return (
    <article className="metric-card" style={{ '--metric-color': color, '--metric-soft': soft } as CSSProperties}>
      <div className="metric-heading"><h2>{label}</h2><span className="metric-icon"><Icon className="size-4" aria-hidden="true" /></span></div>
      <p className="metric-value">{value}</p>
      <div className="metric-footer"><span>{hint}</span></div>
    </article>
  )
}

function InventoryRing({ rows, total }: { rows: RingRow[]; total: number }) {
  const resumen = rows.map((r) => `${r.value} ${r.label.toLowerCase()}`).join(', ')
  return (
    <div className="inventory-ring" role="img" aria-label={`${total} unidades: ${resumen}`}>
      <svg viewBox="0 0 120 120">
        {rows.map((item, index) => {
          const length = total ? (item.value / total) * 100 : 0
          const start = total ? (rows.slice(0, index).reduce((sum, entry) => sum + entry.value, 0) / total) * 100 : 0
          return <circle key={item.key} cx="60" cy="60" r="49" pathLength="100" fill="none" stroke={item.color} strokeWidth="10" strokeDasharray={`${Math.max(length - 1.5, 0)} ${100 - length + 1.5}`} strokeDashoffset={-start} />
        })}
      </svg>
      <div className="ring-center"><strong>{total}</strong><span>unidades totales</span></div>
    </div>
  )
}

export default function DashboardPage() {
  const { state } = useInventory()
  const inv = useMemo(() => resumenInventario(state), [state])
  const bodegasDiscrepantes = useMemo(() => state.units.filter(tieneDiscrepancia).length, [state.units])
  const porConfirmar = inv.porEstado.por_confirmar

  const metrics: MetricData[] = [
    { label: 'Departamentos', value: String(inv.unidades), hint: `Edificio 1: ${inv.porEdificio[1]} · Edificio 2: ${inv.porEdificio[2]}`, icon: Building2, color: '#3563f3', soft: '#edf2ff' },
    { label: 'Valor total de lista', value: fmtUsd(inv.total), hint: `Promedio ${fmtUsd(inv.promedio)} por unidad`, icon: Wallet, color: '#0b9f85', soft: '#e7f8f2' },
    { label: 'USD/m² promedio', value: fmtNum(inv.usdM2Promedio), hint: 'Sobre área + bodega, sin patio', icon: Ruler, color: '#8b5cf6', soft: '#f2ecff' },
    { label: 'Unidades disponibles', value: `${inv.porEstado.disponible} de ${inv.unidades}`, hint: `${porConfirmar} por confirmar`, icon: Building2, color: '#dc9629', soft: '#fff5e3' },
  ]

  const ringRows: RingRow[] = ESTADO_ORDEN
    .map((e) => ({ key: e, label: ESTADOS[e].label, value: inv.porEstado[e], color: ESTADOS[e].color }))
    .filter((r) => r.value > 0)

  const alerts: AlertData[] = [
    ...(porConfirmar
      ? [{ title: `${porConfirmar} unidades sin disponibilidad confirmada`, detail: 'Estado comercial oficial pendiente', icon: Info, color: '#3563f3', soft: '#edf2ff', to: '/inventario' }]
      : []),
    ...(bodegasDiscrepantes
      ? [{ title: `${bodegasDiscrepantes} bodegas con discrepancia`, detail: 'Segregación de bodegas vs. lista de precios', icon: AlertCircle, color: '#9a691d', soft: '#fff5e3', to: '/inventario' }]
      : []),
  ]

  return (
    <div className="dashboard">
      <PageHeader title="Tu proyecto, en perspectiva." eyebrow="Panel general" subtitle="Información real del proyecto AMURA, tomada del módulo de Inventario."
        actions={<Button asChild className="h-9 gap-2 text-[11px] shadow-sm"><Link to="/cotizaciones"><Plus className="size-3.5" />Nueva cotización</Link></Button>} />

      <section className="overview-banner" aria-label="Resumen del proyecto">
        <div>
          <div className="banner-eyebrow"><span className="size-1.5 rounded-full bg-primary" />AMURA Apartments · Inmobiliaria Jarval</div>
          <h2>{inv.unidades} departamentos<br className="hidden sm:block" /> en dos edificios.</h2>
          <p>Precios referenciales de la lista base del 28/10/2026, pendientes de aprobación.</p>
          <Link to="/inventario" className="section-link mt-3 text-[11px]">Explorar inventario<ArrowRight className="size-3.5" /></Link>
        </div>
        <ProjectIllustration />
      </section>

      <section className="metrics-grid" aria-label="Indicadores del inventario">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </section>

      <div className="dashboard-bottom">
        <section className="dashboard-card" aria-labelledby="inventory-heading">
          <div className="section-heading"><div><h2 id="inventory-heading">Estado del inventario</h2><p>Unidades por estado comercial</p></div><Link to="/inventario" className="section-link" aria-label="Ver inventario"><ArrowUpRight className="size-4" /></Link></div>
          <div className="inventory-content"><InventoryRing rows={ringRows} total={inv.unidades} /><div className="inventory-legend">{ringRows.map((item) => <div key={item.key}><span><i className="legend-dot" style={{ background: item.color }} />{item.label}</span><b>{item.value}</b></div>)}</div></div>
          <p className="inventory-note">Por confirmar: unidades sin disponibilidad oficial recibida.</p>
        </section>

        <section className="dashboard-card" aria-labelledby="alerts-heading">
          <div className="section-heading"><div><h2 id="alerts-heading">Pendientes del inventario</h2><p>Datos que requieren confirmación</p></div><span className="alerts-count" aria-label={`${alerts.length} pendientes`}>{alerts.length}</span></div>
          {alerts.length ? (
            <div className="alert-list">{alerts.map(({ title, detail, icon: Icon, color, soft, to }) => (
              <Link key={title} to={to} className="alert-item group">
                <span className="alert-icon" style={{ background: soft, color }}><Icon className="size-3.5" aria-hidden="true" /></span>
                <span className="alert-copy"><strong className="group-hover:underline">{title}</strong><span>{detail}</span></span>
                <ChevronRight className="size-3.5" aria-hidden="true" />
              </Link>
            ))}</div>
          ) : <p className="px-5 py-6 text-xs text-muted-foreground">No hay pendientes.</p>}
        </section>
      </div>
      <p className="dashboard-footnote"><Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" /><span>Cifras del módulo de Inventario. Precios referenciales sujetos a aprobación. Ventas, cobranzas y reservas se mostrarán cuando existan registros.</span></p>
    </div>
  )
}
