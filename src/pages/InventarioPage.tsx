import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { RowSelectionState } from '@tanstack/react-table'
import { CheckCircle2, Download, FileWarning, Tags, Upload, SlidersHorizontal, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import InventarioTecnico from '@/features/inventario/components/InventarioTecnico'
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
import { ESTADOS_EFECTIVOS, type EstadoEfectivo } from '@/features/inventario/estados'
import { fmtNum, fmtUsd } from '@/features/inventario/pricing'
import { estadoPrecio, resumenInventario, unidadesTxt } from '@/features/inventario/service'
import { useInventory } from '@/features/inventario/store'
import { cn } from '@/lib/utils'

export default function InventarioPage() {
  const { can } = useSession()
  const { datos } = useConexion()
  if (!can('inventario.ver') && can('inventario.tecnico') && datos) return <InventarioTecnico datos={datos} />
  return <InventarioComercial />
}

function InventarioComercial() {
  const { state } = useInventory()
  const { actor, can } = useSession()
  const [params, setParams] = useSearchParams()
  // El Dashboard enlaza con ?estado= y ?edificio=: solo se aceptan valores conocidos.
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const estado = params.get('estado')
    const edificio = params.get('edificio')
    return { ...FILTROS_VACIOS, estado: estado && estado in ESTADOS_EFECTIVOS ? (estado as EstadoEfectivo) : 'todos', edificio: edificio === '1' || edificio === '2' ? edificio : 'todos' }
  })
  const [pestana, setPestana] = useState('tabla')
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

  // Los tres pendientes son problemas distintos: se cuentan y se explican por separado.
  const referenciales = useMemo(() => state.units.filter((u) => estadoPrecio(state.priceHistory, u.codigo).tipo === 'referencial').length, [state])
  const propuestas = state.propuestas.filter((p) => p.estado === 'pendiente').length
  const sinPlano = state.units.filter((u) => !u.planoPath).length
  const sinImagenes = state.units.filter((u) => u.imagenes.length === 0).length
  const enRevision = state.units.reduce((t, u) => t + (u.planoPath ? 1 : 0) + (u.imagenes.length ? 1 : 0), 0)

  const filtrarEstado = (estado: 'todos' | EstadoEfectivo) => { setFiltros((f) => ({ ...f, estado })); setPestana('tabla') }

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
                <SlidersHorizontal />{seleccionados.length ? `Ajustar ${unidadesTxt(seleccionados.length)}` : 'Ajustar precios'}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900" role="note" aria-label="Pendientes del inventario">
        {(referenciales > 0 || propuestas > 0) && (
          <p className="flex gap-2"><Tags className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span><b>Precios pendientes de aprobación:</b> {referenciales > 0 && <>{unidadesTxt(referenciales)} con precio referencial. </>}{propuestas > 0 && <>{propuestas === 1 ? '1 propuesta' : `${propuestas} propuestas`} por resolver en Precios.</>}</span></p>
        )}
        {(sinPlano > 0 || sinImagenes > 0 || enRevision > 0) && (
          <p className="flex gap-2"><FileWarning className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span><b>Documentación incompleta:</b> {sinPlano} planos e {sinImagenes} grupos de imágenes pendientes de cargar{enRevision > 0 ? `; ${enRevision} en revisión` : ''}. Ninguno figura como validado hasta completar su revisión.</span></p>
        )}
        {!editaPrecios && <p className="text-[11px]">Rol {ROLES[actor.rol]?.label ?? actor.rol}: solo consulta.</p>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Unidades por estado">
        <Indicador t="Total" v={r.unidades} activo={filtros.estado === 'todos'} onClick={() => filtrarEstado('todos')} />
        <Indicador t="Disponibles" v={r.porEstado.disponible} activo={filtros.estado === 'disponible'} onClick={() => filtrarEstado('disponible')} tono="text-emerald-700" />
        {r.porEstado.en_proceso_reserva > 0 && <Indicador t="En proceso de reserva" v={r.porEstado.en_proceso_reserva} activo={filtros.estado === 'en_proceso_reserva'} onClick={() => filtrarEstado('en_proceso_reserva')} tono="text-yellow-700" />}
        <Indicador t="Reservadas" v={r.porEstado.reservado} activo={filtros.estado === 'reservado'} onClick={() => filtrarEstado('reservado')} tono="text-violet-700" />
        <Indicador t="Vendidas" v={r.porEstado.vendido} activo={filtros.estado === 'vendido'} onClick={() => filtrarEstado('vendido')} tono="text-blue-800" />
        <Indicador t="Bloqueadas" v={r.porEstado.bloqueado} activo={filtros.estado === 'bloqueado'} onClick={() => filtrarEstado('bloqueado')} tono="text-slate-700" />
        {r.porEstado.promesa > 0 && <Indicador t="Prometidas" v={r.porEstado.promesa} activo={filtros.estado === 'promesa'} onClick={() => filtrarEstado('promesa')} tono="text-sky-700" />}
        {r.porEstado.no_disponible > 0 && <Indicador t="No disponibles" v={r.porEstado.no_disponible} activo={filtros.estado === 'no_disponible'} onClick={() => filtrarEstado('no_disponible')} tono="text-rose-700" />}
      </div>
      <p className="mb-4 flex flex-wrap gap-x-5 gap-y-1 px-1 text-xs text-muted-foreground">
        <span>Valor total de lista: <b className="tabular-nums text-foreground">{fmtUsd(r.total)}</b> · promedio {fmtUsd(r.promedio)} por unidad</span>
        <span>USD/m² promedio: <b className="tabular-nums text-foreground">{fmtNum(r.usdM2Promedio)}</b> · ponderado por m²: precio de área + bodega ÷ m², sin patio. Es la tarifa, no el precio efectivo de cada unidad.</span>
      </p>

      {aviso && !abierta && (
        <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="size-4" />{aviso}
          <button type="button" className="ml-auto" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X className="size-3.5" /></button>
        </div>
      )}

      <Tabs value={pestana} onValueChange={setPestana} className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="tabla">Unidades</TabsTrigger>
          <TabsTrigger value="mapa">Mapa por edificio</TabsTrigger>
          <TabsTrigger value="historial">Historial{state.priceHistory.length + state.statusHistory.length ? ` (${state.priceHistory.length + state.statusHistory.length})` : ''}</TabsTrigger>
          <TabsTrigger value="parametros">Parámetros</TabsTrigger>
        </TabsList>
        <TabsContent value="tabla" className="min-w-0">
          <UnitsTable units={state.units} params={state.params} historial={state.priceHistory} filtros={filtros} onFiltros={setFiltros} onOpen={abrir}
            seleccion={seleccion} onSeleccion={setSeleccion} seleccionable={editaPrecios} />
        </TabsContent>
        <TabsContent value="mapa" className="min-w-0"><BuildingMap units={state.units} params={state.params} onOpen={abrir} /></TabsContent>
        <TabsContent value="historial" className="min-w-0"><HistoryPanel /></TabsContent>
        <TabsContent value="parametros" className="min-w-0"><ParamsPanel onMessage={setAviso} /></TabsContent>
      </Tabs>

      <UnitDetailSheet codigo={abierta} onClose={cerrar} onNavigate={abrir} onMessage={setAviso} mensaje={aviso} />
      <PriceAdjustDialog open={ajuste.open} codigos={ajuste.codigos} onOpenChange={(o) => setAjuste((a) => ({ ...a, open: o }))}
        onDone={(m) => { setAviso(m); setSeleccion({}) }} />
      <ImportDialog open={importar} onOpenChange={setImportar} onDone={setAviso} />
    </>
  )
}

function Indicador({ t, v, activo, onClick, tono }: { t: string; v: number; activo: boolean; onClick: () => void; tono?: string }) {
  return (
    <button type="button" aria-pressed={activo} onClick={onClick} className={cn('dashboard-card !p-3 text-left transition hover:-translate-y-px', activo && 'ring-2 ring-primary')}>
      <div className="text-[11px] text-muted-foreground">{t}</div>
      <div className={cn('mt-0.5 text-xl font-semibold tabular-nums', tono)}>{v}</div>
    </button>
  )
}
