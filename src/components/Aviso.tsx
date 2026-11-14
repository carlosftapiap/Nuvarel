import { useEffect } from 'react'
import { CheckCircle2, X } from 'lucide-react'

/** Confirmación breve de una acción. Flota sobre la pantalla (encima de la barra inferior en el celular) y se cierra sola. */
export default function Aviso({ texto, onClose }: { texto: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!texto) return
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [texto, onClose])
  if (!texto) return null
  return (
    <p role="status" className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-start gap-2.5 rounded-xl bg-[#101828] px-4 py-3 text-[13.5px] text-white shadow-[0_12px_32px_#1018284d] md:inset-x-auto md:bottom-6 md:right-6">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
      <span className="min-w-0 flex-1">{texto}</span>
      <button type="button" className="rounded p-0.5 text-slate-300 hover:text-white" aria-label="Cerrar aviso" onClick={onClose}><X className="size-4" /></button>
    </p>
  )
}
