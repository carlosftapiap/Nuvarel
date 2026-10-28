import { ArrowLeft, Layers3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { NAV_ITEMS } from '@/app/navigation'

export default function ModulePlaceholder({ title }: { title: string }) {
  const Icon = NAV_ITEMS.find((item) => item.label === title)?.icon ?? Layers3
  return (
    <>
      <PageHeader title={title} subtitle="Todo lo que necesitas, en el mismo espacio de trabajo." />
      <div className="module-empty">
        <span className="module-empty-icon"><Icon className="size-7" aria-hidden="true" /></span>
        <span className="mb-3 rounded-full bg-secondary px-3 py-1 text-[10px] font-medium text-secondary-foreground">Próximamente</span>
        <h2 className="text-xl font-semibold tracking-tight">Estamos preparando este espacio</h2>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">El módulo de {title.toLowerCase()} está en construcción. Sus funciones se habilitarán en la fase correspondiente del proyecto.</p>
        <Button variant="outline" asChild className="mt-6 gap-2 text-xs"><Link to="/"><ArrowLeft className="size-3.5" />Volver al panel general</Link></Button>
      </div>
    </>
  )
}
