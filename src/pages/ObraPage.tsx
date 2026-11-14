import { useCallback, useEffect, useState } from 'react'
import { CloudOff } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { almacenSupabase, type Almacen } from '@/features/obra/almacen'
import Aprobaciones from '@/features/obra/components/Aprobaciones'
import ControlesTecnicos from '@/features/obra/components/ControlesTecnicos'
import Cronograma from '@/features/obra/components/Cronograma'
import Evidencias from '@/features/obra/components/Evidencias'
import Reportes from '@/features/obra/components/Reportes'
import ResumenObra from '@/features/obra/components/ResumenObra'
import Avance from '@/features/obra/components/Avance'
import type { Evidencia, ResumenFrente } from '@/features/obra/model'
import { cargarDocumentos, cargarResumen } from '@/features/obra/remoto'
import { useObra, type ContextoBase } from '@/features/obra/useObra'
import { FieldError } from '@/features/inventario/components/shared'
import { cn } from '@/lib/utils'

const EYEBROW = 'Construcción · Avance de obra'
const SUBTITULO = 'Elige un frente, actualiza una actividad y guarda: el porcentaje cambia de inmediato. Es independiente del Plan de implementación comercial.'

export default function ObraPage({ almacen = almacenSupabase }: { almacen?: Almacen }) {
  const { remoto, datos } = useConexion()
  const { can } = useSession()
  if (!remoto || !datos) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title="Avance de obra" subtitle={SUBTITULO} />
        <div className="module-empty"><CloudOff className="size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Requiere la base de datos</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">El avance de obra se guarda en Supabase. Sin conexión no hay datos que mostrar.</p></div>
      </>
    )
  }
  return can('obra.ver') ? <ObraCompleta datos={datos} almacen={almacen} /> : <ObraResumen datos={datos} almacen={almacen} />
}

/* ------------------------------------------------------- consulta del resumen oficial */

function ObraResumen({ datos, almacen }: { datos: Datos; almacen: Almacen }) {
  const { can } = useSession()
  const [resumen, setResumen] = useState<ResumenFrente[] | null>(null)
  const [documentos, setDocumentos] = useState<Evidencia[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const verDocs = can('obra.documentos')
  const recargar = useCallback(async () => {
    try {
      setResumen(await cargarResumen(datos))
      if (verDocs) setDocumentos(await cargarDocumentos(datos))
      setError(null)
    } catch (e) { setError((e as Error).message) }
  }, [datos, verDocs])
  useRefresco(recargar)
  return (
    <>
      <PageHeader eyebrow={EYEBROW} title="Avance de obra" subtitle="Avance actual de la construcción." />
      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}
      {resumen === null ? (!error && <p className="p-6 text-sm text-muted-foreground">Cargando avance de obra…</p>) : <ResumenObra resumen={resumen} documentos={verDocs ? documentos ?? [] : null} almacen={almacen} />}
    </>
  )
}

/* ----------------------------------------------------------- detalle técnico completo */

function ObraCompleta({ datos, almacen }: { datos: Datos; almacen: Almacen }) {
  const { can, actor, usuarioId } = useSession()
  const { obra, error, recargar } = useObra(datos)
  const [frenteId, setFrenteId] = useState<string | null>(null)
  const [pestana, setPestana] = useState('tablero')
  useEffect(() => { if (obra && (!frenteId || !obra.frentes.some((f) => f.id === frenteId))) setFrenteId(obra.frentes[0]?.id ?? null) }, [obra, frenteId])

  if (!obra) {
    return (
      <>
        <PageHeader eyebrow={EYEBROW} title="Avance de obra" subtitle={SUBTITULO} />
        {error ? <FieldError>{error}</FieldError> : <p className="p-6 text-sm text-muted-foreground">Cargando avance de obra…</p>}
      </>
    )
  }
  const frente = obra.frentes.find((f) => f.id === frenteId) ?? obra.frentes[0]
  const ctx: ContextoBase = { datos, obra, recargar, usuarioId, usuario: actor.nombre, can, almacen }
  const porFrente = ['avanzadas', 'evidencias'].includes(pestana)
  const avanzadas = can('obra.editar') || can('obra.validar')
  const hojas = frente ? obra.actividades.filter((a) => a.frenteId === frente.id && a.estado !== 'cancelada' && !obra.actividades.some((h) => h.parentId === a.id && h.estado !== 'cancelada')) : []

  return (
    <>
      <PageHeader eyebrow={EYEBROW} title="Avance de obra" subtitle={SUBTITULO} />
      {error && <div className="mb-3"><FieldError>{error}</FieldError></div>}
      <Tabs value={pestana} onValueChange={setPestana} className="min-w-0">
        <TabsList className="mb-3 flex-wrap">
          <TabsTrigger value="tablero">Avance</TabsTrigger>
          <TabsTrigger value="evidencias">Evidencias</TabsTrigger>
          <TabsTrigger value="reportes">Reportes</TabsTrigger>
          {avanzadas && <TabsTrigger value="avanzadas">Opciones avanzadas</TabsTrigger>}
        </TabsList>

        {porFrente && frente && (
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Frente de obra">
            {obra.frentes.map((f) => (
              <button key={f.id} type="button" aria-pressed={f.id === frente.id} onClick={() => setFrenteId(f.id)}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', f.id === frente.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white hover:bg-muted')}>{f.nombre}</button>
            ))}
          </div>
        )}

        <TabsContent value="tablero"><Avance ctx={ctx} /></TabsContent>
        {frente && <TabsContent value="evidencias"><Evidencias ctx={{ ...ctx, frente }} /></TabsContent>}
        {frente && avanzadas && (
          <TabsContent value="avanzadas" className="grid gap-4">
            <p className="text-xs text-muted-foreground">Pesos, dependencias, jerarquías, cronograma y controles técnicos. No hacen falta para registrar el avance.</p>
            <Aprobaciones ctx={ctx} frente={frente} />
            {can('obra.editar') && <Cronograma key={frente.id} ctx={{ ...ctx, frente }} />}
            <ControlesTecnicos key={`c-${frente.id}`} ctx={{ ...ctx, frente }} actividades={hojas.map((a) => ({ id: a.id, etiqueta: `${a.codigo} · ${a.nombre}` }))} puedeRegistrar={can('obra.avance')}
              controles={obra.controles.filter((c) => c.frenteId === frente.id).map((c) => ({ ...c, actividad: c.actividadId ? obra.actividades.find((a) => a.id === c.actividadId)?.codigo ?? '' : '' }))}
              alRegistrar={recargar} datos={datos} />
          </TabsContent>
        )}
        <TabsContent value="reportes"><Reportes ctx={ctx} /></TabsContent>
      </Tabs>
    </>
  )
}
