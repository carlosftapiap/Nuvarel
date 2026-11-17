// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { crearCotizacion, type CotizacionInput } from '@/features/cotizaciones/cotizacion'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import type { Actor } from '@/features/inventario/types'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { datosCaratula, construirExpedienteCotizacion, maestrosFaltantes, subirMaestro, BUCKET_MAESTROS } from '../expediente-datos'
import { nombreExpediente } from '../expediente'

const asesor: Actor = { id: 'u-asesor', nombre: 'Vera Vendedora', rol: 'asesor' }
const input: CotizacionInput = {
  codigo: 'E1-PB-A2',
  cliente: { nombre: 'Cliente de prueba', email: 'cliente@correo.com', telefono: '0990000000' },
  asesor: { nombre: 'Vera Vendedora', email: 'vera@nuvarel.com', telefono: '' },
  descuentoPct: 0, vigenciaDias: 15, fecha: '2026-11-16', observaciones: '',
}
const cotizacion = () => crearCotizacion(createInitialState(), input, asesor, [])

async function pdf(paginas: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < paginas; i++) doc.addPage([595, 842])
  return new Uint8Array(await doc.save())
}

/** Almacén en memoria con los archivos indicados por ruta. */
function almacen(archivos: Record<string, Uint8Array>) {
  const subidas: string[] = []
  const a: AlmacenContratos = {
    async subir(bucket, ruta) { subidas.push(`${bucket}/${ruta}`) },
    async descargar(_bucket, ruta) {
      const b = archivos[ruta]
      if (!b) throw new Error('Object not found')
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
  }
  return { a, subidas }
}

const NATURAL = 'natural/AMURA-01-Formularios-Personas-Naturales.pdf'
const JURIDICA = 'juridica/AMURA-02-Formularios-Personas-Juridicas.pdf'

describe('datos de la carátula', () => {
  it('toma los datos registrados y no inventa representante ni estado de venta', () => {
    const c = cotizacion()
    const d = datosCaratula(c, 'juridica')
    expect(d.cliente).toMatchObject({ nombre: 'Cliente de prueba', tipo: 'juridica', representante: null })
    expect(d.inmueble.departamento).toBe(c.unidad.dpt)
    expect(d.comercial.documento).toBe(c.numero)
    expect(d.comercial.estado).toBe('Cotización sin emitir')
    expect(d.comercial.asesor).toBe('Vera Vendedora')
    expect(d.comercial.precioAcordado).toBe(c.plan.precioFinal)
  })
})

describe('expediente desde el almacenamiento', () => {
  it('sin maestros cargados: lo informa y no genera nada', async () => {
    const { a } = almacen({})
    expect(await maestrosFaltantes(a)).toEqual(['natural', 'juridica'])
    await expect(construirExpedienteCotizacion(cotizacion(), 'natural', a)).rejects.toThrow(/Expediente pendiente.*persona natural/)
  })

  it('con el maestro del tipo elegido: carátula + 14 = 15 páginas y nombre de descarga', async () => {
    const { a } = almacen({ [NATURAL]: await pdf(14) })
    expect(await maestrosFaltantes(a)).toEqual(['juridica'])
    const r = await construirExpedienteCotizacion(cotizacion(), 'natural', a)
    expect(r.paginas).toBe(15)
    expect(r.nombre).toBe(nombreExpediente('Cliente de prueba', cotizacion().unidad.dpt, '2026-11-16'))
  })

  it('persona jurídica usa su propio formulario', async () => {
    const { a } = almacen({ [JURIDICA]: await pdf(14) })
    expect((await construirExpedienteCotizacion(cotizacion(), 'juridica', a)).paginas).toBe(15)
    await expect(construirExpedienteCotizacion(cotizacion(), 'natural', a)).rejects.toThrow(/persona natural/)
  })

  it('un archivo con otro número de páginas no se usa', async () => {
    const { a } = almacen({ [NATURAL]: await pdf(10) })
    await expect(construirExpedienteCotizacion(cotizacion(), 'natural', a)).rejects.toThrow(/10 páginas; se esperaban 14/)
  })

  it('subir valida antes de guardar y usa el bucket privado', async () => {
    const malo = almacen({})
    await expect(subirMaestro('natural', new File([await pdf(9)], 'x.pdf', { type: 'application/pdf' }), malo.a)).rejects.toThrow(/9 páginas/)
    expect(malo.subidas).toEqual([])
    const bueno = almacen({})
    await subirMaestro('natural', new File([await pdf(14)], 'x.pdf', { type: 'application/pdf' }), bueno.a)
    expect(bueno.subidas).toEqual([`${BUCKET_MAESTROS}/${NATURAL}`])
  })
})
