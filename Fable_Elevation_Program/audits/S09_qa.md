# S09 — Micro-interactions · Adversarial QA

*July 2, 2026. Read-only review of `feature/s09-micro-interactions` (2 commits,
17 source files) vs `main`, against the Gate-1 / D-S09-1 contract in
`S09_micro_interactions.md`. Tab indicator already browser-verified on the
public demo league; everything else reviewed by trace.*

## VERDICT: SHIP

No P0. No data-correctness defect. The one substantive finding (P1) is a
*silent no-op*, not a regression — the feature under-delivers on some surfaces,
nothing breaks. Ship S09; fold P1 + the notes into S10's component-adoption
pass.

---

## P1 — D-S09-1 hover lift silently does nothing on the `Card` primitive (and LiveGameCard)

The decision log records "shadows.hover APPLIED app-wide via the shared
pressable class." It is not, on the surfaces that matter most.

- `index.css`: `.rinkd-pressable:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.4); }`
  — a **stylesheet** rule.
- `components/ui/Card.js` sets `boxShadow` as an **inline style**
  (`shadows.resting` / `shadows.heroBlue` / `shadows.live`, lines 22/27/32/54)
  and only attaches `.rinkd-pressable` when `onClick` is set (line 49).
- Inline styles beat stylesheet `:hover` by specificity → **every `<Card onClick>`
  keeps its resting shadow on hover. The lift never fires.**
- Same for `Gameday/LiveGameCard.js` line 67 (inline `boxShadow: shadows.live`).

Net: the hover lift only actually appears on plain `<div className="rinkd-pressable">`
rows that carry no inline `boxShadow` (Discover rows/cards, Teams rows, Messages
inbox rows, Notifications rows, ReciprocityNudges, HypeCard, nav Link/More). No
element gets a *wrong* lift — the class was applied only to genuine tappables
(all 18 usages audited; no full-page container, no input). So this is
under-coverage, not breakage. Correct fix for S10: make `Card` merge a hover
`boxShadow` into its own inline style (e.g. via an `onMouseEnter`/`onMouseLeave`
or a token-driven hover variant), since the CSS hook can't reach past an inline
shadow.

## P1 (minor) — DM optimistic bubble can double-render for one frame under echo-before-response

`Messages.js` `Thread`: the realtime handler dedups on **real** id only
(`prev.some(x => x.id === m.id)`), and the temp bubble carries a `temp-…` id.
Arrival-order trace:

- **echo-after-response** (common): `data` resolves → temp mapped to real →
  later echo sees real id present → deduped. Single bubble. ✅
- **echo-before-response** (slow rink wifi, server push beats the insert HTTP
  response): echo appends the **real** row (temp id ≠ real id, so not deduped) →
  list briefly holds **both** temp ("sending…") and real (same body). When
  `data` finally resolves, `realAlreadyIn === true` → temp is filtered → single
  bubble. So it **self-heals**, but there is a visible duplicate for the gap
  between the socket echo and the awaited response. ⚠️ cosmetic, transient.
- **failure-after-echo**: can't happen for a persisted row — if the echo
  arrived the insert committed, so `error` is null on that path.

Not a data bug (never persists a duplicate, never drops the message). If you
want it gone, the send's dedup already handles it on resolve; the only way to
kill the flash is to have the realtime handler also ignore a row whose
`(sender_id, body)` matches a still-pending temp — not worth it for S09.

Failure path is correct: temp bubble filtered out, draft restored, toast fired,
`sendMessage(conversationId, body)` call is **byte-identical** to `main` (same
two args, `body = draft.trim()`). Temp bubble only reads `body/sender_id/
__pending/created_at` (all present on `tempMsg`); it shows `'sending…'` not
`timeAgo`, so the client ISO timestamp is never rendered. Bubble reads no sender
embed. Safe.

### Draft-clobber on failure (behavior note, not a bug)
On send the draft is cleared immediately (optimistic). If the user types a new
draft while the request is in flight and it then **fails**, `setDraft(body)`
overwrites whatever they just typed with the original failed text. Clobber risk
exists but is the same tradeoff CommentThread ships and is low-probability
(typing a *second* message during a 1–2s in-flight send). Acceptable; note for
parity review if CommentThread's pattern ever changes.

---

## Verified clean

**M1 — six modal/sheet entrances.** All entrance-only (close/unmount untouched),
all reduced-motion gated, **all keyframe names unique** (`rinkd-egm-*`,
`rinkd-lm-*`, `rinkd-sbm-*`, `rinkd-help-*`, `rinkd-pam-*`, `rinkd-fade-in`) —
grep confirms zero duplicate `@keyframes` names app-wide and no collision with
existing `rinkd*` keyframes. Tokens used (`entrance 250`, `sheet 350`, easings).
The **only** logic touch is PostActionMenu's `haptics.tick()` inside the
`setOpen` updater — impure-reducer smell (would double-buzz under StrictMode dev
double-invoke) but functionally harmless; `haptics.tick` exists. SubscribeCalendarSheet's
hardcoded `0.15s` correctly swapped to the `entrance` token. No submit handler,
state shape, or conditional changed in any of the six.

**M2 — sliding tab indicator (League + Tournament).** Identical, correct impl:
- First paint snaps (`tabAnimReady` ref starts `false` → `animate:false` on
  first measure, flipped `true` after). Deep-linked `?tab=` mounts with the
  right `activeTab` and snaps to it — no first-paint slide. ✅
- Indicator lives inside the strip, which is now `position:relative` and is the
  `overflowX:auto` scroll container; `offsetLeft/offsetWidth` are in
  strip-content coordinates → tracks correctly under horizontal scroll. ✅
- Re-measures on tab change (effect dep `activeTab`), `resize`, `load`,
  `ResizeObserver(strip)`, and `document.fonts.ready`. RO **disconnected on
  unmount**; window listeners removed. ✅
- Per-button border replaced with a constant `3px solid transparent` on **every**
  button (active and inactive) → no layout jump when the active tab changes. ✅
- Reduced-motion → `transition:'none'` (bar jumps). ✅
- `useRef`/`useCallback` imported in both; `motion.duration.tab (200)` +
  `motion.easing.inOut` exist. ✅
- Division-picker interplay: `TABS` is static so button widths don't change with
  division; the picker's `setSearchParams` rerender doesn't shift the strip's
  horizontal geometry (offsets are relative to the strip's offsetParent). No
  staleness. The only un-covered reflow is a mid-session font swap that changes
  a button width without changing the strip's border-box (RO wouldn't fire) —
  `fonts.ready` covers the real case; acceptable.

**M3 — press consistency.** `.rinkd-pressable` transition `110ms → 100ms` (press
token) done. Nav `<Link>` + More `<button>` + BackButton: `transition:'all 0.15s'`
→ enumerated `color/background 100ms`; Links get `.rinkd-pressable` (the CSS
`button:active` rule can't reach an `<a>`, so this is the right hook — no
react-router conflict, className is passthrough). `Tag.js` adds `.rinkd-pressable`
**only when `onClick` is set** and merges caller `className` — dead-tap fixed
without lifting non-interactive tags. All 18 `.rinkd-pressable` usages are
genuine tappable rows/cards/buttons/tags (grep-audited).

**M4a — DM optimism.** See P1 above; correct modulo the one-frame flash.

**M4b/M4c — notification dismiss exit + mark-read border.** Server write
(`deleteNotification`) **fires immediately**, animation runs concurrently via a
`setTimeout(exit)` that awaits the already-started promise; on failure the row
is un-marked `leaving` (settles back, stays un-dismissed) + alert. Reduced-motion
path removes instantly with no animation. Mark-read border eases over `tab`.
`motion.duration.exit (200)` exists. Two notes: (1) the `alert()` on failure is
off-brand but **pre-existing** (unchanged from `main`; Messages got upgraded to
`toast`, Notifications didn't — inconsistency, fold into S10). (2) if the delete
network call outlasts `exit` ms, the row is opacity:0 but still holds layout
until the await resolves — cosmetic only.

**M4d — honest upload bars.** Fake `30→80%` steps **fully removed**;
`uploadProgress` state and every ref **deleted** (grep: zero remaining
references anywhere). Shared `IndeterminateBar` exported from `Feed.js`, reused
by Gallery (no near-copy drift). Feed shows it on `posting && mediaFile`,
Gallery on `submitting` — Gallery covers **video** uploads (the heaviest files),
which previously had no bar. Reduced-motion collapses to a static tinted bar
(`.rinkd-indeterminate { animation:none; width:100%; opacity:0.55 }`).
`Gallery` imports `IndeterminateBar` from `pages/Feed` (components→pages
dependency — mild smell) but **no circular import** (Feed does not import
Gallery; verified).

**60fps / diff discipline.** New animations use transform/opacity only, except
the tab indicator which also transitions `width` (layout) — scoped to a 3px bar,
explicitly sanctioned in the contract, acceptable. Route-entrance containing-block
hazard avoided (opacity-only, per motion.js comment). No stray token drift
introduced.

---

## Fix list (all S10, none block ship)
1. **P1** Make `Card` (and LiveGameCard) actually show the hover lift — inline
   `boxShadow` beats the `.rinkd-pressable:hover` CSS rule, so the flagship
   D-S09-1 card lift is currently a no-op on the primitive.
2. **P1(minor)** DM echo-before-response one-frame double bubble — optional;
   dedup pending temp by `(sender_id, body)` in the realtime handler if desired.
3. **Note** Notifications failure still uses `alert()` while the rest of the app
   moved to `toast` — unify.
4. **Note** PostActionMenu `haptics.tick()` inside the `setState` updater →
   move to the event handler body (avoids StrictMode double-buzz, keeps the
   reducer pure).
5. **Note** DM draft-clobber on failure (restores original over any newly-typed
   text) — parity with CommentThread; revisit if that pattern changes.
