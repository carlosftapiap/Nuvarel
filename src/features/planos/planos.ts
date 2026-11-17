import { PDFDocument } from 'pdf-lib'
import { almacenContratosSupabase, nombreSeguro, type AlmacenContratos } from '@/features/contratos/almacen'
import type { Datos } from '@/features/conexion/datos'
import type { Edificio, Piso } from '@/features/inventario/types'
import { nombreEdificio } from '@/features/inventario/nomenclatura'

/** Bucket privado de planos (migración 0021). */
export const BUCKET_PLANOS = 'planos-amura'
export const MAX_PLANO = 20 * 1024 * 1024

export type TipoPlano = 'piso' | 'unidad'
export type EstadoPlano = 'en_revision' | 'pendiente_aprobacion' | 'publicado' | 'reemplazado' | 'rechazado' | 'eliminado'

export interface Plano {
  id: string
  tipo: TipoPlano
  edificio: Edificio
  piso: Piso
  unidadCodigo: string | null
  nivelEnPlano: string | null
  unidadesEnPlano: string[]
  archivoNombre: string
  ruta: string
  paginas: number
  estado: EstadoPlano
  inconsistencias: string[]
  motivoRechazo: string | null
  cargadoEn: string
}

export const ESTADO_PLANO: Record<EstadoPlano, string> = {
  en_revision: 'Bloqueado',
  pendiente_aprobacion: 'Pendiente',
  publicado: 'Disponible',
  reemplazado: 'Reemplazado',
  rechazado: 'Rechazado',
  eliminado: 'Eliminado',
}

/** Plano disponible que ocuparía la misma ubicación (para pedir confirmación antes de reemplazarlo). */
export function planoVigente(planos: Plano[], n: { tipo: TipoPlano; edificio: number; piso: string; unidadCodigo: string | null }) {
  return planos.find((p) => p.estado === 'publicado' && p.tipo === n.tipo && p.edificio === n.edificio && p.piso === n.piso
    && (p.unidadCodigo ?? '') === (n.unidadCodigo ?? '')) ?? null
}

export const PISOS: Piso[] = ['PB', '1', '2', '3', '4', '5']
export const nombrePiso = (p: Piso) => (p === 'PB' ? 'Planta baja' : `Piso ${p}`)
export const ubicacion = (e: Edificio, p: Piso) => `${nombreEdificio(e)} · ${nombrePiso(p)}`

/** «B-101, B-102 / B103» → ['B-101', 'B-102', 'B103']. Se guardan tal como se leen en el plano. */
export function leerUnidades(texto: string): string[] {
  return [...new Set(texto.split(/[,;/\n]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))]
}

const aPlano = (f: Record<string, unknown>): Plano => ({
  id: String(f.id),
  tipo: f.tipo as TipoPlano,
  edificio: Number(f.edificio) as Edificio,
  piso: String(f.piso) as Piso,
  unidadCodigo: f.unidad_codigo ? String(f.unidad_codigo) : null,
  nivelEnPlano: f.nivel_en_plano ? String(f.nivel_en_plano) : null,
  unidadesEnPlano: (f.unidades_en_plano as string[] | null) ?? [],
  archivoNombre: String(f.archivo_nombre ?? ''),
  ruta: String(f.ruta),
  paginas: Number(f.paginas ?? 1),
  estado: f.estado as EstadoPlano,
  inconsistencias: (f.inconsistencias as string[] | null) ?? [],
  motivoRechazo: f.motivo_rechazo ? String(f.motivo_rechazo) : null,
  cargadoEn: String(f.cargado_en ?? ''),
})

/** Todos los planos que el usuario puede ver (la base solo devuelve publicados a quien no administra). */
export async function listarPlanos(d: Datos): Promise<Plano[]> {
  const filas = await d.select<Record<string, unknown>>('planos', { orden: [{ columna: 'cargado_en', asc: false }] })
  return filas.map(aPlano)
}

/** Plano que corresponde a un departamento: el individual si está publicado; si no, el general de su piso. */
export function planoDeUnidad(planos: Plano[], u: { codigo: string; edificio: number; piso: string }): Plano | null {
  const publicados = planos.filter((p) => p.estado === 'publicado')
  return publicados.find((p) => p.tipo === 'unidad' && p.unidadCodigo === u.codigo)
    ?? publicados.find((p) => p.tipo === 'piso' && p.edificio === u.edificio && p.piso === u.piso)
    ?? null
}

/** Título del plano para el vendedor. Un plano de piso nunca se presenta como plano del departamento. */
export function tituloPlano(p: Plano, dpt?: string) {
  return p.tipo === 'unidad' ? `Plano del departamento${dpt ? ` ${dpt}` : ''}` : `Plano de planta del piso · ${ubicacion(p.edificio, p.piso)}`
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface NuevoPlano {
  tipo: TipoPlano
  edificio: Edificio
  piso: Piso
  unidadCodigo: string | null
  /** Opcional (sección avanzada): numeración original del plano, para compararla con el inventario. */
  nivelEnPlano?: string
  unidadesEnPlano?: string[]
  archivo: File
}

/** Revisa el formulario antes de subir. La base vuelve a validar contra el inventario. */
export function revisarNuevoPlano(n: Omit<NuevoPlano, 'archivo'> & { archivo: File | null }): string[] {
  const e: string[] = []
  if (!n.archivo) e.push('Selecciona el archivo PDF del plano.')
  else {
    if (n.archivo.type && n.archivo.type !== 'application/pdf') e.push('El plano debe ser un PDF.')
    if (n.archivo.size > MAX_PLANO) e.push('El PDF supera 20 MB.')
  }
  if (n.tipo === 'unidad' && !n.unidadCodigo) e.push('Elige el departamento del plano individual.')
  return e
}

/**
 * Sube el PDF al bucket privado y lo registra. Sin inconsistencias queda disponible de inmediato;
 * con inconsistencias queda bloqueado. Reemplazar un plano disponible exige `reemplazar = true`.
 */
export async function cargarPlano(d: Datos, n: NuevoPlano, reemplazar = false, almacen: AlmacenContratos = almacenContratosSupabase) {
  const errores = revisarNuevoPlano(n)
  if (errores.length) throw new Error(errores.join(' '))
  const bytes = new Uint8Array(await n.archivo.arrayBuffer())
  let paginas: number
  try {
    paginas = (await PDFDocument.load(bytes)).getPageCount()
  } catch {
    throw new Error('El archivo no es un PDF válido.')
  }
  if (paginas > 20) throw new Error(`El plano tiene ${paginas} páginas; el máximo es 20.`)
  const sha = await sha256Hex(bytes)
  const ruta = `E${n.edificio}/${n.piso}/${crypto.randomUUID()}-${nombreSeguro(n.archivo.name)}`
  await almacen.subir(BUCKET_PLANOS, ruta, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf')
  try {
    return await d.rpc<{ id: string; estado: EstadoPlano; inconsistencias: string[] }>('planos_registrar', {
      p_tipo: n.tipo, p_edificio: n.edificio, p_piso: n.piso, p_unidad: n.unidadCodigo, p_nivel_en_plano: n.nivelEnPlano?.trim() || null,
      p_unidades: n.unidadesEnPlano ?? [], p_ruta: ruta, p_sha256: sha, p_paginas: paginas, p_nombre: n.archivo.name,
      p_reemplazar: reemplazar,
    })
  } catch (e) {
    // Sin registro, el archivo no queda huérfano.
    await almacen.quitar?.(BUCKET_PLANOS, ruta).catch(() => undefined)
    throw e
  }
}

/** Retira el plano: deja de mostrarse a vendedores; el registro y el archivo se conservan internamente. */
export const eliminarPlano = (d: Datos, id: string) => d.rpc('planos_eliminar', { p_id: id })

/**
 * Abre el plano en el visor del navegador (desde ahí se imprime o descarga).
 * La pestaña se abre en el clic para que el navegador no la bloquee; luego carga un enlace temporal privado.
 */
export async function verPlano(p: Plano, almacen: AlmacenContratos = almacenContratosSupabase) {
  const ventana = window.open('', '_blank')
  if (!ventana) throw new Error('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.')
  try {
    const urls = await almacen.urlFirmadas?.(BUCKET_PLANOS, [p.ruta], 600)
    const url = urls?.[p.ruta]
    if (!url) throw new Error('No tienes acceso a este plano o aún no está publicado.')
    ventana.location.href = url
  } catch (e) {
    ventana.close()
    throw e
  }
}
