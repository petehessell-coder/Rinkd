# C12 — Operator Front Door · Stage-3 Adversarial QA

**Reviewer:** Opus 4.8 / Fable (fresh session) · **Date:** 2026-07-02
**Branch:** `feature/c12-operator-front-door` · **PR #33**
**Verdict:** 🟡 **GATE 2 — one MUST-FIX before merge** (anon live-game drop-in routes to a protected route). Everything else is clean or a judgment-call polish.

Method: read the full `main...HEAD` diff line-by-line against the approved spec (§1b/§1c), the S01 A+ rubric, and `04_NEVER_DO.md`; ran the PGlite smoke harness (all-green); verified live anon REST on prod (RLS reads, FK embeds, RPC `admin_only` gate); ran the CRA dev server and looked at `/o/xrhl`, `/o/demo` (live game present), `/o/does-not-exist`, `/o/XRHL` as an anonymous user at desktop + 375px; ran a clean production build.

---

## Checklist verdicts

### 1. Spec fidelity + diff discipline — **PASS (no scope creep)**
The diff does exactly what §1b/§1c approved and nothing more:
- Route `/o/:slug` registered outside `ProtectedRoute` (`src/App.js:285`), lazy via `lazyWithRetry` (`:69`). ✅
- Page anatomy present in order: brand hero → co-brand line (show-only-when-present) → "THEIR EVENTS" chip strip (live-first) → LIVE NOW (shared `LiveGameCard`) → events grid → quiet footer CTA (`src/pages/Operator.js:197–342`). ✅
- Data model, RLS (fail-closed, no write policies), 4 DEFINER RPCs, `operator_needs_events` never-empty guardrail, youth/public write-refusal all match spec (`supabase/migrations/20260702150000_c12_featured_operators.sql`). ✅
- Admin panel: pin/unpin star toggle on Row (`AdminActivations.js` `FeaturedPin`), Featured Operators panel with `ConfirmSheet` on delete (`removeOperator` uses `confirm({ danger:true })`, host mounted `:ConfirmSheetHost`). ✅
- Attribution seeds first-touch ref via new `seedPilotRef()` (`src/lib/analytics.js:61`), first-touch-wins preserved. ✅
- Wave-2 OG unfurl added to `middleware.js` matcher + `operatorMeta()` + `api/og.js` `card=operator` mode. ✅
- No nav entry, no Home changes, no scoring/reg touch. ✅
- `03_DECISION_LOG.md` updated. ✅

Only additive surprise: the admin editor's 3-step save (upsert-inactive → set events → re-activate) — this is a *correct* workaround for the never-empty guardrail on new cards, not scope creep. (One data nit in it — see SF-3.)

### 2. Correctness bugs — **ONE MUST-FIX + minors**
- **MF-1 — anon live-game drop-in bounces to Landing.** `operators.js` normalizers set `gameUrl` to `/league-game/${id}?type=league` (`:43`) and `/game/${id}` (`:54`), copied verbatim from `gameday.js:41,58`. Those routes are **inside `ProtectedRoute`** (`App.js:311–312`), which redirects a logged-out user to `/` (`App.js:128`). The operator page is an **anonymous cold-evaluator surface**; the public game routes are `/g/:id` and `/lg/:id` (`App.js:309–310` → `PublicGame`). So a prospect on `/o/demo` who taps the one thing the whole page is built around — the **LIVE "DROP IN"** — gets kicked to the marketing Landing page, losing their operator context. **Verified live**: `/o/demo` renders a live LiveGameCard (Crease Crashers 2 – Top Shelf 1) whose Drop-in target is `/game/…` (protected). This breaks the spec's core promise ("2 taps to live, no login") and the Grandparent Test. Fix: normalizers on this anon page must emit `/g/:id` / `/lg/:id`. (Chips are fine — they route to `/league/:id` / `/tournament/:id`, which are public.)
- Data normalization vs `LiveGameCard`'s contract: **correct** — `game.{home,away}.{name,logoUrl}`, `homeScore/awayScore`, `eventName`, `gameUrl` all match `gameday.js` ground truth exactly. ✅
- Realtime setup/teardown: **correct.** One channel `operator-${slug}`, per-event bindings capped at 20 (matches GamedayStrip), 600ms debounce, `clearTimeout` + `removeChannel` in the returned unsub, effect re-subscribes on `events`/`slug` change (`operators.js:152–173`, `Operator.js:120–124`). `refreshLive` is stable (empty deps, reads `eventsRef`) — no stale closure. ✅
- Cache: `getOperatorBySlug` cached 60s keyed on slug; **live games are NOT cached** (fetched fresh on every `refreshLive`) — correct, so a back-nav shows fresh scores. ✅
- Error paths: live-query failures are swallowed (`Operator.js:80`) so a live hiccup never blanks the page; card load failure → `phase='error'` → `ErrorState` with retry. ✅
- Middleware `/o/` handler: bot on valid slug → operator OG HTML; bot on bad slug → both regexes miss → `return undefined` → SPA fallthrough (still HTML); **human on any `/o/` path always falls through** (`middleware.js:154`); `/g//lg/` regex unchanged and still matches (verified). ✅ — except see SF-1 (uppercase).
- `api/og.js` operator mode: `card=operator` → title-only centered card, brand hex validated `^#[0-9a-fA-F]{6}$` (`:79–82`), long names bounded by `maxWidth:1000` + Satori clip. Malformed params fall back cleanly. ✅

### 3. Youth privacy + RLS (Never-Do) — **PASS (defense in depth verified)**
- No `select('*')` on `profiles`/`team_members` anywhere in the diff. ✅
- Leagues filtered `is_public !== true` client-side (`operators.js:95`) **and** refused at write (`migration:240`, fail-closed on NULL). ✅
- Tournaments filtered `is_youth !== false` client-side (`operators.js:107`) **and** refused at write (`migration:246`, fail-closed on NULL/true). ✅ — smoke harness proves both the NULL-league and youth-tournament refusals.
- What renders for a live youth-league game: nothing leaks — leagues are `is_public`-gated, and `LiveGameCard` shows **team names only** (no player/scorer names). ✅
- Admin event pickers only offer `is_public === true` leagues + `is_youth === false` tournaments (`AdminActivations.js` `pinnableLeagues`/`pinnableTournaments`). ✅
- Live prod REST confirmed: anon sees only `is_active` operators; RPC write returns `admin_only` 42501.

### 4. A+ rubric (all 8) — **PASS with token nits**
- Obvious ✅ · Premium ✅ (broadcast hero + lower-third live card) · Fewer taps ✅ (blocked only by MF-1) · **On-system**: imports `{ C, colors, type, space, radii, shadows, motion }` from `tokens.js`, uses all `ui/*` primitives, **no local `const C`**. Hardcoded values audit: `operators.js` = **zero**; `Operator.js` = the two sanctioned scrim rgba stops + `heroBg}D9` (spec-blessed), plus a few shadow rgba and `rgba(215,38,56,0.6)`/`rgba(244,247,250,0.86)` that mirror the League/LiveGameCard hero precedent (on-system by precedent — see NF-1). Admin panel uses alpha-tints consistent with the *existing* AdminActivations file style + two placeholder-text hexes (not styling). ✅
- State resilience ✅: geometric skeleton matches hero+chip+2 cards (`OperatorSkeleton`), empty = a designed invitation (verified on `/o/does-not-exist`), error = `ErrorState` with retry + a what-to-do body. No spinners.
- Stress-safe ✅: hero name 2-line clamp + `overflowWrap:anywhere` `clamp(24px,6.4vw,36px)`; tagline 3-line clamp; chips `maxWidth:240` + ellipsis; grid `min-width:0` everywhere; no-cover → brand panel; no-logo → initials tile. No horizontal overflow at 375px (measured `scrollWidth===innerWidth`).
- Scalable ✅: 3 bounded queries (operator + events embed + live `.limit(12)`) + 1 Realtime channel, no polling (verified in network waterfall), page is a lazy chunk (verified in prod build).
- Apple-shippable ✅ modulo MF-1 and the SF-2 duplicate-header polish.

### 5. Stress test LIVE — **PASS (screens captured)**
- `/o/xrhl`: brand hero, single-event chip + grid, co-brand "Results sync in from HockeyShift · … stays the source of truth", footer CTA. Clean. No console errors.
- `/o/demo`: LIVE pill in hero, live chip sorted first with red dot, LIVE NOW `LiveGameCard`, events grid with league season/location + tournament dates. Full happy path works.
- `/o/does-not-exist`: "THIS RINK ISN'T ON THE ICE YET" invitation + Explore Rinkd + See a live league demo. Never a 404.
- `/o/XRHL`: **empty invitation, not the operator** — see SF-1.
- Network: bounded, no polling. Console: no errors. Mobile 375px: no overflow. Prod build: green, Operator lazy-chunked.

### 6. Copy rule — **PASS**
Grepped the diff for `replace|replacement|switch from|migrate off` in user-facing strings: **zero**. The only hits are code comments stating the copy law ("never a replacement") and a "replace pinned events" implementation comment. Every user-facing string keeps the framing: hero sub-line + SEO + empty-state + footer + co-brand line + admin panel copy all say "engagement layer / fan & community layer **on top of the platform you already run**" and "{name} stays the source of truth." Verified list in §6 evidence above.

### 7. Saturday Night Test — **PASS**
3 bounded queries + 1 Realtime channel per page; operator+events cached 60s (back-nav/crawler re-hit is free), live fetched fresh but `.limit(12)`; images through native `<img object-fit:cover>` with `onError` hide; middleware unfurl `cache-control: public, max-age=600, s-maxage=600`; `api/og` card `s-maxage=86400`. Holds at 10k concurrent.

### 8. Migration re-review (hostile) — **PASS**
- RLS: SELECT-only, both tables, drafts hidden from anon, event rows gated on parent operator readability. No draft/inactive leak (smoke-proven with a real non-superuser `anon` role). ✅
- `admin_upsert` slug-change of an active operator: allowed and correct (updates slug, bumps `updated_at`); unique constraint on `slug` surfaces a clean 23505 if it collides. ✅
- `admin_set_..._events` duplicate ids in one payload: the delete-then-insert means a payload with two rows for the *same* league hits `featured_operator_events_operator_league_uniq` → 23505 surfaces to the client (mapped to a generic "didn't save" toast). Acceptable, minor UX (NF-2).
- `admin_set_featured` on a nonexistent id: silent no-op (UPDATE affects 0 rows, returns `p_value`). **Acceptable** — it's a fire-and-forget pin toggle off a list the admin is already looking at; matches `admin_set_activation`'s posture. NF-3.
- Grants: every function `revoke all from public` + `grant execute to anon, authenticated, service_role`, `security definer`, `set search_path to 'public'`, idempotent DDL. Matches repo convention. ✅
- `get_advisors` expectation: the 4 DEFINER functions executable by anon is the *intended* admin-gated pattern (they self-check `current_user_is_admin()`), matching the existing `admin_*` convention — the WARNs are expected, not new risk.

**Caveat carried from the prompt:** the RPC write paths were seeded on prod via service-role SQL, NOT via the admin RPCs (MCP has no admin JWT). The 3-step admin save flow, the `operator_needs_events` round-trip, and the pin toggles are **exercised only in the PGlite harness, not against prod through the UI.** First real admin login must click through: create → pin → go-live → unpin-to-empty (expect auto-inactivate) → delete.

---

## Prioritized fix list

### MUST-FIX (blocks merge)
- **MF-1 — Live drop-in must use the public game route on this anon page.** In `src/lib/operators.js`, `normLeagueLiveGame` (`:43`) and `normTournamentLiveGame` (`:54`) set `gameUrl` to the `ProtectedRoute` targets `/league-game/:id` and `/game/:id`. On this logged-out operator surface, tapping a LIVE game redirects to the Landing page (`App.js:128`). Emit `/lg/:id` and `/g/:id` (the `PublicGame` routes, `App.js:309–310`) instead — the fix is two string changes in the two normalizers. Without it the page's single most important tap is dead for its intended audience.

### SHOULD-FIX (Gate-2 judgment call)
- **SF-1 — Uppercase / mixed-case slug lands on the empty invitation, not the operator.** DB slugs are lowercase-only; `getOperatorBySlug` passes the raw param to `.eq('slug', slug)`, so `/o/XRHL` → "isn't on the ice yet" (verified live). The middleware bot-regex is also lowercase-only, so an uppercase link unfurls generic. A prospect who types the link, or a mail client that title-cases it, silently misses their page. Fix: lowercase the slug in `getOperatorBySlug` (and in the `middleware.js` `/o/` match, or match case-insensitively then lowercase before `operatorMeta`). The QA prompt explicitly named `/o/UPPERCASE` as a stress case.
- **SF-2 — "EVENTS" chip strip + "THE EVENTS" grid duplicate for single-event operators.** On `/o/xrhl` (1 pinned event) the page shows the same event as a chip and again as a grid card under two near-identical headers ("EVENTS" / "THE EVENTS"). Spec §1c calls for both sections, but with one event it reads as a bug and "THE EVENTS" is awkward. Consider: suppress the chip strip (or the grid) when `events.length <= 1`, and/or rename to distinct labels ("JUMP IN" for chips vs "ALL EVENTS" for the grid). Design/Pete call.
- **SF-3 — Admin 3-step save writes empty strings on re-activate.** `AdminActivations.js` `save()` step 3 spreads `...form` (raw values, so `tagline:''`, `brand_color:''` …) into the re-activate upsert, overwriting step 1's nulled fields with empty strings. Harmless to render but pollutes the row (empty string vs null; `defaultTagline` only kicks in on null/falsy so `''` is still falsy → OK, but other fields store `''`). Fix: reuse the same nulled payload object for step 3, or pass only `{ id, slug, name, is_active:true }` and let the DB keep the rest (would need the RPC to treat NULL as "unchanged" — currently it overwrites, so simplest is to send the nulled payload again).

### NOTED (fine to ship, logged)
- **NF-1** — A handful of raw rgba in `Operator.js` (`rgba(0,0,0,…)` shadows, `rgba(215,38,56,0.6)` live-chip border, `rgba(244,247,250,0.86)` tagline-on-photo) are hardcoded but mirror the exact League/LiveGameCard hero constants the spec said to clone. On-system by precedent; a future token pass could lift them.
- **NF-2** — Duplicate league/tournament ids in one `set_events` payload surface a raw 23505 mapped to a generic toast. The UI already dedupes via `togglePin`, so it's unreachable from the panel; only a hand-crafted call hits it.
- **NF-3** — `admin_set_featured` / `admin_delete_featured_operator` silently no-op on a nonexistent id. Consistent with `admin_set_activation`. Fine.
- **NF-4** — `#fff` literal for the EventPicker checkmark in the admin panel (`AdminActivations.js`) should be `colors.onAccent`; admin-only surface, cosmetic.
- **NF-5** — Prod RPC write paths never exercised through the UI (seeded via service-role SQL). Smoke over the admin flow on first real login (create→pin→go-live→empty→delete) before leaning on it for outreach.

---

## Overall grade vs the A+ rubric

**A− as built; A+ once MF-1 lands.** Obvious / Premium / On-system / State-resilient / Stress-safe / Scalable / Apple-shippable all pass cleanly — the page is genuinely broadcast-grade, the migration is fail-closed and smoke-proven, youth privacy is defense-in-depth at both read and write, and the copy law holds everywhere. The one thing keeping it off A+ is that the highest-intent tap on an anonymous surface (drop into the live game) routes to a login wall — a "fewer taps / Grandparent Test" failure that's a two-line fix. Clear MF-1, take SF-1 (uppercase) and SF-2 (single-event duplication) as fast follow-ups, and this merges as an A+ front door.
