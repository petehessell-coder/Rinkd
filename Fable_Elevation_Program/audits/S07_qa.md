# S07 "Social Layer" — Adversarial QA (WORKFLOW stage 3)

Branch `feature/s07-social` vs `main` (3 commits: G1 `7ba50d79`, F `b7d9d2c9`, G+H `4702dc8a`).
Read-only review. Date 2026-07-02.

## VERDICT: **SHIP** (with two non-blocking P1 follow-ups)

No P0. Correctness-critical surfaces — the new RLS table, youth-privacy gates on
the two new surfaces, and the edits inside the race-safe like engine — are all
sound. The two open items are share-polish gaps (H1/H2 on the Profile stat card),
not correctness or privacy defects.

---

## 1. RLS + SCHEMA (G1) — PASS

**`20260702100000_team_subscriptions.sql`**
- All three policies are own-rows-only via `(SELECT public.current_profile_id()) = user_id`:
  SELECT USING, INSERT WITH CHECK, DELETE USING. No way to read another user's
  follows, and no way to insert a row `AS` another user (WITH CHECK binds the row's
  `user_id` to the caller's profile). Matches `league_subscriptions` semantics exactly.
- Composite PK `(user_id, team_id)`; both FKs `ON DELETE CASCADE` (profiles, teams) — sane.
- Secondary index on `team_id` for the service-role fan-out (push), mirroring the
  event-subscription tables. Good.

**Client (`teamSubscriptions.js` + `Team.js`)**
- **No pill-flash for members/managers.** `load()` awaits `Promise.all([… getUserRoleOnTeam …])`
  and sets `userRole` BEFORE `finally { setLoading(false) }`. The header (and its
  Follow pill) only renders after `loading` is false, so `isMember`/`canManage` are
  already resolved — the pill cannot flash before role resolution. The pill's own
  gate is `currentUser && !isMember && !canManage`.
- **`followTeam` upsert semantics correct.** `ignoreDuplicates:true` → `ON CONFLICT
  DO NOTHING`, returns `{ error: null }` whether or not the row pre-existed. So a
  re-follow reads as success and the non-optimistic flip lands on `Following ✓`.
  Already-following ≠ error. `unfollowTeam` on an absent row is a clean no-op (error null).
- Non-optimistic flip: state flips only on `!err`, matching the league/tournament discipline.

## 2. YOUTH PRIVACY — PASS

- **(a) Team.js locked view returns before the header.** The `lockedSummary` early
  return is at ~L163; the header + Follow pill live at ~L458+. A youth team that a
  viewer isn't an insider of takes the locked path (results-only) and never reaches
  the pill. A youth **insider** (parent) can see the full page and may follow their
  own team — harmless (they already have access; the row is their own under RLS).
- **(b) Home followed-team merge is leak-proof.** A non-insider cannot follow a youth
  team (page is locked before the pill). Even a hand-crafted API insert wouldn't
  surface: the merge's `teams.select(explicit cols).in('id', extra)` returns nothing
  for an RLS-hidden youth row, and `getTeamGames` is wrapped in `try/catch → []`
  (non-blocking, degrades to empty, never an error that blocks the member path).
- **(c) `getUserTeams` is SAFE under the youth column gate — VERIFIED.** Memory warns
  `select('*')` ERRORS under Migration C's `revoke select … re-grant explicit columns`.
  That revoke/re-grant applies to **profiles** and **team_members** ONLY — NOT `teams`.
  `getUserTeams` selects team_members columns EXPLICITLY (`id, team_id, user_id, role,
  jersey_number, status`) — all six are in the C grant list — and `team:teams(*)`,
  which is fine because `teams` keeps its full table grant. No error. (Pre-existing fn,
  now first called by G2 — confirmed compatible.)
- **(c) G2 chips fail closed.** Filter is `isOwnProfile || r.team.is_youth === false`.
  Youth or unknown/absent `is_youth` are hidden for non-own viewers; strict `=== false`.
- **(d) H1 stat-card name gate correct.** `shareName = profile.account_type === 'adult'
  ? profile.name : null`. `account_type` IS in `PROFILE_SELECT` (auth.js L17). Any
  non-'adult' value (minor, or null on older adult accounts) fails closed → name
  suppressed → composer falls back to jersey (none on a bare profile → no name).
  NOTE (accepted): legacy adult accounts with `account_type = null` get their name
  suppressed on the shareable card. Conservative-but-safe; acceptable.

## 3. LIKE ENGINE REGRESSION (F) — PASS

- **`handleLike` core is byte-identical to `main`** beyond two additions inside the
  existing `catch`: a `console.warn` and a failure `toast`. The race-safe machinery
  (functional-updater `nextLiked` sentinel, in-flight ref gate, server-truth snap,
  rollback updater) is untouched.
- **`likeAnim` cannot desync count from state.** It's derived purely from `isLiked`
  (post membership in `likedPosts`) via a `useRef(wasLiked)` + `useEffect`; it only
  fires the pop on the not-liked→liked flip and never mutates `likes`. Re-keying
  (`key={h${likeAnim}}` / `c${likeAnim}`) restarts the CSS animation on each add.
  Reduced-motion gated in the shared stylesheet.
- **Optimistic post-create is safe.** Dedup guard `prev.some(p => p.id === id) ? prev
  : [row, ...prev]` blocks a transient double-add before the background `load()`
  reconciles (and `load()` replaces the whole array — no lasting dupe). Error path
  returns early WITHOUT clearing the composer (text preserved) + toast. Grafted
  `profiles: newPost.profiles || profile || null` and `post_mentions: … || []` match
  PostCard's `post.profiles` (avatar) and `mentionMapFromRows(post.post_mentions)` reads.
- F2 toasts wired on all three rollbacks (like, comment, reaction). F3 "React" micro-label
  gates on `active.length === 0`. F4 empty state gates on `loaded && comments.length === 0`.

## 4. HOME MERGE (G1) — PASS

- Followed-team fetch uses explicit columns (`id,name,logo_color,logo_initials,logo_url`)
  — not `*` — so no youth-gate exposure. `teams` public read RLS applies (adult teams
  readable; youth only to insiders).
- `TEAM_HYDRATE_CAP = 5`: follows are appended AFTER member teams then `slice(0,5)`.
  A user with ≥5 member teams never hydrates a followed team — "membership wins,"
  additive-never-blocking. Not a bug; noted as intended.
- `_followedOnly` is set but never read downstream — harmless flag.
- `hasFollows` cold-user path is correct: no follows + no member teams → `teamCount:0`
  → `hasFollows || (your?.teamCount||0)>0` stays false. No wrong-branch flip.
- The whole follow block is wrapped `try/catch` → additive, never blocks the member path.

## 5. SMALL BUNDLES — PASS

- **G3 clamp** applies to the name span ONLY inside the `hasName` branch (ellipsis +
  `display:inline-block; maxWidth:100%; verticalAlign:bottom`). Name-less rows use the
  untouched `else` branch — not broken.
- **G5 `?filter=` validation:** read-once initializer validates `unread`|`all`, else
  `all`. Uses raw `window.location.search` (no `useSearchParams`) — safe because
  Notifications never WRITES query params (verified: no setSearchParams/replaceState),
  so no S04 param-clobber gotcha.
- **G4 loading labels:** League/Tournament/Profile follow buttons now show
  "Following…/Unfollowing…" + `cursor:'default'` + `opacity 0.7`; `disabled` logic
  unchanged (still `disabled={followBusy/followLoading}`). Behavior preserved.
- **H2 append is clobber-safe** for League/Tournament: URLs are freshly built
  `origin/(league|tournament)/${id}?tab=stats` with no pre-existing params.

## 6. DIFF DISCIPLINE + PARSE — PASS

- All 11 touched JS files babel-parse clean.
- S04/S06 tab wiring intact: League/Tournament `initialTabFromUrl` matches `?tab=stats`
  case-insensitively against `TABS` (both include 'Stats') — the H2 deep links land
  correctly on those two pages.
- Nothing outside the contract touched.

---

## FINDINGS

### P1 — H2 not delivered for the Profile stat card (share polish, non-blocking)
`Profile.js` shares the season stat card with `shareUrl={absoluteShareUrl(/profile/${profileId})}`
— **no `?tab=stats`** (contrast League/Tournament, which correctly append it). Worse,
Profile's `activeTab` is `useState('posts')` and the page has **no `?tab=` reader at
all** (S04 wired tabs only on League/Tournament, not Profile). So even adding the param
wouldn't land the recipient on the Stats tab. The contract's "one line per call site"
under-scoped Profile: it needs BOTH the URL param AND a tab-from-url initializer.
Impact: a shared Profile stat card opens on the Posts tab, not the stats it depicts.
Not a correctness/privacy defect. Fix in a fast follow (add `initialTabFromUrl`-style
reader to Profile + append `?tab=stats`).

### Note — legacy `account_type = null` adults (accepted)
H1 suppresses the name on the stat card for any non-'adult' account_type, including
older adult accounts whose `account_type` is null. Fail-closed and safe; flagged only
so Pete knows some legacy adult cards will render jersey-only until backfilled.

### Note — followed teams starve at ≥5 member teams (intended)
`TEAM_HYDRATE_CAP=5` with follows appended last means heavy-roster users won't see
followed teams on Home. Consistent with "membership wins"; documented so it isn't
mistaken for a bug later.
