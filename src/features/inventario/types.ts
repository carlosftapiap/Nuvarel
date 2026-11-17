export type Edificio = 1 | 2
export type Piso = 'PB' | '1' | '2' | '3' | '4' | '5'
export type Tipologia = '1 hab' | '2 hab' | '2 hab + estudio'

/** Datos físicos y de lista tal como vienen de los documentos originales. */
export interface UnitSeed {
  codigo: string
  dpt: string
  edificio: Edificio
  piso: Piso
  posicion: number
  ubicacion: string
  tipologia: Tipologia
  areaM2: number
  bodegaCodigo: string | null
  bodegaM2: number
  patioM2: number
  /** USD por m² sobre (área + bodega) de la lista base del 28/10/2026. */
  usdM2: number
  /** Precio de venta con patio de la lista base, sólo para verificación. */
  precioReferencia: number
}

/** Estado de la unidad en el inventario. Aprobación, pago y firma son etapas de la reserva y del contrato, no de la unidad. */
export type EstadoComercial = 'disponible' | 'reservado' | 'vendido'

/** Estados que pueden aparecer en el historial anterior a la simplificación (auditoría). */
export type EstadoHistorico = EstadoComercial | 'por_confirmar' | 'bloqueado' | 'promesa' | 'no_disponible'

/** Solicitud de reserva en trámite. No cambia el estado guardado de la unidad. `cotizacionId` solo llega a quien tiene acceso a ese cliente. */
export interface SolicitudActiva {
  codigo: string
  estado: string
  vigenciaHasta: string | null
  cotizacionId: string | null
}

export interface Unit extends UnitSeed {
  solicitud?: SolicitudActiva | null
  /** USD por m² de la lista base, guardado en la base: lo que restablece «Restablecer lista base». */
  usdM2Lista: number
  estado: EstadoComercial
  /** Identificador de la reserva vinculada (lo asignará el módulo de Reservas). */
  reservaId: string | null
  notas: string
  /** Parqueo asignado; null mientras no exista asignación oficial. */
  parqueo: string | null
  /** Rutas en el almacenamiento privado; vacío mientras no se carguen. */
  planoPath: string | null
  imagenes: string[]
}

export interface PricingParams {
  patioUsdM2: number
  reservaPct: number
  cuotasPct: number
  meses: Record<Edificio, number>
  /** Cuota 1 de todos los edificios cuando la firma es anterior o en ese mes (yyyy-mm-dd). Sin la migración 0017, no aplica. */
  inicioCuotas?: string | null
  /** Propuesta inicial del monto de la reserva. Sin la migración, se usa RESERVA_PREDETERMINADA. */
  reservaPredeterminada?: number
}

/** Identificador de rol (plantillas iniciales o roles creados en Configuración). */
export type Rol = string

export interface Alcance {
  tipo: 'propio' | 'equipo' | 'empresa'
  /** Identificadores de usuario cuyos registros puede ver (propio: él mismo; equipo: su equipo). */
  usuarios: string[]
}

/** Quien ejecuta una acción. La autorización usa `id` y permisos, nunca el nombre mostrado. */
export interface Actor {
  id: string
  nombre: string
  rol: Rol
  /** Permisos efectivos (rol + excepciones). Si falta, se usa la plantilla del rol. */
  permisos?: readonly string[]
  alcance?: Alcance
  proyectos?: string[]
}

export interface PriceChange {
  codigo: string
  antesUsdM2: number
  despuesUsdM2: number
  antesPrecio: number
  despuesPrecio: number
}

export interface PriceHistoryEntry {
  id: string
  fecha: string
  usuario: string
  rol: Rol
  tipo: 'precio_m2' | 'porcentaje' | 'importacion' | 'parametros' | 'restablecer'
  alcance: string
  motivo: string
  detalle: string
  cambios: PriceChange[]
  totalAntes: number
  totalDespues: number
}

export interface StatusHistoryEntry {
  id: string
  fecha: string
  usuario: string
  rol: Rol
  codigo: string
  de: EstadoHistorico
  a: EstadoHistorico
  motivo: string
  reservaId: string | null
}

export interface PriceProposal {
  id: string
  fecha: string
  usuario: string
  rol: Rol
  alcance: { codigos?: string[]; edificio?: Edificio; piso?: Piso; tipologia?: Tipologia }
  modo: 'fijar' | 'porcentaje'
  valor: number
  motivo: string
  descripcion: string
  /** Impacto calculado al momento de proponer. */
  cambios: PriceChange[]
  totalAntes: number
  totalDespues: number
  estado: 'pendiente' | 'aprobada' | 'rechazada'
  resolucion: { usuario: string; rol: Rol; fecha: string; comentario: string } | null
}

export interface InventoryState {
  version: 1
  units: Unit[]
  params: PricingParams
  /** Parámetros de la lista base guardados en la base. */
  listaBase: PricingParams
  priceHistory: PriceHistoryEntry[]
  statusHistory: StatusHistoryEntry[]
  propuestas: PriceProposal[]
}
