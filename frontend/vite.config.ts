import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // In dev mode the SW is disabled by default — that's correct behaviour.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icon.svg'],
      manifest: {
        name: 'EMS Dashboard',
        short_name: 'EMS',
        description: 'Virtual EMS Inverter Simulator — Smart Home Energy Dashboard',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            // Maskable variant: same SVG, used by Android adaptive icons.
            // Replace with a proper maskable PNG (512×512, safe area inside
            // 40% inset) for the best result on all launchers.
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Custom Web Push handlers (push + notificationclick) live in
        // public/push-sw.js and are pulled into the generated SW.
        importScripts: ['push-sw.js'],
        // Pre-cache the entire app shell on install.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        // Don't cache HA API / WS calls — they must always go to the network.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') ||
              url.pathname.startsWith('/auth/') ||
              url.protocol === 'wss:',
            handler: 'NetworkOnly',
          },
          // Open-Meteo weather forecast — stale-while-revalidate (1h TTL).
          {
            urlPattern: ({ url }) => url.hostname === 'api.open-meteo.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'open-meteo-cache',
              expiration: { maxAgeSeconds: 3600 },
            },
          },
        ],
        // SPA fallback so deep links work offline.
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
