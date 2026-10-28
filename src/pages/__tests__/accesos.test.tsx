import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import AppLayout from '@/components/AppLayout'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cambiarEstadoUsuario, actorDe, directorioInicial, fijarExcepcion, ID_ADMIN_INICIAL, invitarUsuario } from '@/features/config/service'
import { DirectorioProvider } from '@/features/config/store'

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
})

function directorioConVendedora() {
  let d = directorioInicial()
  const admin = () => actorDe(d, d.usuarios.find((u) => u.id === ID_ADMIN_INICIAL)!)
  d = invitarUsuario(d, { nombre: 'Vera Vendedora', email: 'vera@nuvarel.com', rolId: 'asesor', alcance: null, supervisorId: null, equipoId: null, proyectos: ['AMURA'] }, 'Alta de vendedora', admin()).dir
  const vera = d.usuarios.find((u) => u.email === 'vera@nuvarel.com')!
  d = cambiarEstadoUsuario(d, vera.id, 'activo', 'Aceptó la invitación', admin())
  d = fijarExcepcion(d, vera.id, 'inventario.ver', 'denegar', 'Sin acceso a inventario', admin())
  return { d, vera }
}

function renderComo(usuarioId: string, d: ReturnType<typeof directorioInicial>, url: string) {
  localStorage.setItem('amura.demo.usuario', usuarioId)
  return render(
    <DirectorioProvider initialState={d}>
      <SessionProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="inventario" element={<p>Contenido del inventario</p>} />
                <Route path="configuracion" element={<p>Contenido de configuración</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </SessionProvider>
    </DirectorioProvider>,
  )
}

describe('control de acceso por ruta', () => {
  it('una URL directa a un módulo no autorizado muestra "Sin acceso"', () => {
    const { d, vera } = directorioConVendedora()
    renderComo(vera.id, d, '/inventario')
    expect(screen.getByText('Sin acceso a Inventario')).toBeInTheDocument()
    expect(screen.queryByText('Contenido del inventario')).not.toBeInTheDocument()
  })

  it('el vendedor tampoco entra a Configuración y el menú no la muestra', () => {
    const { d, vera } = directorioConVendedora()
    renderComo(vera.id, d, '/configuracion')
    expect(screen.getByText('Sin acceso a Configuración')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Configuración/ })).not.toBeInTheDocument()
  })

  it('el administrador sí entra', () => {
    const { d } = directorioConVendedora()
    renderComo(ID_ADMIN_INICIAL, d, '/inventario')
    expect(screen.getByText('Contenido del inventario')).toBeInTheDocument()
  })
})
