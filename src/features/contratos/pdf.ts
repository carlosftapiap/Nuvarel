import { jsPDF } from 'jspdf'
import type { Bloque, BordeDoc, CeldaDoc, DocumentoWord, FilaDoc, ImagenDoc, Parrafo, PaginaDoc, SeccionDoc, TabDoc, Tramo, Variantes } from './bloques'

/** PDF del documento contractual: reproduce la maquetación del Word lleno (página, márgenes, numeración, formato, tablas, encabezados y pies). */

export interface OpcionesPdf {
  titulo: string
  codigo: string
  version: number
  /** Texto de aviso en cada página (por ejemplo, vista previa sin validez). */
  marca?: string
}

/** Unidad mínima que se reparte en las páginas: una línea de texto o una fila de tabla. */
interface Item {
  alto: number
  antes: number
  despues: number
  /** No debe quedar separada del item siguiente. */
  atado: boolean
  dibujar: (x: number, y: number) => void
  dividir?: (max: number) => [Item, Item] | null
  cabeceras?: Item[]
  salto?: { siNoVacia: boolean }
}

type Pieza =
  | { k: 'txt'; t: string; tr: Tramo; x: number; w: number }
  | { k: 'esp'; t: string; tr: Tramo; x: number; w: number }
  | { k: 'tab'; tr: Tramo; x: number; w: number; relleno: TabDoc['relleno'] }
  | { k: 'img'; tr: Tramo; x: number; w: number; img: ImagenDoc }

const ESCALA_SUB = 0.65
const tamanoReal = (tr: Tramo) => (tr.posicion === 'normal' ? tr.tamano : tr.tamano * ESCALA_SUB)
const estiloFuente = (tr: Tramo) => (tr.negrita ? (tr.cursiva ? 'bolditalic' : 'bold') : tr.cursiva ? 'italic' : 'normal')

export function construirPdf(documento: DocumentoWord, op: OpcionesPdf): jsPDF {
  const usaCampos = (b: Bloque[]): boolean => b.some((x) => (x.tipo === 'parrafo' ? x.tramos.some((t) => t.campo === 'NUMPAGES') : x.tipo === 'tabla' ? x.detalle.some((f) => f.celdas.some((c) => usaCampos(c.bloques))) : false))
  // Un total de páginas dentro del texto del documento obliga a contarlas primero.
  const total = usaCampos(documento.bloques) ? pintar(documento, op, 0).getNumberOfPages() : 0
  return pintar(documento, op, total)
}

function pintar(documento: DocumentoWord, op: OpcionesPdf, totalConocido: number): jsPDF {
  const primera = documento.secciones[0].pagina
  const orientacion = (p: PaginaDoc) => (p.ancho > p.alto ? 'l' as const : 'p' as const)
  const doc = new jsPDF({ unit: 'pt', format: [primera.ancho, primera.alto], orientation: orientacion(primera) })
  doc.setProperties({ title: `${op.titulo} · ${op.codigo}`, subject: `Versión ${op.version}`, creator: 'AMURA' })

  const valores = { pagina: 1, total: totalConocido || 1 }
  let paginaActual = primera
  let xCuerpo = primera.izq

  const ponerFuente = (tr: Tramo) => { doc.setFont(tr.fuente, estiloFuente(tr)).setFontSize(tamanoReal(tr)) }
  // Sin ajuste entre letras: Word no lo aplica por defecto y el PDF tampoco lo dibuja.
  const medir = (t: string, tr: Tramo) => { ponerFuente(tr); return doc.getStringUnitWidth(t, { kerning: {} } as never) * tamanoReal(tr) * tr.escala }
  const textoDe = (tr: Tramo) => (tr.campo === 'PAGE' ? String(valores.pagina) : tr.campo === 'NUMPAGES' ? String(valores.total) : tr.texto)

  const ponerImagen = (img: ImagenDoc, x: number, y: number) => {
    try { doc.addImage(img.dataUrl, img.formato, x, y, img.ancho, img.alto, `i${img.dataUrl.length}-${img.dataUrl.slice(-24)}`, 'FAST') }
    catch { if (!documento.avisos.includes('Una imagen del Word no se pudo pasar al PDF.')) documento.avisos.push('Una imagen del Word no se pudo pasar al PDF.') }
  }

  const dibujarPiezas = (piezas: Pieza[], x0: number, base: number) => {
    for (const p of piezas) {
      const tr = p.tr
      const x = x0 + p.x
      const sube = tr.posicion === 'super' ? tr.tamano * 0.33 : tr.posicion === 'sub' ? -tr.tamano * 0.14 : 0
      if (tr.fondo && p.k !== 'img') { doc.setFillColor(...tr.fondo); doc.rect(x, base - tr.tamano * 0.8, p.w, tr.tamano * 1.05, 'F') }
      if (p.k === 'img') { ponerImagen(p.img, x, base - p.img.alto); continue }
      const c = tr.color ?? [0, 0, 0]
      if (p.k === 'txt') {
        ponerFuente(tr)
        doc.setTextColor(c[0], c[1], c[2])
        doc.text(p.t, x, base - sube, tr.escala === 1 ? undefined : { horizontalScale: tr.escala })
      }
      if (p.k === 'tab' && p.relleno) {
        doc.setDrawColor(c[0], c[1], c[2]).setLineWidth(0.5)
        if (p.relleno === 'linea') doc.line(x, base + 1, x + p.w, base + 1)
        else { ponerFuente(tr); doc.setTextColor(c[0], c[1], c[2]); const paso = doc.getTextWidth('. ') || 3; for (let d = x + (p.w % paso); d + 1 < x + p.w; d += paso) doc.text('.', d, base) }
      }
      if (tr.subrayado || tr.tachado) {
        doc.setDrawColor(c[0], c[1], c[2]).setLineWidth(Math.max(tr.tamano * 0.05, 0.4))
        if (tr.subrayado) doc.line(x, base + tr.tamano * 0.12, x + p.w, base + tr.tamano * 0.12)
        if (tr.tachado) doc.line(x, base - tr.tamano * 0.28, x + p.w, base - tr.tamano * 0.28)
      }
    }
  }

  function lineasDe(p: Parrafo, ancho: number) {
    const limite = ancho - p.der
    const piezasDe: Pieza[][] = []
    const finDe: boolean[] = []
    let piezas: Pieza[] = []
    let x = p.izq + p.primera
    const flotantes: ImagenDoc[] = []

    const cerrar = (forzada: boolean) => { piezasDe.push(piezas); finDe.push(forzada); piezas = []; x = p.izq }

    // Lo que sigue a una tabulación hasta la próxima: sirve para las tabulaciones a la derecha y centradas.
    type Unidad = { tipo: 'palabra'; partes: { t: string; tr: Tramo }[] } | { tipo: 'esp'; t: string; tr: Tramo } | { tipo: 'tab'; tr: Tramo } | { tipo: 'br' } | { tipo: 'img'; tr: Tramo; img: ImagenDoc }
    const unidades: Unidad[] = []
    let palabra: { t: string; tr: Tramo }[] = []
    const cierraPalabra = () => { if (palabra.length) { unidades.push({ tipo: 'palabra', partes: palabra }); palabra = [] } }
    const agregar = (tr: Tramo) => {
      if (tr.imagen) {
        cierraPalabra()
        if (tr.imagen.flotante) flotantes.push(tr.imagen)
        else unidades.push({ tipo: 'img', tr, img: tr.imagen })
        return
      }
      for (const trozo of textoDe(tr).split(/(\t|\n| +)/)) {
        if (!trozo) continue
        if (trozo === '\t') { cierraPalabra(); unidades.push({ tipo: 'tab', tr }) }
        else if (trozo === '\n') { cierraPalabra(); unidades.push({ tipo: 'br' }) }
        else if (trozo[0] === ' ') { cierraPalabra(); unidades.push({ tipo: 'esp', t: trozo, tr }) }
        else {
          const cortes = trozo.split(/(?<=-)/)
          cortes.forEach((c, i) => { palabra.push({ t: c, tr }); if (i < cortes.length - 1) cierraPalabra() })
        }
      }
    }
    if (p.etiqueta) {
      agregar(p.etiqueta)
      cierraPalabra()
      if (p.sufijo === 'tab') unidades.push({ tipo: 'tab', tr: p.etiqueta })
      else if (p.sufijo === 'espacio') unidades.push({ tipo: 'esp', t: ' ', tr: p.etiqueta })
    }
    p.tramos.forEach(agregar)
    cierraPalabra()

    const anchoUnidad = (u: Unidad) => (u.tipo === 'palabra' ? u.partes.reduce((s, q) => s + medir(q.t, q.tr), 0) : u.tipo === 'esp' ? medir(u.t, u.tr) : u.tipo === 'img' ? u.img.ancho : 0)
    const anchoHastaTab = (i: number) => { let w = 0; for (let j = i; j < unidades.length; j++) { const u = unidades[j]; if (u.tipo === 'tab' || u.tipo === 'br') break; w += anchoUnidad(u) } return w }

    const ponerPalabra = (partes: { t: string; tr: Tramo }[]) => {
      for (const q of partes) { const w = medir(q.t, q.tr); piezas.push({ k: 'txt', t: q.t, tr: q.tr, x, w }); x += w }
    }

    unidades.forEach((u, i) => {
      if (u.tipo === 'br') { cerrar(true); return }
      if (u.tipo === 'esp') {
        // Los espacios al final de la línea no la empujan al renglón siguiente.
        if (piezas.length || x !== p.izq) { const w = medir(u.t, u.tr); piezas.push({ k: 'esp', t: u.t, tr: u.tr, x, w }); x += w }
        return
      }
      if (u.tipo === 'tab') {
        const posibles = p.tabs.filter((t) => t.pos > x + 0.01 && t.pos <= limite + 0.5)
        const sangria = x < p.izq - 0.01 && (!posibles.length || p.izq < posibles[0].pos) ? p.izq : null
        const t = sangria !== null ? { pos: sangria, tipo: 'izq' as const, relleno: null } : posibles[0] ?? null
        const destino = t?.pos ?? (Math.floor((x + 0.01) / p.tabDefecto) + 1) * p.tabDefecto
        const sigue = anchoHastaTab(i + 1)
        const inicio = t?.tipo === 'der' ? Math.max(x, destino - sigue) : t?.tipo === 'centro' ? Math.max(x, destino - sigue / 2) : destino
        if (inicio > limite + 0.5) { cerrar(false); return }
        piezas.push({ k: 'tab', tr: u.tr, x, w: inicio - x, relleno: t?.relleno ?? null })
        x = inicio
        return
      }
      if (u.tipo === 'img') {
        if (x + u.img.ancho > limite + 0.5 && piezas.length) cerrar(false)
        piezas.push({ k: 'img', tr: u.tr, x, w: u.img.ancho, img: u.img })
        x += u.img.ancho
        return
      }
      const w = anchoUnidad(u)
      if (x + w > limite + 0.01 && piezas.some((q) => q.k !== 'esp')) {
        while (piezas.at(-1)?.k === 'esp') piezas.pop()
        cerrar(false)
      }
      if (x + w > limite + 0.01) {
        // Una palabra más larga que el renglón se corta donde quepa.
        for (const q of u.partes) {
          let resto = q.t
          while (resto) {
            let n = resto.length
            while (n > 1 && x + medir(resto.slice(0, n), q.tr) > limite + 0.01) n--
            if (n === 1 && piezas.length && x + medir(resto[0], q.tr) > limite + 0.01) { cerrar(false); continue }
            ponerPalabra([{ t: resto.slice(0, n), tr: q.tr }])
            resto = resto.slice(n)
            if (resto) cerrar(false)
          }
        }
        return
      }
      ponerPalabra(u.partes)
    })
    if (piezas.length || !piezasDe.length) cerrar(false)
    finDe[finDe.length - 1] = true

    // Alineación, justificado y alto de cada línea.
    const lineas = piezasDe.map((ps, i) => {
      const ultima = i === piezasDe.length - 1
      let fin = 0
      for (const q of ps) if (q.k !== 'esp') fin = Math.max(fin, q.x + q.w)
      const sobra = limite - fin
      if (p.alinear === 'der' || p.alinear === 'centro') {
        const d = p.alinear === 'der' ? sobra : sobra / 2
        for (const q of ps) q.x += d
      } else if (p.alinear === 'justificado' && !ultima && sobra > 0) {
        const trasTab = ps.reduce((n, q, j) => (q.k === 'tab' ? j + 1 : n), 0)
        let ultimaVisible = ps.length - 1
        while (ultimaVisible >= 0 && ps[ultimaVisible].k === 'esp') ultimaVisible--
        const huecos = ps.filter((q, j) => q.k === 'esp' && j >= trasTab && j < ultimaVisible)
        if (huecos.length) {
          const extra = sobra / huecos.length
          let d = 0
          ps.forEach((q, j) => {
            q.x += d
            if (q.k === 'esp' && j >= trasTab && j < ultimaVisible) { q.w += extra; d += extra }
          })
        }
      }
      // Tramos seguidos con el mismo formato se escriben juntos cuando no hay espacio añadido: el texto del PDF queda continuo.
      const unidas: Pieza[] = []
      const justificada = p.alinear === 'justificado' && !ultima
      for (const q of ps) {
        const u = unidas.at(-1)
        if (!justificada && u && u.k === 'txt' && (q.k === 'txt' || q.k === 'esp') && u.tr === q.tr) { u.t += q.t; u.w += q.w }
        else if (q.k === 'esp' && !justificada) unidas.push({ ...q, k: 'txt' })
        else unidas.push(q)
      }
      // Un espacio final no se dibuja, salvo que esté subrayado.
      const conTexto = ps.filter((q) => q.k !== 'img')
      const natural = (conTexto.length ? conTexto : [{ tr: p.marca }]).reduce((m, q) => Math.max(m, q.tr.tamano * q.tr.interlinea), 0)
      const altoImg = ps.reduce((m, q) => (q.k === 'img' ? Math.max(m, q.img.alto) : m), 0)
      const multiplicado = p.linea.modo === 'auto' ? natural * p.linea.valor : natural
      const alto = p.linea.modo === 'exacto' ? p.linea.valor : Math.max(multiplicado, altoImg, p.linea.modo === 'minimo' ? p.linea.valor : 0)
      const mayor = (conTexto.length ? conTexto : [{ tr: p.marca }]).reduce((m, q) => Math.max(m, q.tr.tamano), 0)
      const bajo = altoImg > natural ? mayor * 0.22 : (natural - mayor) * 0.4 + mayor * 0.2
      return { piezas: unidas, alto, base: alto - bajo }
    })
    return { lineas, flotantes }
  }

  function itemsDeParrafo(p: Parrafo, ancho: number, antes: number, despues: number): Item[] {
    const { lineas, flotantes } = lineasDe(p, ancho)
    const n = lineas.length
    const items: Item[] = lineas.map((l, i) => ({
      alto: l.alto + (i === 0 && p.bordeArriba ? p.bordeArriba.ancho + 1 : 0) + (i === n - 1 && p.bordeAbajo ? p.bordeAbajo.ancho + 1 : 0),
      antes: i === 0 ? antes : 0,
      despues: i === n - 1 ? despues : 0,
      atado: i === n - 1 ? p.conservarSiguiente : p.conservarLineas || (p.huerfanas && (i === 0 || i === n - 2)),
      dibujar: (x, y) => {
        const sup = i === 0 && p.bordeArriba ? p.bordeArriba.ancho + 1 : 0
        if (p.fondo) { doc.setFillColor(...p.fondo); doc.rect(x + p.izq, y, ancho - p.izq - p.der, l.alto + sup, 'F') }
        if (sup && p.bordeArriba) ponerBorde(p.bordeArriba, x + p.izq, y + p.bordeArriba.ancho / 2, x + ancho - p.der, y + p.bordeArriba.ancho / 2)
        if (i === 0) for (const f of flotantes) ponerFlotante(f, x, y)
        dibujarPiezas(l.piezas, x, y + sup + l.base)
        if (i === n - 1 && p.bordeAbajo) ponerBorde(p.bordeAbajo, x + p.izq, y + sup + l.alto + 1, x + ancho - p.der, y + sup + l.alto + 1)
      },
    }))
    return items
  }

  const ponerBorde = (b: BordeDoc, x1: number, y1: number, x2: number, y2: number) => {
    doc.setDrawColor(b.color[0], b.color[1], b.color[2]).setLineWidth(b.ancho)
    doc.line(x1, y1, x2, y2)
  }

  const ponerFlotante = (img: ImagenDoc, x: number, y: number) => {
    const f = img.flotante!
    const pg = paginaActual
    const baseX = f.relX === 'page' ? 0 : f.relX === 'margin' || f.relX === 'column' ? pg.izq : x
    const anchoRef = f.relX === 'page' ? pg.ancho : pg.ancho - pg.izq - pg.der
    const px = f.alinearX === 'center' ? baseX + (anchoRef - img.ancho) / 2 : f.alinearX === 'right' ? baseX + anchoRef - img.ancho : f.alinearX === 'left' ? baseX : baseX + f.x
    const py = f.relY === 'page' ? f.y : f.relY === 'margin' || f.relY === 'topMargin' ? pg.arriba + f.y : y + f.y
    ponerImagen(img, px, py)
  }

  function maquetar(bloques: Bloque[], ancho: number): Item[] {
    const salida: Item[] = []
    bloques.forEach((b, i) => {
      if (b.tipo === 'salto') { salida.push({ alto: 0, antes: 0, despues: 0, atado: false, dibujar: () => {}, salto: { siNoVacia: !!b.siNoVacia } }); return }
      if (b.tipo === 'tabla') { salida.push(...itemsDeTabla(b, ancho)); return }
      const previo = bloques[i - 1]
      const siguiente = bloques[i + 1]
      const mismoEstilo = (x: Parrafo, o: Bloque | undefined) => x.contextual && o?.tipo === 'parrafo' && o.estilo === x.estilo
      // Entre dos párrafos, Word deja el mayor de los dos espacios, no la suma.
      const despuesPrevio = previo?.tipo === 'parrafo' && !mismoEstilo(previo, b) ? previo.despues : 0
      const antes = mismoEstilo(b, previo) ? 0 : Math.max(b.antes - despuesPrevio, 0)
      const despues = mismoEstilo(b, siguiente) ? 0 : b.despues
      salida.push(...itemsDeParrafo(b, ancho, antes, despues))
    })
    return salida
  }

  const altoDe = (items: Item[]) => items.reduce((s, it) => s + it.antes + it.alto + it.despues, 0)

  function itemsDeTabla(t: Extract<Bloque, { tipo: 'tabla' }>, ancho: number): Item[] {
    if (!t.detalle.length) return []
    const totalCols = Math.max(t.columnas.length, ...t.detalle.map((f) => f.celdas.reduce((m, c) => Math.max(m, c.columna + c.span), 0)))
    const suma = t.columnas.reduce((s, c) => s + c, 0)
    const cols = suma > 0 && t.columnas.length >= totalCols ? t.columnas : Array.from({ length: totalCols }, () => ancho / totalCols)
    const anchoTabla = cols.reduce((s, c) => s + c, 0)
    const xTabla = t.alinear === 'centro' ? (ancho - anchoTabla) / 2 : t.alinear === 'der' ? ancho - anchoTabla : t.sangria
    const xCol = (i: number) => cols.slice(0, i).reduce((s, c) => s + c, 0)

    interface Dentro { celda: CeldaDoc; items: Item[]; x: number; w: number; extiende: boolean; finUnion: boolean }
    const construir = (dentro: Dentro[], altoMin: number, regla: FilaDoc['altoRegla'], sinDividir: boolean, cabeceras: Item[] | undefined): Item => {
      const contenido = (d: Dentro) => (d.extiende ? 0 : altoDe(d.items) + d.celda.margenes.arriba + d.celda.margenes.abajo)
      const natural = Math.max(altoMin, ...dentro.map(contenido))
      const alto = regla?.modo === 'exacto' ? regla.valor : Math.max(natural, regla?.valor ?? 0)
      const item: Item = {
        alto, antes: 0, despues: 0, atado: false, cabeceras,
        dibujar: (x, y) => {
          for (const d of dentro) {
            const cx = x + xTabla + d.x
            if (d.celda.fondo) { doc.setFillColor(...d.celda.fondo); doc.rect(cx, y, d.w, alto, 'F') }
          }
          for (const d of dentro) {
            const cx = x + xTabla + d.x
            const dentroAlto = altoDe(d.items)
            const libre = alto - d.celda.margenes.arriba - d.celda.margenes.abajo - dentroAlto
            let cy = y + d.celda.margenes.arriba + (d.celda.vAlign === 'centro' ? Math.max(libre, 0) / 2 : d.celda.vAlign === 'abajo' ? Math.max(libre, 0) : 0)
            for (const it of d.items) { cy += it.antes; it.dibujar(cx + d.celda.margenes.izq, cy); cy += it.alto + it.despues }
          }
          for (const d of dentro) {
            const cx = x + xTabla + d.x
            const b = d.celda.bordes
            if (b.arriba && d.celda.vmerge !== 'sigue') ponerBorde(b.arriba, cx, y, cx + d.w, y)
            if (b.abajo && (d.celda.vmerge === null || d.finUnion)) ponerBorde(b.abajo, cx, y + alto, cx + d.w, y + alto)
            if (b.izq) ponerBorde(b.izq, cx, y, cx, y + alto)
            if (b.der) ponerBorde(b.der, cx + d.w, y, cx + d.w, y + alto)
          }
        },
      }
      if (!sinDividir && regla?.modo !== 'exacto') {
        item.dividir = (max) => {
          const uno: Dentro[] = []
          const dos: Dentro[] = []
          let avanza = false
          for (const d of dentro) {
            const espacio = max - d.celda.margenes.arriba - d.celda.margenes.abajo
            let usado = 0
            let n = 0
            for (const it of d.items) { if (usado + it.antes + it.alto > espacio) break; usado += it.antes + it.alto + it.despues; n++ }
            if (n > 0) avanza = true
            uno.push({ ...d, items: d.items.slice(0, n), finUnion: true })
            dos.push({ ...d, items: d.items.slice(n), finUnion: d.finUnion })
          }
          if (!avanza || dos.every((d) => !d.items.length)) return null
          return [construir(uno, 0, null, true, undefined), construir(dos, 0, null, false, cabeceras)]
        }
      }
      return item
    }

    const filas: { dentro: Dentro[]; f: FilaDoc; altoMin: number }[] = t.detalle.map((f, r) => ({
      f, altoMin: 0,
      dentro: f.celdas.map((c) => {
        const x = xCol(c.columna)
        const w = xCol(c.columna + c.span) - x
        const siguienteSigue = t.detalle[r + 1]?.celdas.find((o) => o.columna === c.columna)?.vmerge === 'sigue'
        return { celda: c, x, w, items: maquetar(c.bloques, w - c.margenes.izq - c.margenes.der).filter((it) => !it.salto), extiende: c.vmerge === 'inicio' || c.vmerge === 'sigue', finUnion: !siguienteSigue }
      }),
    }))
    // Una celda combinada verticalmente reserva su alto en la última de sus filas.
    filas.forEach((fila, r) => {
      for (const d of fila.dentro) {
        if (d.celda.vmerge !== 'inicio') continue
        let fin = r
        while (filas[fin + 1]?.dentro.some((o) => o.celda.columna === d.celda.columna && o.celda.vmerge === 'sigue')) fin++
        const necesario = altoDe(d.items) + d.celda.margenes.arriba + d.celda.margenes.abajo
        let acumulado = 0
        for (let i = r; i <= fin; i++) acumulado += Math.max(filas[i].altoMin, ...filas[i].dentro.map((o) => (o.extiende ? 0 : altoDe(o.items) + o.celda.margenes.arriba + o.celda.margenes.abajo)), filas[i].f.altoRegla?.valor ?? 0)
        if (necesario > acumulado) filas[fin].altoMin += necesario - acumulado
      }
    })
    const cabeceras: Item[] = []
    const items: Item[] = []
    let enCabecera = true
    for (const { dentro, f, altoMin } of filas) {
      const esCabecera = enCabecera && f.cabecera
      if (!f.cabecera) enCabecera = false
      const item = construir(dentro, altoMin, f.altoRegla, f.sinDividir || esCabecera, esCabecera ? undefined : cabeceras)
      if (esCabecera) { cabeceras.push(item); item.atado = true }
      items.push(item)
    }
    return items
  }

  // Encabezado y pie que corresponden a una hoja.
  const paginas: { seccion: SeccionDoc; primera: boolean }[] = []
  const elegir = (v: Variantes, i: number, primeraSeccion: boolean, s: SeccionDoc) => {
    if (primeraSeccion && s.primeraDistinta) return v.first ?? []
    if (documento.parImpares && (i + 1) % 2 === 0) return v.even ?? v.default ?? []
    return v.default ?? []
  }
  const anchoCuerpo = (p: PaginaDoc) => p.ancho - p.izq - p.der
  const limitesHoja = (s: SeccionDoc, i: number, primera: boolean) => {
    const p = s.pagina
    valores.pagina = i + 1
    const enc = altoDe(maquetar(elegir(s.encabezados, i, primera, s), anchoCuerpo(p)))
    const pie = altoDe(maquetar(elegir(s.pies, i, primera, s), anchoCuerpo(p)))
    return { arriba: Math.max(p.arriba, p.encabezado + enc), abajo: p.alto - Math.max(p.abajo, p.pie + pie) }
  }

  let y = primera.arriba
  let limite = primera.alto - primera.abajo
  let hojaVacia = true
  let arribaSuave = false
  let seccionActual = documento.secciones[0]

  const empezarHoja = (s: SeccionDoc, primeraDeSeccion: boolean) => {
    const i = paginas.length
    paginas.push({ seccion: s, primera: primeraDeSeccion })
    if (i > 0) doc.addPage([s.pagina.ancho, s.pagina.alto], orientacion(s.pagina))
    paginaActual = s.pagina
    xCuerpo = s.pagina.izq
    const l = limitesHoja(s, i, primeraDeSeccion)
    y = l.arriba
    limite = l.abajo
    hojaVacia = true
    valores.pagina = i + 1
  }

  documento.secciones.forEach((s, ns) => {
    if (ns === 0 || !s.continua) empezarHoja(s, true)
    seccionActual = s
    arribaSuave = false
    const anchoBody = anchoCuerpo(s.pagina)
    const cola = maquetar(s.bloques, anchoBody)
    const nueva = (it: Item | undefined) => {
      empezarHoja(seccionActual, false)
      arribaSuave = true
      for (const c of it?.cabeceras ?? []) { c.dibujar(xCuerpo, y); y += c.alto }
    }
    for (let i = 0; i < cola.length; i++) {
      const it = cola[i]
      if (it.salto) {
        if (!it.salto.siNoVacia || !hojaVacia) { empezarHoja(seccionActual, false); arribaSuave = true }
        continue
      }
      const antes = hojaVacia && arribaSuave ? 0 : it.antes
      const cabe = y + antes + it.alto <= limite + 0.01
      if (!cabe && it.dividir) {
        const partes = it.dividir(limite - y - antes)
        if (partes) { partes[0].dibujar(xCuerpo, y + antes); hojaVacia = false; nueva(it); cola.splice(i + 1, 0, partes[1]); continue }
        if (!hojaVacia) { nueva(it); i--; continue }
      }
      // Líneas que deben ir juntas: si el grupo no cabe y sí cabría en una hoja, pasa completo.
      if (!hojaVacia && (it.atado || !cabe)) {
        let j = i
        let grupo = antes + it.alto
        while (cola[j].atado && cola[j + 1] && !cola[j + 1].salto) { j++; grupo += cola[j - 1].despues + cola[j].antes + cola[j].alto }
        if (y + grupo > limite + 0.01) {
          const inicioHoja = limitesHoja(seccionActual, paginas.length, false)
          if (grupo <= inicioHoja.abajo - inicioHoja.arriba || !cabe) { nueva(it); i--; continue }
        }
      }
      y += antes
      it.dibujar(xCuerpo, y)
      y += it.alto + it.despues
      hojaVacia = false
    }
  })

  // Encabezados y pies, ya conocido el total de hojas.
  const total = doc.getNumberOfPages()
  valores.total = totalConocido || total
  paginas.forEach(({ seccion: s, primera: pri }, i) => {
    doc.setPage(i + 1)
    valores.pagina = i + 1
    paginaActual = s.pagina
    const p = s.pagina
    const ancho = anchoCuerpo(p)
    let yy = p.encabezado
    for (const it of maquetar(elegir(s.encabezados, i, pri, s), ancho)) { if (it.salto) continue; yy += it.antes; it.dibujar(p.izq, yy); yy += it.alto + it.despues }
    const itemsPie = maquetar(elegir(s.pies, i, pri, s), ancho).filter((it) => !it.salto)
    yy = p.alto - p.pie - altoDe(itemsPie)
    for (const it of itemsPie) { yy += it.antes; it.dibujar(p.izq, yy); yy += it.alto + it.despues }
    if (op.marca) doc.setTextColor(159, 18, 57).setFont('helvetica', 'bold').setFontSize(9).text(op.marca, p.ancho / 2, 18, { align: 'center' })
  })
  return doc
}

export const pdfABytes = (doc: jsPDF) => new Uint8Array(doc.output('arraybuffer'))
