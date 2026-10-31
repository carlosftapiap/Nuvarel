import { useCallback, useState, type ReactNode } from 'react'
import { CheckCircle2, CircleDashed, CloudOff, Pencil, ShieldAlert, ShieldCheck } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { useConexion } from '@/app/auth'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import * as api from '@/features/comisiones/remoto'
import { ESTADO_TRAMO, TIPO_MOVIMIENTO, type Comision, type DatosComisiones, type EstadoTramo, type Tramo } from '@/features/comisiones/remoto'
import type { Datos } from '@/features/conexion/datos'
import { useRefresco } from '@/features/conexion/refresco'
import { fmtFechaCorta, hoyGuayaquil } from '@/features/financiamiento/plan'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd, fmtUsd2 } from '@/features/inventario/pricing'
import { useInventory } from '@/features/inventario/store'
import { cn } from '@/lib/utils'

const SUBTITULO = 'Seguimiento de cada comisión por tramos, con los datos de Contratos y Cobranzas. Nada se paga solo: Finanzas confirma cada pago.'
type Filtro = 'todas' | EstadoTramo

export default function ComisionesPage() {
  const { remoto, datos } = useConexion()
  if (!remoto || !datos) {
    return (
      <>
        <PageHeader eyebrow="Finanzas · Comisiones" title="Comisiones" subtitle={SUBTITULO} />
        <div className="module-empty"><CloudOff className="size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Requiere la base de datos</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Las comisiones se calculan en la base de datos de AMURA.</p></div>
      </>
    )
  }
  return <Comisiones datos={datos} />
}

/** Un pedido abre el diálogo común: campos que se piden y qué función del servidor se ejecuta. */
interface Campo { id: string; label: string; tipo?: 'texto' | 'area' | 'fecha' | 'monto'; inicial?: string; minimo?: number }
interface Pedido { titulo: string; ayuda: string; boton: string; destructivo?: boolean; campos: Campo[]; confirmacion?: string; ok: string; ejecutar: (v: Record<string, string>) => Promise<unknown> }

const MOTIVO: Campo = { id: 'motivo', label: 'Motivo *', tipo: 'area', minimo: 5 }

function Comisiones({ datos }: { datos: Datos }) {
  const { can, actor } = useSession()
  const { state: inv } = useInventory()
  const [d, setD] = useState<DatosComisiones | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')

  const recargar = useCallback(async () => {
    try {
      setD(await api.cargarComisiones(datos))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [datos])
  useRefresco(recargar)

  const aprueba = can('comisiones.aprobar')
  const finanzas = can('comisiones.finanzas')
  const dpt = (codigo: string) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? codigo
  const comisiones = d?.comisiones ?? []
  const lista = comisiones.filter((c) => filtro === 'todas' || c.tramos.some((t) => t.estado === filtro))
  const r = api.resumen(comisiones)
  const politica = d?.politica

  const acciones = (c: Comision, t: Tramo): ReactNode[] => {
    const titulo = `Tramo ${t.numero} de ${c.contrato}`
    const b: ReactNode[] = []
    if (finanzas && t.estado === 'pendiente' && !t.honorario) {
      b.push(<Button key="hon" size="xs" variant="outline" onClick={() => setPedido({
        titulo: 'Registrar honorario recibido', ayuda: `${titulo}. Registra lo que Jarva recibió por este tramo. No crea ingresos ni pagos en otros módulos.`, boton: 'Registrar honorario', ok: 'Honorario registrado',
        campos: [{ id: 'monto', label: 'Monto recibido (USD) *', tipo: 'monto' }, { id: 'fecha', label: 'Fecha de recepción *', tipo: 'fecha', inicial: hoyGuayaquil() }, { id: 'referencia', label: 'Referencia del ingreso *', minimo: 3 }],
        ejecutar: (v) => api.registrarHonorario(datos, t.id, Number(v.monto.replace(',', '.')), v.fecha, v.referencia),
      })}>Registrar honorario</Button>)
    }
    if (finanzas && t.estado === 'pendiente' && t.honorario) {
      b.push(<Button key="qhon" size="xs" variant="ghost" onClick={() => setPedido({ titulo: 'Quitar honorario', ayuda: `${titulo}. Úsalo para corregir un registro equivocado; queda en la auditoría.`, boton: 'Quitar honorario', ok: 'Honorario quitado', campos: [MOTIVO], ejecutar: (v) => api.quitarHonorario(datos, t.id, v.motivo) })}>Quitar honorario</Button>)
    }
    if (aprueba && t.estado === 'pendiente' && t.cumple && politica?.aprobada) {
      b.push(<Button key="hab" size="xs" onClick={() => setPedido({ titulo: 'Habilitar para liquidación', ayuda: `${titulo} · ${fmtUsd2(t.monto)}. No paga nada: autoriza a Finanzas a liquidarlo.`, boton: 'Habilitar', ok: 'Tramo habilitado para liquidación', campos: [MOTIVO], ejecutar: (v) => api.habilitar(datos, t.id, v.motivo) })}>Habilitar</Button>)
    }
    if (aprueba && t.estado === 'habilitada') {
      b.push(<Button key="dhab" size="xs" variant="ghost" onClick={() => setPedido({ titulo: 'Quitar habilitación', ayuda: `${titulo}. Vuelve a pendiente de condiciones.`, boton: 'Quitar habilitación', ok: 'Habilitación retirada', campos: [MOTIVO], ejecutar: (v) => api.deshabilitar(datos, t.id, v.motivo) })}>Quitar habilitación</Button>)
    }
    if (finanzas && t.estado === 'habilitada' && t.cumple && t.habilitadaPor !== actor.id) {
      b.push(<Button key="pag" size="xs" onClick={() => setPedido({
        titulo: 'Confirmar pago', ayuda: `${titulo} · ${fmtUsd2(t.monto)}. Registra un pago ya realizado fuera del sistema; no mueve dinero.`, boton: 'Confirmar pago', ok: 'Pago confirmado', confirmacion: `Confirmo que este pago de ${fmtUsd2(t.monto)} se realizó.`,
        campos: [{ id: 'fecha', label: 'Fecha de pago *', tipo: 'fecha', inicial: hoyGuayaquil() }, { id: 'beneficiario', label: 'Pagado a *', minimo: 3 }, { id: 'referencia', label: 'Referencia del pago o factura *', minimo: 3 }],
        ejecutar: (v) => api.confirmarPago(datos, t.id, v.fecha, v.beneficiario, v.referencia, true),
      })}>Confirmar pago</Button>)
    }
    if (aprueba && t.estado === 'pagada' && c.estado !== 'anulada') {
      b.push(<Button key="rev" size="xs" variant="outline" className="text-rose-700" onClick={() => setPedido({ titulo: 'Reversar pago', ayuda: `${titulo}. El pago queda en el historial, marcado como reversado, y el tramo vuelve a pendiente.`, boton: 'Reversar pago', destructivo: true, ok: 'Pago reversado', campos: [MOTIVO], ejecutar: (v) => api.reversarPago(datos, t.id, v.motivo) })}>Reversar pago</Button>)
    }
    return b
  }

  return (
    <>
      <PageHeader eyebrow="Finanzas · Comisiones" title="Comisiones" subtitle={SUBTITULO} />

      {error && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">No se pudieron cargar las comisiones: {error}</p>}
      {aviso && <p role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><CheckCircle2 className="size-3.5" aria-hidden="true" />{aviso}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi t="Comisión calculada" v={fmtUsd2(r.calculada)} d="Contratos aún sin firmar" />
        <Kpi t="Pendiente de condiciones" v={fmtUsd2(r.pendiente)} d="Venta firmada" />
        <Kpi t="Habilitada" v={fmtUsd2(r.habilitada)} d="Lista para liquidar" />
        <Kpi t="Pagada" v={fmtUsd2(r.pagada)} d="Confirmada por Finanzas" />
        <Kpi t="Por recuperar" v={fmtUsd2(r.porRecuperar)} d="De ventas anuladas" tono={r.porRecuperar > 0 ? 'text-rose-700' : undefined} />
      </div>

      {politica && (
        <section aria-label="Política de liquidación" className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs', politica.aprobada ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          {politica.aprobada ? <ShieldCheck className="size-4" aria-hidden="true" /> : <ShieldAlert className="size-4" aria-hidden="true" />}
          {politica.aprobada
            ? <span>Política de liquidación aprobada por {politica.nombre}. Respaldo: {politica.documento}.</span>
            : <span><b>Política de liquidación sin aprobación formal.</b> Se puede registrar y dar seguimiento, pero ningún tramo se puede habilitar ni pagar.</span>}
          {aprueba && !politica.aprobada && <Button size="xs" variant="outline" className="ml-auto" onClick={() => setPedido({
            titulo: 'Registrar aprobación de la política', ayuda: 'Hazlo solo con la aprobación formal de Dirección. A partir de aquí los tramos que cumplan sus condiciones se podrán habilitar.', boton: 'Registrar aprobación', ok: 'Política de liquidación aprobada',
            campos: [{ id: 'documento', label: 'Documento que la respalda *', minimo: 3 }, MOTIVO], ejecutar: (v) => api.aprobarPolitica(datos, v.documento, v.motivo),
          })}>Registrar aprobación</Button>}
          {aprueba && politica.aprobada && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPedido({ titulo: 'Revocar la aprobación', ayuda: 'Deja de poder habilitarse y pagarse cualquier tramo. Los pagos ya confirmados no cambian.', boton: 'Revocar', destructivo: true, ok: 'Aprobación revocada', campos: [MOTIVO], ejecutar: (v) => api.revocarPolitica(datos, v.motivo) })}>Revocar</Button>}
        </section>
      )}

      <details className="dashboard-card mb-4 p-4">
        <summary className="cursor-pointer text-xs font-semibold">¿Cómo funciona cada tramo y quién interviene?</summary>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[11px]">
            <thead className="bg-muted text-muted-foreground"><tr><th className="px-2 py-1.5 text-left font-medium">Tramo</th><th className="px-2 py-1.5 text-left font-medium">Condiciones</th></tr></thead>
            <tbody>
              <tr className="border-t border-border"><td className="px-2 py-1.5">1 · 50 %</td><td className="px-2 py-1.5">Promesa firmada, al menos 10 % del precio pagado (verificado en Cobranzas) y honorario recibido por Jarva.</td></tr>
              <tr className="border-t border-border"><td className="px-2 py-1.5">2 · 50 %</td><td className="px-2 py-1.5">Escritura o desembolso registrado en Contratos, y honorario recibido por Jarva.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Finanzas registra el honorario; Gerencia o administración habilita el tramo; Finanzas confirma el pago, y no puede hacerlo quien lo habilitó. El porcentaje se fija al firmar la venta y no cambia después. Si el contrato se anula, lo pagado queda por recuperar. Esta pantalla no reparte la comisión entre participantes: ese reparto sigue sin aprobarse.</p>
      </details>

      <section aria-labelledby="com-det" className="dashboard-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="com-det" className="text-sm font-semibold">Comisiones por venta</h2>
          <span className="text-xs text-muted-foreground">Porcentaje vigente: <b className="tabular-nums">{d ? `${d.porcentaje.toFixed(2)} %` : '—'}</b></span>
          {can('comisiones.calcular') && d && <Button size="xs" variant="outline" onClick={() => setPedido({
            titulo: 'Porcentaje de comisión base', ayuda: 'Se aplica a los contratos que aún no se firman. Las ventas firmadas conservan el porcentaje con que se firmaron.', boton: 'Guardar', ok: 'Porcentaje actualizado. Las ventas firmadas conservan el suyo.',
            campos: [{ id: 'pct', label: 'Porcentaje (%) *', tipo: 'monto', inicial: d.porcentaje.toFixed(2) }, MOTIVO], ejecutar: (v) => api.definirPorcentaje(datos, Number(v.pct.replace(',', '.')), v.motivo),
          })}><Pencil />Cambiar porcentaje</Button>}
          <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Filtrar por estado">
            {(['todas', 'calculada', 'pendiente', 'habilitada', 'pagada', 'anulada'] as Filtro[]).map((f) => (
              <Button key={f} size="xs" variant={filtro === f ? 'default' : 'ghost'} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>{f === 'todas' ? 'Todas' : ESTADO_TRAMO[f].label}</Button>
            ))}
          </div>
        </div>
        {d && lista.length === 0 && <p className="text-xs text-muted-foreground">{comisiones.length ? 'Ninguna comisión en este estado.' : 'Aún no hay contratos dentro de tu alcance.'}</p>}
        <ul className="grid gap-3">
          {lista.map((c) => (
            <li key={c.id} className="rounded-lg border border-border p-3" aria-label={`Comisión de ${c.contrato}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <b>{c.contrato}</b><span>{c.cliente}</span><span className="text-muted-foreground">Dpto. {dpt(c.unidad)}</span>
                <span className="text-muted-foreground">{fmtUsd(c.precioBase)} × {c.porcentaje.toFixed(2)} %</span>
                <b className="tabular-nums">{fmtUsd2(c.montoTotal)}</b>
                {c.ajustes !== 0 && <span className="tabular-nums text-muted-foreground">Ajustes: {fmtUsd2(c.ajustes)}</span>}
                {c.porRecuperar > 0 && <span className="font-medium tabular-nums text-rose-700">Por recuperar: {fmtUsd2(c.porRecuperar)}</span>}
                {c.estado === 'anulada' && <span className="text-muted-foreground">Contrato anulado{c.motivoAnulacion ? `: ${c.motivoAnulacion}` : ''}</span>}
                {aprueba && c.estado === 'vigente' && <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPedido({
                  titulo: 'Registrar ajuste', ayuda: `${c.contrato}. Usa un valor negativo para reducir. No cambia el porcentaje histórico ni los tramos.`, boton: 'Registrar ajuste', ok: 'Ajuste registrado',
                  campos: [{ id: 'monto', label: 'Monto del ajuste (USD) *', tipo: 'monto' }, MOTIVO, { id: 'evidencia', label: 'Documento de respaldo *', minimo: 3 }],
                  ejecutar: (v) => api.ajustar(datos, c.id, Number(v.monto.replace(',', '.')), v.motivo, v.evidencia),
                })}>Registrar ajuste</Button>}
              </div>
              {(c.asesor || c.corredor) && <p className="mt-0.5 text-[11px] text-muted-foreground">{c.asesor ? `Asesor: ${c.asesor}` : ''}{c.asesor && c.corredor ? ' · ' : ''}{c.corredor ? `Corredor: ${c.corredor}` : ''}</p>}

              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                {c.tramos.map((t) => (
                  <div key={t.id} className="grid gap-1.5 rounded-md bg-muted/50 p-2.5 text-[11px]" aria-label={`Tramo ${t.numero}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b>Tramo {t.numero} · {t.porcentaje.toFixed(0)} %</b><b className="tabular-nums">{fmtUsd2(t.monto)}</b>
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', ESTADO_TRAMO[t.estado].tono)}>{ESTADO_TRAMO[t.estado].label}</span>
                    </div>
                    {t.estado !== 'anulada' && t.estado !== 'pagada' && (
                      <ul className="grid gap-0.5">
                        {t.condiciones.map((x) => {
                          const Icono = x.ok ? CheckCircle2 : CircleDashed
                          return <li key={x.texto} className={cn('flex items-center gap-1', x.ok ? 'text-emerald-700' : 'text-muted-foreground')}><Icono className="size-3" aria-hidden="true" /><span>{x.texto}{x.ok ? '' : ' (falta)'}</span></li>
                        })}
                      </ul>
                    )}
                    {t.estado === 'pendiente' && t.cumple && !politica?.aprobada && <p className="font-medium text-amber-800">Condiciones cumplidas: falta la aprobación formal de la política.</p>}
                    {t.estado === 'habilitada' && !t.cumple && <p role="alert" className="font-medium text-rose-700">Se habilitó, pero dejó de cumplir una condición: no se puede pagar.</p>}
                    {t.estado === 'habilitada' && t.habilitadaPor === actor.id && finanzas && <p className="text-muted-foreground">Lo habilitaste tú: otra persona debe confirmar el pago.</p>}
                    {t.honorario && <p className="text-muted-foreground">Honorario: {fmtUsd2(t.honorario.monto)} · {fmtFechaCorta(t.honorario.fecha)} · {t.honorario.referencia}{t.honorario.monto < t.monto ? ' · menor que este tramo' : ''}</p>}
                    {t.habilitadaNombre && t.estado !== 'pagada' && <p className="text-muted-foreground">Habilitó {t.habilitadaNombre}</p>}
                    {t.pago && <p className="text-emerald-800">Pagado el {fmtFechaCorta(t.pago.fecha)}{t.pago.beneficiario ? ` a ${t.pago.beneficiario}` : ''}{t.pago.referencia ? ` · ${t.pago.referencia}` : ''}</p>}
                    <div className="flex flex-wrap gap-1.5 empty:hidden">{acciones(c, t)}</div>
                  </div>
                ))}
              </div>

              {c.movimientos.length > 0 && (
                <details className="mt-2 text-[11px]">
                  <summary className="cursor-pointer font-medium">Movimientos ({c.movimientos.length})</summary>
                  <ul className="mt-1.5 grid gap-1">
                    {c.movimientos.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center gap-x-2 rounded border border-border px-2 py-1">
                        <b>{TIPO_MOVIMIENTO[m.tipo]}</b><span className="tabular-nums">{fmtUsd2(m.monto)}</span>
                        <span className="text-muted-foreground">{m.motivo}{m.referencia ? ` · ${m.referencia}` : ''}{m.registradoNombre ? ` · ${m.registradoNombre}` : ''}</span>
                        {m.revertidoEn && <span className="text-rose-700">Reversado: {m.motivoReverso}</span>}
                        {m.recuperadoEn && <span className="text-emerald-700">Recuperado: {m.notaRecuperacion}</span>}
                        {m.tipo === 'por_recuperar' && !m.recuperadoEn && finanzas && <Button size="xs" variant="outline" className="ml-auto" onClick={() => setPedido({ titulo: 'Registrar recuperación', ayuda: `${fmtUsd2(-m.monto)} de ${c.contrato}. Deja constancia de cómo se recuperó; no mueve dinero.`, boton: 'Registrar recuperación', ok: 'Recuperación registrada', campos: [{ id: 'nota', label: 'Cómo se recuperó *', tipo: 'area', minimo: 5 }], ejecutar: (v) => api.registrarRecuperacion(datos, m.id, v.nota) })}>Registrar recuperación</Button>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>

      {pedido && <PedidoDialog pedido={pedido} onClose={() => setPedido(null)} onDone={async () => { await recargar(); setAviso(pedido.ok) }} />}
    </>
  )
}

function PedidoDialog({ pedido, onClose, onDone }: { pedido: Pedido; onClose: () => void; onDone: () => Promise<void> }) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(pedido.campos.map((c) => [c.id, c.inicial ?? ''])))
  const [confirmo, setConfirmo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const campoOk = (c: Campo) => {
    const v = (valores[c.id] ?? '').trim()
    if (c.tipo === 'monto') return v !== '' && Number.isFinite(Number(v.replace(',', '.')))
    return v.length >= (c.minimo ?? 1)
  }
  const valido = pedido.campos.every(campoOk) && (!pedido.confirmacion || confirmo)

  const enviar = async () => {
    setError(null); setEnviando(true)
    try {
      await pedido.ejecutar(Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, v.trim()])))
      await onDone()
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
        <DialogHeader>
          <DialogTitle>{pedido.titulo}</DialogTitle>
          <DialogDescription>{pedido.ayuda}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {pedido.campos.map((c) => (
            <div key={c.id} className="grid gap-1.5">
              <Label htmlFor={`com-${c.id}`} className="text-xs">{c.label}</Label>
              {c.tipo === 'area'
                ? <Textarea id={`com-${c.id}`} rows={2} value={valores[c.id]} onChange={(e) => setValores((v) => ({ ...v, [c.id]: e.target.value }))} />
                : <Input id={`com-${c.id}`} type={c.tipo === 'fecha' ? 'date' : 'text'} inputMode={c.tipo === 'monto' ? 'decimal' : undefined} value={valores[c.id]} onChange={(e) => setValores((v) => ({ ...v, [c.id]: e.target.value }))} />}
            </div>
          ))}
          {pedido.confirmacion && (
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} /><span>{pedido.confirmacion}</span></label>
          )}
          <FieldError>{error}</FieldError>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Volver</Button>
          <Button variant={pedido.destructivo ? 'destructive' : 'default'} disabled={!valido || enviando} onClick={() => void enviar()}>{enviando ? 'Guardando…' : pedido.boton}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Kpi({ t, v, d, tono }: { t: string; v: string; d: string; tono?: string }) {
  return (
    <div className="dashboard-card p-4">
      <div className="text-[11px] font-medium text-muted-foreground">{t}</div>
      <div className={cn('mt-1 text-lg font-semibold tabular-nums', tono)}>{v}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{d}</div>
    </div>
  )
}
