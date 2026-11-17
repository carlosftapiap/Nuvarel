import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Datos } from '@/features/conexion/datos'
import { useInventory } from '@/features/inventario/store'
import type { Edificio, Piso } from '@/features/inventario/types'
import { cargarPlano, eliminarPlano, ESTADO_PLANO, leerUnidades, listarPlanos, PISOS, nombrePiso, planoVigente, revisarNuevoPlano, ubicacion, verPlano, type Plano, type TipoPlano } from './planos'

const campo = 'h-10 w-full rounded-md border border-border bg-white px-2 text-sm'
const boton = 'h-10 w-full sm:w-auto'
const COLOR_ESTADO: Record<Plano['estado'], string> = {
  en_revision: 'bg-amber-50 text-amber-900',
  pendiente_aprobacion: 'bg-slate-100 text-slate-800',
  publicado: 'bg-emerald-50 text-emerald-800',
  reemplazado: 'bg-slate-50 text-slate-500',
  rechazado: 'bg-slate-50 text-slate-500',
  eliminado: 'bg-slate-50 text-slate-500',
}

/**
 * Configuración > Planos. Solo administradores (permiso config.planos).
 * Cargar un PDF sin inconsistencias lo deja disponible para vendedores y supervisores al instante.
 * Reemplazar o eliminar piden confirmación. Con inconsistencias, el plano queda bloqueado.
 */
export default function ConfigPlanos({ datos }: { datos: Datos }) {
  const { state: inv } = useInventory()
  const [planos, setPlanos] = useState<Plano[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)

  const [tipo, setTipo] = useState<TipoPlano>('piso')
  const [edificio, setEdificio] = useState<Edificio>(1)
  const [piso, setPiso] = useState<Piso>('PB')
  const [unidad, setUnidad] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [entrada, setEntrada] = useState(0) // reinicia el selector de archivo tras cargar
  const selector = useRef<HTMLInputElement>(null)
  const [avanzado, setAvanzado] = useState(false)
  const [nivel, setNivel] = useState('')
  const [unidadesTxt, setUnidadesTxt] = useState('')
  const [confirmarReemplazo, setConfirmarReemplazo] = useState<Plano | null>(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState<string | null>(null)

  const cargar = () => { listarPlanos(datos).then(setPlanos).catch((e: Error) => setError(e.message)) }
  useEffect(cargar, [datos]) // eslint-disable-line react-hooks/exhaustive-deps

  const unidadesPiso = useMemo(() => inv.units.filter((u) => u.edificio === edificio && u.piso === piso).sort((a, b) => a.dpt.localeCompare(b.dpt)), [inv.units, edificio, piso])
  const dptDe = (codigo: string | null) => inv.units.find((u) => u.codigo === codigo)?.dpt ?? ''
  const nombrePlano = (p: Plano) => (p.tipo === 'unidad' ? `Plano del departamento ${dptDe(p.unidadCodigo)}` : 'Plano de planta del piso')

  const cambiarUbicacion = (fn: () => void) => { fn(); setConfirmarReemplazo(null) }

  const ejecutar = async (clave: string, fn: () => Promise<void>) => {
    setTrabajando(clave); setError(null); setAviso(null)
    try { await fn() } catch (e) { setError((e as Error).message) }
    setTrabajando(null)
  }

  const nuevoPlano = () => ({
    tipo, edificio, piso, unidadCodigo: tipo === 'unidad' ? unidad || null : null, archivo,
    nivelEnPlano: avanzado ? nivel : '', unidadesEnPlano: avanzado ? leerUnidades(unidadesTxt) : [],
  })

  /** Primer clic: valida y, si ya hay un plano disponible en esa ubicación, pide confirmación antes de reemplazarlo. */
  const subir = (reemplazar: boolean) => ejecutar('subir', async () => {
    const nuevo = nuevoPlano()
    const errores = revisarNuevoPlano(nuevo)
    if (errores.length) throw new Error(errores.join(' '))
    const vigente = planoVigente(planos ?? [], nuevo)
    if (vigente && !reemplazar) { setConfirmarReemplazo(vigente); return }
    const r = await cargarPlano(datos, { ...nuevo, archivo: archivo! }, reemplazar)
    setConfirmarReemplazo(null)
    if (r.estado === 'publicado') {
      setAviso(vigente ? 'Plano reemplazado. Los vendedores ya ven el nuevo.' : 'Plano cargado. Ya está disponible para vendedores y supervisores.')
    } else {
      setError(`Plano bloqueado: no está disponible para vendedores. ${r.inconsistencias.join(' ')} Revisa el archivo con la constructora o elimínalo.`)
    }
    setArchivo(null); setEntrada((n) => n + 1); setNivel(''); setUnidadesTxt('')
    cargar()
  })

  const activos = (planos ?? []).filter((p) => p.estado === 'publicado' || p.estado === 'en_revision' || p.estado === 'pendiente_aprobacion')
  const historial = (planos ?? []).filter((p) => !activos.includes(p))

  return (
    <section aria-labelledby="planos-tit" className="grid gap-6">
      <div>
        <h2 id="planos-tit" className="text-base font-semibold">Planos</h2>
        <p className="text-sm text-muted-foreground">Carga el plano de planta de cada piso y, cuando exista, el plano de cada departamento. Al cargarlo queda disponible para vendedores y supervisores, salvo que tenga inconsistencias con el inventario.</p>
      </div>

      <div className="grid gap-4 rounded-xl border bg-white p-4">
        <h3 className="text-sm font-semibold">Cargar plano</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium">Tipo de plano
            <select className={campo} value={tipo} onChange={(e) => cambiarUbicacion(() => { setTipo(e.target.value as TipoPlano); setUnidad('') })}>
              <option value="piso">Plano de planta del piso</option>
              <option value="unidad">Plano de un departamento</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Edificio
            <select className={campo} value={edificio} onChange={(e) => cambiarUbicacion(() => { setEdificio(Number(e.target.value) as Edificio); setUnidad('') })}>
              <option value={1}>Edificio A</option>
              <option value={2}>Edificio B</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Piso
            <select className={campo} value={piso} onChange={(e) => cambiarUbicacion(() => { setPiso(e.target.value as Piso); setUnidad('') })}>
              {PISOS.map((p) => <option key={p} value={p}>{nombrePiso(p)}</option>)}
            </select>
          </label>
        </div>

        {tipo === 'unidad' ? (
          <label className="grid gap-1 text-sm font-medium">Departamento
            <select className={campo} value={unidad} onChange={(e) => cambiarUbicacion(() => setUnidad(e.target.value))}>
              <option value="">Elige el departamento</option>
              {unidadesPiso.map((u) => <option key={u.codigo} value={u.codigo}>{u.dpt}</option>)}
            </select>
          </label>
        ) : (
          <div className="grid gap-1">
            <p className="text-sm font-medium">Departamentos de {ubicacion(edificio, piso)}</p>
            <p className="text-sm text-slate-700">{unidadesPiso.map((u) => u.dpt).join(' · ') || 'Este piso no tiene unidades en el inventario.'}</p>
          </div>
        )}

        <div className="grid gap-2">
          <p className="text-sm font-medium">Archivo PDF</p>
          <input key={entrada} ref={selector} type="file" accept="application/pdf" className="sr-only" tabIndex={-1} aria-label="Archivo PDF del plano"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setError(null) }} />
          <div className="grid gap-2 sm:flex sm:items-center sm:gap-3">
            <Button type="button" className={boton} disabled={!!trabajando} onClick={() => selector.current?.click()}>
              {archivo ? 'Cambiar PDF' : 'Seleccionar PDF'}
            </Button>
            <p className="min-w-0 break-words text-sm text-slate-700">{archivo ? archivo.name : 'Aún no seleccionas un archivo.'}</p>
          </div>
        </div>

        <div className="grid gap-3">
          <button type="button" aria-expanded={avanzado} className="w-fit text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => setAvanzado((v) => !v)}>
            {avanzado ? 'Quitar numeración del plano' : 'Registrar la numeración original del plano (opcional)'}
          </button>
          {avanzado && (
            <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-muted-foreground">Escribe el nivel y las unidades tal como aparecen en el PDF. La app los compara con el inventario: si no coinciden, el plano queda bloqueado y no llega a los vendedores.</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <label className="grid gap-1 text-sm font-medium">Nivel escrito en el plano
                  <input className={campo} value={nivel} onChange={(e) => setNivel(e.target.value)} placeholder="Ej.: PB o P-3" maxLength={20} />
                </label>
                <label className="grid gap-1 text-sm font-medium">Unidades escritas en el plano
                  <input className={campo} value={unidadesTxt} onChange={(e) => setUnidadesTxt(e.target.value)} placeholder="Ej.: B-101, B-102" />
                </label>
              </div>
            </div>
          )}
        </div>

        {confirmarReemplazo ? (
          <div role="alertdialog" aria-label="Confirmar reemplazo" className="grid gap-3 rounded-lg bg-slate-50 p-3">
            <p className="text-sm">Ya hay un plano disponible para {confirmarReemplazo.tipo === 'unidad' ? `el departamento ${dptDe(confirmarReemplazo.unidadCodigo)}` : ubicacion(confirmarReemplazo.edificio, confirmarReemplazo.piso)}: <span className="font-medium">{confirmarReemplazo.archivoNombre}</span>. ¿Quieres reemplazarlo por {archivo?.name}?</p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button className={boton} disabled={!!trabajando} onClick={() => void subir(true)}>{trabajando === 'subir' ? 'Reemplazando…' : 'Reemplazar plano'}</Button>
              <Button className={boton} disabled={!!trabajando} onClick={() => setConfirmarReemplazo(null)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div>
            <Button className={boton} disabled={!!trabajando || !archivo} onClick={() => void subir(false)}>{trabajando === 'subir' ? 'Cargando…' : 'Cargar plano'}</Button>
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      {aviso && <p role="status" className="text-sm font-medium text-slate-800">{aviso}</p>}

      <div className="grid gap-3">
        <h3 className="text-sm font-semibold">Planos cargados</h3>
        {planos === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {planos !== null && activos.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay planos cargados.</p>}
        {activos.map((p) => (
          <article key={p.id} className="grid gap-3 rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{nombrePlano(p)} · {ubicacion(p.edificio, p.piso)}</p>
                <p className="break-words text-xs text-muted-foreground">
                  {p.archivoNombre} · {p.paginas} pág.
                  {(p.nivelEnPlano || p.unidadesEnPlano.length > 0) && ` · numeración del plano: ${[p.nivelEnPlano, p.unidadesEnPlano.join(', ')].filter(Boolean).join(' · ')}`}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COLOR_ESTADO[p.estado]}`}>{ESTADO_PLANO[p.estado]}</span>
            </div>
            {p.estado !== 'publicado' && (
              <div className="grid gap-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-semibold">No está disponible para vendedores.</p>
                {p.inconsistencias.length > 0 && <ul className="grid gap-1">{p.inconsistencias.map((i) => <li key={i}>{i}</li>)}</ul>}
              </div>
            )}

            {confirmarEliminar === p.id ? (
              <div role="alertdialog" aria-label="Confirmar eliminación" className="grid gap-3 rounded-lg bg-slate-50 p-3">
                <p className="text-sm">¿Eliminar {nombrePlano(p).toLowerCase()} de {ubicacion(p.edificio, p.piso)}? {p.estado === 'publicado' ? 'Los vendedores dejarán de verlo.' : ''} El archivo se conserva en el historial interno.</p>
                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button className={boton} disabled={!!trabajando} onClick={() => void ejecutar(`del-${p.id}`, async () => {
                    await eliminarPlano(datos, p.id); setConfirmarEliminar(null); setAviso('Plano eliminado.'); cargar()
                  })}>Confirmar eliminación</Button>
                  <Button className={boton} disabled={!!trabajando} onClick={() => setConfirmarEliminar(null)}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:flex sm:flex-wrap">
                <Button className={boton} disabled={!!trabajando} onClick={() => void ejecutar(`ver-${p.id}`, () => verPlano(p))}>Ver PDF</Button>
                <Button className={boton} disabled={!!trabajando} onClick={() => setConfirmarEliminar(p.id)}>Eliminar</Button>
              </div>
            )}
          </article>
        ))}

        {historial.length > 0 && (
          <div className="grid gap-2">
            <button type="button" className="w-fit text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={() => setVerHistorial((v) => !v)}>
              {verHistorial ? 'Ocultar historial' : `Ver historial (${historial.length})`}
            </button>
            {verHistorial && historial.map((p) => (
              <p key={p.id} className="text-xs text-muted-foreground">
                {ESTADO_PLANO[p.estado]} · {nombrePlano(p)} · {ubicacion(p.edificio, p.piso)} · {p.archivoNombre}{p.motivoRechazo ? ` · ${p.motivoRechazo}` : ''}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
