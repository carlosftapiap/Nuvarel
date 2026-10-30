import { useState } from 'react'
import { Download } from 'lucide-react'
import { useConexion } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { copiaLocal, inventarioLocal } from '@/features/conexion/datosLocales'
import { fmtFechaCorta } from '@/features/financiamiento/plan'

/** Con Supabase conectado, avisa si este navegador guarda registros que ya no se muestran. Solo informa: no borra ni migra. */
export default function DatosLocalesAviso({ solo }: { solo: string }) {
  const { remoto } = useConexion()
  const [abierto, setAbierto] = useState(false)
  const [grupos] = useState(() => (remoto ? inventarioLocal() : []))
  const grupo = grupos.find((g) => g.clave === solo)
  if (!grupo) return null

  const descargar = () => {
    const url = URL.createObjectURL(new Blob([copiaLocal()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `amura-datos-locales-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>Este navegador guarda {grupo.registros.length} {grupo.titulo.toLowerCase()} de antes de conectar la base de datos. No se muestran aquí ni se han migrado.</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => setAbierto(true)}>Ver registros</Button>
      </div>
      {abierto && (
        <Dialog open onOpenChange={setAbierto}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Datos guardados solo en este navegador</DialogTitle>
              <DialogDescription>Revisa si deben conservarse. Nada se borra ni se envía desde aquí. Repite esta revisión en cada equipo y navegador que se haya usado.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              {grupos.map((g) => (
                <section key={g.clave} aria-label={g.titulo}>
                  <h3 className="text-sm font-semibold">{g.titulo}: {g.registros.length}</h3>
                  <p className="mb-1 text-[11px] text-muted-foreground">{g.desde ? `Del ${fmtFechaCorta(g.desde)} al ${fmtFechaCorta(g.hasta!)}` : 'Sin fechas'}</p>
                  <ul className="grid max-h-48 gap-1 overflow-auto rounded-lg border border-border p-2 text-xs">
                    {g.registros.map((r, i) => <li key={i}><b>{r.referencia || 'Sin referencia'}</b> · {r.detalle}{r.fecha ? ` · ${fmtFechaCorta(r.fecha)}` : ''}{r.usuario ? ` · ${r.usuario}` : ''}</li>)}
                  </ul>
                </section>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAbierto(false)}>Cerrar</Button>
              <Button onClick={descargar}><Download />Descargar copia</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
