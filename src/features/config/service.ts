import { assertCan, can, PLANTILLAS_ROL, resolverPermisos, type Excepcion, type Permiso, type TipoAlcance } from '@/app/permissions'
import type { Actor, Alcance } from '@/features/inventario/types'
import type { DirectorioState, EntradaAuditoria, Equipo, EstadoUsuario, RolDef, Usuario } from './model'

export class ConfigError extends Error {
  constructor(m: string) { super(m); this.name = 'ConfigError' }
}

let seq = 0
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`
const nowIso = () => new Date().toISOString()
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const ID_ADMIN_INICIAL = 'usr-admin-inicial'

/**
 * Estado inicial: los perfiles plantilla y una única cuenta de administrador para empezar.
 * No se crean personas ficticias; el administrador invita a los usuarios reales.
 */
export function directorioInicial(): DirectorioState {
  return {
    version: 1,
    roles: PLANTILLAS_ROL.map((p) => ({ ...p, permisos: [...p.permisos], sistema: true })),
    usuarios: [{
      id: ID_ADMIN_INICIAL, nombre: 'Administrador inicial', email: '', estado: 'activo', rolId: 'administrador',
      excepciones: {}, alcance: null, supervisorId: null, equipoId: null, proyectos: ['AMURA'], creadoEn: nowIso(),
    }],
    equipos: [],
    auditoria: [],
  }
}

/* -------------------------------------------------------------- resolución */

export function rolDe(dir: DirectorioState, u: Usuario) {
  return dir.roles.find((r) => r.id === u.rolId)
}

export function permisosEfectivos(dir: DirectorioState, u: Usuario): Permiso[] {
  if (u.estado !== 'activo') return []
  const rol = rolDe(dir, u)
  return resolverPermisos(rol?.permisos ?? [], u.excepciones)
}

/** Usuarios cuyos registros puede ver: él mismo, su equipo si lo supervisa, y los equipos que gerencia supervisa. */
export function alcanceEfectivo(dir: DirectorioState, u: Usuario): Alcance {
  const tipo: TipoAlcance = u.alcance ?? rolDe(dir, u)?.alcance ?? 'propio'
  if (tipo === 'empresa') return { tipo, usuarios: dir.usuarios.map((x) => x.id) }
  const usuarios = new Set<string>([u.id])
  if (tipo === 'equipo') {
    const equipos = dir.equipos.filter((e) => e.supervisorId === u.id || e.gerenciaIds.includes(u.id)).map((e) => e.id)
    dir.usuarios.filter((x) => x.equipoId && equipos.includes(x.equipoId)).forEach((x) => usuarios.add(x.id))
    // Supervisión directa por persona.
    dir.usuarios.filter((x) => x.supervisorId === u.id).forEach((x) => usuarios.add(x.id))
  }
  return { tipo, usuarios: [...usuarios] }
}

export function actorDe(dir: DirectorioState, u: Usuario): Actor {
  return { id: u.id, nombre: u.nombre, rol: u.rolId, permisos: permisosEfectivos(dir, u), alcance: alcanceEfectivo(dir, u), proyectos: u.proyectos }
}

/* ---------------------------------------------------------------- auditoría */

function auditar(dir: DirectorioState, actor: Actor, e: Omit<EntradaAuditoria, 'id' | 'fecha' | 'actorId' | 'actorNombre'>): DirectorioState {
  const entrada: EntradaAuditoria = { id: newId('aud'), fecha: nowIso(), actorId: actor.id, actorNombre: actor.nombre, ...e }
  return { ...dir, auditoria: [entrada, ...dir.auditoria] }
}

const resumenUsuario = (dir: DirectorioState, u: Usuario) => {
  const rol = rolDe(dir, u)?.nombre ?? u.rolId
  const equipo = dir.equipos.find((e) => e.id === u.equipoId)?.nombre ?? 'sin equipo'
  const sup = dir.usuarios.find((x) => x.id === u.supervisorId)?.nombre ?? 'sin supervisor'
  const exc = Object.entries(u.excepciones).map(([p, v]) => `${v} ${p}`).join(', ') || 'sin excepciones'
  return `${u.estado} · rol ${rol} · alcance ${u.alcance ?? 'del rol'} · ${equipo} · supervisor ${sup} · proyectos ${u.proyectos.join(', ') || 'ninguno'} · ${exc}`
}

function requireMotivo(m: string) {
  if (m.trim().length < 5) throw new ConfigError('Indica el motivo del cambio (mínimo 5 caracteres).')
}

/* ------------------------------------------------------------- anti escalada */

/** Nadie puede conceder permisos que no tiene, ni ampliar los propios. */
function verificarNoEscala(actor: Actor, permisos: readonly Permiso[], objetivoId?: string) {
  if (objetivoId && objetivoId === actor.id) throw new ConfigError('No puedes modificar tu propio rol, permisos ni alcance. Pide a otro administrador que lo haga.')
  const faltan = permisos.filter((p) => !can(actor, p))
  if (faltan.length) throw new ConfigError(`No puedes conceder permisos que no tienes: ${faltan.join(', ')}.`)
}

const activosAdmin = (dir: DirectorioState) => dir.usuarios.filter((u) => u.estado === 'activo' && permisosEfectivos(dir, u).includes('config.usuarios'))

function verificarUltimoAdmin(antes: DirectorioState, despues: DirectorioState) {
  if (activosAdmin(antes).length > 0 && activosAdmin(despues).length === 0) {
    throw new ConfigError('No se puede dejar la empresa sin un administrador activo. Designa otro administrador primero.')
  }
}

/* ----------------------------------------------------------------- usuarios */

export interface UsuarioInput {
  nombre: string
  email: string
  rolId: string
  alcance: TipoAlcance | null
  supervisorId: string | null
  equipoId: string | null
  proyectos: string[]
}

function validarUsuario(dir: DirectorioState, input: UsuarioInput, excluirId?: string) {
  const e: string[] = []
  if (input.nombre.trim().length < 3) e.push('Ingresa el nombre.')
  if (!EMAIL.test(input.email.trim())) e.push('Ingresa un correo válido.')
  if (dir.usuarios.some((u) => u.id !== excluirId && u.email.toLowerCase() === input.email.trim().toLowerCase())) e.push('Ya existe un usuario con ese correo.')
  if (!dir.roles.some((r) => r.id === input.rolId)) e.push('Selecciona un rol válido.')
  if (input.supervisorId && !dir.usuarios.some((u) => u.id === input.supervisorId && u.estado !== 'inactivo')) e.push('El supervisor no existe o está inactivo.')
  if (input.supervisorId && input.supervisorId === excluirId) e.push('Una persona no puede supervisarse a sí misma.')
  if (input.equipoId && !dir.equipos.some((t) => t.id === input.equipoId)) e.push('El equipo no existe.')
  if (e.length) throw new ConfigError(e.join(' '))
}

/**
 * Registra la invitación. En producción la cuenta la crea la función del servidor `invitar-usuario`,
 * que verifica al administrador y envía el correo para que la persona defina su contraseña.
 */
export function invitarUsuario(dir: DirectorioState, input: UsuarioInput, motivo: string, actor: Actor): { dir: DirectorioState; usuario: Usuario } {
  assertCan(actor, 'config.usuarios')
  requireMotivo(motivo)
  validarUsuario(dir, input)
  const rol = dir.roles.find((r) => r.id === input.rolId)!
  verificarNoEscala(actor, rol.permisos)
  const usuario: Usuario = {
    id: newId('usr'), nombre: input.nombre.trim(), email: input.email.trim().toLowerCase(), estado: 'invitado', rolId: input.rolId,
    excepciones: {}, alcance: input.alcance, supervisorId: input.supervisorId, equipoId: input.equipoId, proyectos: [...input.proyectos], creadoEn: nowIso(),
  }
  let next: DirectorioState = { ...dir, usuarios: [...dir.usuarios, usuario] }
  next = auditar(next, actor, { accion: 'Invitar usuario', entidad: 'usuario', entidadId: usuario.id, motivo: motivo.trim(), antes: '—', despues: `${usuario.nombre} <${usuario.email}> · ${resumenUsuario(next, usuario)}` })
  return { dir: next, usuario }
}

export function actualizarUsuario(dir: DirectorioState, id: string, input: UsuarioInput, motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.usuarios')
  requireMotivo(motivo)
  const u = dir.usuarios.find((x) => x.id === id)
  if (!u) throw new ConfigError('El usuario no existe.')
  validarUsuario(dir, input, id)
  const cambiaAcceso = input.rolId !== u.rolId || input.alcance !== u.alcance || input.proyectos.join() !== u.proyectos.join()
  if (cambiaAcceso) verificarNoEscala(actor, dir.roles.find((r) => r.id === input.rolId)!.permisos, id)
  const nuevo: Usuario = { ...u, nombre: input.nombre.trim(), email: input.email.trim().toLowerCase(), rolId: input.rolId, alcance: input.alcance, supervisorId: input.supervisorId, equipoId: input.equipoId, proyectos: [...input.proyectos] }
  const next: DirectorioState = { ...dir, usuarios: dir.usuarios.map((x) => (x.id === id ? nuevo : x)) }
  verificarUltimoAdmin(dir, next)
  return auditar(next, actor, { accion: 'Editar usuario', entidad: 'usuario', entidadId: id, motivo: motivo.trim(), antes: resumenUsuario(dir, u), despues: resumenUsuario(next, nuevo) })
}

/** Activar, desactivar o marcar como activo un invitado. Desactivar conserva su historial y sus ventas. */
export function cambiarEstadoUsuario(dir: DirectorioState, id: string, estado: EstadoUsuario, motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.usuarios')
  requireMotivo(motivo)
  const u = dir.usuarios.find((x) => x.id === id)
  if (!u) throw new ConfigError('El usuario no existe.')
  if (u.estado === estado) throw new ConfigError(`El usuario ya está ${estado}.`)
  if (estado === 'activo' && id === actor.id) throw new ConfigError('No puedes reactivar tu propia cuenta.')
  const next: DirectorioState = { ...dir, usuarios: dir.usuarios.map((x) => (x.id === id ? { ...x, estado } : x)) }
  verificarUltimoAdmin(dir, next)
  return auditar(next, actor, { accion: estado === 'inactivo' ? 'Desactivar usuario' : 'Activar usuario', entidad: 'usuario', entidadId: id, motivo: motivo.trim(), antes: u.estado, despues: estado })
}

/** Excepción individual: heredar (quitar), permitir o denegar un permiso del rol. */
export function fijarExcepcion(dir: DirectorioState, id: string, permiso: Permiso, valor: Excepcion | 'heredar', motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.roles')
  requireMotivo(motivo)
  const u = dir.usuarios.find((x) => x.id === id)
  if (!u) throw new ConfigError('El usuario no existe.')
  if (valor === 'permitir') verificarNoEscala(actor, [permiso], id)
  else if (id === actor.id) throw new ConfigError('No puedes modificar tus propios permisos.')
  const excepciones = { ...u.excepciones }
  if (valor === 'heredar') delete excepciones[permiso]
  else excepciones[permiso] = valor
  const next: DirectorioState = { ...dir, usuarios: dir.usuarios.map((x) => (x.id === id ? { ...x, excepciones } : x)) }
  verificarUltimoAdmin(dir, next)
  return auditar(next, actor, { accion: 'Excepción de permiso', entidad: 'permiso', entidadId: id, motivo: motivo.trim(), antes: `${permiso}: ${u.excepciones[permiso] ?? 'heredar'}`, despues: `${permiso}: ${valor}` })
}

/* -------------------------------------------------------------------- roles */

export interface RolInput {
  nombre: string
  descripcion: string
  alcance: TipoAlcance
  permisos: Permiso[]
}

export function guardarRol(dir: DirectorioState, id: string | null, input: RolInput, motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.roles')
  requireMotivo(motivo)
  if (input.nombre.trim().length < 3) throw new ConfigError('Ingresa el nombre del rol.')
  if (dir.roles.some((r) => r.id !== id && r.nombre.toLowerCase() === input.nombre.trim().toLowerCase())) throw new ConfigError('Ya existe un rol con ese nombre.')
  const anterior = id ? dir.roles.find((r) => r.id === id) : undefined
  if (id && !anterior) throw new ConfigError('El rol no existe.')
  const agregados = input.permisos.filter((p) => !anterior?.permisos.includes(p))
  verificarNoEscala(actor, agregados)
  if (anterior && anterior.id === dir.usuarios.find((u) => u.id === actor.id)?.rolId && agregados.length) {
    throw new ConfigError('No puedes ampliar los permisos de tu propio rol.')
  }
  const rol: RolDef = anterior
    ? { ...anterior, nombre: input.nombre.trim(), descripcion: input.descripcion.trim(), alcance: input.alcance, permisos: [...input.permisos] }
    : { id: newId('rol'), nombre: input.nombre.trim(), descripcion: input.descripcion.trim(), alcance: input.alcance, permisos: [...input.permisos], sistema: false }
  const next: DirectorioState = { ...dir, roles: anterior ? dir.roles.map((r) => (r.id === rol.id ? rol : r)) : [...dir.roles, rol] }
  verificarUltimoAdmin(dir, next)
  return auditar(next, actor, {
    accion: anterior ? 'Editar rol' : 'Crear rol', entidad: 'rol', entidadId: rol.id, motivo: motivo.trim(),
    antes: anterior ? `${anterior.nombre} · ${anterior.alcance} · ${anterior.permisos.length} permisos` : '—',
    despues: `${rol.nombre} · ${rol.alcance} · ${rol.permisos.length} permisos${anterior ? ` (+${agregados.length} / −${anterior.permisos.filter((p) => !rol.permisos.includes(p)).length})` : ''}`,
  })
}

export function eliminarRol(dir: DirectorioState, id: string, motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.roles')
  requireMotivo(motivo)
  const r = dir.roles.find((x) => x.id === id)
  if (!r) throw new ConfigError('El rol no existe.')
  if (r.sistema) throw new ConfigError('Los perfiles iniciales no se eliminan; puedes editarlos.')
  if (dir.usuarios.some((u) => u.rolId === id)) throw new ConfigError('Hay usuarios con este rol. Cámbiales el rol antes de eliminarlo.')
  return auditar({ ...dir, roles: dir.roles.filter((x) => x.id !== id) }, actor, { accion: 'Eliminar rol', entidad: 'rol', entidadId: id, motivo: motivo.trim(), antes: r.nombre, despues: '—' })
}

/* ------------------------------------------------------------------ equipos */

export interface EquipoInput {
  nombre: string
  supervisorId: string | null
  gerenciaIds: string[]
}

export function guardarEquipo(dir: DirectorioState, id: string | null, input: EquipoInput, motivo: string, actor: Actor): DirectorioState {
  assertCan(actor, 'config.equipos')
  requireMotivo(motivo)
  if (input.nombre.trim().length < 2) throw new ConfigError('Ingresa el nombre del equipo.')
  if (dir.equipos.some((e) => e.id !== id && e.nombre.toLowerCase() === input.nombre.trim().toLowerCase())) throw new ConfigError('Ya existe un equipo con ese nombre.')
  for (const uid of [input.supervisorId, ...input.gerenciaIds].filter(Boolean) as string[]) {
    const u = dir.usuarios.find((x) => x.id === uid)
    if (!u || u.estado === 'inactivo') throw new ConfigError('Las personas responsables deben estar activas o invitadas.')
  }
  const anterior = id ? dir.equipos.find((e) => e.id === id) : undefined
  if (id && !anterior) throw new ConfigError('El equipo no existe.')
  const eq: Equipo = { id: anterior?.id ?? newId('eq'), nombre: input.nombre.trim(), supervisorId: input.supervisorId, gerenciaIds: [...input.gerenciaIds] }
  const nombre = (uid: string | null) => dir.usuarios.find((u) => u.id === uid)?.nombre ?? '—'
  const desc = (e: Equipo) => `${e.nombre} · supervisor ${nombre(e.supervisorId)} · gerencia ${e.gerenciaIds.map(nombre).join(', ') || '—'}`
  const next: DirectorioState = { ...dir, equipos: anterior ? dir.equipos.map((e) => (e.id === eq.id ? eq : e)) : [...dir.equipos, eq] }
  return auditar(next, actor, { accion: anterior ? 'Editar equipo' : 'Crear equipo', entidad: 'equipo', entidadId: eq.id, motivo: motivo.trim(), antes: anterior ? desc(anterior) : '—', despues: desc(eq) })
}

/** Usuarios activos a los que el actor puede asignar trabajo (dentro de su alcance). */
export function asignables(dir: DirectorioState, actor: Actor) {
  const visibles = actor.alcance?.tipo === 'empresa' ? null : new Set(actor.alcance?.usuarios ?? [actor.id])
  return dir.usuarios.filter((u) => u.estado === 'activo' && (!visibles || visibles.has(u.id)))
}
