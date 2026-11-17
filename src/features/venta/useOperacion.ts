import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { almacenPagos, cargarRecibos, type DatosPago, type Recibo } from '@/features/cobranza/comprobantes'
import { useClientes } from '@/features/clientes/store'
import { useRefresco } from '@/features/conexion/refresco'
import { validarCotizacion } from '@/features/cotizaciones/cotizacion'
import { descargarCotizacionPdf } from '@/features/cotizaciones/pdf'
import { useCotizaciones } from '@/features/cotizaciones/store'
import { aFilas, leerFilas } from '@/features/financiamiento/components/CuotasExtraordinarias'
import { calcularCondiciones, calculoDePlan, leerReserva, versionDelPlan, type CondicionesFinanciamiento } from '@/features/financiamiento/condiciones'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { fmtUsd2, leerMonto } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { useReservaFlujo } from '@/features/reservas/flujo'
import { acreditacion, operacionesAbiertas, siguientePaso, type EstadoContrato, type EstadoCumplimiento } from './operacion'
import { borradorVacio, type Borrador } from './borrador'
import { identificacionCompleta } from '@/features/clientes/categoria'
import { resolverUnidad } from '@/features/inventario/nomenclatura'

/**
 * Estado de una operación comercial: cotización, solicitud de reserva, pagos y contrato.
 * Atender cliente elige cliente y departamento; Financiamiento configura el plan y ejecuta la operación.
 * Ambas pantallas usan este mismo estado, así que nada se vuelve a escribir.
 */
export function useOperacion(b: Borrador, setB: (f: (x: Borrador) => Borrador) => void, puedeDescontar: boolean) {
  const { actor, can } = useSession()
  const conexion = useConexion()
  const { cuenta, datos } = conexion
  const { state: inv } = useInventory()
  const { state: cs, recargar: recargarClientes } = useClientes()
  const { lista, emitir, recargar: recargarCotizaciones, error: errorCarga, remoto } = useCotizaciones()
  const flujo = useReservaFlujo()
  const hoy = hoyGuayaquil()

  const [contratos, setContratos] = useState<{ id: string; reserva: string; estado: EstadoContrato }[]>([])
  // Última revisión de Cumplimiento por contrato y último comprobante rechazado por reserva: la guía dice qué falta y por qué.
  const [cumplimientos, setCumplimientos] = useState<Map<string, EstadoCumplimiento>>(new Map())
  const [rechazos, setRechazos] = useState<Map<string, { motivo: string; fecha: string | null }>>(new Map())
  const [receptorDefinido, setReceptorDefinido] = useState<boolean | null>(null)
  const [recibos, setRecibos] = useState<Recibo[]>([])
  const [ocupado, setOcupado] = useState(false)
  const enCurso = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [montoNuevo, setMontoNuevo] = useState<string | null>(null)
  const [pagoAbierto, setPagoAbierto] = useState(false)

  const verContratos = can('ventas.ver') || can('cobranzas.ver')
  const cargarAdicionales = useCallback(async () => {
    if (!datos) return
    const [filas, ajustes, revisiones, comprobantes] = await Promise.all([
      verContratos ? datos.select<{ id: string; reservation_id: string; estado: EstadoContrato }>('contracts').catch(() => []) : [],
      datos.select<{ receptor: string | null }>('payment_settings', { filtros: { id: 1 } }).catch(() => null),
      verContratos ? datos.select<{ contract_id: string; estado: EstadoCumplimiento }>('cumplimiento_revisiones', { orden: [{ columna: 'registrado_en' }] }).catch(() => []) : [],
      datos.select<{ reservation_id: string | null; estado: string; motivo_revision: string | null; revisado_en: string | null }>('comprobantes_pago', { orden: [{ columna: 'cargado_en' }] }).catch(() => []),
    ])
    setContratos(filas.map((f) => ({ id: String(f.id), reserva: String(f.reservation_id), estado: f.estado })))
    setCumplimientos(new Map(revisiones.map((r) => [String(r.contract_id), r.estado])))
    const ultimo = new Map<string, (typeof comprobantes)[number]>()
    for (const k of comprobantes) if (k.reservation_id) ultimo.set(String(k.reservation_id), k)
    setRechazos(new Map([...ultimo].filter(([, k]) => k.estado === 'rechazado').map(([id, k]) => [id, { motivo: k.motivo_revision ?? '', fecha: k.revisado_en }])))
    setReceptorDefinido(ajustes && ajustes[0] ? !!ajustes[0].receptor : null)
    setRecibos(await cargarRecibos(datos))
  }, [datos, verContratos])
  useRefresco(cargarAdicionales, !!datos)

  // Con cotización emitida, cliente, unidad y condiciones salen de ella: son las que quedaron en la base.
  const cotizacion = lista.find((c) => c.id === b.cotizacionId) ?? null
  const clienteId = cotizacion?.clienteId ?? b.clienteId
  const referencia = cotizacion?.unidad.codigo ?? b.codigo
  const codigo = resolverUnidad(inv.units, referencia)?.codigo ?? referencia
  const cliente = cs.clientes.find((c) => c.id === clienteId)
  const unit = inv.units.find((u) => u.codigo === codigo)
  const reservasCot = cotizacion ? flujo.res.reservas.filter((r) => r.cotizacionId === cotizacion.id) : []
  const reserva = reservasCot.find((r) => r.estado !== 'anulada') ?? reservasCot[0] ?? null
  const reservaActiva = reserva && reserva.estado !== 'anulada' ? reserva : null
  // La solicitud de otra operación llega con el inventario, aunque sea de un cliente fuera del alcance de este usuario.
  const otraReserva = unit?.solicitud && unit.solicitud.codigo !== reservaActiva?.codigo ? unit.solicitud
    : flujo.res.reservas.filter((r) => r.unidad === codigo && r.estado !== 'anulada' && r.id !== reservaActiva?.id).map((r) => ({ codigo: r.codigo, estado: r.estado as string, cotizacionId: r.cotizacionId as string | null }))[0] ?? null
  const recibo = reservaActiva ? recibos.find((r) => r.reservaId === reservaActiva.id) ?? null : null
  const contrato = reservaActiva ? contratos.find((c) => c.reserva === reservaActiva.id && c.estado !== 'anulado') ?? null : null

  const condiciones: CondicionesFinanciamiento = cotizacion
    ? { fecha: cotizacion.fecha, descuento: String(cotizacion.plan.descuentoPct), reserva: reservaActiva ? String(reservaActiva.montoReserva) : b.financiamiento.reserva, extras: aFilas(cotizacion.plan.extraordinarias), credito: b.financiamiento.credito,
        diaPago: cotizacion.plan.diaPago ?? 'ultimo', calendarioAceptado: !!cotizacion.plan.calendarioAceptado }
    : b.financiamiento
  // Una cotización emitida muestra el plan que guardó la base, no uno recalculado.
  const montoActivo = reservaActiva?.montoReserva ?? leerReserva(b.financiamiento.reserva)
  const calc = useMemo(
    () => (cotizacion ? calculoDePlan(cotizacion.plan, inv.params, montoActivo) : calcularCondiciones(unit, inv.params, b.financiamiento, puedeDescontar)),
    [unit, inv.params, cotizacion, b.financiamiento, puedeDescontar, montoActivo],
  )

  const bloqueada = !!cotizacion
  const bloqueoCalculo = calc.error ?? calc.errorExtras ?? calc.errorReserva
  const confirmadoVigente = !!b.planConfirmado && !!calc.version && b.planConfirmado.version === calc.version
  const precioCambio = !bloqueada && !!b.planConfirmado && !!calc.plan && b.planConfirmado.precioFinal !== calc.plan.precioFinal

  const firma = calc.plan ? acreditacion(calc.plan.reserva, reservaActiva?.montoReserva ?? (calc.errorReserva ? 0 : calc.reserva), reservaActiva?.montoRecibido ?? null) : null

  const erroresEmision: string[] = cliente
    ? validarCotizacion({ codigo, cliente: { nombre: cliente.nombre, email: cliente.email, telefono: cliente.telefono }, asesor: { nombre: actor.nombre, email: cuenta?.email ?? '', telefono: '—' }, fecha: hoy, observaciones: b.observaciones, descuentoPct: calc.descuentoPct, vigenciaDias: Number(b.vigencia), clienteId }, unit, actor)
    : ['Elige un cliente.']
  if (bloqueoCalculo) erroresEmision.push(bloqueoCalculo)
  if (!calc.plan && !bloqueoCalculo) erroresEmision.push('Elige un departamento.')
  if (!bloqueada && calc.plan && !confirmadoVigente) erroresEmision.push('Confirma el plan antes de emitir la cotización.')

  const cumplimiento = contrato ? cumplimientos.get(contrato.id) ?? null : null
  const rechazoPago = reservaActiva?.estado === 'solicitada' && !reservaActiva.comprobante ? rechazos.get(reservaActiva.id) ?? null : null
  // Una reserva con el pago verificado que no se confirmó sola tiene una excepción: se muestra el motivo.
  const [excepciones, setExcepciones] = useState<string[]>([])
  const idExcepcion = reservaActiva?.estado === 'pago_verificado' ? reservaActiva.id : null
  useEffect(() => {
    if (!datos || !idExcepcion) { setExcepciones([]); return }
    void datos.rpc<string[] | null>('reservas_excepciones', { p_id: idExcepcion }).then((v) => setExcepciones(v ?? [])).catch(() => setExcepciones([]))
  }, [datos, idExcepcion])
  const paso = siguientePaso({ clienteId, codigo, estadoUnidad: unit?.estado, cotizacion, reserva, otraReserva, estadoContrato: contrato?.estado ?? null, receptorDefinido, hoy, planConfirmado: confirmadoVigente, cumplimiento, rechazoPago, excepciones, identificacionCompleta: cliente ? identificacionCompleta(cliente) : undefined })
  const firmadas = useMemo(() => new Set(contratos.filter((c) => c.estado === 'firmado').map((c) => c.reserva)), [contratos])
  const abiertas = useMemo(() => operacionesAbiertas(lista, flujo.res.reservas, firmadas, hoy), [lista, flujo.res.reservas, firmadas, hoy])

  /** Una sola operación a la vez: pulsar dos veces no duplica la cotización ni la solicitud. */
  const ejecutar = async (fn: () => Promise<void>) => {
    if (enCurso.current) return
    enCurso.current = true
    setError(null); setAviso(null); setOcupado(true)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { enCurso.current = false; setOcupado(false) }
  }

  const confirmarPlan = () => {
    if (!calc.plan || !calc.version || bloqueoCalculo) return
    const confirmado = { version: calc.version, precioFinal: calc.plan.precioFinal }
    setB((x) => ({ ...x, planConfirmado: confirmado }))
    setAviso('Plan confirmado. Ya puedes emitir la cotización.')
  }
  const editarPlan = () => { setAviso(null); setB((x) => ({ ...x, planConfirmado: null })) }

  const emitirYDescargar = () => ejecutar(async () => {
    if (!confirmadoVigente) throw new Error('Confirma el plan antes de emitir la cotización.')
    if (!b.financiamiento.calendarioAceptado) throw new Error('El comprador debe aceptar expresamente el calendario de pagos antes de emitir la cotización.')
    const c = await emitir({ clienteId, codigo, descuentoPct: calc.descuentoPct, vigenciaDias: Number(b.vigencia), observaciones: b.observaciones, extraordinarias: leerFilas(b.financiamiento.extras),
      fechaFirma: b.financiamiento.fecha, diaPago: b.financiamiento.diaPago ?? 'ultimo', calendarioAceptado: b.financiamiento.calendarioAceptado })
    setB((x) => ({ ...x, cotizacionId: c.id }))
    await recargarClientes()
    const misma = versionDelPlan(c.plan) === b.planConfirmado?.version
    try {
      await descargarCotizacionPdf(c)
      setAviso(`Cotización ${c.numero} emitida y descargada. Plan ${versionDelPlan(c.plan)}.`)
    } catch (e) {
      setAviso(`Cotización ${c.numero} emitida. El PDF no se descargó: usa «Descargar cotización».`)
      setError((e as Error).message)
    }
    if (!misma) setError(`La base calculó un plan distinto del confirmado (${versionDelPlan(c.plan)}). Revísalo antes de continuar.`)
  })

  const solicitar = () => ejecutar(async () => {
    if (calc.errorReserva) throw new Error(calc.errorReserva)
    await flujo.solicitar(cotizacion!, calc.reserva)
    await recargarCotizaciones()
    setAviso(`Reserva solicitada por ${fmtUsd2(calc.reserva)}. No se registró ningún pago y la unidad no cambió.`)
  })
  const guardarMonto = () => ejecutar(async () => {
    await flujo.fijarMonto(reservaActiva!.id, leerMonto(montoNuevo!)!)
    setMontoNuevo(null)
    setAviso('Monto acordado actualizado.')
  })
  const registrarPago = (pago: DatosPago) => ejecutar(async () => {
    await flujo.registrarPago(reservaActiva!, pago)
    setAviso('Pago registrado. Finanzas verificará el ingreso.')
  })

  const retomar = (id: string) => {
    setError(null); setAviso(null); setMontoNuevo(null)
    setB((x) => ({ ...borradorVacio(x.financiamiento.fecha), cotizacionId: id }))
  }
  // Vuelve al borrador con las mismas condiciones, listas para una versión nueva.
  const cambiarCondiciones = () => {
    if (!cotizacion) return
    setError(null); setAviso(null)
    setB((x) => ({ ...x, clienteId, codigo, cotizacionId: '', vigencia: String(cotizacion.vigenciaDias), observaciones: cotizacion.observaciones, planConfirmado: null, financiamiento: condiciones }))
  }
  const nuevaOperacion = () => { setB(() => borradorVacio(hoy)); setError(null); setAviso(null); setMontoNuevo(null) }

  return {
    remoto, datos, almacen: almacenPagos(conexion), can, actor, inv, cs, lista, flujo, errorCarga,
    cotizacion, reserva: reservaActiva, otraReserva, recibo, contrato, paso, abiertas, firmadas, rechazoPago,
    clienteId, codigo, cliente, unit, bloqueada, calc, condiciones, firma, erroresEmision, bloqueoCalculo,
    confirmadoVigente, precioCambio, planConfirmado: b.planConfirmado,
    ocupado, error, setError, aviso, setAviso, montoNuevo, setMontoNuevo, pagoAbierto, setPagoAbierto,
    confirmarPlan, editarPlan, emitirYDescargar, solicitar, guardarMonto, registrarPago, retomar, cambiarCondiciones, nuevaOperacion,
    recargarClientes,
  }
}

export type Operacion = ReturnType<typeof useOperacion>
