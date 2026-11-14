// @vitest-environment jsdom
// Fase 5 en pantalla: historial de notificaciones en Configuración y lista versionada de documentos del expediente.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import CatalogoExpediente from '@/features/cumplimiento/components/CatalogoExpediente'
import HistorialNotificaciones from '@/features/notificaciones/HistorialNotificaciones'
import type { Actor } from '@/features/inventario/types'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })
let db: PGlite
let admin: string, vera: string, gerente: string
async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrir(id: string, ui: (d: ReturnType<typeof datosPglite>) => React.ReactNode) {
  const actor = await actorDe(id)
  const datos = datosPglite(db, id)
  return render(
    <ConexionProvider value={{ remoto: true, datos, cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter>{ui(datos)}</MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Andrés Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  gerente = await crearUsuario(db, 'Gema Gerencia', 'gerencia')
  // Un aviso real: reserva con pago verificado por aprobar (lo encola el disparador).
  const cli = (await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Cliente Aviso', '1715000806', '0990000080', 'whatsapp', $1, $1, $1) returning id`, [vera])).rows[0].id
  const q = (await db.query<{ id: string }>(`insert into public.quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, created_by, client_id)
    values ('COT-NA-1', current_date, current_date + 30, 'E1-PB-A2', '{}', '{}', 0, 10000, 10000, '{}', $1, $2) returning id`, [vera, cli])).rows[0].id
  const r = (await db.query<{ id: string }>(`insert into public.reservations (codigo, client_id, codigo_unidad, quote_id, vigencia_hasta, precio_acordado, reserva_pct, monto_reserva, meses, cuota_mensual, estado, created_by)
    values ('RES-NA-1', $1, 'E1-PB-A2', $2, current_date + 30, 10000, 6, 500, 2, 700, 'solicitada', $3) returning id`, [cli, q, vera])).rows[0].id
  await db.query(`update public.reservations set estado = 'pago_verificado' where id = $1`, [r])
  // Así queda tras un envío en modo prueba: original y buzón que lo recibió.
  await db.query(`update public.cobranza_alertas set estado = 'enviada', destinatario_efectivo = 'carlosftapiap@gmail.com', enviada_en = now() where evento = 'reserva_por_aprobar'`)
}, 60_000)

describe('Configuración: Notificaciones', () => {
  it('administración ve evento, destinatario original, buzón de entrega y enlace al registro', async () => {
    await abrir(admin, (d) => <HistorialNotificaciones datos={d} />)
    const fila = (await screen.findByText('Reserva con excepción por autorizar')).closest('tr')!
    expect(within(fila).getByText('gema.gerencia@prueba.local')).toBeInTheDocument()
    expect(within(fila).getByText('carlosftapiap@gmail.com')).toBeInTheDocument()
    expect(within(fila).getByText('Enviada')).toBeInTheDocument()
    expect(within(fila).getByRole('link', { name: /Reserva con excepción por autorizar · E1-PB-A2/ })).toHaveAttribute('href', '/reservas')
    fireEvent.change(screen.getByLabelText('Estado del envío'), { target: { value: 'fallida' } })
    expect(await screen.findByText('Sin notificaciones.')).toBeInTheDocument()
  })

  it('la persona destinataria ve sus avisos; una vendedora no ve avisos de otros', async () => {
    await abrir(gerente, (d) => <HistorialNotificaciones datos={d} />)
    expect(await screen.findByText('Reserva con excepción por autorizar')).toBeInTheDocument()
    cleanup()
    await abrir(vera, (d) => <HistorialNotificaciones datos={d} />)
    expect(await screen.findByText('Sin notificaciones.')).toBeInTheDocument()
  })
})

describe('Configuración: Documentos del expediente', () => {
  it('administración agrega un documento con motivo y queda una versión nueva de la lista provisional', async () => {
    await abrir(admin, (d) => <CatalogoExpediente datos={d} />)
    expect(await screen.findByText('Lista provisional de documentos · versión 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Agregar documento' }))
    fireEvent.change(screen.getByLabelText('Clave *'), { target: { value: 'pn_referencia' } })
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Referencia bancaria' } })
    const guardar = screen.getByRole('button', { name: 'Guardar versión nueva' })
    expect(guardar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motivo del cambio/), { target: { value: 'Pedido del Oficial de Cumplimiento' } })
    fireEvent.click(guardar)
    expect(await screen.findByText('Lista actualizada: versión 2')).toBeInTheDocument()
    expect(screen.getByText('Lista provisional de documentos · versión 2')).toBeInTheDocument()
    expect(screen.getByText('Referencia bancaria')).toBeInTheDocument()
    expect((await db.query(`select count(*)::int as n from public.expediente_tipos_historial where version = 2`)).rows[0]).toEqual({ n: 13 })
  })
})
