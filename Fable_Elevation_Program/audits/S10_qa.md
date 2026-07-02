# S10 — Enterprise Polish · Final Adversarial QA

*July 2, 2026. Read-only diligence of `feature/s10-enterprise-polish` vs `main`
(10 commits, 38 files, +1371/−441). Highest-priority verification: the
destructive-action flows (deletes, disconnects, unlinks, role removals) rewrapped
in the new `ui/ConfirmSheet` primitive + `useUndoable`.*

## VERDICT: **SHIP**

Zero P0. Zero P1. The destructive-flow contract holds everywhere; server-call
semantics are byte-identical to `main`; the protected S05–S09 markers and the
AdminAnalytics pilot scorecard are untouched. Three low-severity NOTES below,
none blocking.

---

## 1. Destructive-flow correctness — PASS (all 14 conversions)

Traced every new ConfirmSheet/useConfirm wiring and both useUndoable conversions.

### ConfirmSheet / useConfirm (irreversible class)
| Site | Cancel aborts? | Confirm = old call + args? | Stale-row risk | Host mounted? |
|---|---|---|---|---|
| LeagueManage division-delete | ✅ `if(!ok)return` | `deleteLeagueDivision(div.id)` | none (map param) | ✅ ConfirmSheetHost |
| LeagueManage HockeyShift disconnect | ✅ controlled, `busy`-locked | identical body | none | controlled `<ConfirmSheet>` |
| LeagueManage GameSheet unlink | ✅ `dropTarget` state, cleared both paths | `removeLeagueLink(lk.id,leagueId)` | none (target snapshot) | controlled |
| TournamentManage division-delete | ✅ | `deleteDivision(d.id)` | none (map param) | ✅ host |
| TournamentManage team-delete | ✅ | `deleteTeam(team.id)` | none (prop) | ✅ host |
| TournamentManage schedule regen | ✅ `if(!ok)return` | wipe/rebuild path unchanged | none | ✅ host |
| TournamentManage bracket-game delete | ✅ inline async | `deleteGame(g.id)` | none (map row) | ✅ host |
| TournamentManage scorer-remove | ✅ | `removeScorer(roleId)` | none (param) | ✅ host |
| TournamentManage director-remove | ✅ | `removeDirector(roleId)` | none (param) | ✅ host |
| TournamentManage GameSheet unlink | ✅ | `removeLink(lk.id,tournamentId)` | none (param) | ✅ host |
| TournamentCreate schedule regen | ✅ `&&…)return` short-circuit intact | onChange('games') path unchanged | none | ✅ host |
| AdminPanel rink-delete | ✅ `confirmTarget` state, cleared both paths | `deleteRink(id)` | none | controlled |
| AdminModeration content-delete | ✅ `removeTarget` state, cleared both paths | `.from(table).delete().eq('id',id)` | none | controlled |
| RinksideEditor article-delete | ✅ `if(!(await…))return` | `deleteArticle(articleId)` | none (page-level) | ✅ host |

- Every conversion preserves the early-return: `if (!(await confirm(...))) return;`.
  A cancel resolves `false` and aborts before any write. No fallthrough anywhere.
- Row/id is captured as a `.map()` closure or handler **parameter** at call time,
  or into a dedicated pending-target state var that's read back and cleared on
  BOTH confirm and cancel. No stale-closure / wrong-row deletes.
- Async races: `useConfirm` resolves on a single `setState`; the confirm button
  is `busy`-lockable; Escape/backdrop honor `busy`. Bracket-game delete's inline
  async `onClick` belongs to a specific `g` row — no cross-row bleed.
- **Unmount-while-open** (note, not a defect): `useConfirm`'s promise leaks if the
  page unmounts with the sheet open (React state setter on an unmounted tree is a
  no-op; the awaiting handler is GC'd with the component). Acceptable — no write
  fires, no crash.

### useUndoable (reversible class) — PASS
- **LeagueManage team-remove** & **TeamManage roster-remove** both use the S09
  `useUndoable`. `apply()` performs an optimistic client-state removal and returns
  a **synchronous** restore closure (`setTeams/​setMembers(prev)`), not a network
  re-add. `commit` fires the real DELETE + `load()` reconcile.
- The primitive's `settle()` check-and-set guarantees the irreversible commit
  fires **exactly once**, can never race a late Undo tap during fade-out, and is
  cancelled by Undo. Each `runUndoable` call owns its own `settled/timer/flush`,
  so **rapid delete→undo→delete cannot double-fire**. Restore re-insert guards
  against duplicates. `pagehide` drains pending commits so a mid-window reload
  doesn't resurrect a deleted row.
- NOTE: TeamManage's comment says restore is "a full re-add via `addTeamMember`" —
  the code actually restores from client state (safer, no network). Comment is
  stale/misleading; code is correct.

### Classification judgment — sound
Bracket-game delete carries score+stats (not cleanly reversible) → correctly
`ConfirmSheet`, not `useUndoable`, despite W2c listing it as reversible. This is
the conservative, correctness-first call and is consistent with Rinkd's
"correctness > convenience" rule.

---

## 2. alert() → toast control flow — PASS

Sampled the `return alert()` guard sites (highest risk) plus consumer conversions:
- **TournamentCreate `warn()` helper** (the critical one): `const warn = (m) => { toast(...); };`
  returns `undefined`, so `return warn(...)` exits the function exactly like the old
  `return alert(...)` did. All four generate-guards (`teamList<2`, `!genStart`,
  `isNaN(cursor)`, `!games.length`) keep their early return byte-for-byte.
- LeagueManage logo-upload, TeamManage logo-upload, Profile push/upload,
  Notifications, Messages: every converted guard that was `{ …; return; }`
  retains its `return`. `grep` confirms **zero** bare `alert(` left in Profile,
  Notifications, Messages, TeamManage settings, LeagueManage.
- No converted guard lost its return. No P0.

---

## 3. Regression sweep — CLEAN

- **S05:** `approveAllPaid`, `promoteToTeam` — only button style/Icon-chrome
  changed; handler names + call args identical (`onClick={approveAllPaid}`,
  `onClick={() => promoteToTeam(r)}`). `confirmExisting`, `byRound`,
  `splitTeamNames`, LeagueCreate wizard division inserts — **not touched** by diff.
- **S06–S09:** `hideNames`, `scorersHidden`, `__pending`, `LiveLowerThird`,
  `GAME DAY`, tab slide indicator — **zero** diff-line hits. `IndeterminateBar`
  export intact (unchanged import context line only).
- **AdminAnalytics:** the 37-line change is loading-skeleton + not-admin lock icon
  + error icon ONLY. Pilot-scorecard / denominator render is byte-identical.
  Retry pre-existed.

---

## 4. Skeleton / visual safety — PASS

- Every new skeleton renders in the **same conditional slot** as the old bare
  text (`if (loading) return <Skeleton>` or `loading ? <Skeleton> : empty ? … :
  content` ternaries). No double-render with content.
- LeagueManage guard order is correct: `if (loading)` (line 407) precedes
  `if (!league)` ErrorState (line 412) → ErrorState can't shadow loading.
  `loadError` reset at load start, set only in `catch`.
- **Icon catalog:** every new `<Icon name=…>` across the diff (incl. both dynamic
  ternary names) resolves to a real catalog key — alert, approved, build,
  calendar, camera, close, connect, copy, delete, export, fan, lineup, link,
  live, privacy. **Zero** unknown names → no runtime blank/crash.

---

## 5. Share pipeline — PASS

- ShareButton moves `shareCard` + `recapShareV2` (pulls the ~40KB `qrcode` lib)
  to `import()` inside `onShare`, fired **before** the first `await` for iOS
  user-activation timing, awaited only right before compose.
- **Failure path:** a rejected `import()` (offline) throws inside the compose
  `try` → `catch` sets `setErr(true); setBusy(false); return;` → the error state
  shows, no crash. `getCard()` still called correctly.

---

## 6. Globals — PASS

- **`:focus-visible` ring:** restored in `index.css`, scoped to `:focus-visible`
  ONLY (never plain `:focus`), uses `outline` + `outline-offset` (not box-shadow)
  so it survives on shadowed elements and doesn't destroy inputs' existing focus
  styles. Valid syntax.
- **ConfirmSheet a11y:** `role="alertdialog"`, `aria-modal`, `aria-label={title}`,
  Escape + backdrop cancel (both `busy`-guarded), confirm button `loading` lock.
  New keyframes carry a `prefers-reduced-motion: reduce` gate. No new ungated
  animations introduced by the diff (Skeleton shimmer already gated).
- **Build:** all 35 changed src files parse clean (babel react+env). `ui/index.js`
  barrel exports `ConfirmSheet`/`useConfirm`/`ConfirmSheetHost`; every barrel
  import in the touched files resolves.
- **Ticket-7 confirms verified UNTOUCHED:** ScorerView ×3, EditGameModal ×2,
  PostActionMenu (block/report), TeamManage schedule ×2, Profile push-off ×1 all
  still `window.confirm` — intentional deferral honored.

---

## NOTES (non-blocking)

1. **Profile block-user `window.confirm` (Profile.js:361)** remains native and is
   NOT enumerated in the ticket-7 list (which named only "Profile push-off ×1").
   It's block/report class (same as PostActionMenu's ticket-7 items), untouched by
   this diff, so leaving it is behaviorally correct — but fold it into the ticket-7
   ConfirmSheet pass for completeness so no native dialog survives.
2. **TeamManage roster-remove comment is stale** — says restore re-adds via
   `addTeamMember` (network); code restores from client state (correct, safer).
   Fix the comment.
3. **`index.css` focus-ring adds `border-radius:4px`** to every `:focus-visible`
   target including inputs — a subtle corner-radius change on keyboard focus for
   controls with their own radius. Cosmetic; drop the `border-radius` from the
   shared rule if it reads oddly on real devices.
