import type { PGlite } from '@electric-sql/pglite'
import { ErrorDatos, type ConsultaOpciones, type Datos, type Filtro } from '../../src/features/conexion/datos'
import { como } from './db'

/**
 * Implementación de `Datos` sobre Postgres local (PGlite) con las migraciones reales.
 * Ejecuta cada llamada como el usuario indicado, con RLS, igual que Supabase con su sesión.
 * Devuelve los tipos como PostgREST: numeric como número, fechas y marcas de tiempo como texto.
 */
const PARSERS = {
  1700: (v: string) => Number(v), // numeric
  1082: (v: string) => v, // date
  1114: (v: string) => v, // timestamp
  1184: (v: string) => v, // timestamptz
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Identificador no válido: ${s}`)
  return s
}

export function datosPglite(db: PGlite, userId: string): Datos {
  const q = async <T>(sql: string, params: unknown[]) => {
    try {
      return await como(db, userId, () => db.query<T>(sql, params, { parsers: PARSERS }))
    } catch (e) {
      throw new ErrorDatos((e as Error).message)
    }
  }
  const donde = (filtros: Filtro = {}, desde = 1) => {
    const partes: string[] = []
    const params: unknown[] = []
    for (const [k, v] of Object.entries(filtros)) {
      if (v === null) partes.push(`${ident(k)} is null`)
      else { params.push(v); partes.push(`${ident(k)} = $${desde + params.length - 1}`) }
    }
    return { sql: partes.length ? ` where ${partes.join(' and ')}` : '', params }
  }
  return {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const nombres = Object.keys(args)
      const lista = nombres.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')
      const valores = nombres.map((k) => {
        const v = args[k]
        // Objetos y listas de objetos viajan como JSON (igual que en el cuerpo de una llamada a Supabase).
        const json = v !== null && typeof v === 'object' && (!Array.isArray(v) || v.some((x) => x !== null && typeof x === 'object'))
        return json ? JSON.stringify(v) : v
      })
      const conjunto = await db.query<{ s: boolean }>(`select bool_or(proretset) as s from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])
      if (conjunto.rows[0]?.s) return (await q(`select * from public.${ident(fn)}(${lista})`, valores)).rows as T
      return (await q<{ r: T }>(`select public.${ident(fn)}(${lista}) as r`, valores)).rows[0]?.r as T
    },
    async select<T>(tabla: string, opts: ConsultaOpciones = {}) {
      const w = donde(opts.filtros)
      const orden = opts.orden?.length ? ` order by ${opts.orden.map((o) => `${ident(o.columna)} ${o.asc === false ? 'desc' : 'asc'}`).join(', ')}` : ''
      const limite = opts.limite ? ` limit ${Number(opts.limite)}` : ''
      const salto = opts.desde ? ` offset ${Number(opts.desde)}` : ''
      return (await q<T>(`select * from public.${ident(tabla)}${w.sql}${orden}${limite}${salto}`, w.params)).rows
    },
    async insert<T>(tabla: string, fila: Record<string, unknown>) {
      const cols = Object.keys(fila)
      const r = await q<T>(`insert into public.${ident(tabla)} (${cols.map(ident).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, cols.map((c) => fila[c]))
      return r.rows[0]
    },
    async update(tabla: string, cambios: Record<string, unknown>, filtros: Filtro) {
      const cols = Object.keys(cambios)
      const w = donde(filtros, cols.length + 1)
      const r = await q(`update public.${ident(tabla)} set ${cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ')}${w.sql} returning 1`, [...cols.map((c) => cambios[c]), ...w.params])
      if (!r.rows.length) throw new ErrorDatos('No tienes permiso para modificar este registro o ya no existe.')
    },
  }
}

/** Storage simulado para las pantallas: la subida se registra en memoria. */
export const almacenPrueba = {
  archivos: new Set<string>(),
  contenido: new Map<string, Blob>(),
  async subir(_b: string, ruta: string, archivo?: Blob) {
    almacenPrueba.archivos.add(ruta); almacenPrueba.contenido.set(ruta,archivo ?? new Blob())
  },
  async descargar(_b: string, ruta: string) {
    const archivo=almacenPrueba.archivos.has(ruta) ? almacenPrueba.contenido.get(ruta) : null
    if (!archivo) throw new Error('El archivo original no existe en Storage')
    if (typeof archivo.arrayBuffer==='function') return archivo.arrayBuffer()
    return new Promise<ArrayBuffer>((resolve,reject)=>{
      const reader=new FileReader(); reader.onload=()=>resolve(reader.result as ArrayBuffer); reader.onerror=()=>reject(reader.error); reader.readAsArrayBuffer(archivo)
    })
  },
  async quitar(_b: string, ruta: string) { almacenPrueba.archivos.delete(ruta); almacenPrueba.contenido.delete(ruta) },
}
export const archivoPrueba = () => new File(['comprobante'], 'comprobante.pdf', { type: 'application/pdf' })
