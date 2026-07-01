# C01 Token Migration — Adversarial QA (WORKFLOW stage 3)

Branch: `feature/c01-token-migration` · diff vs `main` · 111 files, +795/-892
Reviewer did NOT author this code. Read-only git. Nothing fixed here — report only.

---

## VERDICT: FIX-FIRST

The migration is ~99% faithful. The author clearly understood the contract:
exact-match hex → token, drifted/extra values → preserved as named local
constants (`GAL_BLUE`, `MODAL_RED`, `localC`, `LOCAL`, etc.), composite palettes
aliased (`C as tokensC` / `C as sharedC`). Share-card byte-identity holds. Youth
privacy untouched. No broken refs introduced, no invalid-CSS alpha concats
introduced, no logic scope-creep.

**But two files break the "preserve drift" rule the rest of the diff follows:**
`PostReactions.js` and `Mentions.js` deleted local palettes whose `blue` was
`#5B9FE2` and `border` was `rgba(46,91,140,0.5)`, and let those usages fall
through to the shared `C.blue` (`#2E5B8C`) / `C.border` (`0.4`). One of those is
a visible color change on a rendered element. That is an unsanctioned visual
delta → FIX-FIRST before merge (make them mirror the Gallery.js pattern:
preserve `#5B9FE2` / `0.5` as locals).

---

## P0 — broken refs / invalid CSS

**None introduced by this migration.**

- Full-tree grep of every `C.<key>` / `colors.<key>` vs the real key sets:
  all off-roster keys (`C.line`, `C.strip`, `C.navyHi`, `C.green`, `C.amber`,
  `C.ink`) resolve to a **sanctioned composite** palette in their own file
  (shareCard/recapShareV2 spread, TournamentManage `...sharedC`, PublicGame
  `...tokensC`). Every composite exposes every key its file uses. Verified.
- Alpha-concat sweep (`C.x + 'NN'`, `${C.x}NN`, `${colors.x}NN`): every hit is
  on a **solid-hex** token (`C.blue #2E5B8C`, `C.red #D72638`, `C.dark #07111F`,
  `C.amber #F59E0B`, `colors.warning #F59E0B`). **Zero** concats on an rgba
  token (`C.border`, `colors.border/borderAccent/redGlow/blueGlow`). The one
  rgba-concat that existed (NavPins `C.border + '66'`) was correctly fixed to
  bare `C.border`. Clean.
- Imports: no missing tokens import, no duplicate import, all relative paths
  correct, all 4 composite files alias the shared import. (Two grep false
  positives — `ui/Icon.js` uses `C.red` only in a JSDoc comment; `ComingSoon.js`
  imports `C` from `Layout` and is **not in this diff**.)

### Pre-existing latent bug (NOT this migration — do not gate on it)

- `src/pages/Profile.js:397` — `color: C.muted`. Shared `C` has no `muted` key
  (it's `steel`); this renders `color: undefined`. **Identical on `main`** — the
  migration did not touch this line. Worth a separate cleanup chip
  (`C.muted` → `C.steel`), out of scope for the C01 verdict.

---

## P1 — unsanctioned visual deltas (FIX-FIRST)

**1. `src/components/PostReactions.js:110` — reaction chip border darkened.**
Deleted local `blue: '#5B9FE2'` → now `C.blue = '#2E5B8C'`.
```
border: `1px solid ${mine ? C.blue : C.border}`
```
The "mine" chip's border was bright sky-blue `#5B9FE2`; it is now the darker
rink-blue `#2E5B8C`. The chip **fill** right above it is still hardcoded
`rgba(91,159,226,0.22)` (= `#5B9FE2` @ 22%), so post-migration the fill is bright
blue but the border is dark blue — a mismatch that did not exist before.
Old → new: `#5B9FE2` → `#2E5B8C` (border only). Not a sanctioned legacy-key
convergence (only navy/card/border card-drift was sanctioned; a brighter local
`blue` collapsing to the muted token was not).
FIX: preserve `#5B9FE2` as a local const (mirror Gallery's `GAL_BLUE`).

**2. `src/components/PostReactions.js` + `src/components/Mentions.js` — border
alpha 0.5 → 0.4.** Both deleted local `border: 'rgba(46,91,140,0.5)'`; usages now
resolve to shared `C.border = 'rgba(46,91,140,0.4)'`. Minor (alpha 0.5→0.4 on
1px borders / dropdown / reaction picker). In-spirit-ish but still a
non-exact-match value change that wasn't on the sanctioned list.
- Mentions.js: `blue: '#5B9FE2'` here was a **dead key** (never rendered) — no
  color impact; only the border-alpha delta applies.
FIX (optional but recommended for consistency): preserve `0.5` as a local, or
get explicit sign-off that border 0.5→0.4 convergence is acceptable app-wide.

---

## Verified clean (evidence)

- **Share-card byte-identity (P4):** every swap in `lib/shareCard.js` and
  `lib/recapShareV2.js` is value-identical — `dark #07111F`, `navy #0B1F3A`,
  `blue #2E5B8C`, `red #D72638`, `ice #F4F7FA`, `steel #8BA3BE`, `GOLD #C9A84C`,
  `colors.muted #8BA3BE`, QR/plate fallback `colors.surfaceDeep #07111F`,
  `PALETTE[0/1]` = `colors.blue/red`. Non-token literals (`#13335c`, `#0a1830`,
  `#4a93e6`, `#060c15`, `#1F9E6B`, `#9333EA`, `#E08A1E`, `#0EA5E9`) correctly
  left as literals.
- **Youth-privacy adjacency (P5):** `StatLeaderboards.js` diff is colors-only.
  `renderRowId`, `revealNames`, `shareMeta`, jersey-suppression
  (`r.jersey_number != null ? '#…'`) all untouched. `C.text #F4F7FA` → `C.ice
  #F4F7FA` byte-identical; `localC.dim/dim2/faint/line/cardHdr` preserved;
  `accent '#D72638'` → `C.red` and GameSheet-embed hex extraction identical.
- **Drift-preservation pattern applied correctly** in Gallery
  (`GAL_STEEL #9BB5D6`, `GAL_BLUE #5B9FE2`, `GAL_BORDER #1F3553`, dim/panel),
  EditGameModal (`MODAL_CARD #0E2036`, `MODAL_RED #E2342B`), SponsorsManager /
  LeagueStaffManager (`LOCAL/localC` dim/panel/green/amber; `#E26B6B` →
  `colors.redSoft` byte-identical), Skeletons / SeasonGamePucks (`localC`
  shimmer/dim/faint/line rgba preserved). PostReactions/Mentions are the only
  files that DIDN'T follow this pattern → the P1 above.
- **Exact-match color arrays** (`AVATAR_COLORS`, `LOGO_COLORS`, `PALETTE`,
  `DEFAULT_TEAM_COLOR`, `TOURN_BLUE`, `GAME_RECAP_TAG_COLOR`) all map
  `#D72638→red`, `#2E5B8C→blue`, `#22C55E→success`, `#F59E0B→warning`,
  `#8B5CF6→premium`, `#0B1F3A→navy` with non-token stops left literal. Faithful.
- **Documented behavior-preserving fixes** all present & correct: NavPins
  alpha-concat drop, TeamManage `C.muted→colors.muted` (+ bonus `#C9A84C→C.gold`),
  LeagueStaffManager `colors.redSoft`.
- **Scope creep (P6):** none. Non-color diff lines are only palette-deletion
  `};` artifacts and color-const references. No logic/behavior edits.

---

## Notes

- The sanctioned card/border convergence (`#112236→#0f2847`, `#1E3A5C→rgba`) is
  present and correct in the many `card:/border:` palette deletions.
- Recommend the fix reuse Gallery.js as the reference pattern for
  PostReactions/Mentions so the whole diff is internally consistent (drift → local
  const, exact-match → token).
