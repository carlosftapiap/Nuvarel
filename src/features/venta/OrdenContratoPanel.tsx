import { useEffect, useState, type ReactNode } from 'react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import type { Cotizacion } from '@/features/cotizaciones/cotizacion'
import type { TipoPersona } from '@/features/cumplimiento/expediente'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { abrirPdf } from './abrirPdf'
import DatosClienteOrdenDialog from './DatosClienteOrdenDialog'
import { cargarCamposCliente, construirVistaPrevia, emitirOrden, listarOrdenes, type CamposClienteOrden } from './ordenContratoRemoto'

/**
 * Orden de contrato de esta cotización.
 * «Vista previa» no deja registro. «Emitir orden» pide confirmación y registra una versión nueva en el historial antes de mostrar el PDF.
 */
export default function OrdenContratoPanel({ cotizacion, datos, tipo, onError }: { cotizacion: Cotizacion; datos: Datos | null; tipo: TipoPersona; onError: (m: string) => void }) {
  const { actor } = useSession()
  const [campos, setCampos] = useState<CamposClienteOrden | undefined>(undefined)
  const [historial, setHistorial] = useState<Awaited<ReturnType<typeof listarOrdenes>> | null>(null)
  const [historialError, setHistorialError] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = () => {
    if (!datos) return
    cargarCamposCliente(datos, cotizacion.clienteId).then(setCampos).catch((e: Error) => onError(e.message))
    listarOrdenes(datos, cotizacion.id)
      .then((r) => { setHistorial(r); setHistorialError(null) })
      .catch(() => { setHistorial(null); setHistorialError('El historial todavía no está disponible. Falta aplicar la migración 0020.') })
  }
  useEffect(() => { cargar() }, [datos, cotizacion.id, cotizacion.clienteId]) // eslint-disable-line react-hooks/exhaustive-deps

  const juridica = tipo === 'juridica'
  const repFaltante = juridica && (!campos?.representante_nombre?.trim() || !campos?.representante_documento?.trim())
  const pendientes = [
    !campos?.domicilio && 'dirección',
    !juridica && !campos?.estado_civil && 'estado civil',
    !campos?.origen && 'medio de captación',
  ].filter(Boolean) as string[]
  const versionSiguiente = historial ? (historial[0]?.version ?? 0) + 1 : null
  const titulo = `Orden de contrato · ${cotizacion.numero}`

  const ejecutar = async (clave: string, fn: () => Promise<void>) => {
    setTrabajando(clave); setAviso(null)
    try { await fn() } catch (e) { onError((e as Error).message) }
    setTrabajando(null)
  }
  const boton = 'h-10 w-full sm:w-auto'

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">La vista previa no deja registro. Al emitir se guarda una versión en el historial, con fecha, usuario y huella del PDF.</p>

      {repFaltante && <Aviso tono="alerta">Falta el representante legal de la persona jurídica. No se puede emitir la orden hasta completarlo.</Aviso>}
      {!repFaltante && pendientes.length > 0 && <Aviso>Datos pendientes del cliente: {pendientes.join(', ')}. Aparecerán como «No registrado».</Aviso>}

      {!confirmando ? (
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button className={boton} disabled={!datos || !!trabajando || repFaltante} onClick={() => setConfirmando(true)}>Emitir orden</Button>
          <Button className={boton} variant="outline" disabled={!datos || !!trabajando}
            onClick={() => void ejecutar('vista', () => abrirPdf(titulo, () => construirVistaPrevia(datos!, cotizacion, tipo)))}>
            Vista previa
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-900">
            {versionSiguiente ? `Emitir como versión ${versionSiguiente}` : 'Emitir la orden'}
          </p>
          <p className="text-xs text-muted-foreground">Se guardará en el historial con los datos actuales. Una versión emitida no se puede borrar ni editar.</p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button className={boton} disabled={!!trabajando}
              onClick={() => void ejecutar('emitir', () => {
                setConfirmando(false)
                return abrirPdf(titulo, async () => {
                  const r = await emitirOrden(datos!, cotizacion, tipo, actor.nombre)
                  setAviso(`Orden emitida como versión ${r.version}.`)
                  cargar()
                  return r.bytes
                })
              })}>
              Confirmar emisión
            </Button>
            <Button className={boton} variant="outline" disabled={!!trabajando} onClick={() => setConfirmando(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {!datos && <p className="text-xs text-muted-foreground">Disponible cuando la cotización está conectada al sistema.</p>}
      {aviso && <p role="status" className="text-xs font-medium text-slate-800">{aviso}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <button type="button" className="font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
          disabled={!datos || !cotizacion.clienteId} onClick={() => setDialogo(true)}>
          Completar datos del cliente
        </button>
      </div>

      <div className="grid gap-1.5 text-xs">
        <p className="font-semibold text-slate-700">Historial de versiones</p>
        {historialError && <p className="text-muted-foreground">{historialError}</p>}
        {!historialError && historial && historial.length === 0 && <p className="text-muted-foreground">Aún no se ha emitido ninguna orden.</p>}
        {historial?.map((o) => (
          <p key={o.id} className="text-slate-800">
            Versión {o.version} · {fmtFechaCorta(o.emitida_en.slice(0, 10))} {o.emitida_en.slice(11, 16)} · {o.emitida_por_nombre ?? 'Usuario no identificado'} · huella {o.pdf_sha256.slice(0, 12)}
          </p>
        ))}
      </div>

      {datos && cotizacion.clienteId && (
        <DatosClienteOrdenDialog open={dialogo} onOpenChange={setDialogo} datos={datos} clienteId={cotizacion.clienteId} tipo={tipo} onGuardado={cargar} />
      )}
    </div>
  )
}

function Aviso({ tono = 'neutro', children }: { tono?: 'alerta' | 'neutro'; children: ReactNode }) {
  return (
    <div role="status" className={tono === 'alerta' ? 'rounded-lg bg-amber-50 p-3 text-xs text-amber-900' : 'rounded-lg bg-slate-50 p-3 text-xs text-slate-700'}>
      {children}
    </div>
  )
}
