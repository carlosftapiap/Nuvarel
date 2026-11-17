import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Datos } from '@/features/conexion/datos'
import { FieldError } from '@/features/inventario/components/shared'
import { fmtUsd2 } from '@/features/inventario/pricing'

type Fila = Record<string, unknown>
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export interface SituacionReserva {
  id: string; codigo: string; cliente: string; departamento: string | null; estado: string; monto_reserva: number
  comprobantes: { reportados: number; confirmados: number; rechazados: number }
  contrato: { codigo: string; estado: string } | null; documentos: number; impedimentos: string[]; libera_departamento: boolean
}

interface Datos3 {
  reservas: { id: string; codigo: string; clienteId: string; cliente: string; depto: string; estado: string }[]
  ventas: { id: string; codigo: string; cliente: string; depto: string; estado: string }[]
  usuarios: { id: string; nombre: string; rol: string; email: string }[]
  historial: { id: string; tipo: string; motivo: string; actor: string; fecha: string; resultado: string }[]
}

const coincide = (q: string, ...campos: string[]) => !q || campos.some((c) => c.toLowerCase().includes(q))
const boton = 'h-10 w-full sm:w-auto'

/**
 * Configuración > Eliminaciones (solo administrador). Cancela reservas sin dinero, anula ventas conservando su historial
 * y desactiva usuarios reasignando su cartera. La base valida permisos, impedimentos y aplica todo o nada.
 */
export default function EliminacionesAdmin({ datos }: { datos: Datos }) {
  const { actor } = useSession()
  const [d, setD] = useState<Datos3 | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [resumen, setResumen] = useState<SituacionReserva[] | null>(null)
  const [accion, setAccion] = useState<{ tipo: 'reservas' } | { tipo: 'venta'; id: string; codigo: string } | { tipo: 'usuario'; id: string; nombre: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [evidencia, setEvidencia] = useState('')
  const [confirmo, setConfirmo] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const [res, con, cli, uds, per, his] = await Promise.all([
        datos.select<Fila>('reservations'), datos.select<Fila>('contracts').catch(() => []), datos.select<Fila>('clients'),
        datos.select<Fila>('inventory_units'), datos.select<Fila>('profiles'), datos.select<Fila>('admin_eliminaciones').catch(() => []),
      ])
      const cliente = new Map(cli.map((c) => [s(c.id), s(c.nombre)]))
      const depto = new Map(uds.map((u) => [s(u.codigo), s(u.dpt)]))
      const persona = new Map(per.map((p) => [s(p.id), s(p.nombre)]))
      setD({
        reservas: res.filter((r) => !['anulada', 'rechazada'].includes(s(r.estado))).map((r) => ({
          id: s(r.id), codigo: s(r.codigo), clienteId: s(r.client_id), cliente: cliente.get(s(r.client_id)) ?? 'Cliente', depto: depto.get(s(r.codigo_unidad)) ?? s(r.codigo_unidad), estado: s(r.estado),
        })),
        ventas: con.filter((c) => s(c.estado) !== 'anulado').map((c) => ({
          id: s(c.id), codigo: s(c.codigo), cliente: cliente.get(s(c.client_id)) ?? 'Cliente', depto: depto.get(s(c.codigo_unidad)) ?? s(c.codigo_unidad), estado: s(c.estado),
        })),
        usuarios: per.filter((p) => s(p.estado) === 'activo').map((p) => ({ id: s(p.id), nombre: s(p.nombre), rol: s(p.rol_id), email: s(p.email) })),
        historial: his.map((h) => ({ id: s(h.id), tipo: s(h.tipo), motivo: s(h.motivo), actor: s(h.actor_nombre) || persona.get(s(h.actor_id)) || '', fecha: s(h.fecha), resultado: JSON.stringify(h.resultado) }))
          .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 20),
      })
    } catch (e) { setError((e as Error).message) }
  }, [datos])
  useEffect(() => { void cargar() }, [cargar])

  const texto = q.trim().toLowerCase()
  const reservas = useMemo(() => (d?.reservas ?? []).filter((r) => coincide(texto, r.cliente, r.depto, r.codigo)), [d, texto])
  const ventas = useMemo(() => (d?.ventas ?? []).filter((v) => coincide(texto, v.cliente, v.depto, v.codigo)), [d, texto])
  const usuarios = useMemo(() => (d?.usuarios ?? []).filter((u) => u.id !== actor.id && coincide(texto, u.nombre, u.email, u.rol)), [d, texto, actor.id])
  const clienteSeleccion = new Set(reservas.filter((r) => seleccion.includes(r.id)).map((r) => r.clienteId))
  const impedidas = (resumen ?? []).filter((r) => r.impedimentos.length > 0)

  const limpiar = () => { setAccion(null); setResumen(null); setMotivo(''); setEvidencia(''); setConfirmo(false) }
  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    setEnviando(true); setError(null); setAviso(null)
    try { await fn(); setAviso(ok); limpiar(); setSeleccion([]); await cargar() } catch (e) { setError((e as Error).message) } finally { setEnviando(false) }
  }
  const revisar = async () => {
    setError(null)
    try {
      setResumen(await datos.rpc<SituacionReserva[]>('admin_eliminaciones_revisar', { p_reservas: seleccion }))
      setAccion({ tipo: 'reservas' }); setConfirmo(false)
    } catch (e) { setError((e as Error).message) }
  }
  const motivoValido = motivo.trim().length >= 10

  return (
    <section aria-labelledby="el-tit" className="grid gap-5">
      <div>
        <h2 id="el-tit" className="text-base font-semibold">Eliminaciones administrativas</h2>
        <p className="text-sm text-muted-foreground">Solo el administrador. Nada se borra: las reservas y ventas quedan anuladas con su historial, y los usuarios, desactivados. Las reservas con dinero siguen el procedimiento de desistimiento.</p>
      </div>
      <div className="grid gap-1.5 sm:max-w-md">
        <Label htmlFor="el-buscar" className="text-xs">Buscar por cliente, usuario, departamento, reserva o venta</Label>
        <Input id="el-buscar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: A103, RES-2026, nombre del cliente" />
      </div>
      <FieldError>{error}</FieldError>
      {aviso && <p role="status" className="text-sm font-medium text-emerald-800">{aviso}</p>}

      {accion?.tipo === 'reservas' && resumen ? (
        <div className="grid gap-3 rounded-xl border bg-white p-4">
          <h3 className="text-sm font-semibold">Resumen antes de cancelar · {resumen[0]?.cliente}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr>
                <th className="py-2 pr-2 text-left font-medium">Reserva</th><th className="py-2 pr-2 text-left font-medium">Departamento</th><th className="py-2 pr-2 text-left font-medium">Estado</th>
                <th className="py-2 pr-2 text-left font-medium">Comprobantes</th><th className="py-2 pr-2 text-left font-medium">Contrato o promesa</th><th className="py-2 text-left font-medium">Resultado</th>
              </tr></thead>
              <tbody>
                {resumen.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="py-2 pr-2 font-medium">{r.codigo}<div className="text-muted-foreground">{fmtUsd2(Number(r.monto_reserva))}</div></td>
                    <td className="py-2 pr-2">{r.departamento}</td>
                    <td className="py-2 pr-2">{r.estado}</td>
                    <td className="py-2 pr-2">{r.comprobantes.reportados} reportados · {r.comprobantes.confirmados} confirmados · {r.comprobantes.rechazados} rechazados</td>
                    <td className="py-2 pr-2">{r.contrato ? `${r.contrato.codigo} (${r.contrato.estado})` : 'No'}{r.documentos > 0 && <div>{r.documentos} documento(s)</div>}</td>
                    <td className="py-2">{r.impedimentos.length === 0
                      ? <span className="font-medium text-emerald-800">Se cancela y {r.departamento} queda disponible</span>
                      : <ul className="grid gap-1 text-amber-900">{r.impedimentos.map((i) => <li key={i}>{i}</li>)}</ul>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {impedidas.length > 0 ? (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">No se puede cancelar esta selección: {impedidas.length} reserva(s) tienen impedimentos. Quítalas de la selección y gestiónalas por desistimiento o con Finanzas. No se cancela nada a medias.</p>
          ) : (
            <Confirmacion motivo={motivo} setMotivo={setMotivo} confirmo={confirmo} setConfirmo={setConfirmo}
              texto={`Cancelar ${resumen.length} reserva(s) y dejar disponibles: ${resumen.map((r) => r.departamento).join(', ')}.`} />
          )}
          <div className="grid gap-2 sm:flex">
            {impedidas.length === 0 && <Button className={boton} disabled={enviando || !motivoValido || !confirmo}
              onClick={() => void ejecutar(() => datos.rpc('admin_cancelar_reservas', { p_ids: seleccion, p_motivo: motivo.trim() }), `${resumen.length} reserva(s) canceladas. Los departamentos quedaron disponibles.`)}>Cancelar reservas</Button>}
            <Button className={boton} variant="outline" disabled={enviando} onClick={limpiar}>Volver</Button>
          </div>
        </div>
      ) : accion?.tipo === 'venta' ? (
        <div className="grid gap-3 rounded-xl border bg-white p-4">
          <h3 className="text-sm font-semibold">Anular la venta {accion.codigo}</h3>
          <p className="text-sm text-muted-foreground">Se conservan los pagos y las cuotas como historial. Se cancelan los compromisos y avisos pendientes. El departamento no se libera: la reserva con dinero se resuelve por desistimiento.</p>
          <div className="grid gap-1.5"><Label htmlFor="el-evidencia" className="text-xs">Documento que respalda la anulación (obligatorio si está firmada)</Label>
            <Input id="el-evidencia" value={evidencia} onChange={(e) => setEvidencia(e.target.value)} placeholder="Ej.: acta de anulación del 17/11/2026" /></div>
          <Confirmacion motivo={motivo} setMotivo={setMotivo} confirmo={confirmo} setConfirmo={setConfirmo} texto={`Anular la venta ${accion.codigo}.`} />
          <div className="grid gap-2 sm:flex">
            <Button className={boton} disabled={enviando || !motivoValido || !confirmo}
              onClick={() => void ejecutar(() => datos.rpc('admin_anular_venta', { p_contract: accion.id, p_motivo: motivo.trim(), p_evidencia: evidencia.trim() }), `Venta ${accion.codigo} anulada. Su historial se conserva.`)}>Anular venta</Button>
            <Button className={boton} variant="outline" disabled={enviando} onClick={limpiar}>Volver</Button>
          </div>
        </div>
      ) : accion?.tipo === 'usuario' ? (
        <div className="grid gap-3 rounded-xl border bg-white p-4">
          <h3 className="text-sm font-semibold">Desactivar a {accion.nombre}</h3>
          <p className="text-sm text-muted-foreground">Pierde el acceso de inmediato. Sus clientes y negociaciones abiertas quedan sin vendedor, con toda su información, en la lista «Sin vendedor» para asignarlos después. Nada se borra.</p>
          <Confirmacion motivo={motivo} setMotivo={setMotivo} confirmo={confirmo} setConfirmo={setConfirmo} texto={`Desactivar usuario y dejar sus clientes sin asignar (${accion.nombre}).`} />
          <div className="grid gap-2 sm:flex">
            <Button className={boton} disabled={enviando || !motivoValido || !confirmo}
              onClick={() => void ejecutar(() => datos.rpc('admin_desactivar_usuario', { p_user: accion.id, p_motivo: motivo.trim() }), `${accion.nombre} quedó desactivado. Sus clientes están sin asignar.`)}>Desactivar usuario y dejar sus clientes sin asignar</Button>
            <Button className={boton} variant="outline" disabled={enviando} onClick={limpiar}>Volver</Button>
          </div>
        </div>
      ) : (
        <>
          <Bloque titulo="Reservas" vacio="No hay reservas activas que coincidan.">
            {reservas.map((r) => (
              <label key={r.id} className="flex items-center gap-3 border-t border-border py-2 text-sm first:border-t-0">
                <input type="checkbox" className="h-4 w-4" checked={seleccion.includes(r.id)}
                  onChange={(e) => setSeleccion(e.target.checked ? [...seleccion, r.id] : seleccion.filter((x) => x !== r.id))} />
                <span className="min-w-0 flex-1"><b>{r.codigo}</b> · {r.cliente} · {r.depto}</span>
                <span className="text-xs text-muted-foreground">{r.estado}</span>
              </label>
            ))}
            {seleccion.length > 0 && (
              <div className="grid gap-2 pt-2 sm:flex sm:items-center">
                <Button className={boton} disabled={clienteSeleccion.size !== 1} onClick={() => void revisar()}>Revisar cancelación ({seleccion.length})</Button>
                {clienteSeleccion.size > 1 && <span className="text-xs text-amber-900">Elige reservas de un solo cliente.</span>}
              </div>
            )}
          </Bloque>
          <Bloque titulo="Ventas" vacio="No hay ventas vigentes que coincidan.">
            {ventas.map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2 text-sm first:border-t-0">
                <span className="min-w-0 flex-1"><b>{v.codigo}</b> · {v.cliente} · {v.depto} · {v.estado}</span>
                <Button className="h-9" variant="outline" onClick={() => { limpiar(); setAccion({ tipo: 'venta', id: v.id, codigo: v.codigo }) }}>Anular venta</Button>
              </div>
            ))}
          </Bloque>
          <Bloque titulo="Usuarios" vacio="No hay usuarios activos que coincidan.">
            {usuarios.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 border-t border-border py-2 text-sm first:border-t-0">
                <span className="min-w-0 flex-1"><b>{u.nombre}</b> · {u.rol} · {u.email}</span>
                <Button className="h-9" variant="outline" onClick={() => { limpiar(); setAccion({ tipo: 'usuario', id: u.id, nombre: u.nombre }) }}>Desactivar</Button>
              </div>
            ))}
          </Bloque>
          {(d?.historial.length ?? 0) > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Historial de eliminaciones ({d!.historial.length})</summary>
              <ul className="mt-2 grid gap-1">{d!.historial.map((h) => <li key={h.id}>{new Date(h.fecha).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })} · {h.tipo} · {h.actor} · {h.motivo}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function Bloque({ titulo, vacio, children }: { titulo: string; vacio: string; children: React.ReactNode }) {
  const hijos = Array.isArray(children) ? children.flat().filter(Boolean) : children
  const vacioReal = Array.isArray(hijos) && (hijos as unknown[]).length === 0
  return (
    <div className="grid gap-1 rounded-xl border bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold">{titulo}</h3>
      {vacioReal ? <p className="text-sm text-muted-foreground">{vacio}</p> : children}
    </div>
  )
}

function Confirmacion({ motivo, setMotivo, confirmo, setConfirmo, texto }: { motivo: string; setMotivo: (v: string) => void; confirmo: boolean; setConfirmo: (v: boolean) => void; texto: string }) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-1.5"><Label htmlFor="el-motivo" className="text-xs">Motivo (mínimo 10 caracteres) *</Label>
        <textarea id="el-motivo" className="min-h-20 rounded-md border border-border bg-white p-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} /></div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} /><span>Confirmo: {texto} Queda registrado con mi usuario y la fecha.</span></label>
    </div>
  )
}
