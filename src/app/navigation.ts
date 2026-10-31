import {
  BadgePercent,
  Building2,
  Calculator,
  CalendarCheck,
  ChartColumn,
  FileSignature,
  FolderOpen,
  GanttChart,
  HardHat,
  LayoutDashboard,
  Settings,
  SquareKanban,
  Users,
  Wallet,
  Handshake,
  ShoppingBag,
  Landmark,
  Tags,
  type LucideIcon,
} from 'lucide-react'
import type { Permiso } from './permissions'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Basta con tener uno de estos permisos para ver el módulo. */
  permisos: Permiso[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Navegación: primero las herramientas de venta diaria; después seguimiento, finanzas y sistema.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'General',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, permisos: ['dashboard.ver'] },
      { to: '/plan', label: 'Plan de implementación', icon: GanttChart, permisos: ['plan.ver'] },
    ],
  },
  {
    label: 'Ventas',
    items: [
      { to: '/venta', label: 'Atender cliente', icon: ShoppingBag, permisos: ['cotizaciones.crear'] },
      { to: '/inventario', label: 'Inventario', icon: Building2, permisos: ['inventario.ver', 'inventario.tecnico'] },
      { to: '/financiamiento', label: 'Financiamiento', icon: Landmark, permisos: ['financiamiento.simular'] },
      { to: '/precios', label: 'Precios', icon: Tags, permisos: ['precios.ver'] },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: Calculator, permisos: ['cotizaciones.crear', 'cotizaciones.ver'] },
      { to: '/clientes', label: 'Clientes', icon: Users, permisos: ['clientes.ver'] },
    ],
  },
  {
    label: 'Construcción',
    items: [
      { to: '/obra', label: 'Avance de obra', icon: HardHat, permisos: ['obra.resumen', 'obra.ver'] },
    ],
  },
  {
    label: 'Seguimiento',
    items: [
      { to: '/comercial', label: 'Gestión comercial', icon: SquareKanban, permisos: ['clientes.ver'] },
      { to: '/reservas', label: 'Reservas', icon: CalendarCheck, permisos: ['reservas.ver'] },
      { to: '/ventas', label: 'Ventas y contratos', icon: FileSignature, permisos: ['ventas.ver'] },
      { to: '/corredores', label: 'Corredores', icon: Handshake, permisos: ['corredores.ver'] },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/cobranzas', label: 'Cobranzas', icon: Wallet, permisos: ['cobranzas.ver'] },
      { to: '/comisiones', label: 'Comisiones', icon: BadgePercent, permisos: ['comisiones.ver_propias', 'comisiones.calcular', 'comisiones.aprobar', 'comisiones.finanzas'] },
      { to: '/reportes', label: 'Reportes', icon: ChartColumn, permisos: ['reportes.ver'] },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/recursos', label: 'Centro de recursos', icon: FolderOpen, permisos: ['recursos.ver'] },
      { to: '/configuracion', label: 'Configuración', icon: Settings, permisos: ['config.usuarios', 'config.roles', 'config.equipos', 'config.auditoria', 'config.multimedia'] },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)
