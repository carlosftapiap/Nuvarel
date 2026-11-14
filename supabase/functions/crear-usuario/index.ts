// Supabase Edge Function: crea cuentas con contraseña inicial y cambia contraseñas, sin correo de invitación ni confirmación.
// La clave de servicio se lee del entorno del servidor (SUPABASE_SERVICE_ROLE_KEY); nunca va al navegador ni al repositorio.
// Despliegue: supabase functions deploy crear-usuario
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { gestionarCuenta, origenCors, type Peticion } from '../_shared/cuentas.ts'

Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': origenCors(req.headers.get('Origin'), Deno.env.get('APP_ORIGIN')),
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const auth = req.headers.get('Authorization') ?? ''
  // Con la sesión de quien llama: la base verifica sus permisos y la auditoría queda a su nombre.
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await comoUsuario.auth.getUser()
  if (!user) return json({ error: 'Sesión no válida' }, 401)

  let p: Peticion
  try { p = await req.json() } catch { return json({ error: 'Cuerpo inválido' }, 400) }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const r = await gestionarCuenta(p, comoUsuario, admin.auth.admin)
  return json(r.body, r.status)
})
