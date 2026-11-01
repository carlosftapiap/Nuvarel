// Render determinista: cada cuadro es draw(t), capturado con Chrome y codificado con ffmpeg.
//   node render.mjs --stills 3,10,15,40,58     → imágenes de revisión en video/revision/
//   node render.mjs [--fps 30]                 → videos/sistema-gestion-inmobiliaria-60s-v1.mp4
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const FPS = Number(arg('--fps', 30)), DUR = 60
const SALIDA = path.resolve(AQUI, '../videos/sistema-gestion-inmobiliaria-60s-v1.mp4')
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--remote-debugging-port=9341', '--window-size=1920,1080', `--user-data-dir=${tmpdir()}/sgi-render`, 'about:blank'], { stdio: 'ignore' })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let pag
  for (let i = 0; i < 40 && !pag; i++) { await dormir(250); try { pag = (await (await fetch('http://127.0.0.1:9341/json')).json()).find((t) => t.type === 'page') } catch { /* arranca */ } }
  const ws = new WebSocket(pag.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  let n = 0; const esperas = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (esperas.has(m.id)) { esperas.get(m.id)(m.result); esperas.delete(m.id) } }
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; esperas.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value }
  const foto = async (format, quality) => Buffer.from((await cdp('Page.captureScreenshot', { format, quality, optimizeForSpeed: true })).data, 'base64')
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: pathToFileURL(path.join(AQUI, 'index.html')).href })
  await dormir(1500)
  await ev('window.listo')

  const stills = arg('--stills', null)
  if (stills) {
    const dir = path.join(AQUI, 'revision'); mkdirSync(dir, { recursive: true })
    for (const t of stills.split(',').map(Number)) { await ev(`draw(${t})`); writeFileSync(path.join(dir, `t${String(t).padStart(2, '0')}.jpg`), await foto('jpeg', 88)) }
    console.log('revisión lista')
  } else {
    mkdirSync(path.dirname(SALIDA), { recursive: true })
    const musica = path.join(AQUI, 'audio', 'musica.wav')
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-i', musica,
      '-filter_complex', `[1:a]atrim=0:${DUR},afade=t=in:d=1,afade=t=out:st=${DUR - 2.5}:d=2.5,loudnorm=I=-18:TP=-2:LRA=9[a]`, '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(DUR), '-movflags', '+faststart', SALIDA], { stdio: ['pipe', 'inherit', 'inherit'] })
    const total = FPS * DUR, ini = Date.now()
    for (let f = 0; f < total; f++) {
      await ev(`draw(${f / FPS})`)
      if (!ff.stdin.write(await foto('jpeg', 95))) await new Promise((r) => ff.stdin.once('drain', r))
      if (f % 150 === 0) console.log(`cuadro ${f}/${total} · ${((Date.now() - ini) / 1000).toFixed(0)} s`)
    }
    ff.stdin.end()
    await new Promise((r) => ff.on('close', r))
    console.log('LISTO', SALIDA, spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'csv=p=0', SALIDA], { encoding: 'utf8' }).stdout.trim())
  }
} finally { chrome.kill() }
process.exit(0)
