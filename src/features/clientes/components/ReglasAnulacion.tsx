import { cn } from '@/lib/utils'
import type { NivelDesistimiento } from '../desistimiento'

const REGLAS: { nivel: NivelDesistimiento | 'contrato' | 'sin_reserva'; caso: string; aprueba: string; departamento: string }[] = [
  { nivel: 'sin_reserva', caso: 'Cliente interesado, sin reserva', aprueba: 'No requiere aprobación', departamento: 'No cambia' },
  { nivel: 'directo', caso: 'Reserva solicitada, sin pago ni comprobante', aprueba: 'No requiere aprobación', departamento: 'No cambia: la solicitud no lo retenía' },
  { nivel: 'supervisor_o_gerencia', caso: 'Reserva aprobada, sin dinero recibido', aprueba: 'Un supervisor o Gerencia', departamento: 'Se libera al autorizar' },
  { nivel: 'gerencia_y_finanzas', caso: 'Con dinero recibido o comprobante', aprueba: 'Gerencia y además Finanzas', departamento: 'Se libera cuando estén las dos' },
  { nivel: 'contrato', caso: 'Con contrato vigente', aprueba: 'Primero se anula el contrato en Ventas y contratos', departamento: 'No se libera hasta entonces' },
]

/** Las reglas, a la vista de quien solicita y de quien aprueba. Las hace cumplir el servidor. */
export default function ReglasAnulacion({ actual }: { actual?: NivelDesistimiento | 'contrato' | 'sin_reserva' }) {
  return (
    <div className="grid gap-1.5" aria-label="Reglas de anulación">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted text-muted-foreground">
            <tr><th className="px-2 py-1.5 text-left font-medium">Situación</th><th className="px-2 py-1.5 text-left font-medium">Quién aprueba</th><th className="px-2 py-1.5 text-left font-medium">Departamento</th></tr>
          </thead>
          <tbody>
            {REGLAS.map((r) => (
              <tr key={r.nivel} aria-current={actual === r.nivel ? 'true' : undefined} className={cn('border-t border-border', actual === r.nivel && 'bg-amber-50 font-medium text-amber-950')}>
                <td className="px-2 py-1.5">{r.caso}</td><td className="px-2 py-1.5">{r.aprueba}</td><td className="px-2 py-1.5">{r.departamento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Hasta completar las aprobaciones no cambia nada. Quien solicita no puede aprobar su propia solicitud, y Gerencia y Finanzas deben ser personas distintas. Si Gerencia bloqueó el departamento, o tiene otro compromiso, no pasa a Disponible. Nada se borra y no se crean pagos ni devoluciones.</p>
    </div>
  )
}
