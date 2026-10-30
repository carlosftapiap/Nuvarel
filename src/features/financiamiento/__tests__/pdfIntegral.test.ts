import { describe, expect, it } from 'vitest'
import { calcularEntrada } from '@/features/cobranza/entrada'
import { simularHipoteca } from '../hipoteca'
import { construirPdfIntegral } from '../pdfIntegral'

describe('cotización integral en PDF', () => {
  const entrada = calcularEntrada({ precioFinal: 170000, reserva: 1000, meses: 30 })
  const credito = simularHipoteca({
    precio: 170000, entrada: entrada.entradaTotal, plazoMeses: 240, amortizacion: 'francesa',
    manual: { tasa: 9, tasaEs: 'nominal', tipoTasa: 'fija', desgravamenPctMensual: null, incendioPctAnual: null, gastosFijos: null, avaluo: null },
  })
  const doc = construirPdfIntegral({
    numero: 'SIM-2026-0001', fecha: '2026-10-29', cliente: 'Cliente de prueba', asesor: 'Asesor de prueba',
    unidad: { codigo: 'E1-PB-A2', dpt: '1002', edificio: 1, tipologia: '2 hab' }, precioFinal: 170000, fechaFirma: '2026-11-15', entrada, credito,
  })
  const texto = doc.output()

  it('incluye el número, la entrada y el crédito con su aviso de simulación', () => {
    expect(texto).toContain('SIM-2026-0001')
    expect(texto).toContain('USD 34.000,00')
    expect(texto).toContain('USD 9.200,00')
    expect(texto).toContain('USD 136.000,00')
    expect(texto).toContain('aprobaci') // "sujeta a aprobación bancaria"
  })

  it('declara los seguros y gastos faltantes en lugar de omitirlos', () => {
    expect(texto).toContain('no son gratuitos')
  })

  it('genera un documento PDF válido', () => {
    expect(texto.startsWith('%PDF-')).toBe(true)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })
})
