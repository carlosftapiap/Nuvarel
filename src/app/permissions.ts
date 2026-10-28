import type { Actor, Rol } from '@/features/inventario/types'

/* --------------------------------------------------------------- catálogo */

/** Catálogo de permisos por módulo y acción. Los roles son datos configurables que usan estas claves. */
export const CATALOGO = [
  { modulo: 'Dashboard y reportes', permisos: [
    ['dashboard.ver', 'Ver dashboard'],
    ['reportes.ver', 'Ver reportes'],
    ['reportes.exportar', 'Exportar reportes'],
  ] },
  { modulo: 'Inventario', permisos: [
    ['inventario.ver', 'Ver inventario'],
    ['inventario.exportar', 'Exportar a Excel'],
    ['inventario.importar', 'Importar desde Excel'],
    ['inventario.cambiar_estado', 'Cambiar estados comerciales'],
    ['inventario.editar_precios', 'Abrir herramientas de precio'],
    ['inventario.parametros', 'Modificar parámetros de pago'],
  ] },
  { modulo: 'Precios', permisos: [
    ['precios.ver', 'Consultar lista y simular'],
    ['precios.competencia', 'Consultar comparables (competencia)'],
    ['precios.proponer', 'Proponer cambios de precio'],
    ['precios.aprobar', 'Aprobar cambios de precio'],
  ] },
  { modulo: 'Financiamiento', permisos: [
    ['financiamiento.simular', 'Simular con condiciones aprobadas'],
  ] },
  { modulo: 'Clientes y gestión comercial', permisos: [
    ['clientes.ver', 'Ver clientes de su alcance'],
    ['clientes.editar', 'Crear, editar y registrar actividades'],
    ['clientes.asignar', 'Asignar y reasignar asesor'],
    ['clientes.exportar', 'Exportar clientes'],
  ] },
  { modulo: 'Cotizaciones', permisos: [
    ['cotizaciones.ver', 'Consultar cotizaciones'],
    ['cotizaciones.crear', 'Crear y generar PDF'],
    ['cotizaciones.descuento', 'Autorizar descuentos'],
  ] },
  { modulo: 'Reservas', permisos: [
    ['reservas.ver', 'Consultar reservas'],
    ['reservas.solicitar', 'Solicitar reservas'],
    ['reservas.verificar_pago', 'Verificar pago de reserva'],
    ['reservas.confirmar', 'Confirmar reservas'],
    ['reservas.anular', 'Anular reservas'],
  ] },
  { modulo: 'Ventas y contratos', permisos: [
    ['ventas.ver', 'Consultar expediente'],
    ['ventas.preparar', 'Preparar documentos'],
    ['ventas.formalizar', 'Revisar y formalizar'],
  ] },
  { modulo: 'Cobranzas', permisos: [
    ['cobranzas.ver', 'Consultar cobranzas'],
    ['cobranzas.registrar', 'Registrar comprobantes'],
    ['cobranzas.verificar', 'Verificar y conciliar ingresos'],
  ] },
  { modulo: 'Comisiones', permisos: [
    ['comisiones.ver_propias', 'Ver sus comisiones'],
    ['comisiones.calcular', 'Calcular y revisar'],
    ['comisiones.aprobar', 'Aprobar y liquidar'],
  ] },
  { modulo: 'Corredores', permisos: [
    ['corredores.ver', 'Consultar aliados'],
    ['corredores.gestionar', 'Gestionar acuerdos y atribución'],
  ] },
  { modulo: 'Recursos', permisos: [
    ['recursos.ver', 'Consultar documentos'],
    ['recursos.cargar', 'Cargar documentos'],
    ['recursos.publicar', 'Aprobar y publicar'],
  ] },
  { modulo: 'Configuración', permisos: [
    ['config.usuarios', 'Administrar usuarios'],
    ['config.roles', 'Administrar roles y permisos'],
    ['config.equipos', 'Administrar equipos'],
    ['config.auditoria', 'Consultar auditoría'],
    ['config.cobros', 'Definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'],
  ] },
] as const

export type Permiso = (typeof CATALOGO)[number]['permisos'][number][0]
export const TODOS_LOS_PERMISOS: Permiso[] = CATALOGO.flatMap((m) => m.permisos.map((p) => p[0]))
export const ETIQUETA_PERMISO = Object.fromEntries(CATALOGO.flatMap((m) => m.permisos.map(([k, l]) => [k, l]))) as Record<Permiso, string>

/* ------------------------------------------------------- plantillas de rol */

export type TipoAlcance = 'propio' | 'equipo' | 'empresa'
export const ALCANCES: Record<TipoAlcance, string> = {
  propio: 'Sus clientes y operaciones',
  equipo: 'Su equipo (y equipos que supervisa)',
  empresa: 'Toda la empresa',
}

export interface PlantillaRol {
  id: string
  nombre: string
  descripcion: string
  alcance: TipoAlcance
  permisos: Permiso[]
}

const BASE_VENTA: Permiso[] = [
  'dashboard.ver', 'inventario.ver', 'precios.ver', 'financiamiento.simular',
  'clientes.ver', 'clientes.editar', 'cotizaciones.ver', 'cotizaciones.crear',
  'reservas.ver', 'reservas.solicitar', 'comisiones.ver_propias', 'recursos.ver',
]

/** Perfiles iniciales. Son plantillas: el administrador puede editarlas o crear otras. */
export const PLANTILLAS_ROL: PlantillaRol[] = [
  { id: 'administrador', nombre: 'Administrador', descripcion: 'Usuarios, roles, equipos, configuración y accesos', alcance: 'empresa', permisos: [...TODOS_LOS_PERMISOS] },
  {
    id: 'gerencia', nombre: 'Gerencia', descripcion: 'Supervisión comercial, reportes y aprobaciones autorizadas', alcance: 'equipo',
    permisos: [
      ...BASE_VENTA, 'reportes.ver', 'reportes.exportar', 'inventario.exportar', 'inventario.importar', 'inventario.cambiar_estado',
      'inventario.editar_precios', 'precios.competencia', 'precios.proponer', 'clientes.asignar', 'clientes.exportar',
      'cotizaciones.descuento', 'reservas.verificar_pago', 'reservas.confirmar', 'reservas.anular', 'ventas.ver',
      'cobranzas.ver', 'comisiones.calcular', 'corredores.ver', 'config.auditoria',
    ],
  },
  {
    id: 'supervisor', nombre: 'Supervisor', descripcion: 'Seguimiento y asignación dentro de su equipo', alcance: 'equipo',
    permisos: [...BASE_VENTA, 'reportes.ver', 'inventario.exportar', 'precios.competencia', 'clientes.asignar', 'ventas.ver'],
  },
  { id: 'asesor', nombre: 'Vendedor', descripcion: 'Clientes, cotizaciones y solicitudes de reserva propias', alcance: 'propio', permisos: [...BASE_VENTA, 'inventario.exportar', 'precios.competencia'] },
  { id: 'corredor', nombre: 'Corredor externo', descripcion: 'Sus clientes y operaciones autorizadas', alcance: 'propio', permisos: [...BASE_VENTA] },
]

const PLANTILLA = Object.fromEntries(PLANTILLAS_ROL.map((p) => [p.id, p])) as Record<string, PlantillaRol | undefined>

/** Etiquetas de los perfiles iniciales (los roles personalizados muestran su propio nombre). */
export const ROLES: Record<string, { label: string; descripcion: string }> = Object.fromEntries(
  PLANTILLAS_ROL.map((p) => [p.id, { label: p.nombre, descripcion: p.descripcion }]),
)
export const rolLabel = (rol: Rol) => ROLES[rol]?.label ?? rol

/* -------------------------------------------------------------- resolución */

export type Excepcion = 'permitir' | 'denegar'

/** Permisos efectivos: rol + excepciones explícitas. Denegar prevalece; lo no definido se deniega. */
export function resolverPermisos(rolPermisos: readonly Permiso[], excepciones: Partial<Record<Permiso, Excepcion>> = {}): Permiso[] {
  const s = new Set<Permiso>(rolPermisos)
  for (const [p, v] of Object.entries(excepciones) as [Permiso, Excepcion][]) {
    if (v === 'permitir') s.add(p)
    if (v === 'denegar') s.delete(p)
  }
  return TODOS_LOS_PERMISOS.filter((p) => s.has(p))
}

/**
 * Comprueba un permiso. Con un actor de sesión usa sus permisos efectivos;
 * si solo se conoce el rol, usa la plantilla inicial (útil en pruebas y servicios sin sesión).
 */
export function can(sujeto: Actor | Rol, permiso: Permiso) {
  if (typeof sujeto !== 'string' && sujeto.permisos) return sujeto.permisos.includes(permiso)
  const rol = typeof sujeto === 'string' ? sujeto : sujeto.rol
  return PLANTILLA[rol]?.permisos.includes(permiso) ?? false
}

export class PermissionError extends Error {
  constructor(permiso: Permiso) {
    super(`No tienes permiso para esta acción (${ETIQUETA_PERMISO[permiso] ?? permiso}).`)
    this.name = 'PermissionError'
  }
}

export function assertCan(sujeto: Actor | Rol, permiso: Permiso) {
  if (!can(sujeto, permiso)) throw new PermissionError(permiso)
}

/* ------------------------------------------------------------ alcance datos */

/** ¿Puede el actor ver un registro cuyos responsables son ownerIds? Se usa con identificadores, nunca con nombres. */
export function puedeVerDe(actor: Actor, ownerIds: (string | null | undefined)[]) {
  const tipo = actor.alcance?.tipo ?? PLANTILLA[actor.rol]?.alcance ?? 'propio'
  if (tipo === 'empresa') return true
  const visibles = actor.alcance?.usuarios ?? [actor.id]
  return ownerIds.some((o) => !!o && visibles.includes(o))
}
