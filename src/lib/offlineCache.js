// GS-1 Offline Mode — IndexedDB game-setup cache + shared DB helpers.
//
// Rinks have notoriously bad WiFi. ScorerView prefetches everything a
// scorekeeper needs (game row w/ joins, both lineups, their own authz
// decision, current event logs) into IndexedDB while online, so a
// connectivity drop — or a full tab reload while offline — still puts a
// working scorer in front of them. The write side lives in syncQueue.js,
// which shares this module's database.
//
// IMPORTANT: public/service-worker.js opens this same database by name to
// drain the write queue from Background Sync. The DB_NAME / DB_VERSION /
// store names below are duplicated there (the SW can't import app modules) —
// keep them in lock-step if they ever change.

const DB_NAME = 'rinkd-offline';
const DB_VERSION = 1;

export const STORE_GAME_CACHE = 'gameCache';   // { key:'game:<id>', savedAt, setup, events }
export const STORE_WRITE_QUEUE = 'writeQueue'; // { id, gameId, isLeague, table, operation, payload, ts, seq, attempts, dead }
export const STORE_META = 'meta';              // { key, ...value } — e.g. last-known access token for the SW drain

// Cache is valid for 24h or until the game finalizes, whichever comes first.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;

export function openOfflineDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_GAME_CACHE)) db.createObjectStore(STORE_GAME_CACHE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_WRITE_QUEUE)) {
        const q = db.createObjectStore(STORE_WRITE_QUEUE, { keyPath: 'id' });
        // Replay order is (ts, seq) — seq breaks ties between rapid taps that
        // land on the same millisecond, so a goal can never replay after its
        // own delete.
        q.createIndex('by_order', ['ts', 'seq']);
      }
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // If a future build bumps the version from another tab, release our
      // handle so the upgrade isn't blocked forever.
      db.onversionchange = () => { try { db.close(); } catch { /* swallow */ } dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  // A failed open (private browsing edge cases) shouldn't poison every later
  // call — let the next caller retry.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB tx aborted'));
  });
}

export async function idbPut(store, value) {
  const db = await openOfflineDB();
  return tx(db, store, 'readwrite', (s) => s.put(value));
}

export async function idbGet(store, key) {
  const db = await openOfflineDB();
  return tx(db, store, 'readonly', (s) => s.get(key));
}

export async function idbDelete(store, key) {
  const db = await openOfflineDB();
  return tx(db, store, 'readwrite', (s) => s.delete(key));
}

export async function idbGetAll(store) {
  const db = await openOfflineDB();
  return tx(db, store, 'readonly', (s) => s.getAll());
}

const gameKey = (gameId) => `game:${gameId}`;

/**
 * Cache the full game setup after a successful online load.
 * `setup` carries everything ScorerView needs to boot without the network:
 *   { game, lineups, userId, authorized, isDirector, isLeague }
 * The authz decision is cached deliberately — supabase.auth.getUser() is a
 * network call, so an offline boot revalidates against the LOCAL session user
 * id (see readGameCache callers) instead of re-asking the server.
 */
export async function cacheGameSetup(gameId, setup) {
  try {
    const existing = await idbGet(STORE_GAME_CACHE, gameKey(gameId));
    await idbPut(STORE_GAME_CACHE, {
      key: gameKey(gameId),
      gameId,
      savedAt: Date.now(),
      setup,
      // Keep previously cached events until the caller refreshes them —
      // setup and events are written at slightly different moments.
      events: existing?.events || null,
    });
  } catch (e) {
    // Cache writes are best-effort; scoring online must never break because
    // IndexedDB is unavailable (e.g. some private-browsing modes).
    console.warn('[offlineCache] cacheGameSetup failed:', e?.message || e);
  }
}

/**
 * Mirror the scorer's live event state (goal log, penalties, shots, goalie
 * changes, score/period/status) into the cache. Called after every local
 * mutation so an offline tab reload re-opens exactly where the scorer left
 * off — an empty goal log after a reload would tempt them to re-enter
 * everything and double the game.
 */
export async function updateCachedEvents(gameId, events) {
  try {
    const existing = await idbGet(STORE_GAME_CACHE, gameKey(gameId));
    if (!existing) return; // no setup cached → nothing to attach events to
    existing.events = { ...events, savedAt: Date.now() };
    await idbPut(STORE_GAME_CACHE, existing);
  } catch (e) {
    console.warn('[offlineCache] updateCachedEvents failed:', e?.message || e);
  }
}

/** Read the cached setup; returns null when missing or past TTL. */
export async function readGameCache(gameId) {
  try {
    const row = await idbGet(STORE_GAME_CACHE, gameKey(gameId));
    if (!row) return null;
    if (Date.now() - (row.savedAt || 0) > CACHE_TTL_MS) {
      idbDelete(STORE_GAME_CACHE, gameKey(gameId)).catch(() => {});
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

/** Drop the cache for a game — called after a successful online finalize. */
export async function clearGameCache(gameId) {
  try { await idbDelete(STORE_GAME_CACHE, gameKey(gameId)); } catch { /* best-effort */ }
}

export async function setMeta(key, value) {
  try { await idbPut(STORE_META, { key, ...value }); } catch { /* best-effort */ }
}

export async function getMeta(key) {
  try { return await idbGet(STORE_META, key); } catch { return null; }
}
