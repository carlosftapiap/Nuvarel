import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'

export interface CuentaReceptora {
  id: string; receptor: string; titular: string; ruc: string; banco: string; tipo: 'corriente' | 'ahorros'; numero: string
  activa: boolean; motivoBaja: string | null
}

const RECEPTORES = ['NUVAREL', 'JARVAL', 'FIDUCIARIA']

/** RUC de sociedad o entidad (no persona natural): 13 dígitos, termina en 001, tercer dígito 6 o 9. */
export function revisarRuc(ruc: string): string | null {
  const r = ruc.replace(/\D/g, '')
  if (!/^\d{10}001$/.test(r)) return 'El RUC debe tener 13 dígitos y terminar en 001.'
  if (!['6', '9'].includes(r[2])) return 'Es un RUC de persona natural: solo se aceptan cuentas de la empresa o de la fiduciaria.'
  return null
}

export const cuentaCorta = (c: Pick<CuentaReceptora, 'banco' | 'tipo' | 'numero'>) => `${c.banco} · ${c.tipo === 'corriente' ? 'Corriente' : 'Ahorros'} ···${c.numero.slice(-4)}`

export async function listarCuentas(d: Datos): Promise<CuentaReceptora[]> {
  const filas = await d.select<Record<string, unknown>>('cuentas_receptoras', { orden: [{ columna: 'creada_en', asc: true }] })
  return filas.map((f) => ({
    id: String(f.id), receptor: String(f.receptor), titular: String(f.titular), ruc: String(f.ruc), banco: String(f.banco),
    tipo: f.tipo as CuentaReceptora['tipo'], numero: String(f.numero), activa: Boolean(f.activa), motivoBaja: f.motivo_baja ? String(f.motivo_baja) : null,
  }))
}

/** Configuración > Cobros: cuentas bancarias oficiales. Solo de la empresa o fiduciaria receptora, nunca personales. */
export default function CuentasReceptoras({ datos }: { datos: Datos }) {
  const [cuentas, setCuentas] = useState<CuentaReceptora[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [nueva, setNueva] = useState({ receptor: 'NUVAREL', titular: '', ruc: '', banco: '', tipo: 'corriente', numero: '', motivo: '' })
  const [baja, setBaja] = useState<{ id: string; motivo: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  const cargar = useCallback(async () => {
    try { setCuentas(await listarCuentas(datos)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const errorRuc = nueva.ruc ? revisarRuc(nueva.ruc) : null
  const listo = nueva.titular.trim().length >= 3 && !errorRuc && nueva.ruc.length > 0 && nueva.banco.trim().length >= 2
    && /^\d{6,20}$/.test(nueva.numero.replace(/\D/g, '')) && nueva.motivo.trim().length >= 5

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setEnviando(true); setError(null); setAviso(null)
    try { await fn(); setAviso(ok); await cargar() } catch (e) { setError((e as Error).message) } finally { setEnviando(false) }
  }
  const registrar = () => ejecutar(async () => {
    await datos.rpc('config_cuenta_registrar', {
      p_receptor: nueva.receptor, p_titular: nueva.titular, p_ruc: nueva.ruc, p_banco: nueva.banco, p_tipo: nueva.tipo, p_numero: nueva.numero, p_motivo: nueva.motivo,
    })
    setNueva({ receptor: nueva.receptor, titular: '', ruc: '', banco: '', tipo: 'corriente', numero: '', motivo: '' })
  }, 'Cuenta registrada. Los vendedores ya la ven como cuenta oficial.')

  const campo = 'h-9 w-full rounded-md border border-border bg-white px-2 text-sm'
  const activas = (cuentas ?? []).filter((c) => c.activa)
  const inactivas = (cuentas ?? []).filter((c) => !c.activa)
  return (
    <section aria-labelledby="cr-tit" className="dashboard-card grid gap-4 p-4">
      <div>
        <h2 id="cr-tit" className="text-sm font-semibold">Cuentas bancarias oficiales</h2>
        <p className="mt-1 text-xs text-muted-foreground">Solo cuentas de la empresa o de la fiduciaria que recibe los pagos. No se aceptan cuentas personales.</p>
      </div>

      {cuentas !== null && activas.length === 0 && <p className="text-xs font-medium text-amber-800">No hay cuentas oficiales registradas.</p>}
      {activas.length > 0 && (
        <ul className="grid gap-2">
          {activas.map((c) => (
            <li key={c.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:flex sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{c.titular} <span className="text-xs text-muted-foreground">· RUC {c.ruc} · {c.receptor}</span></p>
                <p className="text-xs text-muted-foreground">{c.banco} · {c.tipo === 'corriente' ? 'Cuenta corriente' : 'Cuenta de ahorros'} N.º {c.numero}</p>
              </div>
              {baja?.id === c.id ? (
                <div className="grid gap-2 sm:flex sm:items-end">
                  <Input aria-label="Motivo de la desactivación" placeholder="Motivo" value={baja.motivo} onChange={(e) => setBaja({ id: c.id, motivo: e.target.value })} />
                  <Button className="h-9" disabled={enviando || baja.motivo.trim().length < 5} onClick={() => void ejecutar(() => datos.rpc('config_cuenta_desactivar', { p_id: c.id, p_motivo: baja.motivo }).then(() => setBaja(null)), 'Cuenta desactivada. Se conserva en el historial.')}>Confirmar</Button>
                  <Button className="h-9" variant="outline" onClick={() => setBaja(null)}>Cancelar</Button>
                </div>
              ) : (
                <Button className="h-9 w-full sm:w-auto" variant="outline" onClick={() => setBaja({ id: c.id, motivo: '' })}>Desactivar</Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="grid gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-semibold">Registrar cuenta</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="cr-receptor" className="text-xs">Receptor *</Label>
            <select id="cr-receptor" className={campo} value={nueva.receptor} onChange={(e) => setNueva({ ...nueva, receptor: e.target.value })}>
              {RECEPTORES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="cr-titular" className="text-xs">Titular (razón social) *</Label><Input id="cr-titular" value={nueva.titular} onChange={(e) => setNueva({ ...nueva, titular: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cr-ruc" className="text-xs">RUC del titular *</Label><Input id="cr-ruc" inputMode="numeric" value={nueva.ruc} onChange={(e) => setNueva({ ...nueva, ruc: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cr-banco" className="text-xs">Banco *</Label><Input id="cr-banco" value={nueva.banco} onChange={(e) => setNueva({ ...nueva, banco: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cr-tipo" className="text-xs">Tipo de cuenta *</Label>
            <select id="cr-tipo" className={campo} value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}>
              <option value="corriente">Corriente</option><option value="ahorros">Ahorros</option>
            </select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="cr-numero" className="text-xs">Número de cuenta *</Label><Input id="cr-numero" inputMode="numeric" value={nueva.numero} onChange={(e) => setNueva({ ...nueva, numero: e.target.value })} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="cr-motivo" className="text-xs">Motivo o respaldo *</Label><Input id="cr-motivo" value={nueva.motivo} onChange={(e) => setNueva({ ...nueva, motivo: e.target.value })} placeholder="Ej.: certificado bancario del 10/11/2026" /></div>
        </div>
        <FieldError>{errorRuc}</FieldError>
        <div><Button className="h-9 w-full sm:w-auto" disabled={!listo || enviando} onClick={() => void registrar()}>Registrar cuenta</Button></div>
      </fieldset>

      <FieldError>{error}</FieldError>
      {aviso && <p role="status" className="text-xs text-emerald-800">{aviso}</p>}
      {inactivas.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Cuentas desactivadas ({inactivas.length})</summary>
          <ul className="mt-2 grid gap-1">{inactivas.map((c) => <li key={c.id}>{cuentaCorta(c)} · {c.titular} · {c.motivoBaja}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
