import { useSession } from './app/session'
import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ModulePlaceholder from './pages/ModulePlaceholder'
import { AuthProvider, modoRemoto, RequireAuth } from './app/auth'
import { DirectorioProvider } from './features/config/store'
import { InventoryProvider } from './features/inventario/store'
import { ClientesProvider } from './features/clientes/store'
import { ReservasProvider } from './features/reservas/store'
import { enMenu, INICIO_CON_MAPA, inicioDelRol, NAV_ITEMS } from './app/navigation'

// Módulos con pantalla propia; el resto muestra el marcador "en construcción".
// Inventario incluye el lector de Excel: se carga bajo demanda para aligerar el inicio.
const InventarioPage = lazy(() => import('./pages/InventarioPage'))
const PreciosPage = lazy(() => import('./pages/PreciosPage'))
const FinanciamientoPage = lazy(() => import('./pages/FinanciamientoPage'))
const CotizacionesPage = lazy(() => import('./pages/CotizacionesPage'))
const VentaPage = lazy(() => import('./pages/VentaPage'))
const ClientesPage = lazy(() => import('./pages/ClientesPage'))
const ReservasPage = lazy(() => import('./pages/ReservasPage'))
const ConfiguracionPage = lazy(() => import('./pages/ConfiguracionPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const CobranzaPage = lazy(() => import('./pages/CobranzaPage'))
const VentasPage = lazy(() => import('./pages/VentasPage'))
const ComisionesPage = lazy(() => import('./pages/ComisionesPage'))
const CorredoresPage = lazy(() => import('./pages/CorredoresPage'))
const ObraPage = lazy(() => import('./pages/ObraPage'))
const PagosPorVerificarPage = lazy(() => import('./pages/PagosPorVerificarPage'))
const BandejaCumplimientoPage = lazy(() => import('./pages/BandejaCumplimientoPage'))
const EquipoPage = lazy(() => import('./pages/EquipoPage'))
const DashboardFinancieroPage = lazy(() => import('./pages/DashboardFinancieroPage'))
const cargando = <p className="p-6 text-sm text-muted-foreground">Cargando…</p>

const CUSTOM_ROUTES = new Set(['/', '/venta', '/inventario', '/precios', '/financiamiento', '/cotizaciones', '/clientes', '/comisiones', '/corredores', '/comercial', '/reservas', '/configuracion', '/plan', '/cobranzas', '/ventas', '/obra', '/pagos-por-verificar', '/finanzas', '/cumplimiento', '/equipo', '/mi-equipo'])

/** Cada perfil entra a su primer módulo autorizado. */
// eslint-disable-next-line react-refresh/only-export-components
export function Inicio() {
  const { can, actor } = useSession()
  // Un rol con menú propio entra a su primera pantalla (p. ej. Finanzas, a su Dashboard financiero).
  if (INICIO_CON_MAPA.includes(actor.rol) && can('inventario.ver')) return <DashboardPage />
  const propio = inicioDelRol(actor.rol)
  if (propio && propio !== '/') return <Navigate to={propio} replace />
  if (can('dashboard.ver')) return <DashboardPage />
  const primero = NAV_ITEMS.find((i) => i.to !== '/' && enMenu(i, actor.rol, can))
  return primero
    ? <Navigate to={primero.to} replace />
    : <p className="p-6 text-sm text-muted-foreground">Tu perfil todavía no tiene módulos autorizados. Consulta con el administrador.</p>
}

/** Una pantalla del menú solo se abre con alguno de sus permisos; si no, la persona va a su inicio. */
// eslint-disable-next-line react-refresh/only-export-components
export function Permitida({ to, children }: { to: string; children: ReactNode }) {
  const { can } = useSession()
  const item = NAV_ITEMS.find((i) => i.to === to)
  return item && !item.permisos.some((p) => can(p)) ? <Navigate to="/" replace /> : <Suspense fallback={cargando}>{children}</Suspense>
}

function Modulos() {
  const placeholders = NAV_ITEMS.filter((item) => !CUSTOM_ROUTES.has(item.to))
  return (
    <InventoryProvider>
    <ClientesProvider>
    <ReservasProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Inicio />} />
          <Route path="inventario" element={<Permitida to="/inventario"><InventarioPage /></Permitida>} />
          <Route path="precios" element={<Permitida to="/precios"><PreciosPage /></Permitida>} />
          <Route path="financiamiento" element={<Permitida to="/financiamiento"><FinanciamientoPage /></Permitida>} />
          <Route path="venta" element={<Permitida to="/venta"><VentaPage /></Permitida>} />
          <Route path="cotizaciones" element={<Permitida to="/cotizaciones"><CotizacionesPage /></Permitida>} />
          <Route path="clientes" element={<Permitida to="/clientes"><ClientesPage /></Permitida>} />
          {/* Pipeline vive ahora en Clientes, vista Embudo: los enlaces antiguos siguen funcionando. */}
          <Route path="comercial" element={<Navigate to="/clientes?vista=embudo" replace />} />
          <Route path="reservas" element={<Permitida to="/reservas"><ReservasPage /></Permitida>} />
          <Route path="configuracion" element={<Permitida to="/configuracion"><ConfiguracionPage /></Permitida>} />
          <Route path="plan" element={<Permitida to="/plan"><PlanPage /></Permitida>} />
          <Route path="cobranzas" element={<Permitida to="/cobranzas"><CobranzaPage /></Permitida>} />
          <Route path="equipo" element={<Permitida to="/equipo"><EquipoPage vista="dashboard" /></Permitida>} />
          <Route path="mi-equipo" element={<Permitida to="/mi-equipo"><EquipoPage vista="detalle" /></Permitida>} />
          <Route path="cumplimiento" element={<Permitida to="/cumplimiento"><BandejaCumplimientoPage /></Permitida>} />
          <Route path="pagos-por-verificar" element={<Permitida to="/pagos-por-verificar"><PagosPorVerificarPage /></Permitida>} />
          <Route path="finanzas" element={<Permitida to="/finanzas"><DashboardFinancieroPage /></Permitida>} />
          <Route path="ventas" element={<Permitida to="/ventas"><VentasPage /></Permitida>} />

          <Route path="comisiones" element={<Permitida to="/comisiones"><ComisionesPage /></Permitida>} />


          <Route path="corredores" element={<Permitida to="/corredores"><CorredoresPage /></Permitida>} />
          <Route path="obra" element={<Permitida to="/obra"><ObraPage /></Permitida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
          {placeholders.map((item) => (
            <Route
              key={item.to}
              path={item.to.slice(1)}
              element={<ModulePlaceholder title={item.label} />}
            />
          ))}
        </Route>
      </Routes>
    </ReservasProvider>
    </ClientesProvider>
    </InventoryProvider>
  )
}

export default function App() {
  return (
    <DirectorioProvider>
      <BrowserRouter>
        {modoRemoto ? (
          // Con Supabase configurado: /login es la única ruta pública; el resto exige sesión y perfil activo.
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Suspense fallback={cargando}><LoginPage /></Suspense>} />
              <Route path="/*" element={<RequireAuth><Modulos /></RequireAuth>} />
            </Routes>
          </AuthProvider>
        ) : (
          // Todos los datos viven en Supabase: sin conexión configurada no hay aplicación que mostrar.
          <p role="alert" className="p-6 text-sm text-rose-700">AMURA necesita conexión con la base de datos. Falta configurar Supabase en esta publicación.</p>
        )}
      </BrowserRouter>
    </DirectorioProvider>
  )
}
