import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronRight, CloudOff, Lock, LogOut, Search, Settings, X } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { NAV_GROUPS, NAV_ITEMS, type NavItem } from '@/app/navigation'
import { rolLabel } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDirectorio } from '@/features/config/store'
import { useConexion } from '@/app/auth'

/** Módulos que ya trabajan con datos compartidos en Supabase. Los demás todavía guardan en este navegador. */
const CONECTADOS = ['/plan', '/configuracion', '/inventario', '/precios', '/cobranzas', '/financiamiento', '/clientes', '/comercial', '/cotizaciones', '/reservas', '/ventas']

function CuentaMenu() {
  const { cuenta, salir } = useConexion()
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-48 truncate text-[11px] text-muted-foreground sm:inline" title={cuenta?.email}>{cuenta?.nombre} · {cuenta?.rolNombre}</span>
      <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => void salir()}><LogOut />Salir</Button>
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
      <SelectTrigger size="sm" className="h-8 max-w-56 text-[11px]" aria-label="Trabajar como (modo demostración)" title="Modo demostración: elige el usuario con el que trabajas">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {activos.map((u) => <SelectItem key={u.id} value={u.id}>{u.nombre} · {rolLabel(u.rolId)}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function usePermitido() {
  const { can } = useSession()
  return (item: NavItem) => item.permisos.some((p) => can(p))
}

function AppSidebar() {
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const permitido = usePermitido()
  const { actor } = useSession()
  const { remoto } = useConexion()
  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarHeader className="relative px-[18px] pt-5 pb-2 group-data-[collapsible=icon]:p-2">
        {isMobile && <button type="button" aria-label="Cerrar menú" onClick={() => setOpenMobile(false)} className="absolute right-6 top-6 rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>}
        <Link to="/" aria-label="AMURA · Inicio" onClick={() => { if (isMobile) setOpenMobile(false) }} className="brand-panel group-data-[collapsible=icon]:min-h-9 group-data-[collapsible=icon]:rounded-md">
          <img src="/brand/logo-amura.png" alt="AMURA Apartments" className="group-data-[collapsible=icon]:h-6 group-data-[collapsible=icon]:w-7" />
        </Link>
        <div className="workspace-label group-data-[collapsible=icon]:hidden">
          <span><i aria-hidden="true" />Espacio comercial</span>
          <span className="text-[8px] tracking-wider text-[#7e90b2]">AMURA</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(permitido) })).filter((g) => g.items.length).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <NavLink to={item.to} end={item.to === '/'} onClick={() => { if (isMobile) setOpenMobile(false) }}>
                          <Icon aria-hidden="true" /><span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-5 pb-5 pt-2 group-data-[collapsible=icon]:p-2">
        <Link to="/configuracion" className="sidebar-profile group-data-[collapsible=icon]:justify-center" onClick={() => { if (isMobile) setOpenMobile(false) }}>
          <span className="profile-avatar group-data-[collapsible=icon]:size-8">AM</span>
          <span className="flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[11px] font-medium text-[#e2e9f6]">{actor.nombre}</span>
            <span className="block mt-1 text-[9px] text-[#91a2c1]">{rolLabel(actor.rol)}{remoto ? '' : ' · modo demostración'}</span>
          </span>
          <Settings className="size-3.5 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
        </Link>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const permitido = usePermitido()
  const matches = NAV_ITEMS.filter(permitido).filter((item) => normalize(item.label).includes(normalize(query.trim())))
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
      <Search className="pointer-events-none absolute left-1 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <label htmlFor="global-search" className="sr-only">Buscar módulos</label>
      <Input ref={inputRef} id="global-search" type="search" autoComplete="off" placeholder="Buscar en tu espacio de trabajo..." value={query}
        aria-expanded={open && !!query.trim()} aria-controls="module-search-results"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); inputRef.current?.blur() } }} />
      {open && query.trim() && (
        <div className="search-results" id="module-search-results" aria-label="Resultados de búsqueda">
          {matches.length ? matches.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} onClick={() => { setOpen(false); setQuery('') }}><Icon className="size-4 text-primary" />{label}<ChevronRight className="ml-auto size-3" /></Link>
          )) : <p className="p-3 text-xs text-muted-foreground">No hay módulos para “{query}”.</p>}
        </div>
      )}
    </div>
  )
}

export default function AppLayout() {
  const { pathname } = useLocation()
  const item = pathname === '/' ? NAV_ITEMS[0] : NAV_ITEMS.find((i) => i.to !== '/' && pathname.startsWith(i.to))
  const currentModule = item?.label ?? 'Inicio'
  const permitido = usePermitido()
  // Las rutas directas también verifican permisos (además del menú).
  const bloqueado = item ? !permitido(item) : false
  const { remoto } = useConexion()
  const local = remoto && !CONECTADOS.some((r) => pathname.startsWith(r))
  return (
    <SidebarProvider className="app-sidebar" style={{ '--sidebar-width': '236px' } as React.CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="app-topbar">
          <SidebarTrigger aria-label="Abrir o cerrar menú" className="-ml-1 text-[#7b89a1]" />
          <div className="hidden items-center gap-2 border-r border-border pr-5 text-[11px] text-muted-foreground xl:flex">
            <span>Espacio de trabajo</span><ChevronRight className="size-3" /><span className="font-medium text-foreground">{currentModule}</span>
          </div>
          <GlobalSearch />
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {remoto ? <CuentaMenu /> : (
              <>
                <span className="demo-badge hidden sm:inline-flex" title="Los datos se guardan en este navegador hasta conectar Supabase"><i aria-hidden="true" />Modo local</span>
                <UserSwitcher />
              </>
            )}
          </div>
        </header>
        <div className="app-content">
          {local && !bloqueado && (
            <p role="note" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Este módulo todavía guarda sus datos en este navegador: otros usuarios no los ven. Su conexión con Supabase está pendiente.
            </p>
          )}
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
    </SidebarProvider>
  )
}
