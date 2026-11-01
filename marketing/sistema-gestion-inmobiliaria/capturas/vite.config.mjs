// Abre las pantallas reales con la base demostrativa. `envDir` apunta aquí a propósito:
// sin las variables de Supabase del proyecto, esta vista no puede conectarse a producción.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(AQUI, '../../..')

export default defineConfig({
  root: RAIZ,
  envDir: AQUI,
  cacheDir: path.join(AQUI, '.vite'),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(RAIZ, 'src') } },
  server: { host: '127.0.0.1', port: 5177, strictPort: true, hmr: false, proxy: { '/demo-api': { target: 'http://127.0.0.1:5199', rewrite: () => '/' } } },
})
