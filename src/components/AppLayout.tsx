import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronRight, Lock, LogOut, Menu, Search, Settings, X } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { iniciales } from '@/components/Estado'
import { barraDe, enMenu, etiquetaDe, menuLateral, NAV_ITEMS, type NavItem } from '@/app/navigation'
import { rolLabel } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDirectorio } from '@/features/config/store'
import { useConexion } from '@/app/auth'
import { useRefresco } from '@/features/conexion/refresco'
import { contarPorContactar } from '@/features/leads/remoto'
import { useClientes } from '@/features/clientes/store'
import { ETAPAS } from '@/features/clientes/model'
import { clientesVisibles } from '@/features/clientes/service'
import { celularLocal } from '@/features/clientes/celular'
import { useInventory } from '@/features/inventario/store'
import { useReservasOpcional } from '@/features/reservas/store'
import { reservasVisibles } from '@/features/reservas/service'
import { siguientePaso } from '@/features/reservas/siguiente'
import { cn } from '@/lib/utils'
import { nombreEdificio, textoBusquedaUnidad } from '@/features/inventario/nomenclatura'

function CuentaMenu() {
  const { cuenta, salir } = useConexion()
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-56 truncate text-xs text-muted-foreground sm:inline" title={cuenta?.email}>{cuenta?.nombre} · {cuenta?.rolNombre}</span>
      <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => void salir()}><LogOut />Salir</Button>
    </div>
  )
}

/** Mientras no exista inicio de sesión con Supabase, se trabaja como un usuario del directorio. */
function UserSwitcher() {
  const { actor, setUsuario } = useSession()
  const { state } = useDirectorio()
  const activos = state.usuarios.filter((u) => u.estado === 'activo')
  return (
    <Select value={actor.id} onValueChange={setUsuario}>
      <SelectTrigger size="sm" className="h-9 max-w-56 text-xs" aria-label="Trabajar como (modo demostración)" title="Modo demostración: elige el usuario con el que trabajas">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {activos.map((u) => <SelectItem key={u.id} value={u.id}>{u.nombre} · {rolLabel(u.rolId)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Puede abrir el módulo (también por enlace directo). */
function usePermitido() {
  const { can } = useSession()
  return (item: NavItem) => item.permisos.some((p) => can(p))
}

/** Aparece en su menú: el menú del rol puede mostrar menos de lo que sus permisos abren. */
function useEnMenu() {
  const { can, actor } = useSession()
  // Algunos roles ven el módulo con otro nombre (p. ej. el Supervisor, «Clientes (míos y del equipo)»).
  return (items: NavItem[]) => items.filter((item) => enMenu(item, actor.rol, can)).map((item) => ({ ...item, label: etiquetaDe(item, actor.rol) }))
}

/** Prospectos asignados a quien usa la app y todavía sin primer contacto: el aviso de leads dentro de AMURA. */
function usePorContactar() {
  const { remoto, datos } = useConexion()
  const { actor, can } = useSession()
  const puede = remoto && !!datos && can('clientes.ver')
  const [n, setN] = useState(0)
  const cargar = useCallback(async () => {
    if (!datos) return
    try { setN(await contarPorContactar(datos, actor.id)) } catch { setN(0) }
  }, [datos, actor.id])
  useRefresco(cargar, puede)
  return puede ? n : 0
}

/** Reservas en las que a esta persona le toca hacer algo (registrar, verificar o autorizar). */
function useReservasPorAtender() {
  const ctx = useReservasOpcional()
  const { actor, can } = useSession()
  return useMemo(() => (ctx ? reservasVisibles(ctx.state.reservas, actor).filter((r) => siguientePaso(r, can, { remoto: ctx.remoto }).accion).length : 0), [ctx, actor, can])
}

const CLAVE_ABIERTOS = 'amura.menu.abiertos'
const normal = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Grupos del menú que la persona dejó abiertos. Se guardan solo en este navegador. */
function leerAbiertos(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLAVE_ABIERTOS) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
function guardarAbiertos(lista: string[]) {
  try { localStorage.setItem(CLAVE_ABIERTOS, JSON.stringify(lista)) } catch { /* sin almacenamiento, el menú sigue funcionando */ }
}

/** Color de cada módulo en el menú: el mismo tono identifica su área en toda la aplicación. */
const COLOR_MODULO: Record<string, string> = {
  '/': '#2563eb', '/equipo': '#8b5cf6', '/mi-equipo': '#8b5cf6', '/finanzas': '#10b981', '/venta': '#2563eb', '/clientes': '#8b5cf6',
  '/cotizaciones': '#f97316', '/reservas': '#06b6d4', '/ventas': '#0ea5e9', '/inventario': '#10b981', '/precios': '#f59e0b', '/financiamiento': '#14b8a6',
  '/corredores': '#a855f7', '/pagos-por-verificar': '#f43f5e', '/cobranzas': '#22c55e', '/comisiones': '#eab308', '/obra': '#f97316', '/plan': '#0ea5e9',
  '/cumplimiento': '#14b8a6', '/configuracion': '#64748b',
}

const enfocarBusqueda = () => document.getElementById('global-search')?.focus()

function AppSidebar() {
  const { pathname } = useLocation()
  const porContactar = usePorContactar()
  const porAtender = useReservasPorAtender()
  const { isMobile, setOpenMobile, state } = useSidebar()
  const { actor, can } = useSession()
  const { remoto } = useConexion()
  const grupos = menuLateral(actor.rol, can).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, label: etiquetaDe(i, actor.rol) })) }))
  const esActivo = (item: NavItem) => (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to))
  // «Trabajo» siempre está a la vista; los demás grupos van plegados salvo el de la pantalla actual.
  const grupoActivo = grupos.find((g) => !g.trabajo && g.items.some(esActivo))?.label
  const [abiertos, setAbiertos] = useState<string[]>(() => [...new Set([...leerAbiertos(), ...(grupoActivo ? [grupoActivo] : [])])])
  const [grupoAnterior, setGrupoAnterior] = useState(grupoActivo)
  if (grupoActivo !== grupoAnterior) {
    setGrupoAnterior(grupoActivo)
    if (grupoActivo && !abiertos.includes(grupoActivo)) setAbiertos([...abiertos, grupoActivo])
  }
  const alternar = (label: string) => {
    const siguiente = abiertos.includes(label) ? abiertos.filter((x) => x !== label) : [...abiertos, label]
    setAbiertos(siguiente)
    guardarAbiertos(siguiente)
  }
  const cerrarEnCelular = () => { if (isMobile) setOpenMobile(false) }
  // Con el menú reducido a íconos se ven todos los accesos, sin grupos plegados.
  const soloIconos = state === 'collapsed' && !isMobile
  const insignia = (to: string) => {
    if (to === '/clientes' && porContactar > 0) return <SidebarMenuBadge title="Prospectos nuevos sin primer contacto" aria-label={`${porContactar} prospectos por contactar`} className="bg-amber-100 text-amber-900">{porContactar}</SidebarMenuBadge>
    if (to === '/reservas' && porAtender > 0) return <SidebarMenuBadge title="Reservas en las que te toca actuar" aria-label={`${porAtender} reservas por atender`} className="bg-[#eef2ff] text-[#3730a3]">{porAtender}</SidebarMenuBadge>
    return null
  }
  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarHeader className="relative px-4 pt-4 pb-1 group-data-[collapsible=icon]:p-2">
        {isMobile && <button type="button" aria-label="Cerrar menú" onClick={() => setOpenMobile(false)} className="absolute right-4 top-5 rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>}
        <Link to="/" aria-label="AMURA CRM · Inicio" onClick={cerrarEnCelular} className="marca-crm">
          <span className="logomarca" aria-hidden="true">A</span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden"><b>AMURA</b><small>CRM · {rolLabel(actor.rol)}</small></span>
        </Link>
        <button type="button" className="boton-comando group-data-[collapsible=icon]:hidden" onClick={() => { cerrarEnCelular(); setTimeout(enfocarBusqueda, 50) }}>
          <Search className="size-4" aria-hidden="true" /><span>Buscar o ir a…</span><kbd>Ctrl K</kbd>
        </button>
      </SidebarHeader>
      <SidebarContent className="pt-1">
        {grupos.map((group) => {
          const abierto = group.trabajo || soloIconos || abiertos.includes(group.label)
          const id = `menu-${normal(group.label).replace(/\s+/g, '-')}`
          return (
            <SidebarGroup key={group.label}>
              {group.trabajo ? null : (
                <SidebarGroupLabel asChild>
                  <button type="button" aria-expanded={abierto} aria-controls={id} onClick={() => alternar(group.label)}
                    className="flex w-full items-center gap-1.5 rounded-md text-left hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                    <ChevronDown className={cn('size-3.5 transition-transform', !abierto && '-rotate-90')} aria-hidden="true" />
                    {group.label}
                  </button>
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent id={id} hidden={!abierto} className={cn(!abierto && 'hidden')}>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild isActive={esActivo(item)} tooltip={item.label}>
                          <NavLink to={item.to} end={item.to === '/'} onClick={cerrarEnCelular}>
                            {group.trabajo ? <Icon aria-hidden="true" /> : <span className="icono-color" style={{ background: COLOR_MODULO[item.to] ?? "#64748b" }}><Icon aria-hidden="true" /></span>}<span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                        {insignia(item.to)}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
      <SidebarFooter className="px-3 pb-4 pt-2 group-data-[collapsible=icon]:p-2">
        <Link to="/configuracion" className="sidebar-profile" onClick={cerrarEnCelular}>
          <span className="profile-avatar group-data-[collapsible=icon]:size-8">{iniciales(actor.nombre)}</span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[13px] font-semibold text-slate-900">{actor.nombre}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">{rolLabel(actor.rol)}{remoto ? '' : ' · modo demostración'}</span>
          </span>
          <Settings className="size-4 text-slate-400 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={titulo}>
      <h3>{titulo}</h3>
      {children}
    </div>
  )
}

/**
 * Resultados por tipo. Clientes y departamentos usan los mismos filtros que sus pantallas: el alcance de cada persona
 * y el menú de su perfil. Solo se consultan cuando hay una búsqueda abierta.
 */
function ResultadosBusqueda({ consulta, modulos, cerrar }: { consulta: string; modulos: NavItem[]; cerrar: () => void }) {
  const { state: clientes } = useClientes()
  const { state: inventario } = useInventory()
  const { actor, can } = useSession()
  const q = normal(consulta)
  const enMenuDe = (to: string) => {
    const item = NAV_ITEMS.find((i) => i.to === to)
    return !!item && enMenu(item, actor.rol, can)
  }
  const cli = enMenuDe('/clientes')
    ? clientesVisibles(clientes.clientes, actor).filter((c) => normal(`${c.nombre} ${c.telefono} ${celularLocal(c.telefono)} ${c.email}`).includes(q)).slice(0, 5)
    : []
  const unidades = enMenuDe('/inventario')
    ? inventario.units.filter((u) => normal(`${textoBusquedaUnidad(u)} ${u.ubicacion} ${u.tipologia}`).includes(q)).slice(0, 5)
    : []
  const sinResultados = modulos.length + cli.length + unidades.length === 0
  return (
    <>
      {cli.length > 0 && (
        <Grupo titulo="Clientes">
          {cli.map((c) => (
            <Link key={c.id} to={`/clientes?cliente=${c.id}`} onClick={cerrar}>
              <span className="min-w-0 flex-1 truncate">{c.nombre}<span className="block text-xs text-muted-foreground">{ETAPAS[c.etapa].label} · {celularLocal(c.telefono) || c.email || 'Sin celular'}</span></span>
              <ChevronRight className="ml-auto size-3.5" />
            </Link>
          ))}
        </Grupo>
      )}
      {unidades.length > 0 && (
        <Grupo titulo="Departamentos">
          {unidades.map((u) => (
            <Link key={u.codigo} to={`/inventario?unidad=${encodeURIComponent(u.codigo)}`} onClick={cerrar}>
              <span className="min-w-0 flex-1 truncate">Departamento {u.dpt}<span className="block text-xs text-muted-foreground">{nombreEdificio(u.edificio)} · {u.ubicacion}</span></span>
              <ChevronRight className="ml-auto size-3.5" />
            </Link>
          ))}
        </Grupo>
      )}
      {modulos.length > 0 && (
        <Grupo titulo="Módulos">
          {modulos.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} onClick={cerrar}><Icon className="size-4 text-primary" />{label}<ChevronRight className="ml-auto size-3.5" /></Link>
          ))}
        </Grupo>
      )}
      {sinResultados && <p className="p-3 text-xs text-muted-foreground">No hay resultados para “{consulta}”.</p>}
    </>
  )
}

function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const permitido = useEnMenu()
  const consulta = query.trim()
  const modulos = permitido(NAV_ITEMS).filter((item) => normal(item.label).includes(normal(consulta)))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="topbar-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <label htmlFor="global-search" className="sr-only">Buscar clientes, departamentos y módulos</label>
      <Input ref={inputRef} id="global-search" type="search" autoComplete="off" placeholder="Buscar clientes, departamentos o módulos" value={query}
        aria-expanded={open && !!consulta} aria-controls="module-search-results"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur() } }} />
      {!query && <kbd aria-hidden="true">Ctrl K</kbd>}
      {open && consulta && (
        <div className="search-results" id="module-search-results" aria-label="Resultados de búsqueda">
          <ResultadosBusqueda consulta={consulta} modulos={modulos} cerrar={() => { setOpen(false); setQuery('') }} />
        </div>
      )}
    </div>
  )
}

/** Celular: los accesos de trabajo del perfil, según sus permisos. «Más» abre el menú completo. */
function BarraInferior() {
  const { actor, can } = useSession()
  const { isMobile, setOpenMobile } = useSidebar()
  const enlaces = barraDe(actor.rol, can)
  if (!isMobile || enlaces.length === 0) return null
  const celda = 'flex min-h-[62px] min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold'
  return (
    <nav aria-label="Accesos rápidos" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-white/95 backdrop-blur md:hidden"
      style={{ gridTemplateColumns: `repeat(${enlaces.length + 1}, minmax(0, 1fr))`, paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {enlaces.map(({ to, corto, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cn(celda, isActive ? 'text-primary' : 'text-slate-600')}>
          <Icon className="size-[22px]" aria-hidden="true" /><span className="max-w-full truncate">{corto}</span>
        </NavLink>
      ))}
      <button type="button" onClick={() => setOpenMobile(true)} className={cn(celda, 'text-slate-600')}>
        <Menu className="size-[22px]" aria-hidden="true" /><span>Más</span>
      </button>
    </nav>
  )
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const item = pathname === '/' ? NAV_ITEMS[0] : NAV_ITEMS.find((i) => i.to !== '/' && pathname.startsWith(i.to))
  const { actor, can } = useSession()
  const currentModule = item ? etiquetaDe(item, actor.rol) : 'Inicio'
  const grupo = menuLateral(actor.rol, can).find((g) => g.items.some((i) => i.to === item?.to))?.label
  const permitido = usePermitido()
  // Las rutas directas también verifican permisos (además del menú).
  // En / decide Inicio, que lleva a quien no tiene Dashboard a su primer módulo.
  const bloqueado = item && pathname !== '/' ? !permitido(item) : false
  const { remoto } = useConexion()
  return (
    <SidebarProvider className="app-sidebar" style={{ '--sidebar-width': '224px' } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="app-topbar">
          <SidebarTrigger aria-label="Abrir o cerrar menú" className="-ml-1 text-slate-500" />
          <div className="hidden items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground xl:flex">
            {grupo && <><span>{grupo}</span><ChevronRight className="size-3.5" aria-hidden="true" /></>}<span className="font-semibold text-foreground">{currentModule}</span>
          </div>
          <div className="flex min-w-0 flex-1 justify-center"><GlobalSearch /></div>
          <div className="flex shrink-0 items-center gap-3">
            {remoto ? <CuentaMenu /> : (
              <>
                <span className="demo-badge hidden sm:inline-flex" title="Los datos se guardan en este navegador hasta conectar Supabase"><i aria-hidden="true" />Modo local</span>
                <UserSwitcher />
              </>
            )}
          </div>
        </header>
        <div className="app-content">
          {bloqueado ? (
            <div className="module-empty">
              <span className="module-empty-icon"><Lock className="size-7" aria-hidden="true" /></span>
              <h2 className="text-xl font-semibold tracking-tight">Sin acceso a {currentModule}</h2>
              <p className="mt-3 max-w-sm text-sm text-muted-foreground">Tu usuario no tiene permiso para este módulo. Si lo necesitas, solicítalo al administrador.</p>
              <Button variant="outline" asChild className="mt-6"><Link to="/">Volver al inicio</Link></Button>
            </div>
          ) : <Outlet />}
        </div>
      </SidebarInset>
      <BarraInferior />
    </SidebarProvider>
  )
}
