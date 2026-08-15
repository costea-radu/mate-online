import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' = la fiecare deploy pe Vercel, aplicația instalată se
      // actualizează singură la următoarea deschidere. O singură acțiune: git push.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'ExamenMate – Matematică pentru Succes',
        short_name: 'ExamenMate',
        description: 'Exerciții de matematică, teste pentru Evaluarea Națională și Bacalaureat. PDF-uri, exerciții interactive și profesor virtual AI.',
        lang: 'ro',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1a3a5c',
        theme_color: '#1a3a5c',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Evaluarea Națională', url: '/evaluare-nationala', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Bacalaureat', url: '/bacalaureat', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Profesor Virtual', url: '/profesor-virtual', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA: orice navigare necunoscută primește index.html…
        navigateFallback: '/index.html',
        // …dar NU rutele serverless (/api/*) și NU fișierele de verificare
        // Google (ex. /google88f99a4244b17e5a.html) — trebuie servite ca atare,
        // altfel service worker-ul returnează app shell-ul și verificarea eșuează.
        navigateFallbackDenylist: [/^\/api\//, /^\/google[0-9a-f]+\.html$/, /^\/sitemap\.xml$/],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
});
