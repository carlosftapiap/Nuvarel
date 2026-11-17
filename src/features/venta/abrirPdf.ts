/**
 * Abre un PDF en otra pestaña. La pestaña se abre dentro del clic, antes de generar el archivo,
 * para que el navegador no la bloquee. El PDF se muestra en un marco que ocupa toda la pestaña.
 * Si la generación falla, la pestaña se cierra y el error llega a quien llama.
 */
export async function abrirPdf(titulo: string, generar: () => Promise<Uint8Array>): Promise<void> {
  const ventana = window.open('', '_blank')
  if (!ventana) throw new Error('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio y vuelve a intentarlo.')
  ventana.document.title = titulo
  ventana.document.body.style.margin = '0'
  ventana.document.body.textContent = 'Preparando el documento…'
  try {
    const bytes = await generar()
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }))
    const marco = ventana.document.createElement('iframe')
    marco.src = url
    marco.title = titulo
    marco.style.cssText = 'border:0;width:100vw;height:100vh;display:block'
    ventana.document.body.textContent = ''
    ventana.document.body.appendChild(marco)
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000)
  } catch (e) {
    ventana.close()
    throw e
  }
}
