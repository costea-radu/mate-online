import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// momentul build-ului = VERSIUNEA site-ului: Admin → Meditații live arată ce versiune rulează
// telefonul, iar /version.json (scris mai jos) îi spune unui tab deschis de dinainte de un
// deploy că a apărut una nouă (src/lib/versiune.js)
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  define: { __BUILD_TIME__: JSON.stringify(BUILD_TIME) },
  plugins: [
    react(),
    {
      name: 'version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ v: BUILD_TIME }) });
      },
    },
    VitePWA({
      // 'autoUpdate' = la fiecare deploy pe Vercel, aplicația instalată se
      // actualizează singură la următoarea deschidere. O singură acțiune: git push.
      registerType: 'autoUpdate',
      // înregistrarea o face src/main.jsx (cu eroarea prinsă — scriptul generat de
      // plugin lăsa eșecurile din unele browsere ca erori neprinse în agentul de debug)
      injectRegister: false,
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
        // Se declară pe sine ca aplicație înrudită → navigator.getInstalledRelatedApps()
        // (Chrome/Edge) poate confirma că PWA-ul e instalat, iar site-ul nu mai
        // afișează invitația „Instalează aplicația” celor care o au deja.
        related_applications: [
          { platform: 'webapp', url: 'https://examenmate.com/manifest.webmanifest' }
        ],
        shortcuts: [
          { name: 'Evaluarea Națională', url: '/evaluare-nationala', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Bacalaureat', url: '/bacalaureat', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Profesor Virtual', url: '/profesor-virtual', icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }] }
        ]
      },
      workbox: {
        // versiunea nouă (după un deploy) preia imediat paginile deschise. Pluginul le pune
        // singur DOAR cu înregistrarea lui; cu injectRegister: false (12 oct.) lipseau, iar
        // versiunea nouă aștepta până se închideau TOATE tab-urile site-ului — pe telefon,
        // Admin rămăsese la versiunea veche după deploy (13 oct.).
        skipWaiting: true,
        clientsClaim: true,
        // notificările „lecția e gata" (Web Push + clicul pe notificare): public/sw-push.js
        importScripts: ['/sw-push.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // scena profesorului din meditațiile live se încarcă doar în sală, nu la toată lumea;
        // tastatura matematică (MathLive) — doar la prima deschidere, nu la toată lumea
        // încărcarea materialelor (pdf-lib, docx-preview, html-to-image) — doar la profesori, la cerere
        globIgnores: ['live/**', 'assets/KaTeX_*', 'assets/katex-*', 'sw-push.js', 'assets/mathlive*', 'assets/MathKeyboard*', 'og-*.png', 'assets/material-*'],   // KaTeX (cod + fonturi): la cerere, nu în precache
        // PAGINILE vin din REȚEA, nu din cache (8 nov. 2026). Înainte, orice deschidere primea
        // index.html din precache — adică versiunea de DINAINTEA ultimului deploy; cea nouă
        // apărea abia la a doua deschidere (pe iPhone, nota cu roșu și recenzia „lipseau"
        // după deploy). Fără navigateFallback / directoryIndex, precache-ul nu mai răspunde
        // la navigări (nici la „/"); le ia ruta „pagini" de mai jos.
        navigateFallback: null,
        directoryIndex: null,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // navigările: rețeaua întâi (versiunea nouă imediat după un deploy). Rețeaua nu
            // răspunde în 4 s sau lipsește → index.html din precache (aceeași versiune cu
            // fișierele din precache — niciodată un HTML vechi păstrat separat, care ar cere
            // fișiere șterse după un deploy: pagină albă). NU rutele serverless (/api/*), NU
            // fișierele de verificare Google (ex. /google88f99a4244b17e5a.html), sitemap-ul
            // și /.well-known/ — acelea merg direct la server, ca atare.
            // (funcția ajunge ca text în sw.js: nu are voie să folosească variabile de aici)
            urlPattern: ({ request, url }) => request.mode === 'navigate'
              && !/^\/(?:api\/|google[0-9a-f]+\.html$|sitemap\.xml$|\.well-known\/)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pagini',
              networkTimeoutSeconds: 4,
              plugins: [{
                // HTML-ul paginilor nu se păstrează…
                cacheWillUpdate: async () => null,
                // …iar fără rețea (sau după 4 s) răspunde index.html din precache
                cachedResponseWillBeUsed: async ({ cachedResponse }) => cachedResponse
                  || (await caches.match('/index.html', { ignoreSearch: true })) || null,
                // …la fel dacă serverul paginii are o pană (api/page-meta.js → 503)
                fetchDidSucceed: async ({ response }) => (response.status >= 500
                  && (await caches.match('/index.html', { ignoreSearch: true }))) || response,
              }],
              precacheFallback: { fallbackURL: '/index.html' },
            },
          },
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
          // „📤 Încarcă material" (doar profesorii, la încărcare): Word → PDF și poze → PDF.
          // Bucăți cu nume știut, ca să rămână în afara precache-ului PWA (vezi globIgnores)
          'material-pdflib': ['pdf-lib'],
          'material-docx': ['docx-preview', 'jszip'],
          'material-img': ['html-to-image'],
        },
      },
    },
  },
});
