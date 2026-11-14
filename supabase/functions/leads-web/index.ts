// Supabase Edge Function pública: recibe el formulario de la página web de AMURA (contacto y botón de WhatsApp).
// Solo acepta los dominios de LEADS_ORIGENES. La IP no se guarda: solo su resumen con LEADS_SAL, para limitar envíos.
// Registra con la clave de servicio, que nunca sale del servidor. Despliegue: supabase functions deploy leads-web --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { leerFormularioWeb, mensajePublico, origenPermitido, resumenIp } from '../_shared/leads.ts'

Deno.serve(async (req) => {
  const origen = origenPermitido(req.headers.get('Origin'), Deno.env.get('LEADS_ORIGENES'))
  const cors = {
    'Access-Control-Allow-Origin': origen ?? 'null',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response(null, { status: origen ? 204 : 403, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  if (!origen) return json({ error: 'Origen no autorizado' }, 403)
  const sal = Deno.env.get('LEADS_SAL')
  if (!sal) return json({ error: 'El formulario aún no está habilitado' }, 503)

  let cuerpo: Record<string, unknown>
  try { cuerpo = await req.json() } catch { return json({ error: 'Datos no válidos' }, 400) }
  const r = leerFormularioWeb(cuerpo ?? {})
  if (r.tipo === 'descartar') return json({ ok: true })
  if (r.tipo === 'error') return json({ error: r.mensaje }, 400)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { error } = await admin.rpc('leads_ingresar', { p: { ...r.datos, ip_hash: ip ? await resumenIp(ip, sal) : null } })
  if (error) {
    const m = mensajePublico(error.message)
    if (m.estado === 500) console.error('leads-web', error.message)
    return json({ error: m.mensaje }, m.estado)
  }
  return json({ ok: true })
})
