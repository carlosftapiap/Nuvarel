import type { Datos } from '@/features/conexion/datos'
import { createInitialState } from './service'
import type { InventoryState, PriceChange, PriceHistoryEntry, PriceProposal, StatusHistoryEntry, Unit } from './types'

/**
 * Inventario desde Supabase. Lectura con RLS; cada cambio se guarda con su función del servidor
 * (permiso, validación, motivo y auditoría en la base de datos).
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const n = (v: unknown) => Number(v)

/** Carga el inventario completo. La semilla aporta solo los datos que no viven en la base (precio de referencia). */
export async function cargarInventario(datos: Datos): Promise<InventoryState> {
  const seed = createInitialState()
  const orden = new Map(seed.units.map((u, i) => [u.codigo, i]))
  const [filas, params, ph, sh, pr, perfiles] = await Promise.all([
    datos.select<Fila>('inventory_units'),
    datos.select<Fila>('pricing_params', { filtros: { id: 1 } }),
    datos.select<Fila>('inventory_price_history', { orden: [{ columna: 'fecha', asc: false }], limite: 300 }),
    datos.select<Fila>('inventory_status_history', { orden: [{ columna: 'fecha', asc: false }], limite: 300 }),
    datos.select<Fila>('price_proposals', { orden: [{ columna: 'fecha', asc: false }], limite: 200 }),
    datos.select<Fila>('profiles'),
  ])
  const nombre = new Map(perfiles.map((p) => [String(p.id), String(p.nombre)]))
  const quien = (id: unknown) => nombre.get(String(id)) ?? 'Usuario'
  const p = params[0]
  if (!p) throw new Error('Falta la configuración de precios (pricing_params) en la base de datos.')

  const seedPorCodigo = new Map(seed.units.map((u) => [u.codigo, u]))
  const units: Unit[] = filas
    .map((f): Unit => {
      const sd = seedPorCodigo.get(String(f.codigo))
      return {
        codigo: String(f.codigo), dpt: String(f.dpt), edificio: n(f.edificio) as Unit['edificio'], piso: String(f.piso) as Unit['piso'],
        posicion: n(f.posicion), ubicacion: String(f.ubicacion), tipologia: String(f.tipologia) as Unit['tipologia'],
        areaM2: n(f.area_m2), bodegaCodigo: s(f.bodega_codigo), bodegaM2: n(f.bodega_m2), patioM2: n(f.patio_m2),
        usdM2: n(f.usd_m2), precioReferencia: sd?.precioReferencia ?? 0,
        estado: String(f.estado) as Unit['estado'], reservaId: s(f.reserva_id), notas: String(f.notas ?? ''),
        parqueo: s(f.parqueo), planoPath: s(f.plano_path), imagenes: (f.imagenes as string[] | null) ?? [],
      }
    })
    .sort((a, b) => (orden.get(a.codigo) ?? 999) - (orden.get(b.codigo) ?? 999))

  const priceHistory: PriceHistoryEntry[] = ph.map((h) => ({
    id: String(h.id), fecha: String(h.fecha), usuario: quien(h.user_id), rol: String(h.rol), tipo: h.tipo as PriceHistoryEntry['tipo'],
    alcance: String(h.alcance), motivo: String(h.motivo), detalle: String(h.detalle), cambios: (h.cambios as PriceChange[]) ?? [],
    totalAntes: n(h.total_antes), totalDespues: n(h.total_despues),
  }))
  const statusHistory: StatusHistoryEntry[] = sh.map((h) => ({
    id: String(h.id), fecha: String(h.fecha), usuario: quien(h.user_id), rol: String(h.rol), codigo: String(h.codigo),
    de: h.de as StatusHistoryEntry['de'], a: h.a as StatusHistoryEntry['a'], motivo: String(h.motivo), reservaId: s(h.reserva_id),
  }))
  const propuestas = pr.map((r): PriceProposal => ({
    id: String(r.id), fecha: String(r.fecha), usuario: quien(r.user_id), rol: String(r.rol),
    alcance: {
      ...(r.p_codigos ? { codigos: r.p_codigos as string[] } : {}),
      ...(r.p_edificio ? { edificio: n(r.p_edificio) as PriceProposal['alcance']['edificio'] } : {}),
      ...(r.p_piso ? { piso: String(r.p_piso) as PriceProposal['alcance']['piso'] } : {}),
      ...(r.p_tipologia ? { tipologia: String(r.p_tipologia) as PriceProposal['alcance']['tipologia'] } : {}),
    },
    modo: r.modo as PriceProposal['modo'], valor: n(r.valor), motivo: String(r.motivo), descripcion: String(r.descripcion),
    cambios: (r.cambios as PriceChange[]) ?? [], totalAntes: n(r.total_antes), totalDespues: n(r.total_despues),
    estado: r.estado as PriceProposal['estado'],
    resolucion: r.resuelta_en
      ? { usuario: quien(r.resuelta_por), rol: '', fecha: String(r.resuelta_en), comentario: String(r.comentario ?? '') }
      : null,
  }))

  return {
    version: 1,
    units,
    params: {
      patioUsdM2: n(p.patio_usd_m2), reservaPct: n(p.reserva_pct), cuotasPct: n(p.cuotas_pct),
      meses: { 1: n(p.meses_e1), 2: n(p.meses_e2) },
    },
    priceHistory,
    statusHistory,
    propuestas,
  }
}

/**
 * Escribe en la base solo lo que cambió, en este orden:
 * parámetros, propuestas nuevas, resolución de propuestas, estados y precios.
 * Si una propuesta se aprueba, el servidor ya aplicó sus precios: no se repiten.
 */
export async function persistirCambios(datos: Datos, prev: InventoryState, next: InventoryState): Promise<void> {
  // 1. Parámetros de pago
  if (JSON.stringify(prev.params) !== JSON.stringify(next.params)) {
    const p = next.params
    const motivo = next.priceHistory.find((h) => h.tipo === 'parametros')?.motivo ?? 'Cambio de parámetros de pago'
    await datos.rpc('inventario_actualizar_parametros', {
      p_patio: p.patioUsdM2, p_reserva: p.reservaPct, p_cuotas: p.cuotasPct, p_meses_e1: p.meses[1], p_meses_e2: p.meses[2], p_motivo: motivo,
    })
  }

  // 2. Propuestas nuevas (quedan pendientes de aprobación)
  const conocidas = new Set(prev.propuestas.map((x) => x.id))
  for (const pr of next.propuestas) {
    if (conocidas.has(pr.id)) continue
    await datos.rpc('precios_proponer', {
      p_modo: pr.modo, p_valor: pr.valor, p_motivo: pr.motivo,
      p_codigos: pr.alcance.codigos ?? null, p_edificio: pr.alcance.edificio ?? null, p_piso: pr.alcance.piso ?? null,
      p_tipologia: pr.alcance.tipologia ?? null, p_descripcion: pr.descripcion,
    })
  }

  // 3. Propuestas resueltas (aprobadas o rechazadas)
  let aprobada = false
  for (const pr of next.propuestas) {
    const antes = prev.propuestas.find((x) => x.id === pr.id)
    if (!antes || antes.estado !== 'pendiente' || pr.estado === 'pendiente') continue
    const comentario = pr.resolucion?.comentario ?? ''
    await datos.rpc('precios_resolver_propuesta', { p_id: pr.id, p_aprobar: pr.estado === 'aprobada', p_comentario: comentario })
    if (pr.estado === 'aprobada') aprobada = true
  }

  // 4. Estados comerciales (con el motivo de su historial)
  const previos = new Map(prev.units.map((u) => [u.codigo, u]))
  for (const u of next.units) {
    const p = previos.get(u.codigo)
    if (!p || p.estado === u.estado) continue
    const motivo = next.statusHistory.find((h) => h.codigo === u.codigo && h.a === u.estado)?.motivo ?? 'Cambio de estado'
    await datos.rpc('inventario_cambiar_estado', { p_codigo: u.codigo, p_estado: u.estado, p_motivo: motivo, p_reserva_id: null })
  }

  // 5. Precios directos (si una propuesta se aprobó, el servidor ya los aplicó)
  if (aprobada) return
  const porPrecio = new Map<number, string[]>()
  for (const u of next.units) {
    const p = previos.get(u.codigo)
    if (!p || p.usdM2 === u.usdM2) continue
    porPrecio.set(u.usdM2, [...(porPrecio.get(u.usdM2) ?? []), u.codigo])
  }
  for (const [valor, codigos] of porPrecio) {
    const motivo = next.priceHistory.find((h) => h.cambios.some((c) => c.codigo === codigos[0]))?.motivo ?? 'Cambio de precio'
    await datos.rpc('inventario_ajustar_precio', { p_modo: 'fijar', p_valor: valor, p_motivo: motivo, p_codigos: codigos })
  }
}
