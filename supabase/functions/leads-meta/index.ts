// Supabase Edge Function pública: webhook oficial de Meta para Facebook e Instagram Lead Ads.
//   GET  · verificación de la suscripción (hub.verify_token = META_VERIFY_TOKEN).
//   POST · aviso de lead nuevo: se comprueba la firma (X-Hub-Signature-256 con META_APP_SECRET), se lee el lead en la
//          Graph API con el token de la página (META_PAGE_TOKEN y appsecret_proof) y se registra con leads_ingresar.
// Sin esos secretos responde 503 y no procesa nada. Ningún secreto sale del servidor.
// Despliegue: supabase functions deploy leads-meta --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { CAMPOS_LEAD, cambiosLeadgen, firmaMetaValida, mapearLeadMeta, pruebaSecreto } from '../_shared/leads.ts'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    const token = Deno.env.get('META_VERIFY_TOKEN')
    if (!token) return new Response('Integración con Meta no configurada', { status: 503 })
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('Prohibido', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 })

  const secreto = Deno.env.get('META_APP_SECRET')
  const tokenPagina = Deno.env.get('META_PAGE_TOKEN')
  if (!secreto || !tokenPagina) return new Response('Integración con Meta no configurada', { status: 503 })
  const cuerpo = await req.text()
  if (!(await firmaMetaValida(cuerpo, req.headers.get('x-hub-signature-256'), secreto))) return new Response('Firma no válida', { status: 401 })
  let payload: unknown
  try { payload = JSON.parse(cuerpo) } catch { return new Response('Datos no válidos', { status: 400 }) }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const paginas = (Deno.env.get('META_PAGE_IDS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const version = Deno.env.get('META_GRAPH_VERSION') ?? 'v21.0'
  const prueba = await pruebaSecreto(tokenPagina, secreto)
  const error = (externo: string, detalle: unknown, e: string) => admin.rpc('leads_registrar_error', { p_fuente: 'meta', p_externo: externo, p_detalle: detalle, p_error: e })

  let pendientes = 0
  for (const c of cambiosLeadgen(payload)) {
    if (paginas.length && c.pageId && !paginas.includes(c.pageId)) continue
    try {
      const r = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(c.leadgenId)}?fields=${CAMPOS_LEAD}&access_token=${encodeURIComponent(tokenPagina)}&appsecret_proof=${prueba}`)
      if (!r.ok) throw new Error(`Graph API ${r.status}: ${(await r.text()).slice(0, 300)}`)
      const m = mapearLeadMeta(await r.json())
      if ('error' in m) { await error(c.leadgenId, { cambio: c }, m.error); continue }
      const { error: e } = await admin.rpc('leads_ingresar', { p: m.datos })
      // Un dato que no pasa la validación (p. ej. un celular no válido) queda a la vista del administrador; reintentar no lo arregla.
      if (e) await error(c.leadgenId, { cambio: c, lead: m.datos }, e.message)
    } catch (e) {
      // No se pudo leer el lead: se pide a Meta que reintente; lo ya registrado no se duplica (leadgen_id único).
      pendientes++
      await error(c.leadgenId, { cambio: c }, String(e))
    }
  }
  return new Response(pendientes ? 'Reintentar' : 'EVENT_RECEIVED', { status: pendientes ? 500 : 200 })
})
