// Versiones verticales 9:16. Misma técnica que render.mjs: cada cuadro es draw(t).
//   node render-vertical.mjs 60 --stills 1,9,15     → imágenes en video/revision-vertical/
//   node render-vertical.mjs 60 --comprobar         → revisa la zona segura de todo el video
//   node render-vertical.mjs 60                     → videos/sistema-gestion-inmobiliaria-60s-vertical-9x16.mp4
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d }
const DUR = process.argv[2] === '30' ? 30 : 60, FPS = 30
const SALIDA = path.resolve(AQUI, `../videos/sistema-gestion-inmobiliaria-${DUR}s-vertical-9x16.mp4`)
const PUERTO = DUR === 30 ? 9346 : 9345
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--remote-debugging-port=${PUERTO}`, '--window-size=1080,1920', `--user-data-dir=${tmpdir()}/sgi-vertical-${DUR}`, 'about:blank'], { stdio: 'ignore' })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  let pag
  for (let i = 0; i < 40 && !pag; i++) { await dormir(250); try { pag = (await (await fetch(`http://127.0.0.1:${PUERTO}/json`)).json()).find((t) => t.type === 'page') } catch { /* arranca */ } }
  const ws = new WebSocket(pag.webSocketDebuggerUrl)
  await new Promise((r) => { ws.onopen = r })
  let n = 0; const esperas = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (esperas.has(m.id)) { esperas.get(m.id)(m.result); esperas.delete(m.id) } }
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; esperas.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value }
  const foto = async (format, quality) => Buffer.from((await cdp('Page.captureScreenshot', { format, quality, optimizeForSpeed: true })).data, 'base64')
  await cdp('Page.enable')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false })
  await cdp('Page.navigate', { url: pathToFileURL(path.join(AQUI, 'vertical.html')).href + `?v=${DUR}` })
  await dormir(2000)
  await ev('window.listo')

  const stills = arg('--stills', null)
  if (stills) {
    const dir = path.join(AQUI, arg('--carpeta', 'revision-vertical')); mkdirSync(dir, { recursive: true })
    for (const t of stills.split(',').map(Number)) { await ev(`draw(${t})`); await dormir(120); writeFileSync(path.join(dir, `v${DUR}-t${String(t).padStart(4, '0')}.jpg`), await foto('jpeg', 85)) }
    console.log('revisión lista')
  } else if (process.argv.includes('--comprobar')) {
    const malos = new Map()
    for (let t = 0; t < DUR; t += 0.1) for (const m of await ev(`fueraDeZona(${t.toFixed(2)})`)) if (!malos.has(m.split(' ').slice(0, 3).join(' '))) malos.set(m.split(' ').slice(0, 3).join(' '), `t=${t.toFixed(1)} ${m}`)
    console.log(malos.size ? [...malos.values()].join('\n') : 'zona segura: sin problemas')
  } else {
    mkdirSync(path.dirname(SALIDA), { recursive: true })
    // La versión corta arranca en la parte más intensa de la misma música, sobre un compás.
    const ini = DUR === 30 ? 14.4 : 0, musica = path.join(AQUI, 'audio', 'musica.wav')
    const filtro = `[1:a]atrim=${ini}:${ini + DUR},asetpts=PTS-STARTPTS,afade=t=in:d=${DUR === 30 ? 0.15 : 0.5},afade=t=out:st=${DUR - 2.5}:d=2.5,loudnorm=I=-15:TP=-1.5:LRA=9[a]`
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-i', musica, '-filter_complex', filtro, '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(DUR), '-movflags', '+faststart', SALIDA], { stdio: ['pipe', 'inherit', 'inherit'] })
    const total = FPS * DUR, inicio = Date.now()
    for (let f = 0; f < total; f++) {
      await ev(`draw(${f / FPS})`)
      if (!ff.stdin.write(await foto('jpeg', 95))) await new Promise((r) => ff.stdin.once('drain', r))
      if (f % 300 === 0) console.log(`cuadro ${f}/${total} · ${((Date.now() - inicio) / 1000).toFixed(0)} s`)
    }
    ff.stdin.end()
    await new Promise((r) => ff.on('close', r))
    console.log('LISTO', SALIDA, spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'csv=p=0', SALIDA], { encoding: 'utf8' }).stdout.trim())
  }
} finally { chrome.kill() }
process.exit(0)
