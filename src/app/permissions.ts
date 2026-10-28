import type { Rol } from '@/features/inventario/types'

export type Permiso =
  | 'inventario.ver'
  | 'inventario.exportar'
  | 'inventario.editar_precios'
  | 'inventario.cambiar_estado'
  | 'inventario.importar'
  | 'inventario.parametros'
  | 'precios.proponer'
  | 'precios.aprobar'
  | 'precios.competencia'
  | 'cotizaciones.crear'
  | 'cotizaciones.descuento'
  | 'clientes.ver_todos'
  | 'clientes.editar'
  | 'clientes.asignar'

export const ROLES: Record<Rol, { label: string; descripcion: string }> = {
  administrador: { label: 'Administrador', descripcion: 'Control total del sistema' },
  gerencia: { label: 'Gerencia comercial', descripcion: 'Aprueba precios y estados' },
  asesor: { label: 'Asesor comercial', descripcion: 'Consulta y cotiza' },
  corredor: { label: 'Corredor externo', descripcion: 'Consulta el inventario' },
}

/**
 * Matriz de permisos de la interfaz. La autorización efectiva vive en RLS/RPC de Supabase
 * (ver supabase/migrations); esto sólo evita mostrar acciones no permitidas.
 */
const MATRIZ: Record<Permiso, Rol[]> = {
  'inventario.ver': ['administrador', 'gerencia', 'asesor', 'corredor'],
  'inventario.exportar': ['administrador', 'gerencia', 'asesor'],
  /** Abrir las herramientas de cambio de precio (proponer o aprobar). */
  'inventario.editar_precios': ['administrador', 'gerencia'],
  'inventario.cambiar_estado': ['administrador', 'gerencia'],
  'inventario.importar': ['administrador', 'gerencia'],
  'inventario.parametros': ['administrador'],
  // Gerencia propone cambios de precio; sólo el administrador los aprueba y pasan a ser oficiales.
  'precios.proponer': ['administrador', 'gerencia'],
  'precios.aprobar': ['administrador'],
  // Los corredores externos no ven la lista de la competencia.
  'precios.competencia': ['administrador', 'gerencia', 'asesor'],
  'cotizaciones.crear': ['administrador', 'gerencia', 'asesor', 'corredor'],
  'cotizaciones.descuento': ['administrador', 'gerencia'],
  // Los corredores externos solo ven y gestionan sus propios clientes.
  'clientes.ver_todos': ['administrador', 'gerencia', 'asesor'],
  'clientes.editar': ['administrador', 'gerencia', 'asesor', 'corredor'],
  'clientes.asignar': ['administrador', 'gerencia'],
}

export function can(rol: Rol, permiso: Permiso) {
  return MATRIZ[permiso].includes(rol)
}

export class PermissionError extends Error {
  constructor(permiso: Permiso) {
    super(`No tienes permiso para esta acción (${permiso}).`)
    this.name = 'PermissionError'
  }
}

export function assertCan(rol: Rol, permiso: Permiso) {
  if (!can(rol, permiso)) throw new PermissionError(permiso)
}
