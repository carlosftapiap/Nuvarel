// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { crearCotizacion, type CotizacionInput } from '@/features/cotizaciones/cotizacion'
import { construirPdfCotizacion } from '@/features/cotizaciones/pdf'
import { createInitialState } from '@/features/inventario/__tests__/fixtures'
import type { Actor } from '@/features/inventario/types'
import { construirPdfChecklist, PROPUESTAS_PENDIENTES, seccionesChecklist, type DatosChecklist } from '../checklist'
import { construirPdfBorradorFicha, construirPdfFicha, ESPECIFICACIONES_APROBADAS, FICHA_NO_INCLUYE, FICHA_SECCIONES, FICHA_TECNICA } from '../ficha'
import { construirPaquete } from '../paquete'

const asesor: Actor = { id: 'u-asesor', nombre: 'Vera Vendedora', rol: 'asesor' }
const input = (codigo: string): CotizacionInput => ({
  codigo,
  cliente: { nombre: 'Cliente de prueba', email: 'cliente@correo.com', telefono: '0990000000' },
  asesor: { nombre: 'Vera Vendedora', email: 'vera@nuvarel.com', telefono: '' },
  descuentoPct: 0, vigenciaDias: 15, fecha: '2026-11-16', observaciones: '',
})
const cotizacion = (codigo: string) => crearCotizacion(createInitialState(), input(codigo), asesor, [])

const NATURAL: DatosChecklist = {
  tipoPersona: 'natural',
  version: 'Lista provisional de documentos · versión 1',
  documentos: [
    { clave: 'pn_cedula', nombre: 'Cédula de identidad' },
    { clave: 'pn_votacion', nombre: 'Certificado de votación' },
    { clave: 'pn_servicio_basico', nombre: 'Planilla de servicio básico' },
    { clave: 'pn_origen_fondos', nombre: 'Declaración de origen de fondos' },
    { clave: 'pn_conozca_cliente', nombre: 'Formulario Conozca a su Cliente (firmado)' },
  ],
}
const JURIDICA: DatosChecklist = {
  tipoPersona: 'juridica',
  version: 'Lista provisional de documentos · versión 1',
  documentos: [
    { clave: 'pj_ruc', nombre: 'RUC' },
    { clave: 'pj_constitucion', nombre: 'Escritura de constitución' },
    { clave: 'pj_nombramiento', nombre: 'Nombramiento del representante legal' },
    { clave: 'pj_cedula_representante', nombre: 'Cédula del representante legal' },
    { clave: 'pj_accionistas', nombre: 'Nómina de accionistas' },
    { clave: 'pj_origen_fondos', nombre: 'Declaración de origen de fondos' },
    { clave: 'pj_conozca_cliente', nombre: 'Formulario Conozca a su Cliente (firmado)' },
  ],
}
const texto = (doc: { output: () => string }) => doc.output()

describe('checklist de documentos', () => {
  it('agrupa lo configurado en secciones A–C para persona natural, sin inventar secciones vacías', () => {
    const s = seccionesChecklist('natural', NATURAL.documentos)
    expect(s.map((x) => x.letra)).toEqual(['A', 'B', 'C'])
    expect(s[0].items).toEqual(['Cédula de identidad', 'Certificado de votación', 'Planilla de servicio básico'])
    expect(s[2].items).toEqual(['Declaración de origen de fondos'])
  })

  it('persona jurídica usa sus propias secciones A–E', () => {
    const s = seccionesChecklist('juridica', JURIDICA.documentos)
    expect(s.map((x) => x.titulo)).toContain('Accionistas y beneficiarios finales')
    expect(s.flatMap((x) => x.items)).toHaveLength(JURIDICA.documentos.length)
  })

  it('ningún requisito configurado se pierde: los no clasificados van a «Otros»', () => {
    const s = seccionesChecklist('natural', [...NATURAL.documentos, { clave: 'pn_nuevo', nombre: 'Documento nuevo' }])
    expect(s.at(-1)).toMatchObject({ titulo: 'Otros documentos configurados', items: ['Documento nuevo'] })
  })

  it('el documento del comprador no muestra las propuestas pendientes de aprobación', () => {
    const raw = texto(construirPdfChecklist(cotizacion('E1-PB-A2'), NATURAL))
    expect(raw).toContain('Documentos requeridos para compra de departamento')
    expect(raw).toContain('Cédula de identidad')
    for (const p of PROPUESTAS_PENDIENTES.slice(0, 6)) expect(raw).not.toContain(p.requisito)
    expect(raw).not.toContain('Certificado laboral')
  })

  it('el checklist de un departamento del Edificio B y de persona jurídica muestra sus datos', () => {
    const raw = texto(construirPdfChecklist(cotizacion('E2-PB-A1'), JURIDICA))
    expect(raw).toContain('Persona jurídica')
    expect(raw).toContain('B001')
    expect(raw).toContain('Edificio B')
    expect(raw).toContain('Nómina de accionistas')
    expect(raw).not.toContain('E2-PB-A1')
  })

  it('no se genera sin documentos configurados', () => {
    expect(() => construirPdfChecklist(cotizacion('E1-PB-A2'), { ...NATURAL, documentos: [] })).toThrow(/No hay documentos/)
  })
})

describe('ficha técnica', () => {
  it('está provisional: no hay versión aprobada para entregar al cliente', () => {
    expect(FICHA_TECNICA.estado).toBe('provisional')
    expect(ESPECIFICACIONES_APROBADAS).toBeNull()
    expect(() => construirPdfFicha()).toThrow(/no está aprobada/)
  })

  it('conserva las especificaciones del documento fuente, sin cambiar materiales ni alcances', () => {
    const todo = FICHA_SECCIONES.flatMap((s) => s.items).join(' | ')
    expect(todo).toContain('Hormigón armado con muros portantes. Diseño sismo resistente.')
    expect(todo).toContain('Piezas eléctricas bticino o similar. Incluye tres líneas para domotización.')
    expect(todo).toContain('Altura de 2,60 m en todo el departamento.')
    expect(todo).toContain('Pisos: porcelanato en todo el departamento. Rastreras de 8 cm de alto.')
    expect(FICHA_NO_INCLUYE).toContain('Equipos de climatización: splits, central, cableado, etc., e instalación de esos equipos.')
    expect(FICHA_SECCIONES.map((s) => s.titulo)).toEqual(expect.arrayContaining(['Generador y sistemas especiales', 'Áreas sociales interiores', 'Áreas sociales exteriores']))
  })

  it('el borrador interno tiene marca de agua y las contradicciones abiertas; nunca se presenta como entregable', () => {
    const raw = texto(construirPdfBorradorFicha())
    expect(raw).toContain('BORRADOR')
    expect(raw).toContain('Observaciones internas para la constructora')
    expect(raw).toContain('Puertas interiores')
  })
})

describe('paquete completo', () => {
  it('con la ficha provisional incluye cotización y checklist, excluye la ficha y lo informa', () => {
    const { doc, incluidos, faltantes } = construirPaquete(cotizacion('E1-PB-A2'), NATURAL)
    expect(incluidos).toEqual(['Cotización', 'Checklist de documentos (persona natural)'])
    expect(faltantes).toEqual(['Especificaciones técnicas: pendiente de aprobación'])
    const raw = texto(doc)
    expect(raw).toContain('COT-')
    expect(raw).toContain('Documentos requeridos para compra de departamento')
    expect(raw).not.toContain('Hormigón armado')
    // Cotización (sus páginas) + checklist (sus páginas), sin ficha.
    const paginasCot = construirPdfCotizacion(cotizacion('E1-PB-A2')).getNumberOfPages()
    const paginasChk = construirPdfChecklist(cotizacion('E1-PB-A2'), NATURAL).getNumberOfPages()
    expect(doc.getNumberOfPages()).toBe(paginasCot + paginasChk)
  })

  it('la cotización del paquete sigue usando el mismo generador', () => {
    const c = cotizacion('E2-PB-A1')
    expect(construirPdfCotizacion(c).output()).toContain('Departamento B001')
  })
})
