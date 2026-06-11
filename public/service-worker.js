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

// Substituted at build time by scripts/stamp-sw.js. The fallback keeps the SW
// self-sufficient if that step is ever skipped (e.g. local `npm start`).
const RAW_BUILD_ID = '__BUILD_ID__';
const BUILD_ID = RAW_BUILD_ID.includes('BUILD_ID') ? String(Date.now()) : RAW_BUILD_ID;
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
        // Only cache a genuinely good HTML shell. A Vercel rewrite serving
        // JSON or an asset with a 200 status would otherwise poison the
        // offline experience — when network drops, every navigation would
        // return the wrong content type.
        if (res && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          const cache = await caches.open(CACHE_SHELL);
          cache.put('/index.html', res.clone()).catch(() => null);
        }
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
    icon: '/icon-192.png',
    badge: '/favicon-64.png',
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

// ---------------------------------------------------------------------------
// GS-1 Offline Mode — Background Sync drain of the scorekeeper write queue.
//
// The page-context drain in src/lib/syncQueue.js is the PRIMARY replay path
// (it works on iOS, which has no Background Sync, and it can refresh an
// expired token). This handler is a progressive enhancement for
// Chrome/Android: it drains the queue even if the tab closed before
// connectivity returned, using the last-known access token the app mirrors
// into the meta store. If that token has expired, it leaves the queue fully
// intact — NO attempts bump — for the next page-context drain.
//
// DB name / version / store names mirror src/lib/offlineCache.js — keep them
// in lock-step. Everything below is additive; the fetch/push handlers above
// are untouched.

const SYNC_TAG = 'scorekeeper-sync';
const OFFLINE_DB = 'rinkd-offline';
const OFFLINE_DB_VERSION = 1;
const SYNC_QUEUE_STORE = 'writeQueue';
const SYNC_META_STORE = 'meta';
// Public values — identical to what ships in the app bundle (src/lib/supabase.js).
const SYNC_FN_URL = 'https://tbpoopsyhfuqcbugrjbh.supabase.co/functions/v1/sync-scorekeeper-queue';
const SYNC_MAX_ATTEMPTS = 5;
const SYNC_BATCH_LIMIT = 100;

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      // Same schema as offlineCache.js, in case the SW opens the DB first.
      const db = req.result;
      if (!db.objectStoreNames.contains('gameCache')) db.createObjectStore('gameCache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        const q = db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
        q.createIndex('by_order', ['ts', 'seq']);
      }
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) db.createObjectStore(SYNC_META_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function idbReq(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB tx aborted'));
  });
}

async function drainScorekeeperQueue() {
  // If any window is alive, hand the drain to the page instead: it has a
  // fresher token, a current queue snapshot, and the per-tab mutex. Draining
  // here in parallel could POST a STALE snapshot whose last-write-wins ops
  // (shots counts, score patches) land AFTER newer page writes and regress
  // them. This handler's job is strictly the closed-tab case.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.length > 0) {
    windows.forEach((c) => c.postMessage({ type: 'SCOREKEEPER_DRAIN_REQUESTED' }));
    return;
  }

  let db;
  try { db = await openOfflineDb(); } catch { return; }
  try {
    const meta = await idbReq(db, SYNC_META_STORE, 'readonly', (s) => s.get('auth')).catch(() => null);
    const token = meta && meta.accessToken;
    if (!token) return; // nothing to authenticate with — page drain will handle it

    for (let pass = 0; pass < 10; pass++) {
      const all = (await idbReq(db, SYNC_QUEUE_STORE, 'readonly', (s) => s.getAll()).catch(() => [])) || [];
      const rows = all.filter((r) => !r.dead).sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
      if (!rows.length) break;
      const batch = rows.slice(0, SYNC_BATCH_LIMIT);

      let resp;
      try {
        resp = await fetch(SYNC_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            ops: batch.map((r) => ({
              id: r.id, gameId: r.gameId, isLeague: r.isLeague, table: r.table,
              operation: r.operation, payload: r.payload, match: r.match, ts: r.ts, seq: r.seq,
            })),
          }),
        });
      } catch (e) {
        // Still unreachable — rethrow so Background Sync retries with backoff.
        throw e;
      }

      if (resp.status === 401) return; // token expired — page drain takes over, queue untouched

      let body = null;
      try { body = await resp.json(); } catch { /* non-JSON error body */ }
      if (!resp.ok || !body || !body.results) {
        // Whole-batch failure. Mirror the page drain: only 4xx counts toward
        // dead-lettering — 5xx/cold-start hiccups just retry later. Throw
        // either way so Background Sync schedules a retry with backoff.
        if (resp.status >= 400 && resp.status < 500) {
          for (const r of batch) {
            r.attempts = (r.attempts || 0) + 1;
            if (r.attempts >= SYNC_MAX_ATTEMPTS) r.dead = true;
            await idbReq(db, SYNC_QUEUE_STORE, 'readwrite', (s) => s.put(r)).catch(() => {});
          }
        }
        throw new Error('sync-scorekeeper-queue returned ' + resp.status);
      }

      const byId = new Map(body.results.map((x) => [x.id, x]));
      for (const r of batch) {
        const result = byId.get(r.id);
        if (!result) continue; // server stopped before this op — next pass/retry
        if (result.status === 'applied' || result.status === 'duplicate' || result.status === 'skipped_finalized') {
          await idbReq(db, SYNC_QUEUE_STORE, 'readwrite', (s) => s.delete(r.id)).catch(() => {});
        } else if (result.status === 'rejected') {
          r.dead = true;
          r.lastError = result.error || 'rejected';
          await idbReq(db, SYNC_QUEUE_STORE, 'readwrite', (s) => s.put(r)).catch(() => {});
        } else {
          r.attempts = (r.attempts || 0) + 1;
          r.lastError = result.error || result.status;
          if (r.attempts >= SYNC_MAX_ATTEMPTS) r.dead = true;
          await idbReq(db, SYNC_QUEUE_STORE, 'readwrite', (s) => s.put(r)).catch(() => {});
        }
      }
      if (body.stopped) break; // hard failure mid-batch — preserve order, retry later
    }

    // Open tabs refresh their pending counter / lists off this signal.
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientList.forEach((c) => c.postMessage({ type: 'SCOREKEEPER_SYNCED' }));
  } finally {
    try { db.close(); } catch { /* swallow */ }
  }
}

self.addEventListener('sync', (e) => {
  if (e.tag === SYNC_TAG) e.waitUntil(drainScorekeeperQueue());
});
