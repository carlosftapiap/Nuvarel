import { useState } from 'react'
import DesistimientoDialog from '@/features/clientes/components/DesistimientoDialog'
import { useReservaFlujo } from '../flujo'
import type { Reserva } from '../model'
import type { AccionReserva } from '../siguiente'
import { AnularDialog, AprobarDialog, ConfirmarDialog, RechazarPagoDialog } from './DialogosReserva'
import RegistrarPagoDialog from './RegistrarPagoDialog'

export type DialogoReserva = 'verificar' | 'registrar' | 'rechazar' | 'autorizar' | 'anular' | 'desistimiento'

/** Diálogo que abre cada acción principal. */
export const DIALOGO_DE: Record<AccionReserva, DialogoReserva> = { registrar_pago: 'registrar', reenviar_pago: 'registrar', verificar_pago: 'verificar', autorizar: 'autorizar' }

/**
 * Acciones sobre una reserva con sus diálogos de siempre. Las usan Reservas y el inicio de cada perfil,
 * así cualquier pantalla abre el mismo diálogo, con las mismas validaciones y el mismo flujo en el servidor.
 */
export function useAccionesReserva(avisar: (m: string) => void, fallar: (m: string) => void) {
  const flujo = useReservaFlujo()
  const [abierto, setAbierto] = useState<{ tipo: DialogoReserva; r: Reserva } | null>(null)
  const de = (t: DialogoReserva) => (abierto?.tipo === t ? abierto.r : null)
  const cerrar = () => setAbierto(null)
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); avisar(ok) } catch (e) { fallar((e as Error).message) }
  }
  const dialogos = (
    <>
      <ConfirmarDialog reserva={de('verificar')} onClose={cerrar}
        onConfirm={(input) => {
          const r = abierto!.r
          void flujo.verificarPago(r.id, input)
            .then((estado) => avisar(estado === 'confirmada' ? `Ingreso de ${r.codigo} verificado · reserva confirmada y unidad reservada` : `Ingreso de ${r.codigo} verificado · tiene una excepción: la autoriza Gerencia`))
            .catch((e: Error) => fallar(e.message))
          cerrar()
        }} />
      <RegistrarPagoDialog reserva={de('registrar')} onClose={cerrar}
        onConfirm={(pago) => { const r = abierto!.r; void run(() => flujo.registrarPago(r, pago), `Pago de ${r.codigo} registrado · pendiente de verificación de Finanzas`); cerrar() }} />
      <RechazarPagoDialog reserva={de('rechazar')} onClose={cerrar}
        onConfirm={(motivo) => { const r = abierto!.r; void run(() => flujo.rechazarPago(r.id, motivo), `Pago de ${r.codigo} rechazado · la reserva vuelve a esperar el pago`); cerrar() }} />
      <AprobarDialog reserva={de('autorizar')} onClose={cerrar}
        onConfirm={(motivo) => { const r = abierto!.r; void run(() => flujo.aprobar(r.id, motivo), `Reserva ${r.codigo} autorizada · unidad reservada`); cerrar() }} />
      <AnularDialog reserva={de('anular')} onClose={cerrar}
        onConfirm={(motivo) => { const r = abierto!.r; void run(() => flujo.anular(r.id, motivo), `Reserva ${r.codigo} anulada`); cerrar() }} />
      {de('desistimiento') && (
        <DesistimientoDialog clienteId={abierto!.r.clienteId} oportunidadId={abierto!.r.oportunidadId ?? undefined} onClose={cerrar}
          onDone={async (m) => { await flujo.recargar(); avisar(m) }} />
      )}
    </>
  )
  return { flujo, abrir: (tipo: DialogoReserva, r: Reserva) => setAbierto({ tipo, r }), dialogos }
}
