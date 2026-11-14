import { describe, expect, it } from 'vitest'
import { errorCelular, normalizarCelular } from '../celular'
import { categoriaCliente } from '../categoria'

describe('celular del cliente', () => {
  it('09XXXXXXXX, 5939XXXXXXXX y +593 9… son el mismo número', () => {
    for (const v of ['0991234567', '099 123 4567', '+593991234567', '+593 99 123 4567', '593991234567']) expect(normalizarCelular(v), v).toBe('+593991234567')
  })

  it('rechaza lo que no es un celular ecuatoriano o un número internacional con +', () => {
    for (const v of ['099123456', '0891234567', '+59322345678', '991234567', '12345678']) expect(normalizarCelular(v), v).toBeNull()
    expect(normalizarCelular('+1 305 555 0123')).toBe('+13055550123')
    expect(normalizarCelular('+34 612 345 678')).toBe('+34612345678')
  })

  it('el celular es obligatorio y el mensaje dice cómo escribirlo', () => {
    expect(errorCelular('')).toMatch(/Ingresa el celular/)
    expect(errorCelular('0291234567')).toMatch(/09/)
    expect(errorCelular('0991234567')).toBeNull()
  })
})

describe('prospecto, cliente y comprador', () => {
  it('se calcula con la identificación y la reserva confirmada', () => {
    expect(categoriaCliente({ etapa: 'nuevo', documento: '' })).toBe('prospecto')
    expect(categoriaCliente({ etapa: 'cotizacion', documento: '1710034065' })).toBe('cliente')
    expect(categoriaCliente({ etapa: 'cotizacion', documento: '1710034066' })).toBe('prospecto')
    expect(categoriaCliente({ etapa: 'reserva', documento: '1710034065' })).toBe('comprador')
  })
})
