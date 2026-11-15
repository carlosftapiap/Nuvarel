import * as XLSX from 'xlsx'
import { assertCan } from '@/app/permissions'
import { dataFlags } from './data/data-quality'
import { ESTADOS, ESTADOS_PRECIO_BLOQUEADO, MOTIVO_SIN_CAMBIO, parseEstado, puedeCambiarManual } from './estados'
import { calcularPrecio, round2, totalVenta } from './pricing'
import type { Actor, EstadoComercial, InventoryState, PriceChange, PriceHistoryEntry, StatusHistoryEntry, Unit } from './types'

/* ------------------------------------------------------------------ lectura */

export interface FilaExcel {
  hoja: string
  fila: number
  valores: Partial<Record<CampoImportable | 'codigo', unknown>>
}

export type CampoImportable = 'areaM2' | 'bodegaCodigo' | 'bodegaM2' | 'patioM2' | 'usdM2' | 'estado' | 'notas' | 'parqueo'

const norm = (v: unknown) =>
  String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')

/** Encabezados aceptados: plantilla del módulo y exportación del simulador AMURA. */
const ALIAS: Record<CampoImportable | 'codigo', string[]> = {
  codigo: ['codigo', 'código'],
  areaM2: ['area m2', 'área m2', 'area (m2)', 'area m²', 'área m²'],
  bodegaCodigo: ['bodega'],
  bodegaM2: ['bodega m2', 'bodega m²'],
  patioM2: ['patio m2', 'patio m²'],
  usdM2: ['usd/m2', 'usd/m²', 'precio m2 fijo', 'usd/m2 fijo', 'precio por m2'],
  estado: ['estado', 'estado comercial'],
  notas: ['observaciones', 'notas'],
  parqueo: ['parqueo', 'parqueadero', 'estacionamiento'],
}

export const COLUMNAS_IMPORTABLES = ['Codigo', 'Area m2', 'Bodega', 'Bodega m2', 'Patio m2', 'Parqueo', 'USD/m2', 'Estado', 'Observaciones']

function mapearEncabezados(header: unknown[]) {
  const map = new Map<number, CampoImportable | 'codigo'>()
  header.forEach((h, i) => {
    const n = norm(h)
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (alias.map(norm).includes(n) && ![...map.values()].includes(campo as CampoImportable)) map.set(i, campo as CampoImportable)
    }
  })
  return map
}

export function leerLibro(data: ArrayBuffer): { filas: FilaExcel[]; hojas: string[]; columnas: string[] } {
  const wb = XLSX.read(data, { type: 'array' })
  const filas: FilaExcel[] = []
  const hojas: string[] = []
  const columnas = new Set<string>()
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
    const hIdx = rows.slice(0, 6).findIndex((r) => r.some((c) => norm(c) === 'codigo' || norm(c) === 'código'))
    if (hIdx < 0) continue
    const map = mapearEncabezados(rows[hIdx])
    if (map.size < 2) continue
    hojas.push(name)
    map.forEach((campo) => columnas.add(campo))
    rows.slice(hIdx + 1).forEach((r, k) => {
      const valores: FilaExcel['valores'] = {}
      map.forEach((campo, i) => { valores[campo] = r[i] })
      const cod = norm(valores.codigo)
      if (!cod || cod.startsWith('total')) return
      filas.push({ hoja: name, fila: hIdx + k + 2, valores })
    })
  }
  return { filas, hojas, columnas: [...columnas] }
}

/* --------------------------------------------------------------- validación */

export interface CambioCampo {
  campo: CampoImportable
  etiqueta: string
  antes: string | number | null
  despues: string | number | null
}

export interface FilaValidada {
  hoja: string
  fila: number
  codigo: string
  cambios: CambioCampo[]
  errores: string[]
  advertencias: string[]
  /** Valores normalizados listos para aplicar. */
  nuevo: Partial<Pick<Unit, CampoImportable>>
}

export interface ResultadoValidacion {
  filas: FilaValidada[]
  totalFilas: number
  conCambios: number
  conErrores: number
  conAdvertencias: number
  sinCambios: number
  faltantes: string[]
}

const ETIQUETAS: Record<CampoImportable, string> = {
  areaM2: 'Área m²', bodegaCodigo: 'Bodega', bodegaM2: 'Bodega m²', patioM2: 'Patio m²', usdM2: 'USD/m²', estado: 'Estado', notas: 'Observaciones', parqueo: 'Parqueo',
}

function parseNumero(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '' || v === '-') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  const s = String(v).trim().replace(/usd|\$|m2|m²|\s/gi, '')
  // Formato es-EC "1.234,56" o "70,47"; formato en "1234.56".
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
  return Number.isFinite(n) ? n : NaN
}

function parseBodega(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  const s = String(v ?? '').trim()
  if (!s || s === '-' || norm(s) === 'sin bodega') return null
  return s.replace(/^bod\.?\s*/i, '').toUpperCase()
}

export function validarImportacion(state: InventoryState, filas: FilaExcel[]): ResultadoValidacion {
  const porCodigo = new Map(state.units.map((u) => [u.codigo, u]))
  const vistos = new Map<string, number>()
  const resultado: FilaValidada[] = filas.map((f) => {
    const codigo = String(f.valores.codigo ?? '').trim().toUpperCase()
    const errores: string[] = []
    const advertencias: string[] = []
    const cambios: CambioCampo[] = []
    const nuevo: FilaValidada['nuevo'] = {}
    const u = porCodigo.get(codigo)
    if (vistos.has(codigo)) errores.push(`Código duplicado (también en la fila ${vistos.get(codigo)}).`)
    vistos.set(codigo, f.fila)
    if (!u) {
      errores.push(`El código "${codigo}" no existe en el inventario de AMURA.`)
      return { hoja: f.hoja, fila: f.fila, codigo, cambios, errores, advertencias, nuevo }
    }

    const num = (campo: 'areaM2' | 'bodegaM2' | 'patioM2' | 'usdM2', min: number, max: number, requerido: boolean) => {
      const raw = parseNumero(f.valores[campo])
      if (raw === undefined) return
      if (raw === null) {
        if (requerido) errores.push(`${ETIQUETAS[campo]} es obligatorio.`)
        else if (u[campo] !== 0) { nuevo[campo] = 0; cambios.push({ campo, etiqueta: ETIQUETAS[campo], antes: u[campo], despues: 0 }) }
        return
      }
      if (Number.isNaN(raw)) return void errores.push(`${ETIQUETAS[campo]} no es un número válido ("${String(f.valores[campo])}").`)
      if (raw < min || raw > max) return void errores.push(`${ETIQUETAS[campo]} fuera de rango (${min} a ${max}): ${raw}.`)
      const v = round2(raw)
      if (Math.abs(v - u[campo]) > 0.004) { nuevo[campo] = v; cambios.push({ campo, etiqueta: ETIQUETAS[campo], antes: u[campo], despues: v }) }
    }
    num('areaM2', 20, 400, true)
    num('bodegaM2', 0, 30, false)
    num('patioM2', 0, 500, false)
    num('usdM2', 500, 10000, true)

    const bod = parseBodega(f.valores.bodegaCodigo)
    if (bod !== undefined && bod !== u.bodegaCodigo) {
      nuevo.bodegaCodigo = bod
      cambios.push({ campo: 'bodegaCodigo', etiqueta: ETIQUETAS.bodegaCodigo, antes: u.bodegaCodigo, despues: bod })
    }

    if (f.valores.estado !== undefined && f.valores.estado !== null && String(f.valores.estado).trim() !== '') {
      const e = parseEstado(f.valores.estado)
      if (!e) errores.push(`Estado "${String(f.valores.estado)}" no reconocido. Usa: ${Object.values(ESTADOS).map((x) => x.label).join(', ')}.`)
      else if (e !== u.estado) {
        // Un Excel no cambia estados protegidos: reservas y contratos solo se mueven desde su módulo.
        if (!puedeCambiarManual(u.estado, e)) errores.push(MOTIVO_SIN_CAMBIO[u.estado] ?? `No se permite pasar de "${ESTADOS[u.estado].label}" a "${ESTADOS[e].label}".`)
        else {
          nuevo.estado = e
          cambios.push({ campo: 'estado', etiqueta: ETIQUETAS.estado, antes: ESTADOS[u.estado].label, despues: ESTADOS[e].label })
        }
      }
    }

    if (f.valores.notas !== undefined) {
      const n = String(f.valores.notas ?? '').trim()
      if (n.length > 500) errores.push('Observaciones supera 500 caracteres.')
      else if (n !== u.notas) { nuevo.notas = n; cambios.push({ campo: 'notas', etiqueta: ETIQUETAS.notas, antes: u.notas || null, despues: n || null }) }
    }

    if (f.valores.parqueo !== undefined) {
      const raw = String(f.valores.parqueo ?? '').trim()
      const pq = !raw || raw === '-' || ['sin parqueo', 'sin asignar'].includes(norm(raw)) ? null : raw.toUpperCase()
      if (pq && pq.length > 20) errores.push('Parqueo supera 20 caracteres.')
      else if (pq !== u.parqueo) { nuevo.parqueo = pq; cambios.push({ campo: 'parqueo', etiqueta: ETIQUETAS.parqueo, antes: u.parqueo, despues: pq }) }
    }

    const tocaPrecio = ['areaM2', 'bodegaM2', 'patioM2', 'usdM2'].some((k) => k in nuevo)
    if (tocaPrecio && ESTADOS_PRECIO_BLOQUEADO.includes(u.estado)) {
      errores.push(`Precio y superficies congelados: la unidad está ${ESTADOS[u.estado].label.toLowerCase()}.`)
    }
    if ('usdM2' in nuevo && Math.abs(nuevo.usdM2! / u.usdM2 - 1) > 0.1) {
      advertencias.push(`El USD/m² varía más de 10% (${u.usdM2} → ${nuevo.usdM2}).`)
    }
    if ('areaM2' in nuevo) advertencias.push('Modifica un área verificada contra planos y segregación de bodegas.')
    if ('bodegaM2' in nuevo) advertencias.push('Modifica una bodega verificada contra los planos.')
    return { hoja: f.hoja, fila: f.fila, codigo, cambios, errores, advertencias, nuevo }
  })
  const importados = new Set(resultado.map((r) => r.codigo))
  return {
    filas: resultado,
    totalFilas: resultado.length,
    conCambios: resultado.filter((r) => r.cambios.length && !r.errores.length).length,
    conErrores: resultado.filter((r) => r.errores.length).length,
    conAdvertencias: resultado.filter((r) => r.advertencias.length).length,
    sinCambios: resultado.filter((r) => !r.cambios.length && !r.errores.length).length,
    faltantes: state.units.map((u) => u.codigo).filter((c) => !importados.has(c)),
  }
}

/* ---------------------------------------------------------------- aplicación */

export function aplicarImportacion(state: InventoryState, v: ResultadoValidacion, motivo: string, actor: Actor, archivo: string): InventoryState {
  assertCan(actor, 'inventario.importar')
  if (v.conErrores) throw new Error('Corrige los errores del archivo antes de importar.')
  if (motivo.trim().length < 5) throw new Error('Indica el motivo de la importación (mínimo 5 caracteres).')
  const filas = v.filas.filter((f) => f.cambios.length)
  if (!filas.length) throw new Error('El archivo no contiene cambios.')
  const fecha = new Date().toISOString()
  const porCodigo = new Map(filas.map((f) => [f.codigo, f.nuevo]))
  const cambiosPrecio: PriceChange[] = []
  const estados: StatusHistoryEntry[] = []
  const units = state.units.map((u) => {
    const n = porCodigo.get(u.codigo)
    if (!n) return u
    const next: Unit = { ...u, ...n }
    const a = calcularPrecio(u, state.params).precioVenta
    const d = calcularPrecio(next, state.params).precioVenta
    if (a !== d || u.usdM2 !== next.usdM2) cambiosPrecio.push({ codigo: u.codigo, antesUsdM2: u.usdM2, despuesUsdM2: next.usdM2, antesPrecio: a, despuesPrecio: d })
    if (n.estado && n.estado !== u.estado) {
      estados.push({ id: `st-imp-${u.codigo}-${fecha}`, fecha, usuario: actor.nombre, rol: actor.rol, codigo: u.codigo, de: u.estado, a: n.estado as EstadoComercial, motivo: `${motivo.trim()} (importación ${archivo})`, reservaId: u.reservaId })
    }
    return next
  })
  const priceHistory: PriceHistoryEntry[] = cambiosPrecio.length
    ? [{
        id: `pi-${fecha}`, fecha, usuario: actor.nombre, rol: actor.rol, tipo: 'importacion',
        alcance: `${filas.length} filas · ${archivo}`, motivo: motivo.trim(),
        detalle: `Importación desde Excel: ${cambiosPrecio.length} precios modificados`,
        cambios: cambiosPrecio, totalAntes: totalVenta(state.units, state.params), totalDespues: totalVenta(units, state.params),
      }, ...state.priceHistory]
    : state.priceHistory
  return { ...state, units, priceHistory, statusHistory: [...estados, ...state.statusHistory] }
}

/* ---------------------------------------------------------------- exportación */

export function filasExportacion(state: InventoryState) {
  return state.units.map((u) => {
    const p = calcularPrecio(u, state.params)
    return {
      Codigo: u.codigo, DPT: u.dpt, Edificio: u.edificio, Piso: u.piso === 'PB' ? 'PB' : `P${u.piso}`, Ubicacion: u.ubicacion, Tipologia: u.tipologia,
      'Area m2': u.areaM2, Bodega: u.bodegaCodigo ?? 'sin bodega', 'Bodega m2': u.bodegaM2, 'Area + bodega m2': p.areaVendibleM2,
      'Patio m2': u.patioM2, Parqueo: u.parqueo ?? 'sin asignar', 'USD/m2': u.usdM2, 'Precio area + bodega': p.precioAreaBodega, 'Valor patio': p.valorPatio,
      'Precio de venta': p.precioVenta, [`Pago a la firma ${state.params.reservaPct}%`]: p.reserva, 'Cuota mensual': p.cuotaMensual, Meses: p.meses,
      'Contra entrega': p.contraEntrega, Estado: ESTADOS[u.estado].label, Observaciones: u.notas,
      'Datos por confirmar': dataFlags(u).filter((x) => x.nivel !== 'referencial').map((x) => `${x.campo}: ${x.mensaje}`).join(' | '),
    }
  })
}

export function construirLibro(state: InventoryState, opts: { plantilla?: boolean } = {}) {
  const wb = XLSX.utils.book_new()
  const filas = opts.plantilla
    ? state.units.map((u) => ({ Codigo: u.codigo, 'Area m2': u.areaM2, Bodega: u.bodegaCodigo ?? 'sin bodega', 'Bodega m2': u.bodegaM2, 'Patio m2': u.patioM2, Parqueo: u.parqueo ?? '', 'USD/m2': u.usdM2, Estado: ESTADOS[u.estado].label, Observaciones: u.notas }))
    : filasExportacion(state)
  const ws = XLSX.utils.json_to_sheet(filas)
  ws['!cols'] = Object.keys(filas[0]).map((k) => ({ wch: Math.max(10, Math.min(28, k.length + 2)) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
  const p = state.params
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['AMURA · Inventario', opts.plantilla ? 'Plantilla de importación' : 'Exportación'],
    ['Generado', new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })],
    ['Valor m2 patio (USD)', p.patioUsdM2], ['Pago a la firma %', p.reservaPct], ['Cuotas %', p.cuotasPct],
    ['Meses Edificio A', p.meses[1]], ['Meses Edificio B', p.meses[2]],
    ['Regla', 'Precio = redondeo(USD/m2 x (area + bodega)) + patio x valor m2 patio'],
    ['Estados válidos', Object.values(ESTADOS).map((e) => e.label).join(', ')],
    ['Aviso', 'Precios referenciales (lista base 28/10/2026). Disponibilidad no confirmada salvo que el estado lo indique.'],
  ]), 'Parametros')
  if (!opts.plantilla && state.priceHistory.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(state.priceHistory.flatMap((h) => h.cambios.map((c) => ({
      Fecha: new Date(h.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }), Usuario: h.usuario, Rol: h.rol, Tipo: h.tipo, Alcance: h.alcance,
      Motivo: h.motivo, Codigo: c.codigo, 'USD/m2 antes': c.antesUsdM2, 'USD/m2 despues': c.despuesUsdM2, 'Precio antes': c.antesPrecio, 'Precio despues': c.despuesPrecio,
    })))), 'Historial precios')
  }
  return wb
}

export function descargarLibro(state: InventoryState, opts: { plantilla?: boolean } = {}) {
  const fecha = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(construirLibro(state, opts), opts.plantilla ? `AMURA_plantilla_inventario_${fecha}.xlsx` : `AMURA_inventario_${fecha}.xlsx`)
}
