/**
 * Inventario de lo guardado solo en este navegador antes de conectar Supabase. Solo lee: no borra, no migra y no envía nada.
 * Cada navegador y cada dirección (localhost, 127.0.0.1, la app publicada) tiene su propio almacenamiento.
 */
export interface RegistroLocal { referencia: string; detalle: string; fecha: string | null; usuario: string }
export interface GrupoLocal { clave: string; titulo: string; registros: RegistroLocal[]; desde: string | null; hasta: string | null }

type Fila = Record<string, unknown>
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v))
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Fila) : {})

function leer(clave: string, lista: string): Fila[] {
  try {
    const raw = localStorage.getItem(clave)
    if (!raw) return []
    const d = JSON.parse(raw) as unknown
    const filas = Array.isArray(d) ? d : obj(d)[lista]
    return Array.isArray(filas) ? (filas as Fila[]) : []
  } catch {
    return []
  }
}

const FUENTES: { clave: string; titulo: string; lista: string; mapa: (f: Fila) => RegistroLocal }[] = [
  {
    clave: 'amura.cotizaciones.v1', titulo: 'Cotizaciones', lista: '',
    mapa: (c) => ({ referencia: texto(c.numero), detalle: `${texto(obj(c.cliente).nombre)} · ${texto(obj(c.unidad).dpt || obj(c.unidad).codigo)}`, fecha: texto(c.fecha) || null, usuario: texto(obj(c.creadaPor).nombre) }),
  },
  {
    clave: 'amura.reservas.v1', titulo: 'Reservas', lista: 'reservas',
    mapa: (r) => ({ referencia: texto(r.codigo), detalle: `${texto(r.clienteNombre)} · ${texto(r.unidad)} · ${texto(r.estado)}`, fecha: texto(r.creadaEn).slice(0, 10) || null, usuario: texto(obj(r.creadaPor).nombre) }),
  },
  {
    clave: 'amura.clientes.v1', titulo: 'Clientes sin importar', lista: 'clientes',
    mapa: (c) => ({ referencia: texto(c.nombre), detalle: texto(c.telefono || c.email), fecha: texto(c.creadoEn).slice(0, 10) || null, usuario: texto(obj(c.creadoPor).nombre || c.asesor) }),
  },
  {
    clave: 'amura.clientes.v1.importados', titulo: 'Clientes ya importados (copia archivada)', lista: 'clientes',
    mapa: (c) => ({ referencia: texto(c.nombre), detalle: texto(c.telefono || c.email), fecha: texto(c.creadoEn).slice(0, 10) || null, usuario: texto(obj(c.creadoPor).nombre || c.asesor) }),
  },
]

export function inventarioLocal(): GrupoLocal[] {
  return FUENTES.map((f) => {
    const registros = leer(f.clave, f.lista).map(f.mapa)
    const fechas = registros.map((r) => r.fecha).filter((x): x is string => !!x).sort()
    return { clave: f.clave, titulo: f.titulo, registros, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null }
  }).filter((g) => g.registros.length > 0)
}

/** Copia exacta de lo guardado, para revisarla o conservarla fuera del navegador. */
export function copiaLocal() {
  const copia: Record<string, unknown> = { generada: new Date().toISOString(), origen: typeof location === 'undefined' ? '' : location.origin }
  for (const f of FUENTES) {
    const raw = localStorage.getItem(f.clave)
    if (raw) copia[f.clave] = JSON.parse(raw)
  }
  return JSON.stringify(copia, null, 2)
}
