import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { fechaGuayaquil, fmtFechaCorta } from '@/features/financiamiento/plan'
import { anularAplicacion, archivoSoporte, autorizarExcedente, errorArchivo } from '../comprobantes'
import type { AplicacionFila, ResumenContrato } from '../tablero'

type Ejecutar = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>

/**
 * Saldo contra entrega (80 %): el excedente sobre la entrada solo lo reduce con autorización de Finanzas,
 * con motivo y documento de soporte. No cambia cuotas ni el contrato firmado.
 */
export default function ExcedenteEntrega({ r, datos, almacen, nombres, ejecutar }: { r: ResumenContrato; datos: Datos; almacen: AlmacenContratos | null; nombres: Map<string, string>; ejecutar: Ejecutar }) {
  const { can } = useSession()
  const [autorizar, setAutorizar] = useState(false)
  const [anular, setAnular] = useState<AplicacionFila | null>(null)
  const [errorSoporte, setErrorSoporte] = useState<string | null>(null)
  const puede = can('cobranzas.aplicar_excedente')
  const disponible = Math.min(r.saldoAFavor, r.saldoEntrega)
  const verSoporte = async (a: AplicacionFila) => {
    setErrorSoporte(null)
    try { window.open(URL.createObjectURL(await archivoSoporte(almacen, a.soporteRuta)), '_blank', 'noopener') } catch (e) { setErrorSoporte((e as Error).message) }
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Saldo contra entrega (80 %)</h3>
        {puede && r.contrato.estado === 'firmado' && disponible > 0 && <Button size="sm" variant="outline" onClick={() => setAutorizar(true)}>Aplicar saldo a favor</Button>}
      </div>
      <p className="text-xs text-muted-foreground">
        Monto {fmtUsd2(r.aplicadoEntrega + r.saldoEntrega)} · aplicado con autorización {fmtUsd2(r.aplicadoEntrega)} · pendiente {fmtUsd2(r.saldoEntrega)}.
        Es el desembolso bancario esperado. No es cartera de Nuvarel.
      </p>
      {r.saldoAFavor > 0 && (
        <p className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Saldo a favor sin aplicar: {fmtUsd2(r.saldoAFavor)}. Solo reduce el saldo contra entrega con autorización de Finanzas.
        </p>
      )}
      {r.aplicaciones.length > 0 && (
        <ul className="mt-2 grid gap-1.5 text-xs">
          {r.aplicaciones.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className={a.anuladoEn ? 'tabular-nums text-muted-foreground line-through' : 'font-medium tabular-nums'}>{fmtUsd2(a.monto)}</span>
              <span className="text-muted-foreground">{fmtFechaCorta(fechaGuayaquil(a.autorizadoEn))} · {nombres.get(a.autorizadoPor) ?? 'Usuario'}</span>
              <span className="min-w-0 flex-1 text-xs">{a.motivo}{a.anuladoEn && <span className="block text-rose-700">Anulada{a.anuladoPor ? ` por ${nombres.get(a.anuladoPor) ?? 'usuario'}` : ''}: {a.motivoAnulacion}</span>}</span>
              <Button size="sm" variant="ghost" onClick={() => void verSoporte(a)}><FileText />Soporte</Button>
              {puede && !a.anuladoEn && <Button size="sm" variant="ghost" onClick={() => setAnular(a)}>Anular</Button>}
            </li>
          ))}
        </ul>
      )}
      <FieldError>{errorSoporte}</FieldError>
      {autorizar && (
        <Autorizar
          disponible={disponible}
          onClose={() => setAutorizar(false)}
          guardar={(x) => ejecutar(() => autorizarExcedente(datos, almacen, r.contrato.id, x), 'Excedente aplicado al saldo contra entrega')}
        />
      )}
      {anular && (
        <Anular
          a={anular}
          onClose={() => setAnular(null)}
          guardar={(motivo) => ejecutar(() => anularAplicacion(datos, anular.id, motivo), 'Aplicación anulada: el monto vuelve al saldo a favor')}
        />
      )}
    </section>
  )
}

function Autorizar({ disponible, onClose, guardar }: { disponible: number; onClose: () => void; guardar: (x: { monto: number; motivo: string; archivo: File | null }) => Promise<boolean> }) {
  const [monto, setMonto] = useState(String(disponible))
  const [motivo, setMotivo] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const valor = leerMonto(monto)
  const errorMonto = valor !== null && valor > disponible ? `El máximo disponible es ${fmtUsd2(disponible)}.` : null
  const adjunto = errorArchivo(archivo)
  const listo = !!valor && valor > 0 && !errorMonto && motivo.trim().length >= 10 && !!archivo && !adjunto && !enviando
  const enviar = async () => {
    setEnviando(true)
    if (await guardar({ monto: valor!, motivo: motivo.trim(), archivo })) onClose()
    setEnviando(false)
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aplicar saldo a favor al 80 %</DialogTitle>
          <DialogDescription>Reduce el saldo contra entrega. Las cuotas y el contrato no cambian. Queda registrado con tu usuario, el motivo y el soporte.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ex-monto" className="text-xs">Monto a aplicar * (disponible {fmtUsd2(disponible)})</Label>
            <Input id="ex-monto" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <FieldError>{errorMonto}</FieldError>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-motivo" className="text-xs">Motivo * (mínimo 10 caracteres)</Label>
            <Textarea id="ex-motivo" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: abono anticipado solicitado por el comprador para reducir la hipoteca" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-soporte" className="text-xs">Documento de soporte * (PDF, JPG o PNG; máximo 10 MB)</Label>
            <Input id="ex-soporte" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
            <FieldError>{adjunto}</FieldError>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button disabled={!listo} onClick={() => void enviar()}>{enviando && <Loader2 className="animate-spin" />}Autorizar aplicación</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Anular({ a, onClose, guardar }: { a: AplicacionFila; onClose: () => void; guardar: (motivo: string) => Promise<boolean> }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const enviar = async () => {
    setEnviando(true)
    if (await guardar(motivo.trim())) onClose()
    setEnviando(false)
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anular la aplicación de {fmtUsd2(a.monto)}</DialogTitle>
          <DialogDescription>El monto vuelve al saldo a favor. El registro se conserva con el motivo.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="ex-anular" className="text-xs">Motivo * (mínimo 10 caracteres)</Label>
          <Textarea id="ex-anular" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={enviando} onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" disabled={motivo.trim().length < 10 || enviando} onClick={() => void enviar()}>{enviando && <Loader2 className="animate-spin" />}Anular</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
