import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import * as api from '../api'
import type { Frente } from '../model'
import { fmtFecha } from '../ui'

type Ejecutar = (fn: () => Promise<unknown>, ok: string) => Promise<boolean>

/** Crear el primer plan (requiere permiso de alcance). */
export function CrearPlan({ datos, ejecutar, onCreado }: { datos: Datos; ejecutar: Ejecutar; onCreado: (id: string) => void }) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil' }).format(new Date())
  const [codigo, setCodigo] = useState('PLAN-AMURA')
  const [nombre, setNombre] = useState('Plan de implementación AMURA')
  const [corte, setCorte] = useState(hoy)
  let creado: string | null = null
  return (
    <div className="dashboard-card mx-auto grid max-w-lg gap-3">
      <h2 className="text-sm font-semibold">Crear el plan</h2>
      <p className="text-xs text-muted-foreground">Se crea con los seis frentes del consolidado (Comercial, Marketing, Legal, Tecnología, Finanzas y Construcción) sin pesos. Después podrás importar el cronograma.</p>
      <div className="grid gap-1.5"><Label htmlFor="cp-cod" className="text-xs">Código</Label><Input id="cp-cod" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} /></div>
      <div className="grid gap-1.5"><Label htmlFor="cp-nom" className="text-xs">Nombre</Label><Input id="cp-nom" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
      <div className="grid gap-1.5"><Label htmlFor="cp-cor" className="text-xs">Fecha de corte de los indicadores</Label><Input id="cp-cor" type="date" value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
      <Button disabled={codigo.length < 2 || nombre.trim().length < 3 || !corte} onClick={() => void ejecutar(async () => {
        creado = await api.crearPlan(datos, { proyecto: 'AMURA', codigo, nombre, fechaCorte: corte })
      }, 'Plan creado').then((ok) => { if (ok && creado) onCreado(creado) })}>Crear plan</Button>
    </div>
  )
}

/** Fecha de corte, pesos de frentes y frente de cada fase. Cada cambio exige motivo y queda en auditoría. */
export default function ConfigPlan({ d, datos, ejecutar }: { d: api.DatosPlan; datos: Datos; ejecutar: Ejecutar }) {
  const plan = d.plan!
  const [corte, setCorte] = useState(plan.fechaCorte)
  const [alerta, setAlerta] = useState(String(plan.alertaDias))
  const [motivo, setMotivo] = useState('')
  const okMotivo = motivo.trim().length >= 5
  return (
    <div className="grid gap-4">
      <div className="dashboard-card grid gap-3">
        <h2 className="text-sm font-semibold">Motivo de los cambios</h2>
        <Input aria-label="Motivo" placeholder="Ej.: Acordado en comité del 29/10/2026" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <p className="text-xs text-muted-foreground">Obligatorio (mínimo 5 caracteres). Se registra con tu usuario, la fecha y los valores anteriores y nuevos.</p>
      </div>

      <div className="dashboard-card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5"><Label htmlFor="cf-corte" className="text-xs">Fecha de corte (actual {fmtFecha(plan.fechaCorte)})</Label><Input id="cf-corte" type="date" value={corte} onChange={(e) => setCorte(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="cf-alerta" className="text-xs">Alerta de vencimiento (días)</Label><Input id="cf-alerta" type="number" min={0} max={90} value={alerta} onChange={(e) => setAlerta(e.target.value)} /></div>
        <Button disabled={!okMotivo || !corte} onClick={() => void ejecutar(() => api.configurarPlan(datos, plan.id, corte, Number(alerta) || 0, motivo), 'Fecha de corte actualizada')}>Guardar</Button>
      </div>

      <div className="dashboard-card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 text-sm font-semibold">Pesos de los frentes</h2>
        <p className="px-4 text-xs text-muted-foreground">El consolidado solo se habilita cuando todos los frentes incluidos tienen peso validado. No se reparten pesos iguales automáticamente.</p>
        <table className="mt-3 w-full text-xs">
          <thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-4 py-2 text-left font-medium">Frente</th><th className="px-2 py-2 text-left font-medium">Peso</th><th className="px-2 py-2 text-left font-medium">Validado</th><th className="px-2 py-2 text-left font-medium">Incluido</th><th /></tr></thead>
          <tbody>{d.frentes.map((f) => <FilaFrente key={f.id} f={f} motivo={motivo} onGuardar={(peso, validado, incluido) => ejecutar(() => api.pesoFrente(datos, f.id, peso, validado, incluido, motivo), `Frente ${f.nombre} actualizado`)} />)}</tbody>
        </table>
      </div>

      <div className="dashboard-card !p-0 overflow-x-auto">
        <h2 className="px-4 pt-4 text-sm font-semibold">Frente de cada fase</h2>
        <p className="px-4 text-xs text-muted-foreground">Las fases son los grupos originales del cronograma. Sus actividades toman el frente elegido; sin frente no entran en el avance de ningún frente.</p>
        <table className="mt-3 w-full text-xs">
          <tbody>
            {d.fases.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-4 py-2">{f.codigo} {f.nombre}</td>
                <td className="px-4 py-2 text-right">
                  <select aria-label={`Frente de ${f.nombre}`} className="h-7 rounded-md border border-border bg-white px-1 text-xs" value={f.frenteId ?? ''}
                    onChange={(e) => void ejecutar(() => api.guardarFase(datos, plan.id, f.codigo, f.nombre, e.target.value || null, f.orden), `Fase ${f.codigo} asignada`)}>
                    <option value="">Sin frente</option>
                    {d.frentes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!d.fases.length && <tr><td className="px-4 py-3 text-muted-foreground">Sin fases todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilaFrente({ f, motivo, onGuardar }: { f: Frente; motivo: string; onGuardar: (peso: number | null, validado: boolean, incluido: boolean) => Promise<boolean> }) {
  const [peso, setPeso] = useState(f.peso === null ? '' : String(f.peso))
  const [validado, setValidado] = useState(f.pesoValidado)
  const [incluido, setIncluido] = useState(f.incluido)
  const num = peso.trim() === '' ? null : Number(peso.replace(',', '.'))
  const valido = (num === null || num > 0) && (!validado || num !== null) && motivo.trim().length >= 5
  const cambio = num !== f.peso || validado !== f.pesoValidado || incluido !== f.incluido
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 font-medium">{f.nombre}</td>
      <td className="px-2 py-2"><Input aria-label={`Peso de ${f.nombre}`} className="h-7 w-24" inputMode="decimal" placeholder="Pendiente" value={peso} onChange={(e) => setPeso(e.target.value)} /></td>
      <td className="px-2 py-2"><input type="checkbox" aria-label={`Peso de ${f.nombre} validado`} checked={validado} onChange={(e) => setValidado(e.target.checked)} /></td>
      <td className="px-2 py-2"><input type="checkbox" aria-label={`${f.nombre} incluido en el consolidado`} checked={incluido} onChange={(e) => setIncluido(e.target.checked)} /></td>
      <td className="px-4 py-2 text-right"><Button size="sm" variant="outline" disabled={!valido || !cambio} onClick={() => void onGuardar(num, validado, incluido)}>Guardar</Button></td>
    </tr>
  )
}
