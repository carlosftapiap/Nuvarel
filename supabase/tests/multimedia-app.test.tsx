// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { ClientesProvider } from '@/features/clientes/store'
import MultimediaProyecto from '@/features/config/remoto/MultimediaProyecto'
import type { Datos } from '@/features/conexion/datos'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import { crearMedio } from '@/features/marca/biblioteca'
import { ReservasProvider } from '@/features/reservas/store'
import ConfiguracionPage from '@/pages/ConfiguracionPage'
import VentaPage from '@/pages/VentaPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

// El navegador real prepara la miniatura; jsdom no tiene canvas.
vi.mock('@/features/marca/procesar', () => ({
  prepararMedio: async (f: File, mime: string) => ({
    archivo: f, mime, nombre: f.name, nombreOriginal: f.name, miniatura: new Blob(['m'], { type: 'image/webp' }), nombreMiniatura: `mini-${f.name}`, ancho: 800, alto: 600, duracion: mime.startsWith('video/') ? 12 : null,
  }),
}))

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, vera: string

const archivos = new Set<string>()
const almacen = {
  subir: vi.fn(async (_b: string, ruta: string) => { archivos.add(ruta) }),
  descargar: async () => new ArrayBuffer(4),
  quitar: vi.fn(async (_b: string, ruta: string) => { archivos.delete(ruta) }),
  urlFirmadas: async (_b: string, rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, `https://firmado/${r}`])),
}
const foto = (nombre = 'foto.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], nombre, { type: 'image/jpeg' })

async function actorDe(id: string): Promise<Actor> {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}
async function abrir(id: string, ui: React.ReactNode) {
  const actor = await actorDe(id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><ClientesProvider><ReservasProvider><MemoryRouter>{ui}</MemoryRouter></ReservasProvider></ClientesProvider></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
const fila = (titulo: string) => screen.findByRole('listitem', { name: titulo })
const subirEn = (label: string | RegExp, f: File) => fireEvent.change(screen.getByLabelText(label), { target: { files: [f] } })

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Ana Admin', 'administrador')
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
}, 120_000)

describe('Configuración → Multimedia del proyecto', () => {
  it('solo el administrador ve la pestaña', async () => {
    const { unmount } = await abrir(admin, <ConfiguracionPage />)
    expect(await screen.findByRole('tab', { name: 'Multimedia del proyecto' })).toBeInTheDocument()
    unmount()
    await abrir(vera, <ConfiguracionPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Configuración' })).toBeInTheDocument())
    expect(screen.queryByRole('tab', { name: 'Multimedia del proyecto' })).toBeNull()
  })

  it('lista el material actual, sube, reemplaza y restaura sin perder la versión anterior', async () => {
    await abrir(admin, <MultimediaProyecto datos={datosPglite(db, admin)} />)
    for (const t of ['Video promocional de AMURA', 'Torres AMURA', 'Sala y comedor', 'Dormitorio', 'Piso Edificio A']) expect(await fila(t)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Subir fotografía o video' }))
    const d = await screen.findByRole('dialog', { name: 'Subir fotografía o video' })
    subirEn('Archivo *', foto())
    const subir = within(d).getByRole('button', { name: 'Subir' })
    expect(subir).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Fachada nueva' } })
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Vista de la fachada' } })
    fireEvent.click(subir)
    const nueva = await fila('Fachada nueva')
    expect(within(nueva).getByText(/Versión 1 ·/)).toBeInTheDocument()
    expect(within(nueva).getByLabelText('Dashboard')).toBeChecked()
    expect(archivos.size).toBe(2)

    fireEvent.click(within(nueva).getByRole('button', { name: 'Reemplazar' }))
    await screen.findByRole('dialog', { name: /Reemplazar/ })
    subirEn('Archivo *', foto('fachada2.jpg'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reemplazar' }))
    await waitFor(async () => expect(within(await fila('Fachada nueva')).getByText(/Versión 2 ·/)).toBeInTheDocument())
    expect(archivos.size).toBe(4)

    fireEvent.click(within(await fila('Fachada nueva')).getByRole('button', { name: 'Versiones (2)' }))
    const dv = await screen.findByRole('dialog', { name: /Versiones de/ })
    fireEvent.click(within(within(dv).getByRole('listitem', { name: 'Versión 1' })).getByRole('button', { name: 'Restaurar' }))
    await waitFor(() => expect(within(within(dv).getByRole('listitem', { name: 'Versión 1' })).getByText('Vigente')).toBeInTheDocument())
    expect(within(within(dv).getByRole('listitem', { name: 'Versión 2' })).getByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
    expect(archivos.size).toBe(4)
    fireEvent.click(within(dv).getByRole('button', { name: 'Cerrar' }))
  })

  it('oculta, ordena, elige el banner, edita, elimina y recupera', async () => {
    await abrir(admin, <MultimediaProyecto datos={datosPglite(db, admin)} />)
    const sala = await fila('Sala y comedor')
    fireEvent.click(within(sala).getByLabelText('Visible'))
    await waitFor(async () => expect(within(await fila('Sala y comedor')).getByText('Oculto')).toBeInTheDocument())
    expect(within(await fila('Sala y comedor')).getByRole('button', { name: 'Usar en banner' })).toBeDisabled()
    fireEvent.click(within(await fila('Sala y comedor')).getByLabelText('Visible'))
    await waitFor(async () => expect(within(await fila('Sala y comedor')).queryByText('Oculto')).toBeNull())

    fireEvent.click(within(await fila('Dormitorio')).getByRole('button', { name: 'Usar en banner' }))
    await waitFor(async () => expect(within(await fila('Dormitorio')).getByText('En el banner')).toBeInTheDocument())
    expect(within(await fila('Torres AMURA')).queryByText('En el banner')).toBeNull()
    fireEvent.click(within(await fila('Torres AMURA')).getByRole('button', { name: 'Usar en banner' }))
    await waitFor(async () => expect(within(await fila('Torres AMURA')).getByText('En el banner')).toBeInTheDocument())

    const titulos = () => screen.getAllByRole('listitem').map((l) => l.getAttribute('aria-label'))
    const antes = titulos()
    fireEvent.click(screen.getByRole('button', { name: 'Subir Dormitorio' }))
    await waitFor(() => expect(titulos()).not.toEqual(antes))
    expect(titulos().indexOf('Dormitorio')).toBe(antes.indexOf('Dormitorio') - 1)

    fireEvent.click(within(await fila('Piso Edificio A')).getByRole('button', { name: 'Editar' }))
    await screen.findByRole('dialog', { name: 'Editar contenido' })
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Piso tipo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await fila('Piso tipo')).toBeInTheDocument()

    fireEvent.click(within(await fila('Piso tipo')).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /Eliminar/ })).getByRole('button', { name: 'Eliminar' }))
    await screen.findByText('Eliminados (1)')
    expect(screen.queryByRole('listitem', { name: 'Piso tipo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar' }))
    await waitFor(async () => expect(within(await fila('Piso tipo')).getByText('Oculto')).toBeInTheDocument())
    await como(db, admin, () => db.query(`select public.medio_actualizar('a1000000-0000-4000-8000-000000000005', 'Piso Edificio A', 'Distribución de un piso del Edificio A en vista tridimensional.', true, true, true)`))
  })

  it('si el servidor rechaza el registro no quedan archivos huérfanos', async () => {
    const quitadas: string[] = []
    const a = { subir: vi.fn(async () => {}), descargar: async () => new ArrayBuffer(4), quitar: vi.fn(async (_b: string, r: string) => { quitadas.push(r) }) }
    const datos = { rpc: async () => { throw new Error('Rechazado') } } as unknown as Datos
    await expect(crearMedio(datos, a, { titulo: 'Foto', descripcion: '', enDashboard: true, enVenta: true }, foto())).rejects.toThrow('Rechazado')
    expect(a.subir).toHaveBeenCalledTimes(2)
    expect(quitadas).toHaveLength(2)
    quitadas.length = 0
    const falla = { ...a, subir: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Sin red')) }
    await expect(crearMedio(datos, falla, { titulo: 'Foto', descripcion: '', enDashboard: true, enVenta: true }, foto())).rejects.toThrow('Sin red')
    expect(quitadas).toHaveLength(1)
  })

  it('sin la migración avisa que no está activada y no ofrece acciones', async () => {
    const datos = { select: async () => { throw new Error('relation does not exist') }, rpc: async () => [] } as unknown as Datos
    await abrir(admin, <MultimediaProyecto datos={datos} />)
    expect(await screen.findByText(/aún no está activada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subir fotografía o video' })).toBeNull()
  })
})

describe('Ventas → Atender cliente', () => {
  const seccion = () => screen.findByRole('region', { name: 'Presentación del proyecto AMURA' })

  it('el vendedor presenta video y galería sin salir de la pantalla, y no puede modificar nada', async () => {
    await abrir(vera, <VentaPage />)
    const s = await seccion()
    const video = await within(s).findByRole('button', { name: 'Ver video Video promocional de AMURA' })
    expect(document.querySelector('video')).toBeNull()
    for (const nombre of ['Subir', 'Reemplazar', 'Eliminar', 'Editar', 'Usar en banner']) expect(within(s).queryByRole('button', { name: nombre })).toBeNull()

    fireEvent.click(video)
    const visor = await screen.findByRole('dialog', { name: 'Video promocional de AMURA' })
    const v = visor.querySelector('video') as HTMLVideoElement
    expect(v.muted).toBe(true)
    expect(v).toHaveAttribute('controls')
    expect(within(visor).getByText('Presentación del proyecto en 24 segundos.')).toBeInTheDocument()
    fireEvent.click(within(visor).getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('dialog', { name: 'Torres AMURA' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    // El orden es el del administrador: en la prueba anterior subió Dormitorio.
    expect(await screen.findByRole('dialog', { name: 'Dormitorio' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Atender cliente' })).toBeInTheDocument()
  })

  it('no muestra al vendedor lo oculto, y el orden es el del administrador', async () => {
    await como(db, admin, () => db.query(`select public.medio_actualizar('a1000000-0000-4000-8000-000000000003', 'Sala y comedor', '', true, false, true)`))
    await abrir(vera, <VentaPage />)
    const s = await seccion()
    await within(s).findByRole('button', { name: 'Ampliar Torres AMURA' })
    expect(within(s).queryByRole('button', { name: 'Ampliar Sala y comedor' })).toBeNull()
    await como(db, admin, () => db.query(`select public.medio_actualizar('a1000000-0000-4000-8000-000000000003', 'Sala y comedor', '', true, true, true)`))
  })

  it('se puede ocultar y lo recuerda', async () => {
    const { unmount } = await abrir(vera, <VentaPage />)
    const s = await seccion()
    await within(s).findByRole('button', { name: 'Ampliar Torres AMURA' })
    fireEvent.click(within(s).getByRole('button', { name: 'Ocultar' }))
    expect(within(s).queryByRole('button', { name: 'Ampliar Torres AMURA' })).toBeNull()
    unmount()
    await abrir(vera, <VentaPage />)
    expect(within(await seccion()).getByRole('button', { name: 'Mostrar' })).toBeInTheDocument()
  })

  it('sin material publicado lo dice con claridad', async () => {
    const ids = (await db.query<{ id: string }>(`select id from public.medios_proyecto where activo`)).rows.map((f) => f.id)
    await db.exec(`update public.medios_proyecto set activo = false`)
    await abrir(vera, <VentaPage />)
    expect(await within(await seccion()).findByText(/Todavía no hay material publicado/)).toBeInTheDocument()
    await db.query(`update public.medios_proyecto set activo = true where id = any($1)`, [ids])
  })
})
