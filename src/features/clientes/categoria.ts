import { errorDocumento } from './duplicados'
import type { Cliente } from './model'

/**
 * Prospecto: sin identificación válida (puede recibir seguimiento y cotizaciones, no reservar).
 * Cliente: con cédula, pasaporte o RUC válido. Comprador: con una reserva confirmada (etapa Reserva).
 * Se calcula con los datos de la ficha: al anular la reserva, la etapa deja de ser Reserva y la categoría se recalcula.
 */
export type Categoria = 'prospecto' | 'cliente' | 'comprador'

export const CATEGORIAS: Record<Categoria, { label: string; clase: string }> = {
  prospecto: { label: 'PROSPECTO', clase: 'bg-slate-100 text-slate-700 ring-slate-300' },
  cliente: { label: 'CLIENTE', clase: 'bg-sky-50 text-sky-800 ring-sky-200' },
  comprador: { label: 'COMPRADOR', clase: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
}

export const identificacionCompleta = (c: Pick<Cliente, 'documento'>) => !!c.documento?.trim() && !errorDocumento(c.documento)

export function categoriaCliente(c: Pick<Cliente, 'etapa' | 'documento'>): Categoria {
  if (c.etapa === 'reserva') return 'comprador'
  return identificacionCompleta(c) ? 'cliente' : 'prospecto'
}

export const AVISO_PROSPECTO = 'Puedes realizar seguimiento y cotizaciones. Para solicitar una reserva debes completar la identificación.'
