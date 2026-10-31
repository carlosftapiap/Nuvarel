// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PGlite } from '@electric-sql/pglite'
import { MemoryRouter } from 'react-router-dom'
import { ConexionProvider } from '@/app/auth'
import { SessionProvider } from '@/app/session'
import { AVISO_RECIBO, aRecibo, construirReciboPdf, reportarPagoReserva } from '@/features/cobranza/comprobantes'
import type { AlmacenContratos } from '@/features/contratos/almacen'
import { hoyGuayaquil } from '@/features/financiamiento/plan'
import type { Actor } from '@/features/inventario/types'
import { ClientesProvider } from '@/features/clientes/store'
import { InventoryProvider } from '@/features/inventario/store'
import { ReservasProvider } from '@/features/reservas/store'
import CobranzaPage from '@/pages/CobranzaPage'
import ReservasPage from '@/pages/ReservasPage'
import { datosPglite } from './datos-pglite'
import { como, crearDb, crearUsuario } from './db'

configure({ asyncUtilTimeout: 15_000 })

let db: PGlite
let admin: string, gerente: string, finanzas: string, finanzas2: string, legal: string, vera: string, omar: string
let n = 990600000

const archivos = new Map<string, Blob>()
const almacen: AlmacenContratos = {
  subir: async (_b, ruta, archivo) => { archivos.set(ruta, archivo) },
  descargar: async (_b, ruta) => {
    if (!archivos.has(ruta)) throw new Error('Sin archivo')
    return new ArrayBuffer(4)
  },
}

const uno = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const rpc = <T = unknown,>(u: string, sql: string, p: unknown[] = []) => como(db, u, async () => (await db.query<T>(sql, p)).rows[0])
const hoy = () => hoyGuayaquil()
const adjunto = (pre: string, id: string) => JSON.stringify({ ruta: `${pre}/${id}/${++n}.pdf`, nombre: 'banco.pdf', mime: 'application/pdf', tamano: 10, hash: 'x' })

/** Solicitud real de una unidad libre, para un cliente nuevo de Vera. */
async function solicitud(monto = 600) {
  const { codigo } = await uno<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)
  const cli = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Cliente ${codigo}`, documento: '1712345678', telefono: `0${++n}`, origen: 'instagram' }), vera])).id
  const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cli, codigo])).id
  const q = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op])).id
  const r = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar_acordada($1, $2) as id`, [q, monto])).id
  return { r, q, cli, codigo, op }
}
const reportar = (u: string, r: string, monto = 600, referencia = `TRF-${++n}`) =>
  rpc<{ id: string }>(u, `select public.reservas_reportar_pago($1, $2, $3::date, 'Banco Pichincha', $4, $5::jsonb) as id`, [r, monto, hoy(), referencia, adjunto('reservas', r)])
const confirmar = (u: string, r: string, monto = 600, verificado = true) =>
  rpc<{ id: string | null }>(u, `select public.reservas_confirmar_pago($1, $2, $3::date, 'BAN-OK', $4, '') as id`, [r, monto, hoy(), verificado])
const conteoRecibos = async () => (await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago`)).n

async function contratoFirmado(extras: unknown[] = []) {
  const { codigo } = await uno<{ codigo: string }>(`select codigo from public.inventory_units where estado = 'disponible' and codigo not in (select codigo_unidad from public.reservations where estado in ('solicitada', 'pago_verificado', 'confirmada')) order by codigo limit 1`)
  const cli = (await rpc<{ id: string }>(vera, `select public.clientes_crear(null, $1::jsonb, $2) as id`, [JSON.stringify({ nombre: `Comprador ${codigo}`, telefono: `0${++n}`, origen: 'instagram' }), vera])).id
  const op = (await rpc<{ id: string }>(vera, `select public.oportunidades_crear($1, $2, null) as id`, [cli, codigo])).id
  const q = (await rpc<{ id: string }>(vera, `select public.cotizaciones_emitir_extraordinarias($1, 0, 30, '', $2::jsonb) as id`, [op, JSON.stringify(extras)])).id
  const r = (await rpc<{ id: string }>(vera, `select public.reservas_solicitar_acordada($1, 600) as id`, [q])).id
  await reportar(vera, r)
  await confirmar(finanzas, r)
  await rpc(gerente, `select public.reservas_aprobar($1, 'Aprobada en comité')`, [r])
  const c = (await rpc<{ id: string }>(legal, `select public.contratos_crear($1, $2::date, 'Contrato de prueba') as id`, [r, hoy()])).id
  return { c, r }
}

async function abrir(id: string) {
  const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
  const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
  return render(
    <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen }}>
      <SessionProvider actorRemoto={actor}><MemoryRouter><CobranzaPage /></MemoryRouter></SessionProvider>
    </ConexionProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

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

describe('registrar', () => {
  it('guarda monto, fecha, banco, referencia y archivo por ruta, sin confirmar nada ni crear pagos', async () => {
    const { r } = await solicitud()
    const pagos = (await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n
    const ruta = `reservas/${r}/foto.jpg`
    await rpc(vera, `select public.reservas_reportar_pago($1, 650, $2::date, 'Produbanco', 'TRF-A1', $3::jsonb)`, [r, hoy(), JSON.stringify({ ruta, nombre: 'foto.jpg', mime: 'image/jpeg', tamano: 2048, hash: 'abc' })])
    expect(await uno(`select monto, banco, referencia, ruta, archivo_mime, estado, cargado_por = $2 as propio from public.comprobantes_pago where reservation_id = $1`, [r, vera])).toEqual({ monto: '650.00', banco: 'Produbanco', referencia: 'TRF-A1', ruta, archivo_mime: 'image/jpeg', estado: 'reportado', propio: true })
    expect(await uno(`select estado, comprobante, monto_recibido from public.reservations where id = $1`, [r])).toEqual({ estado: 'solicitada', comprobante: 'TRF-A1', monto_recibido: null })
    expect((await uno<{ n: number }>(`select count(*)::int as n from public.payments`)).n).toBe(pagos)
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [r])).toEqual({ n: 0 })
    // Un segundo registro no reemplaza el primero en silencio.
    await expect(reportar(vera, r)).rejects.toThrow(/ya tiene un pago registrado/)
  })

  it('valida banco, monto, tipo de archivo y que la ruta sea de esa operación', async () => {
    const { r } = await solicitud()
    const con = (monto: number, banco: string, archivo: unknown = null) => rpc(vera, `select public.reservas_reportar_pago($1, $2, $3::date, $4, 'TRF-B1', $5::jsonb)`, [r, monto, hoy(), banco, JSON.stringify(archivo)])
    await expect(con(0, 'Banco')).rejects.toThrow(/Monto/)
    await expect(con(100, '')).rejects.toThrow(/banco/)
    await expect(con(100, 'Banco')).rejects.toThrow(/comprobante bancario/)
    await expect(con(100, 'Banco', { ruta: `reservas/${r}/a.exe`, mime: 'application/x-msdownload', tamano: 10 })).rejects.toThrow(/foto|PDF/)
    await expect(con(100, 'Banco', { ruta: `reservas/${r}/a.pdf`, mime: 'application/pdf', tamano: 99999999 })).rejects.toThrow(/10 MB/)
    await expect(con(100, 'Banco', { ruta: 'reservas/otra/a.pdf', mime: 'application/pdf', tamano: 10 })).rejects.toThrow(/no corresponde/)
  })
})

describe('confirmar y rechazar', () => {
  it('exige la verificación bancaria; sin ella no cambia nada ni hay recibo', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    await expect(confirmar(finanzas, r, 600, false)).rejects.toThrow(/verificaste el ingreso/)
    expect(await uno(`select estado, monto_recibido from public.reservations where id = $1`, [r])).toEqual({ estado: 'solicitada', monto_recibido: null })
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [r])).toEqual({ n: 0 })
  })

  it('quien registra no confirma, y un vendedor no confirma ni rechaza', async () => {
    const { r } = await solicitud()
    await reportar(finanzas, r)
    await expect(confirmar(finanzas, r)).rejects.toThrow(/no puede confirmarlo/)
    await expect(rpc(finanzas, `select public.reservas_rechazar_pago($1, 'No coincide con el banco')`, [r])).rejects.toThrow(/no puede rechazarlo/)
    await expect(confirmar(vera, r)).rejects.toThrow(/Sin permiso/)
    await expect(rpc(vera, `select public.reservas_rechazar_pago($1, 'No coincide con el banco')`, [r])).rejects.toThrow(/Sin permiso/)
    await confirmar(finanzas2, r)
  })

  it('al confirmar emite un solo recibo numerado con sus datos; un segundo intento no duplica', async () => {
    const { r, codigo } = await solicitud()
    await reportar(vera, r)
    const id = (await confirmar(finanzas, r, 700)).id
    const v = await uno<Record<string, unknown>>(`select * from public.recibos_pago where id = $1`, [id])
    expect(v.comprobante_id).toBe((await uno<{ id: string }>(`select id from public.comprobantes_pago where reservation_id = $1`, [r])).id)
    expect(v).toMatchObject({ emisor: 'NUVAREL S.A.S.', emisor_ruc: '0993413661001', emisor_direccion: expect.stringContaining('Daule, Guayas, Ecuador'), cliente: `Cliente ${codigo}`, documento: '1712345678', codigo_unidad: codigo, monto: '700.00', referencia: 'BAN-OK', banco: 'Banco Pichincha', aprobado_nombre: 'Fina Finanzas', anulado_en: null })
    expect(String(v.numero)).toMatch(/^REC-\d{4}-\d{4}$/)
    expect(String(v.concepto)).toMatch(/^Reserva RES-/)
    expect(await uno(`select estado, monto_recibido from public.reservations where id = $1`, [r])).toEqual({ estado: 'pago_verificado', monto_recibido: '700.00' })
    const antes = await conteoRecibos()
    await expect(confirmar(finanzas, r, 700)).rejects.toThrow(/ya está/)
    expect(await conteoRecibos()).toBe(antes)
  })

  it('rechazar exige motivo, conserva el comprobante y la reserva vuelve a esperar el pago', async () => {
    const { r } = await solicitud()
    await reportar(vera, r, 600, 'TRF-RECH')
    await expect(rpc(finanzas, `select public.reservas_rechazar_pago($1, '')`, [r])).rejects.toThrow(/motivo/)
    await rpc(finanzas, `select public.reservas_rechazar_pago($1, 'No aparece en el banco')`, [r])
    expect(await uno(`select estado, comprobante from public.reservations where id = $1`, [r])).toEqual({ estado: 'solicitada', comprobante: null })
    expect(await uno(`select estado, motivo_revision, referencia from public.comprobantes_pago where reservation_id = $1`, [r])).toEqual({ estado: 'rechazado', motivo_revision: 'No aparece en el banco', referencia: 'TRF-RECH' })
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [r])).toEqual({ n: 0 })
    await reportar(vera, r, 600, 'TRF-OTRA')
    await confirmar(finanzas, r)
  })

  it('sin NUVAREL como receptor, no se confirma: el pago no queda sin recibo', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    await rpc(admin, `select public.config_definir_receptor('JARVAL', 'Cambio temporal de receptor')`)
    try {
      await expect(confirmar(finanzas, r)).rejects.toThrow(/receptor de pagos configurado es JARVAL/)
      expect(await uno(`select estado, monto_recibido from public.reservations where id = $1`, [r])).toEqual({ estado: 'solicitada', monto_recibido: null })
      expect(await uno(`select estado from public.comprobantes_pago where reservation_id = $1`, [r])).toEqual({ estado: 'reportado' })
    } finally {
      await rpc(admin, `select public.config_definir_receptor('NUVAREL', 'Vuelve el receptor acordado')`)
    }
  })

  it('quien registra no confirma aunque sea administrador, y las funciones antiguas quedan cerradas', async () => {
    const { r } = await solicitud()
    await rpc(admin, `select public.reservas_reportar_pago($1, 600, $2::date, 'Banco', 'TRF-ADM', $3::jsonb)`, [r, hoy(), adjunto('reservas', r)])
    await expect(confirmar(admin, r)).rejects.toThrow(/no puede confirmarlo/)
    for (const u of [admin, finanzas, vera]) {
      await expect(rpc(u, `select public.reservas_verificar_pago($1, 600, $2::date, 'X-1', 'Ingreso directo')`, [r, hoy()])).rejects.toThrow(/permission denied/)
      await expect(rpc(u, `select public.reservas_adjuntar_comprobante($1, 'X-1', null)`, [r])).rejects.toThrow(/permission denied/)
      await expect(rpc(u, `select public.cobranzas_verificar_pago($1, true, 'Ingreso directo')`, [r])).rejects.toThrow(/permission denied/)
      await expect(rpc(u, `select public.cobranzas_registrar_pago($1, 1, $2::date, 'X-1', null)`, [r, hoy()])).rejects.toThrow(/permission denied/)
    }
    await confirmar(finanzas, r)
  })

  it('un pago anterior sin archivo no se confirma: se rechaza y se registra de nuevo', async () => {
    const { r } = await solicitud()
    await db.query(`update public.reservations set comprobante = 'ANTIGUO', comprobante_subido_en = now() where id = $1`, [r])
    await expect(confirmar(finanzas, r)).rejects.toThrow(/Falta el comprobante bancario/)
    await rpc(finanzas, `select public.reservas_rechazar_pago($1, 'Falta el comprobante')`, [r])
    await reportar(vera, r)
    await confirmar(finanzas, r)
  })

  it('cuotas mensuales y extraordinarias siguen el mismo flujo, sin duplicar el ingreso', async () => {
    const { c, r } = await contratoFirmado([{ mes: 1, monto: 300 }])
    // El pago de la reserva pasó al contrato: no recibe un segundo recibo.
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago where reservation_id = $1`, [r])).toEqual({ n: 1 })
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.recibos_pago v join public.payments p on p.id = v.payment_id where p.contract_id = $1`, [c])).toEqual({ n: 0 })

    const firma = await uno<{ monto: string }>(`select monto from public.installments where contract_id = $1 and concepto like 'Pago a la firma%'`, [c])
    const cuota = await uno<{ monto: string }>(`select monto from public.installments where contract_id = $1 and concepto like 'Cuota 1 de%'`, [c])
    const monto = Number(firma.monto) + Number(cuota.monto) + 300
    const p = (await rpc<{ id: string }>(finanzas, `select public.cobranzas_reportar_pago($1, $2, $3::date, 'Guayaquil', 'TRF-CUO', $4::jsonb) as id`, [c, monto, hoy(), adjunto('contratos', c)])).id
    await expect(rpc(finanzas2, `select public.cobranzas_confirmar_pago($1, false, '')`, [p])).rejects.toThrow(/verificaste/)
    await expect(rpc(finanzas, `select public.cobranzas_confirmar_pago($1, true, '')`, [p])).rejects.toThrow(/no puede verificarlo/)
    const verificados = async () => Number((await uno<{ t: string }>(`select coalesce(sum(monto), 0) as t from public.payments where contract_id = $1 and estado = 'verificado'`, [c])).t)
    const antes = await verificados()
    const rec = (await rpc<{ id: string }>(finanzas2, `select public.cobranzas_confirmar_pago($1, true, '') as id`, [p])).id
    expect(await verificados()).toBeCloseTo(antes + monto)
    const v = await uno<{ concepto: string; banco: string; monto: string }>(`select concepto, banco, monto from public.recibos_pago where id = $1`, [rec])
    expect(v.concepto).toMatch(/Cuota 1 de 30/)
    expect(v.concepto).toMatch(/Cuota extraordinaria 1 de 1/)
    expect(v.banco).toBe('Guayaquil')
    await expect(rpc(finanzas2, `select public.cobranzas_confirmar_pago($1, true, '')`, [p])).rejects.toThrow(/no está pendiente/)

    // Anular un pago confirmado conserva el recibo, marcado como anulado.
    await rpc(finanzas2, `select public.cobranzas_anular_pago($1, 'Transferencia devuelta por el banco')`, [p])
    expect(await uno(`select motivo_anulacion from public.recibos_pago where id = $1`, [rec])).toEqual({ motivo_anulacion: 'Transferencia devuelta por el banco' })
  })
})

describe('protección de los documentos', () => {
  it('no se pueden borrar ni cambiar directamente; un vendedor sin alcance no los ve', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    const id = (await confirmar(finanzas, r)).id
    await rpc(finanzas, `delete from public.comprobantes_pago where reservation_id = $1`, [r]).catch(() => {})
    await rpc(finanzas, `update public.recibos_pago set monto = 1 where id = $1`, [id]).catch(() => {})
    await rpc(admin, `delete from public.recibos_pago where id = $1`, [id]).catch(() => {})
    expect(await uno(`select monto from public.recibos_pago where id = $1`, [id])).toEqual({ monto: '600.00' })
    expect(await uno<{ n: number }>(`select count(*)::int as n from public.comprobantes_pago where reservation_id = $1`, [r])).toEqual({ n: 1 })
    expect(await rpc<{ n: number }>(omar, `select count(*)::int as n from public.recibos_pago where id = $1`, [id])).toEqual({ n: 0 })
    expect(await rpc<{ n: number }>(vera, `select count(*)::int as n from public.recibos_pago where id = $1`, [id])).toEqual({ n: 1 })
    await expect(rpc(omar, `select public.pagos_historial($1, null)`, [r])).rejects.toThrow(/Sin acceso/)
    const h = (await rpc<{ h: { accion: string }[] }>(vera, `select public.pagos_historial($1, null) as h`, [r])).h.map((x) => x.accion)
    expect(h).toEqual(expect.arrayContaining(['Solicitar reserva', 'Registrar pago de reserva', 'Verificar ingreso de reserva', 'Emitir recibo']))
  })

  it('el PDF lleva el emisor, los datos y el aviso del SRI', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    const id = (await confirmar(finanzas, r)).id
    const [fila] = await datosPglite(db, finanzas).select<Record<string, unknown>>('recibos_pago', { filtros: { id } })
    const texto = construirReciboPdf(aRecibo(fila)).output()
    expect(texto).toContain('NUVAREL S.A.S.')
    expect(texto).toContain('RECIBO DE PAGO')
    expect(texto).toContain(String(fila.numero))
    expect(texto).toContain(AVISO_RECIBO.slice(0, 30))
    expect(texto).toContain('RUC 0993413661001')
  })
})

describe('reservas anuladas: devoluciones y retenciones', () => {
  const movimiento = (u: string, r: string, tipo: string, monto: number, archivo: string | null = adjunto('movimientos', r)) =>
    rpc<{ id: string }>(u, `select public.reservas_movimiento_registrar($1, $2, $3, $4::date, 'BAN-DEV', 'Acordado con el cliente', $5::jsonb) as id`, [r, tipo, monto, hoy(), archivo])
  async function anuladaConPago() {
    const { r } = await solicitud()
    await reportar(vera, r)
    await confirmar(finanzas, r, 1000)
    await db.query(`update public.reservations set estado = 'anulada', motivo_anulacion = 'Cliente desiste de la compra' where id = $1`, [r])
    return r
  }

  it('el pago se conserva; el movimiento exige soporte y autorización de otra persona, y no supera lo recibido', async () => {
    const r = await anuladaConPago()
    await expect(movimiento(finanzas, r, 'devolucion', 100, null)).rejects.toThrow(/comprobante bancario/)
    await expect(movimiento(vera, r, 'devolucion', 100)).rejects.toThrow(/Sin permiso/)
    await expect(movimiento(finanzas, r, 'devolucion', 1001)).rejects.toThrow(/superar lo recibido/)
    const d = (await movimiento(finanzas, r, 'devolucion', 700)).id
    await expect(movimiento(finanzas, r, 'retencion', 301)).rejects.toThrow(/superar lo recibido/)
    const t = (await movimiento(finanzas, r, 'retencion', 300)).id
    await expect(rpc(finanzas, `select public.reservas_movimiento_resolver($1, true, 'Autorizado por mí')`, [d])).rejects.toThrow(/Sin permiso/)
    await rpc(admin, `select public.reservas_movimiento_resolver($1, true, 'Autorizado por gerencia')`, [d])
    await rpc(gerente, `select public.reservas_movimiento_resolver($1, false, 'No corresponde retener')`, [t])
    await expect(rpc(gerente, `select public.reservas_movimiento_resolver($1, true, 'Otra vez')`, [d])).rejects.toThrow(/no está pendiente/)
    expect(await uno(`select monto_recibido, pago_monto, estado from public.reservations where id = $1`, [r])).toEqual({ monto_recibido: '1000.00', pago_monto: '1000.00', estado: 'anulada' })
    const v = await uno<{ anulado_en: string | null }>(`select anulado_en from public.recibos_pago where reservation_id = $1`, [r])
    expect(v.anulado_en).toBeNull()
  })

  it('solo aplica a reservas anuladas con pago confirmado', async () => {
    const { r } = await solicitud()
    await expect(movimiento(finanzas, r, 'devolucion', 100)).rejects.toThrow(/Solo aplica/)
  })
})

describe('Storage', () => {
  it('bucket privado; subir, leer, vincular y limpiar según la operación', async () => {
    const base = await crearDb()
    const a = await crearUsuario(base, 'Admin', 'administrador')
    const f = await crearUsuario(base, 'Finanzas', 'finanzas', { alcance: 'empresa' })
    const g = await crearUsuario(base, 'Gerencia', 'gerencia')
    const l = await crearUsuario(base, 'Legal', 'legal', { alcance: 'empresa' })
    const v = await crearUsuario(base, 'Vera', 'asesor')
    const o = await crearUsuario(base, 'Omar', 'asesor')
    await base.exec(`
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner_id text, created_at timestamptz default now());
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;`)
    const { readFileSync } = await import('node:fs')
    for (const m of ['20261031180000_comprobantes_recibos.sql', '20261031190000_cobranzas_controles.sql', '20261031200000_storage_comprobantes.sql']) await base.exec(readFileSync(`${process.cwd()}/supabase/migrations/${m}`, 'utf8'))
    expect((await base.query(`select public from storage.buckets where id = 'comprobantes-pagos'`)).rows).toEqual([{ public: false }])
    expect((await base.query<{ cmd: string }>(`select cmd from pg_policies where schemaname = 'storage' and policyname like 'comprobantes%' order by cmd`)).rows.map((x) => x.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT'])

    await como(base, a, () => base.query(`select public.config_definir_receptor('NUVAREL', 'Receptor acordado')`))
    await base.query(`update public.inventory_units set estado = 'disponible' where codigo = 'E1-PB-A2'`)
    const sql = async <T,>(u: string, q: string, p: unknown[] = []) => como(base, u, async () => (await base.query<T>(q, p)).rows)
    const cli = (await sql<{ id: string }>(v, `select public.clientes_crear(null, '{"nombre":"Ana Paz","telefono":"0991112233","origen":"instagram"}'::jsonb, $1) as id`, [v]))[0].id
    const op = (await sql<{ id: string }>(v, `select public.oportunidades_crear($1, 'E1-PB-A2', null) as id`, [cli]))[0].id
    const q = (await sql<{ id: string }>(v, `select public.cotizaciones_emitir($1, 0, 30, '') as id`, [op]))[0].id
    const r = (await sql<{ id: string }>(v, `select public.reservas_solicitar_acordada($1, 600) as id`, [q]))[0].id
    const subir = (u: string, name: string) => sql(u, `insert into storage.objects (bucket_id, name, owner_id) values ('comprobantes-pagos', $1, $2)`, [name, u])
    const existe = async (name: string) => (await base.query(`select 1 from storage.objects where name = $1`, [name])).rows.length === 1
    const ve = async (u: string, name: string) => (await sql(u, `select name from storage.objects where name = $1`, [name])).length === 1
    const ruta = `reservas/${r}/a.pdf`

    // 1. Subida por operación.
    await expect(subir(o, `reservas/${r}/ajeno.pdf`)).rejects.toThrow()
    await expect(subir(l, ruta)).rejects.toThrow()
    await expect(subir(v, `reservas/no-es-un-id/a.pdf`)).rejects.toThrow()
    await expect(subir(v, `otra-carpeta/${r}/a.pdf`)).rejects.toThrow()
    await expect(subir(v, `movimientos/${r}/a.pdf`)).rejects.toThrow()
    await expect(subir(f, 'recibos/REC-2026-0001-aaaaaaaaaaaa.pdf')).rejects.toThrow()
    await subir(v, ruta)
    await sql(v, `select public.reservas_reportar_pago($1, 600, (now() at time zone 'America/Guayaquil')::date, 'Banco', 'TRF-1', $2::jsonb)`, [r, JSON.stringify({ ruta, nombre: 'a.pdf', mime: 'application/pdf', tamano: 10 })])
    await expect(subir(v, `reservas/${r}/segundo.pdf`)).rejects.toThrow()
    expect(await ve(v, ruta)).toBe(true)
    expect(await ve(f, ruta)).toBe(true)
    expect(await ve(g, ruta)).toBe(true)
    expect(await ve(o, ruta)).toBe(false)
    expect(await ve(l, ruta)).toBe(false)

    // 2. Vínculo seguro del recibo.
    const id = (await sql<{ id: string }>(f, `select public.reservas_confirmar_pago($1, 600, (now() at time zone 'America/Guayaquil')::date, 'BAN-1', true, '') as id`, [r]))[0].id
    const { numero } = (await base.query<{ numero: string }>(`select numero from public.recibos_pago where id = $1`, [id])).rows[0]
    const hash = 'a'.repeat(64)
    const pdf = `recibos/${numero}-${hash.slice(0, 12)}.pdf`
    const registrar = (u: string, p: string, h = hash) => sql(u, `select public.recibos_registrar_pdf($1, $2, $3)`, [id, p, h])
    await expect(registrar(f, 'recibos/otro.pdf')).rejects.toThrow(/no corresponde/)
    await expect(registrar(f, pdf, 'corta')).rejects.toThrow(/Huella/)
    await expect(registrar(f, pdf)).rejects.toThrow(/no se cargó/)
    await expect(subir(v, pdf)).rejects.toThrow()
    await subir(a, pdf)
    await expect(registrar(f, pdf)).rejects.toThrow(/no se cargó con tu usuario/)
    const otroPdf = `recibos/${numero}-${'b'.repeat(12)}.pdf`
    await subir(f, otroPdf)
    await registrar(f, otroPdf, 'b'.repeat(64))
    await registrar(f, otroPdf, 'b'.repeat(64))
    await expect(registrar(f, pdf)).rejects.toThrow(/ya tiene su PDF/)
    await expect(subir(f, `recibos/${numero}-${'c'.repeat(12)}.pdf`)).rejects.toThrow()

    // 3. Limpieza: lo vinculado no se toca; lo demás, solo su dueño o, pasadas 24 horas, quien administra.
    const huerfanos = async () => (await sql<{ l: { ruta: string }[] }>(a, `select public.comprobantes_sin_vincular() as l`))[0].l.map((x) => x.ruta)
    await expect(sql(v, `select public.comprobantes_sin_vincular()`)).rejects.toThrow(/Sin permiso/)
    expect(await huerfanos()).toEqual([])
    await sql(a, `delete from storage.objects where name = $1`, [ruta])
    await sql(v, `delete from storage.objects where name = $1`, [ruta])
    expect(await existe(ruta)).toBe(true)
    await sql(a, `update storage.objects set name = 'cambiado' where name = $1`, [ruta]).catch(() => {})
    expect(await existe(ruta)).toBe(true)
    await expect(sql(a, `select public.comprobante_limpieza_registrar($1)`, [ruta])).rejects.toThrow(/vinculado/)

    await base.query(`update storage.objects set created_at = now() - interval '2 days' where name = $1`, [pdf])
    expect(await huerfanos()).toEqual([pdf])
    expect(await ve(a, pdf)).toBe(true)
    await sql(o, `delete from storage.objects where name = $1`, [pdf])
    expect(await existe(pdf)).toBe(true)
    await sql(a, `select public.comprobante_limpieza_registrar($1)`, [pdf])
    await sql(a, `delete from storage.objects where name = $1`, [pdf])
    expect(await existe(pdf)).toBe(false)
    expect((await base.query(`select count(*)::int as n from public.audit_log where accion = 'Quitar archivo sin vincular' and entidad_id = $1`, [pdf])).rows).toEqual([{ n: 1 }])
  }, 180_000)
})

describe('Cobranzas en pantalla', () => {
  it('si el servidor rechaza el registro, el archivo subido no queda huérfano', async () => {
    const { r } = await solicitud()
    await reportar(vera, r)
    const quitar = vi.fn(async () => {})
    const subir = vi.fn(async () => {})
    await expect(reportarPagoReserva(datosPglite(db, vera), { subir, descargar: async () => new ArrayBuffer(0), quitar }, r, { monto: 1, fecha: hoy(), banco: 'Banco', referencia: 'TRF-DOBLE', archivo: new File(['x'], 'a.pdf', { type: 'application/pdf' }) })).rejects.toThrow(/ya tiene un pago registrado/)
    expect(subir).toHaveBeenCalledTimes(1)
    expect(quitar).toHaveBeenCalledTimes(1)
  })

  it('el vendedor adjunta el comprobante; Finanzas lo ve, marca la verificación, confirma y el recibo queda guardado', async () => {
    const user = userEvent.setup()
    const { r, codigo } = await solicitud()
    const nombre = `Cliente ${codigo}`
    const s = await abrir(vera)
    await user.click(await screen.findByRole('tab', { name: /^Reservas/ }))
    await user.click(within((await screen.findByText(nombre)).closest('tr')!).getByRole('button', { name: /Registrar pago/ }))
    const dlg = await screen.findByRole('dialog', { name: /Registrar pago/ })
    await user.type(within(dlg).getByLabelText('Banco *'), 'Banco Pichincha')
    await user.type(within(dlg).getByLabelText(/Número de transferencia/), 'TRF-UI')
    const foto = new File(['imagen'], 'comprobante del pago.png', { type: 'image/png' })
    fireEvent.change(within(dlg).getByLabelText(/Foto o PDF/), { target: { files: [foto] } })
    await user.click(within(dlg).getByRole('button', { name: 'Registrar' }))
    await screen.findByText(/Pago de RES-.* registrado/)
    const e = await uno<{ ruta: string; monto: string }>(`select ruta, monto from public.comprobantes_pago where reservation_id = $1`, [r])
    expect(e.ruta).toMatch(new RegExp(`^reservas/${r}/.*comprobante_del_pago\\.png$`))
    expect(e.monto).toBe('600.00')
    expect(archivos.has(e.ruta)).toBe(true)
    s.unmount()

    const f = await abrir(finanzas)
    await user.click(await screen.findByRole('tab', { name: /^Reservas/ }))
    await user.click(within((await screen.findByText(nombre)).closest('tr')!).getByRole('button', { name: 'Revisar pago' }))
    const rev = await screen.findByRole('dialog', { name: /Pago de RES-/ })
    await user.click(within(rev).getByRole('button', { name: /Ver comprobante/ }))
    expect(await within(rev).findByAltText('Comprobante de pago')).toBeInTheDocument()
    expect(within(rev).getByRole('button', { name: 'Confirmar pago' })).toBeDisabled()
    await user.click(within(rev).getByLabelText(/Verifiqué el ingreso/))
    await user.click(within(rev).getByRole('button', { name: 'Confirmar pago' }))
    await screen.findByText('Pago confirmado')
    const v = await uno<{ numero: string }>(`select numero from public.recibos_pago where reservation_id = $1`, [r])
    await waitFor(async () => expect((await uno<{ pdf_ruta: string }>(`select pdf_ruta from public.recibos_pago where reservation_id = $1`, [r])).pdf_ruta).toMatch(new RegExp(`^recibos/${v.numero}-[0-9a-f]{12}\\.pdf$`)))
    expect(archivos.has((await uno<{ pdf_ruta: string }>(`select pdf_ruta from public.recibos_pago where reservation_id = $1`, [r])).pdf_ruta)).toBe(true)
    await within((await screen.findByText(nombre)).closest('tr')!).findByText(/Pago verificado/)
    f.unmount()
  })

  it('rechazar en pantalla pide el motivo y devuelve la reserva a pendiente', async () => {
    const user = userEvent.setup()
    const { r, codigo } = await solicitud()
    await reportar(vera, r)
    const f = await abrir(finanzas)
    await user.click(await screen.findByRole('tab', { name: /^Reservas/ }))
    await user.click(within((await screen.findByText(`Cliente ${codigo}`)).closest('tr')!).getByRole('button', { name: 'Revisar pago' }))
    const rev = await screen.findByRole('dialog', { name: /Pago de RES-/ })
    await user.click(within(rev).getByRole('button', { name: 'Rechazar pago' }))
    expect(within(rev).getByRole('button', { name: 'Confirmar rechazo' })).toBeDisabled()
    await user.type(within(rev).getByLabelText(/Motivo del rechazo/), 'El valor no ingresó')
    await user.click(within(rev).getByRole('button', { name: 'Confirmar rechazo' }))
    await screen.findByText('Pago rechazado')
    expect((await uno<{ comprobante: string | null }>(`select comprobante from public.reservations where id = $1`, [r])).comprobante).toBeNull()
    f.unmount()
  })

  it('«Rechazar pago» también está en Reservas, con motivo, y solo para quien verifica', async () => {
    const user = userEvent.setup()
    const { r, codigo } = await solicitud()
    await reportar(vera, r)
    const abrirReservas = async (id: string) => {
      const s = await como(db, id, async () => (await db.query<{ s: { id: string; nombre: string; rol: string; permisos: string[]; alcance: 'propio' | 'equipo' | 'empresa'; usuariosAlcance: string[] } }>(`select public.mi_sesion() as s`)).rows[0].s)
      const actor: Actor = { id: s.id, nombre: s.nombre, rol: s.rol, permisos: s.permisos, alcance: { tipo: s.alcance, usuarios: s.usuariosAlcance } }
      return render(
        <ConexionProvider value={{ remoto: true, datos: datosPglite(db, id), cuenta: null, salir: async () => {}, almacen }}>
          <SessionProvider actorRemoto={actor}><InventoryProvider><ClientesProvider><ReservasProvider><MemoryRouter><ReservasPage /></MemoryRouter></ReservasProvider></ClientesProvider></InventoryProvider></SessionProvider>
        </ConexionProvider>,
      )
    }
    const v = await abrirReservas(vera)
    expect(within((await screen.findByText(`Cliente ${codigo}`)).closest('tr')!).queryByRole('button', { name: 'Rechazar pago' })).toBeNull()
    v.unmount()
    const f = await abrirReservas(finanzas)
    await user.click(within((await screen.findByText(`Cliente ${codigo}`)).closest('tr')!).getByRole('button', { name: 'Rechazar pago' }))
    const d = await screen.findByRole('dialog', { name: /Rechazar el pago/ })
    expect(within(d).getByRole('button', { name: 'Rechazar pago' })).toBeDisabled()
    await user.type(within(d).getByLabelText(/Motivo del rechazo/), 'El valor no ingresó al banco')
    await user.click(within(d).getByRole('button', { name: 'Rechazar pago' }))
    await screen.findByText(/rechazado · la reserva vuelve a esperar el pago/)
    expect(await uno(`select estado, motivo_revision from public.comprobantes_pago where reservation_id = $1`, [r])).toEqual({ estado: 'rechazado', motivo_revision: 'El valor no ingresó al banco' })
    f.unmount()
  }, 60_000)

  it('Gerencia revisa el comprobante, pero no confirma: lo hace Finanzas', async () => {
    const user = userEvent.setup()
    const { r, codigo } = await solicitud()
    await reportar(vera, r)
    const g = await abrir(gerente)
    await user.click(await screen.findByRole('tab', { name: /^Reservas/ }))
    await user.click(within((await screen.findByText(`Cliente ${codigo}`)).closest('tr')!).getByRole('button', { name: 'Revisar pago' }))
    const rev = await screen.findByRole('dialog', { name: /Pago de RES-/ })
    expect(within(rev).getByText(/Banco Pichincha/)).toBeInTheDocument()
    expect(within(rev).queryByRole('button', { name: 'Confirmar pago' })).toBeNull()
    expect(within(rev).queryByRole('button', { name: 'Rechazar pago' })).toBeNull()
    g.unmount()
  })
})
