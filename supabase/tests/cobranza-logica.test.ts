import { describe, expect, it } from 'vitest'
import {
  aplicarPagos, configurarProveedor, enviarPendientes, estadoCuota, mensajePrueba, planificarCobranza, proveedorSimulado, REMITENTE_PRUEBA,
  type EntradaCobranza, type FilaCola,
} from '../functions/_shared/cobranza'

const HOY = '2026-10-29'
const destinatarios = { finanzas: ['finanzas@amura.test'], gerencia: ['gerencia@amura.test'], administracion: ['carlosftapiap@gmail.com'] }
const base = (o: Partial<EntradaCobranza> = {}): EntradaCobranza => ({
  hoy: HOY, ahora: '2026-10-29T12:00:00Z', app: 'https://amura.test', destinatarios,
  contratos: [{ id: 'c1', codigo: 'CON-1', cliente: 'Ana <Pérez>', unidad: 'Depto 1101', precio: 170000, estado: 'firmado', responsableEmail: 'vendedora@amura.test', responsableNombre: 'Vera' }],
  cuotas: [], pagos: [], compromisos: [], ...o,
})

describe('estados por cuota', () => {
  it('pagada solo con saldo cubierto; parcial puede estar por vencer o vencida', () => {
    expect(estadoCuota({ monto: 800, pagado: 800, vencimiento: '2026-01-01' }, HOY).situacion).toBe('pagada')
    const parcial = estadoCuota({ monto: 800, pagado: 300, vencimiento: '2026-10-01' }, HOY)
    expect(parcial).toMatchObject({ situacion: 'vencida', parcial: true, saldo: 500 })
  })
  it('por vencer dentro de 7 días, vence hoy, vencida y pendiente lejano', () => {
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: '2026-11-05' }, HOY).situacion).toBe('por_vencer')
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: HOY }, HOY).situacion).toBe('vence_hoy')
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: '2026-10-28' }, HOY)).toMatchObject({ situacion: 'vencida', atrasoDias: 1 })
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: '2026-12-31' }, HOY).situacion).toBe('pendiente')
  })
  it('usa días calendario de Ecuador sin desfases', () => {
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: '2026-11-05' }, '2026-10-29').atrasoDias).toBe(0)
    expect(estadoCuota({ monto: 1, pagado: 0, vencimiento: '2026-10-22' }, '2026-10-29').atrasoDias).toBe(7)
  })
})

describe('aplicación de pagos', () => {
  it('reparte la entrada en orden de vencimiento y deja el excedente como saldo a favor', () => {
    const cs = [{ numero: 2, monto: 800, vencimiento: '2026-02-01' }, { numero: 1, monto: 500, vencimiento: '2026-01-01' }]
    const r = aplicarPagos(cs, 1000)
    expect(r.pagado.get(1)).toBe(500)
    expect(r.pagado.get(2)).toBe(500)
    expect(r.excedente).toBe(0)
    expect(aplicarPagos(cs, 1500).excedente).toBe(200)
  })

  it('lo vencido se cubre antes que una cuota anterior reprogramada; la reserva va primero', () => {
    const cs = [
      { numero: 0, monto: 100, vencimiento: '2026-03-01' },
      { numero: 1, monto: 500, vencimiento: '2026-12-01' },
      { numero: 2, monto: 500, vencimiento: '2026-02-01' },
    ]
    const r = aplicarPagos(cs, 600)
    expect([r.pagado.get(0), r.pagado.get(2), r.pagado.get(1)]).toEqual([100, 500, 0])
  })

  it('el saldo contra entrega solo recibe lo autorizado, nunca más que el excedente', () => {
    const cs = [{ numero: 1, monto: 1000, vencimiento: '2026-01-01' }, { numero: 2, monto: 4000, vencimiento: null }]
    expect(aplicarPagos(cs, 3000)).toEqual({ pagado: new Map([[1, 1000], [2, 0]]), excedente: 2000 })
    expect(aplicarPagos(cs, 3000, 1500)).toEqual({ pagado: new Map([[1, 1000], [2, 1500]]), excedente: 500 })
    // Autorización mayor que el excedente real (por ejemplo, tras anular un pago): se limita al excedente.
    expect(aplicarPagos(cs, 1200, 1500)).toEqual({ pagado: new Map([[1, 1000], [2, 200]]), excedente: 0 })
    // Lo que supera también el 80 % queda a favor.
    expect(aplicarPagos(cs, 6000, 5000)).toEqual({ pagado: new Map([[1, 1000], [2, 4000]]), excedente: 1000 })
  })
})

describe('planificación de alertas', () => {
  const cuota = (numero: number, vencimiento: string | null, monto = 800) => ({ contratoId: 'c1', numero, concepto: `Cuota ${numero}`, vencimiento, monto })

  it('avisos a 7 y 3 días, día del vencimiento y primer día de atraso, una sola vez por cuota', () => {
    const a7 = planificarCobranza(base({ cuotas: [cuota(2, '2026-11-05')] })).alertas
    expect(a7.filter((x) => x.tipo !== 'resumen_diario').map((x) => x.tipo)).toEqual(['aviso_7d'])
    expect(planificarCobranza(base({ hoy: '2026-11-02', cuotas: [cuota(2, '2026-11-05')] })).alertas.filter((x) => x.tipo !== 'resumen_diario').map((x) => x.tipo)).toEqual(['aviso_3d'])
    expect(planificarCobranza(base({ cuotas: [cuota(2, HOY)] })).alertas.filter((x) => x.tipo !== 'resumen_diario').map((x) => x.tipo)).toEqual(['vence_hoy'])
    expect(planificarCobranza(base({ cuotas: [cuota(2, '2026-10-28')] })).alertas.filter((x) => x.tipo !== 'resumen_diario').map((x) => x.tipo)).toEqual(['primer_atraso'])
  })

  it('escalamiento a 7 y 15 días llega una sola vez: la clave no cambia de un día a otro', () => {
    const v = '2026-10-22' // 7 días de atraso
    const hoy7 = planificarCobranza(base({ cuotas: [cuota(2, v)] })).alertas.filter((x) => x.tipo === 'escalamiento_7')
    const mañana = planificarCobranza(base({ hoy: '2026-10-30', cuotas: [cuota(2, v)] })).alertas.filter((x) => x.tipo === 'escalamiento_7')
    expect(hoy7.length).toBeGreaterThan(0)
    expect(mañana.map((x) => x.dedupeKey)).toEqual(hoy7.map((x) => x.dedupeKey))
  })

  it('a 15 días se escala a gerencia además de finanzas y administración', () => {
    const a15 = planificarCobranza(base({ cuotas: [cuota(2, '2026-10-14')] })).alertas.filter((x) => x.tipo === 'escalamiento_15')
    expect(a15.map((x) => x.destinatario).sort()).toEqual(['carlosftapiap@gmail.com', 'finanzas@amura.test', 'gerencia@amura.test'])
  })

  it('una cuota pagada cancela sus alertas y no genera nuevas', () => {
    const r = planificarCobranza(base({
      cuotas: [cuota(2, '2026-10-22')],
      pagos: [{ id: 'p1', contratoId: 'c1', monto: 800, estado: 'verificado', referencia: 'R1', creadoEn: '2026-10-01T00:00:00Z' }],
    }))
    expect(r.alertas).toEqual([])
    expect(r.cancelarPrefijos).toContain('c1:2:')
  })

  it('un pago parcial mantiene la alerta con el saldo restante', () => {
    const r = planificarCobranza(base({
      cuotas: [cuota(2, '2026-10-22')],
      pagos: [{ id: 'p1', contratoId: 'c1', monto: 300, estado: 'verificado', referencia: 'R1', creadoEn: '2026-10-01T00:00:00Z' }],
    }))
    const v = r.alertas.find((x) => x.tipo === 'escalamiento_7')!
    expect(v.cuerpo).toContain('USD 500,00')
    expect(v.cuerpo).toContain('abono parcial')
  })

  it('antes de la firma no se genera ninguna alerta de cobro', () => {
    const r = planificarCobranza(base({
      contratos: [{ id: 'c1', codigo: 'CON-1', cliente: 'Ana', unidad: '1101', precio: 170000, estado: 'borrador', responsableEmail: null, responsableNombre: null }],
      cuotas: [cuota(2, '2026-10-01')],
    }))
    expect(r.alertas).toEqual([])
  })

  it('no hay resumen diario cuando no hay cartera de seguimiento', () => {
    expect(planificarCobranza(base()).alertas.filter((x) => x.tipo === 'resumen_diario')).toEqual([])
    const con = planificarCobranza(base({ cuotas: [cuota(2, '2026-11-05')] })).alertas.filter((x) => x.tipo === 'resumen_diario')
    expect(con.map((x) => x.destinatario).sort()).toEqual(['carlosftapiap@gmail.com', 'finanzas@amura.test'])
  })

  it('compromisos incumplidos y comprobantes de más de 24 horas, sin duplicar', () => {
    const r = planificarCobranza(base({
      compromisos: [{ id: 'k1', contratoId: 'c1', numero: 2, monto: 500, fecha: '2026-10-20', estado: 'pendiente' }],
      pagos: [{ id: 'p9', contratoId: 'c1', monto: 900, estado: 'registrado', referencia: 'TRF-9', creadoEn: '2026-10-27T10:00:00Z' }],
    }))
    expect(r.compromisosIncumplidos).toEqual(['k1'])
    expect(r.alertas.map((x) => x.tipo).sort()).toEqual(['comprobante_24h', 'compromiso_incumplido'])
  })

  it('escapa los datos del cliente en el correo y no adjunta archivos', () => {
    const r = planificarCobranza(base({ cuotas: [cuota(2, '2026-10-22')] }))
    const v = r.alertas.find((x) => x.tipo === 'escalamiento_7')!
    expect(v.cuerpo).toContain('Ana &lt;Pérez&gt;')
    expect(v.cuerpo).not.toContain('<Pérez>')
    expect(v.cuerpo).toContain('https://amura.test/cobranzas?contrato=c1')
  })
})

describe('envío de correos', () => {
  const fila = (o: Partial<FilaCola> = {}): FilaCola => ({ id: 'a1', estado: 'pendiente', intentos: 0, destinatario: 'x@y.test', asunto: 'Asunto', cuerpo: '<p>x</p>', ...o })

  it('sin proveedor configurado no envía y deja el aviso de configuración', async () => {
    const r = await enviarPendientes([fila()], null, '2026-10-29T13:00:00Z')
    expect(r).toEqual([{ id: 'a1', estado: 'pendiente', intentos: 0, error: 'Correo pendiente de configuración' }])
  })

  it('envío exitoso registra el identificador del proveedor y la hora', async () => {
    const sim = proveedorSimulado()
    const r = await enviarPendientes([fila()], sim, '2026-10-29T13:00:00Z', 'AMURA <cobranza@dominio.test>')
    expect(r[0]).toMatchObject({ estado: 'enviada', intentos: 1, proveedor_id: 'sim-1', enviada_en: '2026-10-29T13:00:00Z' })
    expect(sim.enviados[0].from).toBe('AMURA <cobranza@dominio.test>')
  })

  it('reintenta y, tras tres fallos, deja la alerta fallida', async () => {
    const sim = proveedorSimulado({ fallos: 5 })
    const primera = await enviarPendientes([fila()], sim, 't')
    expect(primera[0]).toMatchObject({ estado: 'pendiente', intentos: 1 })
    const segunda = await enviarPendientes([fila({ intentos: 1 })], sim, 't')
    const tercera = await enviarPendientes([fila({ intentos: 2 })], sim, 't')
    expect(tercera[0]).toMatchObject({ estado: 'fallida', intentos: 3 })
    expect(segunda[0].estado).toBe('pendiente')
  })

  it('no reenvía alertas que ya fueron enviadas o canceladas', async () => {
    const sim = proveedorSimulado()
    const r = await enviarPendientes([fila({ estado: 'enviada' }), fila({ id: 'a2', estado: 'cancelada' })], sim, 't')
    expect(r).toEqual([])
    expect(sim.enviados).toEqual([])
  })

  it('el envío real queda desactivado salvo configuración completa', () => {
    expect(configurarProveedor({ RESEND_API_KEY: 'k', COBRANZA_REMITENTE: 'a@b.test' }).proveedor).toBeNull()
    expect(configurarProveedor({ COBRANZA_ENVIO_REAL: 'true', COBRANZA_REMITENTE: 'a@b.test' }).motivo).toMatch(/RESEND_API_KEY/)
    expect(configurarProveedor({ COBRANZA_ENVIO_REAL: 'true', RESEND_API_KEY: 'k' }).motivo).toMatch(/dominio remitente/)
    expect(configurarProveedor({ COBRANZA_ENVIO_REAL: 'true', RESEND_API_KEY: 'k', COBRANZA_REMITENTE: 'a@b.test' }).proveedor).not.toBeNull()
  })

  it('modo prueba: tiene prioridad sobre el envío real y usa el remitente de pruebas', () => {
    const c = configurarProveedor({ CORREO_PRUEBA_DESTINO: 'pruebas@amura.test', COBRANZA_ENVIO_REAL: 'true', RESEND_API_KEY: 'k', COBRANZA_REMITENTE: 'cobranza@amura.test' })
    expect(c.prueba).toEqual({ destino: 'pruebas@amura.test', maximo: 10 })
    expect(c.remitente).toBe(REMITENTE_PRUEBA)
    expect(configurarProveedor({ CORREO_PRUEBA_DESTINO: 'pruebas@amura.test', RESEND_API_KEY: 'k', CORREO_PRUEBA_REMITENTE: 'Otro <o@x.test>', CORREO_PRUEBA_MAXIMO: '500' })).toMatchObject({ remitente: 'Otro <o@x.test>', prueba: { maximo: 50 } })
    // Un destino mal escrito no cae al envío real: no envía nada.
    const mal = configurarProveedor({ CORREO_PRUEBA_DESTINO: 'no-es-correo', COBRANZA_ENVIO_REAL: 'true', RESEND_API_KEY: 'k', COBRANZA_REMITENTE: 'c@a.test' })
    expect(mal.proveedor).toBeNull()
    expect(mal.motivo).toMatch(/no es un correo válido/)
    expect(configurarProveedor({ CORREO_PRUEBA_DESTINO: 'pruebas@amura.test' }).motivo).toMatch(/RESEND_API_KEY/)
  })

  it('modo prueba: nadie real recibe nada; el original queda visible y se registra el destinatario efectivo', async () => {
    const sim = proveedorSimulado()
    const filas = ['cliente@real.test', 'finanzas@real.test', 'oficial@real.test'].map((d, i) => fila({ id: `a${i}`, destinatario: d }))
    const r = await enviarPendientes(filas, sim, 't', REMITENTE_PRUEBA, { destino: 'pruebas@amura.test', maximo: 2 })
    expect(sim.enviados.map((m) => m.to)).toEqual(['pruebas@amura.test', 'pruebas@amura.test'])
    expect(sim.enviados[0].subject).toBe('[PRUEBA para cliente@real.test] Asunto')
    expect(sim.enviados[0].html).toContain('iba dirigido a <b>cliente@real.test</b>')
    expect(sim.enviados[0].from).toBe(REMITENTE_PRUEBA)
    expect(r.map((a) => [a.id, a.estado, a.destinatario_efectivo])).toEqual([['a0', 'enviada', 'pruebas@amura.test'], ['a1', 'enviada', 'pruebas@amura.test']])
    // Sobre el máximo, la tercera queda pendiente y sin intento.
    expect(r.find((a) => a.id === 'a2')).toBeUndefined()
    expect(mensajePrueba(fila({ destinatario: '<x>@y.test' }), 'p@a.test').html).toContain('&lt;x&gt;@y.test')
  })

  it('envío real: el destinatario efectivo es el original', async () => {
    const sim = proveedorSimulado()
    const [a] = await enviarPendientes([fila()], sim, 't', 'AMURA <c@a.test>')
    expect(a.destinatario_efectivo).toBe('x@y.test')
    expect(sim.enviados[0].subject).toBe('Asunto')
  })
})
