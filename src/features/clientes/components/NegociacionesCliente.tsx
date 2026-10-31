import { useState } from 'react'
import { Handshake } from 'lucide-react'
import { puedeVerDe } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { ETAPAS_OPORTUNIDAD, OPORTUNIDAD_ABIERTA, type Cliente, type Oportunidad } from '../model'
import { ESTADO_DESISTIMIENTO, faltaPara, MOTIVOS_DESISTIMIENTO } from '../desistimiento'
import DesistimientoDialog from './DesistimientoDialog'
import { abrirOportunidad, cerrarOportunidad, revocarAcceso, transferirOportunidad, vincularUnidad } from '../remoto'
import { useClientes } from '../store'

type Pedido = { tipo: 'transferir' | 'cerrar'; o: Oportunidad } | { tipo: 'revocar'; usuarioId: string; nombre: string }

/** Negociaciones concretas del cliente: una por unidad o tipología. El servidor impide duplicarlas. */
export default function NegociacionesCliente({ c, onMessage }: { c: Cliente; onMessage: (m: string) => void }) {
  const { datos, oportunidades, asignables, recargar, desistimientos, hayDesistimientos } = useClientes()
  const { state: inv } = useInventory()
  const { actor, can } = useSession()
  const [destino, setDestino] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [desiste, setDesiste] = useState(false)
  if (!datos) return null
  const historial = desistimientos.filter((x) => x.clienteId === c.id)
  const puedeDesistir = hayDesistimientos && can('ventas.desistimiento') && (c.etapa !== 'perdido' || propiasAbiertas(oportunidades, c.id))

  const propias = oportunidades.filter((o) => o.clienteId === c.id)
  const nombre = (id: string) => (id === c.asesorId ? c.asesor : asignables.find((p) => p.id === id)?.nombre ?? 'Otro usuario')
  const dptDe = (codigo: string) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? codigo
  const abiertas = propias.filter((o) => o.etapa !== 'perdida')
  const unidadesLibres = c.unidadesInteres.filter((u) => !abiertas.some((o) => o.codigoUnidad === u))
  const tipologias = [...new Set(inv.units.map((u) => u.tipologia))].filter((t) => !abiertas.some((o) => !o.codigoUnidad && o.tipologia === t))
  const puedeAbrir = can('clientes.editar') && c.etapa !== 'perdido'

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null)
    try {
      await fn()
      await recargar()
      onMessage(ok)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  const abrir = () => {
    const [tipo, valor] = destino.split(':')
    void ejecutar(() => abrirOportunidad(datos, c.id, tipo === 'u' ? { unidad: valor } : { tipologia: valor }), 'Negociación abierta').then((ok) => { if (ok) setDestino('') })
  }

  return (
    <section aria-labelledby="cs-neg" className="grid gap-2 rounded-xl border border-border p-4">
      <h3 id="cs-neg" className="flex items-center gap-1.5 text-sm font-semibold"><Handshake className="size-4" />Negociaciones</h3>
      <FieldError>{error}</FieldError>
      {propias.length === 0 && <p className="text-xs text-muted-foreground">Ábrela cuando el cliente muestre interés concreto en un departamento o tipología.</p>}
      {propias.length > 0 && (
        <ul className="grid gap-1.5">
          {propias.map((o) => {
            const abierta = OPORTUNIDAD_ABIERTA.includes(o.etapa)
            const opciones = o.codigoUnidad ? [] : inv.units.filter((u) => u.tipologia === o.tipologia && u.estado === 'disponible')
            return (
              <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <b>{o.codigoUnidad ? dptDe(o.codigoUnidad) : o.tipologia}</b>
                <span className="text-muted-foreground">{ETAPAS_OPORTUNIDAD[o.etapa]}</span>
                <span className="text-muted-foreground">· {nombre(o.responsableId)}</span>
                <span className="ml-auto flex items-center gap-1">
                  {o.etapa !== 'perdida' && can('clientes.asignar') && <Button size="xs" variant="ghost" onClick={() => setPedido({ tipo: 'transferir', o })}>Transferir</Button>}
                  {abierta && can('clientes.editar') && <Button size="xs" variant="ghost" onClick={() => setPedido({ tipo: 'cerrar', o })}>Cerrar</Button>}
                </span>
                {abierta && !o.codigoUnidad && can('clientes.editar') && opciones.length > 0 && (
                  <Select onValueChange={(u) => void ejecutar(() => vincularUnidad(datos, o.id, u), 'Unidad vinculada')}>
                    <SelectTrigger aria-label={`Elegir unidad de ${o.tipologia}`} className="h-7 basis-full text-xs"><SelectValue placeholder="Elegir unidad" /></SelectTrigger>
                    <SelectContent>{opciones.map((u) => <SelectItem key={u.codigo} value={u.codigo}>{u.dpt}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                {o.etapa === 'perdida' && o.motivoPerdida && <span className="basis-full text-[11px] text-muted-foreground">{o.motivoPerdida}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {puedeAbrir && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger aria-label="Unidad o tipología de la negociación" className="h-8 min-w-48 text-xs"><SelectValue placeholder="Unidad o tipología" /></SelectTrigger>
            <SelectContent>
              {unidadesLibres.map((u) => <SelectItem key={u} value={`u:${u}`}>{dptDe(u)}</SelectItem>)}
              {tipologias.map((t) => <SelectItem key={t} value={`t:${t}`}>Tipología {t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={!destino} onClick={abrir}>Abrir negociación</Button>
        </div>
      )}
      {puedeDesistir && <Button size="sm" variant="outline" className="justify-self-start text-rose-700" onClick={() => setDesiste(true)}>Registrar desistimiento</Button>}
      {historial.length > 0 && (
        <div className="grid gap-1.5 border-t border-border pt-2 text-xs">
          <p className="font-medium">Desistimientos</p>
          {historial.map((x) => (
            <div key={x.id} className="rounded-lg bg-muted/50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2"><b>{MOTIVOS_DESISTIMIENTO[x.motivo]}</b>{x.codigoUnidad ? <span>{dptDe(x.codigoUnidad)}</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${ESTADO_DESISTIMIENTO[x.estado].tono}`}>{ESTADO_DESISTIMIENTO[x.estado].label}</span></div>
              <div className="text-[11px] text-muted-foreground">{new Date(x.registradoEn).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })} · {x.registradoPor}{x.observaciones ? ` · ${x.observaciones}` : ''}</div>
              {x.unidadDetalle && <div className="text-[11px] text-muted-foreground">{x.unidadDetalle}</div>}
              {x.estado === 'pendiente' && <div className="text-[11px] font-medium text-amber-800">{faltaPara(x)}. Se decide en Reservas.{x.montoRecibido ? ` Hay ${fmtUsd2(x.montoRecibido)} recibidos.` : ''}</div>}
              {x.autorizadoPor && <div className="text-[11px] text-muted-foreground">Autorizó {x.autorizadoPor}: {x.autorizacionNota}</div>}
              {x.revisadoPor && <div className="text-[11px] text-muted-foreground">Revisión de Finanzas de {x.revisadoPor}: {x.revisionNota}</div>}
              {x.estado === 'rechazado' && <div className="text-[11px] text-rose-700">Rechazó {x.rechazadoPor}: {x.motivoRechazo}</div>}
            </div>
          ))}
        </div>
      )}
      {desiste && <DesistimientoDialog clienteId={c.id} onClose={() => setDesiste(false)} onDone={onMessage} />}
      {!!c.accesos?.length && can('clientes.asignar') && (
        <div className="grid gap-1 border-t border-border pt-2 text-xs">
          <p className="font-medium">Acceso autorizado</p>
          {c.accesos.map((a) => (
            <div key={a.usuarioId} className="flex items-center gap-2">
              <span>{a.nombre}</span><span className="truncate text-[11px] text-muted-foreground">{a.motivo}</span>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPedido({ tipo: 'revocar', usuarioId: a.usuarioId, nombre: a.nombre })}>Revocar</Button>
            </div>
          ))}
        </div>
      )}
      {pedido && (
        <PedidoDialog pedido={pedido} personas={pedido.tipo === 'revocar' ? [] : asignables.filter((p) => puedeVerDe(actor, [p.id]) && p.id !== pedido.o.responsableId)} onClose={() => setPedido(null)}
          onConfirm={(motivo, responsable) => pedido.tipo === 'revocar'
            ? ejecutar(() => revocarAcceso(datos, c.id, pedido.usuarioId, motivo), `Acceso de ${pedido.nombre} revocado`)
            : pedido.tipo === 'cerrar'
              ? ejecutar(() => cerrarOportunidad(datos, pedido.o.id, motivo), 'Negociación cerrada')
              : ejecutar(() => transferirOportunidad(datos, pedido.o.id, responsable, motivo), 'Negociación transferida')} />
      )}
    </section>
  )
}

const propiasAbiertas = (oportunidades: Oportunidad[], clienteId: string) => oportunidades.some((o) => o.clienteId === clienteId && o.etapa !== 'perdida')

function PedidoDialog({ pedido, personas, onClose, onConfirm }: {
  pedido: Pedido
  personas: { id: string; nombre: string }[]
  onClose: () => void
  onConfirm: (motivo: string, responsable: string) => Promise<boolean>
}) {
  const [motivo, setMotivo] = useState('')
  const [responsable, setResponsable] = useState('')
  const transferir = pedido.tipo === 'transferir'
  const valido = motivo.trim().length >= 5 && (!transferir || !!responsable)
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{pedido.tipo === 'revocar' ? `Revocar el acceso de ${pedido.nombre}` : transferir ? 'Transferir negociación' : 'Cerrar negociación'}</DialogTitle>
          <DialogDescription>{pedido.tipo === 'revocar' ? 'Dejará de ver a este cliente, salvo que sea su asesor o tenga una negociación a cargo.' : transferir ? 'El asesor principal del cliente y la atribución de comisiones no cambian.' : 'El cliente conserva su etapa y sus demás negociaciones.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {transferir && (
            <div className="grid gap-1.5">
              <Label htmlFor="neg-resp" className="text-xs">Nuevo responsable *</Label>
              <Select value={responsable} onValueChange={setResponsable}>
                <SelectTrigger id="neg-resp" className="h-9 w-full"><SelectValue placeholder="Elegir persona" /></SelectTrigger>
                <SelectContent>{personas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="neg-motivo" className="text-xs">Motivo *</Label>
            <Textarea id="neg-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valido} onClick={() => void onConfirm(motivo.trim(), responsable).then(onClose)}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
