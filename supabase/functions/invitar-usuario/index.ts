// Supabase Edge Function: invita a una persona y crea su perfil.
// La clave de servicio se lee del entorno del servidor (SUPABASE_SERVICE_ROLE_KEY); nunca va al navegador ni al repositorio.
// Despliegue: supabase functions deploy invitar-usuario
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface Payload {
  nombre: string
  email: string
  rolId: string
  alcance: 'propio' | 'equipo' | 'empresa' | null
  supervisorId: string | null
  equipoId: string | null
  proyectos: string[]
  motivo: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''

  // 1. Cliente con la sesión de quien llama: los permisos se verifican con sus propias credenciales.
  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await comoUsuario.auth.getUser()
  if (!user) return json({ error: 'Sesión no válida' }, 401)
  const { data: puede } = await comoUsuario.rpc('tiene_permiso', { p_permiso: 'config.usuarios' })
  if (!puede) return json({ error: 'Sin permiso para administrar usuarios' }, 403)

  let p: Payload
  try { p = await req.json() } catch { return json({ error: 'Cuerpo inválido' }, 400) }
  if (!p.nombre || p.nombre.trim().length < 3) return json({ error: 'Nombre obligatorio' }, 400)
  if (!EMAIL.test(p.email ?? '')) return json({ error: 'Correo inválido' }, 400)
  if (!p.motivo || p.motivo.trim().length < 5) return json({ error: 'Motivo obligatorio' }, 400)

  // 2. Anti escalada: no se concede un rol con permisos que quien invita no tiene.
  const { data: concede } = await comoUsuario.rpc('puede_conceder_rol', { p_rol: p.rolId })
  if (!concede) return json({ error: 'No puedes conceder permisos que no tienes' }, 403)

  // 3. Operación privilegiada en el servidor: invitación por correo; la persona define su contraseña.
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: inv, error: errInv } = await admin.auth.admin.inviteUserByEmail(p.email.trim().toLowerCase(), {
    redirectTo: Deno.env.get('APP_ORIGIN') ? `${Deno.env.get('APP_ORIGIN')}/` : undefined,
    data: { nombre: p.nombre.trim() },
  })
  if (errInv || !inv.user) return json({ error: errInv?.message ?? 'No se pudo invitar' }, 400)

  const { error: errPerfil } = await admin.from('profiles').insert({
    id: inv.user.id, nombre: p.nombre.trim(), email: p.email.trim().toLowerCase(), estado: 'invitado', rol_id: p.rolId,
    alcance: p.alcance, supervisor_id: p.supervisorId, equipo_id: p.equipoId,
  })
  if (errPerfil) {
    await admin.auth.admin.deleteUser(inv.user.id)
    return json({ error: errPerfil.message }, 400)
  }
  if (p.proyectos?.length) await admin.from('user_projects').insert(p.proyectos.map((project_id) => ({ user_id: inv.user!.id, project_id })))
  await admin.from('audit_log').insert({
    actor_id: user.id, accion: 'Invitar usuario', entidad: 'usuario', entidad_id: inv.user.id, motivo: p.motivo.trim(),
    antes: null, despues: { nombre: p.nombre, email: p.email, rol_id: p.rolId, alcance: p.alcance, equipo_id: p.equipoId, proyectos: p.proyectos },
  })
  return json({ id: inv.user.id })
})
