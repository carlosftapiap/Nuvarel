import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ErrorPantalla, { recargarSiCambioVersion } from '@/components/ErrorPantalla'

const Roto = (): never => { throw new Error('fallo de pantalla') }

describe('nunca una página en blanco', () => {
  it('un error de pantalla muestra un aviso con salida', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorPantalla><Roto /></ErrorPantalla>)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo abrir esta pantalla')
    expect(screen.getByRole('button', { name: 'Volver a cargar' })).toBeInTheDocument()
    consola.mockRestore()
  })

  it('tras una versión nueva recarga una sola vez, sin bucle', () => {
    sessionStorage.clear()
    const primera = new Event('vite:preloadError', { cancelable: true })
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    recargarSiCambioVersion(primera)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(primera.defaultPrevented).toBe(true)
    const segunda = new Event('vite:preloadError', { cancelable: true })
    recargarSiCambioVersion(segunda)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(segunda.defaultPrevented).toBe(false)
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })
})
