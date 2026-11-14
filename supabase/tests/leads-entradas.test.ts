// @vitest-environment node
// Entradas públicas de leads (Edge Functions): formulario web, firma y lectura de Meta. Lógica compartida, sin red.
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { cambiosLeadgen, firmaMetaValida, leerFormularioWeb, leerMonto, mapearLeadMeta, mensajePublico, origenPermitido, pruebaSecreto, resumenIp } from '../functions/_shared/leads'

const base = { nombre: 'María  Pérez', celular: '099 123 4567', email: 'Maria@Correo.com', consentimiento: true, consentimiento_version: 'v1-2026-11', t: 8000 }

describe('formulario web', () => {
  it('arma el lead con los datos de la persona y de la campaña', () => {
    const r = leerFormularioWeb({ ...base, mensaje: 'Quiero visitar', unidad: 'E1-PB-A2', presupuesto: '$120.000', utm_campaign: 'Lanzamiento', utm_source: 'google', pagina: 'https://amura.ec/contacto', landing: 'https://amura.ec/', formulario: 'whatsapp' })
    expect(r).toEqual({ tipo: 'lead', datos: expect.objectContaining({
      fuente: 'web', formulario: 'whatsapp', nombre: 'María Pérez', telefono: '099 123 4567', email: 'maria@correo.com', mensaje: 'Quiero visitar',
      unidad_interes: 'E1-PB-A2', presupuesto: 120000, campana: 'Lanzamiento', pagina: 'https://amura.ec/contacto', datos: { utm_source: 'google', landing: 'https://amura.ec/' },
      consentimiento: true, consentimiento_version: 'v1-2026-11',
    }) })
  })

  it('registra qué formulario de la página lo envió', () => {
    const formulario = (f: unknown) => (leerFormularioWeb({ ...base, formulario: f }) as { datos: { formulario: string } }).datos.formulario
    expect(formulario('solicitud-de-informacion')).toBe('solicitud-de-informacion')
    expect(formulario('Contacto')).toBe('contacto')
    expect(formulario('<script>')).toBe('contacto')
    expect(formulario(undefined)).toBe('contacto')
  })

  it('lee montos escritos de varias formas', () => {
    expect(['$120.000', '120,000.50', '120000', '1.250.000', 'USD 95 000', ''].map(leerMonto)).toEqual([120000, 120000.5, 120000, 1250000, 95000, 0])
  })

  it('descarta en silencio a los programas: campo trampa lleno o envío instantáneo', () => {
    expect(leerFormularioWeb({ ...base, empresa: 'Spam S.A.' })).toEqual({ tipo: 'descartar' })
    expect(leerFormularioWeb({ ...base, t: 300 })).toEqual({ tipo: 'descartar' })
    expect(leerFormularioWeb({ ...base, t: undefined })).toEqual({ tipo: 'descartar' })
  })

  it('pide lo que falta con mensajes claros', () => {
    expect(leerFormularioWeb({ ...base, nombre: 'M' })).toMatchObject({ tipo: 'error', mensaje: /nombre completo/ })
    expect(leerFormularioWeb({ ...base, celular: 'abc' })).toMatchObject({ tipo: 'error', mensaje: /celular válido/ })
    expect(leerFormularioWeb({ ...base, email: 'malo' })).toMatchObject({ tipo: 'error', mensaje: /correo/ })
    expect(leerFormularioWeb({ ...base, consentimiento: 'true' })).toMatchObject({ tipo: 'error', mensaje: /tratamiento de tus datos/ })
    expect(leerFormularioWeb({ ...base, consentimiento_version: '' })).toMatchObject({ tipo: 'error', mensaje: /versión/ })
  })

  it('solo acepta los dominios configurados', () => {
    expect(origenPermitido('https://amura.ec', 'https://amura.ec, https://www.amura.ec/')).toBe('https://amura.ec')
    expect(origenPermitido('https://www.amura.ec', 'https://amura.ec,https://www.amura.ec/')).toBe('https://www.amura.ec')
    expect(origenPermitido('https://otro.com', 'https://amura.ec')).toBeNull()
    expect(origenPermitido('https://amura.ec', undefined)).toBeNull()
    expect(origenPermitido(null, 'https://amura.ec')).toBeNull()
  })

  it('muestra los mensajes de validación de la base y oculta los internos', () => {
    expect(mensajePublico('El celular no es válido: en Ecuador, 10 dígitos que empiezan por 09')).toEqual({ mensaje: 'El celular no es válido: en Ecuador, 10 dígitos que empiezan por 09', estado: 400 })
    expect(mensajePublico('Demasiados envíos seguidos. Intenta de nuevo en unos minutos.').estado).toBe(429)
    expect(mensajePublico('duplicate key value violates unique constraint "x"')).toEqual({ mensaje: 'No pudimos registrar tus datos. Inténtalo de nuevo.', estado: 500 })
  })

  it('la IP no se guarda: solo un resumen con sal, estable y distinto por sal', async () => {
    const a = await resumenIp('190.152.10.20', 'sal-1')
    expect(a).toHaveLength(32)
    expect(a).not.toContain('190')
    expect(await resumenIp('190.152.10.20', 'sal-1')).toBe(a)
    expect(await resumenIp('190.152.10.20', 'sal-2')).not.toBe(a)
  })
})

describe('Meta Lead Ads', () => {
  const secreto = 'app-secret-de-prueba'
  const cuerpo = JSON.stringify({ object: 'page', entry: [{ id: '123', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: '444', page_id: '123', form_id: '9', ad_id: '77', created_time: 1 } }, { field: 'feed', value: {} }] }] })
  const firma = 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex')

  it('acepta solo la firma correcta del cuerpo exacto', async () => {
    expect(await firmaMetaValida(cuerpo, firma, secreto)).toBe(true)
    expect(await firmaMetaValida(cuerpo + ' ', firma, secreto)).toBe(false)
    expect(await firmaMetaValida(cuerpo, firma, 'otro-secreto')).toBe(false)
    expect(await firmaMetaValida(cuerpo, null, secreto)).toBe(false)
    expect(await firmaMetaValida(cuerpo, 'sha1=abc', secreto)).toBe(false)
  })

  it('appsecret_proof es el HMAC del token con el App Secret', async () => {
    expect(await pruebaSecreto('token-pagina', secreto)).toBe(createHmac('sha256', secreto).update('token-pagina').digest('hex'))
  })

  it('toma solo los avisos de leads de la página', () => {
    expect(cambiosLeadgen(JSON.parse(cuerpo))).toEqual([{ leadgenId: '444', pageId: '123', formId: '9', adId: '77' }])
    expect(cambiosLeadgen({ object: 'instagram', entry: [] })).toEqual([])
    expect(cambiosLeadgen(null)).toEqual([])
  })

  it('convierte el lead: Instagram o Facebook según la plataforma, campaña, anuncio y preguntas propias', () => {
    const r = mapearLeadMeta({
      id: '444', created_time: '2026-11-16T15:00:00+0000', platform: 'ig', form_id: '9', campaign_name: 'Lanzamiento', ad_name: 'Anuncio 2D', adset_name: 'Quito 25-45',
      field_data: [
        { name: 'full_name', values: ['Luis Andrade'] }, { name: 'phone_number', values: ['+593991234567'] }, { name: 'email', values: ['luis@correo.com'] },
        { name: 'presupuesto_aproximado', values: ['$100.000 a $150.000'] }, { name: 'city', values: ['Quito'] },
      ],
    })
    expect(r).toEqual({ datos: expect.objectContaining({
      fuente: 'instagram', externo_id: '444', formulario: '9', nombre: 'Luis Andrade', telefono: '+593991234567', email: 'luis@correo.com',
      campana: 'Lanzamiento', anuncio: 'Anuncio 2D', conjunto: 'Quito 25-45', mensaje: 'presupuesto aproximado: $100.000 a $150.000\nCiudad: Quito',
      consentimiento: true, consentimiento_version: 'meta-lead-ads',
    }) })
    expect(mapearLeadMeta({ id: '1', platform: 'fb', field_data: [{ name: 'first_name', values: ['Ana'] }, { name: 'last_name', values: ['Mora'] }, { name: 'phone_number', values: ['0991234567'] }] }))
      .toMatchObject({ datos: { fuente: 'facebook', nombre: 'Ana Mora' } })
  })

  it('un lead sin nombre o celular no se pierde: se informa como error', () => {
    expect(mapearLeadMeta({ id: '9', field_data: [{ name: 'email', values: ['x@y.com'] }] })).toEqual({ error: 'El lead 9 no trae nombre o celular' })
  })

  it('el lead de prueba de Meta confirma la conexión sin crear un cliente con datos de relleno', () => {
    const r = mapearLeadMeta({ id: '10', field_data: [
      { name: 'full_name', values: ['<test lead: dummy data for full_name>'] }, { name: 'phone_number', values: ['+15555550100'] },
    ] })
    expect(r).toEqual({ error: 'Lead de prueba de Meta: la conexión funciona; no se crea un cliente con datos de relleno' })
  })
})
