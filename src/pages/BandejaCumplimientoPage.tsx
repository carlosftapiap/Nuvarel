import { useCallback, useState } from 'react'
import { CheckCircle2, CloudOff, Loader2, Lock, ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { almacenContratosSupabase } from '@/features/contratos/almacen'
import { cargarBandeja, type Bandeja, type ContratoBandeja, type DocumentoBandeja, type Grupo } from '@/features/cumplimiento/bandeja'
import DocumentosCliente from '@/features/cumplimiento/components/DocumentosCliente'
import ExpedienteCumplimiento from '@/features/cumplimiento/components/Expediente'
import { ESTADO_DOCUMENTO, ESTADO_REVISION } from '@/features/cumplimiento/expediente'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'
import { numeroComercial } from '@/features/inventario/nomenclatura'

/** Pantalla de inicio del Oficial de Cumplimiento. Decide en el expediente del cliente o del contrato, con las reglas de siempre. */
export default function BandejaCumplimientoPage() {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  if (!remoto || !datos) {
    return <div className="module-empty"><span className="module-empty-icon"><CloudOff className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Requiere la base de datos</h2></div>
  }
  if (!can('cumplimiento.ver')) {
    return <div className="module-empty"><span className="module-empty-icon"><Lock className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-semibold tracking-tight">Sin acceso a Cumplimiento</h2></div>
  }
  return <Panel datos={datos} />
}

type Abierto = { tipo: 'cliente'; id: string; nombre: string } | { tipo: 'contrato'; id: string; codigo: string; cliente: string; borrador: boolean }

const PESTANAS: { id: Grupo; label: string; vacio: string }[] = [
  { id: 'pendiente', label: 'Por revisar', vacio: 'No hay documentos ni contratos esperando revisión.' },
  { id: 'corregir', label: 'Por corregir', vacio: 'No hay documentos ni contratos observados.' },
  { id: 'aprobado', label: 'Aprobados', vacio: 'Todavía no hay documentos ni contratos aprobados.' },
]

function Pastilla({ texto, tono }: { texto: string; tono: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tono)}>{texto}</span>
}
const fecha = (iso: string | null) => (iso ? fmtFechaCorta(iso.slice(0, 10)) : '—')

function Panel({ datos }: { datos: Datos }) {
  const conexion = useConexion()
  const almacen = conexion.almacen ?? almacenContratosSupabase
  const [b, setB] = useState<Bandeja | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<Abierto | null>(null)

  const cargar = useCallback(async () => {
    try { setB(await cargarBandeja(datos)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useRefresco(cargar)

  // El expediente muestra el error en su propio panel; aquí solo el aviso y la recarga de la bandeja.
  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    setAviso(null)
    try { await fn(); setAviso(ok) } finally { await cargar() }
  }, [cargar])
  const noop = useCallback(() => {}, [])

  if (!b) return error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Cargando bandeja…</p>
  const cuenta = (g: Grupo) => b.documentos.filter((d) => d.grupo === g).length + b.contratos.filter((c) => c.grupo === g).length
  const abrirDoc = (d: DocumentoBandeja) => {
    if (d.clientId) setAbierto({ tipo: 'cliente', id: d.clientId, nombre: d.persona })
    else if (d.contratoId) {
      const c = b.contratos.find((x) => x.id === d.contratoId)
      setAbierto({ tipo: 'contrato', id: d.contratoId, codigo: d.contrato ?? 'Contrato', cliente: c?.cliente ?? d.persona, borrador: (c?.estadoContrato ?? 'borrador') === 'borrador' })
    }
  }
  const abrirContrato = (c: ContratoBandeja) => setAbierto({ tipo: 'contrato', id: c.id, codigo: c.codigo, cliente: c.cliente, borrador: c.estadoContrato === 'borrador' })

  return (
    <div className="grid gap-4">
      <PageHeader eyebrow="Cumplimiento" title="Bandeja de Cumplimiento" subtitle="Documentos y contratos que esperan tu revisión, los que volvieron con observaciones y los ya aprobados." />
      {aviso && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}</p>}
      <FieldError>{error}</FieldError>
      <Tabs defaultValue="pendiente" className="min-w-0">
        <TabsList className="mb-3 max-w-full justify-start overflow-x-auto overflow-y-hidden">
          {PESTANAS.map((p) => <TabsTrigger key={p.id} value={p.id}>{p.label} ({cuenta(p.id)})</TabsTrigger>)}
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>
        {PESTANAS.map((p) => {
          const docs = b.documentos.filter((d) => d.grupo === p.id)
          const contratos = b.contratos.filter((c) => c.grupo === p.id)
          return (
            <TabsContent key={p.id} value={p.id} className="grid gap-4">
              {docs.length + contratos.length === 0 && (
                <div className="module-empty"><span className="module-empty-icon"><ShieldCheck className="size-7" aria-hidden="true" /></span><p className="text-sm text-muted-foreground">{p.vacio}</p></div>
              )}
              {contratos.length > 0 && (
                <div className="dashboard-card !p-0 overflow-x-auto">
                  <div className="px-4 pt-3 text-xs font-semibold">Contratos enviados a Cumplimiento</div>
                  <table className="w-full text-xs">
                    <thead className="text-xs text-muted-foreground"><tr>
                      <th className="px-4 py-2 text-left font-medium">Contrato</th><th className="px-2 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Unidad</th>
                      <th className="px-2 py-2 text-left font-medium">Enviado</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2 text-left font-medium">Observaciones</th><th className="px-4 py-2" />
                    </tr></thead>
                    <tbody>
                      {contratos.map((c) => (
                        <tr key={c.id} className="border-t border-border align-top">
                          <td className="px-4 py-2 font-medium">{c.codigo}</td>
                          <td className="px-2 py-2">{c.cliente}</td>
                          <td className="px-2 py-2">{numeroComercial(c.unidad)}</td>
                          <td className="px-2 py-2 tabular-nums">{fecha(c.enviadoEn)}</td>
                          <td className="px-2 py-2"><Pastilla texto={ESTADO_REVISION[c.estado].label} tono={ESTADO_REVISION[c.estado].tono} /></td>
                          <td className="px-2 py-2 text-muted-foreground">{c.observaciones ?? '—'}</td>
                          <td className="px-4 py-2 text-right"><Button size="xs" variant={p.id === 'pendiente' ? 'default' : 'outline'} onClick={() => abrirContrato(c)}>{p.id === 'pendiente' ? 'Revisar contrato' : 'Ver contrato'}</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {docs.length > 0 && (
                <div className="dashboard-card !p-0 overflow-x-auto">
                  <div className="px-4 pt-3 text-xs font-semibold">Documentos del expediente</div>
                  <table className="w-full text-xs">
                    <thead className="text-xs text-muted-foreground"><tr>
                      <th className="px-4 py-2 text-left font-medium">Cliente o comprador</th><th className="px-2 py-2 text-left font-medium">Documento</th><th className="px-2 py-2 text-left font-medium">Contrato</th>
                      <th className="px-2 py-2 text-left font-medium">Cargado</th><th className="px-2 py-2 text-left font-medium">Estado</th><th className="px-2 py-2 text-left font-medium">Observación</th><th className="px-4 py-2" />
                    </tr></thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id} className="border-t border-border align-top">
                          <td className="px-4 py-2 font-medium">{d.persona}</td>
                          <td className="px-2 py-2">{d.nombre}{d.archivoNombre && <div className="text-xs text-muted-foreground">{d.archivoNombre}</div>}</td>
                          <td className="px-2 py-2">{d.contrato ?? '—'}</td>
                          <td className="px-2 py-2 tabular-nums">{fecha(d.cargadoEn)}</td>
                          <td className="px-2 py-2"><Pastilla texto={ESTADO_DOCUMENTO[d.estado].label} tono={ESTADO_DOCUMENTO[d.estado].tono} /></td>
                          <td className="px-2 py-2 text-muted-foreground">{d.observacion ?? '—'}</td>
                          <td className="px-4 py-2 text-right"><Button size="xs" variant={p.id === 'pendiente' ? 'default' : 'outline'} onClick={() => abrirDoc(d)}>{p.id === 'pendiente' ? 'Revisar expediente' : 'Ver expediente'}</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>
          )
        })}
        <TabsContent value="historial">
          {b.historial.length === 0 ? (
            <div className="module-empty"><p className="text-sm text-muted-foreground">Todavía no hay decisiones registradas.</p></div>
          ) : (
            <ol className="dashboard-card grid gap-1.5 text-xs">
              {b.historial.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-1.5 text-muted-foreground">
                  <span className="tabular-nums">{new Date(h.cuando).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</span>
                  <b className="text-foreground">{h.estado}</b><span>· {h.que} · {h.sobre}</span>
                  {h.quien && <span>· {h.quien}</span>}
                  {h.nota && <span>· {h.nota}</span>}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>
      {abierto && (
        <Sheet open onOpenChange={(o) => { if (!o) { setAbierto(null); void cargar() } }}>
          <SheetContent className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
            <SheetHeader className="border-b border-border">
              <SheetTitle>{abierto.tipo === 'cliente' ? `Expediente de ${abierto.nombre}` : `Contrato ${abierto.codigo}`}</SheetTitle>
              <SheetDescription>{abierto.tipo === 'cliente' ? 'Documentos del cliente. Observar o rechazar exige un comentario.' : `${abierto.cliente}. Solo con la aprobación de Cumplimiento el contrato se puede firmar.`}</SheetDescription>
            </SheetHeader>
            <div className="p-5">
              {abierto.tipo === 'cliente'
                ? <DocumentosCliente clientId={abierto.id} nombre={abierto.nombre} onMessage={(m) => { setAviso(m); void cargar() }} />
                : <ExpedienteCumplimiento contrato={abierto.id} borrador={abierto.borrador} datos={datos} almacen={almacen} ejecutar={ejecutar} onEstado={noop} />}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
