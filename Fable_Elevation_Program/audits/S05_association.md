# S05 — Association Experience: Friction Map + Prioritized Fixes

*July 1, 2026. Five parallel workflow walks (league manage · tournament manage ·
scheduling/rosters · ScorerView 5-second test · registration/comms/stats), each
with file:line evidence. This doc is the synthesis; the sprint ships the scoped
bundles below. Full per-workflow detail lives in the agent reports (this file
keeps the actionable core).*

## Headline verdicts
- **The engineering underneath is enterprise-grade** — ScorerView's offline
  queue/dedup/rollback, idempotent registration approval, server-side standings
  views, the sponsor manager, and the bracket auto-builder are all above bar.
- **The friction concentrates in four places:** (1) a handful of true dead-ends
  and correctness traps, (2) one-at-a-time flows that collapse at 40-team scale,
  (3) the goal modal's ceremony tap pushing the common case past 5 seconds,
  (4) prototype-grade finish (text loading lines, emoji icons, window.confirm)
  on the two screens operators see in demos.
- **ScorerView 5-second test result:** common case (scorer + assist known) =
  4 taps ≈ 6–9s — FAILS. Fast case (no scorer) = 2 taps — passes. The offline
  path is genuinely excellent (GS-1 is LIVE on main, not draft as memory said).

## THE FIX BUNDLES (this sprint)

### Bundle A — Correctness guards (Pete's hot button: nothing silently wrong)
| # | Fix | Evidence |
|---|---|---|
| A1 | Advanced schedule wizard Publish gets the same existing-games confirm the Smart generator has — today it silently doubles a season on re-publish | ScheduleBuilderModal.js:76-85 vs LeagueManage.js:1580-86 |
| A2 | Playoff next-round generate gets an idempotency guard (`byRound[nextLabel]` exists → block) — double-click inserts the final twice today | LeagueManage.js:1242 |
| A3 | Playoff round-1 warns when regular-season games are still unplayed ("N games unplayed — seeds may change") | leaguePlayoffGenerator.js:98 |
| A4 | Tournament pool becomes a select of existing pools (+ "new pool…") — free-text today, so "A"/"a" silently splits a pool and the generator schedules them separately | TournamentManage.js:757, :521 |

### Bundle B — ScorerView: get the common goal under 5 seconds
| # | Fix | Evidence |
|---|---|---|
| B1 | Goal sheet: maxHeight + scroll with Save/Cancel pinned (Save can fall below the fold with a 25-player roster today) | ScorerView.js Modal :122; EditGameModal :143 has the pattern |
| B2 | Sticky "Save Goal" surfaces prominently the instant a scorer is picked — kills the ceremony-tap hunt; known-scorer/no-assist → 3 tight taps | :1796-1846 |
| B3 | Picker name truncation (ellipsis + max-width; jersey number is the load-bearing token) — a 60-char name currently makes the picker a one-column scroll | pickBtnStyle :155-160 |
| B4 | Goal/penalty ✕ delete to 44×44 (the mis-tap-recovery control is the smallest target on screen); Shots − to 44 to match + | :1560, :1621, :1596 |
| B5 | Goalie-change rows get a ✕ delete (only logged event with NO undo) — mirror deletePenalty | :1655-67, :1165 |

### Bundle C — Operator dead-ends + bulk (the 40-team wall)
| # | Fix | Evidence |
|---|---|---|
| C1 | **League scorers manageable post-create** — LeagueStaffManager gains a Scorers section wiring the existing (orphaned!) leagueScorers.js lib. Today a scorer can ONLY be added in the create wizard; the workaround is over-permissioning a volunteer as co-manager | leagueScorers.js only imported by LeagueCreate; LeagueManage :813 |
| C2 | Tournament bulk team add: name field accepts a pasted newline/comma list; plus "Add as team" on approved registrations (reg data → tournament_teams, today re-typed by hand) | TournamentManage.js:718, :1339, :1476 |
| C3 | "Approve all paid" over pending registrations (league + tournament) — reuses the idempotent approve; 40 taps → 1 | LeagueManage.js:1793; registrations.js:84-171 |
| C4 | Register pages persist the 3 fields across a Stripe cancel/back (sessionStorage) + email-format guard before the round-trip | TournamentRegister.js:38-40,57,155; LeagueRegister same |

## EXPLICITLY DEFERRED (logged, not lost)
- **Premium-finish sweep** (skeletons for ~10 text-loading sites on both Manage
  pages, emoji → lucide icons, window.confirm/alert → undoable toasts) →
  **S10 Enterprise Polish**, where it's the whole point.
- LeagueManage load() error state + team-remove undo → S10 (same class).
- Rink picker: global unbounded listRinks() + no inline add → needs product
  thought (rinks are global; scoping rule unclear) — flag for the operator tier.
- Wizard→Manage division handoff (league wizard stores free-text divisions in
  settings; Manage uses league_divisions rows) — **needs verification**; if
  broken it's silent data loss. Spawned as its own follow-up.
- Schedule list windowing at 500 games; create-wizard batch insert + localStorage
  draft; Stripe "in review" third state; standings tiebreaker footnote; roster
  inline row edit + partial-invite resend — all real, all below the line.

## What's genuinely fine as-is (don't touch)
ScorerView offline/dedup/finalize gating; roster CSV parser + invite chunking;
registration approve idempotency; standings/stats server-side aggregation;
SponsorsManager (best surface audited); DivisionPicker adaptive pattern;
bye/odd-team handling in both round-robins; the 3-field register form itself.
