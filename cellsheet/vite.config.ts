import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Cellsheet',
        short_name: 'Cellsheet',
        description: 'Open any CSV — from a link or a file — and read it the mobile way.',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
        // Android: offer Cellsheet in the system "Open with" list for CSV files.
        file_handlers: [
          {
            action: '/',
            accept: { 'text/csv': ['.csv'] },
          },
        ],
      },
    }),
  ],
})
