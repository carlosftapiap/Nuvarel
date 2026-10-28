import {
  BadgePercent,
  Building2,
  Calculator,
  CalendarCheck,
  ChartColumn,
  FileSignature,
  FolderOpen,
  GanttChart,
  LayoutDashboard,
  Settings,
  SquareKanban,
  Users,
  Wallet,
  Handshake,
  Landmark,
  Tags,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Navegación: primero las herramientas de venta diaria; después seguimiento, finanzas y sistema.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Ventas',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/inventario', label: 'Inventario', icon: Building2 },
      { to: '/financiamiento', label: 'Financiamiento', icon: Landmark },
      { to: '/precios', label: 'Precios', icon: Tags },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: Calculator },
      { to: '/clientes', label: 'Clientes', icon: Users },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { to: '/comercial', label: 'Gestión comercial', icon: SquareKanban },
      { to: '/reservas', label: 'Reservas', icon: CalendarCheck },
      { to: '/ventas', label: 'Ventas y contratos', icon: FileSignature },
      { to: '/corredores', label: 'Corredores', icon: Handshake },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/cobranzas', label: 'Cobranzas', icon: Wallet },
      { to: '/comisiones', label: 'Comisiones', icon: BadgePercent },
      { to: '/reportes', label: 'Reportes', icon: ChartColumn },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/recursos', label: 'Centro de recursos', icon: FolderOpen },
      { to: '/configuracion', label: 'Configuración', icon: Settings },
      { to: '/plan', label: 'Plan de implementación', icon: GanttChart },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
