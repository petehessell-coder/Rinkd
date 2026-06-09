// Stale-chunk-after-deploy recovery.
//
// When a new build ships, the hashed JS/CSS chunk filenames change. A client
// still running the OLD build that lazy-loads a route then requests a chunk that
// no longer exists; the SPA rewrite returns index.html, so the dynamic import()
// rejects — "ChunkLoadError" / "Loading chunk N failed" / "Unexpected token '<'"
// (the HTML's leading `<`). This is benign: reloading pulls the fresh build.
//
// We reload ONCE within a short window (guarded by a sessionStorage timestamp)
// so a genuinely-broken build can't trap the user in a reload loop.

export const RELOAD_TS_KEY = 'rinkd:chunkReloadAt';
const WINDOW_MS = 10000;

export function isChunkLoadError(err) {
  if (!err) return false;
  if (err.name === 'ChunkLoadError') return true;
  const msg = String(err.message || err || '');
  return (
    /Loading chunk \d+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Unexpected token '<'/.test(msg) ||         // Chrome/Safari: got HTML
    /expected expression, got '<'/i.test(msg) || // Firefox
    /import\(\) failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg)
  );
}

// Reload at most once per WINDOW_MS. Returns true if it triggered a reload (the
// caller should then stop / hang, since navigation is imminent).
export function reloadOnceForChunk() {
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_TS_KEY) || 0); } catch { /* private mode */ }
  if (Date.now() - last > WINDOW_MS) {
    try { sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now())); } catch { /* ignore */ }
    try { window.location.reload(); } catch { /* ignore */ }
    return true;
  }
  return false;
}
