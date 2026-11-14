import { describe, expect, it } from 'vitest'
import { enlaceWhatsApp, indicadoresLeads, mensajeWhatsApp, procedencia, type Lead } from '../remoto'

const lead = (x: Partial<Lead>): Lead => ({
  id: Math.random().toString(36), fuente: 'web', formulario: null, nombre: 'Prospecto', telefono: '+593991234567', email: '', mensaje: '', unidadInteres: null,
  campana: null, anuncio: null, pagina: null, recibidoEn: '2026-11-16T15:00:00Z', estado: 'asignado', clientId: null, asignadoA: 'u1', asignadoEn: '2026-11-16T15:00:00Z',
  asignacion: 'rotacion', primerContactoEn: null, primerContactoTipo: null, ...x,
})

describe('procedencia del lead', () => {
  it('web: campaña, formulario y página; Facebook e Instagram: campaña y anuncio', () => {
    expect(procedencia(lead({ formulario: 'solicitud-de-informacion', pagina: 'https://amura.ec/contacto', campana: 'Lanzamiento' })))
      .toBe('Lanzamiento · formulario solicitud de informacion · página /contacto')
    expect(procedencia(lead({ formulario: 'whatsapp', pagina: 'https://amura.ec/' }))).toBe('botón de WhatsApp · página /')
    expect(procedencia(lead({ fuente: 'facebook', formulario: '987654', campana: 'Lanzamiento', anuncio: 'Anuncio 2D' }))).toBe('Lanzamiento · Anuncio 2D')
    expect(procedencia(lead({}))).toBe('')
  })
})

describe('WhatsApp del vendedor', () => {
  it('arma el enlace con el número internacional y el mensaje editable', () => {
    expect(enlaceWhatsApp('+593991234567', 'Hola Ana')).toBe('https://wa.me/593991234567?text=Hola%20Ana')
    expect(enlaceWhatsApp('0991234567', 'Hola')).toBe('https://wa.me/593991234567?text=Hola')
    expect(enlaceWhatsApp('+34612345678', 'Hola')).toBe('https://wa.me/34612345678?text=Hola')
    expect(enlaceWhatsApp('123', 'Hola')).toBeNull()
    expect(mensajeWhatsApp('Lucía Mora', 'Ana Vendedora')).toMatch(/^Hola Lucía, te saluda Ana Vendedora de AMURA/)
  })
})

describe('indicadores de leads', () => {
  it('cuenta recibidos, pendientes, por contactar, tiempo al primer contacto y conversión de los prospectos nuevos', () => {
    const leads = [
      lead({ clientId: 'c1', fuente: 'facebook', campana: 'Lanzamiento', primerContactoEn: '2026-11-16T17:00:00Z', primerContactoTipo: 'llamada' }),
      lead({ clientId: 'c2', fuente: 'facebook', campana: 'Lanzamiento', asignadoA: 'u2', primerContactoEn: '2026-11-16T16:00:00Z' }),
      lead({ clientId: 'c3', fuente: 'instagram', asignadoA: 'u2' }),
      lead({ clientId: 'c9', estado: 'duplicado', asignacion: 'responsable' }),
      lead({ estado: 'pendiente', asignadoA: null, asignadoEn: null, asignacion: null }),
    ]
    const r = indicadoresLeads(leads, { cotizacion: new Set(['c1', 'c2', 'c9']), reserva: new Set(['c1']), venta: new Set(['c1']) })
    expect(r).toMatchObject({ recibidos: 5, prospectos: 3, consultas: 1, pendientes: 1, porContactar: 2, contactados: 2, horasPrimerContacto: 1.5, conCotizacion: 2, conReserva: 1, conVenta: 1 })
    expect(r.porFuente).toEqual([{ clave: 'facebook', total: 2 }, { clave: 'web', total: 2 }, { clave: 'instagram', total: 1 }])
    expect(r.porCampana).toEqual([{ campana: 'Sin campaña', total: 3, ventas: 0 }, { campana: 'Lanzamiento', total: 2, ventas: 1 }])
    expect(r.porVendedor).toEqual([{ id: 'u1', total: 2, porContactar: 1 }, { id: 'u2', total: 2, porContactar: 1 }])
  })
})
