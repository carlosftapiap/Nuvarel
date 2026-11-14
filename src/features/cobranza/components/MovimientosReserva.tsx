import { useState } from 'react'
import { Paperclip } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto, round2 } from '@/features/inventario/pricing'
import type { Reserva } from '@/features/reservas/model'
import { archivoMovimiento, errorArchivo, registrarMovimiento, resolverMovimiento, type Movimiento } from '../comprobantes'

const TIPO: Record<Movimiento['tipo'], string> = { devolucion: 'Devolución', retencion: 'Retención' }

/** El pago confirmado no se toca: lo devuelto o retenido son movimientos aparte, con soporte y autorización de otra persona. */
export default function MovimientosReserva({ reserva, movimientos, datos, almacen, ejecutar, onClose }: {
  reserva: Reserva
  movimientos: Movimiento[]
  datos: Datos
  almacen: AlmacenContratos | null
  ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>
  onClose: () => void
}) {
  const { can, actor } = useSession()
  const [tipo, setTipo] = useState<Movimiento['tipo']>('devolucion')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyGuayaquil())
  const [referencia, setReferencia] = useState('')
  const [motivo, setMotivo] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [resolver, setResolver] = useState<{ id: string; autorizar: boolean } | null>(null)
  const [motivoResolver, setMotivoResolver] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recibido = reserva.montoRecibido ?? 0
  const usado = round2(movimientos.filter((m) => m.estado !== 'rechazado').reduce((t, m) => t + m.monto, 0))
  const montoNum = leerMonto(monto) ?? 0
  const listo = montoNum > 0 && montoNum <= round2(recibido - usado) && referencia.trim().length >= 3 && motivo.trim().length >= 5 && !!archivo && !errorArchivo(archivo)

  const enviar = async (fn: () => Promise<unknown>, ok: string) => { setEnviando(true); await ejecutar(fn, ok); onClose() }
  const ver = async (m: Movimiento) => {
    setError(null)
    try { window.open(URL.createObjectURL(await archivoMovimiento(almacen, m)), '_blank', 'noopener') } catch (e) { setError((e as Error).message) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Devolución o retención de {reserva.codigo}</DialogTitle>
          <DialogDescription>{reserva.clienteNombre}. Recibido {fmtUsd2(recibido)}; sin definir {fmtUsd2(round2(recibido - usado))}. El pago confirmado se conserva en el historial.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-xs">
          {movimientos.map((m) => (
            <section key={m.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{TIPO[m.tipo]} · {fmtUsd2(m.monto)}</b><span className="capitalize text-muted-foreground">{m.estado}</span></div>
              <p className="mt-1 text-muted-foreground">{fmtFechaCorta(m.fecha)} · ref. {m.referencia} · {m.motivo}</p>
              {m.motivoResolucion && <p className="mt-1">Resolución: {m.motivoResolucion}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={() => void ver(m)}><Paperclip />Ver soporte</Button>
                {m.estado === 'solicitado' && can('ventas.desistimiento_con_dinero') && m.registradoPor !== actor.id && <>
                  <Button size="xs" onClick={() => { setResolver({ id: m.id, autorizar: true }); setMotivoResolver('') }}>Autorizar</Button>
                  <Button size="xs" variant="outline" onClick={() => { setResolver({ id: m.id, autorizar: false }); setMotivoResolver('') }}>Rechazar</Button>
                </>}
              </div>
              {resolver?.id === m.id && (
                <div className="mt-2 grid gap-1.5">
                  <Label htmlFor="mv-resolver" className="text-xs">Motivo *</Label>
                  <Textarea id="mv-resolver" rows={2} value={motivoResolver} onChange={(e) => setMotivoResolver(e.target.value)} />
                  <Button size="xs" className="justify-self-end" disabled={enviando || motivoResolver.trim().length < 5} onClick={() => void enviar(() => resolverMovimiento(datos, m.id, resolver.autorizar, motivoResolver.trim()), resolver.autorizar ? 'Movimiento autorizado' : 'Movimiento rechazado')}>{resolver.autorizar ? 'Confirmar autorización' : 'Confirmar rechazo'}</Button>
                </div>
              )}
            </section>
          ))}
          <FieldError>{error}</FieldError>
          {can('cobranzas.registrar') && round2(recibido - usado) > 0 && (
            <section className="grid gap-2 rounded-lg border border-dashed border-border p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-1"><Label htmlFor="mv-tipo" className="text-xs">Tipo *</Label>
                  <select id="mv-tipo" className="h-8 rounded-md border border-border bg-white px-2" value={tipo} onChange={(e) => setTipo(e.target.value as Movimiento['tipo'])}><option value="devolucion">Devolución</option><option value="retencion">Retención</option></select>
                </div>
                <div className="grid gap-1"><Label htmlFor="mv-monto" className="text-xs">Monto (USD) *</Label><Input id="mv-monto" className="h-8" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
                <div className="grid gap-1"><Label htmlFor="mv-fecha" className="text-xs">Fecha *</Label><Input id="mv-fecha" className="h-8" type="date" max={hoyGuayaquil()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
              </div>
              <div className="grid gap-1"><Label htmlFor="mv-ref" className="text-xs">Referencia *</Label><Input id="mv-ref" className="h-8" value={referencia} onChange={(e) => setReferencia(e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="mv-motivo" className="text-xs">Motivo *</Label><Textarea id="mv-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
              <div className="grid gap-1"><Label htmlFor="mv-archivo" className="text-xs">Soporte: foto o PDF *</Label><Input id="mv-archivo" className="h-8" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></div>
              <FieldError>{errorArchivo(archivo)}</FieldError>
              <Button size="sm" className="justify-self-end" disabled={!listo || enviando} onClick={() => void enviar(() => registrarMovimiento(datos, almacen, reserva.id, { tipo, monto: montoNum, fecha, referencia: referencia.trim(), motivo: motivo.trim(), archivo: archivo! }), 'Movimiento registrado: queda por autorizar')}>Registrar movimiento</Button>
            </section>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cerrar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
