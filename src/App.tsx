import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ModulePlaceholder from './pages/ModulePlaceholder'
import { SessionProvider } from './app/session'
import { AuthProvider, modoRemoto, RequireAuth } from './app/auth'
import { DirectorioProvider } from './features/config/store'
import { InventoryProvider } from './features/inventario/store'
import { ClientesProvider } from './features/clientes/store'
import { ReservasProvider } from './features/reservas/store'
import { NAV_ITEMS } from './app/navigation'

// Módulos con pantalla propia; el resto muestra el marcador "en construcción".
// Inventario incluye el lector de Excel: se carga bajo demanda para aligerar el inicio.
const InventarioPage = lazy(() => import('./pages/InventarioPage'))
const PreciosPage = lazy(() => import('./pages/PreciosPage'))
const FinanciamientoPage = lazy(() => import('./pages/FinanciamientoPage'))
const CotizacionesPage = lazy(() => import('./pages/CotizacionesPage'))
const ClientesPage = lazy(() => import('./pages/ClientesPage'))
const GestionComercialPage = lazy(() => import('./pages/GestionComercialPage'))
const ReservasPage = lazy(() => import('./pages/ReservasPage'))
const ConfiguracionPage = lazy(() => import('./pages/ConfiguracionPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const cargando = <p className="p-6 text-sm text-muted-foreground">Cargando…</p>

const CUSTOM_ROUTES = new Set(['/', '/inventario', '/precios', '/financiamiento', '/cotizaciones', '/clientes', '/comercial', '/reservas', '/configuracion'])

function Modulos() {
  const placeholders = NAV_ITEMS.filter((item) => !CUSTOM_ROUTES.has(item.to))
  return (
    <InventoryProvider>
    <ClientesProvider>
    <ReservasProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventario" element={<Suspense fallback={cargando}><InventarioPage /></Suspense>} />
          <Route path="precios" element={<Suspense fallback={cargando}><PreciosPage /></Suspense>} />
          <Route path="financiamiento" element={<Suspense fallback={cargando}><FinanciamientoPage /></Suspense>} />
          <Route path="cotizaciones" element={<Suspense fallback={cargando}><CotizacionesPage /></Suspense>} />
          <Route path="clientes" element={<Suspense fallback={cargando}><ClientesPage /></Suspense>} />
          <Route path="comercial" element={<Suspense fallback={cargando}><GestionComercialPage /></Suspense>} />
          <Route path="reservas" element={<Suspense fallback={cargando}><ReservasPage /></Suspense>} />
          <Route path="configuracion" element={<Suspense fallback={cargando}><ConfiguracionPage /></Suspense>} />
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
          <SessionProvider><Modulos /></SessionProvider>
        )}
      </BrowserRouter>
    </DirectorioProvider>
  )
}
