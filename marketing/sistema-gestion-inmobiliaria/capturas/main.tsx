import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import '@/index.css'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import AppLayout from '@/components/AppLayout'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ClientesProvider } from '@/features/clientes/store'
import { ErrorDatos, type ConsultaOpciones, type Datos } from '@/features/conexion/datos'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import CobranzaPage from '@/pages/CobranzaPage'
import ConfiguracionPage from '@/pages/ConfiguracionPage'
import CotizacionesPage from '@/pages/CotizacionesPage'
import DashboardPage from '@/pages/DashboardPage'
import EquipoPage from '@/pages/EquipoPage'
import FinanciamientoPage from '@/pages/FinanciamientoPage'
import GestionComercialPage from '@/pages/GestionComercialPage'
import InventarioPage from '@/pages/InventarioPage'
import ObraPage from '@/pages/ObraPage'
import PlanPage from '@/pages/PlanPage'
import PreciosPage from '@/pages/PreciosPage'
import ReservasPage from '@/pages/ReservasPage'
import VentaPage from '@/pages/VentaPage'
import VentasPage from '@/pages/VentasPage'

// Las pantallas reales del producto, leyendo de la base demostrativa en memoria (servidor-demo.mjs).
// ?perfil=vendedor1 | supervisora | finanzas | gerente | obra: la misma base vista por cada perfil (sin ?perfil, administración).
const perfil = new URLSearchParams(location.search).get('perfil') ?? undefined
const pedir = async (cuerpo: Record<string, unknown>) => {
  const { r, error } = await (await fetch('/demo-api', { method: 'POST', body: JSON.stringify({ ...cuerpo, perfil }) })).json()
  if (error) throw new ErrorDatos(error)
  return r
}
const datos = {
  rpc: (fn: string, args?: Record<string, unknown>) => pedir({ op: 'rpc', fn, args }),
  select: (tabla: string, opts?: ConsultaOpciones) => pedir({ op: 'select', tabla, opts }),
  insert: async () => { throw new ErrorDatos('Solo lectura en la demostración.') },
  update: async () => { throw new ErrorDatos('Solo lectura en la demostración.') },
} as unknown as Datos

const s = await pedir({ op: 'sesion' })
const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance }, proyectos: s.proyectos }

createRoot(document.getElementById('root')!).render(
  <ConexionProvider value={{ remoto: true, datos, cuenta: null, salir: async () => {} }}>
    <SessionProvider actorRemoto={actor}>
      <HashRouter><TooltipProvider>
        <InventoryProvider><ClientesProvider><ReservasProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="inventario" element={<InventarioPage />} />
              <Route path="precios" element={<PreciosPage />} />
              <Route path="financiamiento" element={<FinanciamientoPage />} />
              <Route path="venta" element={<VentaPage />} />
              <Route path="cotizaciones" element={<CotizacionesPage />} />
              <Route path="clientes" element={<ClientesPage />} />
              <Route path="comercial" element={<GestionComercialPage />} />
              <Route path="reservas" element={<ReservasPage />} />
              <Route path="ventas" element={<VentasPage />} />
              <Route path="cobranzas" element={<CobranzaPage />} />
              <Route path="configuracion" element={<ConfiguracionPage />} />
              <Route path="obra" element={<ObraPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="equipo" element={<EquipoPage vista="dashboard" />} />
              <Route path="mi-equipo" element={<EquipoPage vista="detalle" />} />
            </Route>
          </Routes>
        </ReservasProvider></ClientesProvider></InventoryProvider>
      </TooltipProvider></HashRouter>
    </SessionProvider>
  </ConexionProvider>,
)
