import type { Datos } from '@/features/conexion/datos'

/** Corredores comerciales. El perfil se crea sin invitación; el acceso a la app es opcional y se vincula aparte. */
export interface Corredor {
  id: string
  nombre: string
  documento: string
  licencia: string
  telefono: string
  email: string
  estado: 'activo' | 'inactivo'
  responsableId: string | null
  responsable: string | null
  usuarioId: string | null
  acceso: string | null
  clientes: number
  ventas: number
}

export interface DatosCorredor {
  nombre: string
  documento: string
  licencia: string
  telefono: string
  email: string
  responsable_id: string | null
}

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))

export async function cargarCorredores(d: Datos): Promise<Corredor[]> {
  const filas = (await d.rpc<Fila[] | null>('corredores_listar')) ?? []
  return filas.map((f) => ({
    id: String(f.id), nombre: String(f.nombre), documento: String(f.documento ?? ''), licencia: String(f.licencia ?? ''),
    telefono: String(f.telefono ?? ''), email: String(f.email ?? ''), estado: f.estado as 'activo' | 'inactivo',
    responsableId: s(f.responsable_id), responsable: s(f.responsable), usuarioId: s(f.usuario_id), acceso: s(f.acceso),
    clientes: Number(f.clientes ?? 0), ventas: Number(f.ventas ?? 0),
  }))
}

/** Cuentas con rol Corredor que aún pueden vincularse. Solo administración las ve completas. */
export async function cuentasCorredor(d: Datos): Promise<{ id: string; nombre: string }[]> {
  const filas = await d.select<Fila>('profiles', { filtros: { rol_id: 'corredor', estado: 'activo' }, orden: [{ columna: 'nombre', asc: true }] })
  return filas.map((f) => ({ id: String(f.id), nombre: String(f.nombre) }))
}

export const crearCorredor = (d: Datos, datos: DatosCorredor, motivo: string) => d.rpc<string>('corredores_crear', { p_datos: datos, p_motivo: motivo })
export const editarCorredor = (d: Datos, id: string, datos: DatosCorredor, motivo: string) => d.rpc('corredores_editar', { p_id: id, p_datos: datos, p_motivo: motivo })
export const cambiarEstadoCorredor = (d: Datos, id: string, estado: 'activo' | 'inactivo', motivo: string) => d.rpc('corredores_cambiar_estado', { p_id: id, p_estado: estado, p_motivo: motivo })
export const vincularAcceso = (d: Datos, id: string, usuario: string, motivo: string) => d.rpc('corredores_vincular_acceso', { p_id: id, p_usuario: usuario, p_motivo: motivo })
export const desvincularAcceso = (d: Datos, id: string, motivo: string) => d.rpc('corredores_desvincular_acceso', { p_id: id, p_motivo: motivo })
