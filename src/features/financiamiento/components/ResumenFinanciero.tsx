import { fmtUsd2, round2 } from '@/features/inventario/pricing'
import { cn } from '@/lib/utils'
import type { Calculo } from '../condiciones'
import type { PlanFinanciamiento } from '../plan'
import { nombreEdificio } from '@/features/inventario/nomenclatura'

/** Texto de las cuotas mensuales. La última absorbe los centavos del reparto, así el total queda exacto. */
export function textoCuotas(p: { meses: number; cuotaMensual: number; ultimaCuota: number }) {
  if (p.meses <= 1 || Math.abs(p.ultimaCuota - p.cuotaMensual) < 0.005) return `${p.meses} cuotas de ${fmtUsd2(p.cuotaMensual)}`
  return `${p.meses} cuotas: ${p.meses - 1} de ${fmtUsd2(p.cuotaMensual)} y una de ${fmtUsd2(p.ultimaCuota)}`
}

interface Fila { t: string; v: string; n?: string; destacada?: boolean; sub?: boolean; bloque?: boolean }

/**
 * Resumen para explicarle al comprador cómo se paga el departamento. Solo presenta lo que calcula el motor de Financiamiento:
 * reserva + saldo a la firma + cuotas ordinarias + cuotas extraordinarias + 80 % bancario = precio.
 */
export default function ResumenFinanciero({ calc, plan, edificio }: { calc: Calculo; plan: PlanFinanciamiento; edificio: number }) {
  const e = calc.entrada
  if (!e) return null
  const extras = e.extraordinarias
  const suma = round2(calc.reserva + e.pagoFirma + e.saldoCuotas + e.saldoEntrega)
  const cuadra = Math.abs(suma - plan.precioFinal) < 0.005
  const ordinarias = { meses: plan.meses, cuotaMensual: e.cuotaMensual, ultimaCuota: e.ultimaCuota }

  const filas: Fila[] = [
    { t: '1. Precio total del departamento', v: fmtUsd2(plan.precioFinal), n: plan.descuentoPct > 0 ? `Incluye descuento autorizado de ${plan.descuentoPct} %` : undefined, destacada: true },
    { t: '2. Entrada del 20 %', v: fmtUsd2(e.entradaTotal), n: '6 % a la firma + 14 % en cuotas', destacada: true },
    { t: '3. Reserva inicial', v: fmtUsd2(calc.reserva), n: 'Editable en Financiamiento; forma parte del 6 %' },
    { t: '4. Total del 6 % a la firma', v: fmtUsd2(e.acumuladoFirma) },
    { t: '5. Reserva descontada del 6 %', v: `− ${fmtUsd2(calc.reserva)}`, sub: true },
    { t: '6. Saldo pendiente a pagar a la firma', v: fmtUsd2(e.pagoFirma), n: 'Lo que falta pagar del 6 %' },
    { t: '7. Total del 14 % en cuotas', v: fmtUsd2(e.saldoCuotas), n: 'Cuotas ordinarias más extraordinarias' },
    { t: '8. Número de cuotas mensuales', v: `${plan.meses} (${nombreEdificio(edificio)})` },
    { t: '9. Valor de cada cuota', v: textoCuotas(ordinarias), n: e.cuotaMensual !== e.ultimaCuota ? 'La última cuota ajusta los centavos' : undefined, bloque: true },
  ]
  if (extras.length) {
    extras.forEach((x) => filas.push({ t: `Extraordinaria · mes ${x.mes}`, v: fmtUsd2(x.monto), sub: true }))
    const sin = calc.sinExtras
    filas.push({ t: '10. Efecto en las cuotas ordinarias', v: textoCuotas(ordinarias), n: sin ? `Sin extraordinarias serían ${textoCuotas({ meses: plan.meses, cuotaMensual: sin.cuotaMensual, ultimaCuota: sin.ultimaCuota })}` : undefined, bloque: true })
  } else {
    filas.push({ t: '10. Cuotas extraordinarias', v: 'Ninguna' })
  }
  filas.push({ t: '11. Saldo del 80 % para financiamiento bancario', v: fmtUsd2(e.saldoEntrega), n: 'No forma parte de las cuotas de la entrada', destacada: true })
  filas.push({ t: '12. Comprobación del precio', v: cuadra ? `${fmtUsd2(suma)} · cuadra al centavo` : `${fmtUsd2(suma)} · NO cuadra`, n: 'Reserva + saldo a la firma + cuotas + 80 %', destacada: true })

  return (
    <section aria-label="Resumen financiero" className="rounded-xl border border-border bg-white px-3 py-2 text-xs">
      <h3 className="pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cómo se paga el departamento</h3>
      <dl className="grid gap-0">
        {filas.map((f) => (
          <div key={f.t} className={cn('border-t border-border/70 py-1.5', f.sub && 'pl-3 text-muted-foreground', !f.bloque && 'flex items-baseline justify-between gap-3')}>
            <dt className={cn('min-w-0', f.destacada && 'font-semibold text-foreground')}>
              {f.t}
              {f.n && <span className="block text-xs font-normal text-muted-foreground">{f.n}</span>}
            </dt>
            <dd className={cn('tabular-nums', f.bloque ? 'mt-0.5 font-medium text-foreground' : 'shrink-0 text-right', f.destacada ? 'font-semibold text-foreground' : !f.bloque && 'font-medium')}>{f.v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
