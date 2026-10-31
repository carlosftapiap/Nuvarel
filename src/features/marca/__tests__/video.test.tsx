import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { formatoReal, revisarArchivo } from '../biblioteca'
import { MEDIOS_BASE, medioBanner } from '../medios'
import BannerBienvenida from '../BannerBienvenida'
import VisorMedios from '../VisorMedios'

const FIRMAS: [string, number[]][] = [
  ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]],
  ['image/webp', [...'RIFF'].map((c) => c.charCodeAt(0)).concat([1, 2, 3, 4], [...'WEBP'].map((c) => c.charCodeAt(0)))],
  ['video/mp4', [0, 0, 0, 24, ...[...'ftyp'].map((c) => c.charCodeAt(0))]],
  ['video/webm', [0x1a, 0x45, 0xdf, 0xa3]],
]
const video = MEDIOS_BASE[0]

describe('validación por contenido', () => {
  it.each(FIRMAS)('reconoce %s por sus primeros bytes', (mime, bytes) => {
    expect(formatoReal(new Uint8Array(bytes))).toBe(mime)
  })

  it('un PDF renombrado como foto se rechaza, aunque el navegador declare imagen', async () => {
    await expect(revisarArchivo(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'foto.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/no es una fotografía/)
  })

  it('rechaza archivos vacíos y los que superan el máximo', async () => {
    await expect(revisarArchivo(new File([], 'vacio.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/vacío/)
    const grande = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'grande.jpg', { type: 'image/jpeg' })
    Object.defineProperty(grande, 'size', { value: 15 * 1024 * 1024 + 1 })
    await expect(revisarArchivo(grande)).rejects.toThrow(/15 MB/)
  })
})

describe('video', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('en un teléfono vertical abre el video vertical; sin él, el mismo video', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { unmount } = render(<VisorMedios medios={[video]} inicio={0} onCerrar={() => {}} />)
    expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute('src', '/media/video-vertical.mp4')
    unmount()
    render(<VisorMedios medios={[{ ...video, srcVertical: null }]} inicio={0} onCerrar={() => {}} />)
    expect(screen.getByRole('dialog').querySelector('video')).toHaveAttribute('src', '/media/video-horizontal.mp4')
  })

  it('sin video no hay botón «Ver video»', () => {
    render(<BannerBienvenida medios={MEDIOS_BASE.filter((m) => m.tipo === 'imagen')} />)
    expect(screen.queryByRole('button', { name: 'Ver video' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Conoce AMURA' })).toBeInTheDocument()
  })
})

describe('banner', () => {
  it('usa lo destacado; sin elección, la primera imagen; sin contenido, solo la marca', () => {
    expect(medioBanner(MEDIOS_BASE)?.titulo).toBe('Torres AMURA')
    expect(medioBanner([video, { ...MEDIOS_BASE[2], destacado: false }])?.titulo).toBe('Sala y comedor')
    render(<BannerBienvenida medios={[]} />)
    expect(screen.getByRole('heading', { name: /Un lugar para vivir/ })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
