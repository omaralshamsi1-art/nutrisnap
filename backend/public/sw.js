// NutriSnap service worker — push notifications only (no offline caching).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'NutriSnap', body: '', url: '/app/' };
  try { data = { ...data, ...event.data.json() }; } catch { if (event.data) data.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/app/icon-192.png',
    badge: '/app/icon-192.png',
    lang: 'ar',
    dir: 'rtl',
    data: { url: data.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.includes('/app/') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  })());
});
