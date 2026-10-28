import type { ReactNode } from 'react'

export default function PageHeader({ title, subtitle, eyebrow = 'Espacio de trabajo', actions }: { title: string; subtitle?: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  )
}
