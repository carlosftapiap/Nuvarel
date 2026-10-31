import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'

/** Propuesta inicial del monto de la reserva. Cada venta puede acordar otro, hasta el 6 %. Sin la migración no aparece. */
export default function ReservaPredeterminada({ datos }: { datos: Datos }) {
  const [actual, setActual] = useState<number | null>(null)
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    try {
      const [f] = await datos.select<{ reserva_predeterminada?: unknown }>('pricing_params', { filtros: { id: 1 } })
      if (f?.reserva_predeterminada !== undefined) { setActual(Number(f.reserva_predeterminada)); setMonto(String(Number(f.reserva_predeterminada))) }
    } catch { /* sin acceso: no se muestra */ }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const valor = leerMonto(monto)
  async function guardar() {
    setError(null); setAviso(null)
    try {
      await datos.rpc('config_reserva_predeterminada', { p_monto: valor, p_motivo: motivo })
      setAviso(`Reserva predeterminada: ${fmtUsd2(valor!)}`); setMotivo(''); await cargar()
    } catch (e) { setError((e as Error).message) }
  }

  if (actual === null) return null
  return (
    <section aria-labelledby="rd-tit" className="dashboard-card p-4">
      <h2 id="rd-tit" className="text-sm font-semibold">Reserva predeterminada</h2>
      <p className="mt-1 text-xs text-muted-foreground">Es el monto que se propone al atender a un cliente. No es obligatorio: cada venta puede acordar otro, hasta el 6 %.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5"><Label htmlFor="rd-monto" className="text-xs">Monto (USD)</Label><Input id="rd-monto" inputMode="decimal" className="w-32" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        <div className="grid min-w-60 flex-1 gap-1.5"><Label htmlFor="rd-motivo" className="text-xs">Motivo *</Label><Input id="rd-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
        <Button size="sm" disabled={valor === null || !Number.isFinite(valor) || valor <= 0 || valor === actual || motivo.trim().length < 5} onClick={() => void guardar()}>Guardar</Button>
      </div>
      <div className="mt-2 empty:hidden"><FieldError>{error}</FieldError></div>
      {aviso && <p role="status" className="mt-2 text-xs text-emerald-800">{aviso}</p>}
    </section>
  )
}
