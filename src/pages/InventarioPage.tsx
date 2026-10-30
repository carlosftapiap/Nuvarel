import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RowSelectionState } from '@tanstack/react-table'
import { AlertTriangle, Building2, CheckCircle2, CircleDashed, Download, Ruler, SlidersHorizontal, Upload, Wallet, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useSession } from '@/app/session'
import { ROLES } from '@/app/permissions'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import BuildingMap from '@/features/inventario/components/BuildingMap'
import HistoryPanel from '@/features/inventario/components/HistoryPanel'
import ImportDialog from '@/features/inventario/components/ImportDialog'
import ParamsPanel from '@/features/inventario/components/ParamsPanel'
import PriceAdjustDialog from '@/features/inventario/components/PriceAdjustDialog'
import UnitDetailSheet from '@/features/inventario/components/UnitDetailSheet'
import UnitsTable, { FILTROS_VACIOS, type Filtros } from '@/features/inventario/components/UnitsTable'
import { descargarLibro } from '@/features/inventario/excel'
import { fmtNum, fmtUsd } from '@/features/inventario/pricing'
import { resumenInventario } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'

export default function InventarioPage() {
  const { state } = useInventory()
  const { actor, can } = useSession()
  const [params, setParams] = useSearchParams()
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [seleccion, setSeleccion] = useState<RowSelectionState>({})
  const [ajuste, setAjuste] = useState<{ open: boolean; codigos: string[] }>({ open: false, codigos: [] })
  const [importar, setImportar] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const abierta = params.get('unidad')
  const abrir = (codigo: string) => setParams((p) => { p.set('unidad', codigo); return p }, { replace: !!abierta })
  const cerrar = () => setParams((p) => { p.delete('unidad'); return p })

  const r = useMemo(() => resumenInventario(state), [state])
  const seleccionados = Object.keys(seleccion)
  const editaPrecios = can('inventario.editar_precios')

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 5000)
    return () => clearTimeout(t)
  }, [aviso])
  useEffect(() => { if (!editaPrecios) setSeleccion({}) }, [editaPrecios])

  return (
    <>
      <PageHeader
        eyebrow="Principal · Inventario"
        title="Inventario inmobiliario"
        subtitle={`${r.unidades} departamentos · Edificio 1 (${r.porEdificio[1]}) y Edificio 2 (${r.porEdificio[2]}) · Lista base 28/10/2026`}
        actions={
          <>
            {can('inventario.exportar') && <Button variant="outline" size="sm" onClick={() => descargarLibro(state)}><Download />Exportar Excel</Button>}
            {can('inventario.importar') && <Button variant="outline" size="sm" onClick={() => setImportar(true)}><Upload />Importar Excel</Button>}
            {editaPrecios && (
              <Button size="sm" onClick={() => setAjuste({ open: true, codigos: seleccionados })}>
                <SlidersHorizontal />{seleccionados.length ? `Ajustar ${seleccionados.length} precios` : 'Ajustar precios'}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" role="note">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex-1 space-y-0.5">
          <p><b>Datos por confirmar.</b> Precios referenciales de la lista base del 28/10/2026, sujetos a aprobación.</p>
          <p>
            {r.porEstado.por_confirmar > 0 && <>{r.porEstado.por_confirmar} unidades sin disponibilidad oficial. </>}
            Planos individuales e imágenes pendientes de carga.
          </p>
        </div>
        {!editaPrecios && <span className="rounded-md bg-white/70 px-2 py-1 text-[11px]">Rol {ROLES[actor.rol].label}: sólo consulta</span>}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Building2} label="Unidades" value={String(r.unidades)} hint={`E1 ${r.porEdificio[1]} · E2 ${r.porEdificio[2]}`} />
        <Kpi icon={Wallet} label="Valor total de lista" value={fmtUsd(r.total)} hint={`Promedio ${fmtUsd(r.promedio)}`} />
        <Kpi icon={Ruler} label="USD/m² promedio" value={fmtNum(r.usdM2Promedio)} hint="Sobre área + bodega, sin patio" />
        <Kpi icon={r.porEstado.por_confirmar ? CircleDashed : CheckCircle2} label="Disponibles confirmadas" value={String(r.porEstado.disponible)}
          hint={r.porEstado.por_confirmar ? `${r.porEstado.por_confirmar} por confirmar` : 'Estados conciliados'} />
      </div>

      {aviso && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="size-4" />{aviso}
          <button type="button" className="ml-auto" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X className="size-3.5" /></button>
        </div>
      )}

      <Tabs defaultValue="tabla" className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="tabla">Unidades</TabsTrigger>
          <TabsTrigger value="mapa">Mapa por edificio</TabsTrigger>
          <TabsTrigger value="historial">Historial{state.priceHistory.length + state.statusHistory.length ? ` (${state.priceHistory.length + state.statusHistory.length})` : ''}</TabsTrigger>
          <TabsTrigger value="parametros">Parámetros</TabsTrigger>
        </TabsList>
        <TabsContent value="tabla" className="min-w-0">
          <UnitsTable units={state.units} params={state.params} filtros={filtros} onFiltros={setFiltros} onOpen={abrir}
            seleccion={seleccion} onSeleccion={setSeleccion} seleccionable={editaPrecios} />
        </TabsContent>
        <TabsContent value="mapa" className="min-w-0"><BuildingMap units={state.units} params={state.params} onOpen={abrir} /></TabsContent>
        <TabsContent value="historial" className="min-w-0"><HistoryPanel /></TabsContent>
        <TabsContent value="parametros" className="min-w-0"><ParamsPanel onMessage={setAviso} /></TabsContent>
      </Tabs>

      <UnitDetailSheet codigo={abierta} onClose={cerrar} onNavigate={abrir} onMessage={setAviso}
        onEditPrice={(c) => setAjuste({ open: true, codigos: [c] })} />
      <PriceAdjustDialog open={ajuste.open} codigos={ajuste.codigos} onOpenChange={(o) => setAjuste((a) => ({ ...a, open: o }))}
        onDone={(m) => { setAviso(m); setSeleccion({}) }} />
      <ImportDialog open={importar} onOpenChange={setImportar} onDone={setAviso} />
    </>
  )
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Building2; label: string; value: string; hint: string }) {
  return (
    <div className="dashboard-card !p-4">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span className="grid size-7 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Icon className="size-3.5" /></span>{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  )
}
