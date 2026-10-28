import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ESTADOS } from '../estados'
import { calcularPrecio, fmtUsd } from '../pricing'
import type { EstadoComercial, PricingParams, Unit } from '../types'

/** Selector de departamento agrupado por edificio. Las unidades fuera de `permitidos` aparecen deshabilitadas. */
export default function UnitPicker({
  id, label = 'Departamento', units, params, value, onChange, permitidos,
}: {
  id: string
  label?: string
  units: Unit[]
  params: PricingParams
  value: string
  onChange: (codigo: string) => void
  permitidos?: EstadoComercial[]
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full text-sm"><SelectValue placeholder="Selecciona un departamento" /></SelectTrigger>
        <SelectContent className="max-h-80">
          {([1, 2] as const).map((ed) => (
            <SelectGroup key={ed}>
              <SelectLabel>Edificio {ed}</SelectLabel>
              {units.filter((u) => u.edificio === ed).map((u) => {
                const bloqueada = permitidos ? !permitidos.includes(u.estado) : false
                return (
                  <SelectItem key={u.codigo} value={u.codigo} disabled={bloqueada}>
                    {u.dpt} · {u.tipologia} · {fmtUsd(calcularPrecio(u, params).precioVenta)}{bloqueada ? ` · ${ESTADOS[u.estado].label}` : ''}
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
