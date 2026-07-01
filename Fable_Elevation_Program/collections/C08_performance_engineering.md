# COLLECTION C08 — Performance Engineering (the Saturday Night Test)

**Objective:** Instant at 10 users and at 1,000,000. This is the hard architecture
rule from `CLAUDE.md` — enforce it everywhere.

**Real surfaces & files:** `lib/supabase.js`, `lib/gameRealtime.js`,
`lib/cache.js`, `lib/prefetch.js`, `lib/offlineCache.js`, `lib/syncQueue.js`,
`lib/lazyWithRetry.js`, `lib/chunkReload.js`, `lib/image.js`, `lib/adBeacon.js`,
`middleware.js`, `supabase/` (Edge Functions), `ui/Skeleton.js`, `PullToRefresh.js`,
`useOnline.js`.

**Scope (audit every list and live surface):**
- **No polling** — Supabase Realtime subscriptions; unsubscribe on unmount. Grep for
  `setInterval`/repeated fetches and eliminate.
- **Cursor pagination** on every list (games, chirps, stats, feeds, standings). No
  "fetch all."
- **Lazy load below the fold** (images, comment threads, secondary stats).
- **Edge Functions on hot paths** (score updates, live state) — no cold starts.
- **Image optimization mandatory** — compress/resize before serving; never raw
  uploads in the feed (`lib/image.js`).
- **Cache aggressively** — static data (team names, rosters, league config) in
  `lib/cache.js`, not re-fetched per render.
- **Skeleton → async → hydrate**; no blocking renders; no layout shift.

**Deliverable:** `audits/C08_performance.md` — a per-surface table (polling? paginated?
lazy? cached? Realtime? Edge?) with the offending file:line and the fix, plus a
performance-budget target per screen. Ship the highest-traffic fixes first (Home Ice,
Feed, live game, standings). **Guardrail:** correctness preserved; measure before/after.
