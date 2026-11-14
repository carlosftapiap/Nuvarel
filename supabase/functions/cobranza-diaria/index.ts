// Supabase Edge Function · Cobranza diaria: calcula alertas, las guarda en la cola y envía las pendientes.
// Se ejecuta con un programador de Supabase (pg_cron + pg_net) a las 08:00 de Ecuador (13:00 UTC).
// Secretos solo en el entorno del servidor: SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY, COBRANZA_REMITENTE.
// Envío real desactivado mientras COBRANZA_ENVIO_REAL no sea "true". Sin proveedor, las alertas quedan pendientes de configuración.
// Modo prueba: con CORREO_PRUEBA_DESTINO, todo va a ese buzón (máximo CORREO_PRUEBA_MAXIMO por ejecución) y el original queda en la cola.
// Prueba de conexión: POST con {"prueba":"conexion"} envía un solo correo al buzón de pruebas, sin tocar la cola de cobranza.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import {
  completarEnlaces, configurarProveedor, enviarPendientes, planificarCobranza, type CompromisoEntrada, type ContratoEntrada, type CuotaEntrada, type FilaCola, type PagoEntrada,
} from '../_shared/cobranza.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const hoyEcuador = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  const secreto = Deno.env.get('CRON_SECRET')
  if (!secreto || req.headers.get('Authorization') !== `Bearer ${secreto}`) return json({ error: 'No autorizado' }, 401)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const app = Deno.env.get('APP_ORIGIN') ?? ''
  const hoy = hoyEcuador()
  const ahora = new Date().toISOString()
  const config = configurarProveedor(Deno.env.toJSON() as Record<string, string | undefined>)

  // Prueba controlada: un solo correo al buzón de pruebas, sin planificar ni enviar la cola. Solo en modo prueba.
  const cuerpo = await req.json().catch(() => ({})) as { prueba?: unknown }
  if (cuerpo.prueba === 'conexion') {
    if (!config.prueba || !config.proveedor) return json({ error: 'La prueba de conexión solo funciona con CORREO_PRUEBA_DESTINO configurado', motivo: config.motivo ?? null }, 409)
    const fila = { dedupe_key: `prueba:${ahora}`, tipo: 'prueba', destinatario: config.prueba.destino, asunto: '[AMURA] Prueba de conexión de correo', cuerpo: `<p>Prueba de envío desde AMURA el ${hoy}. Si recibes este correo, Resend y la función cobranza-diaria funcionan.</p>` }
    const ins = await admin.from('cobranza_alertas').insert(fila).select('id,estado,intentos,destinatario,asunto,cuerpo').single()
    if (ins.error) return json({ error: ins.error.message }, 500)
    const [a] = await enviarPendientes([ins.data as FilaCola], config.proveedor, ahora, config.remitente, config.prueba)
    await admin.from('cobranza_alertas').update({
      estado: a.estado, intentos: a.intentos, proveedor_id: a.proveedor_id ?? null, error: a.error ?? null, enviada_en: a.enviada_en ?? null,
      destinatario_efectivo: a.destinatario_efectivo ?? null, actualizada_en: ahora,
    }).eq('id', a.id)
    return json({ prueba: a.estado, destinatario: config.prueba.destino, remitente: config.remitente, proveedor_id: a.proveedor_id ?? null, error: a.error ?? null })
  }

  // 1. Datos reales de la base (contratos, cuotas, pagos, excedentes autorizados, compromisos y responsables).
  const [contratosQ, cuotasQ, pagosQ, compromisosQ, personasQ, opQ, clientesQ, aplicacionesQ] = await Promise.all([
    admin.from('contracts').select('id,codigo,client_id,codigo_unidad,precio,estado,opportunity_id'),
    admin.from('installments').select('contract_id,numero,concepto,vencimiento,monto'),
    admin.from('payments').select('id,contract_id,monto,estado,referencia,registrado_en'),
    admin.from('cobranza_compromisos').select('id,contract_id,numero_cuota,monto,fecha_compromiso,estado').eq('estado', 'pendiente'),
    admin.from('profiles').select('id,email,nombre,rol_id').eq('estado', 'activo'),
    admin.from('opportunities').select('id,responsable_id'),
    admin.from('clients').select('id,nombre'),
    admin.from('aplicaciones_excedente').select('contract_id,monto').is('anulado_en', null),
  ])
  for (const r of [contratosQ, cuotasQ, pagosQ, compromisosQ, personasQ, opQ, clientesQ, aplicacionesQ]) if (r.error) return json({ error: r.error.message }, 500)

  const personas = personasQ.data ?? []
  const correos = (roles: string[]) => personas.filter((p) => roles.includes(p.rol_id)).map((p) => p.email as string)
  const emailPorId = new Map(personas.map((p) => [p.id as string, { email: p.email as string, nombre: p.nombre as string }]))
  const responsablePorOp = new Map((opQ.data ?? []).map((o) => [o.id as string, o.responsable_id as string | null]))
  const clientePorId = new Map((clientesQ.data ?? []).map((c) => [c.id as string, c.nombre as string]))

  const contratos: ContratoEntrada[] = (contratosQ.data ?? []).map((c) => {
    const resp = responsablePorOp.get(c.opportunity_id as string) ?? null
    const datos = resp ? emailPorId.get(resp) : undefined
    return {
      id: c.id as string, codigo: c.codigo as string, cliente: clientePorId.get(c.client_id as string) ?? 'Cliente',
      unidad: c.codigo_unidad as string, precio: Number(c.precio), estado: c.estado as ContratoEntrada['estado'],
      responsableEmail: datos?.email ?? null, responsableNombre: datos?.nombre ?? null,
    }
  })
  const cuotas: CuotaEntrada[] = (cuotasQ.data ?? []).map((i) => ({
    contratoId: i.contract_id as string, numero: Number(i.numero), concepto: i.concepto as string,
    vencimiento: (i.vencimiento as string | null), monto: Number(i.monto),
  }))
  const pagos: PagoEntrada[] = (pagosQ.data ?? []).map((p) => ({
    id: p.id as string, contratoId: p.contract_id as string, monto: Number(p.monto), estado: p.estado as PagoEntrada['estado'],
    referencia: p.referencia as string, creadoEn: p.registrado_en as string,
  }))
  const compromisos: CompromisoEntrada[] = (compromisosQ.data ?? []).map((k) => ({
    id: k.id as string, contratoId: k.contract_id as string, numero: (k.numero_cuota as number | null), monto: Number(k.monto),
    fecha: k.fecha_compromiso as string, estado: k.estado as CompromisoEntrada['estado'],
  }))

  // 2. Planificar: cada alerta tiene una clave única, así que repetir la función no duplica nada.
  const plan = planificarCobranza({
    hoy, ahora, app, contratos, cuotas, pagos, compromisos,
    aplicaciones: (aplicacionesQ.data ?? []).map((a) => ({ contratoId: a.contract_id as string, monto: Number(a.monto) })),
    destinatarios: { finanzas: correos(['finanzas']), gerencia: correos(['gerencia']), administracion: correos(['administrador']) },
  })

  if (plan.alertas.length) {
    const { error } = await admin.from('cobranza_alertas').upsert(
      plan.alertas.map((a) => ({ dedupe_key: a.dedupeKey, contract_id: a.contratoId, numero_cuota: a.numero, tipo: a.tipo, destinatario: a.destinatario, asunto: a.asunto, cuerpo: a.cuerpo })),
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    if (error) return json({ error: error.message }, 500)
  }
  for (const prefijo of plan.cancelarPrefijos) {
    await admin.from('cobranza_alertas').update({ estado: 'cancelada', actualizada_en: ahora }).eq('estado', 'pendiente').like('dedupe_key', `${prefijo}%`)
  }
  if (plan.compromisosIncumplidos.length) {
    await admin.from('cobranza_compromisos').update({ estado: 'incumplido', cerrado_en: ahora }).in('id', plan.compromisosIncumplidos)
  }

  // 3. Recordatorios de lo que sigue esperando (reservas, expedientes, firmas): uno por registro y estado.
  const rec = await admin.rpc('notificaciones_recordatorios', { p_hoy: hoy })
  if (rec.error && !/notificaciones_recordatorios/.test(rec.error.message)) return json({ error: rec.error.message }, 500)

  // 4. Enviar lo pendiente (solo si el envío real está configurado; si no, queda "pendiente de configuración").
  const cola = await admin.from('cobranza_alertas').select('id,estado,intentos,destinatario,asunto,cuerpo').eq('estado', 'pendiente').limit(200)
  if (cola.error) return json({ error: cola.error.message }, 500)
  const actualizaciones = await enviarPendientes(
    (cola.data ?? []).map((f) => ({ id: f.id as string, estado: f.estado as string, intentos: Number(f.intentos), destinatario: f.destinatario as string, asunto: f.asunto as string, cuerpo: completarEnlaces(f.cuerpo as string, app) })),
    config.proveedor, ahora, config.remitente, config.prueba,
  )
  for (const a of actualizaciones) {
    await admin.from('cobranza_alertas').update({
      estado: a.estado, intentos: a.intentos, proveedor_id: a.proveedor_id ?? null, error: a.error ?? null,
      enviada_en: a.enviada_en ?? null, destinatario_efectivo: a.destinatario_efectivo ?? null, actualizada_en: ahora,
    }).eq('id', a.id)
  }

  return json({
    fecha: hoy,
    alertasPlanificadas: plan.alertas.length,
    cancelaciones: plan.cancelarPrefijos.length,
    compromisosIncumplidos: plan.compromisosIncumplidos.length,
    recordatorios: rec.error ? null : Number(rec.data ?? 0),
    enviadas: actualizaciones.filter((a) => a.estado === 'enviada').length,
    envioReal: config.proveedor !== null && !config.prueba,
    modoPrueba: config.prueba ? config.prueba.destino : null,
    motivoEnvio: config.motivo ?? null,
  })
})
