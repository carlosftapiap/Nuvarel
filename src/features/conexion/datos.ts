import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Acceso a datos que usa la app. La autorización la decide la base de datos (RLS y funciones);
 * esta capa solo traduce llamadas y errores. Se implementa con Supabase y, en pruebas, con Postgres local.
 */
export type Filtro = Record<string, string | number | boolean | null>

export interface ConsultaOpciones {
  filtros?: Filtro
  orden?: { columna: string; asc?: boolean }[]
  limite?: number
  /** Filas a saltar, para leer por páginas (el servidor limita cada respuesta). */
  desde?: number
}

export interface Datos {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
  select<T = Record<string, unknown>>(tabla: string, opts?: ConsultaOpciones): Promise<T[]>
  insert<T = Record<string, unknown>>(tabla: string, fila: Record<string, unknown>): Promise<T>
  /** Falla si ninguna fila se actualizó (sin permiso o inexistente). */
  update(tabla: string, cambios: Record<string, unknown>, filtros: Filtro): Promise<void>
}

/** Mensajes de la base de datos en términos del usuario. Los mensajes propios del flujo ya están en español. */
export function traducirError(mensaje: string): string {
  if (/row-level security/i.test(mensaje)) return 'No tienes permiso para esta operación.'
  if (/permission denied/i.test(mensaje)) return 'No tienes permiso para esta operación.'
  if (/Could not find the function|function public\..* does not exist/i.test(mensaje)) return 'La base de datos aún no tiene esta función: falta aplicar una migración.'
  if (/clients_telefono_uk/.test(mensaje)) return 'Ya existe un cliente con ese teléfono.'
  if (/clients_email_uk/.test(mensaje)) return 'Ya existe un cliente con ese correo.'
  if (/JWT expired|invalid JWT/i.test(mensaje)) return 'Tu sesión expiró. Vuelve a iniciar sesión.'
  if (/Failed to fetch|NetworkError/i.test(mensaje)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo otra vez.'
  return mensaje
}

export class ErrorDatos extends Error {
  constructor(mensaje: string) {
    super(traducirError(mensaje))
    this.name = 'ErrorDatos'
  }
}

export function datosSupabase(client: SupabaseClient): Datos {
  const fallo = (error: { message: string } | null) => { if (error) throw new ErrorDatos(error.message) }
  return {
    async rpc<T>(fn: string, args?: Record<string, unknown>) {
      const { data, error } = await client.rpc(fn, args ?? {})
      fallo(error)
      return data as T
    },
    async select<T>(tabla: string, opts: ConsultaOpciones = {}) {
      let q = client.from(tabla).select('*')
      for (const [k, v] of Object.entries(opts.filtros ?? {})) q = v === null ? q.is(k, null) : q.eq(k, v)
      for (const o of opts.orden ?? []) q = q.order(o.columna, { ascending: o.asc ?? true })
      if (opts.desde !== undefined) q = q.range(opts.desde, opts.desde + (opts.limite ?? 1000) - 1)
      else if (opts.limite) q = q.limit(opts.limite)
      const { data, error } = await q
      fallo(error)
      return (data ?? []) as T[]
    },
    async insert<T>(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await client.from(tabla).insert(fila).select().single()
      fallo(error)
      return data as T
    },
    async update(tabla: string, cambios: Record<string, unknown>, filtros: Filtro) {
      const { data, error } = await client.from(tabla).update(cambios).match(filtros).select('*')
      fallo(error)
      if (!data?.length) throw new ErrorDatos('No tienes permiso para modificar este registro o ya no existe.')
    },
  }
}
