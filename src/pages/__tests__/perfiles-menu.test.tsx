import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { can, PLANTILLAS_ROL } from '@/app/permissions'
import { barraDe, enMenu, etiquetaDe, inicioDelRol, menuLateral, MENU_POR_ROL, NAV_GROUPS, NAV_ITEMS, trabajoDe } from '@/app/navigation'
import { SessionProvider } from '@/app/session'
import { Inicio, Permitida } from '@/App'

const menu = (rol: string) => NAV_ITEMS.filter((i) => i.permisos.some((p) => can(rol, p))).map((i) => i.label)
/** Lo que ve en la barra lateral, en el orden de la barra. */
const lateral = (rol: string) => NAV_GROUPS.flatMap((g) => g.items).filter((i) => enMenu(i, rol, (p) => can(rol, p))).map((i) => i.label)

beforeEach(() => localStorage.clear())

describe('menú según el perfil', () => {
  it('hay nueve perfiles disponibles más JARVAL, que solo se conserva', () => {
    expect(PLANTILLAS_ROL.map((r) => r.nombre)).toEqual(['Administrador', 'Gerencia', 'Supervisor', 'Vendedor', 'Corredor', 'Finanzas', 'Legal', 'Oficial de Cumplimiento', 'Constructor', 'JARVAL (consulta)'])
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

describe('menú lateral por rol (separado de los permisos)', () => {
  it('Finanzas ve solo sus cinco módulos, aunque conserva sus permisos de lectura', () => {
    expect(lateral('finanzas')).toEqual(['Dashboard financiero', 'Ventas y contratos', 'Pagos por verificar', 'Cobranzas', 'Comisiones'])
    // Ocultar no quita permisos: Cobranzas sigue leyendo clientes e inventario.
    expect(can('finanzas', 'clientes.ver')).toBe(true)
    expect(can('finanzas', 'inventario.ver')).toBe(true)
  })

  it('Reportes y Centro de recursos no aparecen para nadie mientras no estén desarrollados', () => {
    for (const r of PLANTILLAS_ROL) {
      expect(lateral(r.id)).not.toContain('Reportes')
      expect(lateral(r.id)).not.toContain('Centro de recursos')
    }
  })

  it('administración también ve la bandeja de pagos (puede ser el segundo aprobador)', () => {
    expect(lateral('administrador')).toEqual(expect.arrayContaining(['Pagos por verificar', 'Dashboard financiero', 'Bandeja de Cumplimiento', 'Configuración']))
  })

  it('Vendedor y Corredor: herramientas comerciales y sus comisiones; sin Plan, Precios, Obra, Ventas ni Cobranzas', () => {
    for (const rol of ['asesor', 'corredor']) {
      expect(lateral(rol)).toEqual(['Dashboard', 'Atender cliente', 'Clientes', 'Pipeline', 'Cotizaciones', 'Reservas', 'Inventario', 'Financiamiento', 'Comisiones'])
      // Ocultar no bloquea su operación: siguen pudiendo abrir el contrato y el estado de cuenta de sus clientes desde la venta.
      for (const p of ['ventas.ver', 'cobranzas.ver', 'reservas.solicitar', 'comisiones.ver_propias'] as const) expect(can(rol, p)).toBe(true)
      for (const p of ['comisiones.calcular', 'comisiones.aprobar', 'comisiones.finanzas'] as const) expect(can(rol, p)).toBe(false)
    }
  })

  it('Supervisor: vende con las herramientas del vendedor y gestiona a su equipo; entra a su Dashboard de equipo', () => {
    const visibles = NAV_GROUPS.flatMap((g) => g.items).filter((i) => enMenu(i, 'supervisor', (p) => can('supervisor', p))).map((i) => etiquetaDe(i, 'supervisor'))
    expect(visibles).toEqual(expect.arrayContaining(['Dashboard de equipo', 'Mi equipo', 'Atender cliente', 'Inventario', 'Financiamiento', 'Cotizaciones', 'Clientes (míos y del equipo)', 'Pipeline', 'Reservas', 'Ventas y contratos', 'Comisiones']))
    expect(visibles).toHaveLength(11)
    // Todo lo que ve el vendedor, salvo su Dashboard individual (el Supervisor tiene el suyo).
    const vendedor = NAV_GROUPS.flatMap((g) => g.items).filter((i) => enMenu(i, 'asesor', (p) => can('asesor', p))).map((i) => i.to)
    expect(vendedor.filter((to) => to !== '/' && !NAV_ITEMS.some((i) => i.to === to && enMenu(i, 'supervisor', (p) => can('supervisor', p))))).toEqual([])
    expect(inicioDelRol('supervisor')).toBe('/equipo')
    for (const p of ['clientes.asignar', 'reservas.solicitar', 'ventas.ver', 'cobranzas.ver', 'ventas.desistimiento_autorizar'] as const) expect(can('supervisor', p)).toBe(true)
    expect(etiquetaDe(NAV_ITEMS.find((i) => i.to === '/clientes')!, 'asesor')).toBe('Clientes')
  })

  it('Gerencia conserva Atender cliente y Financiamiento', () => {
    expect(lateral('gerencia')).toEqual(expect.arrayContaining(['Dashboard', 'Atender cliente', 'Financiamiento', 'Precios', 'Ventas y contratos', 'Cobranzas', 'Avance de obra', 'Configuración']))
  })

  it('Legal, Oficial y Constructor ven solo lo de su responsabilidad', () => {
    expect(lateral('legal')).toEqual(['Clientes', 'Reservas', 'Ventas y contratos'])
    expect(lateral('oficial_cumplimiento')).toEqual(['Clientes', 'Ventas y contratos', 'Bandeja de Cumplimiento'])
    expect(lateral('constructor')).toEqual(['Inventario', 'Avance de obra'])
  })

  it('cada menú solo lista módulos que el rol puede abrir, y su inicio está en su menú', () => {
    for (const [rol, rutas] of Object.entries(MENU_POR_ROL)) {
      const visibles = NAV_ITEMS.filter((i) => enMenu(i, rol, (p) => can(rol, p))).map((i) => i.to)
      expect(rutas!.filter((r) => !visibles.includes(r)), rol).toEqual([])
      expect(visibles, rol).toContain(inicioDelRol(rol))
    }
  })
})

describe('menú compacto: «Trabajo» primero, el resto en grupos plegables', () => {
  const ve = (rol: string) => (p: Parameters<typeof can>[1]) => can(rol, p)

  it('Vendedor y Corredor trabajan con su día, clientes, atención, reservas y cotizaciones', () => {
    for (const rol of ['asesor', 'corredor']) {
      expect(trabajoDe(rol, ve(rol)).map((i) => etiquetaDe(i, rol))).toEqual(['Mi día', 'Clientes', 'Atender cliente', 'Reservas', 'Cotizaciones'])
      expect(barraDe(rol, ve(rol)).map((b) => b.corto)).toEqual(['Mi día', 'Clientes', 'Atender', 'Reservas'])
    }
  })

  it('el Supervisor entra a su Dashboard de equipo y conserva sus herramientas de venta', () => {
    expect(trabajoDe('supervisor', ve('supervisor')).map((i) => i.to)).toEqual(['/equipo', '/clientes', '/venta', '/reservas', '/comercial'])
    expect(barraDe('supervisor', ve('supervisor')).map((b) => b.corto)).toEqual(['Equipo', 'Clientes', 'Atender', 'Reservas'])
  })

  it('todos los perfiles tienen barra inferior en el celular, adaptada a sus permisos', () => {
    expect(barraDe('finanzas', ve('finanzas')).map((b) => b.to)).toEqual(['/finanzas', '/pagos-por-verificar', '/cobranzas', '/ventas'])
    expect(barraDe('constructor', ve('constructor')).map((b) => b.to)).toEqual(['/obra', '/inventario'])
    expect(barraDe('administrador', ve('administrador')).map((b) => b.corto)).toEqual(['Inicio', 'Clientes', 'Reservas', 'Pipeline'])
  })

  it('el menú lateral muestra cada módulo visible una sola vez y no agrega nada a lo que el perfil ya ve', () => {
    for (const r of PLANTILLAS_ROL) {
      const grupos = menuLateral(r.id, ve(r.id))
      expect(grupos[0].trabajo).toBe(true)
      const enGrupos = grupos.flatMap((g) => g.items.map((i) => i.to))
      expect(new Set(enGrupos).size, r.id).toBe(enGrupos.length)
      expect([...enGrupos].sort(), r.id).toEqual(NAV_ITEMS.filter((i) => enMenu(i, r.id, ve(r.id))).map((i) => i.to).sort())
    }
  })
})

describe('inicio según el perfil', () => {
  const abrir = (rol: string, url = '/') => render(
    <SessionProvider initialRol={rol}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route path="/venta" element={<Permitida to="/venta"><p>Atender cliente</p></Permitida>} />
          <Route path="/inventario" element={<p>Pantalla de inventario</p>} />
          <Route path="/obra" element={<p>Pantalla de obra</p>} />
          <Route path="/ventas" element={<p>Pantalla de ventas</p>} />
          <Route path="/cumplimiento" element={<p>Bandeja de cumplimiento</p>} />
          <Route path="/pagos-por-verificar" element={<p>Bandeja de pagos por verificar</p>} />
          <Route path="/finanzas" element={<p>Dashboard financiero</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )

  it('cada perfil entra a su pantalla: Constructor a Avance de obra, Legal a Ventas y contratos, Oficial a su bandeja', () => {
    for (const [rol, texto] of [['constructor', 'Pantalla de obra'], ['legal', 'Pantalla de ventas'], ['oficial_cumplimiento', 'Bandeja de cumplimiento']]) {
      const r = abrir(rol)
      expect(screen.getByText(texto)).toBeInTheDocument()
      r.unmount()
    }
  })

  it('Vendedor, Corredor, Supervisor, Gerencia y JARVAL entran al Dashboard', () => {
    for (const rol of ['asesor', 'corredor', 'gerencia', 'jarval']) expect(inicioDelRol(rol), rol).toBe('/')
    expect(inicioDelRol('supervisor')).toBe('/equipo')
  })

  it('Finanzas entra directo a su Dashboard financiero', () => {
    abrir('finanzas')
    expect(screen.getByText('Dashboard financiero')).toBeInTheDocument()
  })

  it('quien entra a una pantalla que no le corresponde (p. ej. la última del usuario anterior) va a su propio inicio', () => {
    for (const [rol, texto] of [['finanzas', 'Dashboard financiero'], ['oficial_cumplimiento', 'Bandeja de cumplimiento'], ['legal', 'Pantalla de ventas']]) {
      const r = abrir(rol, '/venta')
      expect(screen.getByText(texto)).toBeInTheDocument()
      expect(screen.queryByText('Atender cliente')).toBeNull()
      r.unmount()
    }
  })

  it('un rol sin módulos recibe una explicación', () => {
    abrir('rol-sin-permisos')
    expect(screen.getByText(/no tiene módulos autorizados/)).toBeInTheDocument()
  })
})
