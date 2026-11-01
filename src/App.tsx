import { useSession } from './app/session'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ModulePlaceholder from './pages/ModulePlaceholder'
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
const VentaPage = lazy(() => import('./pages/VentaPage'))
const ClientesPage = lazy(() => import('./pages/ClientesPage'))
const GestionComercialPage = lazy(() => import('./pages/GestionComercialPage'))
const ReservasPage = lazy(() => import('./pages/ReservasPage'))
const ConfiguracionPage = lazy(() => import('./pages/ConfiguracionPage'))
const PlanPage = lazy(() => import('./pages/PlanPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const CobranzaPage = lazy(() => import('./pages/CobranzaPage'))
const VentasPage = lazy(() => import('./pages/VentasPage'))
const ComisionesPage = lazy(() => import('./pages/ComisionesPage'))
const CorredoresPage = lazy(() => import('./pages/CorredoresPage'))
const ObraPage = lazy(() => import('./pages/ObraPage'))
const cargando = <p className="p-6 text-sm text-muted-foreground">Cargando…</p>

const CUSTOM_ROUTES = new Set(['/', '/venta', '/inventario', '/precios', '/financiamiento', '/cotizaciones', '/clientes', '/comisiones', '/corredores', '/comercial', '/reservas', '/configuracion', '/plan', '/cobranzas', '/ventas', '/obra'])

/** Cada perfil entra a su primer módulo autorizado. */
// eslint-disable-next-line react-refresh/only-export-components
export function Inicio() {
  const { can } = useSession()
  if (can('dashboard.ver')) return <DashboardPage />
  const primero = NAV_ITEMS.find((i) => i.to !== '/' && i.permisos.some((p) => can(p)))
  return primero
    ? <Navigate to={primero.to} replace />
    : <p className="p-6 text-sm text-muted-foreground">Tu perfil todavía no tiene módulos autorizados. Consulta con el administrador.</p>
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
          <Route path="inventario" element={<Suspense fallback={cargando}><InventarioPage /></Suspense>} />
          <Route path="precios" element={<Suspense fallback={cargando}><PreciosPage /></Suspense>} />
          <Route path="financiamiento" element={<Suspense fallback={cargando}><FinanciamientoPage /></Suspense>} />
          <Route path="venta" element={<Suspense fallback={cargando}><VentaPage /></Suspense>} />
          <Route path="cotizaciones" element={<Suspense fallback={cargando}><CotizacionesPage /></Suspense>} />
          <Route path="clientes" element={<Suspense fallback={cargando}><ClientesPage /></Suspense>} />
          <Route path="comercial" element={<Suspense fallback={cargando}><GestionComercialPage /></Suspense>} />
          <Route path="reservas" element={<Suspense fallback={cargando}><ReservasPage /></Suspense>} />
          <Route path="configuracion" element={<Suspense fallback={cargando}><ConfiguracionPage /></Suspense>} />
          <Route path="plan" element={<Suspense fallback={cargando}><PlanPage /></Suspense>} />
          <Route path="cobranzas" element={<Suspense fallback={cargando}><CobranzaPage /></Suspense>} />
          <Route path="ventas" element={<Suspense fallback={cargando}><VentasPage /></Suspense>} />

          <Route path="comisiones" element={<Suspense fallback={cargando}><ComisionesPage /></Suspense>} />


          <Route path="corredores" element={<Suspense fallback={cargando}><CorredoresPage /></Suspense>} />
          <Route path="obra" element={<Suspense fallback={cargando}><ObraPage /></Suspense>} />
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
