import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  base: '/miditar/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        navigateFallback: '/miditar/index.html',
        navigateFallbackDenylist: [/^\/miditar\/desktop\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://nbrosowsky.github.io',
            handler: 'CacheFirst',
            options: {
              cacheName: 'miditar-instrument-samples',
              expiration: {
                maxEntries: 96,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://cdn.jsdelivr.net' ||
              (url.origin === 'https://api.github.com' && url.pathname.includes('/repos/santismo/miditar/')),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'miditar-example-midi',
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        desktop: resolve(rootDir, 'desktop/index.html'),
      },
    },
  },
})
