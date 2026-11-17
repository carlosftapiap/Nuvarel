import { describe, expect, it } from 'vitest'
import { revisarRuc } from '../remoto/CuentasReceptoras'
import { posiblesDuplicados } from '@/features/cobranza/bandeja'
import type { Comprobante } from '@/features/cobranza/comprobantes'

describe('RUC de cuentas oficiales', () => {
  it('acepta sociedades privadas y entidades públicas', () => {
    expect(revisarRuc('0990000001001')).toBeNull()
    expect(revisarRuc('1760000001001')).toBeNull()
  })
  it('rechaza personas naturales y RUC mal formados', () => {
    expect(revisarRuc('0912345678001')).toMatch(/persona natural/)
    expect(revisarRuc('0990000001')).toMatch(/13 dígitos/)
  })
})

describe('posibles comprobantes duplicados', () => {
  const c = (o: Partial<Comprobante>): Comprobante => ({
    id: 'a', reservaId: 'r', pagoId: null, monto: 500, fecha: '2026-11-17', banco: 'Banco Pichincha', referencia: 'TRF-1', ruta: null, archivoNombre: null,
    archivoMime: null, estado: 'reportado', cargadoPor: 'u', cargadoEn: '', motivoRevision: null, medio: 'transferencia', constanciaNumero: null, ...o,
  })
  it('avisa si otro comprobante tiene el mismo monto, fecha y banco', () => {
    const base = c({})
    expect(posiblesDuplicados([base, c({ id: 'b', referencia: 'TRF-2', banco: ' banco pichincha ' })], base)).toBe(1)
  })
  it('no cuenta rechazados ni pagos distintos', () => {
    const base = c({})
    expect(posiblesDuplicados([base, c({ id: 'b', estado: 'rechazado' }), c({ id: 'c', monto: 501 }), c({ id: 'd', fecha: '2026-11-16' })], base)).toBe(0)
  })
})
