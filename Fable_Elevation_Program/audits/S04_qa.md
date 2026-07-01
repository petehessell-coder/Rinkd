# S04 — Navigation · Adversarial QA (WORKFLOW stage 3)

*July 1, 2026. Branch `feature/s04-navigation` (1 commit `db6d3e9c`) vs `main`.
Read-only. Files under review: League.js, Tournament.js, MoreDrawer.js, Layout.js.*

## VERDICT: FIX-FIRST

One real P1 (League tab param silently dropped when the division picker is used
in the same session). Everything else in the contract verified clean. The P1 is
narrow (League-only, requires using two URL features together) and does not
corrupt router state or the visible tab — but it breaks the deep-link guarantee
that is the entire point of the sprint, so fix before ship.

---

## P1 — League `?tab=` is clobbered by the division picker (data-loss on the shareable link)

**Where:** `src/pages/League.js` — `writeTabToUrl` (line 56–63) vs `selectDivision`
(line 453–459) + `useSearchParams` (line 246).

**Mechanism:** League has TWO independent writers to the query string:

1. `writeTabToUrl(tab)` → **`window.history.replaceState`** directly (bypasses
   react-router). Preserves other params because it reads live
   `new URL(window.location.href)`.
2. `selectDivision(divId)` → react-router **`setSearchParams(next, { replace: true })`**,
   where `next` is built from the router's `searchParams` snapshot.

react-router v6.22 keeps its own `location` in React state and is **not**
notified of a bare `window.history.replaceState` (it only re-derives on
router-initiated navigation or `popstate`, and there is no app `popstate`
listener). So after `writeTabToUrl` runs, the router's `searchParams` is stale —
it still has no `tab`. The next division switch rebuilds the URL from that stale
snapshot and **writes a URL with `?division=…` but no `?tab=`** → the tab param
is silently dropped from the address bar.

**Blast radius:** URL only. `activeTab` is separate `useState`, so the *visible*
tab does not change and there is no render loop (the division effect's
`searchParams` dep does not change on a `replaceState`, so it does not misfire).
But a user who switches tab, then switches division, then copies the link, shares
a URL that lands on the DEFAULT tab — the exact deep-link failure S04 set out to
fix. Order matters: division-then-tab is fine (writeTabToUrl reads live URL and
keeps `division`); tab-then-division loses `tab`.

**Fix (pick one):** route the tab write through react-router so both writers
share one source of truth — e.g. in `writeTabToUrl`, use the existing
`setSearchParams` (merge `tab` into a copy of `searchParams`, `{ replace: true }`)
instead of raw `replaceState`. That keeps the router's `searchParams` in sync,
still adds no history entry (Back stays one-tap), and `division` + `tab` coexist
in both directions. Tournament.js has no `useSearchParams` so its raw
`replaceState` is fine and needs no change — but using the same router-native
approach in both would be more robust and consistent.

---

## Contract items — VERIFIED

**1. Diff discipline** — `git diff main...HEAD -- src/` touches exactly Layout.js
(2 lines, inside the `isMore` branch only), MoreDrawer.js (motion + operator row
+ close button), League.js + Tournament.js (tab helpers + wiring). No NAV /
MOBILE_NAV array edits, no order change, no route changes, no data/query changes,
chirp feed untouched. Guardrails held.

**2a. `initialTabFromUrl` hoisting/malformed param** — `TABS` is a top-level
`const` declared ABOVE the helper in both files; the helper only runs inside the
`useState(() => …)` initializer at render time, long after module eval, so no TDZ
risk. Absent param → `'' `→ `.find` misses → fallback. Malformed/garbage →
case-insensitive `.find` misses → fallback. `try/catch` wraps the URL parse.
Clean.

**2b. `writeTabToUrl` preserves other params + hash** — builds from
`new URL(window.location.href)`, sets only `tab`, re-emits
`pathname + search + hash`. Hash and other params preserved. Confirmed.
(But see P1 — preservation is defeated by the *router's* stale snapshot on the
subsequent division write, not by this function.)

**2c. `replaceState(window.history.state, …)`** — passing the existing
`window.history.state` through (rather than `{}`) is correct: react-router v6
stores its `usr/key/idx` there, and blanking it would strip the router's scroll
key / history index. Passing it through does not corrupt router state. Good call
by the author.

**2d. children reading `location.search`** — League: `useSearchParams` for
`division` (read line 358, write line 456). This is the P1 conflict. No other
child (SubscribeCalendarSheet, feed deep links) reads `location.search`.
Tournament: no `useSearchParams` anywhere → no conflict.

**2e. app-wide navigations to `/league/:id` or `/tournament/:id` with query** —
grep found none carrying `?tab=`; inbound deep links only. A fresh load with
`?tab=stats&division=X` is read by BOTH `initialTabFromUrl` and the router on
mount (both read `window.location` at init), so first-load deep links resolve
correctly for tab and division. Divergence only begins after an in-page
`writeTabToUrl`.

**2f. `/league-game/:id?type=league`** — separate route, separate `type` param,
untouched. No interaction.

**2g. PWA / iOS standalone popstate** — no app `popstate`/`onpopstate` listener
anywhere in `src/`. `replaceState` triggers no reload and no popstate, so nothing
misfires in standalone mode. Safe.

**3. Sheet motion** — reduced-motion gate present
(`@media (prefers-reduced-motion: reduce) { animation: none }`).
`animation: … both` on the 350ms `cubic-bezier(0.32,0,0.67,0)` ease-in curve;
sheet is a plain div with no `pointer-events` override, so it is interactive
during and after the animation (`both` only holds transform, not pointer state).
Uses `motion.duration.sheet` (350) + `motion.easing.sheet` — both exist in
tokens.js. `<style>` tag is the FIRST child of the backdrop div, rendered before
the animated `.rinkd-sheet` node, so the keyframes are defined before use. It
re-injects on every open (component returns null when closed) — harmless (browser
de-dupes identical `@keyframes`), noted per contract.

**4. More icon** — `isMore` branch now renders `<NavIcon item={item} size={size}/>`;
the More NAV entry carries `IconNode: MoreHorizontal`, so NavIcon takes the
`IconNode` path → `<MoreHorizontal size={22} />`, identical to the other 4 items
(all size 22 on both bars). Old glyph was `fontSize: isVertical ? 20 : size`
(20 on mobile) — new is 22, a small parity improvement, not a regression. The
button's own `fontSize: isVertical ? 10 : 15` still governs the "More" label
span. Bottom-bar item heights stay consistent. The label span kept
`whiteSpace: nowrap`. Clean.

**5. Operator row** — same `path: '/pricing'` destination; label reframed to
"Run your league or tournament", sub "Start free — plans & pricing". The old
"Pricing" row was REPLACED (not duplicated) — only one `/pricing` entry remains
in `exploreItems`. Icon `'pricing'` exists in `Icon.js:32` (→ `DollarSign`).
No route change. Clean.

**6. A11y / 44px close button** — `minWidth:44, minHeight:44` +
`display:inline-flex; align/justify center` gives a true ≥44×44 target. The
`margin:'-10px -10px -10px 0'` pulls the enlarged box back so the visible glyph
sits where the old `padding:4` button did (old visual ≈24px glyph + 4 pad;
−10 offsets the +~10 half-growth per side, top/bottom/right, left kept 0 to hug
the header edge). Visual position preserved, real target ≥44. Good.

**7. Analytics / `?tab=` leak** — `RouteAnalytics` calls `trackPage(pathname)`
with the BARE pathname (no query), and `trackPage`/`track` record `page: p`
using that stripped path. `?tab=` (and any future token param) never reaches
`page_view` rows. No leak. Clean.

---

## Notes (non-blocking)

- **N1** — The two divergent URL-write mechanisms in League (raw `replaceState`
  vs router `setSearchParams`) are a latent footgun even after the P1 fix: any
  future param added via one path can be clobbered by the other. Standardizing on
  router-native writes (the P1 fix) removes the class of bug, not just this
  instance. Recommend the fix take that shape.
- **N2** — No focus trap on the More sheet (Esc + overlay-click close work).
  Pre-existing, called out in the S04 audit as note-only; not introduced here.
- **N3** — Sheet keyframes re-inject per open. Harmless; contract already
  anticipated this.

---

## Fix list (for stage-2 return)

1. **[P1, required before ship]** League.js: route `writeTabToUrl` through
   react-router (`setSearchParams` merge, `{ replace: true }`) so `?tab=` and
   `?division=` coexist and neither writer clobbers the other. Tournament.js may
   stay as-is or adopt the same pattern for consistency (N1).

Re-QA after the fix: confirm (a) tab→division→copy-link retains both params,
(b) division→tab retains both, (c) Back still exits League in one tap, (d) no
render loop on the `searchParams` division effect.
