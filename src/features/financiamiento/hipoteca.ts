/**
 * Simulador del crédito hipotecario del comprador (el 80% que no cobra Nuvarel).
 * Es una simulación referencial: no es una aprobación bancaria ni garantiza que la tasa siga vigente a la entrega.
 * Las tasas y condiciones vienen del catálogo (con fuente y fecha) o las ingresa el usuario como escenario manual.
 * Porcentajes en escala 0–100. Montos en USD con dos decimales.
 */

export type Amortizacion = 'francesa' | 'alemana'
export type TipoTasa = 'fija' | 'variable'

/** Regla de tasa por monto y plazo (p. ej. BIESS). Un límite vacío significa "sin límite". */
export interface Tramo {
  montoMin: number | null
  montoMax: number | null
  plazoMinMeses: number | null
  plazoMaxMeses: number | null
  tasaNominal: number
}

/** Producto del catálogo. Cada cambio crea una versión nueva; las simulaciones guardan la versión usada. */
export interface ProductoHipotecario {
  id: string
  clave: string
  version: number
  entidad: string
  producto: string
  tipoTasa: TipoTasa
  /** Tasa nominal anual cuando no hay tramos. */
  tasaNominal: number | null
  tramos: Tramo[]
  plazoMinMeses: number
  plazoMaxMeses: number
  /** Porcentaje máximo del valor del inmueble que financia la entidad (vacío = no informado). */
  financiamientoMaxPct: number | null
  montoMax: number | null
  /** Seguro de desgravamen: % mensual sobre el saldo. Vacío = no informado (no es gratuito). */
  desgravamenPctMensual: number | null
  /** Seguro de incendio: % anual sobre el valor del inmueble. Vacío = no informado. */
  incendioPctAnual: number | null
  gastosFijos: number | null
  avaluo: number | null
  fuente: string
  fechaFuente: string
}

export interface CondicionesManuales {
  tasa: number
  /** Indica si la tasa ingresada es nominal o efectiva anual. */
  tasaEs: 'nominal' | 'efectiva'
  tipoTasa: TipoTasa
  desgravamenPctMensual: number | null
  incendioPctAnual: number | null
  gastosFijos: number | null
  avaluo: number | null
}

export interface SimulacionInput {
  /** Valor del inmueble (precio final del departamento). */
  precio: number
  /** Entrada del 20% que se paga a Nuvarel. */
  entrada: number
  plazoMeses: number
  amortizacion: Amortizacion
  producto?: ProductoHipotecario | null
  manual?: CondicionesManuales | null
}

export interface FilaAmortizacion {
  n: number
  capital: number
  interes: number
  desgravamen: number | null
  incendio: number | null
  /** Capital + interés + seguros conocidos. */
  cuota: number
  saldo: number
}

export interface Simulacion {
  escenario: 'catalogo' | 'manual'
  entidad: string
  producto: string
  tipoTasa: TipoTasa
  tasaNominal: number
  tasaEfectiva: number
  plazoMeses: number
  amortizacion: Amortizacion
  /** Saldo del precio después de la entrada. */
  montoSolicitado: number
  /** Lo que la entidad financia según su porcentaje y monto máximo. */
  montoFinanciado: number
  /** Lo que el comprador debe cubrir con recursos propios si el crédito no alcanza. */
  aporteAdicional: number
  primeraCuota: number
  ultimaCuota: number
  totalCapital: number
  totalIntereses: number
  totalSeguros: number
  gastos: number
  avaluo: number
  costoTotal: number
  /** Conceptos sin dato: se muestran como pendientes, nunca como gratuitos. */
  faltantes: string[]
  fuente: string | null
  fechaFuente: string | null
  version: number | null
  /** Identificador de la versión del producto usada (null en escenario manual). */
  productoId: string | null
  tabla: FilaAmortizacion[]
}

const cent = (n: number) => Math.round(n * 100) / 100
const pct = (n: number) => Math.round(n * 10000) / 10000

/** Tasa efectiva anual a partir de la nominal anual capitalizable mensualmente (y viceversa). */
export const efectivaDesdeNominal = (nominal: number) => pct((Math.pow(1 + nominal / 1200, 12) - 1) * 100)
export const nominalDesdeEfectiva = (efectiva: number) => pct((Math.pow(1 + efectiva / 100, 1 / 12) - 1) * 1200)

const enRango = (v: number, min: number | null, max: number | null) => (min === null || v >= min) && (max === null || v <= max)

/** Tasa aplicable del producto según monto y plazo. Lanza error si ninguna regla aplica (no se inventa una tasa). */
export function tasaDelProducto(p: ProductoHipotecario, monto: number, plazoMeses: number): number {
  if (p.tramos.length) {
    const t = p.tramos.find((x) => enRango(monto, x.montoMin, x.montoMax) && enRango(plazoMeses, x.plazoMinMeses, x.plazoMaxMeses))
    if (!t) throw new Error(`${p.entidad} · ${p.producto}: no hay una tasa registrada para USD ${monto.toLocaleString('es-EC')} a ${plazoMeses} meses.`)
    return t.tasaNominal
  }
  if (p.tasaNominal === null) throw new Error(`${p.entidad} · ${p.producto}: el catálogo no tiene tasa registrada.`)
  return p.tasaNominal
}

export function simularHipoteca(s: SimulacionInput): Simulacion {
  if (!(s.precio > 0)) throw new Error('El precio debe ser mayor a cero.')
  if (!(s.entrada >= 0) || s.entrada >= s.precio) throw new Error('La entrada debe ser menor al precio.')
  if (!Number.isInteger(s.plazoMeses) || s.plazoMeses < 1 || s.plazoMeses > 600) throw new Error('El plazo debe estar entre 1 y 600 meses.')
  if (!s.producto && !s.manual) throw new Error('Elige un producto del catálogo o ingresa una tasa manual.')

  const montoSolicitado = cent(s.precio - s.entrada)
  const p = s.producto ?? null
  let montoFinanciado = montoSolicitado
  if (p?.financiamientoMaxPct != null) montoFinanciado = Math.min(montoFinanciado, cent((s.precio * p.financiamientoMaxPct) / 100))
  if (p?.montoMax != null) montoFinanciado = Math.min(montoFinanciado, p.montoMax)
  montoFinanciado = cent(montoFinanciado)
  const aporteAdicional = cent(montoSolicitado - montoFinanciado)

  let tasaNominal: number
  let tipoTasa: TipoTasa
  if (s.manual) {
    if (!(s.manual.tasa >= 0) || s.manual.tasa > 50) throw new Error('La tasa manual debe estar entre 0% y 50%.')
    tasaNominal = s.manual.tasaEs === 'nominal' ? s.manual.tasa : nominalDesdeEfectiva(s.manual.tasa)
    tipoTasa = s.manual.tipoTasa
  } else {
    if (s.plazoMeses < p!.plazoMinMeses || s.plazoMeses > p!.plazoMaxMeses) {
      throw new Error(`${p!.entidad} · ${p!.producto}: el plazo debe estar entre ${p!.plazoMinMeses} y ${p!.plazoMaxMeses} meses.`)
    }
    tasaNominal = tasaDelProducto(p!, montoFinanciado, s.plazoMeses)
    tipoTasa = p!.tipoTasa
  }

  const cond = s.manual ?? p!
  const desgravamenPct = cond.desgravamenPctMensual
  const incendioMensual = cond.incendioPctAnual == null ? null : cent((s.precio * cond.incendioPctAnual) / 100 / 12)
  const faltantes: string[] = []
  if (desgravamenPct == null) faltantes.push('Seguro de desgravamen')
  if (cond.incendioPctAnual == null) faltantes.push('Seguro de incendio')
  if (cond.gastosFijos == null) faltantes.push('Gastos legales y de trámite')
  if (cond.avaluo == null) faltantes.push('Avalúo')

  const i = tasaNominal / 1200
  const n = s.plazoMeses
  const P = montoFinanciado
  const cuotaFrancesa = i === 0 ? P / n : (P * i) / (1 - Math.pow(1 + i, -n))
  const tabla: FilaAmortizacion[] = []
  let saldo = P
  for (let k = 1; k <= n; k++) {
    const interes = cent(saldo * i)
    let capital = s.amortizacion === 'francesa' ? cent(cuotaFrancesa - interes) : cent(P / n)
    if (k === n) capital = cent(saldo) // La última cuota cierra el saldo exacto.
    const desgravamen = desgravamenPct == null ? null : cent((saldo * desgravamenPct) / 100)
    saldo = cent(saldo - capital)
    tabla.push({ n: k, capital, interes, desgravamen, incendio: incendioMensual, cuota: cent(capital + interes + (desgravamen ?? 0) + (incendioMensual ?? 0)), saldo })
  }

  const totalCapital = cent(tabla.reduce((t, r) => t + r.capital, 0))
  const totalIntereses = cent(tabla.reduce((t, r) => t + r.interes, 0))
  const totalSeguros = cent(tabla.reduce((t, r) => t + (r.desgravamen ?? 0) + (r.incendio ?? 0), 0))
  const gastos = cond.gastosFijos ?? 0
  const avaluo = cond.avaluo ?? 0
  return {
    escenario: s.manual ? 'manual' : 'catalogo',
    entidad: s.manual ? 'Escenario manual' : p!.entidad,
    producto: s.manual ? 'Tasa y plazo personalizados' : p!.producto,
    tipoTasa, tasaNominal: pct(tasaNominal), tasaEfectiva: efectivaDesdeNominal(tasaNominal), plazoMeses: n, amortizacion: s.amortizacion,
    montoSolicitado, montoFinanciado, aporteAdicional,
    primeraCuota: tabla[0].cuota, ultimaCuota: tabla[tabla.length - 1].cuota,
    totalCapital, totalIntereses, totalSeguros, gastos, avaluo,
    costoTotal: cent(totalCapital + totalIntereses + totalSeguros + gastos + avaluo),
    faltantes,
    fuente: s.manual ? null : p!.fuente, fechaFuente: s.manual ? null : p!.fechaFuente, version: s.manual ? null : p!.version, productoId: s.manual ? null : p!.id,
    tabla,
  }
}
