// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import {
  AVISO_CONSTANCIA, aComprobante, aRecibo, cargarUnidadDocumento, construirConstanciaPdf, construirReciboPdf, descargarConstancia, descargarConstanciaReserva,
} from '@/features/cobranza/comprobantes'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import { datosPglite } from './datos-pglite'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, gerente: string, finanzas: string, finanzas2: string, legal: string, vera: string, omar: string
let n = 990700000

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const hoy = () => hoyGuayaquil()
const adjunto = (pre: string, id: string) => JSON.stringify({ ruta: `${pre}/${id}/${++n}.pdf`, nombre: 'banco.pdf', mime: 'application/pdf', tamano: 10, hash: 'x' })

async function solicitud() {
  const { codigo } = await uno<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)
  const cli = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `PRUEBA ${codigo}`, documento: cedulaPrueba(++n), telefono: celularPrueba(++n), origen: 'instagram' }), vera])).id
  const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cli, codigo])).id
  const q = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  const r = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar_acordada($1, 600) as id`, [q])).id
  return { r, q, codigo }
}
const reportar = (u: string, r: string, medio?: string) => medio === undefined
  ? rpc<{ id: string }>(u, `select public.reservas_reportar_pago($1, 600, $2::date, 'Banco Pichincha', $3, $4::jsonb) as id`, [r, hoy(), `TRF-${++n}`, adjunto('reservas', r)])
  : rpc<{ id: string }>(u, `select public.reservas_reportar_pago($1, 600, $2::date, 'Banco Pichincha', $3, $4::jsonb, $5) as id`, [r, hoy(), `CHQ-${++n}`, adjunto('reservas', r), medio])
const confirmar = (u: string, r: string) => rpc<{ id: string | null }>(u, `select public.reservas_confirmar_pago($1, 600, $2::date, 'BAN-OK', true, '') as id`, [r, hoy()])
const comprobante = async (u: string, r: string) => {
  const [f] = await datosPglite(db, u).select<Record<string, unknown>>('comprobantes_pago', { filtros: { reservation_id: r } })
  return aComprobante(f)
}

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  gerente = await crearUsuario(db, 'Gerencia', 'gerencia')
  finanzas = await crearUsuario(db, 'Fina Finanzas', 'finanzas', { alcance: 'empresa' })
  finanzas2 = await crearUsuario(db, 'Otra Finanzas', 'finanzas', { alcance: 'empresa' })
  legal = await crearUsuario(db, 'Legal', 'legal', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera Vendedora', 'asesor')
  omar = await crearUsuario(db, 'Omar Vendedor', 'asesor')
  await db.query(`update public.inventory_units set estado = 'disponible' where edificio = 1`)
  await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`)
}, 60_000)

describe('número de constancia y medio de pago', () => {
  it('cada comprobante nuevo recibe un CP correlativo; la versión anterior de la función sigue funcionando como transferencia', async () => {
    const a = await solicitud()
    const b = await solicitud()
    await reportar(vera, a.r)
    await reportar(vera, b.r, 'cheque')
    const ca = await comprobante(vera, a.r)
    const cb = await comprobante(vera, b.r)
    const anio = hoy().slice(0, 4)
    expect(ca.constanciaNumero).toMatch(new RegExp(`^CP-${anio}-\\d{4}$`))
    expect(Number(cb.constanciaNumero!.slice(-4))).toBe(Number(ca.constanciaNumero!.slice(-4)) + 1)
    expect(ca.medio).toBe('transferencia')
    expect(cb.medio).toBe('cheque')
    // La constancia no confirma nada: sin recibo ni pago verificado.
    expect(await uno(`select estado, monto_recibido from public.reservations where id = $1`, [b.r])).toEqual({ estado: 'solicitada', monto_recibido: null })
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [b.r])).toEqual({ n: 0 })
  })

  it('rechaza un medio desconocido sin dejar registro', async () => {
    const { r } = await solicitud()
    await expect(reportar(vera, r, 'efectivo')).rejects.toThrow(/transferencia, depósito o cheque/)
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago where reservation_id = $1`, [r])).toEqual({ n: 0 })
    expect(await uno(`select comprobante from public.reservations where id = $1`, [r])).toEqual({ comprobante: null })
  })

  it('los permisos y el alcance de la función original se mantienen', async () => {
    const { r } = await solicitud()
    await expect(reportar(omar, r, 'deposito')).rejects.toThrow(/fuera de tu alcance/)
    await expect(rpc(legal, `select public.reservas_reportar_pago($1, 600, $2::date, 'Banco', 'TRF-L', $3::jsonb, 'deposito')`, [r, hoy(), adjunto('reservas', r)])).rejects.toThrow(/Sin permiso/)
  })

  it('el número no se puede fijar ni cambiar desde la app', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    const antes = (await comprobante(vera, r)).constanciaNumero
    await rpc(vera, `update public.comprobantes_pago set constancia_numero = 'CP-FALSO', medio = 'cheque' where reservation_id = $1`, [r]).catch(() => {})
    const c = await comprobante(vera, r)
    expect(c.constanciaNumero).toBe(antes)
    expect(c.medio).toBe('transferencia')
  })

  it('pagos de contrato: guarda el medio en el comprobante de ese pago', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    await confirmar(finanzas, r)
    await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
    const c = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoy()])).id
    const p = (await rpc<{ id: string }>(finanzas, `select public.cobranzas_reportar_pago($1, 100, $2::date, 'Banco Guayaquil', 'CHQ-77', $3::jsonb, 'cheque') as id`, [c, hoy(), adjunto('contratos', c)])).id
    expect(await uno(`select medio, constancia_numero like 'CP-%' as numerada, estado from public.comprobantes_pago where payment_id = $1`, [p])).toEqual({ medio: 'cheque', numerada: true, estado: 'reportado' })
  })
})

describe('documentos', () => {
  it('la constancia dice que no acredita dinero y muestra la unidad desde Inventario', async () => {
    const { r, codigo } = await solicitud()
    await reportar(vera, r, 'cheque')
    const c = await comprobante(vera, r)
    const unidad = await cargarUnidadDocumento(datosPglite(db, vera), codigo)
    expect(unidad).not.toBeNull()
    const texto = construirConstanciaPdf(c, {
      cliente: 'PRUEBA Cliente', documento: '1712345678', departamento: unidad!.dpt, codigoUnidad: codigo, concepto: 'Reserva R-1',
      emisor: 'NUVAREL S.A.S.', emisorRuc: null, emisorDireccion: null, registradoPor: 'Vera Vendedora',
    }, unidad).output()
    expect(texto).toContain('CONSTANCIA PROVISIONAL')
    expect(texto).toContain(c.constanciaNumero!)
    expect(texto).toContain(AVISO_CONSTANCIA.slice(0, 40))
    expect(texto).toContain('no acreditado')
    expect(texto).toContain('Banco girador')
    expect(texto).toContain('mero de cheque')
    expect(texto).toContain(`Edificio ${unidad!.edificio}`)
    expect(texto).toContain(unidad!.tipologia)
    expect(texto).not.toContain('RECHAZADO')
  })

  it('una constancia de un pago rechazado lo indica', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    await rpc(finanzas, `select public.reservas_rechazar_pago($1, 'No llegó al banco')`, [r])
    const c = await comprobante(finanzas, r)
    expect(c.estado).toBe('rechazado')
    const texto = construirConstanciaPdf(c, { cliente: 'X', documento: '', departamento: '1', codigoUnidad: '1', concepto: 'Reserva', emisor: 'NUVAREL S.A.S.', emisorRuc: null, emisorDireccion: null, registradoPor: 'Vera' }).output()
    expect(texto).toContain('COMPROBANTE RECHAZADO')
  })

  it('quien registró el pago la descarga con los datos de la base, sin guardar copias', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const archivos = (await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago`)).n
    await descargarConstanciaReserva(datosPglite(db, vera), r)
    await descargarConstancia(datosPglite(db, finanzas), await comprobante(finanzas, r))
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago`)).n).toBe(archivos)
  })

  it('un comprobante anterior a las constancias no la genera', async () => {
    await expect(descargarConstancia(datosPglite(db, finanzas), { ...(await comprobante(finanzas, (await (async () => { const { r } = await solicitud(); await reportar(vera, r); return r })()))), constanciaNumero: null }))
      .rejects.toThrow(/no tiene número/)
  })

  it('el recibo definitivo conserva su número y agrega edificio, piso y tipología', async () => {
    const { r, codigo } = await solicitud()
    await reportar(vera, r)
    const id = (await confirmar(finanzas2, r)).id
    const [fila] = await datosPglite(db, finanzas).select<Record<string, unknown>>('recibos_pago', { filtros: { id } })
    const unidad = await cargarUnidadDocumento(datosPglite(db, finanzas), codigo)
    const texto = construirReciboPdf(aRecibo(fila), null, unidad).output()
    expect(String(fila.numero)).toMatch(/^REC-/)
    expect(texto).toContain('RECIBO DE PAGO')
    expect(texto).toContain(`Edificio ${unidad!.edificio}`)
    expect(texto).toContain(unidad!.tipologia)
    // Sin unidad (p. ej. sin permiso de Inventario) sale como antes.
    expect(construirReciboPdf(aRecibo(fila)).output()).not.toContain('Edificio y piso')
  })
})
