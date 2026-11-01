import { Component, type ReactNode } from 'react'

const CLAVE_RECARGA = 'amura-recarga-version'

/** Tras publicar una versión nueva, una pestaña abierta pide archivos que ya no existen: se recarga una sola vez. */
export function recargarSiCambioVersion(evento: Event) {
  if (sessionStorage.getItem(CLAVE_RECARGA)) return
  sessionStorage.setItem(CLAVE_RECARGA, '1')
  evento.preventDefault()
  window.location.reload()
}

/** Un error de pantalla muestra un aviso con salida, nunca una página en blanco. */
export default class ErrorPantalla extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError() {
    return { fallo: true }
  }

  componentDidMount() {
    sessionStorage.removeItem(CLAVE_RECARGA)
  }

  render() {
    if (!this.state.fallo) return this.props.children
    return (
      <div role="alert" className="grid min-h-svh place-content-center gap-4 p-6 text-center">
        <h1 className="text-lg font-semibold">No se pudo abrir esta pantalla</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Revisa tu conexión a internet y vuelve a intentarlo. Tus datos no se han perdido.</p>
        <button type="button" className="justify-self-center rounded-full border px-4 py-2 text-sm font-medium" onClick={() => window.location.assign('/')}>Volver a cargar</button>
      </div>
    )
  }
}
