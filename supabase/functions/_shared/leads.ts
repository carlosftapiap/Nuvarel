// Captación de leads: lógica común de las Edge Functions leads-web y leads-meta. Sin APIs de Deno, para probarla con Vitest.
// La validación definitiva la hace la base (leads_ingresar); aquí se filtra lo evidente y se arma lo que se envía.

/** Lo que recibe leads_ingresar. */
export interface DatosLead {
  fuente: 'web' | 'facebook' | 'instagram'
  formulario?: string | null
  externo_id?: string | null
  nombre: string
  telefono: string
  email?: string
  mensaje?: string
  unidad_interes?: string | null
  presupuesto?: number | null
  campana?: string | null
  anuncio?: string | null
  conjunto?: string | null
  pagina?: string | null
  datos?: Record<string, unknown>
  consentimiento: true
  consentimiento_version: string
  ip_hash?: string | null
}

export type ResultadoWeb = { tipo: 'lead'; datos: DatosLead } | { tipo: 'descartar' } | { tipo: 'error'; mensaje: string }

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** Monto escrito por una persona: «$120.000», «120,000.50» o «120000». Solo un final de 1 o 2 dígitos se toma como decimales. */
export function leerMonto(v: string): number {
  const m = v.replace(/[^0-9.,]/g, '').match(/^(.*?)(?:[.,](\d{1,2}))?$/)
  if (!m) return 0
  const n = Number(`${m[1].replace(/\D/g, '') || '0'}${m[2] ? `.${m[2]}` : ''}`)
  return Number.isFinite(n) ? n : 0
}

/** Tiempo mínimo entre que se muestra el formulario y se envía: menos que esto lo hace un programa, no una persona. */
export const MINIMO_MS = 2500

/** Qué formulario de la página lo envió («contacto», «solicitud-de-informacion», «whatsapp»…): un identificador corto. */
function formularioWeb(v: unknown) {
  const f = texto(v, 60).toLowerCase()
  return /^[a-z0-9][a-z0-9_-]*$/.test(f) ? f : 'contacto'
}

/**
 * Formulario de la página web (contacto, información o botón de WhatsApp). El campo «empresa» es una trampa invisible: si
 * llega lleno, o el envío es instantáneo, se descarta en silencio (se responde bien, para no enseñar al programa qué falló).
 */
export function leerFormularioWeb(b: Record<string, unknown>): ResultadoWeb {
  if (texto(b.empresa, 200) !== '') return { tipo: 'descartar' }
  const t = Number(b.t)
  if (!Number.isFinite(t) || t < MINIMO_MS || t > 86_400_000) return { tipo: 'descartar' }
  const nombre = texto(b.nombre, 120)
  if (nombre.length < 3) return { tipo: 'error', mensaje: 'Ingresa tu nombre completo.' }
  const telefono = texto(b.celular, 30)
  if (!/^\+?[0-9][0-9 ()-]{6,24}$/.test(telefono)) return { tipo: 'error', mensaje: 'Ingresa un celular válido: 09XXXXXXXX o con + y el código de tu país.' }
  const email = texto(b.email, 160).toLowerCase()
  if (email && !CORREO.test(email)) return { tipo: 'error', mensaje: 'El correo no es válido.' }
  if (b.consentimiento !== true) return { tipo: 'error', mensaje: 'Debes aceptar el tratamiento de tus datos personales.' }
  const version = texto(b.consentimiento_version, 60)
  if (version.length < 2) return { tipo: 'error', mensaje: 'Falta la versión del texto de consentimiento.' }
  const presupuesto = leerMonto(texto(b.presupuesto, 30))
  return {
    tipo: 'lead',
    datos: {
      fuente: 'web',
      formulario: formularioWeb(b.formulario),
      nombre, telefono, email,
      mensaje: texto(b.mensaje, 2000),
      unidad_interes: texto(b.unidad, 60) || null,
      presupuesto: presupuesto > 0 ? presupuesto : null,
      campana: texto(b.utm_campaign, 200) || null,
      pagina: texto(b.pagina, 300) || null,
      datos: Object.fromEntries(['utm_source', 'utm_medium', 'utm_content', 'utm_term', 'referrer', 'landing'].map((k) => [k, texto(b[k], 300)]).filter(([, v]) => v)),
      consentimiento: true,
      consentimiento_version: version,
    },
  }
}

/** Solo los dominios de AMURA que se configuren (LEADS_ORIGENES, separados por comas) pueden enviar el formulario. */
export function origenPermitido(origen: string | null, lista: string | undefined): string | null {
  if (!origen || !lista) return null
  return lista.split(',').map((x) => x.trim().replace(/\/$/, '')).filter(Boolean).includes(origen) ? origen : null
}

/** Mensajes de la base que la persona puede leer; el resto no se muestra. */
export function mensajePublico(error: string): { mensaje: string; estado: number } {
  if (/Demasiados envíos/.test(error)) return { mensaje: 'Recibimos varios envíos seguidos. Inténtalo de nuevo en unos minutos.', estado: 429 }
  const conocido = ['celular no es válido', 'nombre completo', 'correo no es válido', 'tratamiento de tus datos'].find((m) => error.includes(m))
  return conocido ? { mensaje: error.trim(), estado: 400 } : { mensaje: 'No pudimos registrar tus datos. Inténtalo de nuevo.', estado: 500 }
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function hmac(clave: string, dato: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(dato)))
}

/** La IP no se guarda: solo un resumen con una sal secreta, para limitar envíos repetidos. */
export async function resumenIp(ip: string, sal: string) {
  return (await hmac(sal, ip)).slice(0, 32)
}

/** Firma de Meta (X-Hub-Signature-256): HMAC-SHA256 del cuerpo con el App Secret. Comparación en tiempo constante. */
export async function firmaMetaValida(cuerpo: string, firma: string | null, secreto: string): Promise<boolean> {
  if (!firma || !firma.startsWith('sha256=') || !secreto) return false
  const esperada = await hmac(secreto, cuerpo)
  const recibida = firma.slice(7).toLowerCase()
  if (recibida.length !== esperada.length) return false
  let d = 0
  for (let i = 0; i < esperada.length; i++) d |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i)
  return d === 0
}

/** appsecret_proof de la Graph API: HMAC-SHA256 del token con el App Secret. */
export const pruebaSecreto = (token: string, secreto: string) => hmac(secreto, token)

export interface CambioLeadgen { leadgenId: string; pageId: string | null; formId: string | null; adId: string | null }

/** Avisos de leads del webhook de la página (object=page, field=leadgen). */
export function cambiosLeadgen(payload: unknown): CambioLeadgen[] {
  const p = payload as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] }
  if (!p || p.object !== 'page' || !Array.isArray(p.entry)) return []
  return p.entry.flatMap((e) => (e.changes ?? []))
    .filter((c) => c.field === 'leadgen' && c.value && c.value.leadgen_id)
    .map((c) => ({
      leadgenId: String(c.value!.leadgen_id), pageId: c.value!.page_id ? String(c.value!.page_id) : null,
      formId: c.value!.form_id ? String(c.value!.form_id) : null, adId: c.value!.ad_id ? String(c.value!.ad_id) : null,
    }))
}

/** Campos que se piden a la Graph API por cada lead. */
export const CAMPOS_LEAD = 'id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic,custom_disclaimer_responses'

export interface LeadMeta {
  id: string
  created_time?: string
  field_data?: { name: string; values?: string[] }[]
  ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string
  form_id?: string; platform?: string; is_organic?: boolean
  custom_disclaimer_responses?: unknown
}

const ETIQUETA_CAMPO: Record<string, string> = { city: 'Ciudad', job_title: 'Cargo', company_name: 'Empresa' }
/** La herramienta de pruebas de Meta llena los leads con datos de relleno («test lead», «dummy data»). */
const PRUEBA_META = /test lead|dummy data/i

/**
 * Lead de Facebook o Instagram → lo que recibe leads_ingresar. Las preguntas propias del formulario van al mensaje y a datos.
 * El consentimiento es el del formulario de Meta, que exige la política de privacidad del anunciante.
 * Un lead de prueba con datos de relleno confirma la conexión, pero no crea un cliente: queda a la vista del administrador.
 */
export function mapearLeadMeta(l: LeadMeta): { datos: DatosLead } | { error: string } {
  if ((l.field_data ?? []).some((f) => (f.values ?? []).some((v) => PRUEBA_META.test(v)))) {
    return { error: 'Lead de prueba de Meta: la conexión funciona; no se crea un cliente con datos de relleno' }
  }
  const campos = new Map((l.field_data ?? []).map((f) => [f.name.toLowerCase(), (f.values ?? []).join(', ').trim()]))
  const nombre = campos.get('full_name') || [campos.get('first_name'), campos.get('last_name')].filter(Boolean).join(' ')
  const telefono = campos.get('phone_number') || campos.get('phone') || ''
  if (!nombre || !telefono) return { error: `El lead ${l.id} no trae nombre o celular` }
  const conocidos = new Set(['full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'email'])
  const preguntas = [...campos].filter(([k, v]) => !conocidos.has(k) && v).map(([k, v]) => `${ETIQUETA_CAMPO[k] ?? k.replace(/_/g, ' ')}: ${v}`)
  return {
    datos: {
      fuente: l.platform === 'ig' ? 'instagram' : 'facebook',
      formulario: l.form_id ?? null,
      externo_id: l.id,
      nombre, telefono,
      email: campos.get('email') ?? '',
      unidad_interes: campos.get('unidad') || campos.get('departamento') || campos.get('codigo_de_departamento') || null,
      mensaje: preguntas.join('\n'),
      campana: l.campaign_name ?? null,
      anuncio: l.ad_name ?? null,
      conjunto: l.adset_name ?? null,
      datos: { created_time: l.created_time, campaign_id: l.campaign_id, ad_id: l.ad_id, adset_id: l.adset_id, is_organic: l.is_organic, platform: l.platform, field_data: l.field_data, custom_disclaimer_responses: l.custom_disclaimer_responses },
      consentimiento: true,
      consentimiento_version: 'meta-lead-ads',
    },
  }
}
