import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { can, PLANTILLAS_ROL } from '@/app/permissions'
import { NAV_ITEMS } from '@/app/navigation'
import { SessionProvider } from '@/app/session'
import { Inicio } from '@/App'

const menu = (rol: string) => NAV_ITEMS.filter((i) => i.permisos.some((p) => can(rol, p))).map((i) => i.label)

beforeEach(() => localStorage.clear())

describe('menú según el perfil', () => {
  it('hay ocho perfiles disponibles más JARVAL, que solo se conserva', () => {
    expect(PLANTILLAS_ROL.map((r) => r.nombre)).toEqual(['Administrador', 'Gerencia', 'Supervisor', 'Vendedor', 'Corredor', 'Finanzas', 'Legal', 'Constructor', 'JARVAL (consulta)'])
  })

  it('el constructor solo ve Inventario: ningún módulo comercial ni Configuración', () => {
    expect(menu('constructor')).toEqual(['Inventario', 'Avance de obra'])
    expect(can('constructor', 'inventario.ver')).toBe(false)
  })

  it('el vendedor y el corredor consultan ventas, cobranzas y comisiones, sin Configuración', () => {
    for (const rol of ['asesor', 'corredor']) {
      expect(menu(rol)).toEqual(expect.arrayContaining(['Inventario', 'Financiamiento', 'Cotizaciones', 'Clientes', 'Reservas', 'Ventas y contratos', 'Cobranzas', 'Comisiones']))
      expect(menu(rol)).not.toContain('Configuración')
      expect(menu(rol)).not.toContain('Corredores')
    }
  })

  it('el supervisor agrega corredores; finanzas y legal no venden', () => {
    expect(menu('supervisor')).toEqual(expect.arrayContaining(['Corredores', 'Cobranzas', 'Ventas y contratos']))
    expect(can('finanzas', 'cotizaciones.crear')).toBe(false)
    expect(can('legal', 'cobranzas.ver')).toBe(false)
  })
})

describe('inicio según el perfil', () => {
  const abrir = (rol: string) => render(
    <SessionProvider initialRol={rol}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/inventario" element={<p>Pantalla de inventario</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )

  it('quien no tiene Dashboard entra a su primer módulo autorizado', () => {
    abrir('constructor')
    expect(screen.getByText('Pantalla de inventario')).toBeInTheDocument()
  })

  it('un rol sin módulos recibe una explicación', () => {
    abrir('rol-sin-permisos')
    expect(screen.getByText(/no tiene módulos autorizados/)).toBeInTheDocument()
  })
})
