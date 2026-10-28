import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bell, ChevronDown, ChevronRight, Search, Settings, X } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NAV_GROUPS, NAV_ITEMS } from '@/app/navigation'
import { ROLES } from '@/app/permissions'
import { useSession } from '@/app/session'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Rol } from '@/features/inventario/types'

function RoleSwitcher() {
  const { actor, setRol } = useSession()
  return (
    <Select value={actor.rol} onValueChange={(v) => setRol(v as Rol)}>
      <SelectTrigger size="sm" className="h-8 text-[11px]" aria-label="Rol de demostración" title="Rol de demostración para probar permisos">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {(Object.keys(ROLES) as Rol[]).map((r) => <SelectItem key={r} value={r}>{ROLES[r].label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function AppSidebar() {
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
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
        {NAV_GROUPS.map((group) => (
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
            <span className="block text-[11px] font-medium text-[#e2e9f6]">Equipo AMURA</span>
            <span className="block mt-1 text-[9px] text-[#91a2c1]">Entorno de demostración</span>
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
  const matches = NAV_ITEMS.filter((item) => normalize(item.label).includes(normalize(query.trim())))
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
  const currentModule = NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to))?.label ?? 'Inicio'
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
            <span className="demo-badge hidden sm:inline-flex"><i aria-hidden="true" />Datos demo</span>
            <RoleSwitcher />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground" aria-label="Ver 4 alertas de demostración"><Bell className="size-4" /><span className="notification-dot" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Alertas · Demostración</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link to="/reservas">Depósito de reserva por verificar</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/cobranzas">Cuota de entrada vencida</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/cotizaciones">Cotización próxima a vencer</Link></DropdownMenuItem>
                <DropdownMenuItem asChild><Link to="/configuracion">Lista de precios por confirmar</Link></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Link to="/configuracion" aria-label="Configuración del equipo" className="flex items-center gap-2 border-l border-border pl-3">
              <span className="profile-avatar size-8 rounded-full text-[10px]">AM</span><ChevronDown className="hidden size-3 text-muted-foreground sm:block" />
            </Link>
          </div>
        </header>
        <div className="app-content"><Outlet /></div>
      </SidebarInset>
    </SidebarProvider>
  )
}
