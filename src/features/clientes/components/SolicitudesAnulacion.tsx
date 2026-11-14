import { useState } from 'react'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { autorizar, faltaPara, MOTIVOS_DESISTIMIENTO, rechazar, revisarFinanzas, type Desistimiento } from '../desistimiento'
import { useClientes } from '../store'
import ReglasAnulacion from './ReglasAnulacion'

type Accion = 'autorizar' | 'finanzas' | 'rechazar'
const TEXTO: Record<Accion, { titulo: string; boton: string; campo: string; ayuda: string }> = {
  autorizar: { titulo: 'Autorizar la anulación', boton: 'Autorizar', campo: 'Motivo de la autorización *', ayuda: 'Si no falta otra aprobación, la reserva se anula y el departamento se libera en este momento, si no tiene otros compromisos.' },
  finanzas: { titulo: 'Revisión de Finanzas', boton: 'Registrar revisión', campo: 'Cómo se resuelve el dinero *', ayuda: 'Deja constancia de la devolución o retención según la política comercial. No registra pagos ni devoluciones en el sistema.' },
  rechazar: { titulo: 'Rechazar la solicitud', boton: 'Rechazar', campo: 'Motivo del rechazo *', ayuda: 'La reserva y el departamento siguen como están, y la operación continúa.' },
}

/** Solicitudes pendientes, con qué falta y qué puede hacer cada persona. El servidor vuelve a comprobarlo todo. */
export default function SolicitudesAnulacion({ onDone }: { onDone: (m: string) => void | Promise<void> }) {
  const { desistimientos, datos, state, recargar } = useClientes()
  const { recargar: recargarInventario } = useInventory()
  const { actor, can } = useSession()
  const [pedido, setPedido] = useState<{ d: Desistimiento; accion: Accion } | null>(null)
  const pendientes = desistimientos.filter((d) => d.estado === 'pendiente')
  if (!datos || pendientes.length === 0) return null
  const nombre = (id: string) => state.clientes.find((c) => c.id === id)?.nombre ?? 'Cliente'

  // Como en la base: sin alcance de empresa, nadie decide la anulación de su propio cliente (la decide Gerencia).
  const clientePropio = (d: Desistimiento) => actor.alcance?.tipo !== 'empresa' && state.clientes.find((c) => c.id === d.clienteId)?.asesorId === actor.id
  const puedeDecidir = (d: Desistimiento) => d.registradoPorId !== actor.id && !clientePropio(d) && can(d.nivel === 'gerencia_y_finanzas' ? 'ventas.desistimiento_con_dinero' : 'ventas.desistimiento_autorizar')
  const puedeAutorizar = (d: Desistimiento) => puedeDecidir(d) && !d.autorizadoPorId && d.revisadoPorId !== actor.id
  const puedeRevisar = (d: Desistimiento) => d.nivel === 'gerencia_y_finanzas' && !d.revisadoPorId && d.registradoPorId !== actor.id && d.autorizadoPorId !== actor.id && can('cobranzas.verificar')

  const confirmar = async (nota: string) => {
    const { d, accion } = pedido!
    const resultado = accion === 'autorizar' ? await autorizar(datos, d.id, nota) : accion === 'finanzas' ? await revisarFinanzas(datos, d.id, nota) : (await rechazar(datos, d.id, nota), 'rechazado')
    await Promise.all([recargar(), recargarInventario()])
    await onDone(resultado === 'rechazado' ? 'Solicitud rechazada: la reserva y el departamento siguen igual' : resultado === 'aplicado' ? 'Anulación aplicada' : 'Registrado: falta la otra aprobación')
  }

  return (
    <section aria-labelledby="sa-tit" className="dashboard-card mb-4 p-5">
      <h2 id="sa-tit" className="text-sm font-semibold">Solicitudes de anulación pendientes</h2>
      <ul className="mt-2 grid gap-2">
        {pendientes.map((d) => (
          <li key={d.id} className="grid gap-1.5 rounded-lg border border-border px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <b>{nombre(d.clienteId)}</b>
              <span className="text-muted-foreground">{d.codigoUnidad} · {MOTIVOS_DESISTIMIENTO[d.motivo]}</span>
              {d.montoRecibido ? <span className="font-medium tabular-nums">{fmtUsd2(d.montoRecibido)} recibidos</span> : d.nivel === 'gerencia_y_finanzas' && <span className="text-muted-foreground">Comprobante sin verificar</span>}
            </div>
            <div className="text-xs text-muted-foreground">Solicitó {d.registradoPor}{d.observaciones ? ` · ${d.observaciones}` : ''}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <Paso listo={!!d.autorizadoPorId} texto={d.autorizadoPorId ? `Autorizó ${d.autorizadoPor}` : d.nivel === 'gerencia_y_finanzas' ? 'Gerencia: pendiente' : 'Supervisor o Gerencia: pendiente'} />
              {d.nivel === 'gerencia_y_finanzas' && <Paso listo={!!d.revisadoPorId} texto={d.revisadoPorId ? `Revisó ${d.revisadoPor}` : 'Finanzas: pendiente'} />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {puedeAutorizar(d) && <Button size="xs" onClick={() => setPedido({ d, accion: 'autorizar' })}>Autorizar</Button>}
              {puedeRevisar(d) && <Button size="xs" onClick={() => setPedido({ d, accion: 'finanzas' })}>Registrar revisión</Button>}
              {puedeDecidir(d) && <Button size="xs" variant="outline" onClick={() => setPedido({ d, accion: 'rechazar' })}>Rechazar</Button>}
              {!puedeAutorizar(d) && !puedeRevisar(d) && !puedeDecidir(d) && (
                <span className="text-xs text-muted-foreground">{d.registradoPorId === actor.id ? 'Es tu solicitud: otra persona debe decidirla. ' : clientePropio(d) ? 'Es tu cliente: la decide Gerencia. ' : ''}{faltaPara(d)}.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {pedido && <NotaDialog d={pedido.d} accion={pedido.accion} nombre={nombre(pedido.d.clienteId)} onClose={() => setPedido(null)} onConfirm={confirmar} />}
    </section>
  )
}

function Paso({ listo, texto }: { listo: boolean; texto: string }) {
  const Icono = listo ? CheckCircle2 : CircleDashed
  return <span className={`inline-flex items-center gap-1 ${listo ? 'text-emerald-700' : 'text-amber-800'}`}><Icono className="size-3" aria-hidden="true" />{texto}</span>
}

function NotaDialog({ d, accion, nombre, onClose, onConfirm }: { d: Desistimiento; accion: Accion; nombre: string; onClose: () => void; onConfirm: (nota: string) => Promise<void> }) {
  const [nota, setNota] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const t = TEXTO[accion]
  const enviar = async () => {
    setError(null); setEnviando(true)
    try { await onConfirm(nota.trim()); onClose() } catch (e) { setError((e as Error).message) } finally { setEnviando(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
          <DialogDescription>{nombre} · {d.codigoUnidad}. {t.ayuda}</DialogDescription>
        </DialogHeader>
        <ReglasAnulacion actual={d.nivel} />
        <div className="grid gap-1.5">
          <Label htmlFor="sa-nota" className="text-xs">{t.campo}</Label>
          <Textarea id="sa-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant={accion === 'rechazar' ? 'destructive' : 'default'} disabled={nota.trim().length < 5 || enviando} onClick={() => void enviar()}>{enviando ? 'Guardando…' : t.boton}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
