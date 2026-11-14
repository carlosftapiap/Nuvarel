import type { Unit } from '../types'

const RANGO: [RegExp, number][] = [
  [/centro-izquierda/i, 1],
  [/centro-derecha/i, 3],
  [/izquierda/i, 0],
  [/derecha/i, 4],
  [/centro/i, 2],
]
const rango = (ubicacion: string) => RANGO.find(([re]) => re.test(ubicacion))?.[1] ?? 2

/**
 * Esquema de posición dentro del piso, derivado del campo "Ubicación" de la lista.
 * No reemplaza al plano arquitectónico.
 */
export default function LocationSchema({ unit, units, onSelect }: { unit: Unit; units: Unit[]; onSelect?: (codigo: string) => void }) {
  const piso = units.filter((u) => u.edificio === unit.edificio && u.piso === unit.piso)
  const filas = [
    piso.filter((u) => /superior/i.test(u.ubicacion)).sort((a, b) => rango(a.ubicacion) - rango(b.ubicacion)),
    piso.filter((u) => !/superior/i.test(u.ubicacion)).sort((a, b) => rango(a.ubicacion) - rango(b.ubicacion)),
  ]
  const W = 320, pad = 8, rowH = 58, gap = 22
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${pad * 2 + rowH * 2 + gap}`} className="w-full" role="img" aria-label={`Esquema del piso con la unidad ${unit.codigo} resaltada`}>
        <rect x="1" y="1" width={W - 2} height={pad * 2 + rowH * 2 + gap - 2} rx="10" fill="var(--muted)" stroke="var(--border)" />
        <text x={W / 2} y={pad + rowH + gap / 2 + 3} textAnchor="middle" fontSize="8" fill="var(--muted-foreground)" letterSpacing="1.5">CIRCULACIÓN</text>
        {filas.map((fila, r) => {
          const w = (W - pad * 2 - (fila.length - 1) * 6) / Math.max(fila.length, 1)
          return fila.map((u, i) => {
            const x = pad + i * (w + 6)
            const y = pad + r * (rowH + gap)
            const activo = u.codigo === unit.codigo
            return (
              <g key={u.codigo} onClick={() => onSelect?.(u.codigo)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
                <title>{`${u.dpt} · ${u.tipologia} · ${u.ubicacion}`}</title>
                <rect x={x} y={y} width={w} height={rowH} rx="7" fill={activo ? 'var(--primary)' : 'var(--card)'} stroke={activo ? 'var(--primary)' : 'var(--input)'} />
                <text x={x + w / 2} y={y + rowH / 2 - 2} textAnchor="middle" fontSize="11" fontWeight="600" fill={activo ? 'var(--primary-foreground)' : 'var(--foreground)'}>{u.dpt}</text>
                <text x={x + w / 2} y={y + rowH / 2 + 12} textAnchor="middle" fontSize="8" fill={activo ? 'var(--primary-foreground)' : 'var(--muted-foreground)'}>{u.tipologia}</text>
              </g>
            )
          })
        })}
      </svg>
      <figcaption className="mt-2 text-xs text-muted-foreground">Esquema referencial según el campo “Ubicación” de la lista de precios. No es el plano arquitectónico.</figcaption>
    </figure>
  )
}
