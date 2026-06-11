// GS-1 Offline Mode — timestamp-ordered IndexedDB write queue.
//
// Every ScorerView write goes through queuedWrite(): try Supabase directly,
// and ONLY on a connectivity failure enqueue the op and return optimistically.
// Real errors (RLS denial, constraint violation, bad payload) still surface
// to the caller exactly as before — offline mode must never swallow a
// legitimate rejection.
//
// Replay paths, in order of preference:
//   1. Page-context drain (drainQueue) — fires on 'online', after every
//      enqueue attempt, and on ScorerView mount. This is the PRIMARY path:
//      it has a live supabase-js session that can refresh expired tokens,
//      and it works on iOS Safari, which has no Background Sync API.
//   2. Service Worker Background Sync ('scorekeeper-sync' tag) — progressive
//      enhancement for Chrome/Android so the queue drains even if the tab is
//      closed before connectivity returns. The SW reads the same IndexedDB
//      queue plus the last-known access token from the meta store.
//
// Both paths POST ordered batches to the sync-scorekeeper-queue edge
// function, which authorizes every op against the caller's game and applies
// them idempotently — so a double-drain (page + SW racing) is harmless.

import { supabase } from './supabase';
import {
  openOfflineDB, idbGetAll, idbPut, idbDelete,
  STORE_WRITE_QUEUE, setMeta,
} from './offlineCache';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'https://tbpoopsyhfuqcbugrjbh.supabase.co';
const SYNC_FN_URL = `${SUPABASE_URL}/functions/v1/sync-scorekeeper-queue`;
export const SYNC_TAG = 'scorekeeper-sync';

// A full game is well under 100 writes; a queue past this size means
// something is broken (a loop, a stuck drain) — fail loudly instead of
// growing without bound.
const MAX_QUEUE = 500;
const MAX_ATTEMPTS = 5;
const BATCH_LIMIT = 100;

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122-ish fallback for ancient WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Monotonic tiebreak for rapid taps that share a Date.now() millisecond —
// replay order must exactly match action order (a goal must never replay
// after its own delete).
let seqCounter = 0;

/**
 * Connectivity failure vs real error. supabase-js surfaces network failures
 * as errors whose message comes from the underlying fetch rejection; a real
 * PostgREST/auth error carries a `code` (e.g. '23505', 'PGRST301', '42501').
 */
export function isConnectivityError(e) {
  if (!e) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (e.code && !/^5\d\d$/.test(String(e.code))) return false; // a coded PostgREST/PG error is a real rejection
  const msg = String(e.message || e).toLowerCase();
  return (
    msg.includes('failed to fetch') ||          // Chrome
    msg.includes('networkerror') ||             // Firefox
    msg.includes('load failed') ||              // Safari
    msg.includes('network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  );
}

// ---------------------------------------------------------------------------
// Queue state + subscriptions (drives the ScorerView banner/counter)
// ---------------------------------------------------------------------------

const listeners = new Set();

export function subscribeQueue(cb) {
  listeners.add(cb);
  // Push current state immediately so the banner doesn't flash stale zero.
  getQueueState().then(cb).catch(() => {});
  return () => listeners.delete(cb);
}

async function emitQueueState() {
  let state = { pending: 0, dead: 0 };
  try { state = await getQueueState(); } catch { /* keep zeros */ }
  listeners.forEach((cb) => { try { cb(state); } catch { /* listener's problem */ } });
}

export async function getQueueState() {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  return {
    pending: rows.filter((r) => !r.dead).length,
    dead: rows.filter((r) => r.dead).length,
  };
}

export async function hasPendingForGame(gameId) {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  return rows.some((r) => r.gameId === gameId);
}

/**
 * All queued ops for one game in replay order. ScorerView merges these over
 * freshly loaded server lists so a queued-but-unsynced goal still shows in
 * the goal log — if it silently vanished, the scorer would re-enter it and
 * double-count the moment the queue drains.
 */
export async function getPendingOpsForGame(gameId) {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  return rows
    .filter((r) => r.gameId === gameId)
    .sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
}

// ---------------------------------------------------------------------------
// Enqueue + the queuedWrite wrapper
// ---------------------------------------------------------------------------

async function enqueueWrite(entry) {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  if (rows.length >= MAX_QUEUE) {
    return { error: new Error('Offline queue is full — stop scoring and reconnect to sync before continuing.') };
  }
  try {
    await idbPut(STORE_WRITE_QUEUE, entry);
  } catch {
    // IndexedDB broken (private mode, quota) — the write is neither saved
    // nor queued. Surface a REAL error so the scorer knows to retry online;
    // silently dropping it here would be invisible data loss.
    return { error: new Error('Could not save on this device — check your connection and try again.') };
  }
  emitQueueState();
  // Best-effort: ask the SW to drain when connectivity returns even if this
  // tab is gone by then (Chrome/Android only; silently unavailable on iOS).
  registerBackgroundSync();
  return { error: null };
}

/**
 * The wrapper every ScorerView write goes through.
 *
 * @param table     'game_goals' | 'game_penalties' | 'game_goalie_changes' |
 *                  'game_shots' | 'games' | 'league_games'
 * @param operation 'insert' | 'delete' | 'upsert' | 'update'
 * @param payload   insert/upsert row, update patch, or {} for delete
 * @param ctx       { gameId, isLeague, match } — match is the .eq() filter
 *                  for update/delete (e.g. { id: rowId, game_id: gameId })
 *
 * Returns { data, error, queued } — `queued: true` means the write is
 * persisted locally and will replay; callers treat it as success.
 */
export async function queuedWrite(table, operation, payload, ctx) {
  const { gameId, isLeague = false, match = {} } = ctx || {};

  // Capture replay position at ACTION time, not enqueue time — a slow,
  // eventually-failing attempt must not replay after a later write that
  // failed fast.
  const ts = Date.now();
  const seq = ++seqCounter;

  // Client-generated id BEFORE the first attempt: if the server applied the
  // insert but the response was lost to the connection drop, the queued
  // replay carries the SAME id and the edge fn's on-conflict-do-nothing
  // makes it a no-op instead of a duplicate goal.
  if (operation === 'insert' && !payload.id) payload = { ...payload, id: uuid() };

  // ORDER GUARD: if this game already has queued writes, the new write must
  // replay AFTER them — a direct write would leapfrog the backlog (e.g. a
  // delete applying before its own queued insert, resurrecting the goal; or
  // a fresh shots count being overwritten by an older queued one).
  let mustQueue = false;
  if (gameId) {
    try { mustQueue = (await idbGetAll(STORE_WRITE_QUEUE)).some((r) => r.gameId === gameId); } catch { mustQueue = false; }
  }

  // Skip the doomed network attempt when the browser already knows it's
  // offline — enqueueing directly keeps goal entry snappy at the rink.
  if (!mustQueue && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
    try {
      let res;
      const t = supabase.from(table);
      if (operation === 'insert') {
        res = await t.insert(payload).select().single();
      } else if (operation === 'upsert') {
        res = await t.upsert(payload, { onConflict: 'game_id,team_id,period' }).select().single();
      } else if (operation === 'update') {
        let q = t.update(payload);
        Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
        res = await q;
      } else if (operation === 'delete') {
        let q = t.delete();
        Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
        res = await q;
      } else {
        return { data: null, error: new Error(`Unknown operation: ${operation}`) };
      }
      if (res.error) {
        if (!isConnectivityError(res.error)) return { data: null, error: res.error };
      } else {
        return { data: res.data ?? payload, error: null };
      }
    } catch (e) {
      if (!isConnectivityError(e)) return { data: null, error: e };
    }
  }

  // Connectivity failure (or ordered behind an existing backlog) → persist
  // and return optimistically.
  const entry = {
    id: uuid(),
    gameId,
    isLeague,
    table,
    operation,
    // Stamp event time on append-log inserts so a late replay keeps the true
    // wall-clock order in the goal/penalty logs (they sort by created_at).
    payload: (operation === 'insert' && !payload.created_at)
      ? { ...payload, created_at: new Date(ts).toISOString() }
      : payload,
    match,
    ts,
    seq,
    attempts: 0,
    dead: false,
  };
  const { error: qErr } = await enqueueWrite(entry);
  if (qErr) return { data: null, error: qErr };
  // Kick a drain right away: when we got here via the order guard (online,
  // backlog ahead of us) this flushes immediately; when the network only
  // LOOKS up (captive portal / AP with no upstream — the classic rink WiFi
  // failure, where the 'online' event never fires) the backoff timer below
  // keeps retrying.
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    drainQueue().catch(() => {});
  }
  return { data: { ...entry.payload }, error: null, queued: true };
}

// ---------------------------------------------------------------------------
// Page-context drain
// ---------------------------------------------------------------------------

let draining = null; // in-flight drain promise — mutex so triggers can't double-POST

// Backoff retry: rink WiFi often LOOKS up (navigator.onLine true, captive
// portal / AP with no upstream) so the 'online' event never fires. While
// writes remain pending we keep retrying on a 5s→60s backoff — this is the
// only automatic recovery path on iOS, which has no Background Sync.
let drainTimer = null;
let drainBackoff = 5000;

function resetDrainBackoff() {
  drainBackoff = 5000;
  if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
}

function scheduleDrainRetry() {
  if (drainTimer) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainBackoff = Math.min(drainBackoff * 2, 60000);
    // Genuinely offline → stop; the 'online' event restarts the loop.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    drainQueue().catch(() => {});
  }, drainBackoff);
}

/** Drain the queue from the page. Resolves { drained, remaining, dead, error? }. */
export function drainQueue() {
  if (draining) return draining;
  draining = doDrain()
    .then((s) => {
      if (s && s.remaining > 0 && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        scheduleDrainRetry();
      } else if (s && s.remaining === 0) {
        resetDrainBackoff();
      }
      return s;
    })
    .finally(() => { draining = null; });
  return draining;
}

async function doDrain() {
  const summary = { drained: 0, remaining: 0, dead: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const s = await getQueueState();
    return { ...summary, remaining: s.pending, dead: s.dead };
  }

  // Loop: rows enqueued while a batch is in flight are picked up by the next
  // pass instead of waiting for the next trigger.
  for (let pass = 0; pass < 10; pass++) {
    const all = (await idbGetAll(STORE_WRITE_QUEUE).catch(() => []));
    const rows = all.filter((r) => !r.dead).sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq));
    summary.dead = all.length - rows.length;
    if (!rows.length) break;

    // getSession() auto-refreshes an expired token when it can — this is why
    // the page drain, not the SW, is the primary path after a long offline gap.
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) { summary.remaining = rows.length; summary.error = 'no_session'; break; }
    await storeAuthMeta(session);

    const batch = rows.slice(0, BATCH_LIMIT);
    let resp;
    try {
      resp = await fetch(SYNC_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ops: batch.map((r) => ({
            id: r.id, gameId: r.gameId, isLeague: r.isLeague, table: r.table,
            operation: r.operation, payload: r.payload, match: r.match, ts: r.ts, seq: r.seq,
          })),
        }),
      });
    } catch {
      // Edge fn unreachable — connectivity is still flaky. Leave the queue
      // untouched (no attempts bump: this is not a server rejection).
      summary.remaining = rows.length;
      summary.error = 'unreachable';
      break;
    }

    if (resp.status === 401) {
      // Token died mid-flight; supabase-js will have a fresh one next trigger.
      summary.remaining = rows.length;
      summary.error = 'auth';
      break;
    }

    let body = null;
    try { body = await resp.json(); } catch { /* non-JSON error body */ }

    if (!resp.ok || !body?.results) {
      // Whole-batch failure. Only a 4xx (bad request the server understood
      // and refused) counts toward dead-lettering — a string of 5xxs or
      // cold-start hiccups must NOT burn a recovering backend's writes; the
      // backoff timer keeps retrying those indefinitely with the banner up.
      if (resp.status >= 400 && resp.status < 500) {
        for (const r of batch) {
          r.attempts = (r.attempts || 0) + 1;
          if (r.attempts >= MAX_ATTEMPTS) r.dead = true;
          await idbPut(STORE_WRITE_QUEUE, r).catch(() => {});
        }
      }
      summary.error = `http_${resp.status}`;
      break;
    }

    const byId = new Map(body.results.map((x) => [x.id, x]));
    for (const r of batch) {
      const result = byId.get(r.id);
      if (!result) continue; // server stopped before this op — retry next drain
      if (result.status === 'applied' || result.status === 'duplicate' || result.status === 'skipped_finalized') {
        await idbDelete(STORE_WRITE_QUEUE, r.id).catch(() => {});
        summary.drained++;
      } else if (result.status === 'rejected') {
        // Authz/validation rejection — will never succeed; dead-letter
        // immediately so the scorer sees it instead of an infinite retry.
        r.dead = true;
        r.lastError = result.error || 'rejected';
        await idbPut(STORE_WRITE_QUEUE, r).catch(() => {});
      } else {
        r.attempts = (r.attempts || 0) + 1;
        r.lastError = result.error || result.status;
        if (r.attempts >= MAX_ATTEMPTS) r.dead = true;
        await idbPut(STORE_WRITE_QUEUE, r).catch(() => {});
      }
    }
    if (body.stopped) {
      // Server hit a hard failure mid-batch and stopped to preserve order —
      // the failed op got an attempts bump above; try again next trigger.
      break;
    }
  }

  const s = await getQueueState();
  summary.remaining = s.pending;
  summary.dead = s.dead;
  emitQueueState();
  return summary;
}

/** Give dead-lettered rows another MAX_ATTEMPTS (manual Retry button). */
export async function retryDeadWrites() {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  for (const r of rows) {
    if (r.dead) {
      r.dead = false;
      r.attempts = 0;
      await idbPut(STORE_WRITE_QUEUE, r).catch(() => {});
    }
  }
  emitQueueState();
  return drainQueue();
}

/**
 * Permanently drop dead-lettered rows (the scorer chose Discard after a
 * confirm). Without this exit, a single server-rejected write would hold the
 * Finalize gate closed on this game forever.
 */
export async function discardDeadWrites(gameId) {
  const rows = await idbGetAll(STORE_WRITE_QUEUE).catch(() => []);
  for (const r of rows) {
    if (r.dead && (!gameId || r.gameId === gameId)) {
      await idbDelete(STORE_WRITE_QUEUE, r.id).catch(() => {});
    }
  }
  emitQueueState();
}

/**
 * Keep the last-known access token in IndexedDB for the SW drain (the SW has
 * no localStorage, so it can't read the supabase-js session). Refreshed on
 * every enqueue/drain; if it's expired by the time Background Sync fires, the
 * SW leaves the queue intact for the next page-context drain.
 */
export async function storeAuthMeta(sessionArg) {
  try {
    const session = sessionArg || (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return;
    await setMeta('auth', { accessToken: session.access_token, expiresAt: session.expires_at || null, savedAt: Date.now() });
  } catch { /* best-effort */ }
}

export async function registerBackgroundSync() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    if (reg && 'sync' in reg) await reg.sync.register(SYNC_TAG);
  } catch { /* unsupported (iOS) or permission denied — page drain covers it */ }
}

// ---------------------------------------------------------------------------
// Global triggers — drain as soon as the browser says we're back.
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { drainQueue().catch(() => {}); });
  // The SW broadcasts after its own drain so open tabs refresh their
  // counter; it also defers to the page (DRAIN_REQUESTED) when a window is
  // alive at Background Sync time — the page drain has fresher tokens and a
  // current queue snapshot.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'SCOREKEEPER_SYNCED') emitQueueState();
      if (e.data?.type === 'SCOREKEEPER_DRAIN_REQUESTED') drainQueue().catch(() => {});
    });
  }
  // Warm the DB early so the first offline enqueue isn't racing an IDB open.
  openOfflineDB().catch(() => {});
}
