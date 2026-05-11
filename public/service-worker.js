// Rinkd service worker — auto-update edition.
//
// Strategy:
//   * Cache version bumped on every deploy via the __BUILD_ID__ placeholder
//     (substituted at build time by scripts/stamp-sw.js, falling back to Date.now()
//     when run locally so dev still cycles cleanly).
//   * Navigation requests → network-first, fall back to cached shell only offline.
//     This means the app is always as fresh as the last successful fetch.
//   * Static assets (JS/CSS/images/fonts) → stale-while-revalidate.
//   * skipWaiting + clients.claim → new SW activates immediately, old tabs adopt it.
//   * postMessage('SW_UPDATED') is broadcast on activate so the React app can
//     show a "tap to reload" banner.

const BUILD_ID = '__BUILD_ID__';
const CACHE_SHELL = `rinkd-shell-${BUILD_ID}`;
const CACHE_ASSETS = `rinkd-assets-${BUILD_ID}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (e) => {
  // Pre-cache the shell so first-offline still loads something, but don't block
  // install on it — better to roll forward than stall.
  e.waitUntil(
    caches.open(CACHE_SHELL).then((c) => c.addAll(SHELL_URLS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== CACHE_SHELL && k !== CACHE_ASSETS)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
    // Tell every open tab a new build is live.
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientList.forEach((c) => c.postMessage({ type: 'SW_UPDATED', build: BUILD_ID }));
  })());
});

function isHTMLNav(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never intercept Supabase or any cross-origin API calls.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigation → network-first, fall back to cached shell.
  if (isHTMLNav(request)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(request, { cache: 'no-store' });
        const cache = await caches.open(CACHE_SHELL);
        cache.put('/index.html', res.clone()).catch(() => null);
        return res;
      } catch {
        const cached = await caches.match('/index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Static assets → stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_ASSETS);
    const cached = await cache.match(request);
    const networkFetch = fetch(request).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(request, res.clone()).catch(() => null);
      }
      return res;
    }).catch(() => null);
    return cached || (await networkFetch) || new Response('', { status: 504 });
  })());
});

// Allow the app to force-activate a waiting SW.
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', (e) => {
  const data = e.data?.json() || {};
  const title = data.title || 'Rinkd';
  const options = {
    body: data.body || 'Something happened on the ice.',
    icon: '/rinkd_icon_192.png',
    badge: '/rinkd_icon_80.png',
    tag: data.tag || 'rinkd-notification',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
