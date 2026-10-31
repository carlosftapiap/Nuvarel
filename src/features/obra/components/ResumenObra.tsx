import type { Almacen } from '../almacen'
import type { Evidencia, ResumenFrente } from '../model'
import { Anillo } from './Graficos'
import { ListaEvidencias } from './Evidencias'
import { fechaCorta } from './ui'

/** Avance actual para quien solo consulta: anillos por frente, sin actividades ni notas internas. */
export default function ResumenObra({ resumen, documentos, almacen }: { resumen: ResumenFrente[]; documentos: Evidencia[] | null; almacen: Almacen }) {
  const nombre = new Map(resumen.map((r) => [r.frenteId, r.nombre]))
  const ultimo = resumen.reduce<string | null>((m, r) => (r.ultimoCorte && (!m || r.ultimoCorte > m) ? r.ultimoCorte : m), null)
  return (
    <div className="grid gap-4">
      <section className="dashboard-card" aria-labelledby="res-titulo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="res-titulo" className="text-sm font-semibold">Avance de la construcción</h2>
          <span className="text-xs text-muted-foreground">Último registro: <b>{fechaCorta(ultimo)}</b></span>
        </div>
        <div className="mt-4 grid grid-cols-2 justify-items-center gap-6 md:grid-cols-4">
          {resumen.map((r) => (
            <Anillo key={r.frenteId} valor={r.avanceValidado} etiqueta={r.nombre} sublabel={r.actividades ? `${r.actividadesConAvance} de ${r.actividades} con avance` : 'sin etapas'} />
          ))}
        </div>
      </section>
      {documentos !== null && (
        <section className="dashboard-card" aria-labelledby="res-docs">
          <h2 id="res-docs" className="text-sm font-semibold">Informes, actas y planos</h2>
          <div className="mt-3"><ListaEvidencias evidencias={documentos} etiquetaActividad={(e) => nombre.get(e.frenteId) ?? 'Obra'} almacen={almacen} puedeRetirar={false} mostrarRetiradas={false} /></div>
        </section>
      )}
    </div>
  )
}
