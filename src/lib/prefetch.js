// RESILIENCE — prefetch on intent.
//
// The game page is lazy-loaded (its own JS chunk). On a cold tap that chunk
// downloads AFTER the tap, so the user watches the Suspense fallback before the
// page can even show its own skeleton. Prefetching the chunk the instant a
// finger lands on a game card (touch-start / pointer-down / hover) means the
// code is already parsed by the time the tap completes — navigation lands
// straight on the page's skeleton, then hydrates. Pure perf, no behavior change.
//
//   import { prefetchGamePage, prefetchHandlers } from '../lib/prefetch';
//   <div {...prefetchHandlers(prefetchGamePage)} onClick={...}>…</div>
//
// Idempotent: the dynamic import is fired once and webpack dedupes it with the
// route's own lazy() (same module specifier → same chunk).

const fired = {};

function warm(key, loader) {
  if (fired[key]) return fired[key];
  // Swallow errors — a failed prefetch must never surface; the real navigation
  // re-imports (lazyWithRetry handles chunk-load failures there).
  fired[key] = Promise.resolve().then(loader).catch(() => {});
  return fired[key];
}

// The in-app game page (handles /game/:id and /league-game/:id).
export function prefetchGamePage() {
  return warm('game', () => import('../pages/GameDetail'));
}

// The login-less public game page (/g/:id, /lg/:id) — for share landings.
export function prefetchPublicGame() {
  return warm('publicGame', () => import('../pages/PublicGame'));
}

// Spread onto any element to prefetch on the first sign of intent. touch-start
// fires ~100–300ms before the click resolves on mobile — that's the budget we
// reclaim. pointerenter covers desktop hover; both are passive and cheap.
export function prefetchHandlers(fn) {
  return { onTouchStart: fn, onPointerEnter: fn };
}
