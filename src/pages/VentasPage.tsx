import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CloudOff, FilePlus2, FileSignature, History, X } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { FORMAS_PAGO, type FormaPago } from '@/features/clientes/model'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import * as api from '@/features/ventas/remoto'
import { comisionesPorContrato, type Comision } from '@/features/comisiones/remoto'
import { almacenContratosSupabase, type AlmacenContratos } from '@/features/contratos/almacen'
import AccionesDocumento from '@/features/contratos/components/AccionesDocumento'
import Plantillas from '@/features/contratos/components/Plantillas'
import ExpedienteCumplimiento from '@/features/cumplimiento/components/Expediente'
import { ESTADO_REVISION, type EstadoRevision } from '@/features/cumplimiento/expediente'
import type { VersionDocumento } from '@/features/contratos/model'
import * as contratos from '@/features/contratos/remoto'
import type { DatosVentas, EstadoContrato, EventoHistorial, Hito, ReservaPorContratar, TipoDocumento, TipoHito, Venta } from '@/features/ventas/remoto'
import { cn } from '@/lib/utils'
import { nombreEdificio, numeroComercial } from '@/features/inventario/nomenclatura'
import { etiquetaDiaPago, type DiaPago } from '@/features/financiamiento/calendario'

type Filtro = 'todos' | EstadoContrato

export default function VentasPage({ almacen = almacenContratosSupabase }: { almacen?: AlmacenContratos }) {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) {
    return (
      <>
        <PageHeader eyebrow="Seguimiento · Ventas y contratos" title="Ventas y contratos" subtitle="Formaliza las reservas aprobadas y sigue cada venta." />
        <div className="module-empty"><CloudOff className="size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Requiere la base de datos</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Los contratos los genera y valida el servidor: este módulo no funciona en modo demostración.</p></div>
      </>
    )
  }
  return <Ventas datos={datos} almacen={almacen} />
}

function Ventas({ datos, almacen }: { datos: Datos; almacen: AlmacenContratos }) {
  const { can } = useSession()
  const { state: inv, recargar: recargarInventario } = useInventory()
  const [d, setD] = useState<DatosVentas | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  // Los avisos por correo abren el contrato con ?contrato=<id>.
  const [abierta, setAbierta] = useState<string | null>(() => new URLSearchParams(window.location.search).get('contrato'))
  const [vista, setVista] = useState<'contratos' | 'plantillas'>('contratos')
  const [versiones, setVersiones] = useState<VersionDocumento[]>([])
  const [crear, setCrear] = useState<ReservaPorContratar | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Vendedor y comisión de cada venta, si la persona puede ver comisiones.
  const [comisiones, setComisiones] = useState<Map<string, Comision>>(new Map())

  const recargar = useCallback(async () => {
    try {
      setD(await api.cargarVentas(datos))
      setComisiones(await comisionesPorContrato(datos))
      try { setVersiones(await contratos.cargarTodasVersiones(datos)) } catch { setVersiones([]) }
      setErrorCarga(null)
    } catch (e) {
      setErrorCarga((e as Error).message)
    }
  }, [datos])
  useRefresco(recargar)

  /** Ejecuta una función del servidor y relee: el servidor decide; la pantalla solo muestra el resultado. */
  const ejecutar = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    await fn()
    await Promise.all([recargar(), recargarInventario()])
    setAviso(ok)
  }, [recargar, recargarInventario])

  const dpt = (codigo: string) => inv.units.find((u) => u.codigo === codigo)
  const ventas = useMemo(() => d?.ventas ?? [], [d])
  const lista = ventas.filter((v) => filtro === 'todos' || v.estado === filtro)
  const firmadas = ventas.filter((v) => v.estado === 'firmado')
  const venta = ventas.find((v) => v.id === abierta) ?? null
  // Un corredor ve sus reservas en Reservas; las reservas por contratar son del trabajo de Ventas.
  const porContratar = can('ventas.ver') ? d?.porContratar ?? [] : []

  if (errorCarga && !d) {
    return (
      <>
        <PageHeader eyebrow="Seguimiento · Ventas y contratos" title="Ventas y contratos" subtitle="Formaliza las reservas aprobadas y sigue cada venta." />
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">No se pudieron cargar las ventas: {errorCarga}</p>
      </>
    )
  }

  return (
    <>
      <PageHeader eyebrow="Seguimiento · Ventas y contratos" title="Ventas y contratos" subtitle="Formaliza las reservas aprobadas y sigue cada venta. Los datos vienen de Clientes, Cotizaciones y Reservas, sin volver a escribirlos." />

      {(can('ventas.plantillas_ver') || can('ventas.plantillas')) && (
        <div className="mb-4 flex gap-1.5" role="group" aria-label="Sección de Ventas y contratos">
          {(['contratos', 'plantillas'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={vista === s} onClick={() => setVista(s)}
              className={cn('rounded-full border px-4 py-1.5 text-xs font-medium transition-colors', vista === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white hover:bg-muted')}>{s === 'contratos' ? 'Contratos' : 'Plantillas y formatos'}</button>
          ))}
        </div>
      )}
      {vista === 'plantillas' ? (
        <Plantillas datos={datos} almacen={almacen} can={can} ventas={ventas.map((v) => ({ id: v.id, codigo: v.codigo, cliente: v.cliente?.nombre ?? null }))} />
      ) : (<>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi t="Reservas por contratar" v={porContratar.length} d="Aprobadas, sin contrato vigente" tono={porContratar.length ? 'text-amber-700' : undefined} />
        <Kpi t="Pendientes de firma" v={ventas.filter((v) => v.estado === 'borrador').length} d="Contratos en borrador" tono={ventas.some((v) => v.estado === 'borrador') ? 'text-amber-700' : undefined} />
        <Kpi t="Contratos firmados" v={firmadas.length} d="Cronograma exigible" />
        <Kpi t="Valor firmado" v={fmtUsd(firmadas.reduce((t, v) => t + v.precio, 0))} d="Suma de precios finales" />
      </div>

      {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-4" />{aviso}<button type="button" className="ml-auto" aria-label="Cerrar aviso" onClick={() => setAviso(null)}><X className="size-3.5" /></button></p>}

      {porContratar.length > 0 && (
        <section aria-labelledby="ve-por" className="dashboard-card mb-4 p-5">
          <h2 id="ve-por" className="text-sm font-semibold">Reservas aprobadas por contratar</h2>
          <ul className="mt-2 grid gap-1.5">
            {porContratar.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <b>{r.codigo}</b><span>{r.clienteNombre}</span><span className="text-muted-foreground">{dpt(r.unidad)?.dpt ?? numeroComercial(r.unidad)} · {fmtUsd(r.precio)}</span>
                {r.contratoAnulado && <span className="text-xs text-amber-800">Contrato anterior anulado: {r.contratoAnulado}</span>}
                {can('ventas.preparar') && <Button size="xs" className="ml-auto" onClick={() => setCrear(r)}><FilePlus2 />Generar contrato</Button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
        {(['todos', 'borrador', 'firmado', 'anulado'] as Filtro[]).map((f) => (
          <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
            className={cn('rounded-full border px-3 py-1 text-xs transition-colors', filtro === f ? 'border-primary bg-secondary text-secondary-foreground' : 'border-border hover:bg-muted')}>
            {f === 'todos' ? 'Todos' : api.ESTADO_CONTRATO[f].label}
          </button>
        ))}
      </div>

      {!d ? <p className="p-6 text-sm text-muted-foreground">Cargando ventas…</p> : lista.length === 0 ? (
        <div className="module-empty"><h2 className="text-lg font-semibold">Sin contratos</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Un contrato se genera desde una reserva confirmada.</p><Button asChild className="mt-6"><Link to="/reservas">Ir a Reservas</Link></Button></div>
      ) : (
        <div className="dashboard-card !p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Contrato</th><th className="px-2 py-2 text-left font-medium">Cliente</th><th className="px-2 py-2 text-left font-medium">Unidad</th><th className="px-2 py-2 text-right font-medium">Precio final</th><th className="px-2 py-2 text-left font-medium">Origen</th><th className="px-2 py-2 text-left font-medium">Vendedor · comisión</th><th className="px-2 py-2 text-left font-medium">Firma</th><th className="px-4 py-2 text-left font-medium">Estado</th><th className="px-4 py-2 text-left font-medium">Documentos</th></tr>
            </thead>
            <tbody>
              {lista.map((v) => {
                const u = dpt(v.unidad)
                return (
                  <tr key={v.id} className="cursor-pointer border-t border-border hover:bg-muted/50" tabIndex={0} aria-label={`Abrir ${v.codigo}`} onClick={() => setAbierta(v.id)} onKeyDown={(e) => { if (e.key === 'Enter') setAbierta(v.id) }}>
                    <td className="px-4 py-2"><div className="font-semibold">{v.codigo}</div><div className="text-xs text-muted-foreground">{v.reservaCodigo} · {v.cotizacionNumero}</div></td>
                    <td className="px-2 py-2">{v.cliente?.nombre ?? 'Sin acceso al cliente'}</td>
                    <td className="px-2 py-2">{u?.dpt ?? numeroComercial(v.unidad)}<div className="text-xs text-muted-foreground">{u ? `${nombreEdificio(u.edificio)} · ${u.tipologia}` : ''}</div></td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{fmtUsd(v.precio)}</td>
                    <td className="px-2 py-2">{v.corredorOrigen ?? v.origenDetalle ?? (v.origen ? api.ORIGENES_VENTA[v.origen] ?? v.origen : '—')}</td>
                    <td className="px-2 py-2"><VendedorComision v={v} c={comisiones.get(v.codigo)} /></td>
                    <td className="px-2 py-2">{v.fechaFirma ? fmtFechaCorta(v.fechaFirma) : '—'}</td>
                    <td className="px-4 py-2"><Estado e={v.estado} /></td>
                    <td className="px-4 py-2"><AccionesDocumento compacto venta={v} versiones={versiones.filter((x) => x.contratoId === v.id)} datos={datos} almacen={almacen} can={can} onCambio={recargar} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      </>)}

      {venta && <Ficha v={venta} comision={comisiones.get(venta.codigo)} datos={datos} almacen={almacen} versiones={versiones.filter((x) => x.contratoId === venta.id)} recargarDocumentos={recargar} ejecutar={ejecutar} onClose={() => setAbierta(null)} />}
      {crear && (
        <FormDialog titulo={`Generar contrato de ${crear.codigo}`} descripcion={`${crear.clienteNombre} · ${dpt(crear.unidad)?.dpt ?? crear.unidad} · ${fmtUsd(crear.precio)}. El precio y el cronograma salen de la cotización aceptada; no se pueden cambiar aquí.`}
          campos={[{ k: 'fecha', etiqueta: 'Fecha del contrato *', tipo: 'date', inicial: hoyGuayaquil() }, { k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }]} accion="Generar contrato"
          onClose={() => setCrear(null)} onConfirm={(v) => ejecutar(() => api.crearContrato(datos, crear.id, v.fecha, v.motivo), `Contrato de ${crear.codigo} generado · pendiente de firma`)} />
      )}
    </>
  )
}

/* ---------------------------------------------------------------- ficha del contrato */

type Pedido =
  | { tipo: 'firmar' } | { tipo: 'documento' } | { tipo: 'hito' } | { tipo: 'anular' }
  | { tipo: 'retirar'; id: string; nombre: string } | { tipo: 'revertir'; hito: Hito }

/** Vendedor responsable de la venta y su comisión; sin permiso de comisiones, solo el vendedor. */
function VendedorComision({ v, c }: { v: Venta; c?: Comision }) {
  const vendedor = c?.beneficiario ?? v.responsable ?? v.asesor
  if (!c) return <>{vendedor ?? '—'}</>
  const t = c.tramos[0]
  const estado = c.estado === 'anulada' ? 'anulada' : t?.estado === 'pagada' ? 'pagada' : t?.listaParaPago ? 'lista para pago' : 'pendiente'
  return <>{vendedor ?? '—'}<div className="text-xs tabular-nums text-muted-foreground">{fmtUsd2(c.montoTotal)} · {estado}</div></>
}

function Ficha({ v, comision, datos, almacen, versiones, recargarDocumentos, ejecutar, onClose }: { v: Venta; comision?: Comision; datos: Datos; almacen: AlmacenContratos; versiones: VersionDocumento[]; recargarDocumentos: () => Promise<void>; ejecutar: (fn: () => Promise<unknown>, ok: string) => Promise<void>; onClose: () => void }) {
  const { can } = useSession()
  const { state: inv } = useInventory()
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [eventos, setEventos] = useState<EventoHistorial[]>([])
  const [cumplimiento, setCumplimiento] = useState<EstadoRevision | 'sin_enviar' | null>(null)
  const u = inv.units.find((x) => x.codigo === v.unidad)
  const c = v.condiciones
  const verPagos = can('cobranzas.ver')
  const formaliza = can('ventas.formalizar')
  const hitosVigentes = v.hitos.filter((h) => !h.revertidoEn)
  const faltan = (Object.keys(api.HITOS) as TipoHito[]).filter((h) => h !== 'contrato_firmado' && !hitosVigentes.some((x) => x.hito === h))
  const firma = `${v.documentos.length}-${v.hitos.length}-${v.estado}`

  useEffect(() => {
    let vivo = true
    api.historial(datos, v.id).then((e) => { if (vivo) setEventos(e) }).catch(() => { if (vivo) setEventos([]) })
    return () => { vivo = false }
  }, [datos, v.id, firma])

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent showCloseButton={false} className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="sticky top-0 z-10 border-b border-border bg-white px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base">{v.codigo} <Estado e={v.estado} /></SheetTitle>
              <SheetDescription>{v.cliente?.nombre ?? 'Sin acceso al cliente'} · {u?.dpt ?? numeroComercial(v.unidad)} · {fmtUsd(v.precio)}</SheetDescription>
            </div>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
          {v.estado !== 'anulado' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {v.estado === 'borrador' && formaliza && (
                <Button size="sm" disabled={cumplimiento !== 'aprobado'} title={cumplimiento !== 'aprobado' ? 'Requiere la aprobación de Cumplimiento' : undefined} onClick={() => setPedido({ tipo: 'firmar' })}><FileSignature />Registrar firma</Button>
              )}
              {can('ventas.preparar') && <Button size="sm" variant="outline" onClick={() => setPedido({ tipo: 'documento' })}>Registrar documento</Button>}
              {v.estado === 'firmado' && formaliza && faltan.length > 0 && <Button size="sm" variant="outline" onClick={() => setPedido({ tipo: 'hito' })}>Registrar hito</Button>}
              {formaliza && <Button size="sm" variant="outline" className="ml-auto text-rose-700" onClick={() => setPedido({ tipo: 'anular' })}>Anular contrato</Button>}
            </div>
          )}
        </SheetHeader>

        <div className="grid gap-5 px-5 py-5">
          {v.estado === 'anulado' && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">Anulado el {v.anuladoEn ? fmtFechaCorta(v.anuladoEn) : '—'} por {v.anuladoPor ?? '—'}: {v.motivoAnulacion}. Se conserva como historia y ya no es exigible.{verPagos && v.pagadoVerificado > 0 ? ` Se recibieron ${fmtUsd2(v.pagadoVerificado)}: la devolución o el traslado lo resuelve Finanzas.` : ''}</p>
          )}

          {v.estado === 'borrador' && formaliza && cumplimiento !== null && cumplimiento !== 'aprobado' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">La firma se habilita cuando Cumplimiento apruebe el expediente. Estado actual: {ESTADO_REVISION[cumplimiento].label.toLowerCase()}.</p>
          )}

          {v.estado !== 'anulado' && (
            <section aria-labelledby="ve-cumplimiento" className="rounded-xl border border-border p-4">
              <h3 id="ve-cumplimiento" className="mb-2 text-sm font-semibold">Cumplimiento</h3>
              <ExpedienteCumplimiento contrato={v.id} borrador={v.estado === 'borrador'} datos={datos} almacen={almacen} ejecutar={ejecutar} onEstado={setCumplimiento} />
            </section>
          )}

          <Bloque id="ve-documentos" titulo="Documentos contractuales">
            <AccionesDocumento venta={v} versiones={versiones} datos={datos} almacen={almacen} can={can} onCambio={recargarDocumentos} />
          </Bloque>

          <div className="grid gap-5 sm:grid-cols-2">
            <Bloque id="ve-venta" titulo="Venta">
              <Dato t="Cliente" v={v.cliente?.nombre ?? 'Sin acceso al cliente'} />
              {v.cliente?.documento && <Dato t="Cédula o RUC" v={v.cliente.documento} />}
              <Dato t="Unidad" v={u ? `${u.dpt} · ${u.tipologia}` : numeroComercial(v.unidad)} />
              <Dato t="Edificio" v={u ? `${nombreEdificio(u.edificio)} · piso ${u.piso}` : '—'} />
              <Dato t="Precio final" v={fmtUsd2(v.precio)} fuerte />
              <Dato t="Fecha del contrato" v={fmtFechaCorta(v.fechaContrato)} />
              <Dato t="Fecha de firma" v={v.fechaFirma ? `${fmtFechaCorta(v.fechaFirma)}${v.firmadoPor ? ` · ${v.firmadoPor}` : ''}` : 'Pendiente'} />
            </Bloque>
            <Bloque id="ve-origen" titulo="Origen y responsables">
              <Dato t="Cotización" v={v.cotizacionFecha ? `${v.cotizacionNumero} · ${fmtFechaCorta(v.cotizacionFecha)}` : v.cotizacionNumero} />
              <Dato t="Reserva" v={`${v.reservaCodigo} · ${fmtUsd2(v.montoReserva)}`} />
              <Dato t="Asesor principal" v={v.asesor ?? 'Sin dato histórico'} />
              <Dato t="Responsable de la negociación" v={v.responsable ?? 'Sin dato histórico'} />
              {comision && <Dato t="Comisión del vendedor" v={`${comision.beneficiario ?? v.responsable ?? '—'} · ${fmtUsd2(comision.montoTotal)} (${comision.porcentaje.toFixed(2)} %)`} />}
              <Dato t="Corredor de origen" v={v.corredorOrigen ?? (v.origen === 'corredor' ? `${v.origenDetalle ?? ''} (no registrado)` : 'No aplica')} />
              <Dato t="Origen" v={v.origen ? `${api.ORIGENES_VENTA[v.origen] ?? v.origen}${v.origenDetalle ? ` · ${v.origenDetalle}` : ''}` : 'Sin dato histórico'} />
              <Dato t="Atribución de captación" v={v.atribucion ?? 'Sin dato histórico'} />
              {v.asesorActual && v.asesor && v.asesorActual !== v.asesor && <p className="text-xs text-amber-800">El cliente hoy lo atiende {v.asesorActual}. Estos datos son los de la venta y no cambian.</p>}
            </Bloque>
          </div>

          {c && (
            <Bloque id="ve-cond" titulo="Condiciones de entrada y financiamiento">
              <Dato t="Precio de lista" v={fmtUsd2(c.precioLista)} />
              {c.descuentoPct > 0 && <Dato t="Descuento" v={`${c.descuentoPct}%`} />}
              <Dato t={`Pago a la firma (${c.reservaPct} %)`} v={fmtUsd2(c.reserva)} />
              <Dato t="Reserva acordada (se acredita al pago a la firma)" v={fmtUsd2(v.montoReserva)} />
              <Dato t={`${c.meses} cuotas`} v={fmtUsd2(c.cuotaMensual)} />
              <Dato t="Día de pago de las cuotas" v={etiquetaDiaPago(((v.diaPago ?? (c as { diaPago?: string }).diaPago ?? 'ultimo') as DiaPago))} />
              {!!c.extraordinarias?.length && <Dato t={`${c.extraordinarias.length} cuotas extraordinarias (programadas)`} v={fmtUsd2(c.extraordinarias.reduce((t, e) => t + e.monto, 0))} />}
              <Dato t={`Contra entrega (${c.entregaPct}%)`} v={fmtUsd2(c.contraEntrega)} />
              <Dato t="Forma de pago" v={v.cliente?.formaPago ? FORMAS_PAGO[v.cliente.formaPago as FormaPago] ?? v.cliente.formaPago : 'Sin definir'} />
              {v.simulaciones.length > 0 && <Dato t="Simulaciones de crédito" v={v.simulaciones.join(', ')} />}
            </Bloque>
          )}

          <section aria-labelledby="ve-cron" className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="ve-cron" className="text-sm font-semibold">Cronograma de pagos</h3>
              {verPagos && <span className="text-xs text-muted-foreground">Recibido y conciliado: {fmtUsd2(v.pagadoVerificado)} · Saldo: {fmtUsd2(v.saldo)}</span>}
              {verPagos && <Link to={`/cobranzas?contrato=${v.id}`} className="ml-auto text-xs text-primary hover:underline">Ver en Cobranzas</Link>}
            </div>
            {v.estado === 'borrador' && <p className="text-xs text-muted-foreground">Se vuelve exigible al firmar el contrato.</p>}
            <div className="max-h-64 overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-3 py-1.5 text-left font-medium">Concepto</th><th className="px-2 py-1.5 text-left font-medium">Vence</th><th className="px-2 py-1.5 text-right font-medium">Monto</th>{verPagos && <th className="px-3 py-1.5 text-right font-medium">Pendiente</th>}</tr></thead>
                <tbody>{v.cuotas.map((q) => (
                  <tr key={q.numero} className="border-t border-border"><td className="px-3 py-1">{q.concepto}</td><td className="px-2 py-1">{q.vencimiento ? fmtFechaCorta(q.vencimiento) : 'A la entrega'}</td><td className="px-2 py-1 text-right tabular-nums">{fmtUsd2(q.monto)}</td>{verPagos && <td className="px-3 py-1 text-right tabular-nums">{fmtUsd2(q.pendiente)}</td>}</tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 sm:grid-cols-2">
            <section aria-labelledby="ve-hitos" className="grid content-start gap-2">
              <h3 id="ve-hitos" className="text-sm font-semibold">Hitos</h3>
              {v.hitos.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay hitos.</p>}
              <ul className="grid gap-1.5">{v.hitos.map((h) => (
                <li key={h.id} className={cn('rounded-lg border border-border px-3 py-2 text-xs', h.revertidoEn && 'opacity-60')}>
                  <div className="flex items-center gap-2"><b className={cn(h.revertidoEn && 'line-through')}>{api.HITOS[h.hito]}</b><span className="text-muted-foreground">{fmtFechaCorta(h.fecha)}</span>
                    {!h.revertidoEn && formaliza && h.hito !== 'contrato_firmado' && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPedido({ tipo: 'revertir', hito: h })}>Revertir</Button>}
                  </div>
                  <div className="text-xs text-muted-foreground">{h.registradoPor} · {h.motivo}{h.referencia ? ` · ${h.referencia}` : ''}</div>
                  {h.revertidoEn && <div className="text-xs text-amber-800">Revertido: {h.motivoReversion}</div>}
                </li>
              ))}</ul>
            </section>
            <section aria-labelledby="ve-docs" className="grid content-start gap-2">
              <h3 id="ve-docs" className="text-sm font-semibold">Documentos</h3>
              {v.documentos.length === 0 && <p className="text-xs text-muted-foreground">Sin documentos registrados.</p>}
              <ul className="grid gap-1.5">{v.documentos.map((x) => (
                <li key={x.id} className={cn('rounded-lg border border-border px-3 py-2 text-xs', x.retiradoEn && 'opacity-60')}>
                  <div className="flex items-center gap-2"><b className={cn(x.retiradoEn && 'line-through')}>{api.TIPOS_DOCUMENTO[x.tipo]}</b>
                    {!x.retiradoEn && formaliza && v.estado !== 'anulado' && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPedido({ tipo: 'retirar', id: x.id, nombre: api.TIPOS_DOCUMENTO[x.tipo] })}>Retirar</Button>}
                  </div>
                  <div className="break-all text-xs text-muted-foreground">{x.referencia}</div>
                  <div className="text-xs text-muted-foreground">{x.registradoPor}{x.descripcion ? ` · ${x.descripcion}` : ''}</div>
                  {x.retiradoEn && <div className="text-xs text-amber-800">Retirado: {x.motivoRetiro}</div>}
                </li>
              ))}</ul>
            </section>
          </div>

          <section aria-labelledby="ve-hist" className="grid gap-2">
            <h3 id="ve-hist" className="flex items-center gap-1.5 text-sm font-semibold"><History className="size-4" />Historial de cambios</h3>
            <ol className="grid gap-2 border-l border-border pl-4">{eventos.map((e, i) => (
              <li key={i} className="text-xs"><div><b>{e.accion}</b> · {e.motivo}</div><div className="text-xs text-muted-foreground">{new Date(e.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'short' })} · {e.usuario}{e.evidencia ? ` · ${e.evidencia}` : ''}</div></li>
            ))}</ol>
          </section>
        </div>

        {pedido?.tipo === 'firmar' && (
          <FormDialog titulo={`Registrar firma de ${v.codigo}`} descripcion="Al registrarla, el cronograma se vuelve exigible y la unidad pasa a promesa." accion="Registrar firma" onClose={() => setPedido(null)}
            campos={[{ k: 'fecha', etiqueta: 'Fecha de firma *', tipo: 'date', inicial: hoyGuayaquil(), max: hoyGuayaquil() }, { k: 'evidencia', etiqueta: 'Enlace o referencia del contrato firmado *', tipo: 'texto', min: 3 }, { k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }]}
            onConfirm={(f) => ejecutar(() => api.formalizar(datos, v.id, f.fecha, f.motivo, f.evidencia), `${v.codigo} firmado`)} />
        )}
        {pedido?.tipo === 'documento' && (
          <FormDialog titulo={`Registrar documento de ${v.codigo}`} descripcion="Guarda el enlace o la referencia; el archivo vive en su repositorio." accion="Registrar" onClose={() => setPedido(null)}
            campos={[{ k: 'tipo', etiqueta: 'Tipo *', tipo: 'lista', inicial: 'anexo', opciones: (['anexo', 'borrador', 'escritura', 'otro'] as TipoDocumento[]).map((t) => [t, api.TIPOS_DOCUMENTO[t]]) }, { k: 'referencia', etiqueta: 'Enlace o referencia *', tipo: 'texto', min: 3 }, { k: 'descripcion', etiqueta: 'Descripción', tipo: 'texto' }]}
            onConfirm={(f) => ejecutar(() => api.registrarDocumento(datos, v.id, f.tipo as TipoDocumento, f.referencia, f.descripcion), 'Documento registrado')} />
        )}
        {pedido?.tipo === 'hito' && (
          <FormDialog titulo={`Registrar hito de ${v.codigo}`} descripcion="Deja constancia de lo ocurrido. No genera ninguna comisión ni pago." accion="Registrar hito" onClose={() => setPedido(null)}
            campos={[{ k: 'hito', etiqueta: 'Hito *', tipo: 'lista', inicial: faltan[0], opciones: faltan.map((h) => [h, api.HITOS[h]]) }, { k: 'fecha', etiqueta: 'Fecha *', tipo: 'date', inicial: hoyGuayaquil(), max: hoyGuayaquil() }, { k: 'referencia', etiqueta: 'Referencia', tipo: 'texto' }, { k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }]}
            onConfirm={(f) => ejecutar(() => api.registrarHito(datos, v.id, f.hito as TipoHito, f.fecha, f.referencia, f.motivo), 'Hito registrado')} />
        )}
        {pedido?.tipo === 'anular' && (
          <FormDialog titulo={`Anular ${v.codigo}`} descripcion="Nada se borra: el contrato, sus cuotas y pagos quedan como historia y dejan de ser exigibles. La reserva sigue aprobada: después puedes generar otro contrato o anularla en Reservas. La devolución de dinero la resuelve Finanzas." accion="Anular contrato" peligro onClose={() => setPedido(null)}
            campos={[{ k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }, { k: 'evidencia', etiqueta: v.estado === 'firmado' ? 'Documento que respalda la anulación *' : 'Documento que respalda la anulación', tipo: 'texto', min: v.estado === 'firmado' ? 3 : 0 }]}
            onConfirm={(f) => ejecutar(() => api.anular(datos, v.id, f.motivo, f.evidencia), `${v.codigo} anulado`)} />
        )}
        {pedido?.tipo === 'retirar' && (
          <FormDialog titulo={`Retirar ${pedido.nombre}`} descripcion="El documento se conserva en el historial, marcado como retirado." accion="Retirar" onClose={() => setPedido(null)}
            campos={[{ k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }]} onConfirm={(f) => ejecutar(() => api.retirarDocumento(datos, pedido.id, f.motivo), 'Documento retirado')} />
        )}
        {pedido?.tipo === 'revertir' && (
          <FormDialog titulo={`Revertir ${api.HITOS[pedido.hito.hito]}`} descripcion="El hito se conserva marcado como revertido y se deshace su efecto." accion="Revertir" peligro onClose={() => setPedido(null)}
            campos={[{ k: 'motivo', etiqueta: 'Motivo *', tipo: 'area', min: 5 }]} onConfirm={(f) => ejecutar(() => api.revertirHito(datos, pedido.hito.id, f.motivo), 'Hito revertido')} />
        )}
      </SheetContent>
    </Sheet>
  )
}

/* --------------------------------------------------------------------- componentes */

interface Campo { k: string; etiqueta: string; tipo: 'texto' | 'area' | 'date' | 'lista'; inicial?: string; min?: number; max?: string; opciones?: [string, string][] }

/** El error del servidor se muestra aquí y el formulario sigue abierto, sin perder lo escrito. */
function FormDialog({ titulo, descripcion, campos, accion, peligro, onClose, onConfirm }: {
  titulo: string; descripcion: string; campos: Campo[]; accion: string; peligro?: boolean; onClose: () => void; onConfirm: (v: Record<string, string>) => Promise<void>
}) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.k, c.inicial ?? ''])))
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const valido = campos.every((c) => v[c.k].trim().length >= (c.min ?? 0) && (c.tipo !== 'date' || !!v[c.k]))
  const enviar = async () => {
    setError(null); setEnviando(true)
    try {
      await onConfirm(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim()])))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>{descripcion}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          {campos.map((c) => {
            const id = `ve-f-${c.k}`
            const cambiar = (x: string) => setV((a) => ({ ...a, [c.k]: x }))
            return (
              <div key={c.k} className="grid gap-1.5">
                <Label htmlFor={id} className="text-xs">{c.etiqueta}</Label>
                {c.tipo === 'area' ? <Textarea id={id} rows={2} value={v[c.k]} onChange={(e) => cambiar(e.target.value)} />
                  : c.tipo === 'lista' ? (
                    <Select value={v[c.k]} onValueChange={cambiar}>
                      <SelectTrigger id={id} className="h-9 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>{c.opciones!.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : <Input id={id} type={c.tipo === 'date' ? 'date' : 'text'} max={c.max} value={v[c.k]} onChange={(e) => cambiar(e.target.value)} />}
              </div>
            )
          })}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant={peligro ? 'destructive' : 'default'} disabled={!valido || enviando} onClick={() => void enviar()}>{enviando ? 'Guardando…' : accion}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Estado({ e }: { e: EstadoContrato }) {
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', api.ESTADO_CONTRATO[e].tono)}>{api.ESTADO_CONTRATO[e].label}</span>
}

function Bloque({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return <section aria-labelledby={id} className="rounded-xl border border-border p-4"><h3 id={id} className="mb-2 text-sm font-semibold">{titulo}</h3><dl className="grid gap-1.5 text-xs">{children}</dl></section>
}

function Dato({ t, v, fuerte }: { t: string; v: string; fuerte?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t}</dt><dd className={cn('text-right', fuerte ? 'font-semibold text-primary' : 'font-medium')}>{v}</dd></div>
}

function Kpi({ t, v, d, tono }: { t: string; v: number | string; d: string; tono?: string }) {
  return <div className="dashboard-card !p-4"><div className="text-xs text-muted-foreground">{t}</div><div className={cn('mt-1 text-xl font-semibold tabular-nums tracking-tight', tono)}>{v}</div><div className="mt-0.5 text-xs text-muted-foreground">{d}</div></div>
}
