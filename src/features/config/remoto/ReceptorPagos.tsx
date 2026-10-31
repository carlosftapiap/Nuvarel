import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'

const RECEPTORES = ['NUVAREL', 'JARVAL', 'FIDUCIARIA']

/** Finanzas no puede verificar pagos hasta que esté definido quién los recibe. */
export default function ReceptorPagos({ datos }: { datos: Datos }) {
  const [actual, setActual] = useState<string | null>(null)
  const [cargado, setCargado] = useState(false)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [f] = await datos.select<{ receptor: string | null }>('payment_settings', { filtros: { id: 1 } })
      setActual(f?.receptor ?? null); setValor(f?.receptor ?? ''); setCargado(true)
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  async function guardar() {
    setError(null); setAviso(null)
    try {
      await datos.rpc('config_definir_receptor', { p_receptor: valor, p_motivo: motivo })
      setAviso(`Receptor de pagos: ${valor}`); setMotivo(''); await cargar()
    } catch (e) { setError((e as Error).message) }
  }

  if (!cargado && !error) return null
  return (
    <section aria-labelledby="rp-tit" className="dashboard-card p-4">
      <h2 id="rp-tit" className="text-sm font-semibold">Receptor de pagos</h2>
      <p className={`mt-1 text-xs ${actual ? 'text-muted-foreground' : 'font-medium text-amber-800'}`}>{actual ? `Los pagos los recibe ${actual}.` : 'Sin definir: Finanzas no puede verificar pagos hasta elegirlo.'}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5"><Label htmlFor="rp-receptor" className="text-xs">Quién recibe los pagos</Label>
          <select id="rp-receptor" className="h-9 rounded-md border border-border bg-white px-2 text-xs" value={valor} onChange={(e) => setValor(e.target.value)}>
            <option value="">Elegir</option>{RECEPTORES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="grid min-w-60 flex-1 gap-1.5"><Label htmlFor="rp-motivo" className="text-xs">Motivo *</Label><Input id="rp-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <Button size="sm" disabled={!valor || valor === actual || motivo.trim().length < 5} onClick={() => void guardar()}>Guardar</Button>
      </div>
      <div className="mt-2 empty:hidden"><FieldError>{error}</FieldError></div>
      {aviso && <p role="status" className="mt-2 text-xs text-emerald-800">{aviso}</p>}
    </section>
  )
}
