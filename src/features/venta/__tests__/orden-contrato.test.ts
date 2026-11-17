// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { crearCotizacion, type CotizacionInput } from '@/features/cotizaciones/cotizacion'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import type { Actor } from '@/features/inventario/types'
import type { Datos } from '@/features/conexion/datos'
import { construirOrdenContrato, datosOrden, nombreOrden, validarOrden, type DatosClienteOrden, type DatosOrden } from '../ordenContrato'
import { aDatosCliente, construirVistaPrevia, emitirOrden, sha256Hex } from '../ordenContratoRemoto'

const asesor: Actor = { id: 'u-asesor', nombre: 'Vera Vendedora', rol: 'asesor' }
const admin: Actor = { id: 'u-admin', nombre: 'Ana Admin', rol: 'administrador' }
const input = (over: Partial<CotizacionInput> = {}): CotizacionInput => ({
  codigo: 'E1-PB-A2',
  cliente: { nombre: 'Cliente de prueba', documento: '0912345678', email: 'cliente@correo.com', telefono: '0990000000' },
  asesor: { nombre: 'Vera Vendedora', email: 'vera@nuvarel.com', telefono: '' },
  descuentoPct: 0, vigenciaDias: 15, fecha: '2026-11-16', observaciones: '',
  ...over,
})
const cotizacion = (over: Partial<CotizacionInput> = {}, actor: Actor = asesor) => crearCotizacion(createInitialState(), input(over), actor, [])
const cotizacionEn = (codigo: string, over: Partial<CotizacionInput> = {}, actor: Actor = asesor) =>
  crearCotizacion(createInitialState(), input({ codigo, ...over }), actor, [])

const FECHA = '2026-11-16'
const EMPRESA = { nombre: 'Empresa S.A.', documento: '0990000000001', email: '', telefono: '' }
const CLIENTE: DatosClienteOrden = { domicilio: 'Av. Principal 123', estadoCivil: 'Soltero(a)', medioCaptacion: 'Instagram', representante: null }
const REP: DatosClienteOrden = { ...CLIENTE, representante: { nombre: 'Luis Gerente', documento: '0911111111', calidad: 'Gerente general' } }

describe('orden de contrato · datos', () => {
  it('toma los componentes del financiamiento de la cotización y cuadran con el precio final', () => {
    const d = datosOrden(cotizacion(), 'natural', FECHA, CLIENTE)
    expect(validarOrden(d)).toEqual([])
    expect(d.financiero.reserva + d.financiero.cuotasTotal + d.financiero.contraEntrega).toBeCloseTo(d.financiero.precioFinal, 2)
  })

  it('con descuento: el precio de lista menos el descuento es el precio final', () => {
    const d = datosOrden(cotizacion({ descuentoPct: 2 }, admin), 'natural', FECHA, CLIENTE)
    expect(d.financiero.descuentoUsd).toBeGreaterThan(0)
    expect(validarOrden(d)).toEqual([])
  })

  it('los datos de Clientes se pasan a la orden; lo que no existe queda vacío, nunca inventado', () => {
    const d = datosOrden(cotizacion(), 'natural', FECHA, aDatosCliente(undefined))
    expect(d.cliente.direccion).toBeNull()
    expect(d.cliente.estadoCivil).toBeNull()
    expect(d.cliente.medioCaptacion).toBeNull()
    expect(d.cliente.representante).toBeNull()
  })

  it('convierte claves de la base a etiquetas del documento', () => {
    const c = aDatosCliente({ domicilio: ' Calle 9 ', estado_civil: 'union_de_hecho', origen: 'whatsapp', representante_nombre: null })
    expect(c).toEqual({ domicilio: 'Calle 9', estadoCivil: 'Unión de hecho', medioCaptacion: 'WhatsApp', representante: null })
  })

  it('persona jurídica: el representante legal es del cliente y no aparece en una persona natural', () => {
    const d = datosOrden(cotizacion({ cliente: EMPRESA }), 'juridica', FECHA, REP)
    expect(d.cliente.representante?.nombre).toBe('Luis Gerente')
    expect(validarOrden(d)).toEqual([])
    expect(datosOrden(cotizacion(), 'natural', FECHA, REP).cliente.representante).toBeNull()
  })
})

describe('orden de contrato · controles', () => {
  const base = (): DatosOrden => datosOrden(cotizacion(), 'natural', FECHA, CLIENTE)

  it('rechaza un financiamiento que no suma el precio final', () => {
    const d = base()
    d.financiero.contraEntrega += 50
    expect(validarOrden(d).join(' ')).toMatch(/suman/)
  })

  it('exige cédula o RUC y nombre del comprador', () => {
    const d = base()
    d.cliente.documento = null
    d.cliente.nombre = '  '
    expect(validarOrden(d)).toEqual(expect.arrayContaining(['Falta el nombre del comprador.', 'Falta la cédula o RUC del comprador.']))
  })

  it('persona jurídica sin representante legal no se puede emitir', () => {
    const d = datosOrden(cotizacion({ cliente: EMPRESA }), 'juridica', FECHA, CLIENTE)
    expect(validarOrden(d)).toEqual(expect.arrayContaining(['Falta el representante legal de la persona jurídica.']))
  })
})

describe('orden de contrato · PDF (Edificio 1 y Edificio 2)', () => {
  const paginas = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

  it('Edificio 1, persona natural: una sola página A4', async () => {
    const bytes = await construirOrdenContrato(datosOrden(cotizacion(), 'natural', FECHA, CLIENTE))
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(Math.round(pdf.getPage(0).getSize().width)).toBe(595)
    expect(Math.round(pdf.getPage(0).getSize().height)).toBe(842)
  })

  it('Edificio 2 (B), persona jurídica con representante y descuento: una sola página', async () => {
    const c = cotizacionEn('E2-PB-A1', { descuentoPct: 2, cliente: EMPRESA }, admin)
    expect(await paginas(await construirOrdenContrato(datosOrden(c, 'juridica', FECHA, REP)))).toBe(1)
  })

  it('datos faltantes (dirección, estado civil, medio): sigue en una página con «No registrado»', async () => {
    expect(await paginas(await construirOrdenContrato(datosOrden(cotizacion(), 'natural', FECHA, aDatosCliente(undefined))))).toBe(1)
  })

  it('no genera un documento con datos inconsistentes', async () => {
    const d = datosOrden(cotizacion(), 'natural', FECHA, CLIENTE)
    d.financiero.precioFinal += 100
    await expect(construirOrdenContrato(d)).rejects.toThrow(/no puede generarse/)
  })

  it('el nombre de descarga queda limpio', () => {
    expect(nombreOrden('María Pérez Ñuñez', 'A103', FECHA)).toBe('AMURA_Orden_Maria_Perez_Nunez_A103_2026-11-16.pdf')
  })
})

/** Datos falsos que registran las llamadas al servidor. */
function datosFalsos(opciones: { rpcError?: string } = {}) {
  const llamadas: { fn: string; args?: Record<string, unknown> }[] = []
  const d = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      llamadas.push({ fn, args })
      if (opciones.rpcError) throw new Error(opciones.rpcError)
      return { id: 'orden-1', version: 2, emitidaEn: '2026-11-16T10:00:00Z', emitidaPor: 'Ana Admin' }
    }),
    select: vi.fn(async () => []),
    insert: vi.fn(),
    update: vi.fn(async () => undefined),
  } as unknown as Datos
  return { d, llamadas }
}

describe('orden de contrato · emisión y historial', () => {
  it('la vista previa no registra nada en el historial', async () => {
    const { d, llamadas } = datosFalsos()
    const bytes = await construirVistaPrevia(d, cotizacion(), 'natural', FECHA)
    expect(bytes.length).toBeGreaterThan(0)
    expect(llamadas).toHaveLength(0)
  })

  it('emitir registra la versión con la huella SHA-256 del PDF que se entrega', async () => {
    const { d, llamadas } = datosFalsos()
    const c = cotizacion()
    const r = await emitirOrden(d, c, 'natural', 'Ana Admin', FECHA)
    expect(r.version).toBe(2)
    expect(r.nombre).toBe(nombreOrden(c.cliente.nombre, c.unidad.dpt, FECHA))
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].fn).toBe('ordenes_contrato_registrar')
    expect(llamadas[0].args?.p_quote_id).toBe(c.id)
    expect(llamadas[0].args?.p_sha256).toBe(await sha256Hex(r.bytes))
    expect(llamadas[0].args?.p_emitida_por_nombre).toBe('Ana Admin')
  })

  it('si el registro falla, la orden no se entrega', async () => {
    const { d } = datosFalsos({ rpcError: 'No tienes permiso para emitir órdenes de contrato.' })
    await expect(emitirOrden(d, cotizacion(), 'natural', 'Ana', FECHA)).rejects.toThrow(/permiso/)
  })

  it('si faltan datos del representante, no se registra nada', async () => {
    const { d, llamadas } = datosFalsos()
    await expect(emitirOrden(d, cotizacion({ cliente: EMPRESA }), 'juridica', 'Ana', FECHA)).rejects.toThrow(/representante legal/)
    expect(llamadas).toHaveLength(0)
  })

  it('el número de versión lo asigna la base de datos; la app no lo calcula', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../ordenContratoRemoto.ts'), 'utf8')
    expect(src).not.toMatch(/version\s*\+\s*1|max\(version\)/)
  })
})

describe('orden de contrato · cumplimiento', () => {
  it('los módulos no contienen datos ni nombres de otros proyectos ni de la persona del Excel de referencia', () => {
    for (const archivo of ['ordenContrato.ts', 'ordenContratoRemoto.ts', 'OrdenContratoPanel.tsx', 'DatosClienteOrdenDialog.tsx']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', archivo), 'utf8')
      for (const prohibido of ['Ferrara', 'FERRARA', 'Viaggio', 'Promomundo', 'PROMOMUNDO', 'NUVAREL', 'Nuvarel', 'CALDERON', 'Calderon', 'PAOLA', 'APOLINARIO', 'INMOCOST']) {
        expect(src, `${archivo} contiene ${prohibido}`).not.toContain(prohibido)
      }
    }
  })

  it('la migración 0020 solo agrega: no modifica filas existentes', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/20261129000000_orden_contrato.sql'), 'utf8').toLowerCase()
    expect(sql).not.toMatch(/\bupdate\s+public\.(quotes|clients|reservations|contracts|payments)/)
    expect(sql).not.toMatch(/\bdelete\s+from\b/)
  })
})
