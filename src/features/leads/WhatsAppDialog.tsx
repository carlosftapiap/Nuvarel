import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { enlaceWhatsApp, mensajeWhatsApp } from './remoto'

/**
 * Abre el WhatsApp del vendedor con el número del cliente y un mensaje editable. AMURA no envía nada ni guarda la conversación.
 * Abrir WhatsApp no cuenta como contacto: se registra solo si el vendedor confirma que se comunicó.
 */
export default function WhatsAppDialog({ cliente, telefono, vendedor, onClose, onContactado }: {
  cliente: string; telefono: string; vendedor: string; onClose: () => void; onContactado: () => Promise<boolean>
}) {
  const [mensaje, setMensaje] = useState(() => mensajeWhatsApp(cliente, vendedor))
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const url = enlaceWhatsApp(telefono, mensaje.trim())
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contactar por WhatsApp</DialogTitle>
          <DialogDescription>Se abre tu WhatsApp con el número de {cliente}. AMURA no envía mensajes ni guarda la conversación.</DialogDescription>
        </DialogHeader>
        {!abierto ? (
          <div className="grid gap-1.5">
            <Label htmlFor="wa-msg" className="text-xs">Mensaje inicial (puedes editarlo)</Label>
            <Textarea id="wa-msg" rows={5} value={mensaje} onChange={(e) => setMensaje(e.target.value)} />
            {!url && <p className="text-xs text-rose-700">El celular del cliente no es válido para WhatsApp.</p>}
          </div>
        ) : (
          <p className="text-sm">¿Pudiste comunicarte con {cliente}? Solo si respondes que sí, queda registrado el contacto.</p>
        )}
        <DialogFooter>
          {!abierto ? (
            <>
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              {url
                ? <Button asChild><a href={url} target="_blank" rel="noopener noreferrer" onClick={() => setAbierto(true)}><MessageCircle />Abrir WhatsApp</a></Button>
                : <Button disabled><MessageCircle />Abrir WhatsApp</Button>}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Todavía no</Button>
              <Button disabled={enviando} onClick={async () => { setEnviando(true); if (await onContactado()) onClose(); setEnviando(false) }}>Sí, registrar el contacto</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
