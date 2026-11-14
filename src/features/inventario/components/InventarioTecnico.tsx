import { useEffect, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import type { Datos } from '@/features/conexion/datos'
import { ESTADO_DOCUMENTO, estadoDocumento } from '../data/data-quality'
import { fmtM2 } from '../pricing'
import { FieldError } from './shared'

interface FilaTecnica {
  codigo: string; dpt: string; edificio: number; piso: string; ubicacion: string; tipologia: string
  area_m2: number; bodega_codigo: string | null; bodega_m2: number; patio_m2: number; parqueo: string | null; plano_path: string | null
}

/** Para quien no tiene acceso comercial: el servidor solo entrega datos técnicos, sin precios ni estado comercial. */
export default function InventarioTecnico({ datos }: { datos: Datos }) {
  const [filas, setFilas] = useState<FilaTecnica[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    datos.rpc<FilaTecnica[]>('inventario_tecnico').then(setFilas).catch((e: Error) => setError(e.message))
  }, [datos])
  return (
    <>
      <PageHeader eyebrow="Inventario" title="Información técnica" subtitle="Edificio, departamento, tipología, superficies y planos." />
      <FieldError>{error}</FieldError>
      {!filas && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {filas && (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Departamento</th><th className="px-2 py-2 text-left font-medium">Ubicación</th><th className="px-2 py-2 text-left font-medium">Tipología</th><th className="px-2 py-2 text-right font-medium">Área</th><th className="px-2 py-2 text-right font-medium">Bodega</th><th className="px-2 py-2 text-right font-medium">Patio</th><th className="px-2 py-2 text-left font-medium">Parqueo</th><th className="px-4 py-2 text-left font-medium">Plano</th></tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const plano = ESTADO_DOCUMENTO[estadoDocumento(!!f.plano_path)]
                return (
                  <tr key={f.codigo} className="border-t border-border">
                    <td className="px-4 py-2"><div className="font-semibold">{f.dpt}</div><div className="text-xs text-muted-foreground">{f.codigo}</div></td>
                    <td className="px-2 py-2">Edificio {f.edificio} · {f.piso === 'PB' ? 'Planta baja' : `Piso ${f.piso}`}<div className="text-xs text-muted-foreground">{f.ubicacion}</div></td>
                    <td className="px-2 py-2">{f.tipologia}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtM2(Number(f.area_m2))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{f.bodega_codigo ? `${f.bodega_codigo} · ${fmtM2(Number(f.bodega_m2))}` : '—'}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(f.patio_m2) ? fmtM2(Number(f.patio_m2)) : '—'}</td>
                    <td className="px-2 py-2">{f.parqueo ?? 'Sin asignar'}</td>
                    <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${plano.tono}`}>{plano.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
