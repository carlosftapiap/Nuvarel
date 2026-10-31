import { describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SessionProvider } from '@/app/session'
import { ConexionProvider } from '@/app/auth'
import type { Datos } from '@/features/conexion/datos'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import type { InventoryState } from '@/features/inventario/types'
import { InventoryProvider } from '@/features/inventario/store'
import DashboardPage from '@/pages/DashboardPage'
import { ENTRADA_VACIA } from '../datos'
import { calcularPanel, type ContratoPanel, type EntradaPanel } from '../panel'

const HOY = '2026-11-10'
/** Como producción: 5 disponibles y el resto por confirmar. */
const inicial = (): InventoryState => { const e = createInitialState(); return { ...e, units: e.units.map((u, i) => (i < e.units.length - 5 ? { ...u, estado: 'por_confirmar' as const } : u)) } }
const contrato = (id: string, unidad: string, estado: ContratoPanel['estado'], precio: number, extra: Partial<ContratoPanel> = {}): ContratoPanel => ({
  id, codigo: id, clientId: 'c', cliente: '', unidad, edificio: unidad.startsWith('E2') ? 2 : 1, responsable: '', estado, precio, reservaId: `r-${id}`, fechaFirma: null, ...extra,
})
const cuota = (contratoId: string, numero: number, vencimiento: string, monto: number) => ({ contratoId, numero, concepto: `Cuota ${numero}`, vencimiento, vencimientoOriginal: vencimiento, monto })
const pago = (id: string, contratoId: string, monto: number, estado: 'registrado' | 'verificado' | 'rechazado' | 'anulado', fecha = '2026-10-05') =>
  ({ id, contratoId, monto, fecha, referencia: id, estado, registradoPor: 'u', registradoEn: fecha, comprobante: null, motivo: null })

const entrada: EntradaPanel = {
  ...ENTRADA_VACIA,
  clientes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  oportunidades: [{ clienteId: 'a', unidad: 'E1-PB-A1' }, { clienteId: 'b', unidad: 'E2-PB-A1' }, { clienteId: 'b', unidad: 'E2-PA1-A2' }],
  cotizaciones: [{ unidad: 'E1-PB-A1', estado: 'emitida' }, { unidad: 'E2-PB-A1', estado: 'aceptada' }, { unidad: 'E2-PB-A1', estado: 'anulada' }],
  reservas: [
    { id: 'r1', unidad: 'E1-PB-A2', estado: 'confirmada', vigenciaHasta: '2026-11-11' },
    { id: 'r-k1', unidad: 'E1-PB-A1', estado: 'confirmada', vigenciaHasta: '2026-11-11' },
    { id: 'r3', unidad: 'E2-PB-A1', estado: 'solicitada', vigenciaHasta: '2026-12-30' },
    { id: 'r4', unidad: 'E2-PB-A3', estado: 'anulada', vigenciaHasta: '2026-11-01' },
  ],
  contratos: [contrato('k1', 'E1-PB-A1', 'firmado', 100_000, { fechaFirma: '2026-10-02' }), contrato('k2', 'E2-PB-A1', 'borrador', 80_000), contrato('k3', 'E1-PB-A9', 'anulado', 50_000)],
  cuotas: [cuota('k1', 1, '2026-10-30', 1000), cuota('k1', 2, '2026-12-30', 1000), cuota('k2', 1, '2026-12-30', 800)],
  pagos: [pago('p1', 'k1', 1500, 'verificado'), pago('p2', 'k1', 700, 'registrado'), pago('p3', 'k3', 400, 'verificado'), pago('p4', 'k1', 90, 'rechazado')],
}

describe('cálculos del panel', () => {
  it('suma solo contratos firmados, pagos verificados y cuotas reales', () => {
    const p = calcularPanel(entrada, 'todos', HOY)
    expect(p).toMatchObject({ clientes: 3, contratosFirmados: 1, ventasFirmadas: 100_000, cobrosConfirmados: 1500, saldoPendiente: 500, contratosPendientesFirma: 1, comprobantesPendientes: 1 })
    expect(p.cuotasVencidas).toEqual({ cuotas: 0, contratos: 0, monto: 0 })
  })

  it('una cuota vencida sin cubrir se informa; la anulada y el contrato en borrador no cuentan', () => {
    const p = calcularPanel({ ...entrada, pagos: [] }, 'todos', HOY)
    expect(p.cuotasVencidas).toEqual({ cuotas: 1, contratos: 1, monto: 1000 })
    expect(p.cobrosConfirmados).toBe(0)
    expect(p.saldoPendiente).toBe(2000)
  })

  it('las reservas con contrato o anuladas no cuentan; las que vencen pronto se avisan', () => {
    const p = calcularPanel(entrada, 'todos', HOY)
    expect(p.reservasActivas).toBe(2)
    expect(p.reservasPorVencer).toEqual([{ id: 'r1', unidad: 'E1-PB-A2', dias: 1 }])
  })

  it('el filtro por edificio separa reservas, contratos, cobros, cotizaciones y clientes con interés', () => {
    const e2 = calcularPanel(entrada, 2, HOY)
    expect(e2).toMatchObject({ clientes: 1, reservasActivas: 1, contratosFirmados: 0, ventasFirmadas: 0, cobrosConfirmados: 0, contratosPendientesFirma: 1 })
    expect(e2.embudo.map((x) => x.valor)).toEqual([1, 1, 1, 0])
    expect(calcularPanel(entrada, 1, HOY)).toMatchObject({ clientes: 1, contratosFirmados: 1, ventasFirmadas: 100_000 })
  })

  it('agrupa ventas por mes de firma y cobros por mes de pago', () => {
    expect(calcularPanel(entrada, 'todos', HOY).meses).toEqual([{ mes: '2026-10', ventas: 100_000, cobros: 1500 }])
  })

  it('sin acceso es null, no cero', () => {
    const p = calcularPanel(ENTRADA_VACIA, 'todos', HOY)
    expect(p).toMatchObject({ clientes: null, reservasActivas: null, contratosFirmados: null, ventasFirmadas: null, cobrosConfirmados: null, saldoPendiente: null, cuotasVencidas: null, reservasPorVencer: null, contratosPendientesFirma: null })
    expect(p.embudo.every((x) => x.valor === null)).toBe(true)
    expect(p.meses).toEqual([])
  })
})

describe('cartera, mora y reservas por estado', () => {
  it('reparte la cartera, agrupa la mora por tramo y cuenta reservas por etapa', () => {
    const p = calcularPanel(entrada, 'todos', HOY)
    expect(p.cartera).toMatchObject({ pactado: 2000, cobrado: 1500, vencido: 0 })
    expect(p.cartera!.saldo).toBe(500)
    expect(p.reservasPorEstado).toEqual(expect.arrayContaining([{ estado: 'confirmada', cantidad: 1 }, { estado: 'solicitada', cantidad: 1 }]))
    expect(p.mora!.map((m) => m.id)).toEqual(['1-7', '8-15', '16-30', '31-60', '60+'])
  })

  it('sin acceso a cobranzas la cartera y la mora son null', () => {
    const p = calcularPanel(ENTRADA_VACIA, 'todos', HOY)
    expect(p.cartera).toBeNull()
    expect(p.mora).toBeNull()
    expect(p.reservasPorEstado).toBeNull()
  })
})

describe('pantalla del dashboard', () => {
  const fila = (tabla: string): Record<string, unknown>[] => ({
    clients: [{ id: 'a' }, { id: 'b' }],
    opportunities: [],
    quotes: [],
    reservations: [],
    contracts: [],
    installments: [],
    payments: [],
    contract_templates: [{ id: 't1' }, { id: 't2' }],
    desistimientos: [],
    medios_proyecto: [
      { id: 'm1', tipo: 'video', titulo: 'Video promocional de AMURA', descripcion: '', en_dashboard: true, en_venta: true, destacado: false, orden: 1, activo: true, version_vigente: 'v1', eliminado_en: null, actualizado_en: '2026-10-31', actualizado_por: null },
      { id: 'm2', tipo: 'imagen', titulo: 'Torres AMURA', descripcion: '', en_dashboard: true, en_venta: true, destacado: true, orden: 2, activo: true, version_vigente: 'v2', eliminado_en: null, actualizado_en: '2026-10-31', actualizado_por: null },
      { id: 'm3', tipo: 'imagen', titulo: 'Sala y comedor', descripcion: '', en_dashboard: true, en_venta: true, destacado: false, orden: 3, activo: true, version_vigente: 'v3', eliminado_en: null, actualizado_en: '2026-10-31', actualizado_por: null },
      { id: 'm4', tipo: 'imagen', titulo: 'Dormitorio', descripcion: '', en_dashboard: true, en_venta: true, destacado: false, orden: 4, activo: true, version_vigente: 'v4', eliminado_en: null, actualizado_en: '2026-10-31', actualizado_por: null },
    ],
    medio_versiones: [
      { id: 'v1', medio_id: 'm1', numero: 1, ruta: '/media/video-horizontal.mp4', ruta_vertical: '/media/video-vertical.mp4', miniatura_ruta: '/media/portada-horizontal.webp', mime: 'video/mp4', tamano: null, ancho: 1920, alto: 1080, duracion: 24, archivo_nombre: null, cargado_por: null, cargado_en: '2026-10-31' },
      { id: 'v2', medio_id: 'm2', numero: 1, ruta: '/media/torres.webp', ruta_vertical: null, miniatura_ruta: '/media/miniaturas/torres.webp', mime: 'image/webp', tamano: null, ancho: 941, alto: 1672, duracion: null, archivo_nombre: null, cargado_por: null, cargado_en: '2026-10-31' },
      { id: 'v3', medio_id: 'm3', numero: 1, ruta: '/media/sala.webp', ruta_vertical: null, miniatura_ruta: '/media/miniaturas/sala.webp', mime: 'image/webp', tamano: null, ancho: 1122, alto: 1402, duracion: null, archivo_nombre: null, cargado_por: null, cargado_en: '2026-10-31' },
      { id: 'v4', medio_id: 'm4', numero: 1, ruta: '/media/dormitorio.webp', ruta_vertical: null, miniatura_ruta: '/media/miniaturas/dormitorio.webp', mime: 'image/webp', tamano: null, ancho: 1122, alto: 1402, duracion: null, archivo_nombre: null, cargado_por: null, cargado_en: '2026-10-31' },
    ],
  } as Record<string, Record<string, unknown>[]>)[tabla] ?? []
  const datos = {
    select: async (t: string) => fila(t),
    rpc: async () => [],
    insert: async () => ({}),
    update: async () => {},
  } as unknown as Datos

  const abrir = (url = '/') => render(
    <SessionProvider initialRol="administrador">
      <ConexionProvider value={{ remoto: true, datos, cuenta: null, salir: async () => {} }}>
        <InventoryProvider initialState={inicial()}>
          <MemoryRouter initialEntries={[url]}><DashboardPage /></MemoryRouter>
        </InventoryProvider>
      </ConexionProvider>
    </SessionProvider>,
  )

  it('muestra las unidades por confirmar como alerta y no dice que no hay pendientes', async () => {
    abrir()
    const alerta = await screen.findByRole('link', { name: /unidades por confirmar/i })
    expect(alerta).toHaveAttribute('href', '/inventario?estado=por_confirmar')
    expect(screen.queryByText(/No hay pendientes/)).toBeNull()
    expect(screen.getByRole('link', { name: /^Por confirmar: 67$/ })).toHaveAttribute('href', '/inventario?estado=por_confirmar')
    expect(screen.getByRole('link', { name: /^Disponibles: 5$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Departamentos: 72$/ })).toBeInTheDocument()
  })

  it('con datos reales vacíos muestra ceros verdaderos y avisa de las plantillas por aprobar', async () => {
    abrir()
    expect(await screen.findByRole('link', { name: /2 documentos contractuales por aprobar/ })).toHaveAttribute('href', '/ventas')
    await waitFor(() => expect(screen.getByRole('link', { name: /^Contratos firmados: 0$/ })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /^Clientes registrados: 2$/ })).toHaveAttribute('href', '/clientes')
    expect(screen.getByText(/Aún no hay ventas firmadas ni cobros confirmados/)).toBeInTheDocument()
    expect(screen.queryByText('Avance físico de obra')).toBeNull()
  })

  it('el filtro por edificio recalcula las tarjetas y deja el edificio en la dirección', async () => {
    abrir()
    await screen.findByRole('link', { name: /^Departamentos: 72$/ })
    await userEvent.click(screen.getByRole('button', { name: 'Edificio 2' }))
    const ed2 = createInitialState().units.filter((u) => u.edificio === 2).length
    expect(await screen.findByRole('link', { name: new RegExp(`^Departamentos: ${ed2}$`) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edificio 2' })).toHaveAttribute('aria-pressed', 'true')
    const grupo = screen.getByRole('group', { name: 'Filtrar por edificio' })
    expect(within(grupo).getAllByRole('button')).toHaveLength(3)
  })

  it('una unidad con solicitud activa cuenta como en proceso de reserva, no como disponible', async () => {
    const e = inicial()
    const i = e.units.findIndex((u) => u.estado === 'disponible')
    e.units[i] = { ...e.units[i], solicitud: { codigo: 'RES-2026-0001', estado: 'solicitada', vigenciaHasta: null, cotizacionId: null } }
    render(
      <SessionProvider initialRol="administrador">
        <InventoryProvider initialState={e}><MemoryRouter><DashboardPage /></MemoryRouter></InventoryProvider>
      </SessionProvider>,
    )
    expect(await screen.findByRole('link', { name: /^Disponibles: 4$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /1 unidad en proceso de reserva/ })).toHaveAttribute('href', '/inventario?estado=en_proceso_reserva')
  })

  it('muestra el banner, el video bajo demanda y sin sonido, y la galería ampliable', async () => {
    const user = userEvent.setup()
    abrir()
    expect(await screen.findByRole('region', { name: 'Bienvenida a AMURA' })).toBeInTheDocument()
    expect(document.querySelector('video')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Ver video' }))
    const video = (await screen.findByRole('dialog', { name: 'Video promocional de AMURA' })).querySelector('video') as HTMLVideoElement
    expect(video).toHaveAttribute('src', '/media/video-horizontal.mp4')
    expect(video.muted).toBe(true)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Ampliar Sala y comedor' }))
    const visor = await screen.findByRole('dialog', { name: 'Sala y comedor' })
    expect(within(visor).getByRole('img')).toHaveAttribute('src', '/media/sala.webp')
    await user.click(within(visor).getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('dialog', { name: 'Dormitorio' })).toBeInTheDocument()
  })

  it('sin conexión a datos comerciales no inventa cifras: muestra guiones', async () => {
    render(
      <SessionProvider initialRol="administrador">
        <InventoryProvider initialState={inicial()}><MemoryRouter><DashboardPage /></MemoryRouter></InventoryProvider>
      </SessionProvider>,
    )
    expect(await screen.findByRole('link', { name: /^Ventas firmadas: —$/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Saldo por cobrar: —$/ })).toBeInTheDocument()
  })
})
