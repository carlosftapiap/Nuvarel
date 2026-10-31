import { dinero, decimal, fechaCorta, fechaLarga, montoALetras } from './letras'
import { ESTADOS_CIVILES, type CuotaDoc, type EstadoCivil, type InstantaneaDocumento, type PersonaDoc } from './model'

/**
 * Del snapshot que entrega el servidor al objeto que usa la plantilla: montos con formato, fechas legibles y montos en letras.
 * No cambia ningún valor: solo lo presenta. El snapshot original es lo que queda guardado como dato exacto del documento.
 */

const civil = (v: string) => (v && v in ESTADOS_CIVILES ? ESTADOS_CIVILES[v as EstadoCivil] : v || '')
const persona = (p: PersonaDoc) => ({ ...p, estado_civil: civil(p.estado_civil), porcentaje: p.porcentaje === null || p.porcentaje === undefined ? '' : decimal(p.porcentaje) })
const cuota = (c: CuotaDoc, i: number) => ({ numero: i + 1, concepto: c.concepto, vencimiento: fechaCorta(c.vencimiento), monto: dinero(c.monto) })
const letras = (v: number | null) => (v === null || v === undefined ? '' : montoALetras(v))

export function datosParaPlantilla(s: InstantaneaDocumento): Record<string, unknown> {
  const u = s.unidad
  const datos = {
    contrato: { codigo: s.contrato.codigo, fecha: fechaCorta(s.contrato.fecha), fecha_larga: fechaLarga(s.contrato.fecha) },
    vendedora: s.vendedora,
    comprador: persona(s.comprador),
    compradores: s.compradores.map(persona),
    compradores_adicionales: s.compradores_adicionales.map(persona),
    apoderados: s.apoderados.map((a) => ({ ...persona(a), poder_detalle: a.poder_detalle, representa_a: a.representa_a })),
    unidad: { ...u, area_m2: decimal(Number(u.area_m2)), bodega_m2: decimal(Number(u.bodega_m2)), patio_m2: decimal(Number(u.patio_m2)) },
    precio: { total: dinero(s.precio.total), total_letras: letras(s.precio.total), lista: dinero(s.precio.lista), descuento_pct: decimal(s.precio.descuento_pct) },
    pago: {
      reserva: dinero(s.pago.reserva), reserva_letras: letras(s.pago.reserva), firma: dinero(s.pago.firma), num_cuotas: String(s.pago.num_cuotas),
      cuota_mensual: dinero(s.pago.cuota_mensual), total_cuotas: dinero(s.pago.total_cuotas), saldo: dinero(s.pago.saldo), saldo_letras: letras(s.pago.saldo),
      cuotas: s.pago.cuotas.map(cuota), cronograma: s.pago.cronograma.map(cuota), extraordinarias: (s.pago.extraordinarias ?? []).map(cuota),
    },
    manual: s.manual,
  }
  // Los campos manuales también se usan directamente: {lugar_firma}.
  return { ...s.manual, ...datos }
}
