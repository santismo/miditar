import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

function offlineHtml(): Plugin {
  return {
    name: 'miditar-offline-html',
    transformIndexHtml(html) {
      return html
        .replace('content="Miditar"', 'content="Miditar Offline"')
        .replace('site.webmanifest', 'miditar-offline.webmanifest')
        .replace('<title>Miditar</title>', '<title>Miditar Offline</title>')
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'
  const input: Record<string, string> = offline
    ? { main: resolve(rootDir, 'index.html') }
    : {
        main: resolve(rootDir, 'index.html'),
        desktop: resolve(rootDir, 'desktop/index.html'),
      }

  return {
    base: offline ? './' : '/miditar/',
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/spessasynth_lib/dist/spessasynth_processor.min.js',
            dest: '.',
            rename: { stripBase: true },
          },
        ],
      }),
      ...(offline ? [offlineHtml()] : []),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
        manifest: false,
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: [
            offline
              ? '**/*.{js,css,html,ico,png,svg,webmanifest,woff2,mid,midi,json}'
              : '**/*.{js,css,html,ico,png,svg,webmanifest,woff2}',
          ],
          navigateFallback: offline ? 'index.html' : '/miditar/index.html',
          navigateFallbackDenylist: offline ? [] : [/^\/miditar\/desktop\//],
          runtimeCaching: offline
            ? []
            : [
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
                    url.origin === 'https://raw.githubusercontent.com' ||
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
        input,
      },
    },
  }
})
