// perf(scale) — a tiny in-memory TTL cache for static / slow-changing reads
// (league config, divisions, rink lists) so they aren't re-fetched on every page
// mount and back-nav. CLAUDE.md "Built for Scale": "Cache aggressively. Static
// data (team names, rosters, league config) belongs in a cache layer, not
// re-fetched on every render." Mirrors the Map+TTL idiom already in ads.js /
// navPins.js.
//
//   export const listX = (id) =>
//     cached(`x:${id}`, 60_000, async () => { ...fetch... });
//   // after a write that changes X:
//   invalidatePrefix('x:');
//
// Per-tab only (module scope) — deliberately not cross-tab. Short TTLs keep it
// honest, and writers invalidate explicitly so an editor never sees their own
// stale data. Anything mutated on a hot path should NOT be cached here.

const store = new Map();    // key -> { value, expires }
const inflight = new Map(); // key -> Promise — dedupes a cold-key thundering herd

export async function cached(key, ttlMs, fetchFn) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  // Several components mounting at once would otherwise each fire the same cold
  // fetch; coalesce them into one in-flight request.
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(fetchFn)
    .then((value) => { store.set(key, { value, expires: Date.now() + ttlMs }); return value; })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, p);
  return p;
}

export function invalidate(key) { store.delete(key); }

export function invalidatePrefix(prefix) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
