// Lógica de crear-usuario, sin dependencias de Deno. Los permisos se verifican en la base, con la sesión de quien llama.
// La contraseña solo pasa por Supabase Auth: no se guarda en AMURA ni llega a la auditoría.

export interface Resultado { status: number; body: { id?: string; ok?: boolean; error?: string } }

interface ErrorRpc { message: string }
export interface ClienteUsuario {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data?: unknown; error: ErrorRpc | null }>
}
export interface AdminAuth {
  createUser(p: { email: string; password: string; email_confirm: boolean; user_metadata: Record<string, unknown> }): PromiseLike<{ data: { user: { id: string } | null }; error: ErrorRpc | null }>
  updateUserById(id: string, p: { password: string }): PromiseLike<{ error: ErrorRpc | null }>
  deleteUser(id: string): PromiseLike<{ error: ErrorRpc | null }>
}

export type Peticion =
  | { accion: 'crear'; nombre: string; email: string; password: string; rolId: string; alcance: string | null; equipoId: string | null; supervisorId: string | null; motivo: string }
  | { accion: 'clave'; usuarioId: string; password: string; motivo: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const CLAVE_MINIMA = 8
const mal = (error: string, status = 400): Resultado => ({ status, body: { error } })
const denegado = (m: string) => /permiso|conceder|más permisos/i.test(m)

export async function gestionarCuenta(p: Peticion, comoUsuario: ClienteUsuario, admin: AdminAuth): Promise<Resultado> {
  if (!p.password || p.password.length < CLAVE_MINIMA) return mal(`La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres`)
  if (!p.motivo || p.motivo.trim().length < 5) return mal('Motivo obligatorio')

  if (p.accion === 'clave') {
    const { error } = await comoUsuario.rpc('config_autorizar_clave', { p_user: p.usuarioId, p_motivo: p.motivo })
    if (error) return mal(error.message, denegado(error.message) ? 403 : 400)
    const { error: e } = await admin.updateUserById(p.usuarioId, { password: p.password })
    if (e) return mal(traducir(e.message))
    return { status: 200, body: { ok: true } }
  }

  const email = (p.email ?? '').trim().toLowerCase()
  if (!p.nombre || p.nombre.trim().length < 3) return mal('Nombre obligatorio')
  if (!EMAIL.test(email)) return mal('Correo no válido')

  // Se valida antes de crear la cuenta, para no dejar cuentas sin perfil.
  const args = { p_rol: p.rolId, p_alcance: p.alcance, p_equipo: p.equipoId, p_supervisor: p.supervisorId }
  const { error: invalido } = await comoUsuario.rpc('config_validar_alta', args)
  if (invalido) return mal(invalido.message, denegado(invalido.message) ? 403 : 400)

  const { data, error } = await admin.createUser({ email, password: p.password, email_confirm: true, user_metadata: { nombre: p.nombre.trim() } })
  if (error || !data.user) return mal(traducir(error?.message ?? 'No se pudo crear la cuenta'))

  const { error: errPerfil } = await comoUsuario.rpc('config_crear_perfil', { p_user: data.user.id, p_nombre: p.nombre, p_motivo: p.motivo, ...args })
  if (errPerfil) {
    // Sin perfil la cuenta no sirve: se retira para poder repetir el alta con el mismo correo.
    await admin.deleteUser(data.user.id)
    return mal(errPerfil.message)
  }
  return { status: 200, body: { id: data.user.id } }
}

function traducir(m: string) {
  if (/already.*registered|already exists/i.test(m)) return 'Ya existe una cuenta con ese correo'
  if (/password/i.test(m)) return `La contraseña no es válida: ${m}`
  return m
}
