import type { ConsultaOpciones, Datos } from '@/features/conexion/datos'
import { aDesistimiento, type Desistimiento } from './desistimiento'
import type { AccesoCliente, Actividad, Cliente, ClientesState, Etapa, EtapaOportunidad, Oportunidad, ProximaActividad } from './model'

/**
 * Clientes desde Supabase. Lectura con RLS; cada cambio se guarda con su función del servidor
 * (permiso, alcance, versión, motivo y auditoría en la base de datos).
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const fecha = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export interface Persona { id: string; nombre: string }

export interface DatosClientes {
  state: ClientesState
  oportunidades: Oportunidad[]
  /** Usuarios activos a los que se puede asignar (los perfiles que permite leer la base de datos). */
  asignables: Persona[]
  /** Corredores registrados, para indicar el origen de un cliente. */
  corredores: Persona[]
  /** Importación ordinaria desde el navegador abierta. Administración conserva la recuperación aunque esté cerrada. */
  importacionAbierta: boolean
  desistimientos: Desistimiento[]
  /** La base ya tiene la función de desistimiento (migración 20261031030000). */
  hayDesistimientos: boolean
  /** La base de datos conectada todavía no tiene la migración de este módulo. */
  faltaMigracion: boolean
}

/** Lee todas las filas por páginas: el servidor devuelve como máximo 1.000 por consulta. */
async function leerTodo(datos: Datos, tabla: string, opts: ConsultaOpciones = {}) {
  const filas: Fila[] = []
  for (;;) {
    const pagina = await datos.select<Fila>(tabla, { ...opts, desde: filas.length, limite: 1000 })
    if (!pagina.length) return filas
    filas.push(...pagina)
  }
}

export async function cargarClientes(datos: Datos): Promise<DatosClientes> {
  const [clientes, actividades, oportunidades, cotizaciones, perfiles] = await Promise.all([
    leerTodo(datos, 'clients', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] }),
    leerTodo(datos, 'client_activities', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] }),
    leerTodo(datos, 'opportunities', { orden: [{ columna: 'created_at' }, { columna: 'id' }] }),
    leerTodo(datos, 'quotes', { orden: [{ columna: 'created_at', asc: false }, { columna: 'id' }] }),
    datos.select<Fila>('profiles', { filtros: { estado: 'activo' }, orden: [{ columna: 'nombre' }] }),
  ])
  let personas: Fila[] = []
  let corredores: Fila[] = []
  let accesos: Fila[] = []
  let ajustes: Fila[] = []
  let faltaMigracion = false
  try {
    ;[personas, corredores, accesos, ajustes] = await Promise.all([
      datos.rpc<Fila[]>('clientes_personas'), datos.rpc<Fila[]>('clientes_corredores'),
      datos.select<Fila>('client_access', { filtros: { revocado_en: null } }), datos.select<Fila>('client_import_settings'),
    ])
  } catch (e) {
    if (!/falta aplicar una migración|client_access|client_import_settings/.test((e as Error).message)) throw e
    faltaMigracion = true
  }
  // Va aparte: sin su migración, Clientes sigue funcionando y solo se oculta esta acción.
  let desistimientos: Fila[] = []
  let hayDesistimientos = true
  try {
    desistimientos = await datos.select<Fila>('desistimientos', { orden: [{ columna: 'registrado_en', asc: false }, { columna: 'id' }] })
  } catch {
    hayDesistimientos = false
  }
  const nombre = new Map([...perfiles, ...personas].map((p) => [String(p.id), String(p.nombre)]))
  const quien = (id: unknown) => nombre.get(String(id)) ?? 'Otro usuario'

  const porCliente = new Map<string, Actividad[]>()
  for (const a of actividades) {
    const lista = porCliente.get(String(a.client_id)) ?? []
    lista.push({
      id: String(a.id), tipo: a.tipo as Actividad['tipo'], fecha: fecha(a.fecha)!, descripcion: String(a.descripcion),
      usuario: quien(a.user_id), registradaEn: String(a.created_at), referencia: s(a.referencia),
    })
    porCliente.set(String(a.client_id), lista)
  }
  const accesosPor = new Map<string, AccesoCliente[]>()
  for (const a of accesos) {
    accesosPor.set(String(a.client_id), [...(accesosPor.get(String(a.client_id)) ?? []), { usuarioId: String(a.usuario_id), nombre: quien(a.usuario_id), motivo: String(a.motivo), otorgadoEn: String(a.otorgado_en) }])
  }
  const numeros = new Map<string, string[]>()
  for (const q of cotizaciones) {
    if (!q.client_id) continue
    numeros.set(String(q.client_id), [...(numeros.get(String(q.client_id)) ?? []), String(q.numero)])
  }

  return {
    faltaMigracion,
    state: {
      version: 1,
      clientes: clientes.map((c): Cliente => {
        const acts = porCliente.get(String(c.id)) ?? []
        const referencias = acts.filter((a) => a.tipo === 'cotizacion' && a.referencia).map((a) => a.referencia!)
        const proxima: ProximaActividad | null = c.proxima_tipo && c.proxima_fecha
          ? { tipo: c.proxima_tipo as ProximaActividad['tipo'], descripcion: String(c.proxima_descripcion ?? ''), fecha: fecha(c.proxima_fecha)! }
          : null
        return {
          id: String(c.id), nombre: String(c.nombre), primerNombre: String(c.primer_nombre ?? ''), segundoNombre: String(c.segundo_nombre ?? ''), primerApellido: String(c.primer_apellido ?? ''), segundoApellido: String(c.segundo_apellido ?? ''), documento: String(c.documento ?? ''), telefono: String(c.telefono ?? ''), email: String(c.email ?? ''),
          origen: c.origen as Cliente['origen'], origenDetalle: String(c.origen_detalle ?? ''), corredorOrigenId: s(c.corredor_origen_id), unidadesInteres: (c.unidades_interes as string[] | null) ?? [],
          presupuesto: c.presupuesto === null || c.presupuesto === undefined ? null : Number(c.presupuesto),
          proposito: (c.proposito as Cliente['proposito']) ?? null, formaPago: (c.forma_pago as Cliente['formaPago']) ?? null,
          asesorId: String(c.asesor_id), asesor: quien(c.asesor_id),
          atribucion: { usuarioId: String(c.atribucion_usuario_id ?? c.created_by), nombre: quien(c.atribucion_usuario_id ?? c.created_by), fecha: fecha(c.created_at) ?? '' },
          etapa: c.etapa as Etapa, motivoPerdida: String(c.motivo_perdida ?? ''), fechaRetomar: fecha(c.fecha_retomar), proxima, actividades: acts,
          cotizaciones: [...new Set([...(numeros.get(String(c.id)) ?? []), ...referencias])],
          creadoPor: { id: String(c.created_by), nombre: quien(c.created_by), rol: '' },
          creadoEn: String(c.created_at), actualizadoEn: String(c.updated_at), version: Number(c.version ?? 1),
          accesos: accesosPor.get(String(c.id)) ?? [], deLaBase: true,
        }
      }),
    },
    oportunidades: oportunidades.map((o): Oportunidad => ({
      id: String(o.id), clienteId: String(o.client_id), codigoUnidad: s(o.codigo_unidad), tipologia: s(o.tipologia), etapa: o.etapa as EtapaOportunidad,
      responsableId: String(o.responsable_id), motivoPerdida: s(o.motivo_perdida), creadaEn: String(o.created_at),
    })),
    asignables: perfiles.map((p) => ({ id: String(p.id), nombre: String(p.nombre) })),
    corredores: corredores.map((p) => ({ id: String(p.id), nombre: String(p.nombre) })),
    importacionAbierta: ajustes[0] ? Boolean(ajustes[0].habilitada) : true,
    desistimientos: desistimientos.map(aDesistimiento),
    hayDesistimientos,
  }
}

const aDatos = (c: Cliente) => ({
  ...(c.primerNombre === undefined ? {} : { primer_nombre: c.primerNombre, segundo_nombre: c.segundoNombre ?? '', primer_apellido: c.primerApellido ?? '', segundo_apellido: c.segundoApellido ?? '' }),
  nombre: c.nombre, documento: c.documento ?? '', corredor_origen_id: c.corredorOrigenId ?? null, telefono: c.telefono, email: c.email, origen: c.origen, origen_detalle: c.origenDetalle, unidades_interes: c.unidadesInteres,
  presupuesto: c.presupuesto, proposito: c.proposito, forma_pago: c.formaPago,
})

const iguales = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Escribe en la base solo lo que cambió, en este orden: datos, asesor, actividades, etapa y próxima actividad.
 * Las transiciones de Reserva no se envían: solo las hace el flujo de Reservas en el servidor.
 */
export async function persistirCambios(datos: Datos, prev: ClientesState, next: ClientesState): Promise<void> {
  const previos = new Map(prev.clientes.map((c) => [c.id, c]))
  for (const c of next.clientes) {
    const p = previos.get(c.id)
    // Sin los campos en la base se perderían sin aviso: se comprueba antes y, si faltan, no se guarda nada.
    if (c.primerNombre && (!p || !iguales(aDatos(p), aDatos(c)))) await datos.rpc('clientes_con_nombre', { p: aDatos(c), p_obligatorio: true })
    if (!p) {
      await datos.rpc('clientes_crear', { p_id: c.id, p_datos: aDatos(c), p_asesor: c.asesorId })
      continue
    }
    if (p === c) continue
    let v = p.version ?? 1

    if (!iguales(aDatos(p), aDatos(c))) v = await datos.rpc<number>('clientes_editar', { p_id: c.id, p_version: v, p_datos: aDatos(c) })

    const conocidas = new Set(p.actividades.map((a) => a.id))
    const nuevas = c.actividades.filter((a) => !conocidas.has(a.id))
    if (p.asesorId !== c.asesorId) {
      const reasignacion = nuevas.find((a) => a.motivo)
      v = await datos.rpc<number>('clientes_asignar', { p_id: c.id, p_version: v, p_asesor: c.asesorId, p_motivo: reasignacion?.motivo ?? '', p_mantener_acceso: !!reasignacion?.mantenerAcceso })
    }
    for (const a of [...nuevas].reverse()) {
      if (a.automatica) continue
      await datos.rpc('clientes_registrar_actividad', {
        p_id: a.id, p_client: c.id, p_tipo: a.tipo, p_fecha: a.fecha, p_descripcion: a.descripcion, p_referencia: a.referencia ?? null,
      })
    }
    const cambiaEtapa = p.etapa !== c.etapa && p.etapa !== 'reserva' && c.etapa !== 'reserva'
    if (cambiaEtapa) {
      v = await datos.rpc<number>('clientes_mover_etapa', {
        p_id: c.id, p_version: v, p_etapa: c.etapa, p_motivo: c.etapa === 'perdido' ? c.motivoPerdida : null, p_fecha_retomar: c.etapa === 'seguimiento' ? c.fechaRetomar : null,
      })
    }
    // Perdido y Seguimiento futuro ya ajustan la próxima actividad en el servidor.
    const proximaLaFijaEtapa = cambiaEtapa && (c.etapa === 'perdido' || c.etapa === 'seguimiento')
    if (!proximaLaFijaEtapa && !iguales(p.proxima, c.proxima)) {
      await datos.rpc('clientes_programar_proxima', {
        p_id: c.id, p_version: v, p_tipo: c.proxima?.tipo ?? null, p_descripcion: c.proxima?.descripcion ?? null, p_fecha: c.proxima?.fecha ?? null,
      })
    }
  }
}

/* ------------------------------------------------------------ negociaciones */

export const abrirOportunidad = (d: Datos, clienteId: string, destino: { unidad?: string; tipologia?: string }) =>
  d.rpc<string>('oportunidades_crear', { p_client: clienteId, p_unidad: destino.unidad ?? null, p_tipologia: destino.tipologia ?? null })
export const vincularUnidad = (d: Datos, id: string, unidad: string) => d.rpc('oportunidades_vincular_unidad', { p_id: id, p_unidad: unidad })
export const transferirOportunidad = (d: Datos, id: string, responsable: string, motivo: string) =>
  d.rpc('oportunidades_transferir', { p_id: id, p_responsable: responsable, p_motivo: motivo })
export const cerrarOportunidad = (d: Datos, id: string, motivo: string) => d.rpc('oportunidades_cerrar', { p_id: id, p_motivo: motivo })
export const revocarAcceso = (d: Datos, clienteId: string, usuario: string, motivo: string) => d.rpc('clientes_revocar_acceso', { p_client: clienteId, p_usuario: usuario, p_motivo: motivo })
export const definirImportacion = (d: Datos, habilitada: boolean, motivo: string) => d.rpc('clientes_importacion_definir', { p_habilitada: habilitada, p_motivo: motivo })

/* ---------------------------------------- importación desde el navegador */

export type EstadoImportacion = 'nuevo' | 'ya_importado' | 'importado' | 'duplicado' | 'error'

export interface ResultadoImportacion {
  origen_id: string
  estado: EstadoImportacion
  detalle: string
  client_id: string | null
  actividades?: number
}

const aFilaImportacion = (c: Cliente) => ({
  origen_id: c.id, ...aDatos(c), asesor_id: c.asesorId, etapa: c.etapa, motivo_perdida: c.motivoPerdida, fecha_retomar: c.fechaRetomar,
  proxima_tipo: c.proxima?.tipo ?? null, proxima_descripcion: c.proxima?.descripcion ?? null, proxima_fecha: c.proxima?.fecha ?? null, creado_en: c.creadoEn,
  actividades: [...c.actividades].reverse().map((a) => ({ tipo: a.tipo, fecha: a.fecha, descripcion: a.descripcion, usuario: a.usuario, referencia: a.referencia ?? null })),
})

export const revisarImportacion = (d: Datos, clientes: Cliente[]) =>
  d.rpc<ResultadoImportacion[]>('clientes_importar_revisar', { p_filas: clientes.map(aFilaImportacion) })

export const importarClientes = (d: Datos, clientes: Cliente[]) =>
  d.rpc<ResultadoImportacion[]>('clientes_importar', { p_filas: clientes.map(aFilaImportacion) })

/** Comprueba en la base que cada cliente quedó guardado con todo su historial. Devuelve los nombres que no se pudieron comprobar. */
export async function verificarImportacion(d: Datos, clientes: Cliente[]): Promise<string[]> {
  const r = await revisarImportacion(d, clientes)
  const porId = new Map(r.map((x) => [x.origen_id, x]))
  return clientes.filter((c) => {
    const x = porId.get(c.id)
    return !(x?.estado === 'ya_importado' && (x.actividades ?? 0) >= c.actividades.length)
  }).map((c) => c.nombre)
}
