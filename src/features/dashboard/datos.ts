import { useCallback, useState } from 'react'
import type { Permiso } from '@/app/permissions'
import type { PagoFila } from '@/features/cobranza/tablero'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import type { EntradaPanel } from './panel'

/**
 * Lee del servidor solo lo que el perfil puede ver (RLS decide) y deja `null` donde no hay acceso o la lectura falló:
 * el panel muestra «—», nunca un cero que no existe.
 */
type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? null : String(v))
const dia = (v: unknown) => (v ? String(v).slice(0, 10) : null)

export const ENTRADA_VACIA: EntradaPanel = {
  clientes: null, oportunidades: null, cotizaciones: null, reservas: null, contratos: null, cuotas: null, pagos: null,
  plantillasPendientes: null, desistimientosPendientes: null, obra: null,
}

const intentar = async <T,>(permitido: boolean, f: () => Promise<T>): Promise<T | null> => {
  if (!permitido) return null
  try { return await f() } catch { return null }
}

export async function cargarPanel(d: Datos, can: (p: Permiso) => boolean): Promise<EntradaPanel> {
  const verContratos = can('ventas.ver') || can('cobranzas.ver')
  const [clientes, oportunidades, cotizaciones, reservas, contratos, cuotas, pagos, plantillas, desistimientos, obra] = await Promise.all([
    intentar(can('clientes.ver'), () => d.select<Fila>('clients')),
    intentar(can('clientes.ver'), () => d.select<Fila>('opportunities')),
    intentar(can('cotizaciones.ver'), () => d.select<Fila>('quotes')),
    intentar(can('reservas.ver'), () => d.select<Fila>('reservations')),
    intentar(verContratos, () => d.select<Fila>('contracts')),
    intentar(verContratos, () => d.select<Fila>('installments')),
    intentar(verContratos, () => d.select<Fila>('payments')),
    intentar(can('ventas.plantillas_ver'), () => d.select<Fila>('contract_templates', { filtros: { estado: 'borrador' } })),
    intentar(can('ventas.ver'), () => d.select<Fila>('desistimientos', { filtros: { estado: 'pendiente' } })),
    intentar(can('obra.resumen') || can('obra.ver'), () => d.rpc<Fila[] | null>('obra_resumen')),
  ])
  return {
    clientes: clientes && clientes.map((c) => ({ id: String(c.id) })),
    oportunidades: oportunidades && oportunidades.map((o) => ({ clienteId: String(o.client_id), unidad: s(o.codigo_unidad) })),
    cotizaciones: cotizaciones && cotizaciones.map((q) => ({ unidad: String(q.codigo), estado: String(q.estado) })),
    reservas: reservas && reservas.map((r) => ({ id: String(r.id), unidad: String(r.codigo_unidad), estado: String(r.estado), vigenciaHasta: dia(r.vigencia_hasta) })),
    contratos: contratos && contratos.map((c) => ({
      id: String(c.id), codigo: String(c.codigo), clientId: String(c.client_id), cliente: '', unidad: String(c.codigo_unidad),
      edificio: String(c.codigo_unidad).startsWith('E2') ? 2 : 1, responsable: '', estado: c.estado as 'borrador' | 'firmado' | 'anulado', precio: Number(c.precio),
      reservaId: s(c.reservation_id), fechaFirma: dia(c.fecha_firma),
    })),
    cuotas: cuotas && cuotas.map((q) => ({
      contratoId: String(q.contract_id), numero: Number(q.numero), concepto: String(q.concepto), vencimiento: dia(q.vencimiento),
      vencimientoOriginal: dia(q.vencimiento_original), monto: Number(q.monto),
    })),
    pagos: pagos && pagos.map((p): PagoFila => ({
      id: String(p.id), contratoId: String(p.contract_id), monto: Number(p.monto), fecha: String(p.fecha).slice(0, 10), referencia: String(p.referencia ?? ''),
      estado: p.estado as PagoFila['estado'], registradoPor: String(p.registrado_por ?? ''), registradoEn: String(p.registrado_en ?? ''), comprobante: s(p.comprobante_path), motivo: s(p.motivo),
    })),
    plantillasPendientes: plantillas ? plantillas.length : null,
    desistimientosPendientes: desistimientos ? desistimientos.length : null,
    obra: obra && obra.map((f) => ({
      codigo: String(f.codigo), nombre: String(f.nombre), pesosAprobados: Boolean(f.pesos_aprobados),
      avance: f.avance_validado === null || f.avance_validado === undefined ? null : Number(f.avance_validado), actividadesConAvance: Number(f.actividades_con_avance ?? 0),
    })),
  }
}

export function useDatosPanel(datos: Datos | null, can: (p: Permiso) => boolean) {
  const [entrada, setEntrada] = useState<EntradaPanel | null>(datos ? null : ENTRADA_VACIA)
  const recargar = useCallback(async () => { if (datos) setEntrada(await cargarPanel(datos, can)) }, [datos, can])
  useRefresco(recargar, !!datos)
  return entrada
}
