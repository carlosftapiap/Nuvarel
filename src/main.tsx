import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorPantalla, { recargarSiCambioVersion } from './components/ErrorPantalla'
import { TooltipProvider } from './components/ui/tooltip'

window.addEventListener('vite:preloadError', recargarSiCambioVersion)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorPantalla>
      <TooltipProvider delayDuration={200}>
        <App />
      </TooltipProvider>
    </ErrorPantalla>
  </StrictMode>,
)
