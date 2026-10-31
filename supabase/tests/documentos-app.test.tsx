// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import PizZip from 'pizzip'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { construirDocxDesdeTexto } from '@/features/contratos/docxTexto'
import { leer, sha256 } from '@/features/contratos/hash'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { InventoryProvider } from '@/features/inventario/store'
import type { Actor } from '@/features/inventario/types'
import VentasPage from '@/pages/VentasPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 20_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, legal: string, carlos: string, constructor: string
let n = 990700000
let contrato: { id: string; codigo: string; cliente: string }
let modelo: Uint8Array

/** Almacenamiento en memoria con la misma interfaz que el bucket privado. */
const archivos = new Map<string, Uint8Array>()
const almacen: AlmacenContratos = {
  async subir(bucket, ruta, archivo) { archivos.set(`${bucket}/${ruta}`, new Uint8Array(await leer(archivo))) },
  async descargar(bucket, ruta) {
    const a = archivos.get(`${bucket}/${ruta}`)
    if (!a) throw new Error('No se pudo abrir el archivo: no se encontró')
    return a.slice().buffer
  },
}

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])

async function contratoNuevo() {
  const codigo = (await uno<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)).codigo
  const cliente = (await rpc<{ id: string }>(carlos, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Comprador ${codigo}`, telefono: `0${++n}`, origen: 'corredor', origen_detalle: 'Carlos' }), carlos])).id
  const op = (await rpc<{ id: string }>(carlos, `select public.oportunidades_crear($1, $2, null) as id`, [cliente, codigo])).id
  const cot = (await rpc<{ id: string }>(carlos, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  await rpc(carlos, `select public.cotizaciones_aceptar($1, 'Cliente acepta')`, [cot])
  const r = (await rpc<{ id: string }>(carlos, `select public.reservas_solicitar($1) as id`, [cot])).id
  await rpc(carlos, `select public.reservas_reportar_pago($1::uuid, 1, (now() at time zone 'America/Guayaquil')::date, 'Banco de prueba', $2, jsonb_build_object('ruta', 'reservas/' || $1::uuid::text || '/' || gen_random_uuid()::text || '.pdf', 'mime', 'application/pdf', 'tamano', 10))`, [r, `TRF-${r.slice(0, 8)}`])
  const m = await uno<{ monto_reserva: string }>(`select monto_reserva from public.reservations where id = $1`, [r])
  await rpc(finanzas, `select public.reservas_confirmar_pago($1, $2, $3::date, $4, true, 'Ingreso confirmado')`, [r, m.monto_reserva, hoyGuayaquil(), `BAN-${r.slice(0, 8)}`])
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const id = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de la venta') as id`, [r, hoyGuayaquil()])).id
  return { id, cliente, codigo: (await uno<{ codigo: string }>(`select codigo from public.contracts where id = $1`, [id])).codigo }
}

async function abrirComo(id: string) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {} }}>
      <SessionProvider actorRemoto={actor}><InventoryProvider><MemoryRouter><VentasPage almacen={almacen} /></MemoryRouter></InventoryProvider></SessionProvider>
    </ConexionProvider>,
  )
}
const irAPlantillas = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole('button', { name: 'Plantillas y formatos' }))
const archivoWord = (bytes: Uint8Array, nombre = 'compraventa-legal.docx') => new File([new Uint8Array(bytes)], nombre, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL = vi.fn(() => 'blob:prueba')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => cleanup())

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fernanda Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Luis Legal', 'legal', { alcance: 'empresa' })
  carlos = await crearUsuario(db, 'Carlos Corredor', 'corredor')
  constructor = await crearUsuario(db, 'Juan Paez', 'constructor')
  await db.query(`update public.inventory_units set estado = 'disponible' where estado = 'por_confirmar'`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
  contrato = await contratoNuevo()
  modelo = await construirDocxDesdeTexto([
    '# CONTRATO',
    'En {lugar_firma}, {contrato.fecha_larga}. Vende {vendedora.razon_social}, RUC {vendedora.ruc}.',
    'Compra {comprador.nombre}, documento {comprador.documento}, domiciliado en {comprador.domicilio}.',
    'Departamento {unidad.departamento}, edificio {unidad.edificio}. Precio USD {precio.total} ({precio.total_letras}).',
    '{#pago.cuotas}', 'Cuota {numero}: USD {monto}', '{/pago.cuotas}',
  ].join('\n'), { conFirmas: false })
}, 180_000)

describe('Documentos contractuales desde /ventas', () => {
  it('sin plantillas aprobadas no se puede emitir, y se explica', async () => {
    const user = userEvent.setup()
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Generar documento ${contrato.codigo}` }))
    expect(await screen.findByText(/No hay plantillas aprobadas/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar documento' })).toBeDisabled()
  }, 90_000)

  it('Legal sube el modelo en Word: detecta sus campos, lo guarda y queda en borrador', async () => {
    const user = userEvent.setup()
    await abrirComo(legal)
    await irAPlantillas(user)
    expect(await screen.findByText('Todavía no hay plantillas')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subir Word' }))
    const dlg = await screen.findByRole('dialog', { name: 'Subir modelo en Word' })
    await user.upload(within(dlg).getByLabelText(/Modelo en Word/), archivoWord(modelo))
    expect(await within(dlg).findByText('{comprador.nombre}')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Origen de comprador.nombre')).toHaveValue('catalogo')
    expect(within(dlg).getByLabelText('Origen de lugar_firma')).toHaveValue('manual')
    expect(within(dlg).getByLabelText('Nombre de la plantilla *')).toHaveValue('compraventa legal')
    await user.clear(within(dlg).getByLabelText('Nombre de la plantilla *'))
    await user.type(within(dlg).getByLabelText('Nombre de la plantilla *'), 'Compraventa estándar')
    await user.clear(within(dlg).getByLabelText('Nombre de lugar_firma'))
    await user.type(within(dlg).getByLabelText('Nombre de lugar_firma'), 'Lugar de firma')
    await user.click(within(dlg).getByRole('button', { name: 'Guardar como borrador' }))
    expect(await screen.findByText(/Plantilla guardada como borrador/)).toBeInTheDocument()
    const t = await uno<{ estado: string; archivo_ruta: string; archivo_hash: string; version: number }>(`select estado, archivo_ruta, archivo_hash, version from public.contract_templates`)
    expect(t).toMatchObject({ estado: 'borrador', version: 1 })
    const guardado = archivos.get(`plantillas-contratos/${t.archivo_ruta}`)
    expect(guardado).toBeDefined()
    expect(await sha256(guardado!)).toBe(t.archivo_hash)
    expect(await screen.findByText(/Sin versión aprobada/)).toBeInTheDocument()
  }, 90_000)

  it('un archivo que no es Word se rechaza antes de guardarlo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await abrirComo(legal)
    await irAPlantillas(user)
    await user.click(await screen.findByRole('button', { name: 'Subir Word' }))
    const dlg = await screen.findByRole('dialog', { name: 'Subir modelo en Word' })
    await user.upload(within(dlg).getByLabelText(/Modelo en Word/), new File(['hola'], 'falso.docx'))
    expect(await within(dlg).findByText(/no es un documento de Word/)).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Guardar como borrador' })).toBeDisabled()
  }, 90_000)

  it('la vista previa del borrador usa datos reales, sin validez, y no guarda nada', async () => {
    const user = userEvent.setup()
    await abrirComo(legal)
    await irAPlantillas(user)
    await user.click(await screen.findByRole('button', { name: 'Vista previa de Compraventa estándar v1' }))
    const dlg = await screen.findByRole('dialog', { name: /Vista previa · Compraventa estándar/ })
    await user.click(within(dlg).getByRole('button', { name: 'Generar vista previa' }))
    const doc = await within(dlg).findByRole('article', { name: 'Vista previa del documento' })
    expect(within(doc).getByText(/Compra Comprador/)).toBeInTheDocument()
    expect(within(dlg).getByText(/Con este contrato faltarían/)).toBeInTheDocument()
    expect(within(doc).getByText(/sin validez legal/i)).toBeInTheDocument()
    expect((await uno<{ n: number }>(`select count(*)::int n from public.contract_document_versions`)).n).toBe(0)
  }, 90_000)

  it('Gerencia consulta pero no administra ni aprueba; Legal aprueba', async () => {
    const user = userEvent.setup()
    await abrirComo(gerente)
    await irAPlantillas(user)
    expect(await screen.findByText('Compraventa estándar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Subir Word' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobar Compraventa estándar v1' })).not.toBeInTheDocument()
    cleanup()
    await abrirComo(legal)
    await irAPlantillas(user)
    await user.click(await screen.findByRole('button', { name: 'Aprobar Compraventa estándar v1' }))
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Revisada y aprobada por Legal')
    await user.click(within(dlg).getByRole('button', { name: 'Aprobar plantilla' }))
    expect(await screen.findByText(/Plantilla aprobada/)).toBeInTheDocument()
    expect(await screen.findByText(/En uso:/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar Compraventa estándar v1' })).not.toBeInTheDocument()
  }, 90_000)

  it('generar muestra exactamente qué falta; al completarlo se guarda el PDF y el Word sin tocar precio ni cuotas', async () => {
    const user = userEvent.setup()
    const antes = {
      contrato: await uno(`select estado, precio, fecha_contrato from public.contracts where id = $1`, [contrato.id]),
      cuotas: (await db.query(`select numero, monto, vencimiento from public.installments where contract_id = $1 order by numero`, [contrato.id])).rows,
    }
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Generar documento ${contrato.codigo}` }))
    let dlg = await screen.findByRole('dialog', { name: /Generar documento/ })
    await user.type(await within(dlg).findByLabelText('Lugar de firma *'), 'Quito')
    await user.click(within(dlg).getByRole('button', { name: 'Verificar datos y previsualizar' }))
    const aviso = await within(dlg).findByRole('alert')
    expect(aviso).toHaveTextContent(/Cédula o RUC/)
    expect(aviso).toHaveTextContent(/Domicilio/)
    expect(aviso).toHaveTextContent(/Razón social de la vendedora/)
    expect(within(dlg).getByRole('button', { name: 'Generar documento' })).toBeDisabled()
    // Se corrige desde la pantalla autorizada: compradores.
    await user.click(within(aviso).getByRole('button', { name: 'Abrir compradores y apoderados' }))
    dlg = await screen.findByRole('dialog', { name: /Compradores y apoderados/ })
    await user.type(await within(dlg).findByLabelText('Cédula o RUC'), '1710034065')
    await user.type(within(dlg).getByLabelText('Domicilio'), 'Av. Amazonas N21-45')
    await user.type(within(dlg).getByLabelText(/Motivo de los cambios/), 'Datos según la cédula presentada')
    await user.click(within(dlg).getByRole('button', { name: 'Guardar datos del principal' }))
    expect(await within(dlg).findByText('Datos del comprador principal guardados.')).toBeInTheDocument()
    // Apoderado, relacionado con el contrato.
    await user.click(within(dlg).getByRole('button', { name: 'Apoderado' }))
    const form = within(dlg).getByRole('form', { name: 'Datos del apoderado' })
    await user.type(within(form).getByLabelText(/Nombres y apellidos/), 'Pablo Andrade Mora')
    await user.type(within(form).getByLabelText(/Detalle del poder/), 'Notaría 12 de Quito')
    await user.click(within(form).getByRole('button', { name: 'Guardar' }))
    expect(await within(dlg).findByText('Pablo Andrade Mora')).toBeInTheDocument()
    cleanup()
    // Y la entidad vendedora, en Plantillas y formatos.
    await abrirComo(legal)
    await irAPlantillas(user)
    expect(await screen.findByText(/Faltan datos de la entidad vendedora/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Razón social'), 'Inmobiliaria Prueba S.A.')
    await user.type(screen.getByLabelText('RUC (13 dígitos)'), '1791234567001')
    await user.type(screen.getByLabelText('Domicilio'), 'Quito')
    await user.type(screen.getByLabelText('Representante legal'), 'Ana Representante')
    await user.type(screen.getByLabelText('Cargo'), 'Gerente general')
    await user.type(screen.getByLabelText(/Motivo del cambio/), 'Datos entregados por Legal')
    await user.click(screen.getByRole('button', { name: 'Guardar entidad vendedora' }))
    expect(await screen.findByText('Datos de la entidad vendedora guardados.')).toBeInTheDocument()
    cleanup()
    // Ahora sí.
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Generar documento ${contrato.codigo}` }))
    dlg = await screen.findByRole('dialog', { name: /Generar documento/ })
    await user.type(await within(dlg).findByLabelText('Lugar de firma *'), 'Quito')
    await user.click(within(dlg).getByRole('button', { name: 'Verificar datos y previsualizar' }))
    const vista = await within(dlg).findByRole('article', { name: 'Vista previa del documento' })
    expect(within(vista).getByText(/Compra Comprador .*documento 1710034065, domiciliado en Av\. Amazonas N21-45/)).toBeInTheDocument()
    expect(within(vista).getByText(/Vende Inmobiliaria Prueba S\.A\., RUC 1791234567001/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole('button', { name: 'Generar documento' }))
    expect(await screen.findByText('Documento generado y guardado en Supabase.')).toBeInTheDocument()
    const v = await uno<{ estado: string; numero: number; pdf_ruta: string; pdf_hash: string; docx_ruta: string; docx_hash: string; generado_nombre: string; datos: { apoderados: unknown[] } }>(`select estado, numero, pdf_ruta, pdf_hash, docx_ruta, docx_hash, generado_nombre, datos from public.contract_document_versions where contract_id = $1`, [contrato.id])
    expect(v).toMatchObject({ estado: 'borrador', numero: 1, generado_nombre: 'Luis Legal' })
    expect(v.datos.apoderados).toHaveLength(1)
    const pdf = archivos.get(`documentos-contratos/${v.pdf_ruta}`)!
    const docx = archivos.get(`documentos-contratos/${v.docx_ruta}`)!
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(await sha256(pdf)).toBe(v.pdf_hash)
    expect(await sha256(docx)).toBe(v.docx_hash)
    // El Word se vuelve a abrir y conserva el contenido real.
    expect(new PizZip(docx).file('word/document.xml')!.asText()).toContain('Inmobiliaria Prueba S.A.')
    expect(await uno(`select estado, precio, fecha_contrato from public.contracts where id = $1`, [contrato.id])).toEqual(antes.contrato)
    expect((await db.query(`select numero, monto, vencimiento from public.installments where contract_id = $1 order by numero`, [contrato.id])).rows).toEqual(antes.cuotas)
  }, 180_000)

  it('las descargas comprueban la huella: un archivo alterado no se entrega', async () => {
    const user = userEvent.setup()
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Descargar PDF ${contrato.codigo}` }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    const v = await uno<{ pdf_ruta: string }>(`select pdf_ruta from public.contract_document_versions where contract_id = $1`, [contrato.id])
    const clave = `documentos-contratos/${v.pdf_ruta}`
    const original = archivos.get(clave)!
    archivos.set(clave, new TextEncoder().encode('alterado'))
    await user.click(screen.getByRole('button', { name: `Descargar PDF ${contrato.codigo}` }))
    expect(await screen.findByText(/no coincide con su huella/)).toBeInTheDocument()
    archivos.set(clave, original)
  }, 90_000)

  it('adjuntar no firma; Gerencia autoriza, Legal adjunta y valida, y el contrato conserva su estado comercial', async () => {
    const user = userEvent.setup()
    // Antes de emitir no se puede adjuntar.
    await abrirComo(legal)
    expect(await screen.findByRole('button', { name: `Adjuntar firmado ${contrato.codigo}` })).toBeDisabled()
    cleanup()
    await abrirComo(gerente)
    await user.click(await screen.findByRole('row', { name: `Abrir ${contrato.codigo}` }))
    await user.click(await screen.findByRole('button', { name: 'Autorizar emisión' }))
    let dlg = await screen.findByRole('dialog', { name: 'Autorizar emisión' })
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Revisado: se autoriza la emisión')
    await user.click(within(dlg).getByRole('button', { name: 'Autorizar' }))
    expect((await screen.findAllByText(/Emisión autorizada: el documento/)).length).toBeGreaterThan(0)
    cleanup()
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Adjuntar firmado ${contrato.codigo}` }))
    dlg = await screen.findByRole('dialog', { name: 'Adjuntar documento firmado' })
    await user.upload(within(dlg).getByLabelText(/Documento firmado/), new File(['%PDF-firmado'], 'contrato firmado.pdf', { type: 'application/pdf' }))
    await user.click(within(dlg).getByRole('button', { name: 'Adjuntar' }))
    expect(await screen.findByText(/Legal debe validarlo/)).toBeInTheDocument()
    let v = await uno<{ estado: string; firmado_ruta: string; firmado_hash: string; firma_validada_en: string | null }>(`select estado, firmado_ruta, firmado_hash, firma_validada_en from public.contract_document_versions where contract_id = $1`, [contrato.id])
    expect(v).toMatchObject({ estado: 'pendiente_firma', firma_validada_en: null })
    expect(archivos.get(`documentos-contratos/${v.firmado_ruta}`)).toBeDefined()
    await user.click(screen.getByRole('row', { name: `Abrir ${contrato.codigo}` }))
    await user.click(await screen.findByRole('button', { name: 'Validar firma' }))
    dlg = await screen.findByRole('dialog', { name: 'Validar firma' })
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Firmas verificadas contra el original')
    await user.click(within(dlg).getByRole('button', { name: 'Validar firma' }))
    expect(await screen.findByText(/Firma validada: el documento figura como firmado/)).toBeInTheDocument()
    v = await uno(`select estado, firmado_ruta, firmado_hash, firma_validada_en from public.contract_document_versions where contract_id = $1`, [contrato.id])
    expect(v.estado).toBe('firmado')
    expect((await uno<{ estado: string }>(`select estado from public.contracts where id = $1`, [contrato.id])).estado).toBe('borrador')
  }, 180_000)

  it('el historial muestra versiones y eventos, y se recupera el firmado', async () => {
    const user = userEvent.setup()
    await abrirComo(finanzas)
    await user.click(await screen.findByRole('button', { name: `Historial de documentos ${contrato.codigo}` }))
    const dlg = await screen.findByRole('dialog', { name: /Historial de documentos/ })
    expect(within(within(dlg).getByRole('table', { name: 'Versiones del documento' })).getAllByText('Firmado').length).toBeGreaterThan(0)
    const ev = await within(dlg).findByRole('region', { name: 'Eventos del documento' })
    for (const a of ['Generar documento', 'Autorizar emisión', 'Adjuntar documento firmado', 'Validar firma']) expect(within(ev).getByText(a)).toBeInTheDocument()
    // Finanzas consulta, pero no genera ni adjunta.
    expect(screen.queryByRole('button', { name: `Generar documento ${contrato.codigo}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Adjuntar firmado ${contrato.codigo}` })).not.toBeInTheDocument()
  }, 90_000)

  it('quien vende ve su contrato sin documentos ni plantillas; el Constructor no ve contratos', async () => {
    await abrirComo(carlos)
    expect(await screen.findByRole('row', { name: `Abrir ${contrato.codigo}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `Descargar PDF ${contrato.codigo}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plantillas y formatos' })).not.toBeInTheDocument()
    cleanup()
    await abrirComo(constructor)
    await screen.findByRole('heading', { name: 'Ventas y contratos' })
    await waitFor(() => expect(screen.queryByText('Cargando ventas…')).not.toBeInTheDocument())
    expect(screen.queryByRole('row', { name: `Abrir ${contrato.codigo}` })).not.toBeInTheDocument()
    expect(screen.queryByText(/Comprador /)).not.toBeInTheDocument()
  }, 90_000)

  it('una plantilla retirada deja de ofrecerse para nuevas emisiones; una nueva versión se puede crear', async () => {
    const user = userEvent.setup()
    await abrirComo(legal)
    await irAPlantillas(user)
    await user.click(await screen.findByRole('button', { name: 'Retirar Compraventa estándar v1' }))
    const dlg = await screen.findByRole('dialog')
    await user.type(within(dlg).getByLabelText('Motivo *'), 'Se detectó un error en la redacción')
    await user.click(within(dlg).getByRole('button', { name: 'Retirar plantilla' }))
    expect(await screen.findByText('Plantilla retirada.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Nueva versión' }))
    const nv = await screen.findByRole('dialog', { name: /Nueva versión de/ })
    expect(within(nv).getByRole('button', { name: 'Guardar como borrador' })).toBeEnabled()
    await user.click(within(nv).getByRole('button', { name: 'Cancelar' }))
    cleanup()
    const otro = await contratoNuevo()
    await abrirComo(legal)
    await user.click(await screen.findByRole('button', { name: `Generar documento ${otro.codigo}` }))
    expect(await screen.findByText(/No hay plantillas aprobadas/)).toBeInTheDocument()
  }, 180_000)
})
