# C12 — Operator Front Door · Gate-1 Spec (STOP: awaiting Pete sign-off)

**Track B (net-new build) · Full pipeline · Stage 1a–1c output**
**Engineer (Stage 2): Opus 4.8** — correctness-critical (new public route + new table + RLS + prod schema).
**Adversarial QA (Stage 3): Opus 4.8 / Fable, fresh session.**
**Status: 🚦 GATE 1 — no code, no migration until Pete approves this spec.**

---

## 1a. Objective

Build the branded operator landing page — `/o/:slug` — the polished front door we send a
partner platform or big operator (GameSheet, HockeyShift, EventConnect, Black Bear,
Crystal Fieldhouse) instead of the cold app. One page that shows *their* events, *their*
live games, *their* teams under *their* branding, framed everywhere as **"the engagement
layer on top of your platform — never a replacement."** It generalizes the two things
that already work in sales: the demo-league deep link (`/league/934dd511-…`) and the
Home Featured hero — into a per-operator, admin-curated, never-empty surface.

**How this honors the North Stars and the live roadmap:** This is the Platform Layer
Play made concrete — decision-log entries 2026-06-30 (event-centric Home, Featured hero
at top for the cold evaluator) all point here, and `BUILD_PRIORITY.md` lists Enterprise
Operator Pages as P1 "the enterprise demo unlock," sequenced right after the home
sprint. It's Stupid-Proof Simple (one page, one primary action: tap into the event),
Intuitively Familiar (it's the League cover hero + Home ticker patterns users already
see), Social-First (content is the product — live games and events, not a brochure),
Engaging (live-first ordering), and Shareable (a URL an operator forwards to their
whole community). Nothing existing changes: no nav edits, no Home changes, no touch to
scoring/reg. It is additive inventory on top of shipped primitives.

---

## 1b. Product Spec

### Users & stories

1. **Cold evaluator (operator/ED landing from an email link):** "I open `/o/black-bear`
   on my phone, logged out, and in under 10 seconds I see a premium page with our brand,
   our events, a live game, and copy that says Rinkd sits on top of what we already run."
2. **Pete (admin):** "I create an operator card in under 2 minutes: slug, name, logo,
   brand color, pin 1–3 events, flip it active — then paste the link into an outreach
   email." (Extends `/admin/activations` — the existing admin surface.)
3. **Operator's community member:** "My rink shares `rinkd.app/o/crystal-fieldhouse`;
   I tap a league chip and land on that league's page; if I sign up from there, Rinkd
   knows which operator brought me." (Attribution → pilot-scorecard machinery.)

### The route

- **`/o/:slug`** — registered in `src/App.js` **outside `ProtectedRoute`** (same as
  `/league/:id` at `App.js:283` and `/tournament/:id` at `:297`), via `lazyWithRetry`
  (`src/lib/lazyWithRetry.js`), new page `src/pages/Operator.js`.
- Slug-route precedent: `/rinkside/:slug` (`App.js:254`) with `.eq('slug', slug)`
  loaders (`src/lib/rinkside.js:26`).
- **No nav entry.** Link-only surface (outreach emails, operator comms). Keeps the
  single-array nav (Decision Log 2026 · "Navigation is a single shared array") untouched
  and adds zero Home clutter. → **D-C12-4**
- New loader lib `src/lib/operators.js`: `getOperatorBySlug(slug)` via
  `cached('operator:'+slug, 60_000, …)` (`src/lib/cache.js` idiom), plus one live-status
  query over the operator's pinned event ids (`league_games` / `games`,
  `.eq('status','live')`, bounded `.limit()`). **No polling** — one Realtime channel
  scoped to the pinned events' game rows, mirroring `GamedayStrip`'s pattern
  (`src/components/Gameday/GamedayStrip.js:42-49`: `postgres_changes` filtered per
  event, debounced re-query, unsubscribe on unmount).

### Data model — `featured_operators` (+ link table)

```sql
create table public.featured_operators (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  name            text not null,
  tagline         text,              -- optional; partner-safe default supplied by UI
  logo_url        text,
  logo_initials   text,              -- fallback like leagues.logo_initials
  brand_color     text,              -- hero panel bg (mirrors leagues.logo_color)
  accent_color    text,              -- accents (mirrors leagues.accent_color)
  cover_image_url text,              -- real photography only (manifesto); brand panel fallback
  website_url     text,              -- link-back: "you stay the source of truth"
  platform_label  text,              -- optional co-brand, e.g. 'GameSheet' → "Results sync from GameSheet"
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.featured_operator_events (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.featured_operators(id) on delete cascade,
  league_id     uuid references public.leagues(id)     on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  sort_order    int  not null default 0,
  check (num_nonnulls(league_id, tournament_id) = 1),
  unique (operator_id, league_id),
  unique (operator_id, tournament_id)
);
```

- **Two nullable FKs, not a polymorphic FK-less `event_id`** → **D-C12-1**. Real
  referential integrity; `admin_delete_league`/`admin_delete_tournament` hard-deletes
  cascade cleanly; the page can use FK-hinted embeds
  (`league:leagues!featured_operator_events_league_id_fkey(...)`).
  **Embed-footgun check (the Jun-2 P0):** ambiguity strikes when a table gains a
  *second* FK to the same target and a *bare* embed exists between that pair
  (`supabase/migrations/20260609120000_seal_gamepuck_feed_post.sql:6-9`,
  `src/lib/posts.js:12`). These are *first* FKs from a *new* table — the
  `league_games→leagues`, `posts→profiles`, `gameday` bare embeds
  (`src/lib/gameday.js:65`, `src/lib/home.js:117-118`, `src/lib/gameCardData.js:34`)
  gain no new relationships and stay unambiguous. Rule stays: all embeds in the new
  loader are FK-name-qualified (`src/pages/TournamentManage.js:2451` convention).
  QA verifies via a live REST embed on the feed query (per the
  `postgrest_embed_ambiguity` standing rule).

### RLS

RLS **enabled on both tables**; fail-closed (no write policies at all).

```sql
-- Public read of active operators; admins see drafts for preview.
create policy featured_operators_public_read on public.featured_operators
  for select using (is_active = true or public.current_user_is_admin());

create policy featured_operator_events_public_read on public.featured_operator_events
  for select using (
    exists (select 1 from public.featured_operators fo
            where fo.id = operator_id
              and (fo.is_active = true or public.current_user_is_admin()))
  );
```

- **All writes go through SECURITY DEFINER RPCs gated on
  `public.current_user_is_admin()`** (`supabase/migrations/20260621120000_…:64-68`),
  mirroring `admin_set_activation` — raise `admin_only` (42501) for non-admins, exactly
  like `admin_delete_*` (`src/lib/adminDelete.js:10-23`). → **D-C12-2**
  - `admin_upsert_featured_operator(payload)` — validates slug format server-side.
  - `admin_set_featured_operator_events(p_operator_id, p_events jsonb)` — **refuses**
    any league with `is_public = false` and any tournament where
    `is_youth is distinct from false` (fail-closed, the `.neq('is_youth', true)` norm
    from `src/lib/home.js:144-148` enforced at write time too).
  - `admin_delete_featured_operator(p_id)`.
  - Why RPCs over RLS write policies: server-side validation (slug rules, youth
    exclusion, public-only pinning) can't live in a bare `with check`, and it matches
    the established admin write pattern.
- **Youth privacy on the page (read side, defense in depth):** leagues filtered
  `is_public = true`; tournaments `.neq('is_youth', true)`; **no `select *` on
  `profiles` or `team_members` ever** (errors under the youth column gate); any
  stats/rosters shown route through the existing DEFINER RPCs. Last-goal/scorer surfaces
  reuse the fail-closed name-shield (`src/lib/home.js:189-204`,
  `areScorersHidden` in `src/lib/gameCardData.js`).
- All functions: `set search_path to 'public'`, explicit `revoke all` + `grant execute`,
  idempotent DDL — repo migration conventions. Any view (none planned) would be
  `security_invoker = on` (standing rule).

### Featured/pinnable inventory (closes the collection's second scope item)

`is_featured` exists on both `leagues` and `tournaments`
(`supabase/migrations/20260629120000_add_is_featured_flag.sql:8-9`) and drives the Home
hero (`src/lib/home.js:41-52`) — **but nothing in the product can set it** (pinned once
via raw SQL, `:16-17`; `AdminActivations.js` only toggles `is_activated`). This sprint
adds, in the same admin section:
- `admin_set_featured(p_kind, p_id, p_value)` — DEFINER, admin-gated, scoped to
  `is_featured` only (clone of `admin_set_activation`).
- A pin/unpin toggle per event row in `/admin/activations`, plus the new
  **Featured Operators** panel (create/edit operator, pin events, activate).

### Attribution (the GTM measurement)

Visiting `/o/:slug` fires `track('operator_page_view', { slug })` and seeds the
existing first-touch pilot-ref capture (`capturePilotRef()` /
`rinkd_pilot_ref` localStorage, `src/lib/analytics.js:41-52`) with the operator slug —
so a signup that started from an operator page lands in `profiles.acquisition_ref`
(`supabase/migrations/20260701190000_…:9`) and the existing rollup views slice by it.
Zero new analytics infrastructure; each operator page becomes a measurable funnel.
→ **D-C12-5**

### The demo-league deep-link playbook (reuse, not replace)

- **Today's zero-build move stays:** for a prospect with no synced data, send the
  demo-league deep link — `/league/934dd511-e15e-4a07-94ff-1edd6ff31dfc` — which shows
  anon visitors the FULL league page via `settings.is_demo === true`
  (`src/pages/League.js:566,581-583`).
- **The operator page composes it:** an operator card for a prospect can pin the demo
  league (and/or XRHL, `a1b2c3d4-…`, which carries logo + brand color and is the pinned
  Featured row) so the page is populated on day zero. The chip strip links straight into
  those events — the demo link becomes a *destination inside* the operator page instead
  of the whole pitch.
- **Playbook after ship:** first touch → `rinkd.app/o/<prospect-slug>` (their brand, their
  demo-populated page); the raw demo-league link remains the fallback when we haven't
  built them a card yet.
- **Known edge (accepted):** chips to a *non-demo* league send anon visitors to
  `PublicLeagueLanding` (the teaser) — existing behavior, unchanged. Prospect-facing
  operator cards should therefore pin demo/`is_demo` events or events we're happy to
  tease. Not extending `is_demo` semantics in this sprint.

### Copy rule (Never-Do, enforced)

Every string on `/o/:slug` and the admin panel frames Rinkd as
**"the engagement layer on top of your platform"** — never replacement. Source strings
(already approved/live):
- `src/pages/Pricing.js:136-137` — "Community + engagement layer · keep your own
  scoring platform · results sync in automatically."
- `Platform_Layer_Play_Target_Map.md:1` — "Be the Engagement Layer on Top of Every Stack."
- `PLATFORM_CONNECTION_DESIGN.md:42` — co-brand "Data powered by [Platform]" / "you
  stay the source of truth."

Page copy (draft, final at build): hero sub-line
"**The fan & community layer for {name} — on top of the platform you already run.**";
co-brand line when `platform_label` set: "**Results sync in from {platform_label}.
{name} stays the source of truth.**"; footer CTA "Run your events on Rinkd" → `/pricing`
(the S04 cold-operator on-ramp framing).
**Banned tokens on this surface:** `replace`, `replacement`, `switch from`, `migrate off`.
QA greps the diff for them.

### Edge cases & states (the stress list for QA)

| Case | Behavior |
|---|---|
| Unknown/inactive slug | **Never a 404** (`PLATFORM_CONNECTION_DESIGN.md` rule): designed "This rink isn't on the ice yet" state → CTA to `/home` + the demo league. |
| Operator with 0 live games | Live section absent (show-only-when-present rule from the Broadcast Home pass — never fabricate); chip strip + events grid carry the page. |
| Operator with 0 pinned events | Blocked upstream: admin panel warns and the **activate toggle requires ≥1 pinned event** (never-empty guardrail). If data drifts (events deleted → cascades), page falls back to EmptyState-as-invitation + demo league link. |
| No cover photo | Brand-color panel + logo (XRHL precedent — don't block on photography). No CSS-gradient "art." |
| No logo | `logo_initials` tile (existing `TeamLogo` behavior). |
| 60-char name, 5-sentence tagline | Hero title `clamp(24px,6.4vw,36px)`, 2-line clamp + ellipsis; tagline 2-line clamp. |
| Youth tournament pinned | Impossible at write (RPC refuses) AND filtered at read (`.neq('is_youth', true)`). |
| Loading | Geometric skeleton matching hero + chip strip + two event cards exactly (`ui/Skeleton`). No spinners. |
| Error | `ui/ErrorState` with retry; `useOnline`/OfflineBanner already global. |

### Saturday Night Test

Anon-cacheable page; one operator query + one bounded events query + one bounded
live-status query (`limit` on everything); Realtime subscription (no polling),
unsubscribed on unmount; images through `ui/Img` (no CLS) and the existing compression
pipeline; page module lazy-loaded so it adds nothing to the core bundle.

### Success metrics

- **Primary (operator pull):** an operator/prospect forwards their `/o/:slug` link or
  asks to add events to it — tracked via `operator_page_view` uniques per slug.
- **Funnel:** signups with `acquisition_ref = <slug>` (existing rollup views).
- **Sales-cycle proxy:** every outreach email post-ship leads with an operator link
  instead of the raw demo-league link.

### Rollout

1. Migration `supabase/migrations/2026MMDDHHMMSS_c12_featured_operators.sql` —
   idempotent, prod-shape-tested on the PGlite harness first
   (`scripts/lrs-smoke/pglite-migrations.mjs` precedent; the
   `migration_prod_shape_testing` rule), then applied via Supabase MCP
   `apply_migration`. **Gate-1 approval covers writing the file; the apply happens in
   Stage 2, after sign-off.**
2. Seed via admin RPCs (not raw SQL): operator `xrhl` (XRHL league pinned) as the live
   proof; a `demo` card pinning Capital City + Lakeshore for screenshots.
3. Frontend ships dark: public route reachable only by link; zero nav/Home changes.
   `get_advisors` (security) run post-apply.
4. **Wave 2 (same sprint, after page works):** rich link unfurls — add `/o/:path*` to
   `middleware.js` `matcher` (`middleware.js:11`) + `operatorMeta()` fetcher and reuse
   `api/og.js` for a 1200×630 operator card. An outreach link that unfurls with the
   operator's brand IS the pitch; today event pages unfurl as the generic site card.
   → **D-C12-3**
5. Stage 3 adversarial QA (fresh Opus 4.8 session) → 🚦 GATE 2 → merge → Decision Log.

---

## 1c. UX / Design Review (vs DESIGN_MANIFESTO.md + tokens.js)

### Page anatomy (top → bottom, one screen of scroll on mobile)

1. **Operator hero (full-bleed)** — reuses the League cover-hero recipe verbatim
   (`src/pages/League.js:643-670`): `heroBg = brand_color || C.navy`; cover photo
   `object-fit: cover` with the proven scrim
   `linear-gradient(180deg, ${heroBg}D9 0%, rgba(7,17,31,0.45) 45%, rgba(7,17,31,0.94) 100%)`;
   no-photo fallback = brand-color panel (XRHL precedent). Logo 64 (`TeamLogo`), name in
   `type.hero` family — Barlow Condensed 900 italic uppercase,
   `clamp(24px,6.4vw,36px)`, 2-line clamp. Sub-line = the partner-safe positioning
   sentence, `C.ice` → `colors.muted` metadata. Hero corners `radii.hero` (4) if inset,
   0 if full-bleed — sharp, never pillow-y. **LIVE pill (red `#D72638` + ring-expand
   pulse on `motion.duration.pulse`) appears ONLY when a pinned event has a live game**
   (`League.js:666-668` pattern) — red stays action/live-only.
2. **Co-brand line** — one quiet row: "Results sync in from {platform_label} ·
   {name} stays the source of truth", `type.meta`, `colors.muted`, optional
   `website_url` link-back. Absent when `platform_label` is null (show-only-when-present).
3. **Chip strip — "THEIR EVENTS"** — `ui/SectionHeader` label (broadcast lower-third,
   `live` prop when any event is live), then a thin horizontally swipeable strip
   (Home live-ticker energy, NFL RedZone reference from the design kickoff):
   - Chip = event logo 24 + name (Barlow Condensed 700 uppercase, ellipsized) on
     `colors.surface`, `1px C.border`, **`radii.chip` (6)** per the corner philosophy
     (badges/chips 6px — not the 999 pill, which is reserved for buttons).
   - **Live chips sort first** and carry the red dot + `shadows.live`; non-live chips flat.
   - `min-height: 44px` tap targets; `scroll-snap-type: x mandatory`; next chip peeks
     at the right edge (padding trick) to signal "more"; `overflow-x: auto`, no scrollbar.
   - Tap → `/league/:id` or `/tournament/:id`. Order = `sort_order`.
4. **LIVE NOW** — only when live games exist: existing
   `Gameday/LiveGameCard` cards (reuse, not reinvent), `SectionHeader live`.
5. **Events grid** — one `ui/Card` per pinned event (logo, name, season/dates, team
   count if cheap), the page's meat when nothing is live.
6. **Footer CTA** — single `ui/Button` primary pill: "Run your events on Rinkd" →
   `/pricing`. **One primary action per screen** is the hero/chip tap into an event;
   the footer CTA is quiet-secondary styling if that reads as competing — build-time
   call, default `variant="secondary"`.

### Manifesto compliance checklist

- **Color intent:** red = live/CTA only; brand/accent colors come from the operator
  row exactly as League does (`accent_color || C.red`, `logo_color || C.navy` —
  `League.js:570-576`); gold unused (nothing award-y here); `onAccent` for text on
  saturated brand panels.
- **Type:** hero = Barlow Condensed 900 italic; section heads = `type.sectionHead`
  via `SectionHeader`; metadata = `type.meta` muted. Numbers (if any) = `StatNumber`.
- **Motion:** entrance fade+rise at `motion.duration.entrance`/`easing.out`; press
  physics via the app-wide pressable class (S09); live ring on `duration.pulse`;
  nothing over 400ms; all gated on `prefers-reduced-motion`.
- **Imagery:** real photography or brand panel — no gradients-as-art, no stock
  hockey clip-art.
- **On-system:** imports `{ colors, C, type, space, radii, shadows, motion }` from
  `src/lib/tokens.js`; uses `ui/SectionHeader, Card, Button, Tag, EmptyState,
  ErrorState, Skeleton, Img, Icon`; **no local `const C`, no hardcoded hex** (the two
  scrim rgba stops mirror the existing League/Home hero constants).
- **A+ rubric (S01) self-check:** Obvious ✓ (one page, tap an event) · Premium ✓
  (broadcast hero + lower-thirds) · Fewer taps ✓ (link → branded page → event, 2 taps
  to live) · On-system ✓ · State resilience ✓ (skeleton/empty-invitation/error-retry)
  · Stress-safe ✓ (table above) · Scalable ✓ (bounded queries, Realtime, lazy route)
  · Apple-shippable — QA judges.

### Grandparent Test walk-through
Grandparent gets a text with `rinkd.app/o/crystal-fieldhouse` → opens to a branded page
with the rink's logo → the one obviously-live red chip is first → one tap → live game.
No login, no tutorial, no dead end.

---

## Decisions for Pete at Gate 1

| # | Decision | Recommendation |
|---|---|---|
| D-C12-1 | Link table: two nullable FKs + `num_nonnulls=1` check vs FK-less polymorphic | **FKs** — integrity + clean cascade on admin deletes; footgun-checked above |
| D-C12-2 | Writes via admin DEFINER RPCs vs RLS write policies | **RPCs** — server-side slug/youth/public validation; matches `admin_set_activation` |
| D-C12-3 | OG unfurl for `/o/:slug` in this sprint (Wave 2) | **Yes** — the unfurl in an outreach email is half the value |
| D-C12-4 | No nav entry; link-only surface | **Yes** — zero clutter; revisit if operators ask for discovery |
| D-C12-5 | Operator slug seeds `acquisition_ref` first-touch attribution | **Yes** — free funnel measurement per operator |
| — | Also in scope: `admin_set_featured` RPC + pin toggles (finally makes `is_featured` a product control, not raw SQL) | **Yes** — closes the collection's pinnable-inventory item |

**🚦 GATE 1 — awaiting sign-off. On approval: Stage 2 (Opus 4.8) implements exactly
this spec on a feature branch; migration applied via MCP after PGlite prod-shape test;
then Stage 3 adversarial QA → GATE 2.**
