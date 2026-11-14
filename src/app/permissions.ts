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
    ['inventario.tecnico', 'Ver información técnica, sin precios'],
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
    ['financiamiento.catalogo', 'Administrar tasas y productos bancarios (con fuente y fecha)'],
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
    ['ventas.desistimiento', 'Registrar desistimientos de su alcance'],
    ['ventas.desistimiento_autorizar', 'Autorizar anulación de reservas aprobadas sin dinero'],
    ['ventas.desistimiento_con_dinero', 'Autorizar anulación de reservas con dinero recibido'],
    ['ventas.plantillas_ver', 'Consultar plantillas contractuales y sus versiones'],
    ['ventas.plantillas', 'Crear y editar borradores de plantillas, subir modelos Word y configurar la entidad vendedora'],
    ['ventas.plantillas_aprobar', 'Aprobar y retirar plantillas contractuales'],
    ['ventas.documentos_ver', 'Consultar y descargar documentos contractuales'],
    ['ventas.documentos_generar', 'Generar documentos contractuales desde plantillas aprobadas'],
    ['ventas.documentos_emitir', 'Autorizar la emisión definitiva de documentos contractuales'],
    ['ventas.datos_comprador', 'Completar y corregir datos legales de compradores, compradores adicionales y apoderados'],
  ] },
  { modulo: 'Cobranzas', permisos: [
    ['cobranzas.ver', 'Consultar cobranzas'],
    ['cobranzas.registrar', 'Registrar comprobantes'],
    ['cobranzas.verificar', 'Verificar y conciliar ingresos'],
    ['cobranzas.aplicar_excedente', 'Autorizar la aplicación de excedentes al saldo de financiamiento'],
  ] },
  { modulo: 'Cumplimiento', permisos: [
    ['cumplimiento.ver', 'Consultar y descargar el expediente de cumplimiento'],
    ['cumplimiento.revisar', 'Observar, aprobar o rechazar documentos y expedientes'],
  ] },
  { modulo: 'Comisiones', permisos: [
    ['comisiones.ver_propias', 'Ver sus comisiones'],
    ['comisiones.calcular', 'Calcular y revisar'],
    ['comisiones.aprobar', 'Aprobar y habilitar liquidación'],
    ['comisiones.finanzas', 'Registrar honorario recibido y confirmar pagos'],
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
  { modulo: 'Plan de implementación', permisos: [
    ['plan.ver', 'Consultar el plan (según su alcance)'],
    ['plan.editar', 'Crear y editar actividades'],
    ['plan.asignar', 'Asignar responsables'],
    ['plan.avance', 'Actualizar avances, bloqueos y evidencias'],
    ['plan.reprogramar', 'Reprogramar fechas'],
    ['plan.alcance', 'Modificar pesos, frentes y alcance'],
    ['plan.dependencias', 'Gestionar dependencias'],
    ['plan.cerrar', 'Cerrar, cancelar o reabrir actividades'],
    ['plan.importar', 'Importar desde Excel'],
    ['plan.exportar', 'Exportar a Excel'],
    ['plan.reportes', 'Consultar reportes del plan'],
  ] },
  { modulo: 'Avance de obra', permisos: [
    ['obra.resumen', 'Consultar el resumen de avances oficiales (validados)'],
    ['obra.ver', 'Consultar cronograma, actividades, avances y evidencias'],
    ['obra.editar', 'Crear, editar y reorganizar actividades, fechas, responsables y dependencias'],
    ['obra.avance', 'Registrar avances, controles técnicos y cargar evidencias'],
    ['obra.validar', 'Validar avances, ponderaciones y cronogramas'],
    ['obra.documentos', 'Consultar informes, actas, planos y reportes técnicos'],
    ['obra.importar', 'Importar el cronograma desde Excel'],
    ['obra.exportar', 'Exportar el cronograma y los reportes'],
  ] },
  { modulo: 'Configuración', permisos: [
    ['config.usuarios', 'Administrar usuarios'],
    ['config.roles', 'Administrar roles y permisos'],
    ['config.equipos', 'Administrar equipos'],
    ['config.auditoria', 'Consultar auditoría'],
    ['config.cobros', 'Definir quién recibe los pagos (NUVAREL, JARVAL o fiduciaria)'],
    ['config.multimedia', 'Administrar fotografías y videos del proyecto'],
    ['config.leads', 'Configurar la distribución automática de leads'],
  ] },
] as const

export type Permiso = (typeof CATALOGO)[number]['permisos'][number][0]
export const TODOS_LOS_PERMISOS: Permiso[] = CATALOGO.flatMap((m) => m.permisos.map((p) => p[0]))
export const ETIQUETA_PERMISO = Object.fromEntries(CATALOGO.flatMap((m) => m.permisos.map(([k, l]) => [k, l]))) as Record<Permiso, string>

/* ------------------------------------------------------- plantillas de rol */

export type TipoAlcance = 'propio' | 'equipo' | 'empresa'
export const ALCANCES: Record<TipoAlcance, string> = {
  propio: 'Propios',
  equipo: 'Equipo asignado',
  empresa: 'Todo el proyecto',
}

export interface PlantillaRol {
  id: string
  nombre: string
  descripcion: string
  alcance: TipoAlcance
  permisos: Permiso[]
}

/** Cada responsable consulta y actualiza el avance de sus actividades. */
const BASE_PLAN: Permiso[] = ['plan.ver', 'plan.avance', 'plan.exportar']
const PLAN_SUPERVISION: Permiso[] = [...BASE_PLAN, 'plan.editar', 'plan.asignar', 'plan.reprogramar', 'plan.dependencias', 'plan.cerrar', 'plan.reportes']

const BASE_VENTA: Permiso[] = [
  'dashboard.ver', 'inventario.ver', 'precios.ver', 'financiamiento.simular',
  'clientes.ver', 'clientes.editar', 'cotizaciones.ver', 'cotizaciones.crear',
  'reservas.ver', 'reservas.solicitar', 'ventas.ver', 'ventas.desistimiento', 'cobranzas.ver', 'comisiones.ver_propias', 'recursos.ver', 'obra.resumen',
]

/** Perfiles iniciales. Son plantillas: el administrador puede editarlas o crear otras. */
export const PLANTILLAS_ROL: PlantillaRol[] = [
  { id: 'administrador', nombre: 'Administrador', descripcion: 'Usuarios, roles, equipos, configuración y accesos', alcance: 'empresa', permisos: [...TODOS_LOS_PERMISOS] },
  {
    // Gerencia autoriza las reservas con excepciones; la verificación del ingreso corresponde a Finanzas.
    id: 'gerencia', nombre: 'Gerencia', descripcion: 'Supervisión comercial, reportes y aprobaciones autorizadas', alcance: 'empresa',
    permisos: [
      ...BASE_VENTA, 'reportes.ver', 'reportes.exportar', 'inventario.exportar', 'inventario.importar', 'inventario.cambiar_estado',
      'inventario.editar_precios', 'precios.competencia', 'precios.proponer', 'clientes.asignar', 'clientes.exportar',
      'cotizaciones.descuento', 'reservas.confirmar', 'reservas.anular', 'ventas.desistimiento_autorizar', 'ventas.desistimiento_con_dinero',
      'ventas.plantillas_ver', 'ventas.documentos_ver', 'ventas.documentos_emitir',
      'comisiones.calcular', 'comisiones.aprobar', 'corredores.ver', 'corredores.gestionar', 'config.auditoria',
      ...PLAN_SUPERVISION, 'plan.importar', 'obra.ver', 'obra.validar', 'obra.documentos', 'obra.exportar',
    ],
  },
  {
    id: 'supervisor', nombre: 'Supervisor', descripcion: 'Vende con su propia cartera y supervisa a su equipo', alcance: 'equipo',
    permisos: [...BASE_VENTA, 'reportes.ver', 'inventario.exportar', 'precios.competencia', 'clientes.asignar', 'corredores.ver', 'ventas.desistimiento_autorizar', ...PLAN_SUPERVISION],
  },
  { id: 'asesor', nombre: 'Vendedor', descripcion: 'Clientes, cotizaciones y solicitudes de reserva propias', alcance: 'propio', permisos: [...BASE_VENTA, 'inventario.exportar', 'precios.competencia', ...BASE_PLAN] },
  { id: 'corredor', nombre: 'Corredor', descripcion: 'Sus clientes y operaciones autorizadas', alcance: 'propio', permisos: [...BASE_VENTA] },
  {
    id: 'finanzas', nombre: 'Finanzas', descripcion: 'Verificación de ingresos y cobranzas', alcance: 'empresa',
    permisos: [
      'dashboard.ver', 'reportes.ver', 'reportes.exportar', 'inventario.ver', 'clientes.ver', 'cotizaciones.ver',
      'reservas.ver', 'reservas.verificar_pago', 'ventas.ver', 'cobranzas.ver', 'cobranzas.registrar', 'cobranzas.verificar', 'cobranzas.aplicar_excedente', 'comisiones.finanzas',
      ...BASE_PLAN, 'obra.resumen', 'obra.ver', 'obra.exportar', 'ventas.documentos_ver',
    ],
  },
  {
    id: 'legal', nombre: 'Legal', descripcion: 'Contratos, documentos y formalización', alcance: 'empresa',
    permisos: ['dashboard.ver', 'inventario.ver', 'clientes.ver', 'cotizaciones.ver', 'reservas.ver', 'ventas.ver', 'ventas.preparar', 'ventas.formalizar', 'recursos.ver', 'recursos.cargar', ...BASE_PLAN, 'obra.resumen', 'obra.documentos',
      'ventas.plantillas_ver', 'ventas.plantillas', 'ventas.plantillas_aprobar', 'ventas.documentos_ver', 'ventas.documentos_generar', 'ventas.datos_comprador'],
  },
  {
    // Revisa el expediente antes de la firma. Sin cobranzas, comprobantes, precios, comisiones ni configuración.
    id: 'oficial_cumplimiento', nombre: 'Oficial de Cumplimiento', descripcion: 'Revisión del expediente del cliente antes de la firma, sin acceso a pagos ni precios', alcance: 'empresa',
    permisos: ['clientes.ver', 'reservas.ver', 'ventas.ver', 'ventas.documentos_ver', 'cumplimiento.ver', 'cumplimiento.revisar'],
  },
  { id: 'constructor', nombre: 'Constructor', descripcion: 'Información técnica del proyecto y avance de obra, sin datos comerciales', alcance: 'empresa', permisos: ['inventario.tecnico', 'obra.resumen', 'obra.ver', 'obra.editar', 'obra.avance', 'obra.documentos', 'obra.importar', 'obra.exportar'] },
  {
    // Punto de partida de solo consulta; el administrador ajusta sus permisos en Configuración.
    id: 'jarval', nombre: 'JARVAL (consulta)', descripcion: 'Promotor: consulta según los permisos asignados', alcance: 'empresa',
    permisos: ['dashboard.ver', 'reportes.ver', 'inventario.ver', 'reservas.ver', 'ventas.ver', 'cobranzas.ver', 'plan.ver', 'plan.reportes', 'obra.resumen', 'obra.exportar'],
  },
]

const PLANTILLA = Object.fromEntries(PLANTILLAS_ROL.map((p) => [p.id, p])) as Record<string, PlantillaRol | undefined>

/** Etiquetas de los perfiles iniciales (los roles personalizados muestran su propio nombre). */
/** Cómo se agrupan los permisos en la matriz de Configuración. Crear y editar son un solo permiso en la mayoría de módulos. */
export type AccionPermiso = 'ver' | 'crear' | 'aprobar' | 'anular' | 'otras'
export const ACCIONES: Record<AccionPermiso, string> = { ver: 'Ver', crear: 'Crear y editar', aprobar: 'Aprobar', anular: 'Anular', otras: 'Otras' }
export const ACCION_PERMISO: Record<Permiso, AccionPermiso> = {
  'dashboard.ver': 'ver', 'reportes.ver': 'ver', 'reportes.exportar': 'otras',
  'inventario.ver': 'ver', 'inventario.tecnico': 'ver', 'inventario.exportar': 'otras', 'inventario.importar': 'crear', 'inventario.cambiar_estado': 'crear', 'inventario.editar_precios': 'crear', 'inventario.parametros': 'crear',
  'precios.ver': 'ver', 'precios.competencia': 'ver', 'precios.proponer': 'crear', 'precios.aprobar': 'aprobar',
  'financiamiento.simular': 'ver', 'financiamiento.catalogo': 'crear',
  'clientes.ver': 'ver', 'clientes.editar': 'crear', 'clientes.asignar': 'crear', 'clientes.exportar': 'otras',
  'cotizaciones.ver': 'ver', 'cotizaciones.crear': 'crear', 'cotizaciones.descuento': 'aprobar',
  'reservas.ver': 'ver', 'reservas.solicitar': 'crear', 'reservas.verificar_pago': 'aprobar', 'reservas.confirmar': 'aprobar', 'reservas.anular': 'anular',
  'ventas.ver': 'ver', 'ventas.preparar': 'crear', 'ventas.formalizar': 'aprobar', 'ventas.desistimiento': 'anular', 'ventas.desistimiento_autorizar': 'aprobar', 'ventas.desistimiento_con_dinero': 'aprobar',
  'ventas.plantillas_ver': 'ver', 'ventas.plantillas': 'crear', 'ventas.plantillas_aprobar': 'aprobar', 'ventas.documentos_ver': 'ver', 'ventas.documentos_generar': 'crear', 'ventas.documentos_emitir': 'aprobar', 'ventas.datos_comprador': 'crear',
  'cobranzas.ver': 'ver', 'cobranzas.registrar': 'crear', 'cobranzas.verificar': 'aprobar', 'cobranzas.aplicar_excedente': 'aprobar',
  'cumplimiento.ver': 'ver', 'cumplimiento.revisar': 'aprobar',
  'comisiones.ver_propias': 'ver', 'comisiones.calcular': 'crear', 'comisiones.aprobar': 'aprobar', 'comisiones.finanzas': 'aprobar',
  'corredores.ver': 'ver', 'corredores.gestionar': 'crear',
  'recursos.ver': 'ver', 'recursos.cargar': 'crear', 'recursos.publicar': 'aprobar',
  'plan.ver': 'ver', 'plan.reportes': 'ver', 'plan.editar': 'crear', 'plan.asignar': 'crear', 'plan.avance': 'crear', 'plan.reprogramar': 'crear', 'plan.alcance': 'crear', 'plan.dependencias': 'crear', 'plan.cerrar': 'anular', 'plan.importar': 'otras', 'plan.exportar': 'otras',
  'obra.resumen': 'ver', 'obra.ver': 'ver', 'obra.editar': 'crear', 'obra.avance': 'crear', 'obra.validar': 'aprobar', 'obra.documentos': 'ver', 'obra.importar': 'otras', 'obra.exportar': 'otras',
  'config.usuarios': 'crear', 'config.roles': 'crear', 'config.equipos': 'crear', 'config.auditoria': 'ver', 'config.cobros': 'crear', 'config.multimedia': 'crear', 'config.leads': 'crear',
}

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
