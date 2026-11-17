// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import type { Datos } from '@/features/conexion/datos'
import { cargarPlano, leerUnidades, planoDeUnidad, planoVigente, revisarNuevoPlano, tituloPlano, type Plano } from '../planos'

const plano = (o: Partial<Plano>): Plano => ({
  id: 'p', tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null, nivelEnPlano: 'PB', unidadesEnPlano: [], archivoNombre: 'x.pdf',
  ruta: 'E2/PB/x.pdf', paginas: 1, estado: 'publicado', inconsistencias: [], motivoRechazo: null, cargadoEn: '', ...o,
})
const B001 = { codigo: 'E2-PB-A1', edificio: 2, piso: 'PB' }

async function pdf(paginas = 1) {
  const d = await PDFDocument.create()
  for (let i = 0; i < paginas; i++) d.addPage()
  return new File([new Uint8Array(await d.save())], 'plano.pdf', { type: 'application/pdf' })
}

describe('plano de un departamento', () => {
  it('sin plano individual usa el de planta del piso y lo rotula como tal', () => {
    const p = planoDeUnidad([plano({})], B001)
    expect(p?.tipo).toBe('piso')
    expect(tituloPlano(p!, 'B001')).toBe('Plano de planta del piso · Edificio B · Planta baja')
    expect(tituloPlano(p!, 'B001')).not.toMatch(/departamento/)
  })

  it('prefiere el plano individual del departamento cuando está publicado', () => {
    const p = planoDeUnidad([plano({}), plano({ id: 'u', tipo: 'unidad', unidadCodigo: 'E2-PB-A1' })], B001)
    expect(p?.id).toBe('u')
    expect(tituloPlano(p!, 'B001')).toBe('Plano del departamento B001')
  })

  it('nunca ofrece planos en revisión, pendientes, reemplazados ni rechazados', () => {
    for (const estado of ['en_revision', 'pendiente_aprobacion', 'reemplazado', 'rechazado'] as const) {
      expect(planoDeUnidad([plano({ estado })], B001)).toBeNull()
    }
  })

  it('no mezcla edificios ni pisos', () => {
    expect(planoDeUnidad([plano({ edificio: 1 }), plano({ piso: '1' })], B001)).toBeNull()
  })
})

describe('carga de planos', () => {
  it('lee las unidades tal como están escritas, sin repetir', () => {
    expect(leerUnidades('b-101, B-102; B-102 / B103')).toEqual(['B-101', 'B-102', 'B103'])
  })

  it('solo pide archivo y, si es individual, el departamento; la numeración del plano es opcional', () => {
    const e = revisarNuevoPlano({ tipo: 'unidad', edificio: 1, piso: 'PB', unidadCodigo: null, archivo: null })
    expect(e).toEqual(['Selecciona el archivo PDF del plano.', 'Elige el departamento del plano individual.'])
  })

  it('carga normal sin numeración: envía nivel nulo, ninguna unidad y no reemplaza', async () => {
    const d = { rpc: vi.fn(async () => ({ id: 'n', estado: 'publicado', inconsistencias: [] })) } as unknown as Datos
    const almacen = { subir: vi.fn(async () => undefined), descargar: vi.fn() } as unknown as AlmacenContratos
    await cargarPlano(d, { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null, archivo: await pdf(1) }, false, almacen)
    const args = (d.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0][1]
    expect(args).toMatchObject({ p_nivel_en_plano: null, p_unidades: [], p_reemplazar: false })
  })

  it('reemplazar se envía solo con confirmación explícita', async () => {
    const d = { rpc: vi.fn(async () => ({ id: 'n', estado: 'publicado', inconsistencias: [] })) } as unknown as Datos
    const almacen = { subir: vi.fn(async () => undefined), descargar: vi.fn() } as unknown as AlmacenContratos
    await cargarPlano(d, { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null, archivo: await pdf(1) }, true, almacen)
    const args = (d.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0][1]
    expect(args.p_reemplazar).toBe(true)
  })

  it('planoVigente encuentra el disponible de la misma ubicación', () => {
    const vigente = plano({ id: 'v' })
    expect(planoVigente([vigente], { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null })?.id).toBe('v')
    expect(planoVigente([vigente], { tipo: 'piso', edificio: 2, piso: '1', unidadCodigo: null })).toBeNull()
    expect(planoVigente([plano({ estado: 'en_revision' })], { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null })).toBeNull()
  })

  it('si el registro falla, el archivo subido se quita (no queda huérfano)', async () => {
    const quitar = vi.fn(async () => undefined)
    const almacen: AlmacenContratos = { subir: vi.fn(async () => undefined), descargar: vi.fn(), quitar }
    const d = { rpc: vi.fn(async () => { throw new Error('Solo un administrador puede cargar planos.') }) } as unknown as Datos
    await expect(cargarPlano(d, { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null, nivelEnPlano: 'PB', unidadesEnPlano: ['B-101'], archivo: await pdf() }, false, almacen)).rejects.toThrow(/administrador/)
    expect(quitar).toHaveBeenCalledTimes(1)
    expect((quitar.mock.calls[0] as unknown as [string, string])[1]).toMatch(/^E2\/PB\//)
  })

  it('rechaza un archivo que no es PDF válido antes de subir', async () => {
    const subir = vi.fn()
    const almacen = { subir, descargar: vi.fn() } as unknown as AlmacenContratos
    const malo = new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' })
    await expect(cargarPlano({} as Datos, { tipo: 'piso', edificio: 1, piso: '1', unidadCodigo: null, nivelEnPlano: 'P-1', unidadesEnPlano: ['A101'], archivo: malo }, false, almacen)).rejects.toThrow(/PDF válido/)
    expect(subir).not.toHaveBeenCalled()
  })

  it('envía a la base lo que dice el plano y la huella del archivo', async () => {
    const d = { rpc: vi.fn(async () => ({ id: 'n', estado: 'en_revision', inconsistencias: ['x'] })) } as unknown as Datos
    const almacen = { subir: vi.fn(async () => undefined), descargar: vi.fn() } as unknown as AlmacenContratos
    const r = await cargarPlano(d, { tipo: 'piso', edificio: 2, piso: 'PB', unidadCodigo: null, nivelEnPlano: 'PB', unidadesEnPlano: ['B-101'], archivo: await pdf(1) }, false, almacen)
    expect(r.estado).toBe('en_revision')
    const args = (d.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } }).mock.calls[0][1]
    expect(args).toMatchObject({ p_tipo: 'piso', p_edificio: 2, p_piso: 'PB', p_nivel_en_plano: 'PB', p_unidades: ['B-101'], p_paginas: 1 })
    expect(String(args.p_sha256)).toMatch(/^[0-9a-f]{64}$/)
  })
})
