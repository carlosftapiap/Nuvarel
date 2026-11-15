// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { Cliente } from '@/features/clientes/model'
import { ClientesProvider } from '@/features/clientes/store'
import type { Actor } from '@/features/inventario/types'
import { InventoryProvider } from '@/features/inventario/store'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import { ReservasProvider } from '@/features/reservas/store'
import ClientesPage from '@/pages/ClientesPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

// Cada pantalla lee varias tablas de Postgres real; con toda la suite en paralelo tarda más que la espera por defecto.
configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, cora: string, carlos: string

async function actorDe(base: PGlite, id: string): Promise<Actor> {
  const s = await como(base, id, async () => (await base.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  return { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
}

/** Cada llamada es una sesión nueva, como entrar desde otro navegador: nada se comparte salvo la base de datos. */
async function abrirComo(id: string, base: PGlite = db, url = '/clientes') {
  const actor = await actorDe(base, id)
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(base, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}>
        <InventoryProvider initialState={createInitialState()}>
          <ClientesProvider>
            <ReservasProvider>
              <MemoryRouter initialEntries={[url]}><ClientesPage /></MemoryRouter>
            </ReservasProvider>
          </ClientesProvider>
        </InventoryProvider>
      </SessionProvider>
    </ConexionProvider>,
  )
}

const fila = (base: PGlite, nombre: string) => base.query<{ id: string; etapa: string; asesor_id: string; atribucion_usuario_id: string }>(`select id, etapa, asesor_id, atribucion_usuario_id from public.clients where nombre = $1`, [nombre])

async function registrar(user: ReturnType<typeof userEvent.setup>, nombre: string, telefono: string) {
  await user.click((await screen.findAllByRole('button', { name: /Nuevo cliente/ }))[0])
  const dlg = await screen.findByRole('dialog', { name: 'Nuevo cliente' })
  const [primero, ...resto] = nombre.split(' ')
  await user.type(within(dlg).getByLabelText('Primer nombre *'), primero)
  await user.type(within(dlg).getByLabelText('Primer apellido *'), resto.join(' '))
  await user.type(within(dlg).getByLabelText('Celular *'), telefono)
  await user.click(within(dlg).getByRole('button', { name: 'Registrar cliente' }))
  return dlg
}

beforeEach(() => {
  localStorage.clear(); localStorage.setItem('amura.clientes.vista', 'tablero')
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  cora = await crearUsuario(db, 'Cora Corredora', 'corredor')
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
}, 60_000)

describe('Clientes conectado a la base de datos (Postgres real con RLS)', () => {
  it('crear, cerrar sesión, volver a entrar y abrir desde otro navegador: el cliente sigue ahí', async () => {
    const user = userEvent.setup()
    const primera = await abrirComo(cora)
    await registrar(user, 'Lucía Andrade', '0991112233')
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    expect(within(ficha).getByText('Nuevo', { selector: 'span' })).toBeInTheDocument()
    expect((await fila(db, 'Lucía Andrade')).rows[0]).toMatchObject({ etapa: 'nuevo', asesor_id: cora, atribucion_usuario_id: cora })
    primera.unmount()

    // Otra sesión, sin nada en el navegador.
    localStorage.clear(); localStorage.setItem('amura.clientes.vista', 'tablero')
    const segunda = await abrirComo(cora)
    expect(await screen.findByRole('button', { name: 'Abrir ficha de Lucía Andrade' })).toBeInTheDocument()
    segunda.unmount()

    // Otra persona con alcance también la ve; otro corredor no.
    const tercera = await abrirComo(admin)
    expect(await screen.findByRole('button', { name: 'Abrir ficha de Lucía Andrade' })).toBeInTheDocument()
    tercera.unmount()
    await abrirComo(carlos)
    expect(await screen.findByText('Aún no hay clientes')).toBeInTheDocument()
    expect(screen.queryByText('Lucía Andrade')).not.toBeInTheDocument()
  })

  it('registrar una llamada queda guardada, avanza a Contactado y sobrevive a una sesión nueva', async () => {
    const user = userEvent.setup()
    const { rows } = await fila(db, 'Lucía Andrade')
    const s = await abrirComo(cora, db, `/clientes?cliente=${rows[0].id}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    await user.click(within(ficha).getByRole('tab', { name: 'Actividad' }))
    await user.type(within(ficha).getByPlaceholderText(/Llamada: confirma interés/), 'Busca 2 habitaciones')
    await user.click(within(ficha).getByRole('button', { name: 'Registrar' }))
    expect(await within(ficha).findByText(/Nuevo → Contactado/)).toBeInTheDocument()
    await waitFor(async () => expect((await fila(db, 'Lucía Andrade')).rows[0].etapa).toBe('contactado'))
    const a = await db.query(`select 1 from public.client_activities where client_id = $1 and tipo = 'llamada' and descripcion = 'Busca 2 habitaciones'`, [rows[0].id])
    expect(a.rows).toHaveLength(1)
    s.unmount()
    await abrirComo(cora, db, `/clientes?cliente=${rows[0].id}`)
    const otra = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    await userEvent.click(within(otra).getByRole('tab', { name: 'Actividad' }))
    expect(within(otra).getByText(/Busca 2 habitaciones/)).toBeInTheDocument()
  })

  it('programar una actividad futura queda guardado y sobrevive a una sesión nueva', async () => {
    const user = userEvent.setup()
    const { rows } = await fila(db, 'Lucía Andrade')
    const s = await abrirComo(cora, db, `/clientes?cliente=${rows[0].id}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    await user.type(within(ficha).getByLabelText('Qué hacer'), 'Enviar planos del piso 3')
    await user.type(within(ficha).getByLabelText('Fecha de la próxima actividad'), '2030-01-15')
    await user.click(within(ficha).getByRole('button', { name: /^(Programar|Reprogramar)$/ }))
    await waitFor(async () => {
      const r = await db.query<{ d: string; f: string }>(`select proxima_descripcion as d, proxima_fecha::text as f from public.clients where id = $1`, [rows[0].id])
      expect(r.rows[0]).toEqual({ d: 'Enviar planos del piso 3', f: '2030-01-15' })
    })
    s.unmount()
    await abrirComo(cora, db, `/clientes?cliente=${rows[0].id}`)
    expect(within(await screen.findByRole('dialog', { name: /Lucía Andrade/ })).getByText(/Enviar planos del piso 3/)).toBeInTheDocument()
  })

  it('mover de etapa desde la ficha persiste; Reserva no se puede elegir', async () => {
    const user = userEvent.setup()
    const { rows } = await fila(db, 'Lucía Andrade')
    await abrirComo(cora, db, `/clientes?cliente=${rows[0].id}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    expect(within(ficha).getByRole('button', { name: 'Reserva' })).toBeDisabled()
    await user.click(within(ficha).getByRole('button', { name: 'Calificado' }))
    await waitFor(async () => expect((await fila(db, 'Lucía Andrade')).rows[0].etapa).toBe('calificado'))
    expect(await screen.findByRole('region', { name: 'Calificado: 1 clientes', hidden: true })).toBeInTheDocument()
  })

  it('administración reasigna con motivo; sin motivo no se guarda', async () => {
    const user = userEvent.setup()
    const { rows } = await fila(db, 'Lucía Andrade')
    await abrirComo(admin, db, `/clientes?cliente=${rows[0].id}`)
    const ficha = await screen.findByRole('dialog', { name: /Lucía Andrade/ })
    await user.click(within(ficha).getByRole('button', { name: 'Editar cliente' }))
    const dlg = await screen.findByRole('dialog', { name: 'Editar cliente' })
    await user.click(within(dlg).getByLabelText('Asesor responsable *'))
    await user.click(await screen.findByRole('option', { name: 'Carlos Corredor' }))
    await user.click(within(dlg).getByRole('button', { name: 'Guardar cambios' }))
    expect(await within(dlg).findByText(/motivo de la reasignación/)).toBeInTheDocument()
    expect((await fila(db, 'Lucía Andrade')).rows[0].asesor_id).toBe(cora)
    await user.type(within(dlg).getByLabelText('Motivo de la reasignación *'), 'Corredor de la zona')
    await user.click(within(dlg).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(async () => expect((await fila(db, 'Lucía Andrade')).rows[0].asesor_id).toBe(carlos))
    expect((await fila(db, 'Lucía Andrade')).rows[0].atribucion_usuario_id).toBe(cora)
  })

  it('un duplicado de otro equipo se rechaza en el formulario, sin perder lo escrito', async () => {
    const user = userEvent.setup()
    await abrirComo(admin)
    await screen.findByRole('button', { name: 'Abrir ficha de Lucía Andrade' })
    // Administración sí ve el duplicado: se prueba con quien no lo ve.
    document.body.innerHTML = ''
    await abrirComo(cora)
    await screen.findAllByRole('button', { name: /Nuevo cliente/ })
    const otro = await crearUsuario(db, 'Otra Corredora', 'corredor')
    await db.query(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Oculto', '1710566777', '0995556677', 'whatsapp', $1, $1, $1)`, [otro])
    const dlg = await registrar(user, 'Copia Oculta', '0995556677')
    // Sin datos del otro cliente ni de su vendedor: solo el aviso y la opción de pedir la revisión.
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Este celular ya se encuentra registrado en AMURA.')
    expect(within(dlg).getByRole('alert')).not.toHaveTextContent(/Oculto|Otra Corredora/)
    expect(within(dlg).getByRole('button', { name: 'Solicitar revisión o reasignación' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Registrar cliente' })).toBeDisabled()
    expect(within(dlg).getByLabelText('Primer nombre *')).toHaveValue('Copia')
    expect((await fila(db, 'Copia Oculta')).rows).toHaveLength(0)
  })

  it('abre una negociación desde la ficha, sin duplicarla, y conserva la etapa del cliente', async () => {
    const user = userEvent.setup()
    const c = await db.query<{ id: string }>(`insert into public.clients (nombre, documento, telefono, origen, asesor_id, created_by, atribucion_usuario_id, etapa, unidades_interes) values ('Con interés', '1710500016', '0995550001', 'whatsapp', $1, $1, $1, 'calificado', '{E1-PB-A2}') returning id`, [cora])
    await abrirComo(cora, db, `/clientes?cliente=${c.rows[0].id}`)
    const ficha = await screen.findByRole('dialog', { name: /Con interés/ })
    await user.click(within(ficha).getByRole('tab', { name: 'Operaciones' }))
    await user.click(within(ficha).getByLabelText('Unidad o tipología de la negociación'))
    await user.click((await screen.findAllByRole('option')).find((o) => /^Tipología/.test(o.textContent ?? '') === false)!)
    await user.click(within(ficha).getByRole('button', { name: 'Abrir negociación' }))
    expect(await within(ficha).findByText('Calificación')).toBeInTheDocument()
    const o = await db.query<{ codigo_unidad: string; responsable_id: string }>(`select codigo_unidad, responsable_id from public.opportunities where client_id = $1`, [c.rows[0].id])
    expect(o.rows).toEqual([{ codigo_unidad: 'E1-PB-A2', responsable_id: cora }])
    expect((await fila(db, 'Con interés')).rows[0].etapa).toBe('calificado')
  })
})

describe('Importación desde el navegador', () => {
  const local: Cliente = {
    id: 'cli-local-1', nombre: 'Cliente del Navegador', telefono: '0996660001', email: '', origen: 'instagram', origenDetalle: '', unidadesInteres: [],
    presupuesto: null, proposito: null, formaPago: null, asesorId: 'u-demo', asesor: 'Demo', atribucion: { usuarioId: 'u-demo', nombre: 'Demo', fecha: '2026-10-01' },
    etapa: 'contactado', motivoPerdida: '', fechaRetomar: null, proxima: null,
    actividades: [{ id: 'act-1', tipo: 'llamada', fecha: '2026-10-02', descripcion: 'Primera llamada', usuario: 'Demo', registradaEn: '2026-10-02T10:00:00Z' }],
    cotizaciones: [], creadoPor: { id: 'u-demo', nombre: 'Demo', rol: 'asesor' }, creadoEn: '2026-10-01T10:00:00Z', actualizadoEn: '2026-10-02T10:00:00Z',
  }

  it('avisa, muestra la vista previa, importa, verifica y solo entonces archiva la copia local sin borrarla', async () => {
    const user = userEvent.setup()
    const guardado = JSON.stringify({ version: 1, clientes: [local] })
    localStorage.setItem('amura.clientes.v1', guardado)
    await abrirComo(carlos)
    await user.click(await screen.findByRole('button', { name: 'Revisar e importar' }))
    const dlg = await screen.findByRole('dialog', { name: 'Importar clientes de este navegador' })
    expect(await within(dlg).findByText('Se importará')).toBeInTheDocument()
    // Revisar no escribe.
    expect((await fila(db, 'Cliente del Navegador')).rows).toHaveLength(0)
    expect(within(dlg).queryByRole('button', { name: 'Archivar copia local' })).not.toBeInTheDocument()

    await user.click(within(dlg).getByRole('button', { name: 'Importar 1 cliente' }))
    expect(await within(dlg).findByText(/Comprobado en la base de datos/)).toBeInTheDocument()
    expect((await fila(db, 'Cliente del Navegador')).rows[0]).toMatchObject({ etapa: 'contactado', asesor_id: carlos })
    // Aún no se toca la copia local.
    expect(localStorage.getItem('amura.clientes.v1')).toBe(guardado)

    // Cerrar y reabrir no duplica ni pierde el paso de archivar.
    await user.click(within(dlg).getByRole('button', { name: 'Cerrar' }))
    await user.click(await screen.findByRole('button', { name: 'Revisar e importar' }))
    const dlg2 = await screen.findByRole('dialog', { name: 'Importar clientes de este navegador' })
    expect(await within(dlg2).findByText('Ya estaba importado')).toBeInTheDocument()
    expect((await fila(db, 'Cliente del Navegador')).rows).toHaveLength(1)

    await user.click(await within(dlg2).findByRole('button', { name: 'Archivar copia local' }))
    expect(localStorage.getItem('amura.clientes.v1')).toBeNull()
    expect(localStorage.getItem('amura.clientes.v1.importados')).toBe(guardado)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revisar e importar' })).not.toBeInTheDocument())
    expect(await screen.findByRole('button', { name: 'Abrir ficha de Cliente del Navegador' })).toBeInTheDocument()
  })

  it('el modo conectado no escribe en el almacenamiento local', async () => {
    const user = userEvent.setup()
    await abrirComo(carlos)
    await registrar(user, 'Solo en la base', '0996660002')
    await screen.findByRole('dialog', { name: /Solo en la base/ })
    expect(localStorage.getItem('amura.clientes.v1')).toBeNull()
  })
})

describe('Base de datos sin la migración de Clientes', () => {
  it('lo advierte, permite consultar, no pierde los datos locales y no guarda a medias', async () => {
    const user = userEvent.setup()
    const vieja = await crearDb({ hasta: '20261030000000_plan_responsable_externo.sql' })
    const u = await crearUsuario(vieja, 'Vera', 'asesor')
    await vieja.query(`insert into public.clients (nombre, telefono, origen, asesor_id, created_by, atribucion_usuario_id) values ('Ya existente', '0997770001', 'whatsapp', $1, $1, $1)`, [u])
    const guardado = JSON.stringify({ version: 1, clientes: [{ id: 'cli-x', nombre: 'Local', telefono: '0997770002', email: '', origen: 'whatsapp', origenDetalle: '', unidadesInteres: [], asesorId: 'x', asesor: 'x', etapa: 'nuevo', actividades: [] }] })
    localStorage.setItem('amura.clientes.v1', guardado)
    await abrirComo(u, vieja)
    expect(await screen.findByText(/todavía no tiene las funciones de Clientes/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Abrir ficha de Ya existente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revisar e importar' })).toBeDisabled()
    const dlg = await registrar(user, 'No se guarda', '0997770003')
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(/falta aplicar una migración/)
    expect((await fila(vieja, 'No se guarda')).rows).toHaveLength(0)
    expect(localStorage.getItem('amura.clientes.v1')).toBe(guardado)
  }, 60_000)
})
