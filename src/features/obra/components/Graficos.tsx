/** Gráfico sin librerías externas: anillo de avance. Sin dato se muestra vacío, nunca 0 %. */

export const COLOR = {
  validado: '#10b981',
  falta: '#e2e8f0',
  texto: '#334155',
  suave: '#64748b',
}

export function Anillo({ valor, tamano = 132, grosor = 14, etiqueta, sublabel }: {
  valor: number | null
  tamano?: number
  grosor?: number
  etiqueta: string
  sublabel?: string
}) {
  const r = (tamano - grosor) / 2
  const c = 2 * Math.PI * r
  const v = valor === null ? 0 : Math.max(0, Math.min(100, valor))
  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${etiqueta}: ${valor === null ? 'sin dato' : `${Math.round(v)} por ciento`}`}>
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} aria-hidden="true">
        <circle cx={tamano / 2} cy={tamano / 2} r={r} fill="none" stroke={COLOR.falta} strokeWidth={grosor} />
        {valor !== null && (
          <circle cx={tamano / 2} cy={tamano / 2} r={r} fill="none" stroke={COLOR.validado} strokeWidth={grosor} strokeLinecap="round"
            strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`} className="transition-all duration-700" />
        )}
        <text x="50%" y="48%" textAnchor="middle" dominantBaseline="central" fontSize={tamano * 0.22} fontWeight="700" fill={COLOR.texto}>
          {valor === null ? '—' : `${Math.round(v)}%`}
        </text>
        {sublabel && <text x="50%" y="66%" textAnchor="middle" fontSize={tamano * 0.08} fill={COLOR.suave}>{sublabel}</text>}
      </svg>
      <span className="text-center text-xs font-semibold">{etiqueta}</span>
    </div>
  )
}
