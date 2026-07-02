# S10 — Enterprise Scorecard (the acquisition audit)

*July 2, 2026. Three parallel diligence audits: operator/admin (12 screens),
consumer (20 screens), cross-cutting engineering (CLAUDE.md hard rules,
app-wide). Full per-screen tables live in the audit transcripts; this doc is
the synthesis + fix plan.*

## The diligence one-liner
Tokens migrated cleanly (C01 held: zero rogue palettes), the engineering hard
rules hold almost everywhere (no spinners, no polling, bounded reads, single
image-compression choke point, zero realtime leaks, 1 console.log in the whole
app) — but **the operator console is a pre-design-system island** (10 of 12
screens use zero ui/* primitives, 38 native browser dialogs, ~18 bare-text
loading states), **component adoption never happened on the consumer side
either** (SectionHeader: 1 screen; ui/Button: 0 screens; two competing
EmptyState components with the legacy one dominating), and **the keyboard
focus ring is missing app-wide** (a regression vs the June QA pass memory).

## Cross-cutting confirmations (rule → verdict)
| Rule | Verdict |
|---|---|
| No spinners / no "Loading…" | HOLDS |
| No data polling | HOLDS (10 setIntervals, all cosmetic/sanctioned) |
| No full-list fetches | HOLDS (all remaining unbounded selects are scoping-key bounded; AdminAnalytics's capped 20k read self-documented) |
| Image compression at every upload | HOLDS (single choke point: uploadMedia) |
| Realtime cleanup | HOLDS (11 channels ↔ 11 removals) |
| Console hygiene | HOLDS (1 log) |
| A11y globals | **PARTIAL — :focus-visible ring ABSENT from index.css** (regression); reduced-motion strong but 4 injected animations ungated (shimmer, live-dot, 2 sheet backdrops) |
| Perf budget | **PARTIAL — share pipeline (canvas + qrcode) eagerly bundled** into every page chunk via ShareButton's static imports; jsPDF correctly lazy; main ~262KB gzip (stale build — regen before quoting) |

## Grade distribution (residue after S03–S09)
- **A / A−:** Profile, Home, Feed, PublicGame, VolunteerCoordinator
- **B+ / B:** most of the app — the gap is component adoption + finish, not function
- **C+ / C:** LeagueManage (load-failure renders `← undefined` chrome, zero
  primitives, worst dialog count), Store (no skeleton, 26px qty buttons,
  unlabeled checkout form), Gallery (declared GAL_* drift, no skeleton, small targets)

## THE FIX PLAN (Gate 1)

### Wave 1 — pure visual, zero logic risk (parallel)
| Pass | Scope |
|---|---|
| W1a | **Loading skeletons**: ~18 operator bare-text sites (TournamentManage ×9, LeagueManage ×2, TeamManage ×2, Admin* ×5) + consumer stragglers (Store, Gallery, GameDetail, Profile) |
| W1b | **Emoji → ui/Icon**: ~40 chrome glyphs across operator screens (mapping table in audit; AdminFeedback's category glyphs = data taxonomy, keep) |
| W1c | **Touch targets + contrast**: sub-44px sweep (operator ✕/🗑 buttons; Tournament division picker at ~22px — worst; Store qty; Gallery chips; Discover follow/tabs; Rinkside chips; the legacy EmptyState CTA fixes 6 screens at once) + the worst AA failures (0.2–0.3-alpha text, Team's 11px 0.3-alpha headers) + League/Tournament standings 375px overflow wrappers |
| W1d | **A11y/perf globals**: restore the :focus-visible ring; gate the 4 ungated animations; lazy-load the share pipeline (dynamic import inside ShareButton's handler) |

### Wave 2 — touches logic, low/medium risk
| Pass | Scope |
|---|---|
| W2a | **alert() → toast**: 24 operator sites + Notifications ×3 + Messages ×1 (control-flow care on `return alert()` guards) |
| W2b | **Error states with retry**: LeagueManage load() (the `← undefined` page) + TournamentManage/Admin*/RinksideEditor → ui/ErrorState with onRetry |
| W2c | **window.confirm policy**: convert CLEARLY-REVERSIBLE deletes to useUndoable (team-remove, division delete, bracket-game delete, rink delete, article delete — each verified reversible per-RPC first; VolunteerCoordinator is the reference); irreversible/high-blast actions (schedule regen, disconnect/unlink, role removals) KEEP a confirm but as a styled in-app confirm (no more native chrome) — **D-S10-1** |
| W2d | **Button primitive + form hardening**: bare-disabled submits (Registers, Store pay, Gallery post, Messages send) → ui/Button with disabledReason; Register/Store forms get label association + inputMode + autocomplete (the paid conversion path) |

### Wave 3 — component adoption, medium (visual-diff care)
| Pass | Scope |
|---|---|
| W3a | **EmptyState consolidation**: batch-swap the 6 legacy Skeletons.EmptyState importers → ui/EmptyState (drop-in), deprecate the legacy component |
| W3b | **SectionHeader adoption — single-use screens only**: Notifications, Profile, GameDetail, PublicGame, Feed (one hand-rolled header each) |

### NAMED FOLLOW-UP TICKETS (below-A+ residue, deliberately not this sprint)
1. **SectionHeader on League/Tournament** (18+ call sites, needs a subtitle affordance on the primitive first)
2. **StatNumber adoption** (Team stat bar, GameDetail stats, Home LeaderMini)
3. **ui/Button app-wide** (League 25 / Tournament 22 / Home 19 raw buttons — bulk swap deserves its own careful pass)
4. **Gallery GAL_* drift + inline-empty conversions on League/Tournament/Team** (C01 drift-pass territory)
5. **AdminAnalytics profiles read → cohort RPC** (self-documented in code, pre-scale)
6. **Regenerate build + record bundle numbers** for the diligence packet
