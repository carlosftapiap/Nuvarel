import { aplicarPagos, diasEntre, estadoCuota, type Situacion } from '../../../supabase/functions/_shared/cobranza'

/**
 * Tablero de cobranza de la entrada del 20% (cuentas por cobrar de Nuvarel).
 * El saldo contra entrega (80%) se muestra aparte como desembolso bancario esperado: no es cartera de Nuvarel.
 * Por vencer, vence hoy y vencido son partes del saldo por cobrar, no deudas adicionales.
 */

export interface ContratoFila { id: string; codigo: string; clientId: string; cliente: string; unidad: string; edificio: number; responsable: string; estado: 'borrador' | 'firmado' | 'anulado'; precio: number }
export interface CuotaFila { contratoId: string; numero: number; concepto: string; vencimiento: string | null; vencimientoOriginal: string | null; monto: number }
export interface PagoFila { id: string; contratoId: string; monto: number; fecha: string; referencia: string; estado: 'registrado' | 'verificado' | 'rechazado' | 'anulado'; registradoPor: string; registradoEn: string; comprobante: string | null; motivo: string | null }

/** Autorización de Finanzas para aplicar excedente al saldo contra entrega. Las anuladas se conservan como historial. */
export interface AplicacionFila {
  id: string; contratoId: string; monto: number; motivo: string; soporteRuta: string; soporteNombre: string | null
  autorizadoPor: string; autorizadoEn: string; anuladoPor: string | null; anuladoEn: string | null; motivoAnulacion: string | null
}

export interface CuotaCalculada extends CuotaFila {
  esEntrada: boolean
  pagado: number
  saldo: number
  situacion: Situacion
  parcial: boolean
  atrasoDias: number
}

export const TRAMOS_MORA = [
  { id: '1-7', min: 1, max: 7, label: '1–7 días' },
  { id: '8-15', min: 8, max: 15, label: '8–15 días' },
  { id: '16-30', min: 16, max: 30, label: '16–30 días' },
  { id: '31-60', min: 31, max: 60, label: '31–60 días' },
  { id: '60+', min: 61, max: Infinity, label: 'Más de 60 días' },
] as const

export interface ResumenContrato {
  contrato: ContratoFila
  cuotas: CuotaCalculada[]
  pactadoEntrada: number
  cobradoEntrada: number
  saldoEntrada: number
  vencido: number
  porVencer: number
  venceHoy: number
  diasAtraso: number
  proxima: CuotaCalculada | null
  saldoEntrega: number
  /** Excedente sobre la entrada que todavía no se aplica al saldo contra entrega. */
  saldoAFavor: number
  /** Lo aplicado al saldo contra entrega con autorización de Finanzas. */
  aplicadoEntrega: number
  /** Todas las autorizaciones del contrato, también las anuladas. */
  aplicaciones: AplicacionFila[]
  comprobantesPendientes: number
}

const cent = (n: number) => Math.round(n * 100) / 100

/** Cuotas con su estado. La entrega (sin fecha) es el 80% bancario y no se cuenta como entrada. */
export function calcularContrato(c: ContratoFila, cuotas: CuotaFila[], pagos: PagoFila[], hoy: string, aplicaciones: AplicacionFila[] = []): ResumenContrato {
  const propias = cuotas.filter((x) => x.contratoId === c.id).sort((a, b) => a.numero - b.numero)
  const verificado = pagos.filter((p) => p.contratoId === c.id && p.estado === 'verificado').reduce((t, p) => t + p.monto, 0)
  const suyas = aplicaciones.filter((a) => a.contratoId === c.id)
  const autorizado = suyas.filter((a) => !a.anuladoEn).reduce((t, a) => t + a.monto, 0)
  const { pagado, excedente } = aplicarPagos(propias, verificado, autorizado)
  const calc: CuotaCalculada[] = propias.map((q) => {
    const e = estadoCuota({ monto: q.monto, pagado: pagado.get(q.numero) ?? 0, vencimiento: q.vencimiento }, hoy)
    return { ...q, esEntrada: q.vencimiento !== null, pagado: pagado.get(q.numero) ?? 0, saldo: e.saldo, situacion: e.situacion, parcial: e.parcial, atrasoDias: e.atrasoDias }
  })
  const entrada = calc.filter((q) => q.esEntrada)
  const exigible = c.estado === 'firmado'
  const suma = (xs: CuotaCalculada[], f: (q: CuotaCalculada) => number) => cent(xs.reduce((t, q) => t + f(q), 0))
  const pendientes = entrada.filter((q) => q.saldo > 0)
  return {
    contrato: c,
    cuotas: calc,
    pactadoEntrada: suma(entrada, (q) => q.monto),
    cobradoEntrada: suma(entrada, (q) => q.pagado),
    saldoEntrada: suma(entrada, (q) => q.saldo),
    vencido: exigible ? suma(entrada.filter((q) => q.situacion === 'vencida'), (q) => q.saldo) : 0,
    porVencer: exigible ? suma(entrada.filter((q) => q.situacion === 'por_vencer'), (q) => q.saldo) : 0,
    venceHoy: exigible ? suma(entrada.filter((q) => q.situacion === 'vence_hoy'), (q) => q.saldo) : 0,
    diasAtraso: exigible ? Math.max(0, ...entrada.map((q) => (q.situacion === 'vencida' ? q.atrasoDias : 0))) : 0,
    proxima: pendientes.sort((a, b) => (a.vencimiento! < b.vencimiento! ? -1 : 1))[0] ?? null,
    saldoEntrega: suma(calc.filter((q) => !q.esEntrada), (q) => q.saldo),
    saldoAFavor: cent(excedente),
    aplicadoEntrega: suma(calc.filter((q) => !q.esEntrada), (q) => q.pagado),
    aplicaciones: suyas,
    comprobantesPendientes: pagos.filter((p) => p.contratoId === c.id && p.estado === 'registrado').length,
  }
}

export interface Tablero {
  pactado: number
  cobrado: number
  saldo: number
  porVencer: number
  venceHoy: number
  vencido: number
  mora: Record<(typeof TRAMOS_MORA)[number]['id'], number>
  desembolsoEsperado: number
  reservasPreFirma: number
  contratosPreFirma: number
  comprobantesPendientes: number
  contratos: ResumenContrato[]
}

/** Totales de la cartera exigible (contratos firmados). Antes de firmar solo se informa el dinero recibido. */
export function calcularTablero(contratos: ContratoFila[], cuotas: CuotaFila[], pagos: PagoFila[], hoy: string, aplicaciones: AplicacionFila[] = []): Tablero {
  const res = contratos.filter((c) => c.estado !== 'anulado').map((c) => calcularContrato(c, cuotas, pagos, hoy, aplicaciones))
  const firmados = res.filter((r) => r.contrato.estado === 'firmado')
  const previos = res.filter((r) => r.contrato.estado === 'borrador')
  const mora = Object.fromEntries(TRAMOS_MORA.map((t) => [t.id, 0])) as Tablero['mora']
  for (const r of firmados) {
    for (const q of r.cuotas) {
      if (!q.esEntrada || q.situacion !== 'vencida') continue
      const t = TRAMOS_MORA.find((x) => q.atrasoDias >= x.min && q.atrasoDias <= x.max)!
      mora[t.id] = cent(mora[t.id] + q.saldo)
    }
  }
  const suma = (xs: ResumenContrato[], f: (r: ResumenContrato) => number) => cent(xs.reduce((t, r) => t + f(r), 0))
  return {
    pactado: suma(firmados, (r) => r.pactadoEntrada),
    cobrado: suma(firmados, (r) => r.cobradoEntrada),
    saldo: suma(firmados, (r) => r.saldoEntrada),
    porVencer: suma(firmados, (r) => r.porVencer),
    venceHoy: suma(firmados, (r) => r.venceHoy),
    vencido: suma(firmados, (r) => r.vencido),
    mora,
    desembolsoEsperado: suma(firmados, (r) => r.saldoEntrega),
    reservasPreFirma: suma(previos, (r) => r.cobradoEntrada),
    contratosPreFirma: previos.length,
    comprobantesPendientes: res.reduce((t, r) => t + r.comprobantesPendientes, 0),
    contratos: res,
  }
}

/** Una fila por cuota de la entrada. El 80 % bancario no aparece: no es cartera de Nuvarel. */
export interface FilaCuota { r: ResumenContrato; q: CuotaCalculada }
export type FiltroCuotas = 'pendientes' | 'vencidas' | 'proximas' | 'pagadas' | 'todas'

export const esProxima = (q: Pick<CuotaCalculada, 'situacion'>) => q.situacion === 'vence_hoy' || q.situacion === 'por_vencer'

export function filasCuotas(contratos: ResumenContrato[], filtro: FiltroCuotas): FilaCuota[] {
  const orden = (a: FilaCuota, b: FilaCuota) => (a.q.vencimiento ?? '').localeCompare(b.q.vencimiento ?? '') || a.r.contrato.cliente.localeCompare(b.r.contrato.cliente) || a.q.numero - b.q.numero
  return contratos
    // Un contrato en borrador aún no es exigible: solo se ve al pedir todas.
    .filter((r) => filtro === 'todas' || r.contrato.estado === 'firmado')
    .flatMap((r) => r.cuotas.filter((q) => q.esEntrada).map((q) => ({ r, q })))
    .filter(({ q }) => filtro === 'todas' || (filtro === 'pagadas' ? q.situacion === 'pagada' : filtro === 'vencidas' ? q.situacion === 'vencida' : filtro === 'proximas' ? esProxima(q) : q.saldo > 0))
    .sort(orden)
}

/** Cómo se repartiría un pago: en orden, igual que la base al confirmarlo. No guarda nada. */
export function aplicacionPago(r: ResumenContrato, monto: number) {
  let resto = cent(monto)
  const cuotas: CuotaCalculada[] = []
  let parcial = 0
  for (const q of r.cuotas.filter((x) => x.esEntrada && x.saldo > 0)) {
    if (resto <= 0) break
    cuotas.push(q)
    if (resto < q.saldo) parcial = cent(q.saldo - resto)
    resto = cent(resto - q.saldo)
  }
  return { cuotas, parcial, excedente: Math.max(0, resto) }
}

export const SITUACION: Record<Situacion, { label: string; tono: string }> = {
  pagada: { label: 'Pagada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  pendiente: { label: 'Pendiente', tono: 'bg-slate-50 text-slate-700 ring-slate-200' },
  por_vencer: { label: 'Por vencer', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  vence_hoy: { label: 'Vence hoy', tono: 'bg-orange-50 text-orange-800 ring-orange-200' },
  vencida: { label: 'Vencida', tono: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export { diasEntre }
