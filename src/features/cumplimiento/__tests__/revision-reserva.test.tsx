import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Datos } from '@/features/conexion/datos'
import RevisionReserva from '../components/RevisionReserva'
import type { ReservaBandeja } from '../bandeja'

const reserva: ReservaBandeja = {
  id: 'r1', codigo: 'RES-2026-0001', cliente: 'Ana Pérez', clientId: 'c1', unidad: 'E1-P1-A3', monto: 500,
  estado: 'pendiente', grupo: 'pendiente', pagador: 'Ana Pérez · 0900000001', apartadoHasta: '2026-11-19T12:00:00Z', prorrogas: 0, creadaEn: '', creadaPor: 'v1',
}

describe('decisión de Cumplimiento sobre una reserva', () => {
  it('observar exige motivo y envía la decisión con su motivo', async () => {
    const rpc = vi.fn(async () => null)
    const onHecho = vi.fn()
    render(<RevisionReserva reserva={reserva} datos={{ rpc } as unknown as Datos} puedeDecidir onHecho={onHecho} />)
    fireEvent.click(screen.getByRole('button', { name: 'Observar' }))
    const enviar = screen.getByRole('button', { name: 'Enviar observación' })
    expect(enviar).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Falta la firma del formulario' } })
    expect(enviar).toBeEnabled()
    fireEvent.click(enviar)
    await waitFor(() => expect(onHecho).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('reservas_cumplimiento_resolver', { p_id: 'r1', p_estado: 'observado', p_motivo: 'Falta la firma del formulario' })
  })

  it('aprobar no pide motivo', async () => {
    const rpc = vi.fn(async () => null)
    render(<RevisionReserva reserva={reserva} datos={{ rpc } as unknown as Datos} puedeDecidir onHecho={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('reservas_cumplimiento_resolver', { p_id: 'r1', p_estado: 'aprobado', p_motivo: '' }))
  })

  it('sin permiso de revisión no muestra acciones', () => {
    render(<RevisionReserva reserva={reserva} datos={{ rpc: vi.fn() } as unknown as Datos} puedeDecidir={false} onHecho={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull()
    expect(screen.getByText(/Solo el administrador o el Oficial/)).toBeInTheDocument()
  })

  it('muestra el error de la base sin cerrar la decisión', async () => {
    const rpc = vi.fn(async () => { throw new Error('Quien solicita la reserva no puede revisarla') })
    render(<RevisionReserva reserva={reserva} datos={{ rpc } as unknown as Datos} puedeDecidir onHecho={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar aprobación' }))
    expect(await screen.findByText(/no puede revisarla/)).toBeInTheDocument()
  })
})
