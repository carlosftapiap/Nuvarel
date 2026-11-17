import { describe, expect, it } from 'vitest'
import { errorCelular, normalizarCelular } from '../celular'

describe('celular de usuarios (E.164, Ecuador por defecto)', () => {
  it('normaliza celulares de Ecuador escritos de varias formas', () => {
    expect(normalizarCelular('0991234567')).toBe('+593991234567')
    expect(normalizarCelular('099 123 4567')).toBe('+593991234567')
    expect(normalizarCelular('+593 99 123 4567')).toBe('+593991234567')
    expect(normalizarCelular('593991234567')).toBe('+593991234567')
  })

  it('acepta otros países solo con «+» y su código', () => {
    expect(normalizarCelular('+57 300 123 4567')).toBe('+573001234567')
    expect(normalizarCelular('+1 305 555 0100')).toBe('+13055550100')
    expect(normalizarCelular('3001234567')).toBeNull()
  })

  it('rechaza lo que no es un celular válido', () => {
    expect(normalizarCelular('+593 4 234 5678')).toBeNull() // fijo de Guayaquil
    expect(normalizarCelular('12345')).toBeNull()
    expect(normalizarCelular('abc')).toBeNull()
  })

  it('vacío no es error: el celular es opcional', () => {
    expect(errorCelular('')).toBeNull()
    expect(errorCelular('   ')).toBeNull()
    expect(errorCelular('0991234567')).toBeNull()
    expect(errorCelular('099')).toMatch(/09XXXXXXXX/)
  })
})
