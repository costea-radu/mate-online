/* =====================================================================
 * public/sw-push.js — NOTIFICĂRILE în service worker-ul site-ului
 * (inclus în sw.js de vite.config.js → workbox.importScripts)
 *
 *  · push — notificarea venită de pe server (api/_lib/push.js): „✅ Prof. Tudor
 *    e gata — intră", „🔴 Meditația a început". Dacă elevul are deja sala
 *    deschisă și la vedere, nu mai apare o notificare (pagina îl anunță singură).
 *  · notificationclick — clicul pe notificare aduce în față tabul sălii (sau
 *    îl deschide, dacă a fost închis).
 * ===================================================================== */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'ExamenMate';
  const url = data.url || '/meditatii';
  event.waitUntil((async () => {
    const target = new URL(url, self.location.origin).pathname;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const here = wins.find((c) => {
      try { return new URL(c.url).pathname === target && c.visibilityState === 'visible' && c.focused !== false; } catch (e) { return false; }
    });
    if (here) { here.postMessage({ type: 'MATE_PUSH', data }); return; }
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'examenmate',
      renotify: true,
      requireInteraction: true,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200, 100, 400],
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/meditatii', self.location.origin);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // tabul sălii, deschis → în față
    for (const c of wins) {
      try { if (new URL(c.url).pathname === url.pathname && 'focus' in c) return c.focus(); } catch (e) { /* următorul */ }
    }
    // alt tab al site-ului → îl duce în sală; altfel o fereastră nouă
    for (const c of wins) {
      if ('navigate' in c && 'focus' in c) {
        try { await c.navigate(url.href); return c.focus(); } catch (e) { /* următorul */ }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url.href);
    return undefined;
  })());
});
