import { describe, expect, it } from 'vitest'
import { edificioDocumento, edificioTecnico, numeroAnterior, numeroComercial, resolverUnidad } from '../nomenclatura'
import { createInitialState } from './fixtures'
import { validarImportacion } from '../excel'

describe('nomenclatura y equivalencias', () => {
  const { units } = createInitialState()
  it('resuelve las 72 unidades y nunca inventa posiciones del edificio A o pisos inexistentes', () => {
    expect(units).toHaveLength(72)
    for (const u of units) {
      expect(numeroComercial(u.codigo)).toBe(u.dpt)
      for (const codigo of [u.codigo,u.dpt,numeroAnterior(u.codigo)]) expect(resolverUnidad(units,codigo)?.codigo).toBe(u.codigo)
    }
    for (const codigo of ['A006','B008','E1-PB-A6','E1-P3-A7','E2-P6-A1']) expect(resolverUnidad(units,codigo)).toBeUndefined()
    expect(numeroComercial('E1-PB-A6')).toBe('E1-PB-A6')
    expect(edificioTecnico('B')).toBe(2)
    expect(edificioTecnico('1')).toBe(1)
  })
  it('detecta duplicados en Excel aunque se usen tres alias de la misma unidad', () => {
    const s=createInitialState()
    const r=validarImportacion(s,['A001','1001','E1-PB-A1'].map((codigo,i)=>({ hoja:'Inventario',fila:i+2,valores:{ codigo } })))
    expect(r.conErrores).toBe(2)
    expect(r.filas.every((f)=>f.codigo==='E1-PB-A1')).toBe(true)
  })
  it('respeta el nombre de edificio en las instantáneas anteriores', () => {
    expect(edificioDocumento({ dpt:'1001',edificio:1 })).toBe('Edificio 1')
    expect(edificioDocumento({ dpt:'A001',edificio:1 })).toBe('Edificio A')
    expect(edificioDocumento({ dpt:'A001',edificio:1,edificioNombre:'Edificio original' })).toBe('Edificio original')
  })
})
