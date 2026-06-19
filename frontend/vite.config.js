import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    proxy: {
      // Any request starting with /api will be forwarded to your Express server
      '/api': {
        target: 'http://localhost:5000',  // your Express backend port
        changeOrigin: true,               // explained below
      },
    },
  },
})