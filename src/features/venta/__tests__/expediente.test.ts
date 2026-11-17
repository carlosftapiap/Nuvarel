// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { construirCaratula, construirExpediente, MAESTROS, nombreExpediente, validarMaestro, type DatosCaratula } from '../expediente'

/** Maestro sintético con el número de páginas indicado (los originales no se guardan en el repositorio). */
async function maestro(paginas: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < paginas; i++) doc.addPage([595, 842])
  return doc.save()
}

const datos = (tipo: 'natural' | 'juridica'): DatosCaratula => ({
  cliente: { nombre: 'Cliente de ejemplo', tipo, documento: tipo === 'juridica' ? '0990000000001' : '0912345678', representante: null, telefono: '0990000000', email: null },
  inmueble: { proyecto: 'AMURA', edificio: 'Edificio A', piso: 'Planta baja', departamento: 'A002', areaM2: 70.55, bodegaM2: 1.98, patioM2: 0, parqueo: null },
  comercial: {
    documento: 'COT-2026-0001', fecha: '2026-11-16', estado: 'Cotización emitida', precioAcordado: 172147.2, reservaPct: 6, cuotasPct: 14, cuotas: 36,
    cuotaMensual: 669.46, ultimaCuota: 669.51, primeraCuota: '2026-12-31', ultimaFecha: '2029-11-30', diaPago: 'Último día del mes', entregaPct: 80, contraEntrega: 137717.76, asesor: 'Vera Vendedora',
  },
})

describe('maestros del expediente', () => {
  it('cada maestro debe tener el número de páginas que le corresponde', async () => {
    await expect(validarMaestro('natural', await maestro(14))).resolves.toBeDefined()
    await expect(validarMaestro('juridica', await maestro(14))).resolves.toBeDefined()
    await expect(validarMaestro('ficha', await maestro(2))).resolves.toBeDefined()
    await expect(validarMaestro('natural', await maestro(10))).rejects.toThrow(/10 páginas; se esperaban 14/)
  })

  it('las referencias de los maestros son las de los archivos adaptados', () => {
    expect(MAESTROS.natural.nombre).toBe('AMURA-01-Formularios-Personas-Naturales.pdf')
    expect(MAESTROS.juridica.paginas).toBe(14)
    expect(MAESTROS.ficha.paginas).toBe(2)
  })
})

describe('expediente de venta', () => {
  it('persona natural: carátula + 14 páginas = 15', async () => {
    const car = await construirCaratula(datos('natural'))
    const { paginas } = await construirExpediente(car, await maestro(14))
    expect(paginas).toBe(15)
  })

  it('persona jurídica: carátula + 14 páginas = 15', async () => {
    const car = await construirCaratula(datos('juridica'))
    const { paginas } = await construirExpediente(car, await maestro(14))
    expect(paginas).toBe(15)
  })

  it('con la ficha aprobada incluida: 17 páginas, con la ficha al final', async () => {
    const car = await construirCaratula(datos('natural'))
    const { paginas } = await construirExpediente(car, await maestro(14), await maestro(2))
    expect(paginas).toBe(17)
  })

  it('la carátula solo muestra lo registrado y no presenta la cotización como venta', async () => {
    const car = await PDFDocument.load(await construirCaratula(datos('natural')))
    expect(car.getPageCount()).toBe(1)
    const titulo = car.getTitle()
    expect(titulo).toContain('COT-2026-0001')
  })

  it('el nombre de descarga queda limpio y con la operación', () => {
    expect(nombreExpediente('María Pérez Ñuñez', 'A103', '2026-11-16')).toBe('AMURA_Expediente_Maria_Perez_Nunez_A103_2026-11-16.pdf')
    expect(nombreExpediente('   ', 'B001', '2026-11-16')).toBe('AMURA_Expediente_Cliente_B001_2026-11-16.pdf')
  })
})
