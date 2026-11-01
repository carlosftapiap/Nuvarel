// Captura las pantallas con Chrome real. Uso: node capturar.mjs [ruta opcional]. No toca producción.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const SALIDA = path.resolve(AQUI, '../recursos/pantallas')
mkdirSync(SALIDA, { recursive: true })
const BASE = 'http://127.0.0.1:5177/marketing/sistema-gestion-inmobiliaria/capturas/#'
const PANTALLAS = [
  ['dashboard', '/'], ['inventario', '/inventario'], ['precios', '/precios'], ['clientes', '/clientes'], ['comercial', '/comercial'], ['venta', '/venta'],
  ['cotizaciones', '/cotizaciones'], ['financiamiento', '/financiamiento?unidad=E1-PB-A3'], ['reservas', '/reservas'], ['ventas', '/ventas'], ['cobranzas', '/cobranzas'], ['obra', '/obra'], ['plan', '/plan'],
]
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9340', '--window-size=1600,900', `--user-data-dir=${tmpdir()}/sgi-capturas`, 'about:blank'], { stdio: 'ignore' })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let pag
  for (let i = 0; i < 40 && !pag; i++) { await dormir(250); try { pag = (await (await fetch('http://127.0.0.1:9340/json')).json()).find((t) => t.type === 'page') } catch { /* arranca */ } }
  const ws = new WebSocket(pag.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  let n = 0; const esperas = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (esperas.has(m.id)) { esperas.get(m.id)(m.result); esperas.delete(m.id) } }
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; esperas.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expression) => (await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value
  await cdp('Page.enable'); await cdp('Runtime.enable'); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPCION', (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200)) })
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1.5, mobile: false })
  const solo = process.argv[2]
  for (const [nombre, ruta] of PANTALLAS.filter(([x]) => !solo || x === solo)) {
    await cdp('Page.navigate', { url: 'about:blank' })
    await cdp('Page.navigate', { url: BASE + ruta })
    await dormir(nombre === 'dashboard' ? 9000 : 6000)
    const texto = await ev(`document.body.innerText.slice(0, 200).replace(/\\s+/g, ' ')`)
    writeFileSync(path.join(SALIDA, `${nombre}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    console.log(nombre, '·', await ev(`document.querySelector('h1')?.textContent ?? 'SIN TÍTULO'`), '·', texto.length)
  }
} finally { chrome.kill() }
process.exit(0)
