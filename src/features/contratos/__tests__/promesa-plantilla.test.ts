// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { datosParaPlantilla } from '../datos'
import { construirDocxDesdeTexto } from '../docxTexto'
import { etiquetasDeTexto, llenarPlantilla } from '../plantilla'
import type { InstantaneaDocumento } from '../model'

// Borrador de promesa para revisión jurídica: se llena con la misma vía que usa la aplicación (texto → Word → datos).
const cuerpo = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/plantillas/promesa_compraventa_AMURA_borrador.txt'), 'utf8')

const MANUALES = [
  'lugar_firma', 'comparecencia_adicional', 'antecedente_dominio', 'antecedente_proyecto', 'antecedente_permisos', 'antecedente_propiedad_horizontal',
  'linderos_alicuota', 'condicion_credito', 'condicion_mora', 'fecha_entrega_estimada', 'plazo_gracia_entrega', 'condicion_cambios_obra', 'plazo_escritura',
  'notaria', 'obligaciones_vendedora_adicionales', 'obligaciones_comprador_adicionales', 'clausula_penal', 'condicion_desistimiento', 'condicion_devoluciones',
  'condicion_incumplimiento_vendedora', 'reparto_gastos', 'solucion_controversias', 'formalizacion_notarial',
]

/** A103: precio USD 119.729, reserva USD 500, 6 % inicial, 14 % en cuotas, 80 % por crédito. Cuotas de ejemplo (el sistema las calcula). */
function a103(): InstantaneaDocumento {
  const persona = { nombre: 'Cliente de Prueba', documento: '0900000001', nacionalidad: 'ecuatoriana', estado_civil: 'soltero', domicilio: 'Guayaquil', ciudad: 'Guayaquil', telefono: '', email: 'prueba@ejemplo.ec', tipo_persona: 'natural', porcentaje: null } as never
  const cuotas = Array.from({ length: 34 }, (_, i) => ({ numero: i + 2, concepto: `Cuota ${i + 1} de 34`, vencimiento: '2027-01-31', monto: i === 33 ? 16762.06 - 493 * 33 : 493 }))
  return {
    contrato: { codigo: 'CON-PRUEBA-A103', fecha: '2026-12-15' },
    vendedora: { razon_social: 'PARTE VENDEDORA POR CONFIRMAR', ruc: '0990000001001', domicilio: 'Guayaquil', representante_nombre: 'Representante por confirmar', representante_documento: '0900000002', representante_cargo: 'Gerente General', email: 'legal@ejemplo.ec', telefono: '' },
    comprador: persona, compradores: [persona], compradores_adicionales: [], apoderados: [],
    unidad: { codigo: 'E1-P1-A3', departamento: 'A103', edificio: 'Edificio A', piso: '1', tipologia: '1 dormitorio', ubicacion: '', bodega_codigo: 'B-03', parqueo: 'P-03', area_m2: 52.4, bodega_m2: 3, patio_m2: 0 },
    precio: { total: 119729, lista: 119729, descuento_pct: 0 },
    pago: { reserva: 500, firma: 6683.74, num_cuotas: 34, cuota_mensual: 493, total_cuotas: 16762.06, saldo: 95783.2, cuotas, cronograma: [
      { numero: 0, concepto: 'Reserva (se acredita al 6%)', vencimiento: '2026-12-01', monto: 500 },
      { numero: 1, concepto: 'Pago a la firma (completa el 6%)', vencimiento: '2026-12-15', monto: 6683.74 },
      ...cuotas,
      { numero: 36, concepto: 'Saldo contra entrega (80%)', vencimiento: null, monto: 95783.2 },
    ] },
    manual: Object.fromEntries(MANUALES.map((k) => [k, `[${k}]`])),
  }
}

describe('promesa de compraventa AMURA (borrador para Legal)', () => {
  it('solo usa campos del sistema o datos legales declarados, y el cronograma como anexo', () => {
    const { variables, bucles } = etiquetasDeTexto(cuerpo)
    const propias = variables.filter((v) => !v.includes('.'))
    expect(propias.sort()).toEqual([...MANUALES].sort())
    expect(bucles).toEqual(['pago.cronograma'])
  })

  it('se llena con A103: 20 % de entrada (6 % + 14 %), 80 % por crédito y el cronograma completo', async () => {
    const docx = await construirDocxDesdeTexto(cuerpo, { conFirmas: true })
    const { texto } = llenarPlantilla(docx, datosParaPlantilla(a103()))
    expect(texto).not.toMatch(/[{}]/)
    expect(texto).toContain('119.729,00')
    expect(texto).toContain('23.945,80') // entrada total 20 %
    expect(texto).toContain('7.183,74') // pago inicial 6 %, reserva incluida
    expect(texto).toContain('6.683,74') // pago a la firma
    expect(texto).toContain('16.762,06') // 14 % en cuotas
    expect(texto).toContain('95.783,20') // 80 % crédito hipotecario
    expect(texto).toContain('Cuota 34 de 34')
    expect(texto).toContain('PARTE VENDEDORA')
    expect(texto).not.toMatch(/NUVAREL/)
  })
})
