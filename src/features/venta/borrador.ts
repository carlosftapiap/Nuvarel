import { condicionesIniciales, CREDITO_VACIO, type CondicionesFinanciamiento } from '@/features/financiamiento/condiciones'

/**
 * Lo que el vendedor lleva escrito en la operación. Solo identificadores y condiciones: la operación real vive en Supabase.
 * Se guarda en la sesión del navegador: sobrevive a cambiar de pantalla y a recargar la página.
 */
export interface PlanConfirmado {
  /** Huella del plan que el vendedor confirmó. */
  version: string
  precioFinal: number
}

export interface Borrador {
  clienteId: string
  codigo: string
  vigencia: string
  observaciones: string
  cotizacionId: string
  financiamiento: CondicionesFinanciamiento
  planConfirmado: PlanConfirmado | null
}

export const borradorVacio = (fecha: string): Borrador => ({
  clienteId: '', codigo: '', vigencia: '15', observaciones: '', cotizacionId: '', financiamiento: condicionesIniciales(fecha), planConfirmado: null,
})

export const claveBorrador = (actorId: string) => `amura.venta.borrador.${actorId}`
export const claveSimulacion = (actorId: string) => `amura.financiamiento.simulacion.${actorId}`

/** Lee lo guardado completando lo que falte: una versión anterior del borrador sigue funcionando. */
export function leerCondiciones(clave: string, fecha: string): CondicionesFinanciamiento {
  const base = condicionesIniciales(fecha)
  try {
    const g = JSON.parse(sessionStorage.getItem(clave) ?? 'null') as Partial<CondicionesFinanciamiento> | null
    if (!g) return base
    return { ...base, ...g, credito: { ...CREDITO_VACIO, ...g.credito }, extras: g.extras ?? [] }
  } catch {
    return base
  }
}

export function leerBorrador(actorId: string, fecha: string): Borrador {
  const base = borradorVacio(fecha)
  try {
    const g = JSON.parse(sessionStorage.getItem(claveBorrador(actorId)) ?? 'null') as Partial<Borrador> | null
    if (!g) return base
    return { ...base, ...g, financiamiento: { ...base.financiamiento, ...g.financiamiento, credito: { ...CREDITO_VACIO, ...g.financiamiento?.credito }, extras: g.financiamiento?.extras ?? [] } }
  } catch {
    return base
  }
}

export function guardarJson(clave: string, valor: unknown) {
  try { sessionStorage.setItem(clave, JSON.stringify(valor)) } catch { /* sin almacenamiento: solo en esta pantalla */ }
}
