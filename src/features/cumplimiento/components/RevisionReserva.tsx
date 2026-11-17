import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { fmtFechaCorta } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { numeroComercial } from '@/features/inventario/nomenclatura'
import { fmtUsd2 } from '@/features/inventario/pricing'
import { resolverCumplimiento } from '@/features/reservas/remoto'
import type { ReservaBandeja } from '../bandeja'

type Decision = 'aprobado' | 'observado' | 'rechazado'
const TEXTO: Record<Decision, { boton: string; confirmar: string; hecho: string }> = {
  aprobado: { boton: 'Aprobar', confirmar: 'Confirmar aprobación', hecho: 'Operación aprobada: Finanzas ya puede verificar el pago.' },
  observado: { boton: 'Observar', confirmar: 'Enviar observación', hecho: 'Observación enviada: el vendedor tiene 48 horas para corregir.' },
  rechazado: { boton: 'Rechazar', confirmar: 'Confirmar rechazo', hecho: 'Operación rechazada: la reserva quedó anulada y sus pagos se conservan.' },
}

/**
 * Decisión de Cumplimiento sobre una solicitud de reserva (administrador u Oficial).
 * La base valida permisos y que quien solicitó no decida; aquí solo se recoge la decisión y su motivo.
 */
export default function RevisionReserva({ reserva, datos, puedeDecidir, onHecho }: {
  reserva: ReservaBandeja; datos: Datos; puedeDecidir: boolean; onHecho: (mensaje: string) => void
}) {
  const [decision, setDecision] = useState<Decision | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const exigeMotivo = decision !== null && decision !== 'aprobado'
  const listo = decision !== null && (!exigeMotivo || motivo.trim().length >= 5)

  const confirmar = async () => {
    if (!decision) return
    setEnviando(true); setError(null)
    try {
      await resolverCumplimiento(datos, reserva.id, decision, motivo.trim())
      onHecho(TEXTO[decision].hecho)
      setDecision(null); setMotivo('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section aria-label="Revisión de la reserva" className="grid gap-3 rounded-lg border border-border p-4">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Reserva</dt><dd className="font-medium">{reserva.codigo}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Departamento</dt><dd>{numeroComercial(reserva.unidad)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Monto de reserva</dt><dd className="tabular-nums">{fmtUsd2(reserva.monto)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Pagador</dt><dd>{reserva.pagador ?? 'Sin registrar'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Apartado hasta</dt><dd className="tabular-nums">{reserva.apartadoHasta ? fmtFechaCorta(reserva.apartadoHasta.slice(0, 10)) : '—'}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Prórroga</dt><dd>{reserva.prorrogas > 0 ? 'Usada' : 'Disponible'}</dd></div>
      </dl>

      {reserva.estado === 'aprobado' ? (
        <p className="text-sm text-muted-foreground">Operación aprobada por Cumplimiento. Finanzas verifica el pago.</p>
      ) : !puedeDecidir ? (
        <p className="text-sm text-muted-foreground">Solo el administrador o el Oficial de Cumplimiento deciden sobre la documentación.</p>
      ) : decision === null ? (
        <div className="grid gap-2 sm:flex">
          {(['aprobado', 'observado', 'rechazado'] as Decision[]).map((d) => (
            <Button key={d} className="h-10 w-full sm:w-auto" onClick={() => { setDecision(d); setError(null) }}>{TEXTO[d].boton}</Button>
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {exigeMotivo && (
            <div className="grid gap-1.5">
              <Label htmlFor="rr-motivo" className="text-xs">Motivo (lo verá el vendedor) *</Label>
              <textarea id="rr-motivo" className="min-h-20 rounded-md border border-border bg-white p-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
            </div>
          )}
          {decision === 'aprobado' && <p className="text-sm">Revisaste los documentos del cliente y el origen de fondos, y la operación puede continuar.</p>}
          <div className="grid gap-2 sm:flex">
            <Button className="h-10 w-full sm:w-auto" disabled={!listo || enviando} onClick={() => void confirmar()}>{enviando ? 'Guardando…' : TEXTO[decision].confirmar}</Button>
            <Button className="h-10 w-full sm:w-auto" variant="outline" disabled={enviando} onClick={() => { setDecision(null); setMotivo('') }}>Cancelar</Button>
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </section>
  )
}
