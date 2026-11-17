import {
  BadgePercent,
  Building2,
  Calculator,
  CalendarCheck,
  ChartColumn,
  ChartPie,
  ClipboardCheck,
  FileSignature,
  FolderOpen,
  GanttChart,
  HardHat,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  UsersRound,
  Gauge,
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
  /** Basta con tener uno de estos permisos para entrar al módulo. */
  permisos: Permiso[]
  /** Módulo sin desarrollar: no aparece en el menú de nadie. */
  enConstruccion?: boolean
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

// Catálogo de módulos agrupado por área. El menú lateral muestra primero «Trabajo» (lo diario de cada perfil) y después estos grupos, plegados.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Paneles',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, permisos: ['dashboard.ver'] },
      { to: '/equipo', label: 'Dashboard de equipo', icon: Gauge, permisos: ['clientes.asignar'] },
      { to: '/mi-equipo', label: 'Mi equipo', icon: UsersRound, permisos: ['clientes.asignar'] },
      { to: '/finanzas', label: 'Dashboard financiero', icon: ChartPie, permisos: ['cobranzas.verificar'] },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { to: '/venta', label: 'Atender cliente', icon: ShoppingBag, permisos: ['cotizaciones.crear'] },
      { to: '/clientes', label: 'Clientes', icon: Users, permisos: ['clientes.ver'] },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: Calculator, permisos: ['cotizaciones.crear', 'cotizaciones.ver'] },
      { to: '/reservas', label: 'Reservas', icon: CalendarCheck, permisos: ['reservas.ver'] },
      { to: '/ventas', label: 'Ventas y contratos', icon: FileSignature, permisos: ['ventas.ver'] },
      { to: '/inventario', label: 'Inventario', icon: Building2, permisos: ['inventario.ver', 'inventario.tecnico'] },
      { to: '/precios', label: 'Precios', icon: Tags, permisos: ['precios.ver'] },
      { to: '/financiamiento', label: 'Financiamiento', icon: Landmark, permisos: ['financiamiento.simular'] },
      { to: '/corredores', label: 'Corredores', icon: Handshake, permisos: ['corredores.ver'] },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/pagos-por-verificar', label: 'Pagos por verificar', icon: ClipboardCheck, permisos: ['cobranzas.verificar', 'reservas.verificar_pago'] },
      { to: '/cobranzas', label: 'Cobranzas', icon: Wallet, permisos: ['cobranzas.ver'] },
      { to: '/comisiones', label: 'Comisiones', icon: BadgePercent, permisos: ['comisiones.ver_propias', 'comisiones.calcular', 'comisiones.aprobar', 'comisiones.finanzas'] },
      { to: '/reportes', label: 'Reportes', icon: ChartColumn, permisos: ['reportes.ver'], enConstruccion: true },
    ],
  },
  {
    label: 'Proyecto',
    items: [
      { to: '/obra', label: 'Avance de obra', icon: HardHat, permisos: ['obra.resumen', 'obra.ver'] },
      { to: '/plan', label: 'Plan de implementación', icon: GanttChart, permisos: ['plan.ver'] },
    ],
  },
  {
    label: 'Control y sistema',
    items: [
      { to: '/cumplimiento', label: 'Bandeja de Cumplimiento', icon: ShieldCheck, permisos: ['cumplimiento.ver'] },
      { to: '/recursos', label: 'Centro de recursos', icon: FolderOpen, permisos: ['recursos.ver'], enConstruccion: true },
      { to: '/configuracion', label: 'Configuración', icon: Settings, permisos: ['config.usuarios', 'config.roles', 'config.equipos', 'config.auditoria', 'config.multimedia'] },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

/**
 * Menú por rol: qué módulos ve cada perfil, separado de los permisos de datos.
 * Un rol sin entrada aquí ve lo que sus permisos le dejan abrir. El primero de la lista es su pantalla de inicio.
 * Ocultar un módulo del menú no quita permisos: las pantallas que lo necesitan siguen leyendo esos datos.
 */
const MENU_COMERCIAL = ['/', '/venta', '/clientes', '/cotizaciones', '/reservas', '/inventario', '/financiamiento', '/comisiones']

export const MENU_POR_ROL: Partial<Record<string, string[]>> = {
  // Vendedor y Corredor: herramientas comerciales y sus propias comisiones. Contratos y cobranzas se abren solo desde su operación.
  asesor: MENU_COMERCIAL,
  corredor: MENU_COMERCIAL,
  // Supervisor: dirige a su equipo y también vende, con las mismas herramientas del vendedor. Entra a su Dashboard de equipo.
  // Sin módulos financieros, de construcción ni de configuración.
  supervisor: ['/', '/equipo', '/mi-equipo', '/venta', '/clientes', '/cotizaciones', '/reservas', '/inventario', '/financiamiento', '/ventas', '/comisiones'],
  gerencia: ['/', '/equipo', '/mi-equipo', '/venta', '/financiamiento', '/clientes', '/reservas', '/ventas', '/cotizaciones', '/precios', '/inventario', '/corredores', '/cobranzas', '/comisiones', '/obra', '/plan', '/configuracion'],
  // Finanzas entra a su Dashboard financiero; Pagos por verificar está a un clic.
  finanzas: ['/finanzas', '/pagos-por-verificar', '/cobranzas', '/ventas', '/comisiones'],
  legal: ['/ventas', '/clientes', '/reservas'],
  oficial_cumplimiento: ['/cumplimiento', '/clientes', '/ventas'],
  constructor: ['/obra', '/inventario'],
  jarval: ['/', '/inventario', '/reservas', '/ventas', '/cobranzas', '/obra', '/plan'],
  // Administrador: sin entrada, ve todo lo que sus permisos le dejan abrir.
}

/** Nombre del módulo para un rol, cuando difiere del general. */
const ETIQUETA_POR_ROL: Partial<Record<string, Record<string, string>>> = {
  // El Supervisor también vende: Clientes y Ventas muestran los suyos y los de su equipo.
  supervisor: { '/': 'Inicio', '/clientes': 'Clientes (míos y del equipo)' },
  // Vendedor y Corredor entran a su agenda del día.
  asesor: { '/': 'Mi día' },
  corredor: { '/': 'Mi día' },
}
export const etiquetaDe = (item: NavItem, rol: string) => (Object.hasOwn(ETIQUETA_POR_ROL, rol) ? ETIQUETA_POR_ROL[rol]![item.to] : undefined) ?? item.label

// El id de rol 'constructor' coincide con una propiedad de todo objeto: se busca solo entre las claves propias.
const menuDe = (rol: string) => (Object.hasOwn(MENU_POR_ROL, rol) ? MENU_POR_ROL[rol] : undefined)

/** Visible en el menú lateral y en la búsqueda. */
export function enMenu(item: NavItem, rol: string, can: (p: Permiso) => boolean) {
  if (item.enConstruccion || !item.permisos.some((p) => can(p))) return false
  const menu = menuDe(rol)
  return !menu || menu.includes(item.to)
}

/** Vendedor y Supervisor abren su inicio con la disponibilidad de departamentos (mapa por edificio). */
export const INICIO_CON_MAPA: readonly string[] = ['asesor', 'supervisor']

/** Pantalla de inicio del rol, si tiene un menú propio. */
export const inicioDelRol = (rol: string) => menuDe(rol)?.[0] ?? null

/**
 * «Trabajo»: lo que cada perfil usa a diario, siempre visible arriba del menú y en la barra inferior del celular.
 * Solo ordena lo que el menú del rol ya muestra: no agrega módulos ni permisos.
 */
const TRABAJO_POR_ROL: Partial<Record<string, string[]>> = {
  asesor: ['/', '/clientes', '/venta', '/reservas', '/cotizaciones'],
  corredor: ['/', '/clientes', '/venta', '/reservas', '/cotizaciones'],
  supervisor: ['/equipo', '/clientes', '/venta', '/reservas', '/cotizaciones'],
  finanzas: ['/finanzas', '/pagos-por-verificar', '/cobranzas', '/ventas'],
  legal: ['/ventas', '/clientes', '/reservas'],
  oficial_cumplimiento: ['/cumplimiento', '/clientes', '/ventas'],
  constructor: ['/obra', '/inventario'],
  jarval: ['/', '/inventario', '/reservas', '/ventas'],
}
const TRABAJO_GENERAL = ['/', '/clientes', '/reservas', '/ventas', '/cotizaciones']

/** Módulos de trabajo del perfil, en su orden. Si ninguno está en su menú, los primeros que sí ve. */
export function trabajoDe(rol: string, can: (p: Permiso) => boolean): NavItem[] {
  const visibles = NAV_ITEMS.filter((i) => enMenu(i, rol, can))
  const propios = (Object.hasOwn(TRABAJO_POR_ROL, rol) ? TRABAJO_POR_ROL[rol]! : TRABAJO_GENERAL).flatMap((to) => visibles.filter((i) => i.to === to))
  return propios.length ? propios : visibles.slice(0, 4)
}

export interface GrupoMenu { label: string; items: NavItem[]; trabajo?: boolean }

/** Menú lateral: «Trabajo» primero y después los grupos con lo demás que el perfil ve. */
export function menuLateral(rol: string, can: (p: Permiso) => boolean): GrupoMenu[] {
  const trabajo = trabajoDe(rol, can)
  const resto = NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => enMenu(i, rol, can) && !trabajo.includes(i)) })).filter((g) => g.items.length)
  return [{ label: 'Trabajo', items: trabajo, trabajo: true }, ...resto]
}

const CORTO: Record<string, string> = {
  '/venta': 'Atender', '/cotizaciones': 'Cotizar', '/equipo': 'Equipo', '/mi-equipo': 'Equipo', '/ventas': 'Ventas',
  '/finanzas': 'Finanzas', '/pagos-por-verificar': 'Pagos', '/cumplimiento': 'Bandeja', '/obra': 'Obra', '/configuracion': 'Ajustes',
}

/** Barra inferior del celular: hasta cuatro accesos de trabajo del perfil. «Más» abre el menú completo. */
export function barraDe(rol: string, can: (p: Permiso) => boolean) {
  return trabajoDe(rol, can).slice(0, 4).map((i) => {
    const nombre = etiquetaDe(i, rol)
    return { to: i.to, icon: i.icon, corto: i.to === '/' ? (nombre === 'Mi día' ? 'Mi día' : 'Inicio') : CORTO[i.to] ?? nombre.split(' ')[0] }
  })
}
