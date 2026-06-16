import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

const VIEWER_API_ORIGIN = process.env.AGENT_PI_VIEWER_API_ORIGIN ?? 'http://127.0.0.1:8787'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  // Base path for production - assets go to /s/assets/* to avoid conflict with marketing site
  base: '/s/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Ensure all React imports resolve to the hoisted root node_modules
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    sourcemap: true,
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5174, // Different from Electron dev server
    open: true,
    proxy: {
      // Proxy API requests during local dev. Override with AGENT_PI_VIEWER_API_ORIGIN.
      '/s/api': {
        target: VIEWER_API_ORIGIN,
        changeOrigin: true,
        secure: VIEWER_API_ORIGIN.startsWith('https://'),
      },
    },
  },
})
