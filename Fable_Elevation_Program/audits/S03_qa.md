# S03 — First Impression: Stage-3 Adversarial QA

*July 1, 2026. Branch `feature/s03-first-impression` vs `main` — one commit
(`812c9395`), 4 source files: Landing.js, Auth.js, Home.js, OnboardingModal.js.
Read-only review. Verified against the S01 A+ rubric + the S03 contract
(`audits/S03_first_impression.md`).*

---

## VERDICT: SHIP (one P1 nit worth a 1-line fix first)

The diff is contract-clean. No nav/route/data/query changes, no new
colors/fonts/easings, every animation reduced-motion gated, no functional change
to Turnstile/COPPA/signup. All four files parse (Babel). All new imports are
used. DatePill and the vanity stat-bar map are fully removed (zero leftover
refs). All Icon names on Landing (`live`/`calendar`/`teams`/`analytics`) exist
in `components/ui/Icon.js`. The one real finding is a cosmetic press-physics
no-op on the Auth CTAs (P1) — everything else is clean or notes.

---

## P0 — none

## P1

### P1-1 — Auth CTA press shadow-collapse never fires (inline beats stylesheet)
`src/pages/Auth.js:594`
```css
.auth-cta:active:not(:disabled) { transform: scale(0.97); box-shadow: 0 2px 8px rgba(215,38,56,0.35); }
```
Every `.auth-cta` button carries an **inline** `boxShadow` (via `ctaBase =
{ boxShadow: shadows.heroRed }`, and the submit buttons re-set
`boxShadow: loading ? 'none' : shadows.heroRed`). Inline styles beat a
non-`!important` stylesheet rule, so the intended **shadow collapse** on press
is a no-op on Auth. D-S03-2 spec explicitly says "press collapses the shadow +
scales 0.97" — the scale works (no competing inline transform), the shadow
collapse silently doesn't.

Landing gets this right — `.ld-tap:active` uses `box-shadow: … !important`
(Landing.js:19). Auth just needs the same `!important` for parity.

**Fix (1 line):** add `!important` to the Auth `:active` box-shadow:
`box-shadow: 0 2px 8px rgba(215,38,56,0.35) !important;`

Impact: purely the depth-of-press feel on the shipped auth form. Not a
functional or a11y break. Non-blocking, but it's the exact polish this sprint
exists to deliver, so fix-first is cheap.

---

## Notes (verified clean — no action)

- **`key={step}` remount (OnboardingModal.js:302) is SAFE.** The checklist
  flagged this as a potential state-clobber. Confirmed harmless: every piece of
  state read inside the keyed Body (`chosenRole`, `suggested`, `suggestLoaded`,
  `followingMap`, `step`) lives in the **parent** `OnboardingModal`, above the
  keyed div. There is no text `<input>` in the Body (role buttons + follow rows
  only), so no focus is lost on step change. The suggestions skeleton is driven
  by parent `suggestLoaded`, not local state — the remount does not restart it.
  The crossfade behaves as spec'd.

- **Reduced-motion gating complete on all 6 new classes.** `.ld-in`/`.ld-tap`
  (Landing), `.home-in` (Home), `.ob-in`/`.ob-step-in` (Onboarding), `.auth-cta`
  (Auth) all disable under `prefers-reduced-motion`. Because the RM blocks set
  `animation: none`, the `both` fill-mode is dropped and delayed elements render
  at opacity 1 — no invisible-content flash under reduced motion.

- **Template-literal interpolation is real, not shipped literally.** All four
  `${motion.duration.*}` / `${motion.easing.out}` sites sit inside genuine JS
  template literals (`LANDING_CSS`, `HOME_CSS`, and Onboarding's
  `<style>{`…`}</style>`), so they interpolate. Token vocabulary is honored:
  `entrance` (250), `exit` (200, used for the ob step crossfade — matches the
  "200ms" spec), `press` (100), `easing.out` — all exist in `tokens.js`.

- **Motion vocabulary — no new easings/durations.** The `.ld-tap`/`.auth-cta`
  hardcode `box-shadow 150ms ease` and `rgba(215,38,56,0.35)` press shadow.
  These are transition timings / a shadow value, not entries in the
  duration/easing/color token maps, and Landing's pre-existing CTA already used
  the same `rgba(215,38,56,…)` red — so this is within the established
  vocabulary, not a net-new token. Acceptable.

- **Skeleton fidelity — within tolerance (< ~8px cumulative first fold).**
  `HomeSkeleton` now mirrors the real fold: `SkHeader top=18` matches
  `FeaturedHero`'s `section marginTop:18`; hero block `168 + 1 + 43 = 212`
  matches real hero (`minHeight 168` photo + `~44` footer bar); Your-Hockey rows
  `78×2 + 8` and This-Week tiles `158×176` match `tileStyle`. Minor deltas:
  each `SkHeader` bar is ~18–20px tall vs the real `SectionHeader` slab (~34px
  incl. 8+8 padding), and header `marginBottom` is 10 vs real 12. Net hydrate
  shift is small and mostly below the first header; well under the 8px-in-first-
  viewport bar the checklist sets. No action.

- **Landing 320px stress — clamp math holds.** Headline `clamp(44px, 16vw,
  64px)`: at 320px, 16vw = 51.2px (inside the clamp), condensed "WHERE HOCKEY"
  ≈ 51.2px × (317/64 measured ratio) ≈ 254px — fits a 320px viewport with the
  page's 16px gutters. Feature chips: 2-col grid, `maxWidth 360`, each cell
  ~166px; longest label "Stats & leaderboards" (`fontSize 12.5`) with the 30px
  icon + 9 gap leaves ~118px for text — the label has `overflow:hidden;
  textOverflow:ellipsis` and the row has `minWidth:0`, so it truncates cleanly
  rather than blowing out the grid. Defensive-UI compliant.

- **Auth loading/disabled states.** `'Sending…'`/`'Signing In...'`/`'Creating…'`
  text swaps preserved; disabled `boxShadow: 'none'` confirmed on the two submit
  buttons and forgot-form button. Mode-switch buttons (`Back to Login`, etc.)
  spread `...ctaBase` (never disabled) — fine.

- **A11y.** Tap targets keep min height (Auth submits `padding 14px` on
  `fontSize 18` ≈ 60px; Landing CTA `16px 22px`; onboarding follow pills
  unchanged). Press/entrance classes are `:active`/`animation` only — no
  `:focus`/`:focus-visible` override, so the existing focus ring is intact.
  Marketing-consent checkbox + Turnstile untouched.

- **Cosmetic:** `<div className="home-in">{<LiveTicker …/>}</div>` (Home.js:110,
  113) has a redundant `{…}` JSX-expression wrap around the child element.
  Harmless, parses fine — flag only if a lint pass complains. Not worth churning.

---

## Diff-discipline ledger
- Nav/routes: unchanged ✓
- Data model / queries: unchanged ✓
- New colors/fonts/easings beyond tokens.js: none ✓
- Reduced-motion gating: complete (6/6 classes) ✓
- Turnstile / COPPA / signup behavior: untouched ✓
- Home section wrappers: pure presentational `<div>` wrappers; conditional
  render predicates (`data.ticker?.length`, `isOperator`, `data.live.length`,
  `data.hasFollows && …`) preserved verbatim — no semantic change ✓
