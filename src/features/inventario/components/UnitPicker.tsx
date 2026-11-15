import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ESTADOS_EFECTIVOS, estadoEfectivo, type EstadoEfectivo } from '../estados'
import { calcularPrecio, fmtUsd } from '../pricing'
import type { EstadoComercial, PricingParams, Unit } from '../types'
import { nombreEdificio } from '../nomenclatura'

/** Selector de departamento agrupado por edificio. Las unidades fuera de `permitidos` aparecen deshabilitadas. */
export default function UnitPicker({
  id, label = 'Departamento', units, params, value, onChange, permitidos, soloPermitidos = false,
}: {
  id: string
  label?: string
  units: Unit[]
  params: PricingParams
  value: string
  onChange: (codigo: string) => void
  permitidos?: EstadoComercial[]
  /** Oculta las unidades que no están en `permitidos`, en vez de deshabilitarlas. */
  soloPermitidos?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full text-sm"><SelectValue placeholder="Selecciona un departamento" /></SelectTrigger>
        <SelectContent className="max-h-80">
          {([1, 2] as const).map((ed) => (
            <SelectGroup key={ed}>
              <SelectLabel>{nombreEdificio(ed)}</SelectLabel>
              {units.filter((u) => u.edificio === ed && (!soloPermitidos || !permitidos || permitidos.includes(u.estado))).map((u) => {
                const efectivo = estadoEfectivo(u)
                const bloqueada = permitidos ? !(permitidos as EstadoEfectivo[]).includes(efectivo) || !!u.solicitud : false
                return (
                  <SelectItem key={u.codigo} value={u.codigo} disabled={bloqueada}>
                    {u.dpt} · {u.tipologia} · {fmtUsd(calcularPrecio(u, params).precioVenta)}{u.solicitud ? ` · Solicitud ${u.solicitud.codigo} en trámite` : bloqueada ? ` · ${ESTADOS_EFECTIVOS[efectivo].label}` : ''}
                  </SelectItem>
                )
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
