import { afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import type { Datos } from '@/features/conexion/datos'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { descargarConstancia, descargarRecibo, huella, leerArchivo, type Comprobante, type Recibo } from '../comprobantes'

afterEach(()=>{ vi.restoreAllMocks(); vi.unstubAllGlobals() })
function capturar() {
  vi.stubGlobal('crypto',webcrypto)
  const crear=vi.fn((_blob: Blob)=> 'blob:original')
  URL.createObjectURL=crear
  URL.revokeObjectURL=vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
  return crear
}
const recibo = (extra: Partial<Recibo> = {}): Recibo => ({
  id:'r',numero:'RP-2026-0001',reservaId:'res',pagoId:null,emisor:'Emisor original',emisorRuc:null,emisorDireccion:null,comprobanteId:null,
  cliente:'Comprador original',documento:'',departamento:'1001',codigoUnidad:'E1-PB-A1',concepto:'Reserva original',monto:600,fechaPago:'2026-10-28',referencia:'ORIGINAL',banco:'Banco original',
  aprobadoNombre:'Finanzas',emitidoEn:'2026-10-28T12:00:00Z',pdfRuta:'recibos/original.pdf',anuladoEn:null,motivoAnulacion:null,...extra,
})

describe('descargas históricas',()=>{
  it('devuelve los bytes originales incluso si el recibo está anulado, sin consultar Inventario',async ()=>{
    const capturada=capturar()
    const original=new TextEncoder().encode('PDF ORIGINAL INALTERADO').buffer
    const datos={ select:vi.fn() } as unknown as Datos
    const almacen={ descargar:vi.fn(async()=>original) } as unknown as AlmacenContratos
    await descargarRecibo(almacen,recibo({ pdfHash:await huella(original),anuladoEn:'2026-11-15',motivoAnulacion:'Anulado después' }),null,datos)
    expect(new Uint8Array(await leerArchivo(capturada.mock.calls[0][0] as unknown as Blob))).toEqual(new Uint8Array(original))
    expect(datos.select).not.toHaveBeenCalled()
  })
  it('un hash distinto o Storage no disponible no provoca reconstrucción del original',async ()=>{
    capturar()
    const almacen={ descargar:vi.fn(async()=>new TextEncoder().encode('OTRO').buffer) } as unknown as AlmacenContratos
    await expect(descargarRecibo(almacen,recibo({ pdfHash:'incorrecto' }))).rejects.toThrow(/integridad/)
    await expect(descargarRecibo(null,recibo())).rejects.toThrow(/original no está disponible/)
  })
  it('un histórico sin original ni instantánea no se completa con datos actuales',async ()=>{
    const datos={ select:vi.fn() } as unknown as Datos
    await expect(descargarRecibo(null,recibo({ pdfRuta:null }),null,datos)).rejects.toThrow(/histórico.*instantánea/)
    const c={ constanciaNumero:'CP-2026-0001' } as Comprobante
    await expect(descargarConstancia(datos,c)).rejects.toThrow(/histórico.*instantánea/)
    expect(datos.select).not.toHaveBeenCalled()
  })
})
