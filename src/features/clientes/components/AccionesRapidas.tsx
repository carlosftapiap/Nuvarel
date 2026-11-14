import { useState } from 'react'
import { CalendarPlus, Check, MessageCircle, Phone } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { enlaceWhatsApp, mensajeWhatsApp } from '@/features/leads/remoto'
import { cn } from '@/lib/utils'
import { TIPOS_ACTIVIDAD, type Cliente, type ProximaActividad } from '../model'
import { completarProxima, programarProxima, registrarContactoWhatsApp } from '../service'
import { useClientes } from '../store'

type Tipo = ProximaActividad['tipo']
const TIPOS: Tipo[] = ['llamada', 'mensaje', 'visita', 'nota']
const PLAZOS: [string, number][] = [['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]]
const SUGERENCIAS = ['Dar seguimiento a la cotización', 'Confirmar la visita', 'Enviar información']

const masDias = (fecha: string, n: number) => {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const boton = 'inline-grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-white text-slate-600 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:size-11'

/**
 * WhatsApp, llamada y seguimiento desde cualquier lista, sin abrir la ficha.
 * Las reglas son las de la ficha: registrar el contacto o programar exige poder editar clientes.
 */
export default function AccionesRapidas({ cliente: c, onMessage, className }: { cliente: Cliente; onMessage: (m: string) => void; className?: string }) {
  const { actor, can } = useSession()
  const { guardar } = useClientes()
  const [confirmar, setConfirmar] = useState(false)
  const editar = can('clientes.editar')
  const wa = c.telefono ? enlaceWhatsApp(c.telefono, mensajeWhatsApp(c.nombre, actor.nombre)) : null
  return (
    // Los clics no abren la fila o la tarjeta que contiene las acciones.
    <div className={cn('flex shrink-0 items-center gap-1.5', className)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {wa && editar && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(boton, 'hover:text-emerald-700')} aria-label={`WhatsApp a ${c.nombre}`} title="WhatsApp" onClick={() => setConfirmar(true)}>
          <MessageCircle className="size-4" aria-hidden="true" />
        </a>
      )}
      {c.telefono && <a href={`tel:${c.telefono}`} className={boton} aria-label={`Llamar a ${c.nombre}`} title="Llamar"><Phone className="size-4" aria-hidden="true" /></a>}
      {editar && c.etapa !== 'perdido' && <Seguimiento c={c} onMessage={onMessage} />}
      {confirmar && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmar(false) }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>¿Pudiste comunicarte con {c.nombre}?</DialogTitle>
              <DialogDescription>Abrimos tu WhatsApp con su número. Solo si respondes que sí, queda registrado el contacto.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmar(false)}>Todavía no</Button>
              <Button onClick={async () => {
                try { await guardar((s) => registrarContactoWhatsApp(s, c.id, actor)); onMessage(`Contacto por WhatsApp con ${c.nombre} registrado`) } catch (e) { onMessage((e as Error).message) }
                setConfirmar(false)
              }}>Sí, registrar el contacto</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

/** Popover de seguimiento: marcar hecha la gestión pendiente y programar la siguiente en pocos toques. */
function Seguimiento({ c, onMessage }: { c: Cliente; onMessage: (m: string) => void }) {
  const { actor } = useSession()
  const { guardar } = useClientes()
  const hoy = hoyGuayaquil()
  const [abierto, setAbierto] = useState(false)
  const [tipo, setTipo] = useState<Tipo>('llamada')
  const [fecha, setFecha] = useState(() => masDias(hoy, 1))
  const [que, setQue] = useState('')
  const [resultado, setResultado] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const reiniciar = () => { setTipo('llamada'); setFecha(masDias(hoy, 1)); setQue(''); setResultado(''); setError(null) }
  const ejecutar = async (fn: Parameters<typeof guardar>[0], ok: string) => {
    setGuardando(true); setError(null)
    try { await guardar(fn); onMessage(ok); return true } catch (e) { setError((e as Error).message); return false } finally { setGuardando(false) }
  }
  const programar = async () => {
    if (que.trim().length < 3) return setError('Escribe qué hay que hacer (al menos 3 letras).')
    if (await ejecutar((s) => programarProxima(s, c.id, { tipo, descripcion: que, fecha }, actor), `Próxima gestión con ${c.nombre}: ${TIPOS_ACTIVIDAD[tipo].toLowerCase()} el ${fmtFechaCorta(fecha)}`)) { setAbierto(false); reiniciar() }
  }
  return (
    <Popover open={abierto} onOpenChange={(o) => { setAbierto(o); if (!o) reiniciar() }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(boton, abierto && 'border-primary text-primary')} aria-label={`Seguimiento de ${c.nombre}`} title="Programar seguimiento">
          <CalendarPlus className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="grid grid-cols-[minmax(0,1fr)] w-[340px] gap-3" aria-label={`Seguimiento de ${c.nombre}`}>
        <div>
          <p className="text-sm font-semibold">Seguimiento</p>
          <p className="text-xs text-muted-foreground">{c.nombre}</p>
        </div>
        {c.proxima && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-muted/60 p-3">
            <p className="text-xs"><b>Pendiente:</b> {TIPOS_ACTIVIDAD[c.proxima.tipo]} · {c.proxima.descripcion} · {fmtFechaCorta(c.proxima.fecha)}</p>
            <div className="flex gap-2">
              <Input aria-label="Resultado de la gestión" value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Resultado (opcional)" className="h-9 text-xs" />
              <Button size="sm" variant="outline" className="h-9" disabled={guardando}
                onClick={async () => { if (await ejecutar((s) => completarProxima(s, c.id, resultado, actor), `Gestión con ${c.nombre} marcada como hecha`)) setResultado('') }}>
                <Check />Hecha
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <p className="text-xs font-semibold text-slate-700">{c.proxima ? 'Reprogramar o programar la siguiente' : 'Programar la próxima gestión'}</p>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Tipo de gestión">
            {TIPOS.map((t) => (
              <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}
                className={cn('h-8 rounded-md text-xs font-medium text-slate-600', tipo === t && 'bg-white text-foreground shadow-xs')}>{TIPOS_ACTIVIDAD[t]}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fecha">
            {PLAZOS.map(([l, n]) => {
              const f = masDias(hoy, n)
              return <button key={l} type="button" aria-pressed={fecha === f} onClick={() => setFecha(f)}
                className={cn('h-8 rounded-md border border-border px-2.5 text-xs font-medium', fecha === f ? 'border-primary bg-secondary text-secondary-foreground' : 'bg-white hover:bg-muted')}>{l}</button>
            })}
            <Input type="date" aria-label="Otra fecha" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className="h-8 w-[150px] text-xs" />
          </div>
          <Input aria-label="Qué hacer" value={que} onChange={(e) => setQue(e.target.value)} placeholder="Qué hacer" className="h-9 text-sm"
            onKeyDown={(e) => { if (e.key === 'Enter') void programar() }} />
          <div className="flex flex-wrap gap-1.5">
            {SUGERENCIAS.map((s) => <button key={s} type="button" onClick={() => setQue(s)} className="rounded-full bg-muted px-2.5 py-1 text-xs text-slate-700 hover:bg-secondary">{s}</button>)}
          </div>
          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button size="sm" disabled={guardando} onClick={() => void programar()}>Guardar gestión</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
