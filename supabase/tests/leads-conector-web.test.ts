// El conector de la página web (integraciones/web/amura-leads.js) en un navegador simulado y sin red: formularios
// marcados con data-amura-lead y captura previa al botón de WhatsApp.
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const CODIGO = fs.readFileSync(path.resolve(__dirname, '..', '..', 'integraciones', 'web', 'amura-leads.js'), 'utf8')
const WHATSAPP = '593990000000'
const envios: Record<string, unknown>[] = []
let respuesta: { status: number; body: unknown } | 'sin red' = { status: 200, body: { ok: true } }
const pestana = { location: { href: '' }, close: vi.fn() }

const $ = <T extends Element = HTMLElement>(s: string, raiz: ParentNode = document) => raiz.querySelector<T>(s)!
const llenar = (raiz: ParentNode, valores: Record<string, string>) => {
  for (const [s, v] of Object.entries(valores)) $<HTMLInputElement>(s, raiz).value = v
}
const aceptar = (raiz: ParentNode) => { $<HTMLInputElement>('[data-amura-campo=consentimiento]', raiz).checked = true }
const enviar = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const aviso = (raiz: ParentNode) => $('[data-amura-estado]', raiz)

beforeAll(() => {
  window.history.replaceState({}, '', '/proyecto?utm_source=facebook&utm_campaign=Lanzamiento')
  Object.defineProperty(document, 'referrer', { value: 'https://l.facebook.com/l.php?u=x', configurable: true })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    envios.push(JSON.parse(String(init.body)))
    if (respuesta === 'sin red') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(respuesta.body), { status: respuesta.status, headers: { 'Content-Type': 'application/json' } })
  }))
  window.open = vi.fn(() => pestana as unknown as Window)
  Object.assign(window, {
    AMURA_LEADS: { endpoint: 'https://x.supabase.co/functions/v1/leads-web', whatsapp: WHATSAPP, politica: 'https://amura.ec/privacidad', responsable: 'NUVAREL S.A.', correoDatos: 'datos@amura.ec' },
  })
  // Un formulario como los de Elementor (form_fields[…], teléfono reconocible solo por su etiqueta), otro sin marcar y WhatsApp.
  document.body.innerHTML = `
    <form data-amura-lead="Solicitud de información" id="info">
      <div><label for="n">Nombre</label><input id="n" name="form_fields[name]"></div>
      <div><label for="c">Teléfono</label><input id="c" name="form_fields[field_1a2b]"></div>
      <div><label for="e">Correo</label><input id="e" name="form_fields[email]" type="email"></div>
      <div><label for="v">¿Cuándo quieres visitarnos?</label><select id="v" name="form_fields[visita]"><option value="">Elige</option><option value="sabado">Sábado en la mañana</option></select></div>
      <div><label for="m">Mensaje</label><textarea id="m" name="form_fields[message]"></textarea></div>
      <div><button type="submit">Enviar</button></div>
    </form>
    <form role="search" id="buscar"><input name="q"><button>Buscar</button></form>
    <a id="wa" href="https://wa.me/593990000000?text=Hola">Escríbenos</a>`
  // Se ejecuta como en el navegador: un script clásico en el ámbito global. Mide el tiempo desde que carga la página:
  // aquí carga «hace 10 segundos».
  const ahora = Date.now
  Date.now = () => ahora() - 10_000
  // eslint-disable-next-line no-eval
  try { (0, eval)(CODIGO) } finally { Date.now = ahora }
})

beforeEach(() => { respuesta = { status: 200, body: { ok: true } } })

describe('formularios de la página', () => {
  it('agrega la casilla de consentimiento y el campo trampa; sin la casilla marcada no envía', () => {
    const form = $<HTMLFormElement>('#info')
    const casilla = $<HTMLInputElement>('[data-amura-campo=consentimiento]', form)
    expect(casilla.checked).toBe(false)
    expect(casilla.closest('label')!.textContent).toMatch(/^Autorizo a NUVAREL S\.A\. a tratar .*escribiendo a datos@amura\.ec\. Conoce más en la Política de Privacidad\.$/)
    expect(casilla.closest('label')!.querySelector('a')!.getAttribute('href')).toBe('https://amura.ec/privacidad')
    expect(form.querySelector('[data-amura-trampa]')).not.toBeNull()
    expect($('#buscar').querySelector('[data-amura-campo], [data-amura-trampa]')).toBeNull()
    llenar(form, { '#n': 'Lucía Mora', '#c': '0991234567' })
    enviar(form)
    expect(aviso(form).textContent).toBe('Para continuar, acepta el tratamiento de tus datos personales.')
    expect(envios).toHaveLength(0)
  })

  it('envía a AMURA el formulario, la página y la campaña; confirma y el envío propio del sitio no corre', async () => {
    const form = $<HTMLFormElement>('#info')
    let propio = false
    let evento = ''
    form.addEventListener('submit', () => { propio = true })
    document.addEventListener('amura:lead', (e) => { evento = (e as CustomEvent<{ formulario: string }>).detail.formulario })
    llenar(form, { '#n': 'Lucía Mora', '#c': '0991234567', '#e': 'lucia@correo.com', '#m': 'Quiero un departamento', '#v': 'sabado' })
    aceptar(form)
    enviar(form)
    await vi.waitFor(() => expect(aviso(form).dataset.tipo).toBe('ok'))
    expect(envios[0]).toMatchObject({
      nombre: 'Lucía Mora', celular: '0991234567', email: 'lucia@correo.com', mensaje: 'Quiero un departamento\n¿Cuándo quieres visitarnos?: Sábado en la mañana',
      formulario: 'solicitud-de-informacion', pagina: `${location.origin}/proyecto`, landing: `${location.origin}/proyecto`,
      utm_source: 'facebook', utm_campaign: 'Lanzamiento', referrer: 'https://l.facebook.com', empresa: '', consentimiento: true, consentimiento_version: 'v1-2026-11',
    })
    expect(envios[0].t as number).toBeGreaterThanOrEqual(10_000)
    expect(aviso(form).textContent).toBe('¡Gracias, Lucía! Recibimos tus datos. Un asesor de AMURA te contactará pronto.')
    expect($<HTMLInputElement>('#n').value).toBe('')
    expect(propio).toBe(false)
    expect(evento).toBe('solicitud-de-informacion')
  })

  it('conserva la campaña de la visita al cambiar de página', async () => {
    window.history.replaceState({}, '', '/contacto')
    const form = $<HTMLFormElement>('#info')
    llenar(form, { '#n': 'Andrés Vela', '#c': '+593 98 765 4321' })
    aceptar(form)
    enviar(form)
    await vi.waitFor(() => expect(aviso(form).textContent).toMatch(/^¡Gracias, Andrés!/))
    expect(envios[1]).toMatchObject({ pagina: `${location.origin}/contacto`, landing: `${location.origin}/proyecto`, utm_campaign: 'Lanzamiento', mensaje: '' })
  })

  it('muestra el aviso de AMURA cuando un dato no pasa la validación y conserva lo escrito', async () => {
    respuesta = { status: 400, body: { error: 'El celular no es válido: en Ecuador, 10 dígitos que empiezan por 09' } }
    const form = $<HTMLFormElement>('#info')
    llenar(form, { '#n': 'Ana Paz', '#c': '0812345678' })
    aceptar(form)
    enviar(form)
    await vi.waitFor(() => expect(aviso(form).dataset.tipo).toBe('error'))
    expect(aviso(form).textContent).toBe('El celular no es válido: en Ecuador, 10 dígitos que empiezan por 09')
    expect($<HTMLInputElement>('#n').value).toBe('Ana Paz')
  })

  it('prepara los formularios que aparecen después, como las ventanas emergentes', async () => {
    const bloque = document.createElement('div')
    bloque.className = 'amura-lead'
    bloque.innerHTML = '<form><input name="nombre"><input name="celular" type="tel"><button>Enviar</button></form>'
    document.body.appendChild(bloque)
    await vi.waitFor(() => expect(bloque.querySelector('[data-amura-campo=consentimiento]')).not.toBeNull())
  })
})

describe('botón de WhatsApp', () => {
  it('antes de WhatsApp pide nombre y celular, registra el lead y abre el chat de AMURA', async () => {
    const clic = new MouseEvent('click', { bubbles: true, cancelable: true })
    $('#wa').dispatchEvent(clic)
    expect(clic.defaultPrevented).toBe(true)
    const fondo = $('.amura-lw-fondo')
    expect(fondo.hidden).toBe(false)
    const form = $<HTMLFormElement>('form', fondo)
    llenar(form, { '[data-amura-campo=nombre]': 'Pedro Ruiz', '[data-amura-campo=celular]': '0991112233' })
    aceptar(form)
    const antes = envios.length
    enviar(form)
    await vi.waitFor(() => expect(aviso(form).dataset.tipo).toBe('ok'))
    expect(envios[antes]).toMatchObject({ nombre: 'Pedro Ruiz', celular: '0991112233', formulario: 'whatsapp', consentimiento: true })
    expect(pestana.location.href).toBe(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent('Hola, soy Pedro Ruiz. Quiero información de AMURA Apartments.')}`)
    expect(aviso(form).textContent).toBe('¡Listo, Pedro! Te abrimos WhatsApp para que converses con un asesor. Abrir WhatsApp')
  })

  it('si AMURA no responde, la persona igual puede continuar a WhatsApp; Escape cierra la ventana', async () => {
    respuesta = 'sin red'
    const form = $<HTMLFormElement>('.amura-lw-fondo form')
    llenar(form, { '[data-amura-campo=nombre]': 'Rosa Paz', '[data-amura-campo=celular]': '0993334455' })
    aceptar(form)
    enviar(form)
    await vi.waitFor(() => expect(aviso(form).dataset.tipo).toBe('error'))
    expect(pestana.close).toHaveBeenCalled()
    const enlace = $<HTMLAnchorElement>('a', aviso(form))
    expect(enlace.textContent).toBe('Continuar a WhatsApp')
    expect(enlace.href).toBe(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent('Hola, soy Rosa Paz. Quiero información de AMURA Apartments.')}`)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect($('.amura-lw-fondo').hidden).toBe(true)
  })
})
