import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '@/App'

vi.mock('@/lib/supabase', () => ({ supabaseConfigured: false, supabase: {} }))

describe('sin Supabase configurado', () => {
  it('avisa y no muestra módulos ni datos', () => {
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent(/necesita conexión con la base de datos/)
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})
