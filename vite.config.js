import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './', // caminhos relativos: o build roda na raiz ou em qualquer subpasta
  worker: { format: 'es' },
})
