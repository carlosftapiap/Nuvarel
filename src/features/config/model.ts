import type { Excepcion, Permiso, TipoAlcance } from '@/app/permissions'

export type EstadoUsuario = 'invitado' | 'activo' | 'inactivo'

export interface Usuario {
  /** Identificador único y estable. Es lo único que se usa para autorizar y atribuir. */
  id: string
  nombre: string
  email: string
  estado: EstadoUsuario
  rolId: string
  /** Excepciones individuales explícitas sobre el rol (sin entrada = hereda). */
  excepciones: Partial<Record<Permiso, Excepcion>>
  /** Si se define, reemplaza el alcance del rol para esta persona. */
  alcance: TipoAlcance | null
  supervisorId: string | null
  equipoId: string | null
  proyectos: string[]
  creadoEn: string
}

export interface RolDef {
  id: string
  nombre: string
  descripcion: string
  alcance: TipoAlcance
  permisos: Permiso[]
  /** Los perfiles iniciales no se eliminan (sí se editan). */
  sistema: boolean
}

export interface Equipo {
  id: string
  nombre: string
  supervisorId: string | null
  /** Gerencias que supervisan este equipo. */
  gerenciaIds: string[]
}

export interface EntradaAuditoria {
  id: string
  fecha: string
  actorId: string
  actorNombre: string
  accion: string
  entidad: 'usuario' | 'rol' | 'equipo' | 'permiso'
  entidadId: string
  motivo: string
  antes: string
  despues: string
}

export interface DirectorioState {
  version: 1
  usuarios: Usuario[]
  roles: RolDef[]
  equipos: Equipo[]
  auditoria: EntradaAuditoria[]
}

export const PROYECTOS = [{ id: 'AMURA', nombre: 'AMURA Apartments' }] as const

export const ESTADOS_USUARIO: Record<EstadoUsuario, { label: string; tone: string }> = {
  invitado: { label: 'Invitado', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  activo: { label: 'Activo', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  inactivo: { label: 'Inactivo', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
